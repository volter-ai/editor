/**
 * GAME OR ANIMATION — what a model document's bottom area shows. It is not mutually exclusive:
 * animation is used by games too.
 *
 * - **Animation** is Blender's animation editors: the Timeline, the Dope Sheet's Action Editor and
 *   the NLA editor (`../contributions/blender-animation-editors.tsx`). While a game runs they show
 *   what the game is animating, read-only.
 * - **Game** is the Game panel (`../contributions/blender-game-panel.tsx`): the ONE Play, and the
 *   run's pause, step, speed, restart and clock.
 *
 * They are two views of one bottom area, not two exclusive states: switching to Animation leaves a
 * running game running.
 *
 * The switch is the bottom area's own, at the leading edge of its header row in the Game panel
 * and the Timeline alike (`PlayModeSwitch`, `blender-game-panel.tsx`); this module is the state
 * both sides read. A document opens as a
 * Game when its model has a play script (`*.play.ts` beside the `.blend`, as the Play tool finds
 * it — `DocumentPlayExtension.hasScript`) and in Animation otherwise, and the person's own pick
 * then stands for that document for the browser session, kept the way `area-split.ts` keeps the
 * split, per document id — in session storage rather than local, because the default is what a
 * fresh session should start from.
 *
 * THE BOTTOM AREA SERVES ONE DOCUMENT, the model document on screen. The Timeline was always
 * that (it binds the presented-view singleton, and cannot name a document), but a game panel
 * needs the id to drive a run, and clicking into the panel makes the PANEL the active workspace
 * document — so the model document announces itself here ({@link noteModelDocument}) rather
 * than the panel asking the workspace which document is active.
 */
import {
  documentPlayExtension,
  subscribeDocumentPlayExtensions,
} from '@volter/editor-sdk/kit/document-play-extension';

export type ModelPlayMode = 'game' | 'animation';

/** A mode as asked for, or null for anything else. */
export function playModeOf(value: unknown): ModelPlayMode | null {
  return value === 'game' || value === 'animation' ? value : null;
}

const STORAGE_PREFIX = 'volter.blender.play-mode:';
const listeners = new Set<() => void>();
/** The person's pick per document; `null` once storage was read and held none. */
const chosen = new Map<string, ModelPlayMode | null>();
/** Each model document's `.blend`, as the document reported it. */
const sources = new Map<string, string>();
let served: string | null = null;
let version = 0;

function publish(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

function stored(documentId: string): ModelPlayMode | null {
  try {
    const value = globalThis.sessionStorage?.getItem(STORAGE_PREFIX + documentId);
    return playModeOf(value);
  } catch {
    return null;
  }
}

/** The person's own pick for a document, or `null` when the default stands. */
export function chosenPlayMode(documentId: string): ModelPlayMode | null {
  let value = chosen.get(documentId);
  if (value === undefined) {
    value = stored(documentId);
    chosen.set(documentId, value);
  }
  return value;
}

export function setChosenPlayMode(documentId: string, mode: ModelPlayMode): void {
  if (chosenPlayMode(documentId) === mode) return;
  chosen.set(documentId, mode);
  try {
    globalThis.sessionStorage?.setItem(STORAGE_PREFIX + documentId, mode);
  } catch {
    // A page without storage keeps the pick for its own life.
  }
  publish();
}

/**
 * The model document on screen announces itself and its `.blend`; the return withdraws it,
 * and only while it is still the one announced (a newer document's announcement stands).
 */
export function noteModelDocument(documentId: string, blend: string | undefined): () => void {
  if (served !== documentId || sources.get(documentId) !== blend) {
    served = documentId;
    if (blend === undefined) sources.delete(documentId);
    else sources.set(documentId, blend);
    publish();
  }
  return () => {
    if (served !== documentId) return;
    served = null;
    publish();
  };
}

/** The model document the bottom area serves, or `null` with none on screen. */
export function servedModelDocument(): string | null {
  return served;
}

/** The `.blend` a model document reported, if it has a file of its own. */
export function modelDocumentSource(documentId: string): string | undefined {
  return sources.get(documentId);
}

/**
 * THE MODE A DOCUMENT IS IN: Animation whenever no Play tool is installed (there is no game to
 * switch to), else the person's pick, else Game exactly when the model has a play script. A
 * script not yet looked for counts as none, so a document opens on the Timeline and turns to
 * the Game panel when the answer arrives.
 */
export function modelPlayMode(documentId: string): ModelPlayMode {
  const extension = documentPlayExtension('model');
  if (extension === null) return 'animation';
  const pick = chosenPlayMode(documentId);
  if (pick !== null) return pick;
  const blend = sources.get(documentId);
  return blend !== undefined && extension.hasScript?.(blend) === true ? 'game' : 'animation';
}

export function playModeVersion(): number {
  return version;
}

/**
 * Changes to the picks, to the served document, and to anything the Play tool answers.
 *
 * THE PLAY TOOL'S ANSWERS MOVE THE VERSION TOO, because the version is the snapshot every reader
 * takes (`useSyncExternalStore(subscribePlayMode, playModeVersion)`): a script found after the
 * first render, a run starting or stopping, a restart. Handing the tool's publications straight to
 * the reader's listener re-ran a snapshot that had not changed, so React kept the old render — a
 * document with a play script stayed in Animation, and the Game panel kept showing Stop after the game
 * had stopped. One subscription to the tool's registry, held while anything reads this store,
 * bumps the version and then tells the readers.
 */
let stopToolWatch: (() => void) | null = null;
export function subscribePlayMode(listener: () => void): () => void {
  listeners.add(listener);
  stopToolWatch ??= subscribeDocumentPlayExtensions(publish);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stopToolWatch) {
      stopToolWatch();
      stopToolWatch = null;
    }
  };
}
