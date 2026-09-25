/**
 * A STORY'S THUMBNAIL, CAPTURED BY THE MEDIUM ITS COMPONENT RENDERS IN — a
 * three.js prefab story is mounted in an offscreen R3F stage, a canvas story in
 * an offscreen Pixi application. The kit's component content asks here by the
 * story's surface and keeps the component's icon where no medium registered.
 */
export interface StoryThumbnailOptions {
  readonly width: number;
  readonly height: number;
  readonly props: Record<string, unknown>;
  readonly layout: 'fullscreen' | 'padded' | 'centered';
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
