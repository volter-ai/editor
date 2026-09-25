/**
 * The 5x7 bitmap label drawn onto every contact sheet cell.
 *
 * Extracted from `asset-preview.ts` (where it was `drawBitmapLabel` plus its
 * `LABEL_GLYPHS` table) when the STORY lane needed the same labels: a story
 * variant sheet is composited from DOM captures and has no business importing
 * the three.js asset-preview engine to draw a caption. Same pixels, one owner
 * — a second hand-rolled label routine is exactly how two sheets start
 * looking like two products.
 *
 * A bitmap font rather than `fillText`: the sheet is evidence, and canvas text
 * rendering varies by platform font stack, which would make two runs of the
 * same capture differ in a way that has nothing to do with the subject.
 */

const LABEL_GLYPHS: Record<string, readonly string[]> = {
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '/': ['00001', '00010', '00100', '00100', '01000', '10000', '10000'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  // Labeled shot sets (project-defined labels like 'ZOOM-HEAD'/'BEND-Q')
  // pull in these additional glyphs, same 5x7 bitmap style as the set
  // above. The font covers A-Z and 0-9 outright rather than the subset the
  // in-repo sets happen to spell: a missing glyph renders as a BLANK CELL,
  // so a partial font mislabels a project's shot silently — the dragon set's
  // 'ZOOM-WINGTIP-UP' drew as 'ZOOM- INGTIP-UP' for want of a W.
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  // Axis-orientation annotations (asset-preview's authored-axis markers).
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '<': ['00010', '00100', '01000', '10000', '01000', '00100', '00010'],
  '>': ['01000', '00100', '00010', '00001', '00010', '00100', '01000'],
};

/**
 * The pixel box {@link drawBitmapLabel} will paint for `label` in a cell of
 * this size — exported so a caller can right- or bottom-align a label inside
 * its cell instead of duplicating the font's scale arithmetic.
 */
export function measureBitmapLabel(
  label: string,
  cellWidth: number,
  cellHeight: number,
): { width: number; height: number } {
  const scale = Math.max(1, Math.floor(Math.min(cellWidth, cellHeight) / 128));
  const padding = scale * 3;
  return {
    width: label.length * scale * 6 - scale + padding * 2,
    height: scale * 7 + padding * 2,
  };
}

export function drawBitmapLabel(
  context: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  cellWidth: number,
  cellHeight: number,
  tone: 'normal' | 'warning' = 'normal',
): void {
  const scale = Math.max(1, Math.floor(Math.min(cellWidth, cellHeight) / 128));
  const padding = scale * 3;
  const advance = scale * 6;
  const width = label.length * advance - scale + padding * 2;
  const height = scale * 7 + padding * 2;
  context.fillStyle = tone === 'warning' ? 'rgba(154, 24, 24, 0.92)' : 'rgba(0, 0, 0, 0.62)';
  context.fillRect(x, y, width, height);
  context.fillStyle = '#ffffff';
  for (let glyphIndex = 0; glyphIndex < label.length; glyphIndex++) {
    // Labels are project data now — a character outside the bitmap font
    // renders as a blank cell rather than crashing the capture.
    const glyph = LABEL_GLYPHS[label[glyphIndex]!];
    if (!glyph) continue;
    for (let row = 0; row < glyph.length; row++) {
      for (let column = 0; column < glyph[row]!.length; column++) {
        if (glyph[row]![column] === '1') {
          context.fillRect(
            x + padding + glyphIndex * advance + column * scale,
            y + padding + row * scale,
            scale,
            scale,
          );
        }
      }
    }
  }
}
