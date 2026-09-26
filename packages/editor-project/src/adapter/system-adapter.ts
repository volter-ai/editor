/**
 * System adapters — optional subsystem capability providers hung off a mounted
 * game (`MountedThreeRoot.systems`). Each is a thin capability boundary the editor can
 * coordinate with WITHOUT owning the implementation. The first-party
 * implementers wrap Rapier / Colyseus / recast; an external game supplies its
 * own or none, and the editor degrades per `capabilities`.
 *
 * These are introspection/coordination boundaries, NOT re-implementations: e.g.
 * `NetworkingAdapter` is not a transport, and `PhysicsAdapter` does not replace
 * Rapier — it lets the editor ask "who owns this object" and "freeze it while I
 * edit it".
 */

import type { FrameCapture } from './frame-capture';
import type { PhysicsAdapter2D } from './physics-adapter-2d';
import type { OfflineAudioRenderer } from './render-audio';
import type { RenderMemorySnapshot } from './render-memory';
import type { Transform, TransformOwner } from './transform';

export type PhysicsColliderShape =
  | { readonly type: 'cuboid'; readonly halfExtents: readonly [number, number, number] }
  | { readonly type: 'ball'; readonly radius: number }
  | { readonly type: 'capsule'; readonly halfHeight: number; readonly radius: number }
  /**
   * A collider this seam has no plain-data projection for — a trimesh,
   * heightfield, convex hull, cylinder, cone, …
   *
   * IT IS STILL A COLLIDER, and the body still has it. Implementations used to
   * drop these from `colliders()` entirely, so a body whose only collider was a
   * trimesh inspected as a body with NO physics at all. `kind` is the native
   * shape's own name, so the inspector can say WHICH shape it cannot draw
   * rather than implying nothing is there. Nothing may synthesize dimensions
   * for one, and `previewCollider` refuses it.
   */
  | { readonly type: 'unsupported'; readonly kind: string };

/** Plain-data projection of one native 3D physics collider. The owning
 * physics implementation keeps the actual collider; editor authoring only
 * receives the geometry needed to inspect and draw it. */
export interface PhysicsColliderSnapshot {
  readonly id: string;
  readonly shape: PhysicsColliderShape;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
  /** Absolute world scale used when the native shape was created. Source
   * dimensions divide by this to recover @react-three/rapier's local args. */
  readonly scale: readonly [number, number, number];
  readonly sensor: boolean;
}

export type PhysicsJointType =
  | 'fixed'
  | 'spherical'
  | 'revolute'
  | 'prismatic'
  | 'rope'
  | 'spring'
  | 'generic';

/** Plain-data projection of one native 3D impulse joint. Anchors are exposed
 * in both native body-local space (for persistence) and world space (for
 * viewport instruments); the actual joint remains owned by the physics lib. */
export interface PhysicsJointSnapshot {
  readonly id: string;
  readonly type: PhysicsJointType;
  readonly body1: string;
  readonly body2: string;
  readonly anchor1: readonly [number, number, number];
  readonly anchor2: readonly [number, number, number];
  readonly worldAnchor1: readonly [number, number, number];
  readonly worldAnchor2: readonly [number, number, number];
  readonly body1Position: readonly [number, number, number];
  readonly body2Position: readonly [number, number, number];
  readonly body1Rotation: readonly [number, number, number, number];
  readonly body2Rotation: readonly [number, number, number, number];
  /** The free axis in body-1 local/world space for revolute/prismatic joints. */
  readonly axis?: readonly [number, number, number];
  readonly worldAxis?: readonly [number, number, number];
  readonly limits?: { readonly min: number; readonly max: number };
  readonly contactsEnabled: boolean;
}

/**
 * Physics coordination so the editor can stably edit an object a simulation
 * would otherwise overwrite every frame: `freeze → apply → unfreeze`.
 *
 * Keyed by NODE ID (the `EditorNode` id), not `THREE.Object3D` (P-4). The
 * Object3D keying made this seam structurally unreachable for any non-three
 * world: a Pixi or React world could never expose a physics inspector, because
 * the seam spoke a vocabulary it has no values in — which is why the Pixi
 * surface grew a parallel {@link PhysicsAdapter2D} (`pixi/system-adapters.ts`)
 * instead of implementing this. Substrate-specific resolution (id → the native
 * object) is the IMPLEMENTER's job, done once at its own boundary.
 *
 * ## `keyedBy`, and why the physics slot's union is TAGGED
 *
 * `SystemAdapters['physics']` holds EITHER shape ({@link PhysicsCarrier}),
 * because a carrier addresses the thing being edited in its surface's own
 * vocabulary and the canvas lane's is the display object itself. But the two
 * shapes carry the SAME four member names and are otherwise indistinguishable
 * at runtime, while the registry that holds them
 * (`editor/src/authoring/active-systems.ts`) is GAME-scoped and surface-blind —
 * one object every editor panel reads. An untagged union would therefore be one
 * nothing could narrow, and every three-lane consumer
 * (`getActivePhysics()?.freeze(nodeId)`, `play-mode.ts`'s `physics.commit(id,
 * transform)`) would have to reach it through a cast asserting a fact nobody
 * checked.
 *
 * So `keyedBy` is a real discriminant, and it is REQUIRED on
 * {@link PhysicsAdapter2D} while OPTIONAL here on purpose: node-id keying is
 * this seam's original and — until the canvas lane — only vocabulary, so every
 * existing implementer stays valid untouched, and the shape that needs telling
 * apart is the one obliged to say so. {@link nodeKeyedPhysics} /
 * {@link displayKeyedPhysics} are the two narrowings; nothing else should test
 * the tag by hand.
 */
export interface PhysicsAdapter {
  /** Optional tag; see the interface comment. `'node-id'` is the only value,
   *  and omitting it means the same thing. */
  readonly keyedBy?: 'node-id';
  /** Returns `'physics'` when a body drives this node, else another owner. */
  ownerOf(nodeId: string): TransformOwner;
  /** Pause the body driving `nodeId` (kinematic / sleep / detach) for editing. */
  freeze(nodeId: string): void;
  /** Teleport the body to the edited pose (so the sim continues from there). */
  commit(nodeId: string, t: Transform): void;
  /** Resume simulation of `nodeId`. */
  unfreeze(nodeId: string): void;
  /** Optional debug-draw object (collider wireframes), in the surface's own
   *  medium; opaque to the neutral contract. */
  debugDraw?(): unknown;
  /**
   * Optional: turn the engine's per-frame physics debug rendering on/off —
   * the first-party implementation drives Rapier's `debugRender()` into the
   * `debugDraw()` object inside the game's own render system, so an editor
   * overlay toggle costs the editor zero per-frame work (W2a §2.3c).
   */
  setDebugDrawEnabled?(enabled: boolean): void;
  /**
   * Optional: live world-space contact points this frame, as xyz triples.
   * Returns a view over a REUSED backing buffer — valid only until the next
   * call (no per-frame allocation churn; callers copy into their own
   * geometry).
   */
  contactPoints?(): Float32Array;
  /** Optional native collider inspection for one authored node. Implementers
   * return only shapes they can describe exactly; absence means the editor
   * offers no collider component UI. */
  colliders?(nodeId: string): readonly PhysicsColliderSnapshot[];
  /** Optional gesture preview against the implementation's real collider.
   * Source persistence remains the AuthoringAdapter's responsibility. */
  previewCollider?(colliderId: string, shape: PhysicsColliderShape): void;
  /** Optional native impulse-joint inspection for joints attached to one node. */
  joints?(nodeId: string): readonly PhysicsJointSnapshot[];
  /** Optional gesture preview against the implementation's real local anchor. */
  previewJointAnchor?(
    jointId: string,
    endpoint: 0 | 1,
    anchor: readonly [number, number, number],
  ): void;
}

export interface NetPeer {
  id: string;
  label?: string;
}

/** The project's declared multiplayer server, readable with the game NOT
 *  running. `null` from `getServerConfig` means no server is declared. */
export interface NetServerConfig {
  endpoint: string;
  /** Known once the game's own networking adapter reports it; in edit mode
   *  the declared `process` gives only the endpoint. */
  roomName?: string;
}

/** The signed-in player's authored identity, used as the connect default. */
export interface NetPlayerIdentity {
  name?: string;
  id?: string;
}

/** The live connection lifecycle, for the editor's network inspector. */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Identity of the room the local peer is currently in, or `null` when not connected. */
export interface RoomInfo {
  roomId: string;
  sessionId: string;
  roomName: string;
}

/** Lightweight replication counters for the editor's network inspector. */
export interface ReplicationStats {
  /** Number of replicated entities currently known (e.g. players + NPCs). */
  entities: number;
  /** Approximate inbound replication activity (state changes observed per second). */
  msgsInPerSec: number;
  /** Approximate outbound message rate (client → server sends per second). */
  msgsOutPerSec: number;
}

export type Unsubscribe = () => void;

/** One captured network message, for the inspector's message log (W3b).
 *  `seq` is an adapter-lifetime MONOTONIC counter — the ring-buffer fence a
 *  consumer polls with (`messageEvents(sinceSeq)`), mirroring
 *  `DebugAdapter.events`' seq discipline. `time` is a `performance.now()`-
 *  domain ms timestamp at capture. */
export interface NetMessageEvent {
  seq: number;
  time: number;
  direction: 'in' | 'out';
  /** Message type/channel (e.g. `'input'`, `'players.add'`, `'state.phase'`). */
  type: string;
  /** Approximate payload size in bytes, when measurable. OMITTED — never
   *  fabricated — when the transport doesn't expose it (e.g. Colyseus schema
   *  patches observed via the Callbacks API carry no byte count). */
  size?: number;
  /** `true` when the link conditioner (`setConditioning`) dropped this
   *  outbound message instead of sending it — logged so the inspector can
   *  show the drop honestly rather than silently losing it. */
  dropped?: boolean;
}

/** Send/receive rates for the inspector's sparklines (W3b). The byte fields
 *  are OPTIONAL capabilities-within-the-capability: an implementer omits a
 *  direction it cannot measure (never reports a fabricated 0). */
/** One message type's traffic, both directions. */
export interface NetTypeTraffic {
  type: string;
  countIn: number;
  countOut: number;
  bytesIn: number;
  bytesOut: number;
}

export interface NetConditioningLimits {
  latencyMs?: string;
  jitterMs?: string;
  packetLoss?: string;
}

export interface NetRates {
  msgsInPerSec: number;
  msgsOutPerSec: number;
  bytesInPerSec?: number;
  bytesOutPerSec?: number;
}

/** Client-side link-conditioning parameters, applied AT THE ADAPTER SEAM
 *  (W3b M3) — the implementer wraps its own transport calls (e.g. delaying/
 *  dropping around `room.send`); nobody patches transport internals. */
export interface NetConditioning {
  /** Fixed added delay per outbound message, ms. */
  latencyMs: number;
  /** Uniform random extra delay in `[0, jitterMs)`, ms. */
  jitterMs: number;
  /** Probability in `[0, 1]` that an outbound message is dropped. */
  packetLoss: number;
}

/**
 * INTROSPECTION over replication state — NOT a networking transport.
 *
 * The optional members are CAPABILITIES in the `SystemAdapters` sense
 * (absence means "not supported" and the editor's Network inspector marks
 * that section absent — it never fabricates data): `getStateSnapshot` feeds
 * the replicated-state tree, `messageEvents` the message log, `getRates` the
 * rate sparklines, and `getConditioning`/`setConditioning` the latency/loss
 * conditioner. The first-party Colyseus factory
 * (`createColyseusNetworkingAdapter`) only attaches each one when its config
 * supplies the accessor, so partial implementers degrade honestly.
 */
export interface NetworkingAdapter {
  peers(): NetPeer[];
  /** Keyed by NODE ID, not `THREE.Object3D` — see {@link PhysicsAdapter} (P-4). */
  networkId(nodeId: string): string | null;
  authority(nodeId: string): 'local' | 'remote' | 'server';
  /** Remote/server-authoritative nodes → inspect-only in the editor. */
  editable(nodeId: string): boolean;
  /**
   * Optional capability: current connection lifecycle state.
   *
   * OPTIONAL for the same reason every other member here is — `'disconnected'`
   * is a POSITIVE CLAIM about the link, and an implementer that never taught
   * this adapter to read connection state has not made it. Absent ⇒ the
   * inspector marks the section unsupported; it does not report a game as
   * disconnected on the strength of nobody having looked.
   */
  getConnectionState?(): ConnectionState;
  /**
   * Optional capability: the active room's identity, or `null` when connected
   * to no room. `null` is the ANSWER "there is no room", so absence of the
   * accessor — "nothing here can tell you" — has to be a different thing.
   */
  getRoomInfo?(): RoomInfo | null;
  /**
   * Optional capability: replication activity snapshot, for a live network
   * inspector panel. Zeroes are a measurement, not a default; an adapter with
   * no counters omits this rather than reporting a quiet link.
   */
  getReplicationStats?(): ReplicationStats;
  /** Subscribe to changes in connection state / room / replication stats. */
  subscribe(cb: () => void): Unsubscribe;
  /** Optional capability: one plain-data (JSON-safe) snapshot of the
   *  replicated room state, or `null` when not connected. Colyseus schema is
   *  self-describing (`state.toJSON()`), so the first-party implementation
   *  is one call — the inspector renders whatever tree comes back. */
  getStateSnapshot?(): unknown;
  /** Optional capability: captured message events with `seq > sinceSeq`
   *  (whole ring when omitted). Implementations ring-buffer (drop oldest);
   *  the inspector keeps its own consumer-side ring and fences on `seq`. */
  messageEvents?(sinceSeq?: number): NetMessageEvent[];
  /** Optional capability: msg + byte rates for the inspector's sparklines. */
  getRates?(): NetRates;
  /** Optional capability (paired with `setConditioning`): current
   *  conditioning parameters. */
  getConditioning?(): NetConditioning;
  /** Optional capability: apply link conditioning at the adapter seam. */
  setConditioning?(c: NetConditioning): void;
  /** Optional edit-time capability: the project's declared server, readable
   *  with the game NOT running (`null` = no server declared). Hides on
   *  absence, like the other optionals. */
  getServerConfig?(): NetServerConfig | null;
  /** Optional capability: the local player's identity, as the GAME defines it
   *  (e.g. read off its own room state). The editor consumes this for display —
   *  a seat label — ONLY when a real implementer provides it, falling back to a
   *  generic label otherwise. */
  getPlayerIdentity?(): NetPlayerIdentity | undefined;
  /** Traffic per message type since the connection opened, both directions — state and patches
   *  included as their own rows (Godot's network profiler tables). */
  getTrafficByType?(): NetTypeTraffic[];
  /** Send `payload` to the room as this client, under message type `type` (Colyseus Monitor's
   *  Send), so a server handler can be exercised from the inspector. */
  sendMessage?(type: string, payload: unknown): void;
  /** Which conditioning fields this adapter cannot apply, each with the reason (a reliable
   *  WebSocket loses nothing, so it cannot simulate loss). Omitted means every field applies. */
  getConditioningLimits?(): NetConditioningLimits;
  /** Measure one round trip to the server now, in milliseconds. */
  ping?(): Promise<number>;
  /** Optional capability, PAIRED with {@link getPlayerIdentity}: set the local
   *  player's identity through the game's OWN multiplayer mechanism. The editor
   *  renders an editable name field ONLY when a real implementer provides this
   *  (consume-by-presence, exactly like {@link setConditioning}); its absence
   *  means the game does not support an author-settable name and no field shows.
   *
   *  This is NOT the editor imposing a name: whether a name is settable, and how
   *  it reaches the server, is entirely the game's decision — a game that names
   *  players by join order simply never provides this member. When it does, the
   *  implementation drives the game's real path (a join option honoured by the
   *  server, a rename message, …), so what the editor sets is the same value the
   *  multiplayer build actually uses — never a placeholder the server discards. */
  setPlayerIdentity?(identity: NetPlayerIdentity): void | Promise<void>;
}

export interface NavPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Navmesh bake parameters — the recast `rcConfig` vocabulary the scene schema
 * (`SceneNavigationSchema`) also mirrors. All optional; an implementation
 * applies its own defaults. `walkableHeight`/`walkableClimb`/`walkableRadius`
 * are in VOXEL units (multiples of `cellHeight`/`cellSize`), per recast.
 */
export interface NavBakeParams {
  cellSize?: number | undefined;
  cellHeight?: number | undefined;
  walkableSlopeAngle?: number | undefined;
  walkableHeight?: number | undefined;
  walkableClimb?: number | undefined;
  walkableRadius?: number | undefined;
  maxEdgeLen?: number | undefined;
  maxSimplificationError?: number | undefined;
  minRegionArea?: number | undefined;
  mergeRegionArea?: number | undefined;
}

/** One crowd agent's live state — plain data (no engine/WASM handles), for the
 *  editor's play-mode crowd debug draw. */
export interface NavCrowdAgentState {
  position: NavPoint;
  velocity: NavPoint;
  radius: number;
  height: number;
  /** The crowd's own agent state. `invalid` is the expressible FAILURE — the
   * agent is off the navmesh (a bad spawn or teleport) and will not move;
   * `offmesh` is an off-mesh connection traversal. Absent on an adapter that
   * predates this field — the editor draws such agents as walking. */
  state?: 'invalid' | 'walking' | 'offmesh';
  /** The agent's current move target, when the implementation reports one. */
  target?: NavPoint;
  /** The local path-corridor corners the agent is steering along — the
   * REQUESTED PATH the debug draw projects. Empty or absent when idle. */
  corners?: NavPoint[];
}

/**
 * Inspect a game's navigation mesh: whether one is built, query a path, and get a
 * debug overlay. Coordination/introspection only — the editor doesn't own the build.
 *
 * The optional members are CAPABILITIES in the `SystemAdapters` sense (absence
 * means "not supported", the editor degrades): `bake`/`exportData` let the
 * editor's Navigation panel (re)build and persist a navmesh through the seam —
 * the first-party recast implementation (`createNavigationAdapter`) is the
 * blessed implementer — while an external game that owns its build simply
 * omits them. `clear` lets that same owner release its navmesh; the editor never
 * disposes implementation handles itself. `crowdAgents` feeds the play-mode
 * crowd debug draw.
 *
 * `debugMesh`/`bake`/`clear` trade in the surface's own scene, objects and
 * meshes, which this neutral contract leaves opaque; `@volter/editor-threejs`
 * names the Three-typed view (`threeNavigation`).
 */
export interface NavigationAdapter {
  hasNavMesh(): boolean;
  /**
   * `[]` means SEARCHED AND FOUND NO ROUTE — a fact about the level. An
   * implementer with no navmesh to search, or whose query FAILED, THROWS
   * instead; those are facts about the implementer, and collapsing all three
   * into `[]` tells a caller the level is impassable when nobody looked.
   * Gate on {@link hasNavMesh} where the first case is reachable.
   */
  findPath(start: NavPoint, end: NavPoint): NavPoint[];
  debugMesh(scene: unknown): unknown;
  /** (Re)build the navmesh from source meshes. Synchronous in the blessed
   *  recast/WASM implementation; returns `false` on a failed bake. */
  bake?(meshes: readonly unknown[], params?: NavBakeParams): boolean;
  /** Serialize the current navmesh to a binary blob (the editor persists it
   *  as the scene's `.navmesh` sidecar). Throws when nothing is built. */
  exportData?(): Uint8Array;
  /** Release the current navmesh and any debug object it attached to `scene`.
   * Optional because an external game's navigation may be inspect-only. */
  clear?(scene: unknown): void;
  /** Live crowd-agent snapshots for debug draw. Empty when no crowd. */
  crowdAgents?(): NavCrowdAgentState[];
}

/** One node in an audio-graph snapshot (W3c, the Audio debugger tab). Edges
 *  point DOWNSTREAM: `outputs` holds the ids of nodes this node's output
 *  feeds (ultimately reaching the `destination` node). */
export interface AudioGraphNode {
  id: string;
  /** Node class/constructor name (`'GainNode'`, `'Gain'` for a Tone node,
   *  `'AudioDestinationNode'`, …) — whatever the implementation truthfully
   *  knows, never a prettified fabrication. */
  type: string;
  /** Human-facing label (`'Master'`, `'Music bus'`) when one exists. */
  label?: string;
  /** ids of downstream nodes this node's output connects to. */
  outputs: string[];
  /** Lifecycle/playback state when truthfully known (`'running'`,
   *  `'suspended'`, `'started'`…). OMITTED — never fabricated — otherwise. */
  state?: string;
}

/** Musical-transport snapshot for the Audio debugger's transport strip
 *  (W3c). The first-party implementation reads Tone's real transport. */
export interface AudioTransportState {
  state: 'started' | 'stopped' | 'paused';
  /** Playback position along the transport's timeline, seconds. */
  seconds: number;
  bpm: number;
  /** Musical position (`Bars:Beats:Sixteenths`) when a musical grid exists. */
  position?: string;
}

/** One bus level sample: `level` is linear RMS over the implementation's most
 *  recent analysis window (0 = silence; ~1 = full-scale). */
export interface AudioMeterFrame {
  id: string;
  label: string;
  level: number;
}

/** A live metering session. Metering costs real audio nodes (Tone.Meter /
 *  AnalyserNode taps), so it is ACQUIRED for exactly as long as a meter UI is
 *  visible and MUST be released via `dispose()` — the first-party handle
 *  disconnects its analyser taps there (no leaked nodes after Stop). */
export interface AudioMeterHandle {
  /** Current level per bus. Cheap enough to poll at UI rate (~10 Hz). */
  read(): AudioMeterFrame[];
  /** Release the metering nodes. Idempotent. */
  dispose(): void;
}

/** One entry in the audio event ring (W3c). `seq` is an adapter-lifetime
 *  MONOTONIC counter — the same ring-buffer fence discipline as
 *  `NetMessageEvent.seq` / `DebugAdapter.events`. `time` is a
 *  `performance.now()`-domain ms timestamp at capture. `'error'` is reserved
 *  for implementations that can truthfully report one (the first-party
 *  adapter has no honest audio-error source today and never emits it). */
export interface AudioDebugEvent {
  seq: number;
  time: number;
  kind:
    | 'transport-start'
    | 'transport-stop'
    | 'transport-pause'
    | 'context-statechange'
    | 'mute'
    | 'unmute'
    | 'error';
  detail?: string;
}

/**
 * Silence/restore a world's own audio (D10, T7.6) — NOT a mixer/bus API. This
 * is the seam `Game.play.pause()` calls so a paused world's audio goes quiet
 * too ("an audio seam in `SystemAdapters` so pause can silence game audio
 * (howler et al.) or explicitly report it cannot"). Absence on a world's
 * `mounted.systems` means exactly that: `Game.play.pause()` reports it loudly
 * once per world rather than silently leaving that world's audio playing under
 * a "paused" game.
 *
 * The OPTIONAL methods below are the W3c read-only INTROSPECTION capabilities
 * feeding the editor's Audio debugger tab (graph / transport / meters /
 * events). They follow the W3a degradation ladder: an implementer omits what
 * it cannot truthfully provide, and the editor marks that section absent —
 * never fabricated. The full MIXER (sends/effects/gain editing) is SQ-4-gated
 * and deliberately NOT part of this seam. The first-party implementation over
 * the engine's own Tone/Web-Audio stack is
 * `packages/game-runtime/src/audio/audio-introspection.ts`; pre-existing
 * mute-only registrants keep compiling untouched (every addition is
 * optional).
 */
export interface AudioAdapter {
  /** Resume/unlock this adapter's real audio context from a user gesture.
   * Optional for external adapters that do not own a resumable Web Audio
   * context; first-party edit and play adapters both provide it. */
  resume?(): void;
  /** `true` silences this world's audio; `false` restores it to whatever
   *  level it was at before silencing (an implementer's own concern — the
   *  first-party adapter restores its master-gain value, not a hardcoded 1). */
  setMuted(muted: boolean): void;
  /** Current muted state, for inspection (editor mute UI, proofs). */
  isMuted(): boolean;
  /** Optional: current audio-graph snapshot (active nodes + downstream
   *  edges). The first-party adapter reports the engine bus hierarchy plus
   *  every Tone node routed through `connectToneBusToMasterGain` — it cannot
   *  see a game's private Tone-internal wiring and does not pretend to. */
  graphSnapshot?(): AudioGraphNode[];
  /** Optional: musical-transport snapshot. Returns `null` — an honest
   *  "this world has no musical transport" — when none is active (e.g. the
   *  first-party adapter when the game never bridged Tone onto this world's
   *  context). Method ABSENT means the capability itself is unsupported. */
  transportState?(): AudioTransportState | null;
  /** Optional: begin a per-bus metering session. Returns `null` when the
   *  environment cannot meter (headless world with no real AudioContext) —
   *  the UI says so rather than showing frozen zeros. */
  acquireMeters?(): AudioMeterHandle | null;
  /** Optional: tap the real mixed output for a gameplay recording. The
   * returned stream is the implementation's native browser audio stream; the
   * caller must dispose the tap when recording ends. Absence means video can
   * still be recorded, honestly without an audio track. */
  acquireRecordingStream?(): AudioRecordingHandle | null;
  /**
   * Optional: render this world's audio for the ABSOLUTE/canonical sim range
   * `[start, end)` OFFLINE and deterministically — the fixed-step sibling of
   * `acquireRecordingStream` above. That one taps the speakers in WALL time,
   * which is exactly what the editor's fixed-step video export
   * (`packages/editor/src/gameplay-export.ts`) may not do: a paused run that
   * is stepped frame by frame emits no real-time audio at all, and anything
   * captured from a live context would vary run to run. This returns PCM for
   * a sim window instead, so identical `(start, end)` on an unchanged score
   * must return identical samples.
   *
   * THE OFFSET TRAP (the gameplay export states it at its call site; quoted
   * here because this is the other place implementers read):
   * an offline render of `[10, 10.72)` schedules its first event at LOCAL
   * time 0, not absolute 10. The caller reasons in canonical time, so the
   * implementation must subtract `start` from every scheduled event time.
   * The export places the returned buffer at local timestamp 0 of the clip.
   *
   * CLAMP THE SUBTRACTION AT ZERO. Measured 2026-09-19 against a working
   * implementation: a sim clock ACCUMULATES its fixed step, so `start` for
   * tick 900 arrives as 15.000000000000036, not 15. An event authored at
   * exactly 15 then schedules at -3.6e-14 and Web Audio throws outright
   * ("Time must be a finite non-negative number"). An event at or
   * infinitesimally before the window start belongs at local 0.
   *
   * Absent — the honest default, and what the first-party master-gain adapter
   * reports — means the export writes a video-only file and says `audio:
   * false` in its result. A live Web Audio graph cannot be re-rendered
   * offline by a bus wrapper; a world that wants export audio owns a
   * deterministic score and binds this through `vgai.adapter.ts` (with the
   * `music` capability that is one line over `renderToneOffline`).
   */
  renderOffline?: OfflineAudioRenderer;
  /** Optional: the audio event ring (bounded, drops oldest). `sinceSeq`
   *  filters to `seq > sinceSeq` — the consumer's fence. */
  audioEvents?(sinceSeq?: number): AudioDebugEvent[];
}

/** One temporary tap of an audio adapter's mixed output. */
export interface AudioRecordingHandle {
  readonly stream: MediaStream;
  dispose(): void;
}

/** One native camera known to a runtime camera controller.
 *
 * `id` is the controller's own stable key (a shot name, virtual-camera id,
 * etc.). `nativeId` is OPTIONAL identity from the underlying scene object —
 * Three.js implementations normally use `Object3D.uuid`; another adapter may
 * use its renderer's equivalent. The editor uses it only to correlate an
 * already-selected native camera with this read-only runtime projection. */
export interface CameraRuntimeCamera {
  id: string;
  label: string;
  nativeId?: string;
  /** Optional because ownership/cut controllers do not necessarily arbitrate
   * by priority. A camera brain that does may expose the real value it uses. */
  priority?: number;
  enabled?: boolean;
}

/** A transition the controller is evaluating now. Plain data only: no
 * renderer camera, tween, graph node, or editor-authored state crosses the
 * seam. */
export interface CameraRuntimeTransition {
  fromCameraId: string | null;
  toCameraId: string;
  durationSeconds: number;
  elapsedSeconds: number;
  progress: number;
}

/** Read-only runtime state for a selected native camera's Inspector section.
 * Runtime follow/aim/collision stays project behavior; this snapshot merely
 * reports what that behavior already decided. */
export interface CameraRuntimeSnapshot {
  cameras: readonly CameraRuntimeCamera[];
  activeCameraId: string | null;
  /** The behavior/cinematic currently allowed to drive the rendered camera. */
  activeControllerId: string | null;
  ownershipDepth: number;
  transition: CameraRuntimeTransition | null;
}

/** Camera-controller INTROSPECTION — not a camera graph or controller API.
 *
 * Games continue to author ordinary native cameras and drive them with their
 * own TS/TSX. A controller registers this adapter only when it can truthfully
 * expose its active camera, priority and blend state. Absence hides the
 * runtime UI; the editor never infers a brain from scene structure. */
export interface CameraAdapter {
  snapshot(): CameraRuntimeSnapshot;
  subscribe(listener: () => void): Unsubscribe;
}

/** One tick-stamped debug event (`ctx.debug.emit`, spec §3.3): `tick`/`simT`
 *  are the engine's own counters AT EMISSION, so events and state reads
 *  correlate frame-exactly across every door (in-page bridge, relay, panels).
 *
 *  `seq` (run-4 friction #5 fix) is a registry-lifetime MONOTONIC counter,
 *  strictly increasing by one per `emit()` call regardless of `tick` —
 *  unlike `tick`, it is never shared by two events, which is what makes it
 *  safe to fence on. A debug command handler runs BETWEEN ticks (its
 *  emissions carry whatever `tick` is current at that instant, same as every
 *  other emission at that instant would), so two DIFFERENT events — or an
 *  event and a consumer's fence point — can legitimately share one `tick`;
 *  `seq` never collides the same way, so "everything after what I've already
 *  observed" is unambiguous. See `events(sinceSeq)` below. */
export interface TickStampedEvent {
  tick: number;
  simT: number;
  event: string;
  detail?: unknown;
  seq: number;
}

/** One registered debug command's listing shape — `locus` is always present
 *  (defaults to `'client'` when a command didn't declare one) so every
 *  listing surface can print it without a fallback of its own. */
export interface DebugCommandInfo {
  name: string;
  description?: string | undefined;
  /** JSON-Schema projection of the command's Zod args tuple, when declared. */
  argsJsonSchema?: unknown;
  locus: 'client' | 'server';
}

/**
 * The debug/synthetic-player seam: game-scoped introspection + actuation
 * over whatever a game registers via `ctx.debug`
 * (`registerStateProvider`/`registerCommand`/`emit`). NOT a gameplay API —
 * this is the one seam the debug bridge, the editor's Debug Console/State
 * Watch panels, and `@vgai/live` all read/drive through.
 */
export interface DebugAdapter {
  providers(): { name: string; tier: 'observable' | 'assisted' }[];
  /** One provider's current value. Throws `DebugError` code
   *  `STATE_PROVIDER_NOT_FOUND` (`data.registered`) for an unknown name. */
  state(name: string): unknown;
  /** One coherent snapshot of every registered provider — a throwing
   *  provider contributes `{ __error: String(err) }` for its own key rather
   *  than failing the whole snapshot. */
  stateAll(): Record<string, unknown>;
  commands(): DebugCommandInfo[];
  /** Validates `args` against the command's declared Zod tuple (when
   *  present), then awaits the registered fn. Throws `DebugError` code
   *  `DEBUG_COMMAND_NOT_REGISTERED` for an unknown name,
   *  `DEBUG_COMMAND_ARGS_INVALID` for a validation failure, or
   *  `DEBUG_COMMAND_FAILED` wrapping anything the command itself threw. */
  invoke(name: string, args: unknown[]): Promise<unknown>;
  /** The tick-stamped event ring (cap 500, drops oldest).
   *
   *  - `sinceSeq` given (run-4 friction #5 fix): filters to `seq > sinceSeq`
   *    — the unambiguous fence for "everything emitted after what I've
   *    already observed" (see `TickStampedEvent.seq`'s doc comment for why
   *    `tick` alone can't do this: a debug-command emission and a consumer's
   *    fence point can share one tick).
   *  - Omitted: the whole ring.
   *
   *  There was a second, KNOWN-DEFECTIVE `sinceTick` parameter (`tick >
   *  sinceTick`, which silently dropped same-tick events) kept for
   *  back-compat after the seq fix. It is REMOVED — a fence is `seq` or
   *  nothing. */
  events(sinceSeq?: number): TickStampedEvent[];
}

/**
 * Read-only render-debugging introspection (W4b, F11 frame debugger +
 * profiler) — NOT a renderer. `captureFrame` arms the first-party WebGL2
 * capture (`dev/webgl-frame-capture.ts`) and resolves with the NEXT rendered
 * frame's draw list, attributed by wrapping each renderable's `onBeforeRender`
 * (three calls it immediately before that object's main-pass draw; shadow/
 * composer-pass draws stay unattributed BY CONSTRUCTION — an honest gap, not a
 * guess). It REJECTS — never fabricates — if no frame renders within a bounded
 * timeout (a paused/stopped world). `memorySnapshot` is the W3a-style OPTIONAL
 * capability: present only when the mount can supply `renderer.info` (a
 * headless mount omits it, and the editor marks the section absent).
 */
export interface RenderDebugAdapter {
  captureFrame(): Promise<FrameCapture>;
  memorySnapshot?(): RenderMemorySnapshot;
}

/**
 * A physics carrier in EITHER surface's vocabulary — node-id keyed for a three
 * world, display-object keyed for a canvas one. Tagged by `keyedBy`; see
 * {@link PhysicsAdapter}'s comment for why, and use the two narrowings below
 * rather than reading the tag directly.
 */
export type PhysicsCarrier = PhysicsAdapter | PhysicsAdapter2D;

/** The carrier a NODE-ID-keyed consumer may call, or `null` — including when
 *  the slot holds a display-keyed carrier, which such a consumer must not
 *  call and cannot correctly address. */
export function nodeKeyedPhysics(
  carrier: PhysicsCarrier | null | undefined,
): PhysicsAdapter | null {
  if (!carrier) return null;
  return isDisplayKeyedPhysics(carrier) ? null : carrier;
}

/** The carrier a DISPLAY-keyed consumer may call, or `null`. Mirror of
 *  {@link nodeKeyedPhysics}. */
export function displayKeyedPhysics(
  carrier: PhysicsCarrier | null | undefined,
): PhysicsAdapter2D | null {
  if (!carrier) return null;
  return isDisplayKeyedPhysics(carrier) ? carrier : null;
}

function isDisplayKeyedPhysics(carrier: PhysicsCarrier): carrier is PhysicsAdapter2D {
  return carrier.keyedBy === 'display';
}

/**
 * The set of optional subsystem providers a mounted game may expose. Absence of
 * a provider means "capability not supported" — the editor degrades gracefully.
 */
export interface SystemAdapters {
  physics?: PhysicsCarrier;
  networking?: NetworkingAdapter;
  navigation?: NavigationAdapter;
  audio?: AudioAdapter;
  camera?: CameraAdapter;
  debug?: DebugAdapter;
  renderDebug?: RenderDebugAdapter;
}
