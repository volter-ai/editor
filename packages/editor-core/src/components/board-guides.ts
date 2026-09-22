/**
 * PERSISTENT BOARD GUIDES (design ledger: snapping/guides — "persistent
 * guides do not ship"). User-placed ruler guides on the DOM component board,
 * in BOARD coordinates (the same space the frames are laid out in, so a
 * guide stays put under pan/zoom).
 *
 * Persistence: per-project, per-document localStorage — the
 * `device-preview.ts` idiom (keyed by `getCurrentProject().rootPath`; UI
 * convenience, never project truth). A guide is a design AID: it has no
 * rendered meaning in the game, so it must never be written into game
 * source — the same reasoning that keeps the workspace layout and the device
 * preset out of the project.
 *
 * The snap seam: `RootSelectionOverlay`'s gestures snap in HOST-relative
 * space (a per-world frame inside the board), so the board registers its
 * live transform here ({@link registerBoardGuideTransform}) and the overlay
 * asks for guide edges in CLIENT space ({@link guideClientEdges}) to convert
 * against its own host origin.
 */

import { getCurrentProject } from '../project-manager';

export interface BoardGuide {
  readonly id: string;
  /** 'x' = vertical guide at a board X; 'y' = horizontal guide at a board Y. */
  readonly axis: 'x' | 'y';
  /** Board-space coordinate. */
  readonly value: number;
}

const STORAGE_KEY = 'vgai:board-guides:v1';

type Stored = Record<string, Record<string, BoardGuide[]>>;

function storage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function projectKey(): string {
  try {
    return getCurrentProject()?.rootPath ?? '(no-project)';
  } catch {
    return '(no-project)';
  }
}

function readAll(): Stored {
  try {
    return JSON.parse(storage()?.getItem(STORAGE_KEY) ?? '{}') as Stored;
  } catch {
    return {};
  }
}

function writeAll(all: Stored): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Quota/denied — guides silently stay session-only; the next write retries.
  }
}

const listeners = new Set<() => void>();
let cache: Record<string, BoardGuide[]> | null = null;
let nextId = Date.now() % 1_000_000;

function docs(): Record<string, BoardGuide[]> {
  if (!cache) cache = readAll()[projectKey()] ?? {};
  return cache;
}

function persist(): void {
  const all = readAll();
  all[projectKey()] = docs();
  writeAll(all);
  for (const listener of listeners) listener();
}

const EMPTY_GUIDES: readonly BoardGuide[] = [];

export function boardGuides(docId: string): readonly BoardGuide[] {
  // Referentially stable for a guide-less document: this is a
  // `useSyncExternalStore` snapshot, and a fresh `[]` per call is an
  // infinite re-render (measured: it crashed the whole editor surface with
  // "Maximum update depth exceeded" on first mount).
  return docs()[docId] ?? EMPTY_GUIDES;
}

export function subscribeBoardGuides(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function addBoardGuide(docId: string, axis: BoardGuide['axis'], value: number): string {
  nextId += 1;
  const id = `guide-${nextId}`;
  docs()[docId] = [...boardGuides(docId), { id, axis, value }];
  persist();
  return id;
}

export function moveBoardGuide(docId: string, id: string, value: number): void {
  docs()[docId] = boardGuides(docId).map((g) => (g.id === id ? { ...g, value } : g));
  persist();
}

export function removeBoardGuide(docId: string, id: string): void {
  docs()[docId] = boardGuides(docId).filter((g) => g.id !== id);
  persist();
}

// --- The live board transform, for the overlay's snap conversion ---

export interface BoardGuideTransform {
  /** The board container's client origin. */
  readonly originX: number;
  readonly originY: number;
  /** The board pan/zoom (client = origin + pan + value * zoom). */
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
}

let activeTransform: { docId: string; transform: BoardGuideTransform } | null = null;

/** The mounted board registers its transform (and clears it on unmount) so
 *  guide coordinates can be answered in client space. One DOM board is
 *  active at a time; a second registration simply replaces the first. */
export function registerBoardGuideTransform(
  docId: string,
  transform: BoardGuideTransform | null,
): void {
  activeTransform = transform ? { docId, transform } : null;
}

/** Every guide of the registered board, as CLIENT-space edge coordinates —
 *  what a gesture overlay converts against its own host origin. Empty when
 *  no board is registered (nothing to snap to, honestly). */
export function guideClientEdges(): { x: number[]; y: number[] } {
  if (!activeTransform) return { x: [], y: [] };
  const { docId, transform } = activeTransform;
  const x: number[] = [];
  const y: number[] = [];
  for (const guide of boardGuides(docId)) {
    if (guide.axis === 'x')
      x.push(transform.originX + transform.panX + guide.value * transform.zoom);
    else y.push(transform.originY + transform.panY + guide.value * transform.zoom);
  }
  return { x, y };
}
