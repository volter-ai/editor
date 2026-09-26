export const GODOT_MESH_CONVEX_DECOMPOSITION_MODE_VOXEL = 0;
export const GODOT_MESH_CONVEX_DECOMPOSITION_MODE_TETRAHEDRON = 1;

export interface GodotMeshConvexDecompositionOptions {
  maxConcavity: number;
  symmetryPlanesClippingBias: number;
  revolutionAxesClippingBias: number;
  minVolumePerConvexHull: number;
  resolution: number;
  maxNumVerticesPerConvexHull: number;
  planeDownsampling: number;
  convexHullDownsampling: number;
  normalizeMesh: boolean;
  mode: number;
  convexHullApproximation: boolean;
  maxConvexHulls: number;
  projectHullVertices: boolean;
}

function finite(value: number, member: string, minimum = 0, maximum = Infinity): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`${member} must be finite in [${minimum}, ${maximum}].`);
  return value;
}

function integer(value: number, member: string, minimum: number, maximum = 0x7fffffff): number {
  const result = Math.trunc(finite(value, member, minimum, maximum));
  return result;
}

export class GodotMeshConvexDecompositionSettings {
  private options: GodotMeshConvexDecompositionOptions = {
    maxConcavity: 1,
    symmetryPlanesClippingBias: 0.05,
    revolutionAxesClippingBias: 0.05,
    minVolumePerConvexHull: 0.0001,
    resolution: 10000,
    maxNumVerticesPerConvexHull: 32,
    planeDownsampling: 4,
    convexHullDownsampling: 4,
    normalizeMesh: false,
    mode: GODOT_MESH_CONVEX_DECOMPOSITION_MODE_VOXEL,
    convexHullApproximation: true,
    maxConvexHulls: 1,
    projectHullVertices: true,
  };

  set_max_concavity(value: number): void { this.options.maxConcavity = finite(value, 'MeshConvexDecompositionSettings.max_concavity'); }
  get_max_concavity(): number { return this.options.maxConcavity; }
  set_symmetry_planes_clipping_bias(value: number): void { this.options.symmetryPlanesClippingBias = finite(value, 'MeshConvexDecompositionSettings.symmetry_planes_clipping_bias', 0, 1); }
  get_symmetry_planes_clipping_bias(): number { return this.options.symmetryPlanesClippingBias; }
  set_revolution_axes_clipping_bias(value: number): void { this.options.revolutionAxesClippingBias = finite(value, 'MeshConvexDecompositionSettings.revolution_axes_clipping_bias', 0, 1); }
  get_revolution_axes_clipping_bias(): number { return this.options.revolutionAxesClippingBias; }
  set_min_volume_per_convex_hull(value: number): void { this.options.minVolumePerConvexHull = finite(value, 'MeshConvexDecompositionSettings.min_volume_per_convex_hull'); }
  get_min_volume_per_convex_hull(): number { return this.options.minVolumePerConvexHull; }
  set_resolution(value: number): void { this.options.resolution = integer(value, 'MeshConvexDecompositionSettings.resolution', 10000, 64000000); }
  get_resolution(): number { return this.options.resolution; }
  set_max_num_vertices_per_convex_hull(value: number): void { this.options.maxNumVerticesPerConvexHull = integer(value, 'MeshConvexDecompositionSettings.max_num_vertices_per_convex_hull', 4, 1024); }
  get_max_num_vertices_per_convex_hull(): number { return this.options.maxNumVerticesPerConvexHull; }
  set_plane_downsampling(value: number): void { this.options.planeDownsampling = integer(value, 'MeshConvexDecompositionSettings.plane_downsampling', 1, 16); }
  get_plane_downsampling(): number { return this.options.planeDownsampling; }
  set_convex_hull_downsampling(value: number): void { this.options.convexHullDownsampling = integer(value, 'MeshConvexDecompositionSettings.convex_hull_downsampling', 1, 16); }
  get_convex_hull_downsampling(): number { return this.options.convexHullDownsampling; }
  set_normalize_mesh(value: boolean): void { this.options.normalizeMesh = value; }
  get_normalize_mesh(): boolean { return this.options.normalizeMesh; }
  set_mode(value: number): void {
    if (value !== GODOT_MESH_CONVEX_DECOMPOSITION_MODE_VOXEL && value !== GODOT_MESH_CONVEX_DECOMPOSITION_MODE_TETRAHEDRON) throw new RangeError('MeshConvexDecompositionSettings.mode is invalid.');
    this.options.mode = value;
  }
  get_mode(): number { return this.options.mode; }
  set_convex_hull_approximation(value: boolean): void { this.options.convexHullApproximation = value; }
  get_convex_hull_approximation(): boolean { return this.options.convexHullApproximation; }
  set_max_convex_hulls(value: number): void { this.options.maxConvexHulls = integer(value, 'MeshConvexDecompositionSettings.max_convex_hulls', 1, 1024); }
  get_max_convex_hulls(): number { return this.options.maxConvexHulls; }
  set_project_hull_vertices(value: boolean): void { this.options.projectHullVertices = value; }
  get_project_hull_vertices(): boolean { return this.options.projectHullVertices; }

  duplicate(): GodotMeshConvexDecompositionSettings {
    const copy = new GodotMeshConvexDecompositionSettings();
    copy.options = { ...this.options };
    return copy;
  }

  to_options(): Readonly<GodotMeshConvexDecompositionOptions> { return { ...this.options }; }
}

export const createGodotMeshConvexDecompositionSettings = (): GodotMeshConvexDecompositionSettings => new GodotMeshConvexDecompositionSettings();
