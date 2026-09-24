import { RoundedBoxGeometry } from '@react-three/drei/core/RoundedBox';
import type { ThreeElements } from '@react-three/fiber';

export type HeroBoxProps = Omit<ThreeElements['mesh'], 'args' | 'children' | 'ref'> & {
  color?: string;
};

/**
 * The neutral focal-object prefab: one independently placeable thing a
 * designer can find in Content, duplicate, and reuse. Its colocated story is
 * the registration. Keep construction pieces that only make sense as part of
 * this object inside this owner; do not promote its geometry or material into
 * primitive-sized prefabs. Replace the subject, not this distinction.
 */
export function HeroBox({ color = '#c8dce1', name = 'Hero Box', ...props }: HeroBoxProps) {
  return (
    <mesh name={name} castShadow receiveShadow {...props}>
      <RoundedBoxGeometry
        args={[2.55, 2.55, 2.55]}
        radius={0.14}
        smoothness={8}
        bevelSegments={8}
      />
      <meshPhysicalMaterial
        color={color}
        roughness={0.24}
        metalness={0.06}
        clearcoat={0.36}
        clearcoatRoughness={0.2}
        sheen={0.18}
        sheenColor="#d9f2ff"
      />
    </mesh>
  );
}
