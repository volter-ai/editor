/** Godot PrismMesh as one mutable native THREE.BufferGeometry Resource. */

import { BufferGeometry, Float32BufferAttribute } from 'three';
import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';

export interface PrismMeshVector3 { readonly x: number; readonly y: number; readonly z: number }
export interface PrismMeshOptions {
  readonly size?: PrismMeshVector3;
  readonly leftToRight?: number;
  readonly subdivideWidth?: number;
  readonly subdivideHeight?: number;
  readonly subdivideDepth?: number;
}
interface PrismMeshState {
  size: PrismMeshVector3;
  leftToRight: number;
  subdivideWidth: number;
  subdivideHeight: number;
  subdivideDepth: number;
}

const STATES = new WeakMap<BufferGeometry, PrismMeshState>();
const CMP_EPSILON = 0.00001;

function approx(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) < Math.max(CMP_EPSILON * Math.abs(a), CMP_EPSILON);
}

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`PrismMesh.${member} requires a finite number.`);
  }
  return value;
}

function sizeOf(value: PrismMeshVector3): PrismMeshVector3 {
  const size = {
    x: finite(value.x, 'size.x'),
    y: finite(value.y, 'size.y'),
    z: finite(value.z, 'size.z'),
  };
  return size;
}

function subdivision(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`PrismMesh.${member} requires a finite numeric int value.`);
  }
  const integer = Math.trunc(value);
  if (!Number.isSafeInteger(integer)) {
    throw new RangeError(`PrismMesh.${member} requires a safely representable int value.`);
  }
  return Math.max(0, integer);
}

function prismGeometry(state: PrismMeshState): BufferGeometry {
  const { size, leftToRight } = state;
  const subdivideW = state.subdivideWidth;
  const subdivideH = state.subdivideHeight;
  const subdivideD = state.subdivideDepth;
  const startX = size.x * -0.5;
  const startY = size.y * -0.5;
  const startZ = size.z * -0.5;
  const oneThird = 1 / 3;
  const twoThirds = 2 / 3;
  const positions: number[] = [];
  const normals: number[] = [];
  const tangents: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const vertex = (
    x: number, y: number, z: number,
    nx: number, ny: number, nz: number,
    tx: number, ty: number, tz: number,
    u: number, v: number,
  ): void => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    tangents.push(tx, ty, tz, 1);
    uvs.push(u, v);
  };
  let point = 0;
  let thisRow = 0;
  let previousRow = 0;
  let y = startY;
  for (let j = 0; j <= subdivideH + 1; j += 1) {
    const scale = j / (subdivideH + 1);
    const scaledSizeX = size.x * scale;
    const rowStartX = startX + (1 - scale) * size.x * leftToRight;
    const offsetFront = (1 - scale) * oneThird * leftToRight;
    const offsetBack = (1 - scale) * oneThird * (1 - leftToRight);
    let x = 0;
    for (let i = 0; i <= subdivideW + 1; i += 1) {
      let u = i / (3 * (subdivideW + 1));
      const v = j / (2 * (subdivideH + 1));
      u *= scale;
      vertex(rowStartX + x, -y, -startZ, 0, 0, 1, 1, 0, 0, offsetFront + u, v);
      point += 1;
      vertex(rowStartX + scaledSizeX - x, -y, startZ, 0, 0, -1, -1, 0, 0, twoThirds + offsetBack + u, v);
      point += 1;
      if (i > 0 && j === 1) {
        const i2 = i * 2;
        indices.push(previousRow + i2, thisRow + i2, thisRow + i2 - 2);
        indices.push(previousRow + i2 + 1, thisRow + i2 + 1, thisRow + i2 - 1);
      } else if (i > 0 && j > 0) {
        const i2 = i * 2;
        indices.push(previousRow + i2 - 2, previousRow + i2, thisRow + i2 - 2);
        indices.push(previousRow + i2, thisRow + i2, thisRow + i2 - 2);
        indices.push(previousRow + i2 - 1, previousRow + i2 + 1, thisRow + i2 - 1);
        indices.push(previousRow + i2 + 1, thisRow + i2 + 1, thisRow + i2 - 1);
      }
      x += scale * size.x / (subdivideW + 1);
    }
    y += size.y / (subdivideH + 1);
    previousRow = thisRow;
    thisRow = point;
  }

  const leftLength = Math.hypot(-size.y, size.x * leftToRight);
  const rightLength = Math.hypot(size.y, size.x * (1 - leftToRight));
  const normalLeft = leftLength === 0
    ? ([0, 0] as const)
    : ([-size.y / leftLength, size.x * leftToRight / leftLength] as const);
  const normalRight = rightLength === 0
    ? ([0, 0] as const)
    : ([size.y / rightLength, size.x * (1 - leftToRight) / rightLength] as const);
  y = startY;
  thisRow = point;
  previousRow = 0;
  for (let j = 0; j <= subdivideH + 1; j += 1) {
    const scale = j / (subdivideH + 1);
    const left = startX + size.x * (1 - scale) * leftToRight;
    const right = left + size.x * scale;
    let z = startZ;
    for (let i = 0; i <= subdivideD + 1; i += 1) {
      const u = i / (3 * (subdivideD + 1));
      const v = j / (2 * (subdivideH + 1));
      vertex(right, -y, -z, normalRight[0], normalRight[1], 0, 0, 0, -1, oneThird + u, v);
      point += 1;
      vertex(left, -y, z, normalLeft[0], normalLeft[1], 0, 0, 0, 1, u, 0.5 + v);
      point += 1;
      if (i > 0 && j > 0) {
        const i2 = i * 2;
        indices.push(previousRow + i2 - 2, previousRow + i2, thisRow + i2 - 2);
        indices.push(previousRow + i2, thisRow + i2, thisRow + i2 - 2);
        indices.push(previousRow + i2 - 1, previousRow + i2 + 1, thisRow + i2 - 1);
        indices.push(previousRow + i2 + 1, thisRow + i2 + 1, thisRow + i2 - 1);
      }
      z += size.z / (subdivideD + 1);
    }
    y += size.y / (subdivideH + 1);
    previousRow = thisRow;
    thisRow = point;
  }

  let z = startZ;
  thisRow = point;
  previousRow = 0;
  for (let j = 0; j <= subdivideD + 1; j += 1) {
    let x = startX;
    for (let i = 0; i <= subdivideW + 1; i += 1) {
      const u = i / (3 * (subdivideW + 1));
      const v = j / (2 * (subdivideD + 1));
      vertex(x, startY, -z, 0, -1, 0, 1, 0, 0, twoThirds + u, 0.5 + v);
      point += 1;
      if (i > 0 && j > 0) {
        indices.push(previousRow + i - 1, previousRow + i, thisRow + i - 1);
        indices.push(previousRow + i, thisRow + i, thisRow + i - 1);
      }
      x += size.x / (subdivideW + 1);
    }
    z += size.z / (subdivideD + 1);
    previousRow = thisRow;
    thisRow = point;
  }

  // Godot's renderer consumes clockwise fronts; Three consumes counter-clockwise fronts.
  for (let index = 0; index + 2 < indices.length; index += 3) {
    const swap = indices[index + 1] as number;
    indices[index + 1] = indices[index + 2] as number;
    indices[index + 2] = swap;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('tangent', new Float32BufferAttribute(tangents, 4));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function stateOf(mesh: BufferGeometry, member: string): PrismMeshState {
  const state = STATES.get(mesh);
  if (state === undefined) throw new TypeError(`PrismMesh.${member} requires a retained PrismMesh.`);
  return state;
}

function rebuild(mesh: BufferGeometry, state: PrismMeshState): void {
  const rebuilt = prismGeometry(state);
  mesh.dispose();
  mesh.copy(rebuilt);
  rebuilt.dispose();
  godotResourceEmitChanged(mesh);
}

export function createPrismMesh(options: PrismMeshOptions = {}): BufferGeometry {
  const state: PrismMeshState = {
    size: sizeOf(options.size ?? { x: 2, y: 2, z: 2 }),
    leftToRight: finite(options.leftToRight ?? 0.5, 'left_to_right'),
    subdivideWidth: subdivision(options.subdivideWidth ?? 0, 'subdivide_width'),
    subdivideHeight: subdivision(options.subdivideHeight ?? 0, 'subdivide_height'),
    subdivideDepth: subdivision(options.subdivideDepth ?? 0, 'subdivide_depth'),
  };
  const mesh = prismGeometry(state);
  STATES.set(mesh, state);
  registerGodotObjectIdentity(mesh, 'PrismMesh');
  bindGodotResourceProtocol(mesh, {
    createDuplicate: () => createPrismMesh({
      size: state.size,
      leftToRight: state.leftToRight,
      subdivideWidth: state.subdivideWidth,
      subdivideHeight: state.subdivideHeight,
      subdivideDepth: state.subdivideDepth,
    }),
  });
  return mesh;
}

export function getPrismMeshSize(mesh: BufferGeometry): PrismMeshVector3 {
  const size = stateOf(mesh, 'get_size').size;
  return { ...size };
}
export function setPrismMeshSize(mesh: BufferGeometry, value: PrismMeshVector3): void {
  const state = stateOf(mesh, 'set_size');
  const next = sizeOf(value);
  if (
    approx(state.size.x, next.x) &&
    approx(state.size.y, next.y) &&
    approx(state.size.z, next.z)
  ) return;
  state.size = next;
  rebuild(mesh, state);
}
export function getPrismMeshLeftToRight(mesh: BufferGeometry): number {
  return stateOf(mesh, 'get_left_to_right').leftToRight;
}
export function setPrismMeshLeftToRight(mesh: BufferGeometry, value: number): void {
  const state = stateOf(mesh, 'set_left_to_right');
  const next = finite(value, 'left_to_right');
  if (approx(state.leftToRight, next)) return;
  state.leftToRight = next;
  rebuild(mesh, state);
}

export function getPrismMeshSubdivideWidth(mesh: BufferGeometry): number {
  return stateOf(mesh, 'get_subdivide_width').subdivideWidth;
}
export function setPrismMeshSubdivideWidth(mesh: BufferGeometry, value: number): void {
  const state = stateOf(mesh, 'set_subdivide_width');
  const next = subdivision(value, 'subdivide_width');
  if (state.subdivideWidth === next) return;
  state.subdivideWidth = next;
  rebuild(mesh, state);
}
export function getPrismMeshSubdivideHeight(mesh: BufferGeometry): number {
  return stateOf(mesh, 'get_subdivide_height').subdivideHeight;
}
export function setPrismMeshSubdivideHeight(mesh: BufferGeometry, value: number): void {
  const state = stateOf(mesh, 'set_subdivide_height');
  const next = subdivision(value, 'subdivide_height');
  if (state.subdivideHeight === next) return;
  state.subdivideHeight = next;
  rebuild(mesh, state);
}
export function getPrismMeshSubdivideDepth(mesh: BufferGeometry): number {
  return stateOf(mesh, 'get_subdivide_depth').subdivideDepth;
}
export function setPrismMeshSubdivideDepth(mesh: BufferGeometry, value: number): void {
  const state = stateOf(mesh, 'set_subdivide_depth');
  const next = subdivision(value, 'subdivide_depth');
  if (state.subdivideDepth === next) return;
  state.subdivideDepth = next;
  rebuild(mesh, state);
}
