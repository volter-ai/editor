/**
 * A STORY'S THUMBNAIL, CAPTURED BY THE MEDIUM ITS COMPONENT RENDERS IN — a
 * three.js prefab story is mounted in an offscreen R3F stage, a canvas story in
 * an offscreen Pixi application. The kit's component content asks here by the
 * story's surface and keeps the component's icon where no medium registered.
 */
import type { AssetPreviewCameraChoice, AssetPreviewPose } from '../types';

export interface StoryThumbnailOptions {
  readonly width: number;
  readonly height: number;
  readonly props?: Record<string, unknown>;
  readonly layout?: 'fullscreen' | 'padded' | 'centered';
  /** A free capture camera, where the medium frames its subject itself. */
  readonly camera?: AssetPreviewCameraChoice;
  /** A clip pose for the subject. */
  readonly pose?: AssetPreviewPose;
}

/**
 * The medium's refusal of a story that is not its own (an R3F leg handed a DOM
 * story): the caller tries the next leg, and says nothing, because the refusal
 * is a classification rather than a failure.
 */
export class StoryMediumMismatch extends Error {
  override readonly name = 'StoryMediumMismatch';
}

export function isStoryMediumMismatch(error: unknown): boolean {
  return error instanceof Error && error.name === 'StoryMediumMismatch';
}

export type StoryThumbnailCapture = (component: unknown, options: StoryThumbnailOptions) => Promise<string>;

const captures = new Map<string, StoryThumbnailCapture>();

/** Register the capture for one surface (`three`, `canvas`). Returns the removal. */
export function registerStoryThumbnailCapture(surface: string, capture: StoryThumbnailCapture): () => void {
  captures.set(surface, capture);
  return () => {
    if (captures.get(surface) === capture) captures.delete(surface);
  };
}

export function storyThumbnailCapture(surface: string): StoryThumbnailCapture | null {
  return captures.get(surface) ?? null;
}
