/**
 * One sprite from a packed atlas — Aseprite's cel / Unity's Sprite /
 * Godot's AtlasTexture. The sheet is the source texture; this paints the
 * named frame onto the untrimmed canvas at nearest-neighbor.
 */
import { useEffect, useRef } from 'react';
import { integerFitScale } from '../../asset-workflow/image-view-scale';
import { type PixiSpritesheetFrame, packedFrameRect } from '../../asset-workflow/pixi-spritesheet';

export function paintSpriteFrame(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource,
  frame: PixiSpritesheetFrame,
): void {
  const destWidth = Math.max(1, frame.sourceWidth ?? frame.width);
  const destHeight = Math.max(1, frame.sourceHeight ?? frame.height);
  canvas.width = destWidth;
  canvas.height = destHeight;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, destWidth, destHeight);
  const packed = packedFrameRect(frame);
  if (frame.rotated) {
    context.save();
    context.translate(frame.trimX, frame.trimY + packed.width);
    context.rotate(-Math.PI / 2);
    context.drawImage(
      image,
      packed.x,
      packed.y,
      packed.width,
      packed.height,
      0,
      0,
      packed.width,
      packed.height,
    );
    context.restore();
    return;
  }
  context.drawImage(
    image,
    packed.x,
    packed.y,
    packed.width,
    packed.height,
    frame.trimX,
    frame.trimY,
    packed.width,
    packed.height,
  );
}

export function SpritesheetSpriteView({
  sheetUrl,
  frame,
  scale,
  maxEdge,
}: {
  sheetUrl: string;
  frame: PixiSpritesheetFrame;
  scale?: number;
  maxEdge?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const destWidth = Math.max(1, frame.sourceWidth ?? frame.width);
  const destHeight = Math.max(1, frame.sourceHeight ?? frame.height);
  const resolved =
    maxEdge != null ? integerFitScale(destWidth, destHeight, maxEdge, maxEdge) : (scale ?? 1);
  const displayWidth = Math.max(1, Math.round(destWidth * resolved));
  const displayHeight = Math.max(1, Math.round(destHeight * resolved));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const image = new Image();
    let cancelled = false;
    image.onload = () => {
      if (!cancelled) paintSpriteFrame(canvas, image, frame);
    };
    image.src = sheetUrl;
    return () => {
      cancelled = true;
    };
  }, [frame, sheetUrl]);

  return (
    <canvas
      ref={canvasRef}
      width={destWidth}
      height={destHeight}
      aria-hidden
      style={{
        width: displayWidth,
        height: displayHeight,
        imageRendering: 'pixelated',
        display: 'block',
      }}
    />
  );
}
