/**
 * Integer zoom for pixel art. Transcribed from the sprite-lab stage
 * (`fitScale`): a fractional factor resamples the art, and a resampled
 * sheet is a blur with the correct pixels still in the file.
 */

/** Largest scale that fits `src` inside `box` without resampling. */
export function integerFitScale(
  srcWidth: number,
  srcHeight: number,
  boxWidth: number,
  boxHeight: number,
): number {
  if (srcWidth <= 0 || srcHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) return 1;
  const growX = srcWidth <= boxWidth ? Math.floor(boxWidth / srcWidth) : 0;
  const growY = srcHeight <= boxHeight ? Math.floor(boxHeight / srcHeight) : 0;
  const grow = Math.min(growX, growY);
  if (grow >= 1) return grow;
  return 1 / Math.max(Math.ceil(srcWidth / boxWidth), Math.ceil(srcHeight / boxHeight));
}

export type ImageScaleMode = 'fit' | 1 | 4 | 8;

export function resolveImageScale(
  mode: ImageScaleMode,
  srcWidth: number,
  srcHeight: number,
  boxWidth: number,
  boxHeight: number,
): number {
  return mode === 'fit' ? integerFitScale(srcWidth, srcHeight, boxWidth, boxHeight) : mode;
}
