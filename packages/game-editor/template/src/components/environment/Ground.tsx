import type { ThreeElements } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type GroundProps = Omit<ThreeElements['group'], 'children'> & {
  size?: number;
  gridSize?: number;
  gridDivisions?: number;
  showGrid?: boolean;
};

/** World-units-per-cell at which a grid line counts as MAJOR (one per 5 cells at defaults). */
const MAJOR_LINE_EVERY = 10;

/** One merged geometry holding every X- and Z-aligned line of one weight tier. */
function buildGridLines(coordinates: number[], thickness: number, length: number) {
  // An empty class of lines (every line major, or none) must still be a
  // geometry: `mergeGeometries([])` reads the first entry's index and throws,
  // which took the whole world down from an inspector edit and persisted the
  // crash into source — a reload failed the same way (runhuman pass 48).
  if (coordinates.length === 0) return new THREE.BufferGeometry();
  const boxes: THREE.BufferGeometry[] = [];
  for (const coordinate of coordinates) {
    const alongZ = new THREE.BoxGeometry(thickness, 0.006, length);
    alongZ.translate(coordinate, 0, 0);
    const alongX = new THREE.BoxGeometry(length, 0.006, thickness);
    alongX.translate(0, 0, coordinate);
    boxes.push(alongZ, alongX);
  }
  const merged = mergeGeometries(boxes);
  for (const box of boxes) box.dispose();
  return merged;
}

/** Radial white→black gradient; as the surface's alphaMap it melts the floor's
 *  edge into the sky the way distance fog used to — but view-independently, so
 *  the soft horizon survives the Scene view's fog-neutral draw policy. */
function buildEdgeFadeTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(
      size / 2,
      size / 2,
      (size / 2) * 0.5,
      size / 2,
      size / 2,
      (size / 2) * 0.94,
    );
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(1, '#000000');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

/** The starter scene's floor assembly. It is scene support, not a placeable prefab. */
export function Ground({
  name = 'Ground',
  size = 180,
  gridSize = 80,
  gridDivisions = 40,
  showGrid = true,
  ...props
}: GroundProps) {
  const edgeFade = useMemo(() => buildEdgeFadeTexture(), []);
  useEffect(() => () => edgeFade.dispose(), [edgeFade]);

  // Every value here is authorable from the Inspector, including mid-edit
  // states (0, blank, negative): clamp to what a grid can be instead of
  // letting NaN or Infinity reach the geometry.
  const safeSize = Number.isFinite(size) && size > 0 ? size : 0.01;
  const safeGridSize = Number.isFinite(gridSize) && gridSize > 0 ? gridSize : 0.01;
  const safeDivisions =
    Number.isFinite(gridDivisions) && gridDivisions >= 1
      ? Math.min(Math.floor(gridDivisions), 400)
      : 1;
  const gridGeometries = useMemo(() => {
    const half = safeGridSize / 2;
    const spacing = safeGridSize / safeDivisions;
    const coordinates = Array.from({ length: safeDivisions + 1 }, (_, i) => -half + i * spacing);
    const isMajor = (c: number) => Math.abs(c % MAJOR_LINE_EVERY) < spacing / 2;
    return {
      major: buildGridLines(coordinates.filter(isMajor), 0.028, safeGridSize),
      minor: buildGridLines(
        coordinates.filter((c) => !isMajor(c)),
        0.014,
        safeGridSize,
      ),
    };
  }, [safeGridSize, safeDivisions]);
  useEffect(
    () => () => {
      gridGeometries.major.dispose();
      gridGeometries.minor.dispose();
    },
    [gridGeometries],
  );

  return (
    <group name={name} {...props}>
      <mesh name="Surface" rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[safeSize / 2, 96]} />
        <meshStandardMaterial
          color="#d2d0c6"
          roughness={0.86}
          metalness={0.02}
          transparent
          alphaMap={edgeFade}
        />
      </mesh>
      {showGrid && (
        <group name="Construction Grid" position={[0, 0.018, 0]}>
          <mesh name="Major Lines" geometry={gridGeometries.major}>
            <meshBasicMaterial color="#587785" transparent opacity={0.23} depthWrite={false} />
          </mesh>
          <mesh name="Minor Lines" geometry={gridGeometries.minor}>
            <meshBasicMaterial color="#587785" transparent opacity={0.115} depthWrite={false} />
          </mesh>
        </group>
      )}
    </group>
  );
}
