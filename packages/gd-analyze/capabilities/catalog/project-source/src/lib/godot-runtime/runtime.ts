/**
 * The port-owned runtime stores shared by every translated Godot project.
 *
 * This source is COPIED into a project as a capability. Module scope is therefore project scope:
 * the input manager, deterministic random stream, Control property store, and live observation
 * slots belong to the port, while the translator emits only project data and scene bindings.
 */
import type { AudioAdapter } from '@volter/editor-project/adapter';
import { createSeededRandom, DEFAULT_SEEDED_RANDOM_SEED } from '@volter/game-runtime/core/seeded-random';
import { InputManager } from '@volter/game-runtime/input/input-manager';
import { createControlRuntime } from '../godot-compat/control-state';

export type {
  AuthoredControl,
  ControlRecord,
  ControlSnapshot,
  ControlState,
  GodotControl,
} from '../godot-compat/control-state';
export { createControlState, controlValue } from '../godot-compat/control-state';

export const GODOT_INPUT_MAP_URL = '/inputmaps/default.inputmap.json';
export const gameInput = new InputManager();

let mapRequested = false;

export function ensureGodotInputMap(url: string = GODOT_INPUT_MAP_URL): void {
  if (mapRequested) return;
  mapRequested = true;
  void gameInput.loadMap(url).catch((error: unknown) => {
    mapRequested = false;
    // biome-ignore lint/suspicious/noConsole: vgai status must expose a failed binding load
    console.error(`[godot-input] failed to load ${url}:`, error);
  });
}

let inputTick = 0;
let taskOpen = false;

/** Poll before translated code reads input, preserving one-frame edges across catch-up steps. */
export function frameInput(): void {
  if (taskOpen) gameInput.endFrame();
  gameInput.poll(inputTick++);
  if (taskOpen) return;
  taskOpen = true;
  queueMicrotask(() => {
    taskOpen = false;
    gameInput.endFrame();
  });
}

function bootSeed(): number {
  if (typeof location === 'undefined') return DEFAULT_SEEDED_RANDOM_SEED;
  const raw = new URLSearchParams(location.search).get('vgai-seed');
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed >>> 0 : DEFAULT_SEEDED_RANDOM_SEED;
}

export const gameRandom = createSeededRandom(bootSeed());

/** The one imperative Control binding owned by this copied project runtime. */
export const {
  gameControlState,
  getControlState,
  controlHandle,
  resetControlState,
} = createControlRuntime();

export function godotInputBinding(): {
  actions: () => Readonly<Record<string, string>>;
  set: (action: string, value: boolean | number | { x: number; y: number }) => void;
  clear: () => void;
  tap: (action: string) => void;
} {
  return {
    actions: () =>
      Object.fromEntries(
        gameInput.actionNames().map((name) => [name, gameInput.getActionValueType(name)]),
      ),
    set: (action, value) => gameInput.setVirtualAction(action, value),
    clear: () => gameInput.clearVirtualActions(),
    tap: (action) => gameInput.tapVirtualAction(action),
  };
}

export interface GodotWorldSession {
  readonly census: () => Record<string, unknown>;
  readonly reloadCurrentScene: () => { reloaded: boolean; reason?: string };
  readonly settled: () => boolean;
}

let liveWorld: GodotWorldSession | null = null;

export function attachGodotWorld(session: GodotWorldSession): () => void {
  liveWorld = session;
  return () => {
    if (liveWorld === session) liveWorld = null;
  };
}

export function godotCensus(): Record<string, unknown> {
  return liveWorld?.census() ?? { mounted: false };
}

export function reloadGodotScene(): { reloaded: boolean; reason?: string } {
  return (
    liveWorld?.reloadCurrentScene() ?? {
      reloaded: false,
      reason: 'no translated world is mounted',
    }
  );
}

export function godotSettled(): boolean {
  return liveWorld?.settled() ?? true;
}

let liveAudio: AudioAdapter | null = null;

export function attachGodotAudioSystem(adapter: AudioAdapter): () => void {
  liveAudio = adapter;
  return () => {
    if (liveAudio === adapter) liveAudio = null;
  };
}

export function godotAudioSystem(): AudioAdapter {
  return {
    resume: () => liveAudio?.resume?.(),
    setMuted: (muted: boolean) => liveAudio?.setMuted(muted),
    isMuted: () => liveAudio?.isMuted() ?? false,
    graphSnapshot: () => liveAudio?.graphSnapshot?.() ?? [],
  };
}
