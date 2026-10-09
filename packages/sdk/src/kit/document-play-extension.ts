/** Optional document capability. A tool owns its controls, state and runner;
 * a document kind owns the detached stage it lends that runner. Products name
 * neither side. The page-wide registry joins packaged and served contributions. */
import type { ComponentType } from 'react';
import type { ModelPlayLogEntry } from '../types';

export interface DocumentPlayControlProps {
  readonly documentId: string | undefined;
  readonly onClose: () => void;
}
export interface DocumentPlayStage {
  readonly documentId: string;
  readonly sourcePath: string;
  readonly root: unknown;
  readonly camera: () => unknown;
  /** The editing area's current draw camera, before handing its view to Play. */
  readonly editingCamera: () => unknown;
  readonly onFrame: (fn: (seconds: number) => void) => () => void;
  readonly report: (title: string, detail: string) => void;
  readonly container: HTMLElement;
  /** The runner has updated its first drawable frame. */
  readonly ready: () => void;
  /** The return camera is approaching the editing pose; fade authoring chrome back in. */
  readonly returning: () => void;
  /** A copy of one of `root`'s materials that one object can wear alone and a runner can
   *  recolour, keeping the document's own draw hooks; null for a material that is not the
   *  document's. Absent, a runner clones. */
  readonly ownMaterial?: (material: unknown) => unknown;
  /** The copy's characters' clips, bound to `root` (the document's skins and actions), which the
   *  runner advances on the game's clock. Absent, the document lends no animation and rigged
   *  objects stand in their exported pose. */
  readonly animation?: DocumentPlayAnimation;
}
export type DocumentPlayAnswer = { ok: true; armature: string } | { ok: false; why: string };

export interface DocumentPlayActionOptions {
  readonly fade?: number;
  readonly loop?: boolean;
  readonly speed?: number;
  readonly restart?: boolean;
}

export interface DocumentPlayTrackOptions extends DocumentPlayActionOptions {
  readonly action?: string;
  readonly influence?: number;
  readonly mute?: boolean;
}
/** A document's animation, lent to a runner. Objects are the runner's own (`root`'s descendants). */
export interface DocumentPlayAnimation {
  clips(object: unknown): readonly string[];
  /** The active action (`animation_data.action`), crossfaded from the last. */
  play(object: unknown, action: string, options?: DocumentPlayActionOptions): DocumentPlayAnswer;
  stop(object: unknown, fade?: number): void;
  playing(object: unknown): string | null;
  /** An NLA track by name: an action for it, its influence, its mute; `null` gives it back. */
  track(object: unknown, name: string, options: DocumentPlayTrackOptions | null): DocumentPlayAnswer;
  /** A bone constraint's influence, or the object it aims at. */
  constraint(object: unknown, bone: string, name: string, options: { influence?: number; target?: unknown }): DocumentPlayAnswer;
  update(dt: number): void;
  readonly warnings: readonly string[];
  dispose(): void;
}
/**
 * A RUNNING GAME'S CLOCK, as the Play tool keeps it. The numbers are the ones the runner handed
 * the game, not the page's: `time` is the sum of every `dt` the script's `update` was given, so it
 * stands still while paused and runs at `speed` times the page's own clock otherwise.
 */
export interface DocumentPlayClock {
  /** Simulation seconds since this run began (the sum of the `dt`s the game was handed). */
  readonly time: number;
  /** Updates the game has run since this run began. */
  readonly tick: number;
  readonly paused: boolean;
  /** Simulation seconds per real second; one of the transport's `speeds`. */
  readonly speed: number;
  /** While playing with no game running because the script failed to start or threw: why. The
   *  run stays playing (a save of the script retries it); a running game clears it. */
  readonly failure?: string | null;
  /** A game has started in this run and is running (its first update ran). False while the run
   *  is still preparing, and while it plays with a `failure`. Absent from a tool that predates
   *  it, which cannot say. A reader that must know whether Play WORKED (the CLI's `play`) waits
   *  for this or for `failure`, never for "playing" alone. */
  readonly running?: boolean;
}
/**
 * THE GAME'S TRANSPORT — what a Play tool offers beyond Play and Stop, for a layout that draws a
 * game panel (Cyclotron's Game mode, `@volter/editor-blender`). Optional: a tool without
 * one still plays and stops, and a layout draws only the controls a tool answers.
 */
export interface DocumentPlayTransport {
  /** The speeds `setSpeed` accepts, slowest first. */
  readonly speeds: readonly number[];
  clock(documentId: string): DocumentPlayClock;
  /** The clock moves every played frame, so it has a subscription of its own: `subscribe` would
   *  re-render everything that only asks whether a document plays. */
  subscribeClock(listener: () => void): () => void;
  /** Hold or release the game's updates; the stage keeps drawing the frozen copy. */
  setPaused(documentId: string, paused: boolean): void;
  /** One update while paused, with one nominal frame's `dt`. */
  step(documentId: string): void;
  setSpeed(documentId: string, speed: number): void;
  /** Begin the run again on a FRESH detached copy, the clock at zero. */
  restart(documentId: string): void;
  /**
   * THE DOCUMENT COULD NOT LEND A STAGE (its rendered draw failed to prepare), so no runner
   * ever started. The run stays playing with `failure` on the clock and a `script-error` entry
   * (phase `stage`) in the play log, so the Game panel and `play-log` say why; Stop ends it and
   * Restart tries again. Absent, the document stops the play and reports by notification.
   */
  fail?(documentId: string, sourcePath: string, failure: string): void;
  /** Changes on every restart. The document that lends the stage keys its detached copy on it,
   *  so a new generation is a new copy; the change is announced through `subscribe`. */
  generation(documentId: string): number;
  /** Whether the running game's own bot drives, and whether it offers one; a change is
   *  announced through `subscribeClock`. Absent, the tool has no autoplay. */
  autoplay?(documentId: string): DocumentPlayAutoplay;
  /** Switch the bot on (it must be offered, and the game playing) or off. On drives one of the
   *  bot's behaviours (`behavior`, required when it offers several) for at most `limit`
   *  simulation seconds (the tool's default when absent). */
  setAutoplay?(documentId: string, on: boolean, by: 'panel' | 'cli', request?: DocumentPlayAutoplayRequest): void;
  /** While stopped, ask the next start to switch the bot on as soon as its script offers one
   *  (`armed`); dropped if it offers none, or not the behaviour asked for. Absent, autoplay can
   *  only be switched while running. */
  armAutoplay?(documentId: string, armed: boolean, request?: DocumentPlayAutoplayRequest): void;
}
export interface DocumentPlayAutoplayRequest {
  readonly behavior?: string | null;
  readonly limit?: number | null;
}
/**
 * AUTOPLAY, AS THE EDITOR OWNS IT: a game offers a bot, the editor decides whether it drives.
 * Off whenever a run begins; a person's input in the game turns it off (`takeover`), and so does
 * the run's limit (`limit`).
 */
export interface DocumentPlayAutoplay {
  readonly on: boolean;
  /** The running game registered a bot. */
  readonly available: boolean;
  /** Who made the last change: `script` is the game no longer offering a bot, `limit` the run's
   *  simulation seconds spent. */
  readonly by: 'panel' | 'cli' | 'takeover' | 'script' | 'limit' | null;
  /** Armed while stopped (`armAutoplay`): the next start turns it on once a bot is offered. */
  readonly armed?: boolean;
  /** The behaviours the bot offers, and the one driving (or armed). Absent from older tools. */
  readonly behaviors?: readonly string[];
  readonly behavior?: string | null;
  /** This run's limit and the simulation time it began at, in simulation seconds. */
  readonly limit?: number | null;
  readonly since?: number | null;
  /** A person's key or pointer reached the game in this run: with autoplay off, they drive. */
  readonly person?: boolean;
  /** What the bot last said it is doing. */
  readonly state?: string | null;
  /** Why the last arm was not taken when the game started; null otherwise. */
  readonly refused?: string | null;
}
/** The newest entries of one document's play log, for a panel that draws it live. */
export interface DocumentPlayLog {
  tail(documentId: string, last: number, kind?: string): {
    readonly total: number;
    readonly kinds: readonly string[];
    readonly entries: readonly ModelPlayLogEntry[];
  };
  /** Every write to any document's log; several land in one frame, so coalesce. */
  subscribe(listener: () => void): () => void;
}
export interface DocumentPlayExtension {
  readonly Control: ComponentType<DocumentPlayControlProps>;
  readonly Menu: ComponentType<DocumentPlayControlProps>;
  playing(documentId: string): boolean;
  /** Intended live frame shape; absent/null lets the document fill its area. */
  aspectRatio?(documentId: string): number | null;
  setPlaying(documentId: string, value: boolean): void;
  escape?(documentId: string): void;
  subscribe(listener: () => void): () => void;
  run(stage: DocumentPlayStage): () => void;
  /** Pause, step, speed, restart and the clock, when the tool keeps them. */
  readonly transport?: DocumentPlayTransport;
  /** The run's play log, when the tool keeps one. */
  readonly log?: DocumentPlayLog;
  /** The project path of the script this tool would run for a document's source file. */
  scriptPath?(sourcePath: string): string;
  /** Whether that script exists: `null` while the tool has not looked yet. A change is announced
   *  through `subscribe`. A layout uses it to open a document as a game or as a model. */
  hasScript?(sourcePath: string): boolean | null;
}
const key = Symbol.for('volter.document-play-extensions');
interface Registry {
  extensions: Map<string, DocumentPlayExtension>;
  listeners: Set<() => void>;
}
const page = globalThis as typeof globalThis & { [key]?: Registry };
const registry = page[key] ??= { extensions: new Map(), listeners: new Set() };
function publish(): void { for (const listener of registry.listeners) listener(); }
export function documentPlayExtension(kind: string): DocumentPlayExtension | null {
  return registry.extensions.get(kind) ?? null;
}
/** Host shells wrap adapter entries as generic documents. Ask the capability
 * owners about this document's identity rather than treating that wrapper's
 * semantic kind as the adapter's registered Play kind. */
export function documentPlaying(documentId: string): boolean {
  for (const extension of registry.extensions.values()) {
    if (extension.playing(documentId)) return true;
  }
  return false;
}
export function subscribeDocumentPlayExtensions(listener: () => void): () => void {
  registry.listeners.add(listener);
  return () => { registry.listeners.delete(listener); };
}
/** Whether a document's own Play runs, and whether it is paused: what a status line says. */
export function documentPlayState(documentId: string): 'playing' | 'paused' | 'stopped' {
  for (const extension of registry.extensions.values()) {
    if (!extension.playing(documentId)) continue;
    return extension.transport?.clock(documentId).paused ? 'paused' : 'playing';
  }
  return 'stopped';
}
/** Every Play start and stop, and every tool's clock (a pause is a clock change). The clock moves
 *  every played frame, so this is for a reader whose snapshot changes rarely. */
export function subscribeDocumentPlayState(listener: () => void): () => void {
  let clocks: (() => void)[] = [];
  const rebind = (): void => {
    for (const stop of clocks) stop();
    clocks = [...registry.extensions.values()].flatMap((extension) =>
      extension.transport ? [extension.transport.subscribeClock(listener)] : []);
  };
  const onRegistry = (): void => { rebind(); listener(); };
  registry.listeners.add(onRegistry);
  rebind();
  return () => {
    registry.listeners.delete(onRegistry);
    for (const stop of clocks) stop();
    clocks = [];
  };
}
export function registerDocumentPlayExtension(kind: string, extension: DocumentPlayExtension): () => void {
  if (registry.extensions.has(kind)) throw new Error(`A Play tool already owns ${kind} documents.`);
  registry.extensions.set(kind, extension);
  const stop = extension.subscribe(publish);
  publish();
  return () => {
    stop();
    if (registry.extensions.get(kind) === extension) registry.extensions.delete(kind);
    publish();
  };
}
