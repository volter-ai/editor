/**
 * Active system adapters the editor's authoring path coordinates with.
 *
 * A mounted game may expose `SystemAdapters` (physics / networking / …). The
 * editor's gizmo-commit (through the `AuthoringAdapter.transforms` provider)
 * consults THESE so it can:
 *   - freeze a physics-owned body while the gizmo edits it, then commit the edited
 *     pose to the body and resume (the `PhysicsAdapter` frozen-edit mode);
 *   - report a network-owned object's authority and keep remote/server-authoritative
 *     objects inspect-only (`NetworkingAdapter`).
 *
 * Play-mode (first-party) installs the first-party `RapierPhysicsAdapter` /
 * `ColyseusNetworkingAdapter` here on enter and clears them on exit; an ingested
 * game would install its own. The editor never names Rapier/Colyseus — only the
 * `PhysicsAdapter` / `NetworkingAdapter` interfaces.
 */

import type { SystemAdapters } from '@volter/editor-project/adapter';
import { nodeKeyedPhysics, type PhysicsAdapter } from '@volter/editor-project/adapter/system-adapter';
import { inspectSystemAdapterSeam } from '@volter/editor-sdk/kit/system-seam-evidence';

let _systems: SystemAdapters = {};
let _editModeAudio: SystemAdapters['audio'] | null = null;
let _editModeNetworking: SystemAdapters['networking'] | null = null;
const _networkingListeners = new Set<() => void>();
const _audioListeners = new Set<() => void>();
const _navigationListeners = new Set<() => void>();
let _audioVersion = 0;

function notifyNavigationChanged(): void {
  for (const listener of _navigationListeners) listener();
}

function notifyNetworkingChanged(previous: SystemAdapters['networking'] | null): void {
  if (previous === getActiveNetworking()) return;
  for (const listener of _networkingListeners) listener();
}

function notifyAudioChanged(
  previous: SystemAdapters['audio'] | null,
  previousAll: readonly NonNullable<SystemAdapters['audio']>[],
): void {
  const nextAll = getAllActiveAudio();
  if (
    previous === getActiveAudio() &&
    previousAll.length === nextAll.length &&
    previousAll.every((adapter, index) => adapter === nextAll[index])
  )
    return;
  _audioVersion++;
  for (const listener of _audioListeners) listener();
}

/**
 * MULTI-INSTANCE: every mounted instance's adapters, keyed by mount id.
 *
 * Three DIFFERENT questions are asked of this module and conflating them is the
 * bug to avoid:
 *
 *   - "the PRIMARY authoring mount" — hierarchy selection, gizmo commit, and
 *     source-backed editing. That is what {@link getActiveSystems} continues
 *     to mean; a runtime-context click must never retarget source authoring.
 *   - "the instance whose RUNTIME I am inspecting" — Profiler, Frame, Audio,
 *     Network, and runtime status. {@link getInspectedSystems} follows the
 *     explicit Inspect selector (and the normal click-to-focus gesture).
 *   - "the instance I ADDRESSED" — the CLI session wire
 *     (`vgai eval`/`e2e` → `command-listener.ts`). With one instance the two
 *     coincide, which is exactly why a single `let` worked and why nothing
 *     noticed it was implicit; with several, resolving an addressed command
 *     through editor focus would let a bot drive whichever game the user last
 *     clicked. {@link systemsForInstance} answers this one.
 */
const _byInstance = new Map<string, SystemAdapters>();
let _inspectedInstanceId: string | null = null;
let _inspectedVersion = 0;
const _inspectedListeners = new Set<() => void>();

/** The mount id of a single-instance session. */
const SOLO_INSTANCE = '';

function assertSystemAdapterShapes(systems: SystemAdapters, mountId: string): void {
  const slots = [
    'physics',
    'networking',
    'navigation',
    'audio',
    'camera',
    'debug',
    'renderDebug',
  ] as const satisfies readonly (keyof SystemAdapters)[];
  for (const slot of slots) {
    const adapter = systems[slot];
    if (!adapter) continue;
    const verdict = inspectSystemAdapterSeam({
      slot,
      adapter: adapter as NonNullable<SystemAdapters[typeof slot]>,
      subject: mountId || 'game',
    });
    if (verdict.state === 'failed') {
      throw new Error(`system adapter refused: ${verdict.detail}`);
    }
  }
}

function resolvedInspectedInstanceId(): string | null {
  if (_inspectedInstanceId !== null && _byInstance.has(_inspectedInstanceId)) {
    return _inspectedInstanceId;
  }
  return _byInstance.keys().next().value ?? null;
}

function notifyInspectedSystems(): void {
  _inspectedVersion++;
  for (const listener of _inspectedListeners) listener();
}

/** Select which live mount the runtime instruments inspect. This never changes
 * the authoring adapter, hierarchy, scene selection, or addressed automation. */
export function setInspectedInstance(mountId: string | null): void {
  const previous = resolvedInspectedInstanceId();
  _inspectedInstanceId = mountId;
  if (previous !== resolvedInspectedInstanceId()) {
    notifyInspectedSystems();
    _audioVersion++;
    for (const listener of _networkingListeners) listener();
    for (const listener of _audioListeners) listener();
  }
}

export function inspectedInstanceId(): string | null {
  return resolvedInspectedInstanceId();
}

export function subscribeInspectedInstance(listener: () => void): () => void {
  _inspectedListeners.add(listener);
  return () => _inspectedListeners.delete(listener);
}

export function inspectedInstanceVersion(): number {
  return _inspectedVersion;
}

export function getInspectedSystems(): SystemAdapters {
  const id = resolvedInspectedInstanceId();
  return (id === null ? undefined : _byInstance.get(id)) ?? _systems;
}

/** Install a mounted game's System adapters (play-mode on enter).
 *
 *  `mountId` omitted is the solo case — today's every caller. Passing `null`
 *  systems unregisters the instance, so a stopped instance stops being
 *  addressable rather than lingering as an empty bag that answers commands. */
export function setActiveSystems(systems: SystemAdapters | null, mountId = SOLO_INSTANCE): void {
  const previousInspected = resolvedInspectedInstanceId();
  const previousNetworking = getActiveNetworking();
  const previousAudio = getActiveAudio();
  const previousAllAudio = getAllActiveAudio();
  if (systems) {
    assertSystemAdapterShapes(systems, mountId);
    _byInstance.set(mountId, systems);
    // Preserve the historical primary-authoring aggregate. Runtime instruments
    // resolve through `_inspectedInstanceId` instead of silently inheriting it.
    _systems = systems;
    notifyNetworkingChanged(previousNetworking);
    notifyAudioChanged(previousAudio, previousAllAudio);
    notifyNavigationChanged();
    if (previousInspected !== resolvedInspectedInstanceId()) notifyInspectedSystems();
    return;
  }
  _byInstance.delete(mountId);
  // Unregistering a seat must NOT blank editor focus while OTHER instances are
  // still live — that reset `_systems = {}` left mute/debug/profiler/gizmo dead
  // for the rest of a split session when any additional seat was removed. Fall
  // back to a remaining instance (the primary is the first-inserted entry) and
  // only go empty when the last instance is gone.
  _systems = _byInstance.values().next().value ?? {};
  notifyNetworkingChanged(previousNetworking);
  notifyAudioChanged(previousAudio, previousAllAudio);
  notifyNavigationChanged();
  if (previousInspected !== resolvedInspectedInstanceId()) notifyInspectedSystems();
}

/**
 * Unregister EVERY instance — the previous project's session is over.
 * Registered with `onProjectSessionEnd`.
 *
 * Instances are unregistered one at a time by the mount that owns them, and a
 * project switch is the one path that ends every mount at once without any of
 * them running its own teardown. A registry left populated across a switch
 * keeps the OLD game's physics/networking/audio/debug adapters answering the
 * gizmo, the instruments and the CLI wire under the new project.
 *
 * Routed through `setActiveSystems(null, id)` per instance rather than clearing
 * the map, so the networking/audio/navigation/inspected notifications fire
 * exactly as they do for a normal unregister.
 */
export function resetActiveSystemsForNewProject(): void {
  for (const id of [..._byInstance.keys()]) setActiveSystems(null, id);
  setInspectedInstance(null);
}

/** Refresh one mounted instance's late-registered adapters without stealing
 * editor focus from a different instance. */
export function updateInstanceSystems(systems: SystemAdapters, mountId = SOLO_INSTANCE): void {
  const previousNetworking = getActiveNetworking();
  const previousAudio = getActiveAudio();
  const previousAllAudio = getAllActiveAudio();
  const previousSystems = _byInstance.get(mountId);
  assertSystemAdapterShapes(systems, mountId);
  _byInstance.set(mountId, systems);
  if (_systems === previousSystems) _systems = systems;
  notifyNetworkingChanged(previousNetworking);
  notifyAudioChanged(previousAudio, previousAllAudio);
  notifyNavigationChanged();
  if (resolvedInspectedInstanceId() === mountId) notifyInspectedSystems();
}

/** The primary AUTHORING mount's adapters — hierarchy/gizmo/source consumers. */
export function getActiveSystems(): SystemAdapters {
  return _systems;
}

/** Observe replacement or late registration of the primary authoring mount's
 * navigation adapter. The navmesh UI binds to this instead of constructing an
 * editor-owned navigation implementation. */
export function subscribeActiveNavigation(listener: () => void): () => void {
  _navigationListeners.add(listener);
  return () => _navigationListeners.delete(listener);
}

/** Live instance ids, for error messages and for the CLI's own listing. */
export function liveInstanceIds(): string[] {
  return [..._byInstance.keys()];
}

/**
 * The live ids as a reader can ACT on them.
 *
 * The solo instance's id is the empty string, so the obvious
 * `ids.map(i => `"${i}"`)` renders it as `live instances: ""` — an id nobody
 * can name, in the message whose entire job is to say what to name instead.
 * Found by driving a real editor; every unit test used named instances and
 * none of them could see it.
 */
function describeInstances(ids: readonly string[]): string {
  const named = ids.filter((id) => id !== SOLO_INSTANCE);
  const hasSolo = ids.length > named.length;
  const parts = named.map((id) => `"${id}"`);
  if (hasSolo) parts.push('the unnamed default (address it with no id at all)');
  return parts.join(', ');
}

/** Raised when an addressed command cannot name exactly one instance. Carries
 *  the live ids so the caller can say WHICH, never just "ambiguous". */
export class InstanceResolutionError extends Error {
  readonly instances: string[];
  constructor(message: string, instances: string[]) {
    super(message);
    this.name = 'InstanceResolutionError';
    this.instances = instances;
  }
}

/**
 * Resolve an ADDRESSED instance's adapters for the session wire.
 *
 * The rule deliberately mirrors `vgai edit`'s session selection rather than
 * inventing a second one: take the unambiguous case silently, refuse the
 * ambiguous one BY NAME, and never guess.
 *
 *   - explicit id      → that instance, or a named error listing what exists;
 *   - omitted, one     → that one (every existing call is unchanged);
 *   - omitted, several → refuse, naming the live instances.
 *
 * The last is the point. Silently picking the newest is how a bot drives the
 * wrong player while every log line still reads as success — the failure is
 * invisible in exactly the situation multi-instance exists to create.
 */
export function systemsForInstance(mountId?: string): SystemAdapters {
  const ids = liveInstanceIds();
  if (mountId !== undefined) {
    const found = _byInstance.get(mountId);
    if (found) return found;
    throw new InstanceResolutionError(
      ids.length === 0
        ? `no instance "${mountId}" — no game is mounted`
        : `no instance "${mountId}" — live: ${describeInstances(ids)}`,
      ids,
    );
  }
  if (ids.length === 1) return _byInstance.get(ids[0]!)!;
  if (ids.length === 0) return _systems; // global adapters before a root instance registers
  throw new InstanceResolutionError(
    `${ids.length} instances are live (${describeInstances(ids)}) — ` +
      'name one in your program (`game.instance(id)`, or `await game.instances()` ' +
      'for handles); refusing to guess',
    ids,
  );
}

/**
 * The focused game's physics carrier AS A NODE-ID-KEYED ONE — `null` when the
 * slot holds a canvas mount's display-keyed carrier
 * (`@vgai/game-runtime/pixi/system-adapters`).
 *
 * That narrowing is the point rather than a formality: this registry is
 * game-scoped and surface-blind, so with a canvas game focused the slot really
 * can hold a carrier whose `freeze(display: Container)` a three consumer would
 * be calling with a node-id string. The canvas lane never reads this — its
 * gizmo path holds its own carrier (`ingest/mount-canvas-ingest-root.ts` →
 * `authoring/pixi-live-write-target.ts`), already resolved to display objects.
 */
export function getActivePhysics(): PhysicsAdapter | null {
  return nodeKeyedPhysics(_systems.physics);
}

/** The focused game's optional camera-controller introspection seam. Camera
 * authoring itself stays on the active AuthoringAdapter; this is runtime-only
 * ownership/priority/blend state for the selected native camera. */
export function getActiveCamera(): NonNullable<SystemAdapters['camera']> | null {
  return _systems.camera ?? null;
}

export function getActiveNetworking(): NonNullable<SystemAdapters['networking']> | null {
  return _systems.networking ?? _editModeNetworking ?? null;
}

export function getInspectedNetworking(): NonNullable<SystemAdapters['networking']> | null {
  return getInspectedSystems().networking ?? _editModeNetworking ?? null;
}

/** Observe replacement of the effective networking adapter. Runtime adapters
 * may register after Play has entered, so consumers must be able to move off
 * the edit-time declaration and onto the live room without polling. */
export function subscribeActiveNetworking(listener: () => void): () => void {
  _networkingListeners.add(listener);
  return () => _networkingListeners.delete(listener);
}

/** Install the editor's edit-time networking seam — the declared server config
 *  and authored player identity a multiplayer project exposes with no game
 *  running. Play-mode's `setActiveSystems` temporarily overrides it with the
 *  mounted game's live adapter; on Stop, `getActiveNetworking()` falls back to
 *  this one. Passing `null` clears it (a project with no declared server never
 *  installs one, so networking presence stays meaningful). Mirrors
 *  `setEditModeAudio`. */
export function setEditModeNetworking(networking: SystemAdapters['networking'] | null): void {
  const previousNetworking = getActiveNetworking();
  _editModeNetworking = networking;
  notifyNetworkingChanged(previousNetworking);
}

/** The active game's debug seam (`DebugAdapter`) —
 *  installed with the whole bag by play-mode's `setActiveSystems`, read by
 *  the State Watch utility and the CLI command relay. Null
 *  outside play (or for a mount exposing no debug adapter) — the panels'
 *  hide signal. */
export function getActiveDebug(): SystemAdapters['debug'] | null {
  return _systems.debug ?? null;
}

/** Install the editor project's real first-party audio graph. Play-mode may
 *  temporarily override it with the mounted game's adapter; clearing the
 *  session restores this edit-mode adapter instead of making audio disappear. */
export function setEditModeAudio(audio: SystemAdapters['audio'] | null): void {
  const previousAudio = getActiveAudio();
  const previousAllAudio = getAllActiveAudio();
  _editModeAudio = audio;
  notifyAudioChanged(previousAudio, previousAllAudio);
}

/** The active audio seam (`AudioAdapter` + W3c introspection capabilities).
 *  A running game's adapter takes precedence; otherwise the editor project's
 *  real audio graph remains available for authoring and preview. */
export function getActiveAudio(): SystemAdapters['audio'] | null {
  return _systems.audio ?? _editModeAudio;
}

export function getInspectedAudio(): SystemAdapters['audio'] | null {
  return getInspectedSystems().audio ?? _editModeAudio;
}

/** Observe replacement of the effective audio adapter. Header telemetry and
 * the Audio debugger acquire real meter handles whose lifetime must follow
 * that identity exactly; polling adapter identity would leave analyser taps
 * attached for up to a tick after a world was replaced. */
export function subscribeActiveAudio(listener: () => void): () => void {
  _audioListeners.add(listener);
  return () => _audioListeners.delete(listener);
}

/** `useSyncExternalStore` snapshot for {@link subscribeActiveAudio}. */
export function activeAudioVersion(): number {
  return _audioVersion;
}

/** EVERY live instance's audio adapter (plus edit-mode audio when nothing is
 *  playing). Mute must silence the WHOLE split — with N seats, muting only the
 *  focused/primary one leaves the other N-1 games audible with no way to
 *  quiet them. De-duplicated by identity (seats may share an adapter). */
export function getAllActiveAudio(): NonNullable<SystemAdapters['audio']>[] {
  const out = new Set<NonNullable<SystemAdapters['audio']>>();
  for (const systems of _byInstance.values()) {
    if (systems.audio) out.add(systems.audio);
  }
  if (out.size === 0 && _editModeAudio) out.add(_editModeAudio);
  return [...out];
}

/** The active game's render-debug seam (`RenderDebugAdapter` + the W4b F11
 *  frame-capture / render-memory capabilities) — installed with the whole bag
 *  by play-mode's `setActiveSystems`, read by the Frame debugger tab and the
 *  Profiler's Memory view. Null outside a running game session, or for a
 *  headless/non-real-context mount that registers none (the surface renders
 *  the honest register-an-adapter notice; it never fabricates a draw list). */
export function getActiveRenderDebug(): SystemAdapters['renderDebug'] | null {
  return _systems.renderDebug ?? null;
}

export function getInspectedRenderDebug(): SystemAdapters['renderDebug'] | null {
  return getInspectedSystems().renderDebug ?? null;
}
