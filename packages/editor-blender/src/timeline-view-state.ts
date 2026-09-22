/**
 * THE TIMELINE'S OWN VIEW STATE — the pan/zoom of its ruler, the last refusal,
 * the measured box, and what it drew.
 *
 * THE PLAYBACK STATE IS NOT HERE. The frame, the play/pause and the keyframe
 * columns live in the presenter's `BlenderSkinDirector`
 * (`../contributions/blender-runtime-skin.ts`), because that object OWNS the
 * `AnimationMixer` and a second copy of "what frame is it" is exactly the
 * disagreement the whole design exists to avoid. This module holds only what
 * is about the DRAWING.
 *
 * WHAT DRIVES IT IS NOT A SESSION VERB. U8's ruling 1 (2026-09-19): every view
 * publishes `vgai.<view>.<verb>` commands through `@volter/editor-sdk/views`, one
 * table behind the frame's command service and standalone `vgai edit`'s
 * session verb — so this view adds no `blender-*` verb of its own.
 *
 * It imports NOTHING, for the reason the node and UV stores do: the view and
 * the verb table both reach it, and a store either of them could not import
 * would not be one store.
 */

export interface TimelineTransform {
  /** The FRAME at the view's left edge, and the CSS pixels per frame. Blender's
   *  own `View2D.cur` for a time editor is exactly this pair. */
  readonly startFrame: number;
  readonly pixelsPerFrame: number;
}

export interface TimelineDrawn {
  /** The action being played, and whose keys the summary row draws. */
  readonly action: string | null;
  readonly object: string | null;
  readonly armature: string | null;
  /** The playhead's frame, as the MIXER holds it. */
  readonly frame: number;
  readonly start: number;
  readonly end: number;
  readonly fps: number;
  readonly playing: boolean;
  /** The frames the summary row drew a diamond at — AFTER the selection
   *  filter, which is what "what the row drew" means. */
  readonly keyframes: readonly number[];
  /** The filter's position, and the objects whose keys survived it. */
  readonly onlySelected: boolean;
  readonly summaryObjects: readonly string[];
  /** The ruler's major step, in frames, as `calculate_grid_step` answered it
   *  for the drawn width — the number a parity read checks. */
  readonly majorStep: number;
  readonly minorStep: number | null;
  /** How many marks of each kind went into the DOM. */
  readonly majorLines: number;
  readonly minorLines: number;
  readonly labels: number;
  readonly diamonds: number;
  /** The diamond's drawn geometry, so the table is a measurement of the
   *  shipped drawing rather than a second run of the same arithmetic. */
  readonly diamondRadius: number;
  readonly diamondSprite: number;
  /** Bones the presenter bound, and tracks the mixer holds. */
  readonly bones: number;
  readonly tracks: number;
  /** Engine calls the whole Timeline has made since the session began — a
   *  scrub adds NONE, and that is the claim this number is here to prove. */
  readonly engineCalls: number;
  /** Everything this view shows LESS than Blender would, by name. */
  readonly warnings: readonly string[];
}

export interface TimelineViewState {
  readonly transform: TimelineTransform;
  readonly refusal: string | null;
  readonly size: { readonly w: number; readonly h: number };
  readonly framedAt: number;
  readonly drawn: TimelineDrawn | null;
  /**
   * BLENDER'S `show_keys_from_selected_only`, and it is VIEW state here for a
   * reason a headless Blender forces: the flag Blender's Timeline reads is
   * `Scene.flag & SCE_KEYS_NO_SELONLY` (`anim_filter.cc:254-270`), and this
   * surface is an INSPECTION surface that does not write the file — so the
   * filter's position is ours to hold and the data it filters on
   * (`Object.select_get()`) stays Blender's.
   *
   * DEFAULTS ON, as Blender's does: `SCE_KEYS_NO_SELONLY` is a NEGATIVE flag
   * and a new scene does not carry it, so a factory Blender's Timeline shows
   * the selected objects' keys only. The reference read recorded exactly that
   * — the probe's own Timeline drew an EMPTY summary row with the rig
   * unselected while its Dope Sheet drew all five keys.
   *
   * IT DECIDES WHAT THE ROW DRAWS, NEVER WHAT PLAYS. Playback moves every
   * object regardless, in Blender and here.
   */
  readonly onlySelected: boolean;
}

const INITIAL: TimelineViewState = {
  transform: { startFrame: -5, pixelsPerFrame: 8 },
  refusal: null,
  size: { w: 0, h: 0 },
  framedAt: 0,
  drawn: null,
  onlySelected: true,
};

let state: TimelineViewState = INITIAL;
let version = 0;
const listeners = new Set<() => void>();
let viewAllRequest = 0;

export function timelineViewState(): TimelineViewState {
  return state;
}

export function timelineViewVersion(): number {
  return version;
}

export function subscribeTimelineView(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setTimelineViewState(next: Partial<TimelineViewState>): void {
  state = { ...state, ...next };
  version += 1;
  for (const listener of [...listeners]) listener();
}

/** Flip the summary row's selection filter (Blender's `View ▸ Only Show
 *  Selected`). The row re-filters from data the door already reported; nothing
 *  is read from the engine and nothing the mixer plays changes. */
export function setTimelineOnlySelected(onlySelected: boolean): void {
  if (state.onlySelected === onlySelected) return;
  setTimelineViewState({ onlySelected });
}

/** A `view-all` ASK, raised by the verb and consumed by the view — the one
 *  action the store cannot compute, because framing needs the measured box. */
export function requestTimelineViewAll(): void {
  viewAllRequest += 1;
  version += 1;
  for (const listener of [...listeners]) listener();
}

export function timelineViewAllRequest(): number {
  return viewAllRequest;
}

/** A gesture the view refuses because it would EDIT. One place, so the verb
 *  table and the pointer handlers cannot drift into two vocabularies. */
export function refuseTimelineGesture(text: string): void {
  setTimelineViewState({ refusal: text });
}
