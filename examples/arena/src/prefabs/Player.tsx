/**
 * The placeable player prefab: look, movement and the arsenal, plus the avatar
 * that renders from them.
 *
 * Everything the player DOES happens in one `useFrame` at priority −2, because
 * it is sequential: movement solves along the yaw just set, the camera is
 * placed against that yaw, and the hitscan casts down the camera just aimed.
 * `<PlayerBody>` animates from the result at the default 0. Fiber sorts frame
 * callbacks ascending and only disables its own render for POSITIVE priorities,
 * so a negative one is a free ordering lever — never use a positive number
 * here, it blanks the world.
 *
 * There is exactly ONE movement path and ONE aim path, both fed by the input
 * map, and they are the SAME ONE in both perspectives. The perspective
 * (`src/perspective.ts`) is read in exactly three places in this file —
 * `frameCamera` (where the lens sits), `updateViewModel` (whether the
 * arms-length weapon draws) and `<PlayerBody>`'s frame (whether the body is
 * lit or shadow-only) — plus one presentation line on the tracer. Nothing
 * else in this game may read it: the hostiles, the map, the weapon table and
 * the HUD are the same game from either camera, which is the whole point of
 * having one game rather than two.
 */

import { useGLTF } from '@react-three/drei/core/Gltf';
import { PerspectiveCamera } from '@react-three/drei/core/PerspectiveCamera';
import { type ThreeElements, useFrame, useThree } from '@react-three/fiber';
import { CapsuleCollider, type RapierRigidBody, RigidBody, useRapier } from '@react-three/rapier';
import {
  bindXStateAnimation,
  type XStateAnimationBinding,
} from '@volter/threejs-runtime/animation/xstate-animation-binding';
import { type RefObject, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createActor } from 'xstate';
import { computeArenaMove } from '../arena-layout';
import {
  getArenaState,
  resetArenaState,
  setArenaState,
  toggleArenaPause,
  WEAPON_CAPACITY,
  WEAPON_PICKUP_AMMO,
  type WeaponKind,
} from '../arena-state';
import { logArenaEvent } from '../events';
import { gameTone as playTone } from '../lib/audio/sfx';
import {
  type CameraFraming,
  frameAim,
  pullInBoom,
  resolveLaunch,
  SHAKE_IDLE,
  type ShakeState,
  shake,
  shakeOffset,
  stepAimBlend,
  stepShake,
  useKinematicCapsule,
} from '../lib/character';
import { gameInput as input } from '../lib/input';
import { getPerspective, type Perspective, togglePerspective } from '../perspective';
import { playerBodyMachine } from '../player-body-machine';
import { createVanguardFireClip, FIRE_CLIP_NAME } from '../player-fire-clip';
import { type JumpPadPosition, readJumpPadPositions } from './JumpPad';
import { WeaponModel } from './WeaponModel';

/** Camera height above the player's feet — the rig origin IS the eye, so the
 *  body hangs below it by exactly this. */
export const EYE_HEIGHT = 1.72;

/** The game's own player character — the Arena Vanguard, derived from the
 *  humanoid capability's `default` seed and baked to an ordinary GLB (design
 *  intent + bake command: src/assets/player-character.ts). */
export const VANGUARD_PATH = '/models/generated/arena-vanguard.glb';

/** The weapon design table — data about the GAME, so a constant rather than a
 *  prop on `<Player>`. */
const WEAPONS = {
  pistol: {
    cooldown: 0.31,
    damage: 38,
    reload: 0.82,
    tracer: '#fff2c4',
    tone: [105, 0.075, 0.045, 270],
  },
  rifle: {
    cooldown: 0.095,
    damage: 22,
    reload: 0.82,
    tracer: '#ffd08a',
    tone: [138, 0.045, 0.035, 410],
  },
  grenade: { cooldown: 0.78, damage: 0, reload: 1.25, tracer: '', tone: [72, 0.14, 0.05, 130] },
} as const;
const WEAPON_ORDER: readonly WeaponKind[] = ['pistol', 'rifle', 'grenade'];
const UP = new THREE.Vector3(0, 1, 0);
/** Rapier wants a rotation with every shape query; ours are all spheres. */
const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
const VIEWMODEL_REST = new THREE.Vector3(0.52, -0.5, -1.08);
const REQUIRED_CLIPS = ['Idle', 'Walk', 'Run'] as const;
/** Upward velocity a jump pad imparts, m/s. */
const JUMP_PAD_VELOCITY = 12.5;
/** How fast the damage vignette fades, per second. It is also the shake's
 *  clock: the pulse and the camera shake were always the same curve. */
const DAMAGE_PULSE_DECAY = 2.35;
/** The damage shake's feel: radians at full strength, and the wobble rate. */
const SHAKE_FEEL = { amplitude: 0.018, frequency: 89 };
/** Radians of yaw per pixel of mouse travel. */
const LOOK_SENSITIVITY = 0.00215;
/** How far a hitscan shot reaches, metres. */
const HITSCAN_RANGE = 85;
/** The capsule the character controller sweeps: radius, then the half-height of
 *  its cylindrical middle. Together they stand exactly EYE_HEIGHT tall, so the
 *  rig origin is still the eye and the feet still touch the floor. */
const CAPSULE_RADIUS = 0.4;
const CAPSULE_HALF_HEIGHT = (EYE_HEIGHT - CAPSULE_RADIUS * 2) / 2;

// --- The third-person camera -------------------------------------------------
//
// The SECOND perspective, and the whole of it. Everything below this comment
// and above `interface Ammo` is read only while `getPerspective() === 'third'`;
// in first person the camera stays exactly where it has always been — at the
// rig origin, which IS the eye — and not one of these numbers is consulted.
//
// The boom is expressed in WORLD space, because that is where the occlusion ray
// has to be cast and where the smoothing has to happen (lerping in the rig's
// own frame would drag the camera round with every yaw and kill the orbit lag
// that makes a follow camera readable). It is then written onto the camera in
// the rig's LOCAL frame, because the camera is a child of the yawed rig and
// always has been — moving it out of the rig to chase the boom would change the
// first-person path, which this perspective may not touch.

/** What the boom looks at: the player's upper chest, in metres BELOW the rig
 *  origin. Not the eye — framing a third-person character on its eyeline puts
 *  the head in the middle of the screen and the feet off the bottom. */
const BOOM_TARGET_DROP = 0.27;
/** Where the boom sits and how wide the lens is, per stance — distance behind
 *  the character and offset to its right in metres, height above the look-at
 *  target, and field of view in degrees. One framing per stance rather than a
 *  pair of constants per value, so a third stance is a third framing. */
const HIP_FRAMING: CameraFraming = { distance: 4.65, fov: 62, height: 0.78, shoulder: 1.32 };
const AIM_FRAMING: CameraFraming = { distance: 4.05, fov: 56, height: 0.64, shoulder: 1.48 };
/** How far along the boom's own length the camera closes each frame. Low
 *  enough to lag behind a sprint, high enough that the arena never swims. */
const BOOM_FOLLOW = 0.24;
/** Metres in front of the look-at target that the camera actually aims at.
 *  Far enough that the shoulder offset reads as a shoulder offset rather than
 *  as a camera pointed at the character's ear. */
const BOOM_CONVERGENCE = 13;
/** The damage shake is a fraction of its first-person self out here: the same
 *  radians that read as a flinch from inside the helmet read as an earthquake
 *  on a camera four and a half metres back. */
const THIRD_PERSON_SHAKE_FEEL = { amplitude: 0.002, frequency: 89 };
/** Where a tracer is drawn FROM in third person. The shot itself is still cast
 *  down the camera — identical ballistics, identical hits, which is the point
 *  of one game — but a tracer that starts at the camera would be drawn from a
 *  point four metres behind the character's back. Chest height, relative to
 *  the rig origin. */
const TRACER_MUZZLE_DROP = 0.3;

/** The hero frame — `scripts/generate-learn-thumbnails.ts` renders exactly
 *  this, so it is a fixed presentation, not a tunable. */
const HERO = {
  player: [4.6, EYE_HEIGHT, 15.5] as const,
  yaw: 0.35,
  pitch: -0.035,
  fov: 66,
  enemies: {
    EnemyAlpha: [1.7, 0, 7.5],
    EnemyBravo: [7.5, 0, -2],
    EnemyCharlie: [-18, 2.95, -1],
    EnemyDelta: [18, 2.95, 1],
  } as Record<string, THREE.Vector3Tuple>,
};

interface Ammo {
  magazine: number;
  reserve: number;
}

interface TimedEffect {
  object: THREE.Object3D;
  life: number;
  velocity?: THREE.Vector3;
  grenade?: boolean;
}

function freshInventory(): Record<WeaponKind, Ammo> {
  return {
    pistol: { magazine: WEAPON_CAPACITY.pistol, reserve: WEAPON_PICKUP_AMMO.pistol },
    rifle: { magazine: WEAPON_CAPACITY.rifle, reserve: WEAPON_PICKUP_AMMO.rifle },
    grenade: { magazine: WEAPON_CAPACITY.grenade, reserve: WEAPON_PICKUP_AMMO.grenade },
  };
}

/** Walk up to the enemy rig that owns a hit mesh and damage it. */
function damageBot(object: THREE.Object3D, amount: number): boolean {
  let target: THREE.Object3D | null = object;
  while (target && target.userData['arenaBot'] !== true) target = target.parent;
  if (!target || target.userData['dead'] === true) return false;
  target.userData['health'] = Number(target.userData['health'] ?? 100) - amount;
  target.userData['hitFlash'] = 1;
  return true;
}

function nearestBot(
  scene: THREE.Scene,
  from: THREE.Vector3,
  radius: number,
): THREE.Object3D | undefined {
  let nearest: THREE.Object3D | undefined;
  let best = radius;
  scene.traverse((object) => {
    if (object.userData['arenaBot'] !== true || object.userData['dead'] === true) return;
    const distance = object.getWorldPosition(new THREE.Vector3()).distanceTo(from);
    if (distance < best) {
      nearest = object;
      best = distance;
    }
  });
  return nearest;
}

function PlayerViewModel(props: ThreeElements['group']) {
  return (
    <group {...props}>
      <group name="pistol-viewmodel">
        <WeaponModel kind="pistol" name="PlayerPistol" scale={0.72} />
      </group>
      <group name="rifle-viewmodel" visible={false}>
        <WeaponModel kind="rifle" name="PlayerRifle" position={[0, 0.02, 0.18]} scale={0.49} />
      </group>
      <group name="grenade-viewmodel" visible={false}>
        <WeaponModel
          kind="grenade"
          name="PlayerGrenadeLauncher"
          position={[0, 0.01, 0.18]}
          scale={0.48}
        />
      </group>
      <mesh
        name="MuzzleFlash"
        position={[0, 0.04, -0.9]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
      >
        <coneGeometry args={[0.09, 0.3, 5]} />
        <meshBasicMaterial
          color="#fff0b0"
          transparent
          opacity={0.94}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

let playerBodyView: (() => Record<string, unknown>) | null = null;

/**
 * The avatar's animation state — its XState machine value, the layer weights
 * the mixer is actually running, and whether the body is lit or shadow-only.
 * In first person the avatar is a silhouette on the floor, so nothing on
 * screen distinguishes a locomotion blend from a fire layer riding over it;
 * in third person the clip is on screen but its WEIGHTS still are not.
 */
export function arenaPlayerBodyState(): Record<string, unknown> | null {
  return playerBodyView?.() ?? null;
}

/**
 * The player's own body — the baked Arena Vanguard, and the SAME body in both
 * perspectives: one GLB, one skeleton, one XState machine, one set of baked
 * clips (`Idle`/`Walk`/`Run` plus the fire layer). This is what the owner's
 * ruling buys — the third-person player is not a second character, it is this
 * one with the paint turned back on.
 *
 * What the perspective switches is one pair of material flags. In FIRST person
 * the meshes render into the shadow map only (`colorWrite`/`depthWrite` off —
 * three's shadow pass uses its own depth material, so `castShadow` still
 * works), so the player sees their animated silhouette on the arena floor and
 * never clipped geometry from inside the head. In THIRD person both flags go
 * back on and the same animated body is simply visible. The flags are written
 * every frame from `getPerspective()` rather than once in an effect, because
 * the toggle has to take effect on the next frame and a subscription that
 * re-runs an effect would rebuild the mixer to change two booleans. The
 * effect's cleanup still restores both, for the mesh's life after this mount.
 *
 * Runs at the DEFAULT `useFrame` priority, after `<Player>`'s −2, so the machine
 * reads the speed and shot count solved this same frame.
 */
function PlayerBody({
  intent,
  ...groupProps
}: ThreeElements['group'] & { intent: RefObject<{ speed: number; shots: number }> }) {
  const body = useRef<THREE.Group>(null);
  const source = useGLTF(VANGUARD_PATH);
  const actor = useRef<ReturnType<typeof createActor<typeof playerBodyMachine>> | null>(null);
  const binding = useRef<XStateAnimationBinding | null>(null);
  /** Every material of this body, collected once at bind so the frame callback
   *  can flip `colorWrite`/`depthWrite` without re-traversing the skeleton. */
  const skin = useRef<THREE.Material[]>([]);

  const model = useMemo(() => {
    const next = cloneSkeleton(source.scene);
    next.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
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
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => material.clone())
        : object.material.clone();
    });
    return next;
  }, [source.scene]);

  useEffect(() => {
    const node = body.current;
    if (!node) return;

    const clipMap = new Map(source.animations.map((clip) => [clip.name, clip]));
    for (const required of REQUIRED_CLIPS) {
      if (!clipMap.has(required))
        throw new Error(`${node.name} is missing baked vanguard clip '${required}'`);
    }
    clipMap.set(FIRE_CLIP_NAME, createVanguardFireClip(node));

    const shadowOnly: THREE.Material[] = [];
    node.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.receiveShadow = false;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        material.colorWrite = false;
        material.depthWrite = false;
        shadowOnly.push(material);
      }
    });
    skin.current = shadowOnly;

    const made = createActor(playerBodyMachine).start();
    // No `systems` on the binding: the mixer is ticked MANUALLY in the frame
    // callback below — a component root has no host SystemRunner, and this
    // component already owns a frame anyway.
    const bound = bindXStateAnimation(made, new THREE.AnimationMixer(node), clipMap, {
      selectParameters: (context) => ({ speed: (context as { speed: number }).speed }),
    });
    actor.current = made;
    binding.current = bound;
    return () => {
      bound.dispose();
      made.stop();
      actor.current = null;
      binding.current = null;
      skin.current = [];
      for (const material of shadowOnly) {
        material.colorWrite = true;
        material.depthWrite = true;
      }
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      });
    };
  }, [source.animations, model]);

  useFrame((_, dt) => {
    const node = body.current;
    if (!node) return;
    const state = getArenaState();
    const alive = state.health > 0 && state.respawnRemaining <= 0;
    node.visible = alive;
    // The one line the perspective costs this component: lit out here, a
    // shadow on the floor from inside the helmet.
    const lit = getPerspective() === 'third';
    for (const material of skin.current) {
      if (material.colorWrite === lit) break;
      material.colorWrite = lit;
      material.depthWrite = lit;
    }
    actor.current?.send({
      type: 'UPDATE',
      speed: alive && !state.paused ? intent.current.speed : 0,
      shots: intent.current.shots,
      dt,
    });
    // The manual mixer tick — see the binding's construction above.
    binding.current?.tick(dt);
  });

  // The shadow avatar's live read, behind `arenaPlayerBodyState()` below.
  useEffect(() => {
    playerBodyView = () => ({
      machine: actor.current?.getSnapshot().value ?? null,
      layers:
        binding.current?.getActiveLayers().map((layer) => ({
          layer: layer.layer,
          stateId: layer.stateId,
          clipWeights: layer.clipWeights,
        })) ?? [],
      visible: body.current?.visible ?? false,
      // What the camera can actually SEE of the body, which `visible` alone
      // does not answer: a first-person body is `visible` and renders only
      // into the shadow map.
      lit: skin.current[0]?.colorWrite ?? false,
    });
    return () => {
      playerBodyView = null;
    };
  }, []);

  return (
    <group {...groupProps} ref={body}>
      {/* Baked humanoids face −Z at real stature — same forward as the camera. */}
      <primitive object={model} />
    </group>
  );
}

export type PlayerProps = ThreeElements['group'] & {
  /** Walking speed, m/s. */
  readonly speed?: number;
  /** Speed while `sprint` is held, m/s. */
  readonly sprintSpeed?: number;
  /** Upward velocity of an ordinary jump, m/s. */
  readonly jumpVelocity?: number;
  /** Camera field of view, degrees. */
  readonly fov?: number;
};

/**
 * The live player, behind the exported functions at the bottom of this file.
 * It is one object, installed while `<Player>` is mounted and cleared on
 * unmount — these readings belong to the mechanic, not to a hook order.
 */
interface PlayerView {
  readonly read: () => Record<string, unknown>;
  readonly restart: () => void;
  readonly setHostilities: (enabled: boolean) => void;
  readonly poseThumbnail: () => void;
}

let playerView: PlayerView | null = null;

export function Player({
  speed = 6.6,
  sprintSpeed = 9.4,
  jumpVelocity = 7.2,
  fov = 73,
  ...groupProps
}: PlayerProps) {
  const rig = useRef<THREE.Group>(null);
  const camera = useRef<THREE.PerspectiveCamera>(null);
  /** The player's physical presence: a kinematic capsule the character
   *  controller sweeps against the arena's colliders. Its translation — not any
   *  Object3D — is where the player IS; `here` mirrors it for the frame. */
  const body = useRef<RapierRigidBody>(null);
  const here = useRef(new THREE.Vector3());
  const { world, rapier } = useRapier();
  /** Where the JSX put the player. Captured once so the editor's gizmo means
   *  something: drag the character, and that is where it spawns and respawns —
   *  the same contract each `<Enemy>` already honours for its own placement. */
  const spawn = useRef<THREE.Vector3 | null>(null);
  const scene = useThree((state) => state.scene);
  const jumpPads = useRef<JumpPadPosition[]>([]);
  const canvas = useThree((state) => state.gl.domElement);
  // Input, SFX and the event stream are module imports — the game's own
  // stores, reached by name, not through a host context.

  /** Rapier's own character solver — the same one every hostile moves on: it
   *  does the sliding, the step-up and the slope handling that the arena's
   *  height table used to approximate. */
  const advance = useKinematicCapsule(body);

  // Per-frame state, grouped by concern. None of it can be React state — it
  // changes every frame and must never re-render.
  const look = useRef({ yaw: 0, pitch: -0.02, shake: SHAKE_IDLE as ShakeState });
  const motion = useRef({ verticalVelocity: 0, grounded: true });
  const intent = useRef({ speed: 0, shots: 0 });
  /** The third-person boom, in WORLD space, and the perspective it was placed
   *  for. `placedFor` is what makes a switch a CUT rather than a four-metre
   *  slide: on the first frame in a new perspective the boom is snapped to its
   *  solution instead of lerped toward it. */
  const boom = useRef({
    at: new THREE.Vector3(),
    placedFor: null as Perspective | null,
    /** Hip ↔ aim, 0..1. Eased rather than switched: the two framings differ by
     *  more than half a metre of boom and six degrees of lens, and snapping
     *  between them on the trigger reads as a stutter. */
    aim: 0,
  });
  const arsenal = useRef({
    inventory: freshInventory(),
    owned: new Set<WeaponKind>(['pistol']),
    byWeapon: { pistol: 0, rifle: 0, grenade: 0 } as Record<WeaponKind, number>,
    cooldown: 0,
    reloading: 0,
    recoil: 0,
  });
  const fx = useRef<{ effects: TimedEffect[] }>({ effects: [] });
  const run = useRef({
    elapsed: 0,
    message: { observed: '', timer: 0 },
  });

  /** Put the player somewhere outright — a spawn, a respawn, the hero frame.
   *  A kinematic body only moves where it is told, so the body and the mirror
   *  have to be set together. */
  function teleport(x: number, y: number, z: number): void {
    here.current.set(x, y, z);
    body.current?.setTranslation(here.current, true);
    body.current?.setNextKinematicTranslation(here.current);
    motion.current.verticalVelocity = 0;
    motion.current.grounded = true;
  }

  function disposeEffect(effect: TimedEffect): void {
    scene.remove(effect.object);
    if (!(effect.object instanceof THREE.Mesh)) return;
    effect.object.geometry.dispose();
    const materials = Array.isArray(effect.object.material)
      ? effect.object.material
      : [effect.object.material];
    for (const material of materials) material.dispose();
  }

  function syncWeaponModel(weapon: WeaponKind): void {
    for (const kind of WEAPON_ORDER) {
      const node = rig.current?.getObjectByName(`${kind}-viewmodel`);
      if (node) node.visible = kind === weapon;
    }
  }

  function selectWeapon(weapon: WeaponKind): void {
    const ammo = arsenal.current.inventory[weapon];
    setArenaState({
      weapon,
      ammo: ammo.magazine,
      reserveAmmo: ammo.reserve,
      ownedWeapons: WEAPON_ORDER.filter((kind) => arsenal.current.owned.has(kind)),
    });
    syncWeaponModel(weapon);
  }

  function restart(): void {
    resetArenaState();
    arsenal.current.inventory = freshInventory();
    arsenal.current.owned = new Set<WeaponKind>(['pistol']);
    intent.current.shots = 0;
    for (const kind of WEAPON_ORDER) arsenal.current.byWeapon[kind] = 0;
    arsenal.current.cooldown = 0;
    arsenal.current.reloading = 0;
    run.current.message = { observed: '', timer: 0 };
    look.current.yaw = 0;
    look.current.pitch = -0.02;
    motion.current.verticalVelocity = 0;
    motion.current.grounded = true;
    for (const effect of fx.current.effects) disposeEffect(effect);
    fx.current.effects.length = 0;
    if (spawn.current) teleport(spawn.current.x, spawn.current.y, spawn.current.z);
    if (rig.current) rig.current.rotation.y = 0;
    syncWeaponModel('pistol');
    // A scene-wide broadcast: every bot publishes its own reset, so a match can
    // be restarted from one place.
    scene.traverse((object) => {
      object.userData['cooldown'] = 0;
      if (object.userData['weaponPickup']) object.visible = true;
      const reset = object.userData['resetArenaBot'];
      if (typeof reset === 'function') reset();
    });
    logArenaEvent('arena.match-restarted', { weapon: 'pistol' });
  }

  // Pointer lock targets the canvas this world renders into.
  useEffect(() => {
    if (!input) return;
    const onClick = () => input.requestPointerLock(canvas);
    canvas.addEventListener('click', onClick);
    return () => {
      canvas.removeEventListener('click', onClick);
      if (typeof document !== 'undefined' && document.pointerLockElement === canvas)
        document.exitPointerLock();
    };
  }, [canvas, input]);

  useEffect(() => {
    const live = fx.current.effects;
    return () => {
      for (const effect of live) disposeEffect(effect);
      live.length = 0;
      // No audio teardown here: `useGameSfx` closes the context it opened.
    };
  }, []);

  // The steps of the frame callback below, in the order it calls them.

  function tickTimers(dt: number): void {
    run.current.elapsed += dt;
    arsenal.current.cooldown = Math.max(0, arsenal.current.cooldown - dt);
    arsenal.current.recoil = Math.max(0, arsenal.current.recoil - dt * 8.5);
    look.current.shake = stepShake(look.current.shake, dt);
    // Zero unless applyMovement runs below — a paused or dead frame reads as
    // standing, so the avatar never moonwalks.
    intent.current.speed = 0;
  }

  /** HUD messages, the hit marker and the damage pulse, all decaying. */
  function tickTransientState(dt: number): void {
    let state = getArenaState();
    if (state.message !== run.current.message.observed) {
      run.current.message.observed = state.message;
      if (state.message && state.message !== 'RESPAWNING') run.current.message.timer = 1.25;
    }
    if (run.current.message.timer > 0) {
      run.current.message.timer = Math.max(0, run.current.message.timer - dt);
      if (run.current.message.timer === 0 && state.message === run.current.message.observed) {
        run.current.message.observed = '';
        setArenaState({ message: '' });
      }
    }
    state = getArenaState();
    if (state.hitMarker > 0) setArenaState({ hitMarker: Math.max(0, state.hitMarker - dt * 5.5) });
    if (state.damagePulse > 0) {
      // The pulse IS the shake. The old `Math.max(shake, damagePulse)` pinned a
      // scalar to the vignette every frame, so re-arming from the live pulse
      // reproduces it exactly: intensity is the SQUARED pulse because the old
      // amount was `shake * shake * amplitude`, and `shakeOffset` puts that
      // square in the falloff instead.
      look.current.shake = shake(
        look.current.shake,
        state.damagePulse * state.damagePulse,
        state.damagePulse / DAMAGE_PULSE_DECAY,
      );
      setArenaState({
        damagePulse: Math.max(0, state.damagePulse - dt * DAMAGE_PULSE_DECAY),
      });
    }
  }

  /** Has a grenade of this size touched the arena? Asked of the physics world
   *  itself, so a grenade lands on whatever is actually under it — a ramp, a
   *  deck, the bridge — with no second description of the level to maintain. */
  function hitArena(at: THREE.Vector3, radius: number): boolean {
    return (
      world.intersectionWithShape(
        at,
        IDENTITY_ROTATION,
        new rapier.Ball(radius),
        undefined,
        undefined,
        undefined,
        body.current ?? undefined,
      ) !== null
    );
  }

  /** Tracers, bursts, and grenades in flight (which damage on contact). */
  function tickEffects(dt: number): void {
    for (let index = fx.current.effects.length - 1; index >= 0; index -= 1) {
      const effect = fx.current.effects[index];
      if (!effect) continue;
      effect.life -= dt;
      if (effect.velocity) {
        if (effect.grenade) effect.velocity.y -= 8.5 * dt;
        effect.object.position.addScaledVector(effect.velocity, dt);
      }
      if (effect.grenade) {
        const contact = nearestBot(scene, effect.object.position, 1.15);
        if (contact || hitArena(effect.object.position, 0.22) || effect.life <= 0) {
          let hits = 0;
          scene.traverse((object) => {
            if (object.userData['arenaBot'] !== true || object.userData['dead'] === true) return;
            const distance = object
              .getWorldPosition(new THREE.Vector3())
              .distanceTo(effect.object.position);
            if (distance > 4.5) return;
            if (damageBot(object, 110 * (1 - distance / 4.5) + 25)) hits += 1;
          });
          if (hits > 0) setArenaState({ hitMarker: 1 });
          const burst = new THREE.Mesh(
            new THREE.IcosahedronGeometry(0.72, 1),
            new THREE.MeshBasicMaterial({ color: '#ff9a28', transparent: true, opacity: 0.82 }),
          );
          burst.name = 'GrenadeBurst';
          burst.position.copy(effect.object.position);
          scene.add(burst);
          fx.current.effects.push({ object: burst, life: 0.16 });
          playTone(54, 0.18, 0.065, 36);
          logArenaEvent('arena.grenade-exploded', {
            hits,
            position: effect.object.position.toArray(),
          });
          effect.life = 0;
        }
      }
      if (effect.life > 0) continue;
      disposeEffect(effect);
      fx.current.effects.splice(index, 1);
    }
  }

  /**
   * The first-person view model — the arms-length weapon and its muzzle flash,
   * parented to the camera.
   *
   * It is hidden outright in third person, where the same weapon is already on
   * screen in the character's hands and a second copy would hang in front of
   * the lens. Hidden rather than unmounted: the group is the camera's child and
   * its bob is a pure function of the clock, so it costs nothing while
   * invisible and comes back mid-stride with no rebuild.
   */
  function updateViewModel(node: THREE.Object3D): void {
    const shown = getPerspective() === 'first';
    const viewModel = node.getObjectByName('WeaponViewModel');
    if (viewModel) {
      const bob = motion.current.grounded ? Math.sin(run.current.elapsed * 10.5) * 0.006 : 0;
      viewModel.position.x = VIEWMODEL_REST.x + Math.cos(run.current.elapsed * 5.25) * 0.004;
      viewModel.position.y = VIEWMODEL_REST.y + Math.abs(bob);
      viewModel.position.z = VIEWMODEL_REST.z + arsenal.current.recoil * 0.09;
      viewModel.rotation.x = 0.025 + arsenal.current.recoil * 0.055;
      viewModel.visible = shown && getArenaState().respawnRemaining <= 0;
    }
    const muzzle = node.getObjectByName('MuzzleFlash');
    if (muzzle) {
      muzzle.visible = shown && arsenal.current.recoil > 0.66;
      muzzle.rotation.z = run.current.elapsed * 11;
      muzzle.scale.setScalar(0.8 + arsenal.current.recoil * 0.55);
    }
  }

  /** The death timer, and the respawn at the end of it. */
  function tickRespawn(dt: number): void {
    const state = getArenaState();
    if (state.respawnRemaining <= 0) {
      setArenaState({ health: 0, respawnRemaining: 1.25, message: 'RESPAWNING' });
      logArenaEvent('arena.player-defeated', { deaths: state.deaths });
      return;
    }
    const remaining = Math.max(0, state.respawnRemaining - dt);
    if (remaining > 0) {
      setArenaState({ respawnRemaining: remaining });
      return;
    }
    teleport(0, EYE_HEIGHT, 24);
    setArenaState({
      health: 100,
      deaths: state.deaths + 1,
      respawnRemaining: 0,
      message: 'RESPAWNED',
    });
    logArenaEvent('arena.player-respawned', { deaths: state.deaths + 1 });
  }

  /** Mouse and stick look — the ONE aim path, whether a human or the game's
   *  own bot is holding the controls. */
  function applyLook(node: THREE.Object3D, view: THREE.PerspectiveCamera, dt: number): void {
    if (!input) return;
    const pointer = input.getPointerDelta('look');
    const stick = input.getVector2('look_stick');
    look.current.yaw -= pointer.x * LOOK_SENSITIVITY + stick.x * dt * 2.65;
    look.current.pitch = THREE.MathUtils.clamp(
      look.current.pitch - pointer.y * 0.0019 - stick.y * dt * 2.2,
      -1.22,
      1.15,
    );
    node.rotation.y = look.current.yaw;
    // The rig's yaw is the same in both perspectives — the character faces
    // where you look, and so does the shot. Only where the LENS sits differs,
    // and `frameCamera` below places it.
    if (getPerspective() === 'third') return;
    const kick = shakeOffset(look.current.shake, run.current.elapsed, SHAKE_FEEL);
    view.rotation.x = look.current.pitch + kick.pitch;
    view.rotation.z = kick.roll;
  }

  /**
   * Place the camera for the perspective in force, at the eye or on a boom
   * behind the shoulder.
   *
   * Called on EVERY frame the player owns — paused, dead and alive alike — so
   * the view never freezes mid-orbit, and called AFTER `applyLook` so the boom
   * solves against the yaw and pitch just set.
   *
   * `view` is a child of the yawed rig in both perspectives (see the comment on
   * the constants at the top of this file for why the boom is nevertheless
   * solved in world space). `node` is that rig.
   */
  function frameCamera(node: THREE.Object3D, view: THREE.PerspectiveCamera, dt: number): void {
    const perspective = getPerspective();
    if (perspective === 'first') {
      if (boom.current.placedFor !== 'first') {
        // Back to the eye, in one frame — this is a cut, not a dolly.
        view.position.set(0, 0, 0);
        view.fov = fov;
        view.updateProjectionMatrix();
        boom.current.placedFor = 'first';
      }
      return;
    }

    const { yaw, pitch } = look.current;
    const target = here.current.clone().setY(here.current.y - BOOM_TARGET_DROP);
    const forward = new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    ).normalize();
    const right = new THREE.Vector3().crossVectors(forward, UP).normalize();
    boom.current.aim = stepAimBlend(boom.current.aim, input?.isPressed('fire') === true, dt);
    const framing = frameAim(HIP_FRAMING, AIM_FRAMING, boom.current.aim);
    const desired = target
      .clone()
      .addScaledVector(forward, -framing.distance)
      .addScaledVector(right, framing.shoulder);
    desired.y += framing.height + arsenal.current.recoil * 0.04;
    // A boom that clips through the arena's walls is the oldest bug in the
    // genre. One ray from the chest to where the boom wants to sit, and the
    // camera stops in front of whatever is in the way — lerped toward like any
    // other desired point, so a wall passing behind never teleports the view.
    const self = body.current?.collider(0);
    const clear = pullInBoom({
      desired,
      rapier,
      target,
      world,
      // Omitted rather than passed as `undefined`: this project compiles with
      // `exactOptionalPropertyTypes`, so an absent collider is an absent key.
      ...(self ? { exclude: self } : {}),
    });
    if (boom.current.placedFor !== 'third') {
      boom.current.at.set(clear.x, clear.y, clear.z);
      boom.current.placedFor = 'third';
    } else {
      boom.current.at.lerp(desired.set(clear.x, clear.y, clear.z), BOOM_FOLLOW);
    }

    // World → the rig's own frame, which is where the camera's transform is
    // read. The rig's yaw was written this frame and its world matrix is a
    // frame stale, so refresh it before inverting.
    node.updateWorldMatrix(true, false);
    view.position.copy(node.worldToLocal(boom.current.at.clone()));
    view.lookAt(target.addScaledVector(forward, BOOM_CONVERGENCE));
    if (Math.abs(view.fov - framing.fov) > 0.01) {
      view.fov = THREE.MathUtils.damp(view.fov, framing.fov, 12, dt);
      view.updateProjectionMatrix();
    }
    // The damage shake is one axis out here — a local roll applied AFTER
    // `lookAt`, which replaces the camera's rotation outright.
    view.rotateZ(
      shakeOffset(look.current.shake, run.current.elapsed, THIRD_PERSON_SHAKE_FEEL).pitch,
    );
  }

  /** Planar movement along the yaw just set, jump pads, and gravity — all of it
   *  handed to Rapier's character controller, which is what decides where the
   *  capsule actually ends up against the arena's colliders. */
  function applyMovement(dt: number): void {
    if (!input) return;
    if (!body.current?.collider(0)) return;
    const move = computeArenaMove(
      {
        forward: input.isPressed('move_forward'),
        backward: input.isPressed('move_backward'),
        left: input.isPressed('move_left'),
        right: input.isPressed('move_right'),
      },
      input.getVector2('move_stick'),
      look.current.yaw,
    );
    const rate = input.isPressed('sprint') ? sprintSpeed : speed;
    intent.current.speed = Math.min(1, Math.hypot(move.x, move.z)) * rate;

    // WHICH launch fires is the capability's decision — a manual jump beats a
    // pad the player happens to be standing on, and neither fires airborne.
    // The tone and the telemetry stay here: they were never the same between
    // this game and third-person, which is why the capability hands back the
    // launch instead of applying it.
    const launch = resolveLaunch({
      grounded: motion.current.grounded,
      jumpPressed: input.isJustPressed('jump'),
      jumpVelocity,
      padVelocity: JUMP_PAD_VELOCITY,
      pads: readJumpPadPositions(scene, jumpPads.current),
      position: here.current,
    });
    if (launch) {
      const pad = launch.source === 'jump-pad';
      motion.current.verticalVelocity = launch.verticalVelocity;
      motion.current.grounded = false;
      playTone(pad ? 390 : 190, pad ? 0.16 : 0.06, pad ? 0.045 : 0.028, pad ? 740 : 280);
      logArenaEvent(pad ? 'arena.jump-pad-launched' : 'arena.player-jumped', {
        position: here.current.toArray(),
        velocity: launch.verticalVelocity,
      });
    }

    const stepped = advance(
      here.current,
      { x: move.x * rate, z: move.z * rate },
      motion.current.verticalVelocity,
      dt,
    );
    if (!stepped) return;
    motion.current.verticalVelocity = stepped.verticalVelocity;
    motion.current.grounded = stepped.grounded;
  }

  function updatePickups(node: THREE.Object3D, dt: number): void {
    const here = node.getWorldPosition(new THREE.Vector3());
    scene.traverse((object) => {
      const weapon = object.userData['weaponPickup'] as WeaponKind | undefined;
      if (!weapon) return;
      const remaining = Math.max(0, Number(object.userData['cooldown'] ?? 0) - dt);
      object.userData['cooldown'] = remaining;
      object.visible = remaining === 0;
      if (remaining > 0) return;
      if (object.getWorldPosition(new THREE.Vector3()).distanceTo(here) > 1.8) return;
      const first = !arsenal.current.owned.has(weapon);
      arsenal.current.owned.add(weapon);
      arsenal.current.inventory[weapon] = {
        magazine: WEAPON_CAPACITY[weapon],
        reserve: WEAPON_PICKUP_AMMO[weapon],
      };
      selectWeapon(weapon);
      setArenaState({
        message: first ? `${weapon.toUpperCase()} ACQUIRED` : `${weapon.toUpperCase()} AMMO`,
      });
      object.userData['cooldown'] = 12;
      object.visible = false;
      playTone(520, 0.16, 0.04, 880);
      logArenaEvent('arena.weapon-picked-up', {
        weapon,
        firstPickup: first,
        ownedWeapons: WEAPON_ORDER.filter((kind) => arsenal.current.owned.has(kind)),
      });
    });
  }

  /** Weapon switch, reload, and the shot itself — cast down the camera the
   *  look step just aimed. */
  function updateWeapon(node: THREE.Object3D, view: THREE.PerspectiveCamera, dt: number): void {
    if (!input) return;
    let state = getArenaState();
    if (input.isJustPressed('weapon_swap')) {
      const list = WEAPON_ORDER.filter((weapon) => arsenal.current.owned.has(weapon));
      if (list.length < 2) setArenaState({ message: 'FIND A WEAPON PICKUP' });
      else {
        const weapon = list[(list.indexOf(getArenaState().weapon) + 1) % list.length] ?? 'pistol';
        selectWeapon(weapon);
        setArenaState({
          message: weapon === 'grenade' ? 'GRENADE LAUNCHER' : weapon.toUpperCase(),
        });
        logArenaEvent('arena.weapon-switched', { weapon, ownedWeapons: list });
      }
    }

    state = getArenaState();
    const ammo = arsenal.current.inventory[state.weapon];
    const spec = WEAPONS[state.weapon];

    if (arsenal.current.reloading > 0) {
      arsenal.current.reloading -= dt;
      if (arsenal.current.reloading <= 0) {
        const loaded = Math.min(WEAPON_CAPACITY[state.weapon] - ammo.magazine, ammo.reserve);
        ammo.magazine += loaded;
        ammo.reserve -= loaded;
        setArenaState({ ammo: ammo.magazine, reserveAmmo: ammo.reserve, message: '' });
        logArenaEvent('arena.reload-complete', {
          weapon: state.weapon,
          ammo: ammo.magazine,
          reserveAmmo: ammo.reserve,
        });
      }
      return;
    }

    if (
      input.isJustPressed('reload') &&
      ammo.magazine < WEAPON_CAPACITY[state.weapon] &&
      ammo.reserve > 0
    ) {
      arsenal.current.reloading = spec.reload;
      setArenaState({ message: 'RELOADING' });
      logArenaEvent('arena.reload-started', { weapon: state.weapon });
      return;
    }

    if (!input.isPressed('fire') || arsenal.current.cooldown > 0) return;

    if (ammo.magazine <= 0) {
      arsenal.current.cooldown = 0.2;
      setArenaState({ message: ammo.reserve > 0 ? 'RELOAD' : 'OUT OF AMMO' });
      playTone(80, 0.035, 0.018);
      return;
    }

    ammo.magazine -= 1;
    setArenaState({ ammo: ammo.magazine, reserveAmmo: ammo.reserve, message: '' });
    arsenal.current.recoil = 1;
    intent.current.shots += 1;
    arsenal.current.cooldown = spec.cooldown;
    const origin = view.getWorldPosition(new THREE.Vector3());
    const direction = view.getWorldDirection(new THREE.Vector3());
    if (state.weapon === 'grenade') {
      const grenade = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.16, 1),
        new THREE.MeshStandardMaterial({
          color: '#ef8618',
          emissive: '#7d2d00',
          emissiveIntensity: 0.9,
          roughness: 0.42,
        }),
      );
      grenade.name = 'GrenadeProjectile';
      grenade.position.copy(origin).addScaledVector(direction, 0.9);
      scene.add(grenade);
      fx.current.effects.push({
        object: grenade,
        life: 2.4,
        velocity: direction.clone().multiplyScalar(22),
        grenade: true,
      });
    } else {
      const raycaster = new THREE.Raycaster(origin, direction);
      raycaster.far = HITSCAN_RANGE;
      const hit = raycaster.intersectObjects(scene.children, true).find((entry) => {
        let current: THREE.Object3D | null = entry.object;
        while (current) {
          if (current === node) return false;
          current = current.parent;
        }
        return true;
      });
      const end = hit?.point ?? origin.clone().addScaledVector(direction, HITSCAN_RANGE);
      if (hit && damageBot(hit.object, spec.damage)) setArenaState({ hitMarker: 1 });
      // The SHOT is cast down the camera in both perspectives — identical
      // range, identical hit, one game. The TRACER is drawn from where the
      // weapon visibly is, which in third person is the character's chest and
      // not a point four and a half metres behind their back.
      const from =
        getPerspective() === 'first'
          ? origin
          : node.getWorldPosition(new THREE.Vector3()).setY(here.current.y - TRACER_MUZZLE_DROP);
      const tracer = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.025, from.distanceTo(end), 6),
        new THREE.MeshBasicMaterial({ color: spec.tracer, transparent: true, opacity: 0.82 }),
      );
      tracer.name = 'WeaponTracer';
      tracer.position.copy(from).lerp(end, 0.5);
      tracer.quaternion.setFromUnitVectors(UP, end.clone().sub(from).normalize());
      scene.add(tracer);
      fx.current.effects.push({ object: tracer, life: 0.065 });
    }
    playTone(spec.tone[0], spec.tone[1], spec.tone[2], spec.tone[3]);
    // Per-weapon shot counts are published on `arena.player` — the arsenal
    // route's proof that every weapon it collected actually fired.
    arsenal.current.byWeapon[state.weapon] += 1;
    logArenaEvent('arena.fire', { weapon: state.weapon, ammo: ammo.magazine });
  }

  // −2: everything the player DOES, in the order it happens. The avatar
  // animates from the result at the default 0 inside <PlayerBody>.
  useFrame((_, dt) => {
    const node = rig.current;
    const view = camera.current;
    const rigidBody = body.current;
    if (!input || !node || !view || !rigidBody) return;
    // The body is where the player is; read it back before anything asks.
    here.current.copy(rigidBody.translation() as THREE.Vector3Like);
    spawn.current ??= here.current.clone();
    view.rotation.order = 'YXZ';

    tickTimers(dt);
    tickTransientState(dt);
    tickEffects(dt);
    updateViewModel(node);

    if (input.isJustPressed('pause')) toggleArenaPause();
    if (input.isJustPressed('restart')) restart();
    // The perspective toggle sits with pause and restart, ABOVE the paused and
    // dead returns: which camera you are watching from is not a move, and a
    // player who paused to look at the arena gets to look at it from either
    // one. `frameCamera` below is on the same side of the returns, for the
    // same reason.
    if (input.isJustPressed('perspective')) {
      logArenaEvent('arena.perspective-changed', { perspective: togglePerspective() });
    }

    const state = getArenaState();
    const playing = !state.paused && state.health > 0 && state.respawnRemaining <= 0;
    if (playing) {
      applyLook(node, view, dt);
      applyMovement(dt);
    }
    // AFTER the look, so the boom solves against the yaw and pitch just set,
    // and OUTSIDE the `playing` gate, so a paused, dead or respawning frame
    // still resolves occlusion and still honours a perspective toggle.
    frameCamera(node, view, dt);
    if (!playing) {
      if (!state.paused) tickRespawn(dt);
      return;
    }

    updatePickups(node, dt);
    updateWeapon(node, view, dt);
  }, -2);

  /**
   * Publish the live player behind the exported functions at the bottom of this
   * file, for as long as this component is mounted. Every function closes over
   * the refs the frame callback already writes, so nothing here is a second
   * copy of the arsenal — and unmount is the one teardown path.
   */
  useEffect(() => {
    playerView = {
      read: () => ({
        position: here.current.toArray(),
        yaw: look.current.yaw,
        pitch: look.current.pitch,
        // Which camera this is being played from, and where that camera
        // actually ended up in the WORLD. The pair is the only honest read of
        // the perspective: `perspective` is the intent, `cameraPosition` is
        // what the boom solved to after occlusion — in first person it is the
        // eye, in third it is metres behind it, and a boom pulled in by a wall
        // shows up here and nowhere else.
        perspective: getPerspective(),
        cameraPosition: (
          camera.current?.getWorldPosition(new THREE.Vector3()) ?? here.current
        ).toArray(),
        grounded: motion.current.grounded,
        verticalVelocity: motion.current.verticalVelocity,
        shotCooldown: arsenal.current.cooldown,
        reloading: arsenal.current.reloading,
        jumpPads: readJumpPadPositions(scene, jumpPads.current).map(({ x, z }) => ({ x, z })),
        shotsByWeapon: { ...arsenal.current.byWeapon },
        ...getArenaState(),
      }),
      restart: () => restart(),
      setHostilities: (enabled) => {
        setArenaState({ enemyFire: enabled, message: enabled ? '' : 'HOSTILES HOLDING FIRE' });
        logArenaEvent('arena.hostilities-set', { enabled });
      },
      poseThumbnail: () => {
        restart();
        const node = rig.current;
        const view = camera.current;
        teleport(...HERO.player);
        if (node) node.rotation.y = HERO.yaw;
        look.current.yaw = HERO.yaw;
        look.current.pitch = HERO.pitch;
        if (view) {
          view.rotation.x = HERO.pitch;
          view.fov = HERO.fov;
          view.updateProjectionMatrix();
        }
        setArenaState({
          health: 100,
          kills: 3,
          ammo: 9,
          reserveAmmo: 48,
          weapon: 'pistol',
          ownedWeapons: ['pistol'],
          message: '',
        });
        for (const [name, position] of Object.entries(HERO.enemies)) {
          const enemy = scene.getObjectByName(name);
          const place = enemy?.userData['placeArenaBot'];
          if (typeof place !== 'function') {
            throw new Error(`Thumbnail presentation requires ${name}`);
          }
          place(position);
        }
        logArenaEvent('arena.thumbnail-presentation-ready', {
          player: here.current.toArray(),
          weapon: 'pistol',
        });
      },
    };
    return () => {
      playerView = null;
    };
  }, []);

  return (
    // The body is kinematic: gameplay decides where the player goes, physics
    // decides what stops them getting there. Its origin is the EYE, so the JSX
    // position still reads as eye height and the capsule hangs below it.
    <RigidBody {...groupProps} ref={body} type="kinematicPosition" colliders={false}>
      <CapsuleCollider
        args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]}
        position={[0, -(EYE_HEIGHT - CAPSULE_RADIUS - CAPSULE_HALF_HEIGHT), 0]}
      />
      {/* Yaw lives here, not on the body: Rapier owns the body's transform and
          would overwrite a rotation written onto it. */}
      <group ref={rig}>
        <PerspectiveCamera
          makeDefault
          ref={camera}
          name="PlayerCamera"
          fov={fov}
          near={0.045}
          far={220}
        >
          <PlayerViewModel
            name="WeaponViewModel"
            position={[0.52, -0.5, -1.08]}
            rotation={[0.025, -0.07, 0]}
          />
        </PerspectiveCamera>
        {/* The rig origin is the EYE; the body stands at the feet. */}
        <PlayerBody name="PlayerBody" position={[0, -EYE_HEIGHT, 0]} intent={intent} />
      </group>
    </RigidBody>
  );
}

// --- Driving and reading the player ------------------------------------------
//
// Ordinary exported functions over the live `<Player>`, reached from the REPL as
// `game.run(async ({ modules }) => (await modules('src/prefabs/Player.tsx')).arenaPlayerState())`
// and from any editor contribution this game writes (`src/tools/`).
//
// What `arenaPlayerState()` carries that the first-person camera CANNOT show
// you: from inside the helmet there is no body to watch, so `shotCooldown`
// (holding `fire` on a pistol does nothing for 0.31 s at a time, with no tell —
// this is why the trigger felt dead), `reloading` (entirely off-screen; the view
// model does not animate it), `grounded` (a solver result, not a look: a player
// a centimetre off a ramp lip renders identically to one standing on it, and the
// difference is whether `jump` will do anything) and `verticalVelocity` (the
// only way to tell a pad launch from a jump from a fall) have no tell at all.

/** The whole live player in one read, or `null` before the arena mounts one. */
export function arenaPlayerState(): Record<string, unknown> | null {
  return playerView?.read() ?? null;
}

/** Restart the match: full health, one pistol, hostiles re-armed. */
export function restartArena(): void {
  playerView?.restart();
}

/**
 * Arm or disarm every hostile. Disarming buys a quiet arena to cross, which is
 * what a collection run needs and what the tester's arsenal behavior asks for
 * (`src/bot/behaviors.ts`); `restartArena()` re-arms them, so nothing has to
 * remember to put it back.
 */
export function setArenaHostilities(enabled: boolean): void {
  playerView?.setHostilities(enabled);
}

/** Pose the arena for its catalog thumbnail — hero position, hero framing,
 *  hostiles placed. */
export function poseArenaThumbnail(): void {
  playerView?.poseThumbnail();
}

/**
 * Play from the other camera — the `V` key's own door, re-exported here so a
 * caller holding `arenaPlayerState()` has the setter beside the reading:
 *
 *   game.run(async ({ modules }) => {
 *     const player = await modules('src/prefabs/Player.tsx');
 *     player.setArenaPerspective('third');
 *     return player.arenaPlayerState();
 *   })
 *
 * It takes effect on the next frame the player owns, whether or not one is
 * mounted, because the perspective belongs to the GAME and not to this
 * component — a perspective chosen before Play begins is the perspective Play
 * begins in.
 */
export {
  getPerspective as arenaPerspective,
  setPerspective as setArenaPerspective,
} from '../perspective';
