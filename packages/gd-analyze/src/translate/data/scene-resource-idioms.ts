/**
 * The mapping from Godot resource classes to the library idioms a scene writes them as
 * (docs/GODOT.md §The lane's law, row 3): the plan-time table the planner reads to give each
 * planned resource its idiom. Emit writes the idiom and never looks at the class.
 */

export type GodotSceneResourceIdiom =
  /** A PlaneMesh or QuadMesh: three's `planeGeometry`, with the class's default size and facing. */
  | { readonly kind: 'plane'; readonly size: readonly [number, number]; readonly orientation: number }
  /** A SphereMesh: three's `sphereGeometry`. */
  | { readonly kind: 'sphere' }
  /** A CylinderMesh: three's `cylinderGeometry`. */
  | { readonly kind: 'cylinder' }
  /** An ArrayMesh: a `bufferGeometry` over its surfaces' data file. */
  | { readonly kind: 'array-mesh' }
  /** A StandardMaterial3D: three's `meshStandardMaterial`. */
  | { readonly kind: 'standard-material' }
  /** A GradientTexture2D: a texture drawn from its gradient. */
  | { readonly kind: 'gradient-texture' }
  /** A CompressedTexture2D: the imported image, loaded by the scene's texture hook. */
  | { readonly kind: 'texture' }
  /** A MeshLibrary, AnimationLibrary or AnimationNodeBlendTree: a data file the scene imports. */
  | { readonly kind: 'mesh-library' }
  | { readonly kind: 'animation-library' }
  | { readonly kind: 'animation-tree' }
  /** A CompressedCubemap or AudioStreamWAV: the imported file, loaded by compat's hook. */
  | { readonly kind: 'loaded'; readonly module: string; readonly exportName: string }
  /** A Shader: its lowered code, made once. */
  | { readonly kind: 'shader' }
  /** A ShaderMaterial: its shader and parameters. */
  | { readonly kind: 'shader-material' }
  /** A collision shape: the `@react-three/rapier` collider it is. */
  | {
      readonly kind: 'collider';
      readonly collider: 'CuboidCollider' | 'BallCollider' | 'CapsuleCollider' | 'ConvexHullCollider' | 'TrimeshCollider';
    };

const IDIOMS: Readonly<Record<string, GodotSceneResourceIdiom>> = {
  // `Orientation` (`primitive_meshes.h:240`): FACE_X 0, FACE_Y 1 (PlaneMesh's), FACE_Z 2 (QuadMesh's).
  PlaneMesh: { kind: 'plane', size: [2, 2], orientation: 1 },
  QuadMesh: { kind: 'plane', size: [1, 1], orientation: 2 },
  SphereMesh: { kind: 'sphere' },
  CylinderMesh: { kind: 'cylinder' },
  ArrayMesh: { kind: 'array-mesh' },
  StandardMaterial3D: { kind: 'standard-material' },
  GradientTexture2D: { kind: 'gradient-texture' },
  CompressedTexture2D: { kind: 'texture' },
  MeshLibrary: { kind: 'mesh-library' },
  AnimationLibrary: { kind: 'animation-library' },
  AnimationNodeBlendTree: { kind: 'animation-tree' },
  CompressedCubemap: { kind: 'loaded', module: 'compressed-cubemap', exportName: 'useGodotCubemap' },
  AudioStreamWAV: { kind: 'loaded', module: 'audio-stream-wav', exportName: 'useGodotAudioStreamWav' },
  Shader: { kind: 'shader' },
  ShaderMaterial: { kind: 'shader-material' },
  BoxShape3D: { kind: 'collider', collider: 'CuboidCollider' },
  SphereShape3D: { kind: 'collider', collider: 'BallCollider' },
  CapsuleShape3D: { kind: 'collider', collider: 'CapsuleCollider' },
  ConvexPolygonShape3D: { kind: 'collider', collider: 'ConvexHullCollider' },
  ConcavePolygonShape3D: { kind: 'collider', collider: 'TrimeshCollider' },
};

/** The idiom a resource of `className` is written as, or undefined when it is constructed (`construct`). */
export function godotSceneResourceIdiom(className: string): GodotSceneResourceIdiom | undefined {
  return IDIOMS[className];
}
