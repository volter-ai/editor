import { type Vector2, vec2 } from './vector2';
import { type Vector3, vec3 } from './variant-3d';

export interface GodotImmediateMeshVertex {
  position: Vector3;
  normal: Vector3;
  tangent: readonly [number, number, number, number];
  color: unknown;
  uv: Vector2;
  uv2: Vector2;
}

export interface GodotImmediateMeshSurface {
  primitive: number;
  material: unknown;
  vertices: GodotImmediateMeshVertex[];
}

export class GodotImmediateMesh {
  private readonly surfaces: GodotImmediateMeshSurface[] = [];
  private active: GodotImmediateMeshSurface | null = null;
  private normal = vec3(0, 0, 1);
  private tangent: readonly [number, number, number, number] = [1, 0, 0, 1];
  private color: unknown = { r: 1, g: 1, b: 1, a: 1 };
  private uv = vec2();
  private uv2 = vec2();

  surface_begin(primitive: number, material: unknown = null): void {
    if (this.active) throw new Error('ImmediateMesh.surface_begin called before surface_end.');
    this.active = { primitive, material, vertices: [] };
  }

  surface_set_color(color: unknown): void { this.color = color; }
  surface_set_normal(normal: Readonly<Vector3>): void { this.normal = vec3(normal.x, normal.y, normal.z); }
  surface_set_tangent(tangent: readonly number[]): void {
    this.tangent = [Number(tangent[0] ?? 0), Number(tangent[1] ?? 0), Number(tangent[2] ?? 0), Number(tangent[3] ?? 1)];
  }
  surface_set_uv(uv: Readonly<Vector2>): void { this.uv = vec2(uv.x, uv.y); }
  surface_set_uv2(uv: Readonly<Vector2>): void { this.uv2 = vec2(uv.x, uv.y); }

  surface_add_vertex(vertex: Readonly<Vector3>): void {
    if (!this.active) throw new Error('ImmediateMesh.surface_add_vertex requires surface_begin.');
    this.active.vertices.push({
      position: vec3(vertex.x, vertex.y, vertex.z),
      normal: vec3(this.normal.x, this.normal.y, this.normal.z),
      tangent: [...this.tangent] as [number, number, number, number],
      color: this.color,
      uv: vec2(this.uv.x, this.uv.y),
      uv2: vec2(this.uv2.x, this.uv2.y),
    });
  }

  surface_add_vertex_2d(vertex: Readonly<Vector2>): void { this.surface_add_vertex(vec3(vertex.x, vertex.y, 0)); }

  surface_end(): void {
    if (!this.active) throw new Error('ImmediateMesh.surface_end requires surface_begin.');
    this.surfaces.push(this.active);
    this.active = null;
  }

  clear_surfaces(): void { this.active = null; this.surfaces.length = 0; }
  surface_get_count(): number { return this.surfaces.length; }
  surface_get_primitive_type(index: number): number { return this.surfaces[index]?.primitive ?? -1; }
  surface_get_material(index: number): unknown { return this.surfaces[index]?.material ?? null; }
  surface_set_material(index: number, material: unknown): void { if (this.surfaces[index]) this.surfaces[index].material = material; }
  get_surfaces(): readonly GodotImmediateMeshSurface[] { return this.surfaces; }
}

export const createGodotImmediateMesh = (): GodotImmediateMesh => new GodotImmediateMesh();
