import type { ThreeElements } from '@react-three/fiber';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type * as THREE from 'three';
import type { WeaponKind } from '../arena-state';
import { WeaponModel } from './WeaponModel';

export function WeaponPickup({
  kind,
  name = `${kind} Pickup`,
  ...props
}: ThreeElements['group'] & { kind: WeaponKind }) {
  const animatedVisual = useRef<THREE.Group>(null);
  useFrame((state, dt) => {
    if (!animatedVisual.current) return;
    animatedVisual.current.rotation.y += dt * 0.72;
    animatedVisual.current.position.y = Math.sin(state.clock.elapsedTime * 1.65) * 0.08;
  });
  return (
    <group name={name} {...props} userData={{ weaponPickup: kind }}>
      <group name="Animated Visual" ref={animatedVisual}>
        <mesh name="Pickup Ring" position={[0, -0.32, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.62, 0.92, 32]} />
          <meshStandardMaterial color="#ef8b21" roughness={0.62} />
        </mesh>
        <WeaponModel
          kind={kind}
          name={`${kind} Pickup Weapon`}
          scale={kind === 'pistol' ? 1.1 : 0.78}
        />
      </group>
    </group>
  );
}
