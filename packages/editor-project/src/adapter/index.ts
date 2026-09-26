/**
 * Adapter interfaces — the seams the engine host and the editor DEPEND ON.
 *
 *   host    → RootAdapter ← { the editor's R3F root mounts, IngestRootAdapter, … }
 *   editor  → AuthoringAdapter ← { ThreeAuthoringAdapter, ReactRootAuthoringAdapter, … }
 *   game    → SystemAdapters (physics/networking/navigation/audio/camera/debug)
 *
 * The first-party Rapier/Colyseus stack is ONE implementer of these
 * interfaces, not the engine's vocabulary.
 *
 * **This module is TYPE-ONLY, and must stay that way (P-6).** It used to
 * value-export its own implementers — `createRapierPhysicsAdapter`,
 * `createColyseusNetworkingAdapter`, `createNavigationAdapter` — so
 * `import type { AuthoringAdapter } from './index'` was the only
 * thing keeping the three/Rapier/Colyseus stack out of a Pixi or React
 * consumer's module graph. A seam that ships its implementers is not a
 * seam. Import an implementer from its OWN path instead:
 *
 *   `@vgai/threejs-runtime/adapter/rapier-physics-adapter`    createRapierPhysicsAdapter
 *   `@vgai/threejs-runtime/adapter/first-party-navigation-system`       createNavigationAdapter
 */

export type { AdapterSurface } from './adapter-surface';
export type {
  AssetDropContext,
  AssetDropProvider,
  AssetSubjectProvider,
  AuthoringAdapter,
  AuthoringAssetSubject,
  AuthoringCapabilities,
  AuthoringProvenance,
  AuthoringProviderKey,
  AuthoringTruth,
  BoxEditProvider,
  BoxEditReferencePoint,
  ColorSampleProvider,
  ComponentInstanceApplyResult,
  ComponentInstanceDescription,
  ComponentInstanceOverride,
  ComponentInstancesProvider,
  DOMRectLike,
  EditorNode,
  EditorNodeRole,
  HierarchyProvider,
  InspectorProvider,
  NodeCreationSite,
  PersistenceProvider,
  PickProvider,
  PropertyDescriptor,
  RectProvider,
  RelatedSubjectLink,
  RelatedSubjectsProvider,
  SelectionProvider,
  SelectionResolution,
  SpatialDragHandle,
  SpatialHandleGuide,
  SpatialHandleLayer,
  SpatialHandlesProvider,
  SpatialPoint3,
  StoriesProvider,
  StoryRef,
  StructuralClipboardOutcome,
  StructuralIdsWrite,
  StructuralIdWrite,
  StructuralWriteOutcome,
  StructureProvider,
  TextProvider,
  TransformChannel,
  TransformEditability,
  TransformProvider,
  TransformSourceCommitProvider,
  TruthProvider,
  WriteAck,
  WriteAnchorKind,
} from './authoring';
export {
  AUTHORING_PROVIDER_KEYS,
  emptyWriteAnchorKindCounts,
  measureAuthoringProviders,
  WRITE_ANCHOR_KINDS,
} from './authoring';
export {
  AUTHORING_ADAPTER_SHAPE,
  AUTHORING_PROVIDER_SHAPES,
  HIERARCHY_PROVIDER_SHAPE,
} from './authoring-seam-contract';
export type {
  EntryStaticSurface,
  ObservationBinding,
  ProjectBinding,
  ProjectionBinding,
  ProtocolFamily,
  RootBinding,
  RootBindingParts,
  RootDeclaration,
  SubstrateBinding,
  TruthBinding,
} from './binding';
export { createRootBinding } from './binding';
export type {
  CanvasHostContext,
  DomHostContext,
  HostContextBase,
  HostContextFor,
  HostSurface,
  ThreeHostContext,
} from './host-context';
/** The offline-audio contract an `AudioAdapter.renderOffline` implements.
 *  Defined beside the render-mode harness that first needed it; re-exported
 *  here so a world binding the seam imports one name from one place. */
export type { OfflineAudioRenderer, RenderedAudio } from './render-audio';
export type {
  MountedCanvasRoot,
  MountedCanvasSubstrate,
  MountedReactRoot,
  MountedRoot,
  MountedRootBase,
  MountedThreeRoot,
  RootAdapter,
  RootStateObserver,
  SurfaceAdapter,
  SurfaceAdapterFor,
} from './root-adapter';
export {
  MOUNTED_CANVAS_SURFACE_SHAPE,
  MOUNTED_DOM_SURFACE_SHAPE,
  MOUNTED_ROOT_BASE_SHAPE,
  MOUNTED_THREE_SURFACE_SHAPE,
  ROOT_ADAPTER_SHAPE,
  ROOT_STATE_OBSERVER_SHAPE,
} from './root-seam-contract';
export type {
  SeamEvidenceOutcome,
  SeamEvidenceReceipt,
  SeamEvidenceSource,
  SeamEvidenceState,
  SeamEvidenceVerdict,
  SeamProofStage,
  SeamShape,
} from './seam-evidence';
export {
  defineSeamShape,
  gradeSeamCarrier,
  gradeSeamEvidence,
  inspectSeamShape,
  SEAM_PROOF_STAGES,
  SeamEvidenceLedger,
  seamStageAtLeast,
} from './seam-evidence';
export type {
  AudioAdapter,
  AudioDebugEvent,
  AudioGraphNode,
  AudioMeterFrame,
  AudioMeterHandle,
  AudioRecordingHandle,
  AudioTransportState,
  CameraAdapter,
  CameraRuntimeCamera,
  CameraRuntimeSnapshot,
  CameraRuntimeTransition,
  ConnectionState,
  DebugAdapter,
  NavCrowdAgentState,
  NavigationAdapter,
  NavPoint,
  NetConditioning,
  NetMessageEvent,
  NetPeer,
  NetPlayerIdentity,
  NetConditioningLimits,
  NetRates,
  NetTypeTraffic,
  NetServerConfig,
  NetworkingAdapter,
  PhysicsAdapter,
  PhysicsCarrier,
  PhysicsColliderShape,
  PhysicsColliderSnapshot,
  PhysicsJointSnapshot,
  PhysicsJointType,
  RenderDebugAdapter,
  ReplicationStats,
  RoomInfo,
  SystemAdapters,
  Unsubscribe,
} from './system-adapter';
/** The two narrowings of the tagged `SystemAdapters['physics']` union — see
 *  `PhysicsAdapter`'s comment for why it is tagged at all. */
export { displayKeyedPhysics, nodeKeyedPhysics } from './system-adapter';
export {
  AUDIO_ADAPTER_SHAPE,
  CAMERA_ADAPTER_SHAPE,
  DEBUG_ADAPTER_SHAPE,
  NAVIGATION_ADAPTER_SHAPE,
  NETWORKING_ADAPTER_SHAPE,
  PHYSICS_2D_ADAPTER_SHAPE,
  PHYSICS_ADAPTER_SHAPE,
  RENDER_DEBUG_ADAPTER_SHAPE,
  SYSTEM_ADAPTERS_SHAPE,
  SYSTEM_PROVIDER_SHAPES,
} from './system-seam-contract';
export type { Transform, TransformOwner } from './transform';
