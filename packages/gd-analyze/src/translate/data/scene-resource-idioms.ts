/**
 * The mapping from Godot resource classes to the library idioms a scene writes them as
 * (docs/GODOT.md §The lane's law, row 3): the plan-time table the planner reads to give each
 * planned resource its idiom. Emit writes the idiom and never looks at the class.
 */
import type { TargetGodotSceneSetterPlan } from './scene-document-plan';
import { type GodotSceneMaterialIdiom, godotSceneMaterialIdiom } from './scene-material-idioms';

export type GodotSceneResourceIdiom =
  /**
   * A PlaneMesh or QuadMesh: three's `planeGeometry`, with the class's default size and facing. A
   * mesh drawn as a three geometry (`geometry`) is an element's `geometry` and `material` props.
   */
  | { readonly kind: 'plane'; readonly geometry: true; readonly size: readonly [number, number]; readonly orientation: number }
  /** A SphereMesh: three's `sphereGeometry`. */
  | { readonly kind: 'sphere'; readonly geometry: true }
  /** A CylinderMesh: three's `cylinderGeometry`. */
  | { readonly kind: 'cylinder'; readonly geometry: true }
  /** An ArrayMesh: a `bufferGeometry` over its surfaces' data file. */
  | { readonly kind: 'array-mesh'; readonly geometry: true }
  /** A StandardMaterial3D: the three material and props `scene-material-idioms.ts` plans for it. */
  | GodotSceneMaterialIdiom
  /** A GradientTexture2D: a texture drawn from its gradient. */
  | { readonly kind: 'gradient-texture' }
  /** A CompressedTexture2D: the imported image, loaded by the scene's texture hook. */
  | { readonly kind: 'texture' }
  /** A MeshLibrary, AnimationLibrary or AnimationNodeBlendTree: a data file the scene imports. */
  | { readonly kind: 'mesh-library' }
  | { readonly kind: 'animation-library' }
  | { readonly kind: 'animation-tree' }
  /** A CompressedCubemap, AudioStreamWAV, AudioStreamOggVorbis or FontFile: the imported file, loaded by compat's hook. */
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

const IDIOMS: Readonly<Record<string, GodotSceneResourceIdiom | 'material'>> = {
  // `Orientation` (`primitive_meshes.h:240`): FACE_X 0, FACE_Y 1 (PlaneMesh's), FACE_Z 2 (QuadMesh's).
  PlaneMesh: { kind: 'plane', geometry: true, size: [2, 2], orientation: 1 },
  QuadMesh: { kind: 'plane', geometry: true, size: [1, 1], orientation: 2 },
  SphereMesh: { kind: 'sphere', geometry: true },
  CylinderMesh: { kind: 'cylinder', geometry: true },
  ArrayMesh: { kind: 'array-mesh', geometry: true },
  StandardMaterial3D: 'material',
  GradientTexture2D: { kind: 'gradient-texture' },
  CompressedTexture2D: { kind: 'texture' },
  MeshLibrary: { kind: 'mesh-library' },
  AnimationLibrary: { kind: 'animation-library' },
  AnimationNodeBlendTree: { kind: 'animation-tree' },
  CompressedCubemap: { kind: 'loaded', module: 'compressed-cubemap', exportName: 'useGodotCubemap' },
  AudioStreamWAV: { kind: 'loaded', module: 'audio-stream-wav', exportName: 'useGodotAudioStreamWav' },
  AudioStreamOggVorbis: { kind: 'loaded', module: 'audio-stream-ogg-vorbis', exportName: 'useGodotAudioStreamOggVorbis' },
  FontFile: { kind: 'loaded', module: 'font-file', exportName: 'useGodotFontFile' },
  Shader: { kind: 'shader' },
  ShaderMaterial: { kind: 'shader-material' },
  BoxShape3D: { kind: 'collider', collider: 'CuboidCollider' },
  SphereShape3D: { kind: 'collider', collider: 'BallCollider' },
  CapsuleShape3D: { kind: 'collider', collider: 'CapsuleCollider' },
  ConvexPolygonShape3D: { kind: 'collider', collider: 'ConvexHullCollider' },
  ConcavePolygonShape3D: { kind: 'collider', collider: 'TrimeshCollider' },
};

/**
 * The idiom a resource of `className` with these authored setters is written as, or undefined when
 * it is constructed (`construct`).
 */
export function godotSceneResourceIdiom(className: string, setters: readonly TargetGodotSceneSetterPlan[]): GodotSceneResourceIdiom | undefined {
  const idiom = IDIOMS[className];
  return idiom === 'material' ? godotSceneMaterialIdiom(setters) : idiom;
}
