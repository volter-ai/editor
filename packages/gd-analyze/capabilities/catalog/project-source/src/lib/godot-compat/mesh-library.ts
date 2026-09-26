export interface GodotMeshLibraryShape {
  shape: unknown;
  transform: unknown;
}

interface GodotMeshLibraryItem {
  name: string;
  mesh: unknown;
  meshTransform: unknown;
  meshCastShadow: number;
  shapes: GodotMeshLibraryShape[];
  navigationMesh: unknown;
  navigationMeshTransform: unknown;
  navigationLayers: number;
  preview: unknown;
}

function identityTransform(): Readonly<Record<string, unknown>> {
  return { basis: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], origin: { x: 0, y: 0, z: 0 } };
}

function createItem(): GodotMeshLibraryItem {
  return {
    name: '', mesh: null, meshTransform: identityTransform(), meshCastShadow: 1, shapes: [],
    navigationMesh: null, navigationMeshTransform: identityTransform(), navigationLayers: 1, preview: null,
  };
}

export class GodotMeshLibrary {
  private readonly items = new Map<number, GodotMeshLibraryItem>();

  create_item(id: number): void { if (!this.items.has(id)) this.items.set(id, createItem()); }
  remove_item(id: number): void { this.items.delete(id); }
  clear(): void { this.items.clear(); }
  has_item(id: number): boolean { return this.items.has(id); }
  get_item_list(): number[] { return [...this.items.keys()].sort((a, b) => a - b); }
  get_last_unused_item_id(): number { let id = 0; while (this.items.has(id)) id += 1; return id; }
  find_item_by_name(name: string): number { for (const [id, item] of this.items) if (item.name === name) return id; return -1; }

  private item(id: number): GodotMeshLibraryItem | null { return this.items.get(id) ?? null; }
  set_item_name(id: number, name: string): void { const item = this.item(id); if (item) item.name = name; }
  get_item_name(id: number): string { return this.item(id)?.name ?? ''; }
  set_item_mesh(id: number, mesh: unknown): void { const item = this.item(id); if (item) item.mesh = mesh; }
  get_item_mesh(id: number): unknown { return this.item(id)?.mesh ?? null; }
  set_item_mesh_transform(id: number, transform: unknown): void { const item = this.item(id); if (item) item.meshTransform = transform; }
  get_item_mesh_transform(id: number): unknown { return this.item(id)?.meshTransform ?? identityTransform(); }
  set_item_mesh_cast_shadow(id: number, mode: number): void { const item = this.item(id); if (item) item.meshCastShadow = mode; }
  get_item_mesh_cast_shadow(id: number): number { return this.item(id)?.meshCastShadow ?? 1; }
  set_item_shapes(id: number, shapes: readonly unknown[]): void {
    const item = this.item(id); if (!item) return;
    item.shapes = [];
    for (let index = 0; index + 1 < shapes.length; index += 2) item.shapes.push({ shape: shapes[index], transform: shapes[index + 1] });
  }
  get_item_shapes(id: number): unknown[] { return (this.item(id)?.shapes ?? []).flatMap((entry) => [entry.shape, entry.transform]); }
  set_item_navigation_mesh(id: number, navigationMesh: unknown): void { const item = this.item(id); if (item) item.navigationMesh = navigationMesh; }
  get_item_navigation_mesh(id: number): unknown { return this.item(id)?.navigationMesh ?? null; }
  set_item_navigation_mesh_transform(id: number, transform: unknown): void { const item = this.item(id); if (item) item.navigationMeshTransform = transform; }
  get_item_navigation_mesh_transform(id: number): unknown { return this.item(id)?.navigationMeshTransform ?? identityTransform(); }
  set_item_navigation_layers(id: number, layers: number): void { const item = this.item(id); if (item) item.navigationLayers = layers >>> 0; }
  get_item_navigation_layers(id: number): number { return this.item(id)?.navigationLayers ?? 1; }
  set_item_preview(id: number, preview: unknown): void { const item = this.item(id); if (item) item.preview = preview; }
  get_item_preview(id: number): unknown { return this.item(id)?.preview ?? null; }
}

export const createGodotMeshLibrary = (): GodotMeshLibrary => new GodotMeshLibrary();
