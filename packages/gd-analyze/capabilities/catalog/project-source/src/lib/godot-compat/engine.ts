import { godotDictionary, type GodotDictionary } from './variant';
import { GODOT_JAVASCRIPT_BRIDGE_SINGLETON } from './javascript-bridge';
import type { GodotRenderInfoReader } from './render-info';
import { packedStringArray, type PackedStringArray } from './packed-array';

/** Godot's `Engine` singleton facts that belong to the exported Player target. */

/**
 * `Engine.editor_hint` / `Engine.is_editor_hint()`.
 *
 * The translated game is the browser Player build, never a running Godot
 * editor. Godot 3.6's `Engine::is_editor_hint()` returns the engine-owned
 * editor hint flag, which the editor sets for its own scene/tool execution;
 * an exported Player leaves it false. This is target data, not a heuristic
 * based on the browser host or a compat-owned mutable flag.
 */
export function godotEngineEditorHint(): boolean {
  return false;
}

/** Browser exports target WebAssembly's 32-bit address space in both pinned engine generations. */
export function godotEngineArchitectureName(): string {
  return 'wasm32';
}

type GodotMajor = 3 | 4;

const GODOT_ENGINE_VERSION = {
  3: {
    major: 3,
    minor: 6,
    patch: 2,
    hex: 0x030602,
    status: 'stable',
    build: 'official',
    year: 2025,
    hash: '3cd3caab6779a7f3ec3bbeb9f200db50c735cfc8',
    string: '3.6.2-stable (official)',
  },
  4: {
    major: 4,
    minor: 7,
    patch: 0,
    hex: 0x040700,
    status: 'stable',
    build: 'official',
    hash: '5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88',
    timestamp: 0,
    string: '4.7-stable (official)',
  },
} as const satisfies Record<GodotMajor, Readonly<Record<string, string | number>>>;

/**
 * `Engine.get_version_info()` from pinned 3.6.2 `core/engine.cpp` and 4.7
 * `core/config/engine.cpp`. Each call returns a new Dictionary value. Godot 3 owns `year`; Godot 4
 * replaces it with the integer build `timestamp`. The pinned official build name and source hash
 * are the target facts, rather than facts about the VGAI editor hosting the translated Player.
 */
export function godotEngineVersionInfo(major: GodotMajor): GodotDictionary<string, string | number> {
  const version = GODOT_ENGINE_VERSION[major];
  return godotDictionary(Object.entries(version));
}

/**
 * `Engine.get_main_loop()` returns the installed MainLoop pointer. A translated game installs one
 * SceneTree, so preserve that existing identity rather than manufacturing a facade.
 */
export function godotEngineMainLoop<T>(tree: T): T {
  return tree;
}

const ENGINE_SINGLETONS = new WeakMap<object, Map<string, object>>();

function singletonName(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('Engine singleton name requires a non-empty StringName.');
  }
  return value;
}

function singletonMap(owner: object): Map<string, object> {
  let singletons = ENGINE_SINGLETONS.get(owner);
  if (singletons === undefined) {
    singletons = new Map([['JavaScriptBridge', GODOT_JAVASCRIPT_BRIDGE_SINGLETON]]);
    ENGINE_SINGLETONS.set(owner, singletons);
  }
  return singletons;
}

/** The translated Player's engine-owned registry for script-registered singleton identities. */
export function godotEngineRegisterSingleton(owner: object, name: unknown, instance: unknown): void {
  if (typeof instance !== 'object' || instance === null) {
    throw new TypeError('Engine.register_singleton requires a retained Object instance.');
  }
  const key = singletonName(name);
  const singletons = singletonMap(owner);
  if (singletons.has(key)) throw new Error(`Engine singleton ${key} is already registered.`);
  singletons.set(key, instance);
}

export function godotEngineHasSingleton(owner: object, name: unknown): boolean {
  return singletonMap(owner).has(singletonName(name));
}

export function godotEngineGetSingleton(owner: object, name: unknown): object | null {
  return singletonMap(owner).get(singletonName(name)) ?? null;
}

/** Removes a script-registered singleton without disturbing built-in browser services. */
export function godotEngineUnregisterSingleton(owner: object, name: unknown): void {
  const key = singletonName(name);
  if (key === 'JavaScriptBridge') {
    throw new Error('Engine.unregister_singleton cannot remove the built-in JavaScriptBridge singleton.');
  }
  if (!singletonMap(owner).delete(key)) {
    throw new Error(`Engine singleton ${key} is not registered.`);
  }
}

/** Snapshot of all engine singleton names in deterministic registration order. */
export function godotEngineGetSingletonList(owner: object): PackedStringArray {
  return packedStringArray(singletonMap(owner).keys());
}

interface GodotEngineRuntimeState {
  maxPhysicsStepsPerFrame: number;
  physicsJitterFix: number;
  inPhysicsFrame: boolean;
  printToStdout: boolean;
  printErrorMessages: boolean;
  scriptLanguages: object[];
}

const ENGINE_RUNTIME = new WeakMap<object, GodotEngineRuntimeState>();

function runtimeOf(owner: object): GodotEngineRuntimeState {
  let state = ENGINE_RUNTIME.get(owner);
  if (state !== undefined) return state;
  state = {
    maxPhysicsStepsPerFrame: 8,
    physicsJitterFix: 0.5,
    inPhysicsFrame: false,
    printToStdout: true,
    printErrorMessages: true,
    scriptLanguages: [],
  };
  ENGINE_RUNTIME.set(owner, state);
  return state;
}

export function godotEngineSetMaxPhysicsStepsPerFrame(owner: object, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`Engine.max_physics_steps_per_frame requires a positive integer; received ${String(value)}.`);
  }
  runtimeOf(owner).maxPhysicsStepsPerFrame = value;
}

export function godotEngineGetMaxPhysicsStepsPerFrame(owner: object): number {
  return runtimeOf(owner).maxPhysicsStepsPerFrame;
}

export function godotEngineSetPhysicsJitterFix(owner: object, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`Engine.physics_jitter_fix requires a finite value in [0, 1]; received ${String(value)}.`);
  }
  runtimeOf(owner).physicsJitterFix = value;
}

export function godotEngineGetPhysicsJitterFix(owner: object): number {
  return runtimeOf(owner).physicsJitterFix;
}

/** Seats the exact interval in which translated fixed callbacks are being dispatched. */
export function godotEngineSetInPhysicsFrame(owner: object, active: boolean): void {
  runtimeOf(owner).inPhysicsFrame = active;
}

export function godotEngineIsInPhysicsFrame(owner: object): boolean {
  return runtimeOf(owner).inPhysicsFrame;
}

export function godotEngineSetPrintToStdout(owner: object, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('Engine.print_to_stdout requires bool.');
  runtimeOf(owner).printToStdout = enabled;
}

export function godotEngineIsPrintingToStdout(owner: object): boolean {
  return runtimeOf(owner).printToStdout;
}

export function godotEngineSetPrintErrorMessages(owner: object, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('Engine.print_error_messages requires bool.');
  runtimeOf(owner).printErrorMessages = enabled;
}

export function godotEngineIsPrintingErrorMessages(owner: object): boolean {
  return runtimeOf(owner).printErrorMessages;
}

/** Movie writing belongs to native/editor builds; an exported web Player has no output path. */
export function godotEngineGetWriteMoviePath(): string {
  return '';
}

export function godotEngineRegisterScriptLanguage(owner: object, language: unknown): number {
  if (typeof language !== 'object' || language === null) {
    throw new TypeError('Engine.register_script_language requires a ScriptLanguage Object.');
  }
  const languages = runtimeOf(owner).scriptLanguages;
  if (languages.includes(language)) return 31;
  languages.push(language);
  return 0;
}

export function godotEngineUnregisterScriptLanguage(owner: object, language: unknown): number {
  const languages = runtimeOf(owner).scriptLanguages;
  const index = languages.indexOf(language as object);
  if (index < 0) return 31;
  languages.splice(index, 1);
  return 0;
}

export function godotEngineGetScriptLanguageCount(owner: object): number {
  return runtimeOf(owner).scriptLanguages.length;
}

export function godotEngineGetScriptLanguage(owner: object, index: number): object | null {
  if (!Number.isSafeInteger(index)) throw new TypeError('Engine.get_script_language requires an integer index.');
  return runtimeOf(owner).scriptLanguages[index] ?? null;
}

/** Browser JavaScript stacks are not Godot ScriptBacktrace resources. */
export function godotEngineCaptureScriptBacktraces(_includeVariables = false): readonly unknown[] {
  return [];
}

interface GodotEngineClockState {
  timeScale: number;
  iterationsPerSecond: number;
  iterationsInitialized: boolean;
  targetFps: number;
  targetFrameBank: number;
  lastRawFrameDelta: number;
  physicsInterpolationFraction: number;
  framesPerSecond: number;
  framesInBucket: number;
  secondsInBucket: number;
  processFrames: number;
  physicsFrames: number;
}

const ENGINE_CLOCKS = new WeakMap<object, GodotEngineClockState>();

function clockOf(owner: object): GodotEngineClockState {
  let state = ENGINE_CLOCKS.get(owner);
  if (state !== undefined) return state;
  state = {
    timeScale: 1,
    iterationsPerSecond: 60,
    iterationsInitialized: false,
    targetFps: 0,
    targetFrameBank: 0,
    lastRawFrameDelta: 0,
    physicsInterpolationFraction: 0,
    framesPerSecond: 1,
    framesInBucket: 0,
    secondsInBucket: 0,
    processFrames: 0,
    physicsFrames: 0,
  };
  ENGINE_CLOCKS.set(owner, state);
  return state;
}

/**
 * Start one drawn frame on the host-owned tree clock and return Godot's scaled process delta.
 * Pinned `main.cpp` counts drawn frames in one-second wall-time buckets, while time_scale applies
 * only after the host timer selects the raw process step.
 */
export function godotEngineBeginFrame(owner: object, rawDelta: number): number | undefined {
  if (!Number.isFinite(rawDelta) || rawDelta < 0) {
    throw new RangeError(`Engine frame delta must be finite and non-negative; received ${rawDelta}.`);
  }
  const state = clockOf(owner);
  state.targetFrameBank += rawDelta;
  if (state.targetFps > 0 && state.targetFrameBank + 1e-9 < 1 / state.targetFps) return undefined;
  const frameDelta = state.targetFrameBank;
  state.targetFrameBank = 0;
  state.lastRawFrameDelta = frameDelta;
  state.processFrames += 1;
  state.framesInBucket += 1;
  state.secondsInBucket += frameDelta;
  if (state.secondsInBucket >= 1) {
    state.framesPerSecond = state.framesInBucket;
    state.framesInBucket = 0;
    state.secondsInBucket %= 1;
  }
  return frameDelta * state.timeScale;
}

export function godotEngineAdvancePhysicsFrame(owner: object): void {
  clockOf(owner).physicsFrames += 1;
}

export function godotEngineProcessFrames(owner: object): number {
  return clockOf(owner).processFrames;
}

export function godotEnginePhysicsFrames(owner: object): number {
  return clockOf(owner).physicsFrames;
}

/** Raw wall time consumed by the most recent accepted target-FPS frame. */
export function godotEngineRawFrameDelta(owner: object): number {
  return clockOf(owner).lastRawFrameDelta;
}

/** Scale a fixed physics step without changing the host clock's number of physics iterations. */
export function godotEngineScaleDelta(owner: object, rawDelta: number): number {
  return rawDelta * clockOf(owner).timeScale;
}

/** `Engine.get_frames_per_second()` from the same per-tree drawn-frame bucket. */
export function godotEngineFramesPerSecond(owner: object): number {
  return clockOf(owner).framesPerSecond;
}

function performanceRenderCounter(value: number, member: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Performance.get_monitor received an invalid native ${member} counter.`);
  }
  return value;
}

/**
 * Performance monitors backed by the owners that draw the translated game. TIME_FPS is the same
 * retained drawn-frame bucket as Engine. Three's WebGLRenderer owns calls and primitive counts for
 * the most recently completed native frame; those counters exactly supply Godot 3's 3D vertices /
 * draw calls and Godot 4's total primitives / draw calls. Allocator, object, Canvas and physics
 * counters have no corresponding native owner here and remain loud.
 */
export function godotPerformanceGetMonitor(
  owner: object,
  monitor: number,
  major: GodotMajor,
  readRenderInfo?: GodotRenderInfoReader,
): number {
  if (!Number.isSafeInteger(monitor)) {
    throw new TypeError('Performance.get_monitor requires a Monitor integer.');
  }
  if (monitor === 0) return godotEngineFramesPerSecond(owner);

  const readsNativeRenderInfo = major === 3
    ? monitor === 13 || monitor === 17
    : monitor === 12 || monitor === 13;
  if (!readsNativeRenderInfo) {
    throw new Error(
      `Performance.get_monitor(${String(monitor)}) is unavailable: the browser runtime has no ` +
        'exact Godot allocator, object, Canvas, audio, or physics monitor owner for this value.',
    );
  }
  if (readRenderInfo === undefined) {
    throw new Error(
      `Performance.get_monitor(${String(monitor)}) requires the retained native Three ` +
        'WebGLRenderer counter owner.',
    );
  }

  const info = readRenderInfo();
  if ((major === 3 && monitor === 17) || (major === 4 && monitor === 13)) {
    return performanceRenderCounter(info.calls, 'draw-call');
  }
  const triangles = performanceRenderCounter(info.triangles, 'triangle');
  const lines = performanceRenderCounter(info.lines, 'line');
  const points = performanceRenderCounter(info.points, 'point');
  return major === 3
    ? triangles * 3 + lines * 2 + points
    : triangles + lines + points;
}

/** The fixed step currently selected by Engine.iterations_per_second. The authored project rate
 * seats the clock once; later script writes remain authoritative. */
export function initializeGodotEngineClock(owner: object, authoredIterationsPerSecond: number): void {
  const state = clockOf(owner);
  if (state.iterationsInitialized) return;
  setGodotEngineIterationsPerSecond(owner, authoredIterationsPerSecond);
}

export function godotEnginePhysicsStep(owner: object): number {
  return 1 / clockOf(owner).iterationsPerSecond;
}

export function godotEngineIterationsPerSecond(owner: object): number {
  return clockOf(owner).iterationsPerSecond;
}

export function setGodotEngineIterationsPerSecond(owner: object, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`Engine.iterations_per_second requires a positive integer; received ${String(value)}.`);
  }
  const state = clockOf(owner);
  state.iterationsPerSecond = value;
  state.iterationsInitialized = true;
}

/** Browser rendering remains host-driven; this is the live target requested by the game and is
 * consumed by the emitted frame gate. Zero means uncapped, matching Godot. */
export function godotEngineTargetFps(owner: object): number {
  return clockOf(owner).targetFps;
}

export function setGodotEngineTargetFps(owner: object, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Engine.target_fps requires a non-negative integer; received ${String(value)}.`);
  }
  clockOf(owner).targetFps = value;
}

export function setGodotEnginePhysicsInterpolationFraction(owner: object, value: number): void {
  clockOf(owner).physicsInterpolationFraction = Math.max(0, Math.min(1, value));
}

export function godotEnginePhysicsInterpolationFraction(owner: object): number {
  return clockOf(owner).physicsInterpolationFraction;
}

/** `Engine.time_scale` reads the game scale, not the host/editor user scale. */
export function godotEngineTimeScale(owner: object): number {
  return clockOf(owner).timeScale;
}

/**
 * `Engine.time_scale = value`. Negative scale reaches engine subsystems which have no reversible
 * native clock in this host, so it is refused rather than partially rewinding script time only.
 */
export function setGodotEngineTimeScale(owner: object, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `Engine.time_scale requires a finite non-negative scale in the translated host; received ${value}.`,
    );
  }
  clockOf(owner).timeScale = value;
}
