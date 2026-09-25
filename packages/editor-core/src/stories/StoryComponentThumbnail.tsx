/**
 * One portable-CSF thumbnail — the CSF lane's answer to "what does this
 * component look like?", the picture behind every registered content entry,
 * which is what the Content grid paints and what the Inspector's component
 * preview shows (`content-entry-source-registry.ts`). Surface chooses the
 * native renderer; the story remains the sole preview authority for both Three
 * and Pixi prefabs.
 *
 * It was `components/StoryComponentThumbnail.tsx`, imported by name from three
 * host surfaces. All three ask a registered SOURCE now, so this module has
 * exactly one importer — `component-content-source.tsx`, beside it.
 */

import { useEffect, useState } from 'react';
import type { ProjectComponentEntry } from '@volter/editor-sdk/kit/asset-workflow/project-content';
import { TypedAssetThumbnail } from '../components/asset-thumbnails';
import { waitForFirstViewportFrame } from '@volter/editor-sdk/kit/viewport-activation-timings';
import type { ProjectPreviewStory } from './story-registry';
import { type StoryThumbnailOptions, storyThumbnailCapture } from '@volter/editor-sdk/kit/story-thumbnails';

/**
 * The in-memory thumbnail cache key: the story's identity plus the identity of
 * the args it was captured with, so an arg edit re-captures rather than showing
 * a stale picture of the previous value. Args are ordered by key so two equal
 * arg sets never key differently.
 *
 * Non-serializable arg values (functions, symbols, cycles) are represented by
 * their type rather than dropped — an arg that cannot be stringified must still
 * take part in identity, and it must never make the key THROW.
 */
function storyThumbnailKey(storyId: string, args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const name of Object.keys(args).sort()) {
    parts.push(`${name}=${stableArgValue(args[name])}`);
  }
  return `${storyId}|${parts.join('&')}`;
}

function stableArgValue(value: unknown): string {
  if (typeof value === 'function') return 'fn';
  if (typeof value === 'symbol') return 'symbol';
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value) ?? 'undefined';
  } catch {
    // A cyclic or otherwise unserializable object: identity by type, which is
    // stable for the lifetime of one composed story.
    return `[${typeof value}]`;
  }
}

const previewCache = new Map<string, string>();
const previewPending = new Map<string, Promise<string>>();
type StoryComponent = ProjectPreviewStory['Component'];
const storyComponentIdentities = new WeakMap<StoryComponent, number>();
let previewTail = Promise.resolve();
let initialPreviewTurn: Promise<void> | null = null;
let nextStoryComponentIdentity = 1;

function supportsStoryCapture(): boolean {
  return (
    typeof WebGLRenderingContext !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !navigator.userAgent.toLowerCase().includes('jsdom')
  );
}

/** Keep GPU-backed card generation behind the authored viewport the user is
 * waiting to see. A visible Content grid can mount many cards in the shell's
 * first React commit; starting their off-screen renderers immediately made
 * those thumbnails win the first WebGL context and delayed Scene by seconds. */
async function waitForInitialPreviewTurnInner(): Promise<void> {
  await Promise.race([
    waitForFirstViewportFrame(),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  // `recordViewportFirstFrame` runs immediately after issuing the draw, before
  // the browser has necessarily composited it. Cross two animation frames so
  // at least one paint can land before an off-screen thumbnail asks the GPU to
  // create another renderer. Hidden tabs get a bounded timer fallback.
  await Promise.race([
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    ),
    new Promise<void>((resolve) => setTimeout(resolve, 250)),
  ]);
  // Give pointer/automation tasks a turn after that paint. An idle callback can
  // legally run before an external observer is scheduled; without this small
  // grace period a software WebGL thumbnail context began immediately after
  // Scene's first draw and made an already-visible cube appear two seconds
  // late to the person (and to the editor's own control client).
  await new Promise<void>((resolve) => setTimeout(resolve, 750));
  await new Promise<void>((resolve) => {
    const idle = globalThis.requestIdleCallback;
    if (typeof idle === 'function') {
      idle(() => resolve(), { timeout: 2_000 });
      return;
    }
    setTimeout(resolve, 0);
  });
}

function waitForInitialPreviewTurn(): Promise<void> {
  initialPreviewTurn ??= waitForInitialPreviewTurnInner();
  return initialPreviewTurn;
}

function storyComponentIdentity(component: StoryComponent): number {
  const existing = storyComponentIdentities.get(component);
  if (existing !== undefined) return existing;
  const identity = nextStoryComponentIdentity++;
  storyComponentIdentities.set(component, identity);
  return identity;
}

function requestPreview(
  key: string,
  surface: ProjectComponentEntry['surface'],
  story: ProjectPreviewStory,
  size: { readonly width: number; readonly height: number },
): Promise<string> {
  const cached = previewCache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = previewPending.get(key);
  if (pending) return pending;
  const request = previewTail.then(async () => {
    // Only the first off-screen renderer waits behind the opening viewport.
    // `previewTail` already serializes all later GPU work; charging the paint
    // grace to every card would make a full Content grid reveal one thumbnail
    // every 750ms even after Scene is settled.
    await waitForInitialPreviewTurn();
    const declaredLayout = story.parameters['layout'];
    const layout: StoryThumbnailOptions['layout'] =
      declaredLayout === 'fullscreen' ||
      declaredLayout === 'padded' ||
      declaredLayout === 'centered'
        ? declaredLayout
        : 'padded';
    const options = { ...size, props: story.args, layout };
    // The medium the component renders in captures it
    // (`@volter/editor-sdk/kit/story-thumbnails`).
    const capture = storyThumbnailCapture(surface === 'canvas' ? 'canvas' : 'three');
    if (!capture) throw new Error(`No ${surface} story capture is registered.`);
    return capture(story.Component, options);
  });
  previewTail = request.then(
    () => undefined,
    () => undefined,
  );
  previewPending.set(key, request);
  void request.then(
    (url) => {
      previewCache.set(key, url);
      previewPending.delete(key);
    },
    () => previewPending.delete(key),
  );
  return request;
}

export function StoryComponentThumbnail({
  component,
  story,
  previewRevision,
  width = 128,
  height = 96,
}: {
  component: Pick<ProjectComponentEntry, 'name' | 'path' | 'surface'>;
  story: ProjectPreviewStory;
  previewRevision: number;
  /** Requested capture size. Content cards use 128×96; square Inspector
   * previews request a square so the native subject is never cropped merely
   * to fit different chrome. */
  width?: number;
  height?: number;
}) {
  const StoryComponent = story.Component;
  // HMR replaces the composed component even when the story id/args stay the
  // same. Include that native function identity so the Inspector cannot keep
  // displaying the old capture after the source changed.
  const key = `${component.surface}:${component.path}:${storyThumbnailKey(story.id, story.args)}:${storyComponentIdentity(StoryComponent)}:${previewRevision}:${width}x${height}`;
  const [url, setUrl] = useState(() => previewCache.get(key));
  const [captureFailed, setCaptureFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCaptureFailed(false);
    setUrl(previewCache.get(key));
    if (!supportsStoryCapture()) return;
    void requestPreview(key, component.surface, story, { width, height }).then(
      (nextUrl) => {
        if (!cancelled) setUrl(nextUrl);
      },
      () => {
        if (!cancelled) setCaptureFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [component.surface, height, key, story, width]);

  return url ? (
    <img src={url} alt={`${component.name} preview`} className="vgai-component-thumbnail" />
  ) : (
    <span
      className="vgai-component-thumbnail-fallback"
      data-component-preview={captureFailed ? 'failed' : 'capturing-story'}
    >
      <TypedAssetThumbnail kind="component" name={component.name} />
    </span>
  );
}
