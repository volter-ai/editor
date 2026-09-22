/** Compiler-derived proof requirements for the AuthoringAdapter protocol.
 *
 * This is intentionally adjacent to the interface. Coverage used to enumerate
 * only top-level provider names, which allowed `{}` to count as a complete
 * provider. These descriptors cover every nested member and encode the
 * weakest evidence that can truthfully verify it.
 */

import type {
  AssetDropProvider,
  AssetSubjectProvider,
  AuthoringAdapter,
  BoxEditProvider,
  ColorSampleProvider,
  ComponentInstancesProvider,
  HierarchyProvider,
  InspectorProvider,
  PersistenceProvider,
  PickProvider,
  RectProvider,
  RelatedSubjectsProvider,
  SelectionProvider,
  SpatialHandlesProvider,
  StoriesProvider,
  StructureProvider,
  TextProvider,
  TransformProvider,
  TruthProvider,
} from './authoring';
import { defineSeamShape, type SeamShape } from './seam-evidence';

export const AUTHORING_ADAPTER_SHAPE = defineSeamShape<AuthoringAdapter>()({
  capabilities: { optional: false, kind: 'value', required: 'shape' },
  provenance: { optional: true, kind: 'value', required: 'shape' },
  hierarchy: { optional: false, kind: 'value', required: 'operation' },
  selection: { optional: true, kind: 'value', required: 'effect' },
  transforms: { optional: true, kind: 'value', required: 'effect' },
  inspector: { optional: true, kind: 'value', required: 'effect' },
  assetSubject: { optional: true, kind: 'value', required: 'operation' },
  related: { optional: true, kind: 'value', required: 'operation' },
  instances: { optional: true, kind: 'value', required: 'effect' },
  structure: { optional: true, kind: 'value', required: 'round-trip' },
  persistence: { optional: true, kind: 'value', required: 'round-trip' },
  pickable: { optional: true, kind: 'value', required: 'operation' },
  rects: { optional: true, kind: 'value', required: 'operation' },
  boxEdit: { optional: true, kind: 'value', required: 'effect' },
  text: { optional: true, kind: 'value', required: 'effect' },
  colorSample: { optional: true, kind: 'value', required: 'operation' },
  stories: { optional: true, kind: 'value', required: 'effect' },
  truth: { optional: true, kind: 'value', required: 'operation' },
  spatialHandles: { optional: true, kind: 'value', required: 'effect' },
  assetDrop: { optional: true, kind: 'value', required: 'round-trip' },
  subscribe: { optional: true, kind: 'function', required: 'effect' },
});

export const HIERARCHY_PROVIDER_SHAPE = defineSeamShape<HierarchyProvider>()({
  roots: { optional: false, kind: 'function', required: 'operation' },
  node: { optional: false, kind: 'function', required: 'operation' },
  crossSurfaceStructureSignature: { optional: true, kind: 'function', required: 'operation' },
  // A PURE LOOKUP IS AN `operation`, and `effect` is reserved for a member
  // whose truth is a side effect a receipt records (orchestrator ruling,
  // 2026-09-19). `idForObject3D` was declared `effect` and could therefore
  // never be verified: nothing it does is observable anywhere but in its own
  // return value, so no consumer has a receipt to record and the hierarchy
  // carrier graded `unverified` forever — a false sentence about a member
  // that works. It is the inverse of `object3D` and is proven the same way,
  // by a read probe that CALLS it and checks the answer against the walk
  // (`coverage/authoring-read-probe.ts`).
  object3D: { optional: true, kind: 'function', required: 'operation' },
  idForObject3D: { optional: true, kind: 'function', required: 'operation' },
});

export const SELECTION_PROVIDER_SHAPE = defineSeamShape<SelectionProvider>()({
  get: { optional: false, kind: 'function', required: 'operation' },
  set: { optional: false, kind: 'function', required: 'effect' },
  resolve: { optional: true, kind: 'function', required: 'operation' },
});

export const TRANSFORM_PROVIDER_SHAPE = defineSeamShape<TransformProvider>()({
  dimensions: { optional: true, kind: 'function', required: 'operation' },
  get: { optional: false, kind: 'function', required: 'operation' },
  editability: { optional: true, kind: 'function', required: 'operation' },
  beginEdit: { optional: false, kind: 'function', required: 'effect' },
  apply: { optional: false, kind: 'function', required: 'effect' },
  endEdit: { optional: false, kind: 'function', required: 'effect' },
  remove: { optional: true, kind: 'function', required: 'round-trip' },
  sourceCommit: { optional: true, kind: 'value', required: 'round-trip' },
});

export const INSPECTOR_PROVIDER_SHAPE = defineSeamShape<InspectorProvider>()({
  properties: { optional: false, kind: 'function', required: 'operation' },
  get: { optional: false, kind: 'function', required: 'operation' },
  set: { optional: false, kind: 'function', required: 'effect' },
  preview: { optional: true, kind: 'function', required: 'effect' },
  editability: { optional: true, kind: 'function', required: 'operation' },
  remove: { optional: true, kind: 'function', required: 'round-trip' },
});

export const ASSET_SUBJECT_PROVIDER_SHAPE = defineSeamShape<AssetSubjectProvider>()({
  get: { optional: false, kind: 'function', required: 'operation' },
  entries: { optional: true, kind: 'function', required: 'operation' },
});

export const RELATED_SUBJECTS_PROVIDER_SHAPE = defineSeamShape<RelatedSubjectsProvider>()({
  links: { optional: false, kind: 'function', required: 'operation' },
});

export const COMPONENT_INSTANCES_PROVIDER_SHAPE = defineSeamShape<ComponentInstancesProvider>()({
  describe: { optional: false, kind: 'function', required: 'operation' },
  openComponent: { optional: true, kind: 'function', required: 'effect' },
  revert: { optional: false, kind: 'function', required: 'round-trip' },
  applyToComponent: { optional: false, kind: 'function', required: 'round-trip' },
});

export const STRUCTURE_PROVIDER_SHAPE = defineSeamShape<StructureProvider>()({
  create: { optional: false, kind: 'function', required: 'round-trip' },
  remove: { optional: false, kind: 'function', required: 'round-trip' },
  duplicate: { optional: false, kind: 'function', required: 'round-trip' },
  reparent: { optional: false, kind: 'function', required: 'round-trip' },
  reorder: { optional: true, kind: 'function', required: 'round-trip' },
  creatableKinds: { optional: true, kind: 'function', required: 'operation' },
  wrap: { optional: true, kind: 'function', required: 'round-trip' },
  unwrap: { optional: true, kind: 'function', required: 'round-trip' },
  group: { optional: true, kind: 'function', required: 'round-trip' },
  ungroup: { optional: true, kind: 'function', required: 'round-trip' },
  canUngroup: { optional: true, kind: 'function', required: 'operation' },
  removeMany: { optional: true, kind: 'function', required: 'round-trip' },
  copy: { optional: true, kind: 'function', required: 'effect' },
  canCopy: { optional: true, kind: 'function', required: 'operation' },
  cut: { optional: true, kind: 'function', required: 'round-trip' },
  paste: { optional: true, kind: 'function', required: 'round-trip' },
  canPaste: { optional: true, kind: 'function', required: 'operation' },
});

export const PERSISTENCE_PROVIDER_SHAPE = defineSeamShape<PersistenceProvider>()({
  isDirty: { optional: false, kind: 'function', required: 'operation' },
  lastError: { optional: true, kind: 'function', required: 'operation' },
  save: { optional: false, kind: 'function', required: 'round-trip' },
  destination: { optional: false, kind: 'value', required: 'shape' },
  applyExternal: { optional: true, kind: 'function', required: 'effect' },
});

export const PICK_PROVIDER_SHAPE = defineSeamShape<PickProvider>()({
  pick: { optional: false, kind: 'function', required: 'operation' },
  candidates: { optional: true, kind: 'function', required: 'operation' },
});

export const STORIES_PROVIDER_SHAPE = defineSeamShape<StoriesProvider>()({
  storiesFor: { optional: false, kind: 'function', required: 'operation' },
  active: { optional: false, kind: 'function', required: 'operation' },
  apply: { optional: false, kind: 'function', required: 'effect' },
  isolate: { optional: true, kind: 'function', required: 'effect' },
  title: { optional: true, kind: 'value', required: 'shape' },
  unavailable: { optional: true, kind: 'function', required: 'operation' },
});

export const ASSET_DROP_PROVIDER_SHAPE = defineSeamShape<AssetDropProvider>()({
  accepts: { optional: false, kind: 'function', required: 'operation' },
  drop: { optional: false, kind: 'function', required: 'round-trip' },
});

export const RECT_PROVIDER_SHAPE = defineSeamShape<RectProvider>()({
  rect: { optional: false, kind: 'function', required: 'operation' },
  contextRects: { optional: true, kind: 'function', required: 'operation' },
  emptyContainers: { optional: true, kind: 'function', required: 'operation' },
});

export const BOX_EDIT_PROVIDER_SHAPE = defineSeamShape<BoxEditProvider>()({
  begin: { optional: false, kind: 'function', required: 'effect' },
  apply: { optional: false, kind: 'function', required: 'effect' },
  end: { optional: false, kind: 'function', required: 'effect' },
  gizmoOrigin: { optional: true, kind: 'function', required: 'operation' },
  referencePoint: { optional: true, kind: 'function', required: 'operation' },
});

export const TEXT_PROVIDER_SHAPE = defineSeamShape<TextProvider>()({
  get: { optional: false, kind: 'function', required: 'operation' },
  set: { optional: false, kind: 'function', required: 'effect' },
});

export const COLOR_SAMPLE_PROVIDER_SHAPE = defineSeamShape<ColorSampleProvider>()({
  backgroundChainAt: { optional: false, kind: 'function', required: 'operation' },
});

export const TRUTH_PROVIDER_SHAPE = defineSeamShape<TruthProvider>()({
  resolve: { optional: false, kind: 'function', required: 'operation' },
});

export const SPATIAL_HANDLES_PROVIDER_SHAPE = defineSeamShape<SpatialHandlesProvider>()({
  layers: { optional: false, kind: 'function', required: 'operation' },
  preview: { optional: false, kind: 'function', required: 'effect' },
  commit: { optional: false, kind: 'function', required: 'round-trip' },
});

type ObjectProviderKey = Exclude<
  keyof AuthoringAdapter,
  'capabilities' | 'provenance' | 'hierarchy' | 'subscribe'
>;

/** The one nested-provider table. Its key type comes from AuthoringAdapter and
 * each value is typed against that provider's own interface. */
export const AUTHORING_PROVIDER_SHAPES: {
  readonly [K in ObjectProviderKey]: SeamShape<NonNullable<AuthoringAdapter[K]>>;
} = {
  selection: SELECTION_PROVIDER_SHAPE,
  transforms: TRANSFORM_PROVIDER_SHAPE,
  inspector: INSPECTOR_PROVIDER_SHAPE,
  assetSubject: ASSET_SUBJECT_PROVIDER_SHAPE,
  related: RELATED_SUBJECTS_PROVIDER_SHAPE,
  instances: COMPONENT_INSTANCES_PROVIDER_SHAPE,
  structure: STRUCTURE_PROVIDER_SHAPE,
  persistence: PERSISTENCE_PROVIDER_SHAPE,
  pickable: PICK_PROVIDER_SHAPE,
  rects: RECT_PROVIDER_SHAPE,
  boxEdit: BOX_EDIT_PROVIDER_SHAPE,
  text: TEXT_PROVIDER_SHAPE,
  colorSample: COLOR_SAMPLE_PROVIDER_SHAPE,
  stories: STORIES_PROVIDER_SHAPE,
  truth: TRUTH_PROVIDER_SHAPE,
  spatialHandles: SPATIAL_HANDLES_PROVIDER_SHAPE,
  assetDrop: ASSET_DROP_PROVIDER_SHAPE,
};
