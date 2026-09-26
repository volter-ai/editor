import { type Vector3, vec3 } from './variant-3d';

export interface GodotTriangleMeshHit {
  position: Vector3;
  normal: Vector3;
  face: number;
  distance: number;
}

function add(a: Readonly<Vector3>, b: Readonly<Vector3>): Vector3 { return vec3(a.x + b.x, a.y + b.y, a.z + b.z); }
function sub(a: Readonly<Vector3>, b: Readonly<Vector3>): Vector3 { return vec3(a.x - b.x, a.y - b.y, a.z - b.z); }
function scale(value: Readonly<Vector3>, amount: number): Vector3 { return vec3(value.x * amount, value.y * amount, value.z * amount); }
function dot(a: Readonly<Vector3>, b: Readonly<Vector3>): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a: Readonly<Vector3>, b: Readonly<Vector3>): Vector3 { return vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
function lengthSquared(value: Readonly<Vector3>): number { return dot(value, value); }
function normalize(value: Readonly<Vector3>): Vector3 { const length = Math.sqrt(lengthSquared(value)); return length === 0 ? vec3(0, 0, 0) : scale(value, 1 / length); }
function copy(value: Readonly<Vector3>): Vector3 { return vec3(value.x, value.y, value.z); }

function closestOnTriangle(point: Vector3, a: Vector3, b: Vector3, c: Vector3): Vector3 {
  const ab = sub(b, a); const ac = sub(c, a); const ap = sub(point, a);
  const d1 = dot(ab, ap); const d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return copy(a);
  const bp = sub(point, b); const d3 = dot(ab, bp); const d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return copy(b);
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scale(ab, d1 / (d1 - d3)));
  const cp = sub(point, c); const d5 = dot(ab, cp); const d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return copy(c);
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scale(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, scale(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  const denominator = 1 / (va + vb + vc); return add(a, add(scale(ab, vb * denominator), scale(ac, vc * denominator)));
}

function rayTriangle(origin: Vector3, direction: Vector3, a: Vector3, b: Vector3, c: Vector3): number | null {
  const edge1 = sub(b, a); const edge2 = sub(c, a); const p = cross(direction, edge2); const determinant = dot(edge1, p);
  if (Math.abs(determinant) < 1e-8) return null;
  const inverse = 1 / determinant; const t = sub(origin, a); const u = dot(t, p) * inverse; if (u < 0 || u > 1) return null;
  const q = cross(t, edge1); const v = dot(direction, q) * inverse; if (v < 0 || u + v > 1) return null;
  const distance = dot(edge2, q) * inverse; return distance >= 0 ? distance : null;
}

export class GodotTriangleMesh {
  private faces: Vector3[] = [];

  create(faces: readonly Readonly<Vector3>[]): boolean {
    if (faces.length < 3 || faces.length % 3 !== 0) { this.faces = []; return false; }
    this.faces = faces.map(copy);
    return true;
  }

  get_faces(): Vector3[] { return this.faces.map(copy); }
  get_face_count(): number { return Math.floor(this.faces.length / 3); }

  get_aabb(): Readonly<{ position: Vector3; size: Vector3 }> {
    if (!this.faces.length) return { position: vec3(0, 0, 0), size: vec3(0, 0, 0) };
    let min = copy(this.faces[0]!); let max = copy(min);
    for (const point of this.faces) {
      min = vec3(Math.min(min.x, point.x), Math.min(min.y, point.y), Math.min(min.z, point.z));
      max = vec3(Math.max(max.x, point.x), Math.max(max.y, point.y), Math.max(max.z, point.z));
    }
    return { position: min, size: sub(max, min) };
  }

  get_face_normal(face: number): Vector3 {
    const offset = face * 3; const a = this.faces[offset]; const b = this.faces[offset + 1]; const c = this.faces[offset + 2];
    return a && b && c ? normalize(cross(sub(b, a), sub(c, a))) : vec3(0, 0, 0);
  }

  get_face_area(face: number): number {
    const offset = face * 3; const a = this.faces[offset]; const b = this.faces[offset + 1]; const c = this.faces[offset + 2];
    return a && b && c ? Math.sqrt(lengthSquared(cross(sub(b, a), sub(c, a)))) * 0.5 : 0;
  }

  intersect_ray(origin: Readonly<Vector3>, direction: Readonly<Vector3>): GodotTriangleMeshHit | null {
    return this.cast(copy(origin), copy(direction), Infinity);
  }

  intersect_segment(begin: Readonly<Vector3>, end: Readonly<Vector3>): GodotTriangleMeshHit | null {
    const delta = sub(end, begin); const length = Math.sqrt(lengthSquared(delta));
    return length === 0 ? null : this.cast(copy(begin), scale(delta, 1 / length), length);
  }

  private cast(origin: Vector3, direction: Vector3, maximumDistance: number): GodotTriangleMeshHit | null {
    let best: GodotTriangleMeshHit | null = null;
    for (let face = 0; face < this.get_face_count(); face += 1) {
      const offset = face * 3; const a = this.faces[offset]!; const b = this.faces[offset + 1]!; const c = this.faces[offset + 2]!;
      const distance = rayTriangle(origin, direction, a, b, c);
      if (distance === null || distance > maximumDistance || (best && distance >= best.distance)) continue;
      best = { position: add(origin, scale(direction, distance)), normal: normalize(cross(sub(b, a), sub(c, a))), face, distance };
    }
    return best;
  }

  get_closest_point(point: Readonly<Vector3>): Vector3 {
    let closest = vec3(0, 0, 0); let bestDistance = Infinity;
    for (let face = 0; face < this.get_face_count(); face += 1) {
      const offset = face * 3; const candidate = closestOnTriangle(copy(point), this.faces[offset]!, this.faces[offset + 1]!, this.faces[offset + 2]!);
      const distance = lengthSquared(sub(point, candidate)); if (distance < bestDistance) { bestDistance = distance; closest = candidate; }
    }
    return closest;
  }
}

export const createGodotTriangleMesh = (): GodotTriangleMesh => new GodotTriangleMesh();
