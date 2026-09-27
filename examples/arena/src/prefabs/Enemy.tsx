/**
 * One arena hostile: the AI at `useFrame` priority −1, its performance at the
 * default 0, with a typed intent between them.
 *
 * `arenaBot`, `health`, `hitFlash`, `dead` and `resetArenaBot` live on
 * `userData` deliberately — the player finds enemies by raycast and traversal,
 * and a match restart broadcasts to every hostile at once. Those are
 * entity-to-entity; everything a parent hands its own child is a plain ref.
 */

import { useGLTF } from '@react-three/drei/core/Gltf';
import { type ThreeElements, useFrame, useThree } from '@react-three/fiber';
import { CapsuleCollider, type RapierRigidBody, RigidBody } from '@react-three/rapier';
import { bindXStateAnimation } from '@volter/threejs-runtime/animation/xstate-animation-binding';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createActor } from 'xstate';
import { damagePlayer, getArenaState, setArenaState } from '../arena-state';
import { enemyAnimationMachine } from '../enemy-animation-machine';
import { buildAimStanceClip, buildFlinchClip, buildRecoilClip } from '../enemy-combat-clips';
import { buildEnemyDeathClip } from '../enemy-death-clip';
import { logArenaEvent } from '../events';
import { useKinematicCapsule } from '../lib/character';
import {
  attachToGrip,
  GRIP_SOCKET_NAMES,
  getForegrip,
  type ItemGripTransform,
} from '../lib/humanoid/grip';
import { IKChain } from '../lib/ik/ik-chain';
import { WeaponModel } from './WeaponModel';

/** The hostile faction — two cosmetic Redline variants derived from the same
 *  humanoid seed (spec + design intent: src/assets/enemy-characters.ts),
 *  matching the arena's postings: breachers on the floor, overwatch on the
 *  west/east deck tops. */
export const ENEMY_MODEL_PATHS = {
  breacher: '/models/generated/redline-breacher.glb',
  overwatch: '/models/generated/redline-overwatch.glb',
} as const;
export type EnemyVariant = keyof typeof ENEMY_MODEL_PATHS;

/** The Mixamo-family clips the baked Redline GLBs carry (retargeted at bake
 *  time). AimStance/Recoil/Flinch/Death are authored in code and appended. */
const REQUIRED_CLIPS = ['Idle', 'Walk'] as const;
/** Seconds a body stays down before respawning. */
const RESPAWN_DELAY = 2.8;
/** Stops closing once this near the player, metres. */
const STANDOFF = 6.5;
/** Damage per shot inside CLOSE_RANGE, and beyond it. */
const DAMAGE: readonly [number, number] = [9, 5];
const CLOSE_RANGE = 9;
/** How quickly the aim pose blends in and out, seconds. */
const AIM_BLEND_TIME = 0.14;
/** The capsule a hostile occupies — standing height, so it clears the arena's
 *  cover the same way the player's does. */
const CAPSULE_RADIUS = 0.35;
const CAPSULE_HALF_HEIGHT = 0.55;
const HAND_BONE = 'mixamorigRightHand';
const FOREARM_BONE = 'mixamorigRightForeArm';
const UPPER_ARM_BONE = 'mixamorigRightArm';

/** The arena weapon GLBs' own grip frame, declared per the imported-asset
 *  escape hatch of the grip convention (src/lib/humanoid/grip.ts).
 *  `attachToGrip` applies the inverse. */
export const ARENA_WEAPON_ITEM_GRIP: ItemGripTransform = {
  rotationDeg: [0, 180, 0],
  scale: 1 / 0.35,
};

/** Rotate `socket` so its −Z (the weapon GLBs' declared barrel axis) points
 *  exactly at `target`; returns the achieved barrel·target alignment dot. */
export function alignWeaponNegativeZToTarget(
  socket: THREE.Object3D,
  target: THREE.Vector3,
): number {
  if (!socket.parent) return 0;
  socket.updateWorldMatrix(true, false);
  const origin = socket.getWorldPosition(new THREE.Vector3());
  const desired = target.clone().sub(origin);
  if (desired.lengthSq() < 1e-8) return 0;
  desired.normalize();

  const worldRotation = socket.getWorldQuaternion(new THREE.Quaternion());
  const current = new THREE.Vector3(0, 0, -1).applyQuaternion(worldRotation);
  const correction = new THREE.Quaternion().setFromUnitVectors(current, desired);
  const parentInverse = socket.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  socket.quaternion.copy(parentInverse.multiply(correction.multiply(worldRotation)));
  socket.updateWorldMatrix(false, true);
  const corrected = new THREE.Vector3(0, 0, -1).applyQuaternion(
    socket.getWorldQuaternion(new THREE.Quaternion()),
  );
  return THREE.MathUtils.clamp(corrected.dot(desired), -1, 1);
}

// --- Reading the hostiles ----------------------------------------------------
//
// What the viewport cannot show: a hostile's remaining health, whether the body
// on the floor is dead or mid-flinch, and which animation layer its rig is
// actually running (the aim stance blends over the locomotion clip, so a bot
// that is aiming and one that is merely facing you look identical). Reached
// from the REPL as
// `game.run(async ({ modules }) => (await modules('src/prefabs/Enemy.tsx')).arenaEnemyStates())`.

export interface EnemyRead {
  readonly position: number[];
  readonly health: number;
  readonly dead: boolean;
  readonly animation: {
    readonly state: string;
    readonly aimPitch: number;
    readonly aimBlend: number;
    readonly layers: ReturnType<ReturnType<typeof bindXStateAnimation>['getActiveLayers']>;
    readonly rifleAttached: boolean;
    readonly rifleAimDot: number;
    readonly offhandOnForegrip: boolean;
  };
}

const hostiles = new Map<string, () => EnemyRead>();

/** Every mounted hostile's live read, keyed by its scene name. */
export function arenaEnemyStates(): Record<string, EnemyRead> {
  return Object.fromEntries([...hostiles].map(([name, read]) => [name, read()]));
}

/** What the AI decided this frame, for the animation pass below it. */
interface BotIntent {
  speed: number;
  aimPitch: number;
  aiming: boolean;
  aimTarget: THREE.Vector3 | null;
  fired: boolean;
  hit: boolean;
  dead: boolean;
}

interface Rigging {
  actor: ReturnType<typeof createActor<typeof enemyAnimationMachine>>;
  binding: ReturnType<typeof bindXStateAnimation>;
  grip: ReturnType<typeof attachToGrip>;
  offhand: IKChain;
  rifle: THREE.Object3D;
  upperArm: THREE.Object3D;
  forearm: THREE.Object3D;
  hand: THREE.Object3D;
  forearmRest: THREE.Quaternion;
  handRest: THREE.Quaternion;
}

export type EnemyProps = ThreeElements['group'] & {
  name: string;
  variant: EnemyVariant;
  /** Chase speed, m/s. The deck snipers hold position; the floor units close. */
  readonly speed?: number;
  /** How far this hostile can see and shoot, metres. */
  readonly engageRange?: number;
  /** Base seconds between shots. */
  readonly fireInterval?: number;
};

/**
 * A prefab is INSTANTIATED BY THE EDITOR, which has no type checker.
 *
 * Dropping this component from the Prefabs browser writes `<Enemy name=… />`
 * and nothing else — no `variant` — so this lookup missed, `useGLTF` was
 * handed `undefined`, and `LoaderUtils.extractUrlBase` threw before the fiber
 * tree's FIRST COMMIT. That does not break one prefab: it takes the whole
 * world down, and because the source is already written the project stays dead
 * across reloads (runhuman pass 97 lost a project to exactly this).
 *
 * So the discriminator is checked BEFORE any hook runs, in a wrapper that
 * holds none. An unknown value renders nothing and says so by name — the
 * anti-shim answer, and the one that leaves every sibling in the scene alive.
 * The hooks all live in the inner component, which mounts as a unit, so the
 * hook count never varies for a mounted element.
 */
export function Enemy(props: EnemyProps) {
  if (props.variant === undefined || !(props.variant in ENEMY_MODEL_PATHS)) {
    console.warn(
      `[Enemy] no such variant ${JSON.stringify(props.variant)} — expected one of ` +
        `${Object.keys(ENEMY_MODEL_PATHS).join(', ')}. Rendering nothing; set variant in the Inspector.`,
    );
    return null;
  }
  return <EnemyBody {...props} />;
}

function EnemyBody({
  name,
  variant,
  speed = 1.55,
  engageRange = 18,
  fireInterval = 0.95,
  ...groupProps
}: EnemyProps) {
  const rig = useRef<THREE.Group>(null);
  const model = useRef<THREE.Group>(null);
  const scene = useThree((state) => state.scene);

  const source = useGLTF(ENEMY_MODEL_PATHS[variant]);
  const body = useMemo(() => {
    const next = cloneSkeleton(source.scene);
    next.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      // A skinned body is culled against its BIND-POSE bounds — three never
      // updates them from animation — so a character that walks, crouches or
      // is simply placed away from its own rest bounds pops out of existence
      // at some camera angles while its SHADOW stays (the shadow pass culls
      // against the light's frustum, not the camera's). That signature is
      // exactly what a tester reported on the strategy map (runhuman pass 95).
      // The estate already recorded this decision for meshes its own kit
      // builds (`src/lib/mesh/materials.ts`); a baked GLB needs it just as
      // much.
      if (object instanceof THREE.SkinnedMesh) object.frustumCulled = false;
      // Skinned materials are cloned per instance: the hit flash drives their
      // emissive and must never light up the other bots. The rifle's stay shared.
      if (object instanceof THREE.SkinnedMesh) {
        object.material = Array.isArray(object.material)
          ? object.material.map((material) => material.clone())
          : object.material.clone();
      }
    });
    return next;
  }, [source.scene]);
  useEffect(
    () => () => {
      body.traverse((object) => {
        if (!(object instanceof THREE.SkinnedMesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      });
    },
    [body],
  );

  const intent = useRef<BotIntent>({
    speed: 0,
    aimPitch: 0,
    aiming: false,
    aimTarget: null,
    fired: false,
    hit: false,
    dead: false,
  });
  // Per-frame state, grouped by concern. None of it can be React state — it
  // changes every frame and must never re-render.
  const spawn = useRef<THREE.Vector3 | null>(null);
  const player = useRef<THREE.Object3D | undefined>(undefined);
  const rigging = useRef<Rigging | null>(null);
  /** The hostile's physical presence — the same kinematic capsule the player
   *  gets, so both are stopped by the same cover and walk up the same ramps. */
  const capsule = useRef<RapierRigidBody>(null);
  const here = useRef(new THREE.Vector3());
  const fall = useRef(0);
  const advance = useKinematicCapsule(capsule);
  const combat = useRef({
    shotCooldown: 0.6,
    respawnTimer: 0,
    hitTimer: 0,
    elapsed: 0,
    shots: [] as { mesh: THREE.Mesh; life: number }[],
  });
  const pose = useRef({ aimBlend: 0, rifleAimDot: 0, offhandOnForegrip: false });
  const baseMaterials = useRef(
    new Map<THREE.MeshStandardMaterial, { emissive: THREE.Color; emissiveIntensity: number }>(),
  );
  const raycaster = useRef(new THREE.Raycaster());

  function idle(dead: boolean): void {
    intent.current.speed = 0;
    intent.current.aimPitch = 0;
    intent.current.aiming = false;
    intent.current.aimTarget = null;
    intent.current.hit = false;
    intent.current.dead = dead;
  }

  function tint(amount: number): void {
    for (const [material, base] of baseMaterials.current) {
      if (amount <= 0) {
        material.emissive.copy(base.emissive);
        material.emissiveIntensity = base.emissiveIntensity;
        continue;
      }
      material.emissive.setRGB(1, 0.92, 0.85);
      material.emissiveIntensity = base.emissiveIntensity + amount * 0.55;
    }
  }

  function respawn(node: THREE.Object3D): void {
    if (spawn.current) {
      here.current.copy(spawn.current);
      capsule.current?.setTranslation(here.current, true);
      capsule.current?.setNextKinematicTranslation(here.current);
      fall.current = 0;
    }
    node.userData['health'] = 100;
    node.userData['dead'] = false;
    node.userData['hitFlash'] = 0;
    node.visible = true;
    combat.current.shotCooldown = 0.8;
    combat.current.hitTimer = 0;
    idle(false);
    tint(0);
  }

  function playerAimPoint(): THREE.Vector3 {
    return player.current?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
  }

  function disposeShot(mesh: THREE.Mesh): void {
    scene.remove(mesh);
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) material.dispose();
  }

  // --- the rigging: grip the rifle, bind the clips, build the off-hand IK.
  useEffect(() => {
    const node = model.current;
    if (!node) return;

    const clipMap = new Map(source.animations.map((clip) => [clip.name, clip]));
    for (const required of REQUIRED_CLIPS) {
      if (!clipMap.has(required)) throw new Error(`${name} is missing baked clip '${required}'`);
    }
    clipMap.set('AimStance', buildAimStanceClip(node));
    clipMap.set('Recoil', buildRecoilClip());
    clipMap.set('Flinch', buildFlinchClip());
    clipMap.set('Death', buildEnemyDeathClip(node));

    const hand = node.getObjectByName(HAND_BONE);
    const forearm = node.getObjectByName(FOREARM_BONE);
    const upperArm = node.getObjectByName(UPPER_ARM_BONE);
    const rifle = node.getObjectByName(`${name}Rifle`);
    if (!hand || !forearm || !upperArm || !rifle)
      throw new Error(
        `${name} requires ${UPPER_ARM_BONE}/${FOREARM_BONE}/${HAND_BONE} and its rifle`,
      );

    const actor = createActor(enemyAnimationMachine).start();
    // No `systems` on the binding: the mixer is ticked MANUALLY below so the
    // procedural aim can pose the arm after the sample, in the same frame.
    const binding = bindXStateAnimation(actor, new THREE.AnimationMixer(node), clipMap, {
    });
    const grip = attachToGrip(node, rifle, 'Right', {
      itemGrip: ARENA_WEAPON_ITEM_GRIP,
      grip: 'wrap',
    });
    // The rifle is two-handed: a manually driven IK chain over the left arm,
    // targeting the rifle's authored Foregrip.
    const offhand = new IKChain();
    offhand.node = node;
    offhand.boneNames = ['mixamorigLeftArm', 'mixamorigLeftForeArm', 'mixamorigLeftHand'];
    offhand.targetBoneName = `${name}OffhandIKTarget`;
    offhand.iterations = 10;
    offhand.getWorldTarget = (): THREE.Vector3 | null => {
      pose.current.offhandOnForegrip = false;
      if (intent.current.dead) return null;
      const foregrip = getForegrip(rifle);
      if (!foregrip) return null;
      pose.current.offhandOnForegrip = true;
      return foregrip.getWorldPosition(new THREE.Vector3());
    };
    offhand.init();

    rigging.current = {
      actor,
      binding,
      grip,
      offhand,
      rifle,
      upperArm,
      forearm,
      hand,
      forearmRest: forearm.quaternion.clone(),
      handRest: hand.quaternion.clone(),
    };
    return () => {
      binding.dispose();
      actor.stop();
      // Restores the rifle's pre-attach parent/transform and the wrapped fingers.
      grip.detach();
      rigging.current = null;
      pose.current.aimBlend = 0;
      pose.current.rifleAimDot = 0;
    };
  }, [source.animations, name]);

  useEffect(() => {
    const live = combat.current.shots;
    const node = rig.current;
    return () => {
      for (const shot of live) disposeShot(shot.mesh);
      live.length = 0;
      baseMaterials.current.clear();
      if (node) {
        delete node.userData['resetArenaBot'];
        delete node.userData['placeArenaBot'];
      }
    };
  }, []);

  /** Is the player reachable, or is the arena in the way? */
  function hasLineOfSight(): boolean {
    const arena = scene.getObjectByName('UnrealStyleArena');
    if (!arena) return true;
    const from = here.current.clone().add(new THREE.Vector3(0, 1.25, 0));
    const direction = playerAimPoint().sub(from);
    const range = direction.length();
    raycaster.current.set(from, direction.normalize());
    raycaster.current.far = range;
    const blocked = raycaster.current.intersectObject(arena, true)[0];
    return !blocked || blocked.distance >= range - 0.35;
  }

  /** The visible tracer for one bot shot. */
  function spawnShot(): void {
    const from = here.current.clone().add(new THREE.Vector3(0, 1.25, 0));
    const to = playerAimPoint();
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, from.distanceTo(to), 5),
      new THREE.MeshBasicMaterial({ color: '#ff9a28', transparent: true, opacity: 0.78 }),
    );
    mesh.position.copy(from).lerp(to, 0.5);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      to.clone().sub(from).normalize(),
    );
    scene.add(mesh);
    combat.current.shots.push({ mesh, life: 0.075 });
  }

  /** One-time adoption once the body arrives through Suspense: publish the
   *  scene-wide contract, and capture the emissive baseline the hit flash
   *  drives (the baked body is one vertex-colored skinned mesh whose material
   *  base color is white, so a diffuse-lerp flash would be invisible). */
  function adopt(node: THREE.Object3D): boolean {
    let skinned = false;
    node.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) skinned = true;
    });
    if (!skinned) return false;
    spawn.current = here.current.clone();
    node.userData['arenaBot'] = true;
    node.userData['enemyRig'] = true;
    node.userData['health'] = 100;
    node.userData['dead'] = false;
    node.userData['resetArenaBot'] = () => respawn(node);
    // Where a hostile stands is the body's business now, so moving one is a
    // published capability rather than a write to `position` Rapier would undo.
    node.userData['placeArenaBot'] = (at: readonly [number, number, number]) => {
      here.current.set(at[0], at[1], at[2]);
      capsule.current?.setTranslation(here.current, true);
      capsule.current?.setNextKinematicTranslation(here.current);
      fall.current = 0;
    };
    // The baked Redline body is ONE vertex-colored skinned mesh whose material
    // base color is white — a diffuse-lerp hit flash is invisible on it, so
    // the flash drives EMISSIVE instead.
    node.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial) {
          baseMaterials.current.set(material, {
            emissive: material.emissive.clone(),
            emissiveIntensity: material.emissiveIntensity,
          });
        }
      }
    });
    idle(false);
    return true;
  }

  // −1 (was `phase: 'gameLogic'`): chase, strafe, line-of-sight fire.
  useFrame((_, dt) => {
    const node = rig.current;
    if (!node) return;
    if (capsule.current) here.current.copy(capsule.current.translation() as THREE.Vector3Like);
    if (!spawn.current && !adopt(node)) return;

    combat.current.elapsed += dt;
    intent.current.fired = false;
    for (let index = combat.current.shots.length - 1; index >= 0; index -= 1) {
      const shot = combat.current.shots[index];
      if (!shot) continue;
      shot.life -= dt;
      if (shot.life > 0) continue;
      disposeShot(shot.mesh);
      combat.current.shots.splice(index, 1);
    }

    player.current ??= scene.getObjectByName('PlayerRig');
    if (!player.current) return;
    const state = getArenaState();

    if (node.userData['dead'] === true) {
      combat.current.respawnTimer -= dt;
      idle(true);
      node.visible = combat.current.respawnTimer > 0.65;
      if (combat.current.respawnTimer <= 0) {
        respawn(node);
        logArenaEvent('arena.enemy-respawned', { enemy: name });
      }
      return;
    }

    if (Number(node.userData['health'] ?? 100) <= 0) {
      node.userData['dead'] = true;
      combat.current.respawnTimer = RESPAWN_DELAY;
      idle(true);
      setArenaState({ kills: state.kills + 1, message: 'ELIMINATED' });
      logArenaEvent('arena.enemy-eliminated', { enemy: name, kills: state.kills + 1 });
      return;
    }

    const flash = Math.max(0, Number(node.userData['hitFlash'] ?? 0) - dt * 6);
    node.userData['hitFlash'] = flash;
    // `>=` — at the fixed 1/60 step a fresh hit decays to EXACTLY 0.9, so a
    // strict compare never fires and the hit reaction never plays.
    if (flash >= 0.9) combat.current.hitTimer = 0.32;
    combat.current.hitTimer = Math.max(0, combat.current.hitTimer - dt);
    tint(flash);

    if (state.paused || state.respawnRemaining > 0) {
      idle(false);
      return;
    }

    const toPlayer = player.current.position.clone().sub(here.current);
    const distance = toPlayer.length();
    toPlayer.y = 0;
    if (toPlayer.lengthSq() > 0.001) {
      toPlayer.normalize();
      // The capsule turns with the character — the body owns its own rotation,
      // so facing is set on the body rather than written onto the Object3D
      // Rapier is about to overwrite. The bake faces −Z, hence the half turn.
      capsule.current?.setNextKinematicRotation(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          Math.atan2(-toPlayer.x, -toPlayer.z),
        ),
      );
    }

    const strafe = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).multiplyScalar(
      Math.sin(combat.current.elapsed * 1.25) * 0.38,
    );
    const chasing = distance > STANDOFF;
    const velocity = chasing
      ? toPlayer.clone().multiplyScalar(speed).add(strafe)
      : new THREE.Vector3();
    // Gravity runs even while standing off, or a hostile shot off a deck would
    // hang in the air — so this is called whether or not the bot is chasing.
    const stepped = advance(here.current, velocity, fall.current, dt);
    if (stepped) fall.current = stepped.verticalVelocity;
    const moving = Boolean(stepped) && chasing;

    // Line of sight, then fire.
    const canAim = distance < engageRange && hasLineOfSight();

    combat.current.shotCooldown -= dt;
    if (state.enemyFire && canAim && combat.current.shotCooldown <= 0) {
      combat.current.shotCooldown = fireInterval + (name.length % 3) * 0.16;
      damagePlayer(distance < CLOSE_RANGE ? DAMAGE[0] : DAMAGE[1]);
      spawnShot();
      intent.current.fired = true;
    }

    intent.current.speed = moving ? speed : 0;
    intent.current.aiming = canAim;
    intent.current.hit = combat.current.hitTimer > 0.28;
    intent.current.dead = false;
    if (canAim) {
      const from = node.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.25, 0));
      const delta = playerAimPoint().sub(from);
      intent.current.aimPitch = THREE.MathUtils.clamp(
        Math.atan2(delta.y, Math.hypot(delta.x, delta.z)),
        -0.85,
        0.85,
      );
      intent.current.aimTarget = playerAimPoint();
    } else {
      intent.current.aimPitch = 0;
      intent.current.aimTarget = null;
    }
  }, -1);

  // --- default 0 (was `phase: 'animation'`): layered clips, then the
  // procedural aim, posed AFTER the mixer has sampled.
  useFrame((_, dt) => {
    const live = rigging.current;
    const node = model.current;
    if (!live || !node) return;

    live.actor.send({ type: 'UPDATE', ...intent.current, dt });
    live.binding.tick(dt);
    // The wrap pose re-asserts over whatever the clips did to the fingers.
    live.grip.applyPose();

    const aiming = intent.current.aiming && !intent.current.dead;
    pose.current.aimBlend = THREE.MathUtils.clamp(
      pose.current.aimBlend + (aiming ? dt / AIM_BLEND_TIME : -dt / AIM_BLEND_TIME),
      0,
      1,
    );
    // Re-assert the attach-time transform (the barrel correction re-rotates it).
    live.grip.resetItemTransform();
    pose.current.rifleAimDot = 0;

    const target = intent.current.aimTarget;
    if (pose.current.aimBlend > 0.001 && target) {
      // 1. Ease elbow/wrist toward the straight bind pose.
      live.forearm.quaternion.slerp(live.forearmRest, 0.85 * pose.current.aimBlend);
      live.hand.quaternion.slerp(live.handRest, 0.5 * pose.current.aimBlend);

      // 2. Swing the upper arm so the shoulder→hand line meets the target.
      node.updateWorldMatrix(true, true);
      const shoulder = live.upperArm.getWorldPosition(new THREE.Vector3());
      const current = live.hand.getWorldPosition(new THREE.Vector3()).sub(shoulder);
      const desired = target.clone().sub(shoulder);
      if (current.lengthSq() > 1e-8 && desired.lengthSq() > 1e-8) {
        current.normalize();
        desired.normalize();
        if (current.dot(desired) > -0.99) {
          const swing = new THREE.Quaternion().setFromUnitVectors(current, desired);
          const armWorld = live.upperArm.getWorldQuaternion(new THREE.Quaternion());
          const parentInverse = live.upperArm.parent
            ? live.upperArm.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
            : new THREE.Quaternion();
          live.upperArm.quaternion.slerp(
            parentInverse.multiply(swing.multiply(armWorld)),
            pose.current.aimBlend,
          );
          live.upperArm.updateWorldMatrix(false, true);
        }
      }

      // 3. Exact barrel correction once the raise lands.
      if (pose.current.aimBlend > 0.4) {
        pose.current.rifleAimDot = alignWeaponNegativeZToTarget(live.rifle, target);
      }
    }

    // Off hand LAST: the foregrip goal depends on the rifle's post-aim transform.
    live.offhand.update();
  });

  // Publish this hostile's live read for as long as it is mounted; unmount is
  // the one teardown path. `arenaEnemyStates()` below is what the REPL and any
  // editor contribution this game writes actually call.
  useEffect(() => {
    const read = (): EnemyRead => ({
      // `here`, not `rig.position`: since the capsule arrived, `rig` is the
      // group INSIDE the body and sits at local [0,0,0] forever. Reading it
      // reported every hostile at the world origin.
      position: here.current.toArray(),
      health: Number(rig.current?.userData['health'] ?? 0),
      dead: rig.current?.userData['dead'] === true,
      animation: {
        state: String(rigging.current?.actor.getSnapshot().value ?? 'disposed'),
        aimPitch: intent.current.aimPitch,
        aimBlend: pose.current.aimBlend,
        layers: rigging.current?.binding.getActiveLayers() ?? [],
        rifleAttached: rigging.current?.rifle.parent?.name === GRIP_SOCKET_NAMES.Right,
        rifleAimDot: pose.current.rifleAimDot,
        offhandOnForegrip: pose.current.offhandOnForegrip,
      },
    });
    hostiles.set(name, read);
    return () => {
      if (hostiles.get(name) === read) hostiles.delete(name);
    };
  }, [name]);

  return (
    <RigidBody
      {...groupProps}
      name={`${name}Body`}
      ref={capsule}
      type="kinematicPosition"
      colliders={false}
    >
      <CapsuleCollider
        args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]}
        position={[0, CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS, 0]}
      />
      {/* The named hostile itself rides at the body's origin: the body owns
          where it is, this group owns who it is and what other entities find. */}
      <group ref={rig} name={name} userData={{ enemyRig: true }}>
        {/* Like the player bake it faces −Z already, so no yaw wrapper. */}
        <group ref={model} name={`${name}Character`}>
          <primitive object={body} />
          <WeaponModel
            kind="rifle"
            name={`${name}Rifle`}
            rotation={[-Math.PI / 2, 0, 0]}
            scale={0.35}
          >
            <group name="Foregrip" position={[0, 0.02, -0.52]} />
          </WeaponModel>
        </group>
      </group>
    </RigidBody>
  );
}
