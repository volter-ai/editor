import type { ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';

export interface JumpPadPosition {
  x: number;
  z: number;
}

const worldPosition = new THREE.Vector3();

/** Read the live positions of the placed pad entities without allocating each frame. */
export function readJumpPadPositions(
  root: THREE.Object3D,
  target: JumpPadPosition[],
): JumpPadPosition[] {
  let index = 0;
  root.traverse((object) => {
    if (object.userData['jumpPad'] !== true) return;
    object.getWorldPosition(worldPosition);
    const position = target[index] ?? { x: 0, z: 0 };
    position.x = worldPosition.x;
    position.z = worldPosition.z;
    target[index] = position;
    index += 1;
  });
  target.length = index;
  return target;
}

export function JumpPad({ name = 'Jump Pad', ...props }: ThreeElements['group']) {
  return (
    <group name={name} {...props} userData={{ ...props.userData, jumpPad: true }}>
      <mesh name="Pad Base" castShadow receiveShadow>
        <cylinderGeometry args={[1.55, 1.72, 0.3, 32]} />
        <meshStandardMaterial color="#ef8b21" roughness={0.62} />
      </mesh>
      <mesh name="Pad Ring" position={[0, 0.17, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.62, 1.18, 32]} />
        <meshStandardMaterial
          color="#ffd08a"
          emissive="#ef8618"
          emissiveIntensity={0.22}
          roughness={0.5}
        />
      </mesh>
      {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((angle, index) => (
        <mesh
          key={angle}
          name={`Pad Mark ${index + 1}`}
          position={[Math.cos(angle) * 0.88, 0.19, Math.sin(angle) * 0.88]}
          rotation={[0, -angle, 0]}
        >
          <boxGeometry args={[0.16, 0.06, 0.44]} />
          <meshStandardMaterial color="#fff0cf" roughness={0.45} />
        </mesh>
      ))}
    </group>
  );
}
