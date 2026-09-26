import { useGLTF } from '@react-three/drei/core/Gltf';
import type { ThreeElements } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import type { WeaponKind } from '../arena-state';

/** The baked arena weapons. Authored −Z barrel at 1/0.35 of true size with the
 *  grip at the origin — see `ARENA_WEAPON_ITEM_GRIP` in Enemy.tsx. */
export const WEAPON_PATHS: Record<WeaponKind, string> = {
  pistol: '/models/generated/arena-pistol.glb',
  rifle: '/models/generated/arena-rifle.glb',
  grenade: '/models/generated/arena-grenade-launcher.glb',
};

/**
 * A prefab is INSTANTIATED BY THE EDITOR, which has no type checker.
 *
 * Dropping this component from the Prefabs browser writes `<WeaponModel name=… />`
 * and nothing else — no `kind` — so this lookup missed, `useGLTF` was handed
 * `undefined`, and `LoaderUtils.extractUrlBase` threw before the fiber tree's
 * FIRST COMMIT. That does not break one prefab: it takes the whole world down,
 * and because the source is already written the project stays dead across
 * reloads (runhuman pass 97 lost a project to exactly this).
 *
 * So the discriminator is checked BEFORE any hook runs, in a wrapper that
 * holds none. An unknown value renders nothing and says so by name — the
 * anti-shim answer, and the one that leaves every sibling in the scene alive.
 * The hooks all live in the inner component, which mounts as a unit, so the
 * hook count never varies for a mounted element.
 */
export function WeaponModel(props: Parameters<typeof WeaponModelBody>[0]) {
  if (props.kind === undefined || !(props.kind in WEAPON_PATHS)) {
    console.warn(
      `[WeaponModel] no such kind ${JSON.stringify(props.kind)} — expected one of ` +
        `${Object.keys(WEAPON_PATHS).join(', ')}. Rendering nothing; set kind in the Inspector.`,
    );
    return null;
  }
  return <WeaponModelBody {...props} />;
}

/** One story-backed weapon prefab. Geometry is cloned per instance; MATERIALS are shared
 *  on purpose — every rifle in the arena is the same steel, and the enemy hit
 *  flash drives the skinned body's emissive, never the weapon's. */
function WeaponModelBody({ kind, ...groupProps }: ThreeElements['group'] & { kind: WeaponKind }) {
  const source = useGLTF(WEAPON_PATHS[kind]);
  const instanceName = groupProps.name ?? kind;
  const model = useMemo(() => {
    const next = source.scene.clone(true);
    next.name = `${instanceName}Model`;
    next.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    return next;
  }, [instanceName, source.scene]);
  return (
    <group {...groupProps}>
      <primitive object={model} />
      {groupProps.children}
    </group>
  );
}
