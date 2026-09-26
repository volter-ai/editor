/** Exhaustive proof requirements for mounted SystemAdapters. A bound slot is
 * availability, not success: each nested operation has its own required proof
 * stage and therefore cannot hide behind `active[slot] != null`. */

import type { PhysicsAdapter2D } from './physics-adapter-2d';
import { defineSeamShape, type SeamShape } from './seam-evidence';
import type {
  AudioAdapter,
  CameraAdapter,
  DebugAdapter,
  NavigationAdapter,
  NetworkingAdapter,
  PhysicsAdapter,
  RenderDebugAdapter,
  SystemAdapters,
} from './system-adapter';

export const SYSTEM_ADAPTERS_SHAPE = defineSeamShape<SystemAdapters>()({
  physics: { optional: true, kind: 'value', required: 'effect' },
  networking: { optional: true, kind: 'value', required: 'operation' },
  navigation: { optional: true, kind: 'value', required: 'operation' },
  audio: { optional: true, kind: 'value', required: 'effect' },
  camera: { optional: true, kind: 'value', required: 'effect' },
  debug: { optional: true, kind: 'value', required: 'operation' },
  renderDebug: { optional: true, kind: 'value', required: 'effect' },
});

export const PHYSICS_ADAPTER_SHAPE = defineSeamShape<PhysicsAdapter>()({
  keyedBy: { optional: true, kind: 'value', required: 'shape' },
  ownerOf: { optional: false, kind: 'function', required: 'operation' },
  freeze: { optional: false, kind: 'function', required: 'effect' },
  commit: { optional: false, kind: 'function', required: 'effect' },
  unfreeze: { optional: false, kind: 'function', required: 'effect' },
  debugDraw: { optional: true, kind: 'function', required: 'operation' },
  setDebugDrawEnabled: { optional: true, kind: 'function', required: 'effect' },
  contactPoints: { optional: true, kind: 'function', required: 'operation' },
  colliders: { optional: true, kind: 'function', required: 'operation' },
  previewCollider: { optional: true, kind: 'function', required: 'effect' },
  joints: { optional: true, kind: 'function', required: 'operation' },
  previewJointAnchor: { optional: true, kind: 'function', required: 'effect' },
});

export const PHYSICS_2D_ADAPTER_SHAPE = defineSeamShape<PhysicsAdapter2D>()({
  keyedBy: { optional: false, kind: 'value', required: 'shape' },
  ownerOf: { optional: false, kind: 'function', required: 'operation' },
  freeze: { optional: false, kind: 'function', required: 'effect' },
  commit: { optional: false, kind: 'function', required: 'effect' },
  unfreeze: { optional: false, kind: 'function', required: 'effect' },
});

export const NETWORKING_ADAPTER_SHAPE = defineSeamShape<NetworkingAdapter>()({
  peers: { optional: false, kind: 'function', required: 'operation' },
  networkId: { optional: false, kind: 'function', required: 'operation' },
  authority: { optional: false, kind: 'function', required: 'operation' },
  editable: { optional: false, kind: 'function', required: 'operation' },
  getConnectionState: { optional: true, kind: 'function', required: 'operation' },
  getRoomInfo: { optional: true, kind: 'function', required: 'operation' },
  getReplicationStats: { optional: true, kind: 'function', required: 'operation' },
  subscribe: { optional: false, kind: 'function', required: 'effect' },
  getStateSnapshot: { optional: true, kind: 'function', required: 'operation' },
  messageEvents: { optional: true, kind: 'function', required: 'operation' },
  getRates: { optional: true, kind: 'function', required: 'operation' },
  getConditioning: { optional: true, kind: 'function', required: 'operation' },
  setConditioning: { optional: true, kind: 'function', required: 'effect' },
  getServerConfig: { optional: true, kind: 'function', required: 'operation' },
  getPlayerIdentity: { optional: true, kind: 'function', required: 'operation' },
  setPlayerIdentity: { optional: true, kind: 'function', required: 'effect' },
  getTrafficByType: { optional: true, kind: 'function', required: 'operation' },
  sendMessage: { optional: true, kind: 'function', required: 'effect' },
  getConditioningLimits: { optional: true, kind: 'function', required: 'operation' },
  ping: { optional: true, kind: 'function', required: 'effect' },
  inspectServer: { optional: true, kind: 'function', required: 'operation' },
  disconnectClient: { optional: true, kind: 'function', required: 'effect' },
});

export const NAVIGATION_ADAPTER_SHAPE = defineSeamShape<NavigationAdapter>()({
  hasNavMesh: { optional: false, kind: 'function', required: 'operation' },
  findPath: { optional: false, kind: 'function', required: 'effect' },
  debugMesh: { optional: false, kind: 'function', required: 'operation' },
  bake: { optional: true, kind: 'function', required: 'effect' },
  exportData: { optional: true, kind: 'function', required: 'operation' },
  clear: { optional: true, kind: 'function', required: 'effect' },
  crowdAgents: { optional: true, kind: 'function', required: 'operation' },
});

export const AUDIO_ADAPTER_SHAPE = defineSeamShape<AudioAdapter>()({
  resume: { optional: true, kind: 'function', required: 'effect' },
  setMuted: { optional: false, kind: 'function', required: 'effect' },
  isMuted: { optional: false, kind: 'function', required: 'operation' },
  graphSnapshot: { optional: true, kind: 'function', required: 'operation' },
  transportState: { optional: true, kind: 'function', required: 'operation' },
  acquireMeters: { optional: true, kind: 'function', required: 'effect' },
  acquireRecordingStream: { optional: true, kind: 'function', required: 'effect' },
  renderOffline: { optional: true, kind: 'function', required: 'operation' },
  audioEvents: { optional: true, kind: 'function', required: 'operation' },
});

export const CAMERA_ADAPTER_SHAPE = defineSeamShape<CameraAdapter>()({
  snapshot: { optional: false, kind: 'function', required: 'operation' },
  subscribe: { optional: false, kind: 'function', required: 'effect' },
});

export const DEBUG_ADAPTER_SHAPE = defineSeamShape<DebugAdapter>()({
  providers: { optional: false, kind: 'function', required: 'operation' },
  state: { optional: false, kind: 'function', required: 'operation' },
  stateAll: { optional: false, kind: 'function', required: 'operation' },
  commands: { optional: false, kind: 'function', required: 'operation' },
  invoke: { optional: false, kind: 'function', required: 'effect' },
  events: { optional: false, kind: 'function', required: 'operation' },
});

export const RENDER_DEBUG_ADAPTER_SHAPE = defineSeamShape<RenderDebugAdapter>()({
  captureFrame: { optional: false, kind: 'function', required: 'effect' },
  memorySnapshot: { optional: true, kind: 'function', required: 'operation' },
});

type NonPhysicsSystemSlot = Exclude<keyof SystemAdapters, 'physics'>;

export const SYSTEM_PROVIDER_SHAPES: {
  readonly [K in NonPhysicsSystemSlot]: SeamShape<NonNullable<SystemAdapters[K]>>;
} = {
  networking: NETWORKING_ADAPTER_SHAPE,
  navigation: NAVIGATION_ADAPTER_SHAPE,
  audio: AUDIO_ADAPTER_SHAPE,
  camera: CAMERA_ADAPTER_SHAPE,
  debug: DEBUG_ADAPTER_SHAPE,
  renderDebug: RENDER_DEBUG_ADAPTER_SHAPE,
};
