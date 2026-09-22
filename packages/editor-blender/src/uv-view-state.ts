/**
 * THE UV VIEW'S OWN STATE, and the reason it is a module rather than a
 * `useState` inside the component — the same reason `node-view-state.ts`
 * records: `editor.document.*` reaches only the ACTIVE CENTRE DOCUMENT by its
 * own contract, and this view is not one, so a `useState` here would be a
 * surface nothing in the product could read or drive.
 *
 * WHAT DRIVES IT IS NOT A SESSION VERB. U8's ruling 1 (2026-09-19): every view
 * publishes `vgai.<view>.<verb>` commands through `@volter/editor-sdk/views`,
 * one table behind the frame's command service and standalone `vgai edit`'s
 * session verb — so this view adds NO `blender-*` verb of its own, which is
 * exactly what the ruling asked the remaining I5 views to stop paying for.
 *
 * It imports NOTHING, for the reason the node view's store does: the view and
 * the verb table both reach it, and a store either of them could not import
 * would not be one store.
 */

export interface UvViewTransform {
  /** The UV-space point at the view's centre. UV space is Y-UP (v increases
   *  upward, as Blender's image space does); the view flips it once, at the
   *  SVG transform, so nothing downstream carries a sign. */
  readonly cx: number;
  readonly cy: number;
  /** CSS pixels per UV unit. At zoom 1 the 0–1 tile is one pixel across, so
   *  the view's own `view-all` is what a person actually starts from — the
   *  same shape as Blender's `image_view_all` (`image_ops.cc`). */
  readonly zoom: number;
}

export interface UvViewState {
  readonly transform: UvViewTransform;
  /** The last gesture refused by name, and why. */
  readonly refusal: string | null;
  /** The canvas box the view measured itself at, in CSS px. */
  readonly size: { readonly w: number; readonly h: number };
  /** Set by the view when a `view-all` was asked for and it has framed. */
  readonly framedAt: number;
  /**
   * WHAT THE VIEW ACTUALLY DREW — published so a parity table is a
   * MEASUREMENT of the shipped drawing rather than a second run of the same
   * arithmetic, which is the reading `node-view-state.ts`'s `drawn` already
   * earns its keep with.
   */
  readonly drawn: UvViewDrawn | null;
}

export interface UvViewDrawn {
  readonly object: string | null;
  readonly mesh: string | null;
  readonly layer: string | null;
  readonly layers: readonly string[];
  /** Blender's mode at the read — named, never required (ruling 1). */
  readonly mode: string;
  readonly loops: number;
  readonly polygons: number;
  readonly triangles: number;
  /** How many marks of each kind the view put in the DOM. */
  readonly faces: number;
  readonly edges: number;
  readonly verts: number;
  readonly faceDots: number;
  readonly pinned: number;
  /** The UV bounds the layout actually occupies. */
  readonly bounds: readonly [number, number, number, number] | null;
  /** The tile grid, as drawn: the tile count and its subdivision. */
  readonly tiles: readonly [number, number];
  readonly subdiv: readonly [number, number];
  /** The image behind the tile, or the reason there is none. */
  readonly image: string | null;
  /** Everything the view is showing LESS than Blender would, by name. */
  readonly warnings: readonly string[];
}

const INITIAL: UvViewState = {
  transform: { cx: 0.5, cy: 0.5, zoom: 512 },
  refusal: null,
  size: { w: 0, h: 0 },
  framedAt: 0,
  drawn: null,
};

let state: UvViewState = INITIAL;
let version = 0;
const listeners = new Set<() => void>();
/** A `view-all` ASK, raised by the verb and consumed by the view — the one
 *  action the store cannot compute, because framing needs the read layout. */
let viewAllRequest = 0;

export function uvViewState(): UvViewState {
  return state;
}

export function uvViewVersion(): number {
  return version;
}

export function subscribeUvView(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setUvViewState(next: Partial<UvViewState>): void {
  state = { ...state, ...next };
  version += 1;
  for (const listener of [...listeners]) listener();
}

export function requestUvViewAll(): void {
  viewAllRequest += 1;
  version += 1;
  for (const listener of [...listeners]) listener();
}

export function uvViewAllRequest(): number {
  return viewAllRequest;
}

/** A gesture the view refuses because it would EDIT. One place, so the verb
 *  table and the pointer handlers cannot drift into two vocabularies. */
export function refuseUvViewGesture(text: string): void {
  setUvViewState({ refusal: text });
}
