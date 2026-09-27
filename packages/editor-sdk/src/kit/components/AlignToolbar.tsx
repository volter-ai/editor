/**
 * AlignToolbar — spec 27 §6 D4.b multi-select align/distribute toolbar:
 * shown when ≥2 world nodes are selected (align) / ≥3 (distribute), floating
 * above the selection's union bounding box. `RootSelectionOverlay.tsx`
 * decides WHEN this renders (its own `computeMultiSelectionAlign` capability
 * gate — every selected id must resolve both a rect AND an owning
 * `boxEdit`); this component owns only the button UI + routing a click
 * through the contract.
 *
 * Rule zero (spec §0): this file talks ONLY to the `AuthoringAdapter`
 * contract, via the SAME owner-routing helper (`boxEditForId`) the B2/B3
 * gesture code already uses — no store reach-in, no `THREE.`, no
 * `elementFromPoint`. The align/distribute MATH itself is the pure,
 * independently-tested `computeAlignTargets`/`computeDistributeTargets` in
 * `world-overlay-gestures.ts` — this file only maps their output onto a
 * `begin`/`apply`/`end` bracket per node (spec:301 "one undo step each").
 */

import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faAlignCenter,
  faAlignLeft,
  faAlignRight,
  faGripLines,
  faGripLinesVertical,
} from '@fortawesome/free-solid-svg-icons';
import {
  EditorIcon,
  FloatingToolbar,
  IconButton,
  ToolbarDivider,
  zIndex,
} from '@volter/editor-sdk/widgets';
import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import {
  type AlignEntry,
  type AlignOp,
  type AlignTarget,
  boxEditForId,
  computeAlignTargets,
  computeDistributeTargets,
  type DistributeAxis,
  type RectLike,
  unionRect,
} from './world-overlay-gestures';

export interface AlignToolbarProps {
  adapter: AuthoringAdapter;
  /** The current selection's id+rect pairs — already capability-checked by
   *  the caller (every id here has a resolvable owner `boxEdit`). */
  entries: readonly AlignEntry[];
}

/** Route every {@link AlignTarget} through its owning `boxEdit`
 *  (begin/apply/end — one undo step per node, per B1/D-1) — the ONE place
 *  align/distribute clicks touch the adapter contract. Targets whose owner
 *  has no `boxEdit` (shouldn't happen given the caller's capability gate,
 *  but honest regardless — see `boxEditForId`'s own `null` contract) are
 *  silently skipped rather than throwing. */
function commitAlignTargets(adapter: AuthoringAdapter, targets: readonly AlignTarget[]): void {
  for (const t of targets) {
    const boxEdit = boxEditForId(adapter, t.id);
    if (!boxEdit) continue;
    const patch: Record<string, number> = {};
    if (t.x !== undefined) patch['x'] = t.x;
    if (t.y !== undefined) patch['y'] = t.y;
    if (Object.keys(patch).length === 0) continue;
    boxEdit.begin(t.id);
    boxEdit.apply(t.id, patch);
    boxEdit.end(t.id);
  }
}

/**
 * L-7 — every other icon in this rail is a FontAwesome glyph; this toolbar
 * was the one holdout still rendering raw Unicode math symbols (`⊢`, `⊣⊢`,
 * `⊤`, `⇔`, …), which clash in weight/centering with the FA icon language
 * used everywhere else. FontAwesome Free's solid set has no dedicated
 * object-bbox align/distribute icons (only the 4 paragraph-align glyphs;
 * verified — no `faDistribute*`/`faAlignTop`/etc. exist in
 * `@fortawesome/free-solid-svg-icons`), so the vertical variants reuse the
 * horizontal align glyphs rotated 90° (`rotate` below) — the same technique
 * several icon sets use to derive a vertical-align glyph from a horizontal
 * one — and distribute reuses the evenly-spaced-bars grip glyphs. Still a
 * strict style-only swap: same meaning, same button size, one consistent
 * icon family instead of a second, unrelated glyph language.
 */
const ALIGN_BUTTONS: ReadonlyArray<{
  op: AlignOp;
  testId: string;
  label: string;
  icon: IconDefinition;
  rotate?: boolean;
}> = [
  { op: 'left', testId: 'align-left', label: 'Align left', icon: faAlignLeft },
  { op: 'hcenter', testId: 'align-hcenter', label: 'Align horizontal center', icon: faAlignCenter },
  { op: 'right', testId: 'align-right', label: 'Align right', icon: faAlignRight },
  { op: 'top', testId: 'align-top', label: 'Align top', icon: faAlignLeft, rotate: true },
  {
    op: 'vcenter',
    testId: 'align-vcenter',
    label: 'Align vertical center',
    icon: faAlignCenter,
    rotate: true,
  },
  { op: 'bottom', testId: 'align-bottom', label: 'Align bottom', icon: faAlignRight, rotate: true },
];

const DISTRIBUTE_BUTTONS: ReadonlyArray<{
  axis: DistributeAxis;
  testId: string;
  label: string;
  icon: IconDefinition;
}> = [
  {
    axis: 'horizontal',
    testId: 'distribute-horizontal',
    label: 'Distribute horizontally',
    icon: faGripLinesVertical,
  },
  {
    axis: 'vertical',
    testId: 'distribute-vertical',
    label: 'Distribute vertically',
    icon: faGripLines,
  },
];

/** Where the toolbar floats: centered above `bbox`, clamped so it never
 *  renders with a negative `top` (a selection near the host's own top edge
 *  still gets a visible toolbar, pinned just under the selection instead of
 *  off-screen above it). Pure; exported mainly for the e2e/visual read, not
 *  itself independently unit-tested (position is presentation, not the
 *  align/distribute MATH this task's acceptance criteria target). */
function toolbarPosition(bbox: RectLike): { left: number; top: number } {
  const height = 30;
  const margin = 8;
  const top = bbox.y - height - margin;
  return { left: bbox.x, top: top < 0 ? bbox.y + bbox.height + margin : top };
}

export function AlignToolbar({ adapter, entries }: AlignToolbarProps): React.ReactNode {
  if (entries.length < 2) return null;
  const bbox = unionRect(entries.map((e) => e.rect));
  if (!bbox) return null;
  const { left, top } = toolbarPosition(bbox);
  const canDistribute = entries.length >= 3;

  return (
    // U6a (P6 glass-native chrome): the one floating tool cluster that still
    // hand-rolled an opaque chrome slab — now the shared `FloatingToolbar`
    // island (var-driven `--vgai-island-*` material, refraction-upgradable
    // via `vgai-glass-island`; treatment-less themes emit the pre-P6 recipe
    // through the same vars). Geometry/placement stays inline.
    <FloatingToolbar
      label="Align and distribute"
      data-testid="align-toolbar"
      style={{
        position: 'absolute',
        left,
        top,
        zIndex: zIndex.overlayLow,
        gap: 2,
        padding: 3,
      }}
    >
      {ALIGN_BUTTONS.map(({ op, testId, label, icon, rotate }) => (
        <IconButton
          key={op}
          data-testid={testId}
          title={label}
          aria-label={label}
          variant="ghost"
          size="compact"
          onClick={() => commitAlignTargets(adapter, computeAlignTargets(entries, op))}
        >
          <EditorIcon
            icon={icon}
            aria-hidden="true"
            style={rotate ? { transform: 'rotate(90deg)' } : undefined}
          />
        </IconButton>
      ))}
      {canDistribute && (
        <>
          <ToolbarDivider />
          {DISTRIBUTE_BUTTONS.map(({ axis, testId, label, icon }) => (
            <IconButton
              key={axis}
              data-testid={testId}
              title={label}
              aria-label={label}
              variant="ghost"
              size="compact"
              onClick={() => commitAlignTargets(adapter, computeDistributeTargets(entries, axis))}
            >
              <EditorIcon icon={icon} aria-hidden="true" />
            </IconButton>
          ))}
        </>
      )}
    </FloatingToolbar>
  );
}
