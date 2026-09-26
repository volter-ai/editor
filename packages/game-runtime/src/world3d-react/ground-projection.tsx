/**
 * General Three/R3F supply for a moving flat projection found by a caller-owned ray query.
 *
 * The quad's X/Z extent and projection reach are LOCAL. The ray is WORLD-space. The conversion is
 * the length of `matrixWorld`'s Y basis column; its direction is also the object's projected -Y.
 * That remains exact through ancestor non-uniform scale and shear because a local-Y displacement
 * is precisely that column times the displacement. The hit distance crosses back through the same
 * scale before writing the child mesh's local Y. A zero-length column hides the collapsed box.
 *
 * This helper deliberately knows no physics engine or source-engine decal policy. The caller's
 * `castRay` chooses the query world and exclusions, returning only a native world-space distance.
 * The result stays a real R3F group containing a real Three mesh and material.
 */
import { useTexture } from '@react-three/drei';
import { type ThreeElements, useFrame } from '@react-three/fiber';
import { type Ref, useRef } from 'react';
import { type Group, type Mesh, type Texture, Vector3 } from 'three';

export type GroundProjectionRaycast = (
  origin: Vector3,
  direction: Vector3,
  maxDistance: number,
) => number | null;

export type GroundProjectedQuadProps = Omit<ThreeElements['group'], 'ref'> & {
  /** The real Three group this projection owns, for source-engine bindings such as node groups. */
  readonly anchorRef?: Ref<Group>;
  readonly textureUrl: string;
  readonly configureTexture?: (texture: Texture) => Texture;
  readonly size: readonly [number, number, number];
  readonly color: string;
  readonly opacity: number;
  readonly castRay: GroundProjectionRaycast;
  /** World-space stand-off from the receiver, preventing depth fighting. */
  readonly lift?: number;
};

const WORLD = new Vector3();
const DOWN = new Vector3();
const ORIGIN = new Vector3();

export function GroundProjectedQuad({
  textureUrl,
  configureTexture,
  size,
  color,
  opacity,
  castRay,
  anchorRef,
  lift = 0.002,
  children,
  ...groupProps
}: GroundProjectedQuadProps): React.JSX.Element {
  const anchor = useRef<Group>(null);
  const quad = useRef<Mesh>(null);
  const loadedTexture = useTexture(textureUrl);
  const texture = configureTexture?.(loadedTexture) ?? loadedTexture;
  const [sizeX, sizeY, sizeZ] = size;
  const setAnchor = (group: Group | null): void => {
    anchor.current = group;
    if (typeof anchorRef === 'function') anchorRef(group);
    else if (anchorRef !== null && anchorRef !== undefined) anchorRef.current = group;
  };

  useFrame(() => {
    const group = anchor.current;
    const mesh = quad.current;
    if (group === null || mesh === null) return;
    group.getWorldPosition(WORLD);
    const matrix = group.matrixWorld.elements;
    DOWN.set(-(matrix[4] as number), -(matrix[5] as number), -(matrix[6] as number));
    const scaleY = DOWN.length();
    if (scaleY === 0) {
      mesh.visible = false;
      return;
    }
    DOWN.divideScalar(scaleY);
    const reach = sizeY * scaleY;
    ORIGIN.copy(WORLD).addScaledVector(DOWN, -reach / 2);
    const distance = castRay(ORIGIN, DOWN, reach);
    if (distance === null) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    mesh.position.set(0, sizeY / 2 - (distance - lift) / scaleY, 0);
  });

  return (
    <group {...groupProps} ref={setAnchor}>
      <mesh ref={quad} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
        <planeGeometry args={[sizeX, sizeZ]} />
        <meshBasicMaterial
          map={texture}
          color={color}
          transparent
          opacity={opacity}
          depthWrite={false}
          toneMapped={false}
          polygonOffset
          polygonOffsetFactor={-4}
          polygonOffsetUnits={-4}
        />
      </mesh>
      {children}
    </group>
  );
}
