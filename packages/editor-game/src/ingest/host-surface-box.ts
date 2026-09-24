/**
 * Who owns the CSS box of an adopted ingest surface — S-4 (the SimCity ingest
 * ledger).
 *
 * THE DEFECT. The host resized an ingested game with
 * `renderer.setSize(w, h, false)`. `updateStyle: false` means "touch the
 * backing store, never the style", so the canvas' CSS box keeps whatever
 * three's OWN construction-time `setSize` (whose `updateStyle` defaults to
 * `true`) stamped on it in literal pixels while the game still believed it
 * owned the window. Adopt that canvas into a docked tab that happens to be
 * 0-height at mount and it is frozen there: revealing the tab fires the host's
 * ResizeObserver, the backing store is resized correctly — and the picture is
 * still a black 0-height box, because nothing ever un-stamped the style.
 * `updateStyle: false` cannot un-stamp a previous call; only a later write can.
 *
 * THE RULE, and it is the same one `engine/src/runtime/create-runtime.ts`
 * already applies to first-party roots (see its E4.R1 comment): the HOST owns
 * the adopted element's CSS box, the GAME owns only its backing resolution.
 * Make the two fully independent — box asserted as "fill the pane", buffer
 * driven by `setSize(w, h, false)` — and both a 0-height mount and a later
 * pane resize are correct by construction, with no ordering to get right.
 *
 * Kept as its own module (rather than four inline style writes) because the
 * rule now has three call sites across two mount paths, and because the box it
 * asserts is a contract worth one test rather than three transcripts.
 */

/**
 * The CSS the host stamps on the element it adopted. `position`/`inset` place
 * it against the pane (`hostEl` is `position:absolute;inset:0`), and the
 * percentage `width`/`height` are what actually override a pixel stamp — a
 * `width:1187px` left over from the game's own `setSize` survives `inset:0`
 * alone, which is exactly how S-4 hid for so long.
 *
 * `zIndex` is cleared: a game that stacked itself over a whole page has no
 * business stacking itself over editor chrome once adopted.
 *
 * `transform` is cleared for the same reason, and it is the OTHER half of the
 * pixel stamp S-4 found. A game that centres its own canvas in the window
 * writes `left:50%;top:50%;transform:translate(-50%,-50%)`.
 * `inset:0` un-does the `left`/`top` half — they are
 * the same longhands — but nothing un-does the transform, so the adopted
 * canvas rendered half its own width up and to the left of the pane, with a
 * hard black L down two edges. Like `width:100%`, this is a property the HOST
 * now owns: the game's centring was correct while it owned the window and is
 * simply not its decision any more.
 */
export const HOST_ADOPTED_SURFACE_CSS = {
  position: 'absolute',
  inset: '0',
  width: '100%',
  height: '100%',
  zIndex: '',
  transform: '',
} as const;

/**
 * The box for an adopted surface whose RESOLUTION THE HOST DOES NOT DRIVE.
 *
 * {@link HOST_ADOPTED_SURFACE_CSS} fills the pane, and that is right for the
 * three lane precisely because the host also resizes the game's backing store
 * to the pane on every change — box and buffer share an aspect by
 * construction, so "fill" never stretches anything.
 *
 * A canvas ingest has no such half. A Pixi/Phaser/Babylon game lays itself out
 * with imperative formulas against the resolution IT chose (`flappy` declares
 * 480x640 and registers no resize listener), so the host has no licence to
 * re-resolve it and filling the pane would simply report a picture the game
 * does not draw — MEASURED, sighted: 480x640 stretched into a 1107x780 pane
 * flattened the bird to an oval and squashed the HUD.
 *
 * `width`/`height: auto` with percentage maxima is the CSS that says exactly
 * that. For a REPLACED element (a canvas is one) the max-constraint algorithm
 * is defined to preserve the intrinsic ratio, so the used box is the game's own
 * resolution, scaled DOWN only far enough to fit, never up and never
 * distorted; `inset: 0` + `margin: auto` centres it in the pane.
 *
 * `object-fit` is the rejected alternative and it is worth naming, because it
 * looks equivalent and is not: it letterboxes the PAINT inside a box that stays
 * pane-sized, so the element's `getBoundingClientRect()` no longer describes
 * what is on screen — and that rect is exactly what `composite-screenshot.ts`
 * draws each canvas into. The screen would letterbox while every capture of it
 * stretched, which is worse than either alone.
 */
export const HOST_ADOPTED_UNRESIZED_SURFACE_CSS = {
  position: 'absolute',
  inset: '0',
  margin: 'auto',
  width: 'auto',
  height: 'auto',
  maxWidth: '100%',
  maxHeight: '100%',
  zIndex: '',
  transform: '',
} as const;

/** The subset of `CSSStyleDeclaration` {@link claimHostSurfaceBox} and
 *  {@link claimUnresizedSurfaceBox} write — named explicitly (rather than as an
 *  index signature) so a real element's `.style` satisfies it structurally and
 *  a unit test can still pass a plain object. */
export interface MutableBoxStyle {
  position: string;
  inset: string;
  margin: string;
  width: string;
  height: string;
  maxWidth: string;
  maxHeight: string;
  zIndex: string;
  transform: string;
}

/**
 * Assert host ownership of `el`'s CSS box. Idempotent, and safe to re-run on
 * every resize — which is deliberate: a game that installs its own
 * `window.resize` handler re-stamps pixels whenever the editor window changes,
 * so the host re-asserting on each pane resize is what keeps the box correct
 * over a session rather than only at adoption.
 */
export function claimHostSurfaceBox(el: { style: MutableBoxStyle }): void {
  el.style.position = HOST_ADOPTED_SURFACE_CSS.position;
  el.style.inset = HOST_ADOPTED_SURFACE_CSS.inset;
  el.style.width = HOST_ADOPTED_SURFACE_CSS.width;
  el.style.height = HOST_ADOPTED_SURFACE_CSS.height;
  el.style.zIndex = HOST_ADOPTED_SURFACE_CSS.zIndex;
  el.style.transform = HOST_ADOPTED_SURFACE_CSS.transform;
  // The two policies write an overlapping property set, so each must clear what
  // the other sets — otherwise re-adopting one surface after the other leaves a
  // stale `margin: auto` / `max-width` behind and the box is neither policy.
  el.style.margin = '';
  el.style.maxWidth = '';
  el.style.maxHeight = '';
}

/**
 * Assert host ownership of `el`'s CSS box for a surface the host does NOT
 * resize — see {@link HOST_ADOPTED_UNRESIZED_SURFACE_CSS}. Same idempotence and
 * the same re-assertable contract as {@link claimHostSurfaceBox}.
 */
export function claimUnresizedSurfaceBox(el: { style: MutableBoxStyle }): void {
  el.style.position = HOST_ADOPTED_UNRESIZED_SURFACE_CSS.position;
  el.style.inset = HOST_ADOPTED_UNRESIZED_SURFACE_CSS.inset;
  el.style.margin = HOST_ADOPTED_UNRESIZED_SURFACE_CSS.margin;
  el.style.width = HOST_ADOPTED_UNRESIZED_SURFACE_CSS.width;
  el.style.height = HOST_ADOPTED_UNRESIZED_SURFACE_CSS.height;
  el.style.maxWidth = HOST_ADOPTED_UNRESIZED_SURFACE_CSS.maxWidth;
  el.style.maxHeight = HOST_ADOPTED_UNRESIZED_SURFACE_CSS.maxHeight;
  el.style.zIndex = HOST_ADOPTED_UNRESIZED_SURFACE_CSS.zIndex;
  el.style.transform = HOST_ADOPTED_UNRESIZED_SURFACE_CSS.transform;
}

/**
 * The backing-store size to hand `renderer.setSize`. A host pane is measured
 * with `getBoundingClientRect()`, which is fractional, and can legitimately
 * report a collapsed dimension mid-transition; three multiplies by the pixel
 * ratio and floors, so feeding it 0 yields a 0-wide framebuffer (a black
 * canvas that no later correct resize necessarily repairs, since a WebGL
 * context can be lost on a zero-size drawing buffer).
 *
 * Floor to whole CSS pixels and clamp to at least 1: the smallest size that is
 * still a renderable surface. The CSS box is unaffected — it is `100%` and
 * follows the pane exactly, so clamping the buffer never shows up as layout.
 */
export function hostSurfaceBackingSize(
  width: number,
  height: number,
): { width: number; height: number } {
  return { width: clampDimension(width), height: clampDimension(height) };
}

function clampDimension(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}
