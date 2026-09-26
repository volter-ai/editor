/**
 * Board chrome — frame names and group names — is CONSTANT-SIZE client-space
 * furniture floating over a board that zooms underneath it (the deliberate
 * Figma-style choice: names stay readable at any scale). The authored gaps
 * that chrome lives in DO shrink with zoom, so below some zoom a constant
 * 26px frame-name stack no longer fits a 64-authored-px row gap and paints
 * over the frames of the row above.
 *
 * This module owns the one rule that prevents that: **chrome degrades, frames
 * never move**. Given the client-space room above a row of frames, it returns
 * the scale/opacity/offset the chrome must adopt so its painted box always
 * ends at or below whatever sits above it. Layout stays zoom-independent.
 *
 * Priority: a group name is the navigation anchor at overview zoom, so it is
 * served FIRST out of the available room and therefore degrades LAST; the
 * frame name gets whatever is left over.
 */

export const FRAME_LABEL_HEIGHT = 20;
export const FRAME_LABEL_GAP = 6;
export const GROUP_LABEL_HEIGHT = 22;
export const GROUP_LABEL_GAP = 10;

/** Client px a frame name claims above its frame's top edge at scale 1. */
export const FRAME_LABEL_STACK = FRAME_LABEL_HEIGHT + FRAME_LABEL_GAP;
/** Client px a group name claims above the frame-name stack at scale 1. */
export const GROUP_LABEL_STACK = GROUP_LABEL_HEIGHT + GROUP_LABEL_GAP;

/** Below this scale a name starts fading; below the hide scale it is dropped
 *  entirely, because an unreadable sliver of text is noise, not information. */
const FRAME_FADE_FROM = 0.6;
const FRAME_HIDE_BELOW = 0.4;
const GROUP_FADE_FROM = 0.7;
const GROUP_HIDE_BELOW = 0.45;

export interface ChromePlacement {
  /** Uniform scale, applied with `transform-origin` at the element's bottom-left. */
  readonly scale: number;
  /** 0..1; 0 only when `visible` is false. */
  readonly opacity: number;
  /** false → do not paint (and do not accept pointer events) at all. */
  readonly visible: boolean;
  /** Client px to subtract from the row's top edge to get the element's `top`.
   *  Accounts for the element's own unscaled height, since the scale pivots on
   *  its bottom edge. */
  readonly offset: number;
}

export interface StoryChromePlacement {
  readonly frame: ChromePlacement;
  /** null when the row carries no group name. */
  readonly group: ChromePlacement | null;
}

function fade(scale: number, fadeFrom: number, hideBelow: number): [number, boolean] {
  if (scale >= fadeFrom) return [1, true];
  if (scale <= hideBelow) return [0, false];
  return [(scale - hideBelow) / (fadeFrom - hideBelow), true];
}

/**
 * Fit one frame row's chrome into the client-space `room` above it — the
 * distance from the row's top edge to the bottom edge of the nearest frames
 * above it (`Infinity` for the first row of the board, which has nothing
 * above it to collide with).
 *
 * Invariant: the painted top of every returned placement is at or below
 * `rowTop - room`, so chrome never paints over a frame that is not its own.
 */
export function placeStoryChrome(room: number, withGroupLabel: boolean): StoryChromePlacement {
  const usable = Math.max(0, room);
  const groupScale = withGroupLabel ? Math.min(1, usable / GROUP_LABEL_STACK) : 0;
  const [groupOpacity, groupVisible] = fade(groupScale, GROUP_FADE_FROM, GROUP_HIDE_BELOW);

  const frameRoom = Math.max(0, usable - GROUP_LABEL_STACK * groupScale);
  const frameScale = Math.min(1, frameRoom / FRAME_LABEL_STACK);
  const [frameOpacity, frameVisible] = fade(frameScale, FRAME_FADE_FROM, FRAME_HIDE_BELOW);

  // A dropped frame name reserves nothing, which lets the group name settle
  // closer to the frames instead of floating over an empty band.
  const frameConsumed = frameVisible ? FRAME_LABEL_STACK * frameScale : 0;

  return {
    frame: {
      scale: frameScale,
      opacity: frameOpacity,
      visible: frameVisible,
      offset: FRAME_LABEL_GAP * frameScale + FRAME_LABEL_HEIGHT,
    },
    group: withGroupLabel
      ? {
          scale: groupScale,
          opacity: groupOpacity,
          visible: groupVisible,
          offset: frameConsumed + GROUP_LABEL_GAP * groupScale + GROUP_LABEL_HEIGHT,
        }
      : null,
  };
}

/** Paint one chrome element at the placement this module computed. */
export function applyStoryChrome(element: HTMLElement, placement: ChromePlacement): void {
  element.style.transformOrigin = '0 100%';
  element.style.transform = placement.scale >= 1 ? '' : `scale(${placement.scale})`;
  element.style.opacity = placement.visible ? String(placement.opacity) : '0';
  element.style.display = placement.visible ? '' : 'none';
}
