/**
 * The mapping from Godot resource classes to the library idioms a scene writes them as
 * (docs/GODOT.md §The lane's law, row 3): the plan-time table the planner reads to give each
 * planned resource its idiom. Emit writes the idiom and never looks at the class.
 */
import type { TargetGodotSceneSetterPlan } from './scene-document-plan';
import { type GodotSceneMaterialIdiom, godotSceneMaterialIdiom } from './scene-material-idioms';

/**
 * The compat function a three primitive geometry is handed once made (its `onUpdate`, or the call
 * around a shared geometry's `new`). Emit prints it and reachability ships its module, both from
 * this stamp.
 */
export interface GodotSceneGeometryMade {
  readonly module: string;
  readonly exportName: string;
}

export type GodotSceneResourceIdiom =
  /**
   * A PlaneMesh or QuadMesh: three's `planeGeometry`, with the class's default size, made facing
   * its orientation. A mesh drawn as a three geometry (`geometry`) is an element's `geometry` and
   * `material` props.
   */
  | { readonly kind: 'plane'; readonly geometry: true; readonly size: readonly [number, number]; readonly made: GodotSceneGeometryMade }
  /** A SphereMesh: three's `sphereGeometry`. */
  | { readonly kind: 'sphere'; readonly geometry: true; readonly made: GodotSceneGeometryMade }
  /** A CylinderMesh: three's `cylinderGeometry`. */
  | { readonly kind: 'cylinder'; readonly geometry: true; readonly made: GodotSceneGeometryMade }
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

/**
 * Three's primitives put their UV origin at the image's bottom row; every geometry the game draws
 * puts it at the top row, as Godot's do, and textures are uploaded unflipped.
 */
const UV_TOP: GodotSceneGeometryMade = { module: 'primitive-mesh', exportName: 'godot_primitive_mesh_uv_top' };

/**
 * A plane's `Orientation` (`primitive_meshes.h:240`) as what makes it: FACE_X 0 and FACE_Y 1 are
 * three's plane turned by compat, which also puts the UV origin at the top row; FACE_Z 2 is three's
 * own facing, only its UV origin moved.
 */
const PLANE_MADE: readonly GodotSceneGeometryMade[] = [
  { module: 'plane-mesh', exportName: 'godot_plane_mesh_face_x' },
  { module: 'plane-mesh', exportName: 'godot_plane_mesh_face_y' },
  UV_TOP,
];

const IDIOMS: Readonly<Record<string, GodotSceneResourceIdiom | 'material'>> = {
  // A PlaneMesh faces FACE_Y by default, a QuadMesh FACE_Z.
  PlaneMesh: { kind: 'plane', geometry: true, size: [2, 2], made: PLANE_MADE[1] as GodotSceneGeometryMade },
  QuadMesh: { kind: 'plane', geometry: true, size: [1, 1], made: UV_TOP },
  SphereMesh: { kind: 'sphere', geometry: true, made: UV_TOP },
  CylinderMesh: { kind: 'cylinder', geometry: true, made: UV_TOP },
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
 * it is constructed (`construct`). `reflected`: the project places a reflection probe.
 */
export function godotSceneResourceIdiom(className: string, setters: readonly TargetGodotSceneSetterPlan[], reflected = false): GodotSceneResourceIdiom | undefined {
  const idiom = IDIOMS[className];
  if (idiom === 'material') return godotSceneMaterialIdiom(setters, reflected);
  if (idiom?.kind === 'plane') {
    // An authored orientation replaces the class's facing.
    const orientation = setters.find((setter) => setter.setter.exportName === 'set_orientation')?.value;
    if (orientation?.kind === 'number') return { ...idiom, made: PLANE_MADE[orientation.value] ?? UV_TOP };
  }
  return idiom;
}
