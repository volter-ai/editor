/**
 * React design documents deliberately use an opaque, theme-independent canvas.
 * Glass theme surface tokens are translucent and would let the chrome's
 * backdrop frost turn the fine dot grid into a pale blur. These literals describe the
 * semantic preview media itself, like an alpha checkerboard, rather than editor
 * chrome colors.
 */
export const REACT_DESIGN_CANVAS_COLOR = '#191c22';
export const REACT_DESIGN_CANVAS_DOT = 'rgba(255, 255, 255, 0.2)';
export const REACT_STORY_TRANSPARENCY_BASE = '#20242a';
export const REACT_STORY_TRANSPARENCY_TILE = '#2d323a';

export function reactStoryTransparencyBackground(): string {
  return (
    `linear-gradient(45deg, ${REACT_STORY_TRANSPARENCY_TILE} 25%, transparent 25%, ` +
    `transparent 75%, ${REACT_STORY_TRANSPARENCY_TILE} 75%), ` +
    `linear-gradient(45deg, ${REACT_STORY_TRANSPARENCY_TILE} 25%, transparent 25%, ` +
    `transparent 75%, ${REACT_STORY_TRANSPARENCY_TILE} 75%)`
  );
}
