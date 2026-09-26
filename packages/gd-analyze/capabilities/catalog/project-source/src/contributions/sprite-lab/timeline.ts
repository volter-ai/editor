/**
 * THE STAGE'S ARITHMETIC — the three things a sprite viewer gets silently
 * wrong. Pure integer maths, no Pixi and no React.
 *
 * The playhead's two are both the CYCLE being a ring rather than a line, which
 * is exactly the fact a straight index forgets:
 *
 *  - stepping back from frame 0 lands on the LAST frame, not on -1;
 *  - the onion skin under frame 0 is the last frame, not nothing — a walk
 *    whose first and last frames do not meet is the drift the onion exists to
 *    show, and it is invisible if frame 0 is drawn with no ghost.
 *
 * The third is FIT: a fit that lands on a fractional factor resamples the art,
 * and a resampled pixel sheet is a blur with the correct pixels in the file.
 */

/** Step the playhead by `delta` frames, wrapping both ways. */
export function stepFrame(index: number, frames: number, delta: number): number {
  if (frames <= 0) return 0;
  return (((index + delta) % frames) + frames) % frames;
}

/**
 * The frame ghosted UNDER `index` — the cycle's previous frame, wrapping.
 *
 * `null` for a single-frame animation: there is no previous frame, and ghosting
 * a frame under itself would read as a doubled sprite rather than as an honest
 * "nothing to compare".
 */
export function onionFrame(index: number, frames: number): number | null {
  if (frames < 2) return null;
  return stepFrame(index, frames, -1);
}

/**
 * The largest scale that shows a whole `cell` inside a `box`, WITHOUT ever
 * resampling it.
 *
 * Integer-snapped in both directions, which is the whole point: an integer
 * factor maps one source pixel onto an exact square of screen pixels, and an
 * integer RECIPROCAL (1/2, 1/3, …) maps an exact square back onto one. A
 * fitted 0.9375 in between is a blur — the pixel look dying of filtering with
 * every correct pixel still in the file, which is the same failure
 * `scaleMode: 'nearest'` exists to prevent one layer down.
 *
 * Never returns 0: a cell far larger than the box shows smaller, not nothing.
 */
export function fitScale(cell: number, box: number): number {
  if (cell <= 0 || box <= 0) return 1;
  if (cell <= box) return Math.max(1, Math.floor(box / cell));
  return 1 / Math.ceil(cell / box);
}
