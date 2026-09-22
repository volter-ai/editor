/**
 * The 3D board's empty-viewport vocabulary, reused by every other design
 * surface that would otherwise sit blank while it builds. Scene's root-aware
 * loading/failure/empty states live in `SurfaceStateOverlay`; this compact
 * label remains for object/board construction whose subject is already known.
 *
 * Idle / building / ready is viewport STATE, not a new overlay channel —
 * the board already owns this shape (`ThreeBoardDocument`: idle "Open this
 * tab…", building "Settling N stories…"). Scene's first design
 * mount and `Object3DDocumentViewport`'s first construct are the same wait
 * with different subjects. Copy names the subject being prepared; it does not
 * claim a narrower phase (such as physics settling) while indexing, mounting,
 * bounds/layout, or renderer setup is actually in flight.
 */

import { themeVars } from '@volter/editor-sdk/widgets';
import type { ReactNode } from 'react';

/** Fixed construct tail after the board scene exists — viewport-bind, not settle. */
export const OBJECT3D_SURFACE_BUILDING = 'Preparing the viewport…';

/** Whole 3D-board construction, from component index through mounted previews. */
export const THREE_BOARD_BUILDING = 'Preparing 3D component previews…';

/** Name the candidate count when we already know it. Never a progress fraction. */
export function threeBoardBuildingCopy(storyCount: number): string {
  if (!Number.isFinite(storyCount) || storyCount < 1) return THREE_BOARD_BUILDING;
  return storyCount === 1
    ? 'Preparing 1 component preview…'
    : `Preparing ${storyCount} component previews…`;
}

export function ViewportSurfaceStatus({
  testId,
  children,
}: {
  readonly testId: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        position: 'absolute',
        inset: 0,
        padding: 16,
        fontSize: 12,
        color: themeVars.content.muted,
        pointerEvents: 'none',
      }}
    >
      {children}
    </div>
  );
}
