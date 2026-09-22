/**
 * The VERSION at the far right of the status bar (`workspace.status`).
 *
 * Blender's bottom row ends with a status glyph and `5.2.0` — the app's own
 * version, always on screen, so "which build am I looking at" is never a
 * menu trip. This is that, for this editor.
 *
 * WHERE THE NUMBER COMES FROM. The open project's manifest declares the
 * engine it is built against, and the host door exposes it as
 * `editorHost().project.engineVersion()` — the exact field
 * `ProjectHeader.tsx` renders as `v{engineVersion}`. This reuses that one
 * source rather than importing a `package.json`: the version that matters to
 * a person looking at a project is the one the project is pinned to, and a
 * second reading could disagree with the header's.
 *
 * It is read through the SDK's host door and NOT through `@editor/*`, and
 * its two inline styles spell the theme tokens directly
 * (`var(--vgai-space-2)`, `var(--vgai-font-md)`) rather than importing the
 * host's `fontSizeVar`/`spaceVar` handles: `@volter/editor-blender` is pinned at ZERO
 * host imports (`validate-editor-closure.mjs`), the first package to reach
 * that destination, and a token NAME is the published contract while the
 * handle object is the host's own sugar. The widget kit's move to
 * `@volter/editor-sdk/widgets` is deferred (WORK.md §Skews as packages, item 5);
 * until it lands, a package styling inline writes the `var()`.
 *
 * Nothing before a project is open (there is no version to tell the truth
 * about yet), per the registry contract's "an item that is currently
 * meaningless returns null itself".
 *
 * The connection half of Blender's pair is the host's own job and already
 * exists (`status-contributions.tsx`'s `editor-lease` item, which is quiet
 * while the editor is served and speaks when it is not); this contributes
 * only the version, and the host's counters are untouched.
 */

import { editorHost } from '@volter/editor-sdk/host';
import { useSyncExternalStore } from 'react';

export const point = 'workspace.status';
export const title = 'Version';
export const align = 'right';
/** The back of the contributed band: last item on the right, as in Blender.
 *  `tool-loader.ts`'s `MAX_DECLARED_ORDER` is 998. */
export const order = 998;

export default function BlenderVersionStatus() {
  const { project } = editorHost();
  const version = useSyncExternalStore(
    project.subscribe,
    project.engineVersion,
    project.engineVersion,
  );
  if (version === null) return null;
  return (
    <span
      className="vgai-status-copy"
      data-testid="status-blender-version"
      data-engine-version={version}
      // NO COLOUR AND NO `sm`. Measured on the native-2x frames, Blender's
      // `5.2.0` is `#878787` (135, a flat plateau — 53 px at 134 and 33 at 135
      // across the digits) with a 9.0 CSS cap height (18 device). 135 is the
      // DIMMEST text in Blender's window and the same ink its mouse hints take
      // at the other end of the band, so the band is one voice and this
      // inherits it rather than pinning `content.muted` (194) and becoming the
      // loudest thing in the quietest strip. The cap puts the size on the
      // `md`/`base` rung (11px -> 8.8), not `sm` (10px -> 8.0).
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--vgai-space-2)',
        fontSize: 'var(--vgai-font-md)',
      }}
      title={`This project is built against engine ${version}`}
    >
      {/* Blender's thin rule between the status glyph and the number, measured
          on `modeling.png` at device x 3369..3371, y 2069..2097: 1.5 CSS wide,
          14.5 CSS tall, and inked 134 — the TEXT's own colour, not a boundary.
          It was drawn here at `boundary.strong` (#3c3c3c, 60), which against a
          #171717 band is all but invisible; `currentColor` is both the measured
          colour and the one that cannot drift from the number beside it. The
          height rung closest to 14.5 is `icon-md` (14). */}
      <span
        aria-hidden="true"
        style={{
          width: 'var(--vgai-stroke-resting)',
          height: 'var(--vgai-icon-md)',
          background: 'currentColor',
        }}
      />
      {version}
    </span>
  );
}
