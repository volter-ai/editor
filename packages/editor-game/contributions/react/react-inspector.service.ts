/**
 * THE REACT/DOM INSPECTOR (`@vgai/editor-sdk/services`, a `workspace.service`
 * contribution): the rich CSS/layout section that stands in for the shell's
 * generic property grid on a node owned by a react or DOM adapter — borders,
 * radii, shadows, gradients, filters, fonts, alignment, the breakpoint strip
 * and the eyedropper, each descriptor mapped to its widget instead of a text
 * field.
 *
 * ## Why this is a package and not the host's
 *
 * It was `packages/editor/src/authoring/react-inspector-section.tsx`,
 * registered at module scope and reached by ONE line in the host's entry:
 * `main.tsx:33`, `import './authoring/react-inspector-section';`. A bare
 * side-effect import has no `from`, so the closure gate's walk never followed
 * it — and behind it came the whole React/DOM design-time surface, 28 files
 * and 14,274 lines, into every editor boot, a `models` build that authors no
 * DOM included. The gate was corrected first (PR #7225) so this cut could be
 * measured rather than asserted.
 *
 * ## Why its own package rather than `@vgai/game`
 *
 * Because `@vgai/game` already imports the surface this section drives from
 * two unrelated lanes — `src/play/react-play-live-authoring.ts` and the
 * ingest lane's DOM mount both reach `ReactRootAuthoringAdapter` — and the
 * planned design skew (a Figma-shaped canvas) wants the same surface and is
 * not a game. A surface a game editor and a design editor both author lives
 * in neither.
 *
 * ## The seam, which is not a new one
 *
 * `@editor/inspector-section-registry` is the host's own registry and has been
 * "the PERMANENT, sanctioned adapter-module seam" since it was written; the
 * package REGISTERS, and the host names no lane. The service point is
 * transcribed from `@vgai/game`'s `story-documents.service.ts`, which installs
 * a story-scoped Inspector section the same way and for the same reason: a
 * section is not a document, so it never opens and never persists, and what a
 * contribution pass owns is when its registration exists.
 *
 * The `tool.inspector` point was CONSIDERED AND REJECTED with the reason here:
 * it pins a contributed section to the wrench glyph at
 * `CONTRIBUTED_SECTION_ORDER + declared`, while this section CLAIMS
 * `PROPERTIES_SECTION_ID` and composes the node's own property GROUPS in
 * `GROUP_SECTION_ORDER`. Routing it through that point would have moved the
 * blocks below every contributed section and left the thin generic grid
 * showing beside them.
 *
 * ## What has NOT moved, and why
 *
 * THE ADAPTERS THEMSELVES MOVED HERE on 2026-09-18 (phase 1 unit 12):
 * `react-world-authoring-adapter.ts` and `dom-authoring-adapter.ts` are
 * `@vgai/dom/src/` files now. The blocker this docblock used to name —
 * "`authoring/design-time-layers.ts` CONSTRUCTS the React adapter" — is gone,
 * because the design-time mount is a REGISTRATION now
 * (`@editor/authoring/design-time-mount-registry`), so both constructions
 * moved into this package with `mountReactLayer` and the pair had no host
 * importer left. `@vgai/game`'s play-live authoring and four modules of its
 * ingest lane import them as `@vgai/dom/…`; that package declares the
 * dependency.
 *
 * Still host files, reached through `@editor/*` — the shape units 4 and 5
 * landed — and each with the host importer that keeps it there:
 * the DOM projection and the CSS inspection estate
 * (`components/RootSelectionOverlay.tsx`); the surgical JSX writer and the
 * structural write pipe (`authoring/r3f-source-authoring-adapter.ts`,
 * `@vgai/canvas/pixi-source-write-target.ts`); the breakpoint state
 * (`components/BoardRulers.tsx`); `authoring/react-story-board.ts`, the
 * board's geometry, which four host surfaces read
 * (`components/RootSelectionOverlay.tsx:98`,
 * `components/ReactCanvasControls.tsx:15`, `pasteboard-materialize.ts:20`,
 * `canvas-board/CanvasBoardDocument.tsx:57`) because they draw chrome OVER
 * the board. Each is its own unit with its own seam; none of them is in the
 * host's EAGER closure, which is what these cuts buy.
 */

import { ensureReactInspectorSectionRegistered } from '../src/react-inspector-section';

export const point = 'workspace.service';

export function start(): () => void {
  ensureReactInspectorSectionRegistered();
  // The stop is a no-op, and that is the same lifetime this had as a host
  // module: its registration group is HMR-owned, and the section outlives any
  // one contribution pass. Nothing here holds a resource a pass may end.
  return () => {};
}
