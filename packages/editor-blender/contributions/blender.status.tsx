/**
 * Blender's MOUSE HINTS, at the left of the status bar (`workspace.status`).
 *
 * Blender's bottom row opens with three tiny mouse glyphs, each with one
 * button lit and the action it performs beside it — `Select`, `Rotate View`,
 * `Options` in the reference (`modeling.png`). It is the one piece of chrome
 * that tells a newcomer what the three buttons DO without a menu, and the
 * gap a human build session measured here was exactly that question ("how do
 * I move the camera", six times — `viewport-controls-hint.ts`).
 *
 * THEY ARE HOVER-DRIVEN THERE, AND ALWAYS-ON HERE. Measured across the whole
 * reference set: `modeling.png` is the ONE frame with any ink left of centre
 * in the status band; `layout`, `modeling-edit-none`, `modeling-edit-all`,
 * `modeling-object-selected`, `sculpting` and `texture-paint` all have ZERO
 * ink before device x 3325 — Blender publishes the keymap for whatever the
 * cursor is over, so a still with the pointer outside the 3D View shows
 * nothing. A still therefore cannot say whether Blender's band is empty by
 * design; it can only say what the hints look like WHEN they are drawn, which
 * is what the geometry below is measured from. Ours are unconditional
 * because the editor has no hover-scoped keymap publisher and inventing one
 * to match a screenshot would be a mechanism with no other reader.
 *
 * THE ACTION NAMES ARE OURS, NOT BLENDER'S. What each button does is a fact
 * about THIS editor, so the labels are read from this editor's own contract,
 * never transcribed from the reference:
 *
 *   - the KEYMAP (`keymap-presets.ts`, `@volter/editor-sdk/looks`) binds no
 *     mouse buttons and structurally cannot: a `KeyChord` is
 *     `{ key, code?, mod?, shift?, alt? }` (`editor-sdk/src/looks.ts:76-82`)
 *     with no button field, so no keymap — the Blender one included — can
 *     move a mouse binding. Nothing to read there.
 *   - so the source is the VIEWPORT's own mouse contract:
 *     `editor-viewport.ts:682-686` sets `orbitControls.mouseButtons` to
 *     `{ LEFT: -1, MIDDLE: PAN, RIGHT: ROTATE }`, and the left button is left
 *     free for the selection raycast (`editor-viewport.ts:3782`,
 *     `if (e.button === 0 && !e.altKey)`). The editor's own prose says the
 *     same thing (`ViewportControlsHint.tsx:22`: "Orbit: right-drag · Pan:
 *     middle-drag").
 *
 * That contract is a constant of the host, not of any document, so the table
 * below is a constant too — with the citations above as its provenance. When
 * a surface ever makes a button mean something else, it publishes that and
 * this reads it; it does not get hardcoded here.
 *
 * The inline styles spell the theme tokens directly (`var(--vgai-space-5)`,
 * `var(--vgai-font-md)`) instead of importing the host's `spaceVar` /
 * `fontSizeVar` handles: `@volter/editor-blender` is pinned at ZERO host imports
 * (`validate-editor-closure.mjs`). See `blender-version.status.tsx`.
 */

export const point = 'workspace.status';
export const title = 'Mouse hints';
export const align = 'left';
/** Front of the contributed band — see the note at the bottom of this file
 *  for why that is not the front of the bar. */
export const order = 0;

/** Which button the glyph lights. */
type MouseButton = 'left' | 'middle' | 'right';

/**
 * The viewport's three buttons, in Blender's order. Sourced from
 * `editor-viewport.ts:682-686` + `:3782` (see the header) — the editor's
 * contract, which is why the middle/right labels are Pan/Orbit and not
 * Blender's own Rotate View/Options.
 */
const HINTS: readonly { readonly button: MouseButton; readonly label: string }[] = [
  { button: 'left', label: 'Select' },
  { button: 'middle', label: 'Pan View' },
  { button: 'right', label: 'Orbit View' },
];

/**
 * One mouse glyph in Blender's idiom, TRANSCRIBED FROM THE FRAME rather than
 * estimated: `modeling.png` at native 2x (the only reference frame whose
 * status bar carries the hints — see the note under {@link HINTS}), glyph 1 at
 * device x 12..35, y 2065..2096. Halved, that is a 12 x 16 CSS ink box, and
 * the viewBox IS that box so the SVG needs no scale factor to reason about:
 * one unit is one CSS pixel at the size below.
 *
 * MEASURED BY COVERAGE, NOT BY A THRESHOLD. Every number below is the 50%
 * contour of `(value - 23) / (135 - 23)` — an ink threshold reads a glyph's
 * antialiasing as geometry and got two of these badly wrong on the first cut.
 * Device reading -> CSS (the ink box's left edge is device -0.5, so
 * `css = (device + 0.5) / 2`):
 *
 *   shell stroke       1.98 device, flat on every side row -> {@link STROKE} 1
 *   button row height  16 of 32 device -> {@link BUTTON_H} 8, exactly half
 *   lit button width   left fill ends 9.5 / right fill starts 13.5 device
 *                      -> {@link BUTTON_W} 5, a button at each end
 *   divider            the shell's top edge stops at 11.98 device in the
 *                      left-lit glyph and starts there in the right-lit one
 *                      -> {@link DIVIDER_X} 6.25, ONE boundary, not a gap
 *                      centred on the middle
 *   gap under button   2 device of nothing (fill ends row 15, stroke resumes
 *                      row 18) -> {@link UNDER_GAP} 1
 *   wheel              8 x 14 device at x 8, y 4, ends rounded at r 2.5
 *                      -> 4 x 7 at 4, 2, rx 1.25
 *
 * THE LIT BUTTON IS NOT AN INSET NUB AND NOT A CLIPPED OVERLAY: in the frame
 * the fill REPLACES the shell over its own quadrant (a mid row reads ten solid
 * device px from the very left edge) and the shell stroke is absent for two
 * device rows beneath it and across the divider on the top edge. So the fill
 * is the outer silhouette intersected with the button rect, and the stroke is
 * MASKED OUT over the button's side of the divider down to the hairline —
 * which is why there is a mask here and not the clip the earlier cut used.
 *
 * (Superseded readings, kept so the next round does not re-derive them: a
 * 13x17 box with a 1.7 stroke and a 0.45 hairline, sized to the text's own
 * font size. Both came from a DPR-1 capture against a downscaled reference,
 * which is the instrument WORK.md records as unable to settle stroke weights;
 * at native 2x the glyph measures 16 CSS tall against 9 CSS of cap height,
 * not the ~1:1 that reading reported.)
 *
 * RESIDUE, measured and not fitted away: Blender's TOP edge integrates 3.0
 * device px of coverage where its sides integrate 1.98. One uniform stroke
 * cannot draw both, and a second stroke for the top would be a constant with
 * no reason behind it; the sides are the ones that set the glyph's weight.
 */
const STROKE = 1;
const BUTTON_H = 8;
const BUTTON_W = 5;
const UNDER_GAP = 1;
/**
 * Where the shell's top edge stops for a lit LEFT button and starts again for
 * a lit RIGHT one — ONE boundary, at device 11.98 in both glyphs, not a gap
 * straddling the centre. The button fills stop short of it by 1.25 on the left
 * and start 0.75 past it on the right, which is why modelling this as a
 * symmetric "gap" beside a button could not reproduce either glyph.
 */
const DIVIDER_X = 6.25;
/**
 * The shell's OUTER corner radius, and the number two cuts got wrong — first
 * as a capsule (half the width), then as 2 from an ink threshold. SOLVED on
 * the 50% contour of the middle glyph's bottom-left and top-right corners
 * (`modeling.png`, device x 122..145, y 2065..2096): the contour runs 4.04,
 * 2.39, 1.33, 0.55, 0.05, -0.28 device from the straight edge over successive
 * rows, and a circle of radius 7.16 device reproduces all six to within 0.11.
 * The opposite corner independently gives 7.2. Halved, 3.6 — and both wrong
 * answers were visible at full scale as the wrong SHAPE, not the wrong size.
 */
const RADIUS = 3.6;
/** The ink box, in CSS px, and the viewBox. */
const BOX = { width: 12, height: 16 } as const;

function MouseGlyph({ button }: { button: MouseButton }) {
  const id = `vgai-mouse-${button}`;
  const rightX = BOX.width - BUTTON_W;
  const fillX = button === 'right' ? rightX : 0;
  // The stroke's own rect runs along the centre line of a 1-unit stroke, so it
  // is inset half a stroke and its radius drops by the same half.
  const half = STROKE / 2;
  const outerRx = RADIUS;
  return (
    <svg
      viewBox={`0 0 ${BOX.width} ${BOX.height}`}
      role="presentation"
      aria-hidden="true"
      focusable="false"
      // 16 CSS px, which is the `lg` icon rung — and Blender's glyph measures
      // exactly 16 CSS tall in the frame. `width: auto` then resolves to 12
      // from the viewBox, the measured width, with no second number to drift.
      style={{ height: 'var(--vgai-icon-lg)', width: 'auto', display: 'block', flex: '0 0 auto' }}
    >
      <title>{button} mouse button</title>
      {/* The outer silhouette: what the fill is intersected with, so the lit
          quadrant follows the shell's rounded shoulder. */}
      <clipPath id={`${id}-outer`}>
        <rect x="0" y="0" width={BOX.width} height={BOX.height} rx={outerRx} />
      </clipPath>
      {/* Where the shell stroke is NOT drawn: the lit button's whole side of
          the divider, down to the hairline beneath the button. */}
      <mask id={`${id}-shell`}>
        <rect x="0" y="0" width={BOX.width} height={BOX.height} fill="white" />
        {button !== 'middle' && (
          <rect
            x={button === 'right' ? DIVIDER_X : -1}
            y={-1}
            width={button === 'right' ? BOX.width - DIVIDER_X + 1 : DIVIDER_X + 1}
            height={BUTTON_H + UNDER_GAP + 1}
            fill="black"
          />
        )}
      </mask>
      <rect
        x={half}
        y={half}
        width={BOX.width - STROKE}
        height={BOX.height - STROKE}
        rx={outerRx - half}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        mask={`url(#${id}-shell)`}
      />
      {button !== 'middle' && (
        <rect
          x={fillX}
          y="0"
          width={BUTTON_W}
          height={BUTTON_H}
          fill="currentColor"
          clipPath={`url(#${id}-outer)`}
        />
      )}
      {button === 'middle' && (
        <rect x="4" y="2" width="4" height="7" rx="1.25" fill="currentColor" />
      )}
    </svg>
  );
}

export default function BlenderMouseHintsStatus() {
  return (
    <span
      className="vgai-status-copy"
      data-testid="status-blender-mouse-hints"
      // Blender's hint-to-hint gap is 9.5 CSS (glyph 1 ends at 51.5, glyph 2
      // starts at 61; the second gap repeats it to a tenth). `space-5` is 10.
      style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--vgai-space-5)' }}
    >
      {HINTS.map((hint) => (
        <span
          key={hint.button}
          data-mouse-button={hint.button}
          // NO COLOUR HERE. The band declares its own ink and Blender's status
          // bar is the DIMMEST text in its window — `#878787` (135) flat, on
          // every frame, against the 216 its top-bar menus ink. A contribution
          // that pins `content.muted` (194) makes itself the loudest thing in
          // the quietest band; inheriting is what keeps the band one voice.
          //
          // The SIZE is measured: Blender's status text caps at 9.0 CSS (18
          // device), which is the `md`/`base` rung (11px -> 8.8), not `sm`
          // (10px -> 8.0).
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--vgai-space-1)',
            fontSize: 'var(--vgai-font-md)',
          }}
          title={`${hint.label} — the ${hint.button} mouse button in the viewport`}
        >
          <MouseGlyph button={hint.button} />
          {hint.label}
        </span>
      ))}
    </span>
  );
}

/**
 * ORDER, and the one thing this cannot have. Blender's hints are the
 * LEFTMOST thing in its bottom row. A contributed status item cannot be:
 * `tool-loader.ts:1145` registers it at `contributedSectionOrder(order)`,
 * which is `CONTRIBUTED_SECTION_ORDER + (order ?? 999)`
 * (`tool-loader.ts:359-361`) with `CONTRIBUTED_SECTION_ORDER = 5000`
 * (`inspection/model.ts:475`), while the host's own left items register at
 * -90..40 (`components/status-contributions.tsx`). Every contributed item
 * therefore lands BEHIND every core item, by construction — the band exists
 * precisely so a contribution cannot outrank a built-in. `order = 0` is the
 * front of what the contract allows: first among contributed left items,
 * after the host's save/console/play cluster.
 */
