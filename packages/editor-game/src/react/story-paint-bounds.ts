/**
 * The union of what a mounted DOM story actually PAINTS, in the mount box's
 * own authored pixels — the measurement half of "mount in the truth, frame the
 * subject" for the UI board (the capture lane's alpha-bounds scan is the same
 * decision made on pixels; a live card cannot rasterize per frame, so this
 * walks the DOM instead).
 *
 * The filter matters more than the union: a translated uGUI screen is nested
 * full-bleed wrapper boxes (anchor stretch, transparent) around a few painted
 * leaves, so a naive union of ALL element rects is always the whole mount box
 * and the crop never fires. An element counts only when it paints something a
 * viewer can see: a non-transparent background, a background image, replaced
 * content, a visible border/shadow, or its own text.
 */

/** True when this element itself puts pixels on screen. */
export function elementPaints(element: Element): boolean {
  const tag = element.tagName;
  if (
    tag === 'IMG' ||
    tag === 'VIDEO' ||
    tag === 'CANVAS' ||
    tag === 'svg' ||
    tag === 'SVG' ||
    tag === 'PICTURE'
  ) {
    return true;
  }
  const style = getComputedStyle(element);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  if (backgroundColorPaints(style.backgroundColor)) return true;
  if (style.backgroundImage && style.backgroundImage !== 'none') return true;
  if (style.boxShadow && style.boxShadow !== 'none') return true;
  if (
    style.borderStyle !== 'none' &&
    style.borderStyle !== '' &&
    (parseFloat(style.borderTopWidth) > 0 ||
      parseFloat(style.borderRightWidth) > 0 ||
      parseFloat(style.borderBottomWidth) > 0 ||
      parseFloat(style.borderLeftWidth) > 0)
  ) {
    return true;
  }
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '') return true;
  }
  return false;
}

/** `transparent` serializes as `rgba(0, 0, 0, 0)`; anything with alpha paints. */
function backgroundColorPaints(color: string): boolean {
  if (!color || color === 'transparent') return false;
  const rgba = /^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/.exec(color);
  if (rgba) return parseFloat(rgba[1]!) > 0;
  return true;
}

export interface PaintedBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Union of the painted descendants' boxes in the mount box's authored px, or
 * `null` when nothing paints. Rects are read through the live client transform
 * (the board zooms its canvas), so the mount box's own client width supplies
 * the scale — self-normalizing, no zoom parameter to drift.
 */
export function paintedContentBounds(
  content: HTMLElement,
  rectOf: (element: Element) => DOMRect = (element) => element.getBoundingClientRect(),
): PaintedBounds | null {
  const home = rectOf(content);
  const authoredWidth = content.offsetWidth;
  if (home.width <= 0 || authoredWidth <= 0) return null;
  const scale = home.width / authoredWidth;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const element of content.querySelectorAll('*')) {
    if (!elementPaints(element)) continue;
    const rect = rectOf(element);
    if (rect.width <= 0 || rect.height <= 0) continue;
    left = Math.min(left, (rect.left - home.left) / scale);
    top = Math.min(top, (rect.top - home.top) / scale);
    right = Math.max(right, (rect.right - home.left) / scale);
    bottom = Math.max(bottom, (rect.bottom - home.top) / scale);
  }
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
