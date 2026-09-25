import type { CaptureDimensions } from '@volter/editor-sdk';

/**
 * The dimensions a capture verb was asked for, or the refusal that names the
 * value it was handed.
 *
 * SQUARE IS THE DEFAULT and `size` is how you ask for one. `width`+`height`
 * together ask for a SHAPED frame — a video-aspect look that needs no crop
 * afterwards — and are bounded per side and in TOTAL by the same relay budget
 * the square ceiling comes from. Mixing the two forms is refused rather than
 * silently resolved: a caller who sent both does not know which one they meant.
 *
 * `cmd` is WIRE INPUT — a JSON object from another process — so `cmd['size']`
 * had never been anything but a cast (`as number | undefined`). A caller that
 * sent a non-number got that value multiplied by 2 deep inside
 * `_renderViewportImage` and `createImageData(NaN, NaN)` threw
 * `TypeError: Value is not of type 'long'` from the middle of the render path;
 * because the dispatcher's `.then()` had no rejection leg, the throw answered
 * nobody and the caller waited out its whole budget for
 * "the tab is present … and did not respond" — a message about the TAB for a
 * defect in the argument. Measured on a racing-game ingest mount, 2026-08-15.
 */
export function captureSizeFromCommand(
  cmd: Readonly<Record<string, unknown>>,
): { size?: CaptureDimensions } | { error: string } {
  const raw = cmd['size'];
  const rawWidth = cmd['width'];
  const rawHeight = cmd['height'];
  const shaped = rawWidth !== undefined || rawHeight !== undefined;
  if (shaped) {
    if (raw !== undefined && raw !== null) {
      return {
        error:
          `${String(cmd['type'])}: pass "size" (a square) OR "width"+"height" (a shaped frame), ` +
          'never both.',
      };
    }
    const dimension = (name: string, value: unknown): number | string => {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return (
          `${String(cmd['type'])}: "${name}" must be a whole number — got ` +
          `${typeof value} ${JSON.stringify(value) ?? String(value)}.`
        );
      }
      if (value < MIN_CAPTURE_DIMENSION || value > MAX_CAPTURE_DIMENSION) {
        return `${String(cmd['type'])}: "${name}" must be ${MIN_CAPTURE_DIMENSION}-${MAX_CAPTURE_DIMENSION} — ${CAPTURE_BUDGET_REASON}`;
      }
      return value;
    };
    const width = dimension('width', rawWidth);
    if (typeof width === 'string') return { error: width };
    const height = dimension('height', rawHeight);
    if (typeof height === 'string') return { error: height };
    if (width * height > MAX_CAPTURE_DIMENSION * MAX_CAPTURE_DIMENSION) {
      return {
        error:
          `${String(cmd['type'])}: ${width}x${height} is ${width * height} pixels, past the ` +
          `${MAX_CAPTURE_DIMENSION}x${MAX_CAPTURE_DIMENSION} total — ${CAPTURE_BUDGET_REASON}`,
      };
    }
    return { size: { width, height } };
  }
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) {
    return {
      error:
        `${String(cmd['type'])}: "size" must be a finite number >= 1 — got ` +
        `${typeof raw} ${JSON.stringify(raw) ?? String(raw)}.`,
    };
  }
  return { size: raw };
}

/**
 * The editor's own capture ceiling, and WHY it is this number.
 *
 * 64..1024 per side is `asset-preview.ts`'s `MIN_SIZE`/`MAX_SIZE`: the pixels
 * cross the editor relay as base64 JSON, and 1024 is where even incompressible
 * RGBA still fits its 50 MB request limit. A shaped frame is held to the same
 * BUDGET rather than a laxer one — its total may not exceed a 1024 square —
 * because the budget is about bytes on the wire, not about shape.
 */
const MIN_CAPTURE_DIMENSION = 64;
const MAX_CAPTURE_DIMENSION = 1024;
const CAPTURE_BUDGET_REASON =
  "the editor's own ceiling: the pixels cross the relay as base64 JSON, and 1024 is where even " +
  'incompressible RGBA still fits its 50 MB request limit. For more picture, take more views, ' +
  'not bigger ones.';
