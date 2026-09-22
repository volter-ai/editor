/**
 * Structural object marks shared by runtime producers and Three editor tools.
 * Keep this contract native and dependency-free except for Three's types: a
 * bounds/layer reader must not load physics, animation or editor contracts.
 * The full user-data registry extends this schema and reuses these same keys.
 */
import type { Object3D } from 'three';

/** The kinds of editor helper objects tagged via `editorHelperType`. */
export type EditorHelperType =
  | 'lights'
  | 'cameras'
  | 'audio'
  | 'colliders'
  // Joint anchor/axis/limit gizmos (W2a) — distinct from 'colliders' so the
  // viewport's per-type visibility filter can toggle them independently.
  | 'joints'
  // LOD distance rings (W2b) — one ring per `mesh.lod` level, radius = the
  // level's camera-distance threshold in world units.
  | 'lod'
  | 'splines'
  // 'particles' tags the LIVE three.quarks emitter Object3D itself (so the
  // editor's helper machinery skips disposing it); 'particle-shape' tags the
  // editor's emitter-shape WIREFRAME (W1b) — they must stay distinct: sweeping
  // "particles"-tagged children would detach the running emitter, and quarks
  // self-disposes any system whose emitter leaves the scene.
  | 'particles'
  | 'particle-shape'
  | 'pivot'
  | 'navmesh'
  | 'constraints'
  | 'reflection-probes'
  | 'trigger-volumes'
  | 'skeletons'
  // A package's own helper kind, shown through the editor's viewport door
  // (`host.viewport.setHelper`): the host lists the kinds it toggles by name,
  // any other follows the master Helpers toggle.
  | (string & {});

export interface ObjectMarkSchema {
  editorHelperType: EditorHelperType;
  skeletonVisible: boolean;
  skeletonEnabled: boolean;
  engineInternal: boolean;
  editorHelper: boolean;
  vgaiComponentRoot: string;
  vgaiBuiltInternal: boolean;
}

export const ObjectMarkKeys = {
  editorHelperType: 'editorHelperType',
  skeletonVisible: 'skeletonVisible',
  skeletonEnabled: 'skeletonEnabled',
  engineInternal: 'engineInternal',
  editorHelper: 'editorHelper',
  vgaiComponentRoot: 'vgaiComponentRoot',
  vgaiBuiltInternal: 'vgaiBuiltInternal',
} as const satisfies Record<keyof ObjectMarkSchema, string>;

export function getObjectMark<K extends keyof ObjectMarkSchema>(
  object: Object3D | null | undefined,
  key: K,
): ObjectMarkSchema[K] | undefined {
  return object
    ? (object.userData[ObjectMarkKeys[key]] as ObjectMarkSchema[K] | undefined)
    : undefined;
}

export function setObjectMark<K extends keyof ObjectMarkSchema>(
  object: Object3D,
  key: K,
  value: ObjectMarkSchema[K],
): void {
  object.userData[ObjectMarkKeys[key]] = value;
}
