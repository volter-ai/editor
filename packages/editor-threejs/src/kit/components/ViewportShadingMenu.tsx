import { faCaretDown, faCheck } from '@fortawesome/free-solid-svg-icons';
import {
  AnchoredMenu,
  Button,
  EditorIcon,
  IconButton,
  MenuItem,
  MenuSeparator,
  Tooltip,
  themeVars,
} from '@volter/editor-sdk/widgets';
import type { ViewportShadingMode } from '@volter/editor-threejs/render/viewport-shading';
import { type ReactNode, useRef, useState } from 'react';

export const viewportShadingModes: ReadonlyArray<{
  mode: ViewportShadingMode;
  label: string;
  description: string;
}> = [
  { mode: 'solid', label: 'Material', description: 'Authored materials and lighting' },
  { mode: 'clay', label: 'Solid', description: 'Neutral flat-shaded geometry' },
  { mode: 'unlit', label: 'Unlit', description: 'Base color without scene lighting' },
  { mode: 'wireframe', label: 'Wireframe', description: 'Renderable triangle edges' },
  { mode: 'matcap', label: 'Matcap', description: 'Neutral clay sphere — form without color' },
  { mode: 'normals', label: 'Normals', description: 'Surface-normal direction colors' },
  { mode: 'overdraw', label: 'Overdraw', description: 'Additive overlap visualization' },
];

export interface ViewportDisplayModeChoice<T extends string> {
  readonly mode: T;
  readonly label: string;
  readonly description: string;
}

/**
 * A SHADING SEGMENT — one cell of Blender's four-button shading group, which
 * is what its 3D View header spends on shading instead of a word dropdown.
 * `glyph` names the MARK, never the mode: the same sphere means "solid" in
 * any vocabulary, and a caller's mode ids are its own.
 */
export interface ViewportShadingSegment<T extends string> {
  readonly mode: T;
  readonly glyph: 'wireframe' | 'sphere' | 'preview' | 'rendered';
  readonly label: string;
}

/**
 * THREE OF BLENDER'S FOUR, and the fourth stands only where it has a mode.
 * Blender's group is Wireframe / Solid / Material Preview / Rendered; this
 * viewport implements the first three (`viewportShadingModes` above:
 * `wireframe`, `clay` — its own label is "Solid" — and `solid`, labelled
 * "Material"). A stage that keeps its lighting per draw mode draws Blender's
 * own four instead ({@link perModeShadingSegments}); elsewhere a Rendered cell
 * would be a shim promising a render the stage does not produce.
 * Every other mode this viewport HAS (Unlit, Matcap, Normals, Overdraw, and
 * the document's UV / Vertex-colors when the asset carries them) stays in the
 * popover behind the chevron, which is also where Blender keeps the rest of
 * its shading controls.
 */
export const viewportShadingSegments: ReadonlyArray<ViewportShadingSegment<ViewportShadingMode>> = [
  { mode: 'wireframe', glyph: 'wireframe', label: 'Wireframe' },
  { mode: 'clay', glyph: 'sphere', label: 'Solid' },
  { mode: 'solid', glyph: 'preview', label: 'Material' },
];

/**
 * BLENDER'S OWN FOUR CELLS, for a stage that keeps lighting per draw mode as Blender's shading
 * types do: Wireframe, Solid (`solid` — materials' colours under its studio lights), Material
 * Preview (`preview`) and Rendered (`rendered`). A cell stands only where the stage says how its
 * mode is lit, so none is a shim; Solid and Wireframe are lit by the stage's own default.
 */
export function perModeShadingSegments(
  declared: ReadonlySet<string>,
): ReadonlyArray<ViewportShadingSegment<ViewportShadingMode>> {
  return [
    { mode: 'wireframe', glyph: 'wireframe', label: 'Wireframe' },
    { mode: 'solid', glyph: 'sphere', label: 'Solid' },
    ...(declared.has('preview') ? [{ mode: 'preview' as const, glyph: 'preview' as const, label: 'Material Preview' }] : []),
    ...(declared.has('rendered') ? [{ mode: 'rendered' as const, glyph: 'rendered' as const, label: 'Rendered' }] : []),
  ];
}

/**
 * The three marks, transcribed from `modeling-edit-none.png` at its native 2x
 * — the 3D View header's shading group, cells at x 2628 / 2666 / 2704, y
 * 60..95, each a 36x36 device cell carrying 28..32 device px of ink. On the
 * 16-unit box here (the icon set's own grid, so these sit at the same optical
 * size as every `EditorIcon` beside them):
 *
 *  - WIREFRAME is a wire globe: a ring, two latitude chords and ONE meridian,
 *    and the frame settles the spacing — measured off the circle's own centre
 *    (device rows 64..91, so centre row 77.5, radius 14) the chords sit at
 *    ±5 device px and the meridian 5 device px LEFT of centre, i.e. all three
 *    at 0.357 of the radius. The off-centre meridian is what makes it read as
 *    a globe seen from three-quarters rather than a crosshair.
 *  - SPHERE is a plain filled disc. Blender's carries a near-white body
 *    inside a lighter rim; at 14 CSS px the rim is below this instrument's
 *    floor and a flat disc is the honest reduction.
 *  - PREVIEW is the ring with its upper-left lobe filled: the fill's right
 *    edge is a near-vertical chord just left of centre (device offset 13 of
 *    28, held from row 68 down) and its lower edge a cut from the ring at
 *    row 78.5 down-right to row 82 — measured, because the first cut put
 *    that edge two device rows high and the mark read as a pie chart rather
 *    than a lit sphere. Blender hatches the remaining lower-right quadrant;
 *    three hatch strokes cannot survive 14 px and are deliberately not
 *    drawn, so this mark is Blender's silhouette without its texture.
 *
 * These are drawn HERE rather than fetched through `EditorIcon` because the
 * icon-set seam is keyed by Font Awesome NAME, and the three names that would
 * carry these marks are already spent on other jobs (`globe` is the
 * transform-space toggle, `circle` is the Outliner's generic object, and
 * `circle-half-stroke` is the LUT document's before/after). Re-drawing a
 * shared name would move those marks too. The precedent is the sibling
 * segmented group in this same header — `@volter/editor-blender`'s select-mode cells draw
 * their own glyphs inline for the same reason.
 */
function ViewportShadingGlyph({
  glyph,
}: {
  readonly glyph: ViewportShadingSegment<string>['glyph'];
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="vgai-viewport-shading-glyph"
      aria-hidden="true"
      focusable="false"
    >
      {glyph === 'sphere' || glyph === 'rendered' ? (
        <circle cx="8" cy="8" r="7.3" fill="currentColor" />
      ) : (
        <circle cx="8" cy="8" r="7.3" fill="none" stroke="currentColor" strokeWidth="1.05" />
      )}
      {glyph === 'wireframe' ? (
        <g stroke="currentColor" strokeWidth="1.05">
          <line x1="1.7" y1="5.4" x2="14.3" y2="5.4" />
          <line x1="1.7" y1="10.6" x2="14.3" y2="10.6" />
          <line x1="5.4" y1="1.7" x2="5.4" y2="14.3" />
        </g>
      ) : null}
      {glyph === 'rendered' ? (
        // Blender's Rendered mark is a lit ball: the filled disc with a highlight up and left.
        <circle cx="5.6" cy="5.6" r="2.3" fill="var(--vgai-surface-overlay, #ffffff)" fillOpacity="0.7" />
      ) : null}
      {glyph === 'preview' ? (
        <path
          d="M7.73 1.23 L7.73 10.43 L1.22 8.04 A6.78 6.78 0 0 1 7.73 1.23 Z"
          fill="currentColor"
        />
      ) : null}
    </svg>
  );
}

export function ViewportDisplayModeMenu<T extends string>({
  mode,
  onChange,
  choices,
  disabled = false,
  segments,
  children,
}: {
  mode: T;
  onChange: (mode: T) => void;
  choices: ReadonlyArray<ViewportDisplayModeChoice<T>>;
  disabled?: boolean;
  /** Draw Blender's segmented group instead of a labelled trigger. */
  segments?: ReadonlyArray<ViewportShadingSegment<T>>;
  /** Extra rows for the popover — Blender keeps its lighting controls here. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const active = choices.find((entry) => entry.mode === mode) ?? choices[0];
  if (!active) return null;

  const menu =
    open && !disabled ? (
      <AnchoredMenu
        id="vgai-viewport-shading-menu"
        anchorRef={ref}
        aria-label="Viewport shading modes"
        onDismiss={() => setOpen(false)}
        style={{
          minWidth: 230,
        }}
      >
        {choices.map((entry) => (
          <MenuItem
            key={entry.mode}
            role="menuitemradio"
            aria-checked={entry.mode === mode}
            onSelect={() => {
              onChange(entry.mode);
              setOpen(false);
            }}
            style={{ display: 'grid', gridTemplateColumns: '14px 1fr', gap: 7 }}
          >
            <span style={{ opacity: entry.mode === mode ? 1 : 0 }}>
              <EditorIcon icon={faCheck} size="xs" />
            </span>
            <span>
              <span style={{ display: 'block' }}>{entry.label}</span>
              <span
                style={{
                  display: 'block',
                  color: themeVars.content.dim,
                  fontSize: 10,
                }}
              >
                {entry.description}
              </span>
            </span>
          </MenuItem>
        ))}
        {children ? (
          <>
            <MenuSeparator />
            <div className="vgai-viewport-shading-options">{children}</div>
          </>
        ) : null}
      </AnchoredMenu>
    ) : null;

  if (segments) {
    // BLENDER'S SHADING CONTROL: the modes it HAS as joined cells, then the
    // chevron whose popover holds everything else. The cells join the way the
    // sibling select-mode group in this same header joins — square inner
    // corners and a shared border — so the five read as one widget with one
    // cell lit, and `aria-pressed` is the only thing that paints the lit one.
    return (
      <div className="vgai-viewport-popover-anchor">
        <span className="vgai-viewport-shading-segments" role="group" aria-label="Viewport shading">
          {segments.map((segment) => (
            <Tooltip key={segment.mode} text={`Viewport shading: ${segment.label}`}>
              <IconButton
                size="compact"
                shape="segment"
                variant="secondary"
                aria-pressed={segment.mode === mode}
                aria-label={`Viewport shading: ${segment.label}`}
                disabled={disabled}
                onClick={() => onChange(segment.mode)}
              >
                <ViewportShadingGlyph glyph={segment.glyph} />
              </IconButton>
            </Tooltip>
          ))}
          <Tooltip text="Shading options">
            <IconButton
              ref={ref}
              size="compact"
              shape="segment"
              variant="secondary"
              aria-label="Shading options"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={open ? 'vgai-viewport-shading-menu' : undefined}
              disabled={disabled}
              onClick={() => setOpen((value) => !value)}
            >
              <EditorIcon icon={faCaretDown} size="xs" />
            </IconButton>
          </Tooltip>
        </span>
        {menu}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <Tooltip text={`Viewport shading: ${active.label}`}>
        {/* A control's CHROME never encodes its VALUE. The variant used to be
            `mode === 'solid' ? 'ghost' : 'secondary'`, so the trigger's well
            appeared and disappeared as you used it — and at rest (`solid`,
            labelled "Material") it was a transparent slab where Blender paints
            a bordered well: measured in `modeling-object-none.png`, `Object
            Mode v` is #272727 inside a 1px #3c3c3c border, 20px tall, on a
            #343434 header. `secondary` is this estate's select-like trigger
            already (FontPicker's `.vgai-field-trigger`), so no new variant. */}
        <Button
          ref={ref}
          type="button"
          size="compact"
          variant="secondary"
          aria-label={`Viewport shading: ${active.label}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? 'vgai-viewport-shading-menu' : undefined}
          disabled={disabled}
          onClick={() => setOpen((value) => !value)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 66 }}
        >
          <span>{active.label}</span>
          <EditorIcon icon={faCaretDown} size="xs" />
        </Button>
      </Tooltip>
      {menu}
    </div>
  );
}

export function ViewportShadingMenu({
  mode,
  onChange,
  disabled = false,
}: {
  mode: ViewportShadingMode;
  onChange: (mode: ViewportShadingMode) => void;
  disabled?: boolean;
}) {
  return (
    <ViewportDisplayModeMenu
      mode={mode}
      onChange={onChange}
      choices={viewportShadingModes}
      disabled={disabled}
    />
  );
}
