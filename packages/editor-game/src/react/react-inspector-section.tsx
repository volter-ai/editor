import { setAuthoringSelection } from '@volter/editor-sdk/kit/authoring/consumer-actions';
import { faBookBookmark, faCode, faPalette } from '@fortawesome/free-solid-svg-icons';
import {
  Button,
  Checkbox,
  DraftTextInput,
  Select,
  TextArea,
  TextInput,
} from '@volter/editor-sdk/widgets';

/**
 * React-world inspector section (C2, spec 27 §5 C2) — the "wire the widgets"
 * half of the widget story. `components/inspector-widgets/` is a PURE widget kit
 * with no wiring; this module is the adapter-module contribution that plugs it
 * into the ONE inspector shell (`components/Inspector.tsx`) via
 * `inspector-section-registry.ts`, the SAME seam
 * `authoring/first-party-inspector/register.tsx` (three) and
 * `authoring/ui-inspector-sections.tsx` (scene-UI) already use — see those two
 * files for the sanctioned pattern this one follows.
 *
 * Matches any node owned by a react/DOM adapter — `ReactRootAuthoringAdapter`
 * (Lane B, `data-oid` component-source writes, T6.2) or
 * `DomAuthoringAdapter` (the ingested/overlay DOM adapter) —
 * whether the active adapter IS one of those directly (a bare single-world
 * session) or is a `CompositeAuthoringAdapter` routing to one as `id`'s
 * owner (multi-world edit mode). Renders every `PropertyDescriptor` the
 * adapter's `InspectorProvider.properties(id)` reports, GROUPED by
 * `PropertyDescriptor.group` (falling back to one flat "Style" group for an
 * adapter, like `DomAuthoringAdapter`, whose descriptors declare none),
 * mapping each descriptor to the right C1 widget instead of a generic
 * `<TextInput>` — see `widgetKindFor`'s doc comment for the exact mapping table.
 * It CLAIMS `PROPERTIES_SECTION_ID`, so it stands in for the shell's generic
 * property grid on a matched node (Rule zero: this section still talks to the
 * node ONLY through `adapter.inspector`/`adapter.hierarchy`, never the
 * DOM/fiber the adapter itself holds).
 *
 * `onChange` (every interaction tick) and `onChangeEnd` (the commit) both
 * route through the SAME `adapter.inspector.set` call — unlike
 * `BoxEditProvider`'s begin/apply/end split (a spatial-gesture concern),
 * `ReactRootAuthoringAdapter.inspector.set` has exactly ONE write
 * path (T0 §2/A4): it echoes the value into its optimistic cache
 * synchronously (so the field never snaps back) and fires the async
 * source-write itself. There is no separate "preview without writing" mode
 * to route `onChange` through, so both handlers call `commit`, mirroring the
 * shell's own pre-existing `setProp` helper (`components/Inspector.tsx`)
 * which already does the same on every keystroke of the generic grid this
 * section replaces.
 */

import {
  activeBreakpoint,
  setActiveBreakpoint,
  subscribeBreakpoint,
} from '@volter/editor-sdk/kit/breakpoint-state';
import { CompositeAuthoringAdapter } from '@volter/editor-sdk/kit/authoring/composite-authoring-adapter';
import { numericStyleValue, UNITLESS_NUMBER_PROPS } from '@volter/editor-sdk/css-numeric-style';
import { beginEyedropperSession } from '@volter/editor-sdk/kit/eyedropper-session';
import { groupProperties } from '@volter/editor-sdk/kit/inspector-property-grouping';
import { useEditorStore } from '@volter/editor-sdk/kit/editor-runtime';
import { createHmrRegistrationGroup } from '@volter/editor-sdk/kit/hmr-registration-group';
import { groupIcon } from '@volter/editor-sdk/kit/inspection/compose';
import {
  GROUP_SECTION_ORDER,
  groupSectionId,
  type InspectionSection,
  PROPERTIES_SECTION_ID,
  PROPERTIES_SECTION_ORDER,
} from '@volter/editor-sdk/kit/inspection-model';
import { registerInspectorSections } from '@volter/editor-sdk/kit/inspector-section-registry';
import { effectiveColorFromChain, getAvailableFonts } from '@volter/editor-sdk/kit/ui-source/inspect';
import type { OidEntry } from '@volter/editor-react/source/oid-transform';
import type { AuthoringAdapter, EditorNode, PropertyDescriptor } from '@volter/editor-project/adapter';
import {
  AlignmentGrid,
  type AlignmentValue,
  BorderEditor,
  BorderRadiusEditor,
  type BorderRadiusValue,
  type BorderSide,
  type BorderValue,
  ColorSwatch,
  composeFilter,
  composeGradient,
  composeShadows,
  FilterEditor,
  type FilterFunc,
  FONT_MONO,
  FontPicker,
  fontSizeVar,
  GradientEditor,
  type GradientValue,
  isUniformBorder,
  isUniformRadius,
  LABEL_COL_WIDTH,
  lineHeightVar,
  parseFilterFunctions,
  parseGradient,
  parseShadows,
  radius,
  rowStyle,
  ScrubbableInput,
  ShadowEditor,
  spaceVar,
  TextShadowEditor,
  THEME,
} from '@volter/editor-sdk/widgets';
import { createElement, useMemo, useState, useSyncExternalStore } from 'react';
import { DomAuthoringAdapter } from './dom-authoring-adapter';
import { cssColorToHex, ReactRootAuthoringAdapter } from './react-world-authoring-adapter';

/**
 * The child adapter that actually owns `node.id` — a bare react/DOM adapter
 * itself, or (via a `CompositeAuthoringAdapter`) whichever child's
 * `ownerOf`/`childAdapters()` claims the id (the SAME public T0 query
 * `components/Inspector.tsx`'s `worldGroupChildAdapter` uses — never decode a
 * reserved id here). `null` for anything not owned by a
 * react/DOM adapter (a three/scene-UI node, or an unresolved id).
 */
export function resolveReactOwner(
  node: EditorNode | null,
  adapter: AuthoringAdapter,
): ReactRootAuthoringAdapter | DomAuthoringAdapter | null {
  if (!node) return null;
  const target: AuthoringAdapter | null = (() => {
    if (!(adapter instanceof CompositeAuthoringAdapter)) return adapter;
    const owner = adapter.ownerOf(node.id);
    if (owner === null) return null;
    return adapter.childAdapters().find((c) => c.worldId === owner)?.adapter ?? null;
  })();
  if (target instanceof ReactRootAuthoringAdapter) return target;
  if (target instanceof DomAuthoringAdapter) return target;
  return null;
}

/** The registry `match`: any real selection owned by a react/DOM adapter. */
export const isDomSelection = (node: EditorNode | null, adapter: AuthoringAdapter): boolean =>
  resolveReactOwner(node, adapter) !== null;

/** The FACETS this adapter contributes, on the model's shared id/order scales
 *  (`inspection/model.ts`). A section id names a facet of the inspected thing
 *  — never the lane or adapter that happens to render it; what the object IS
 *  belongs to the subject's identity row. They lead: what the element IS comes
 *  before what it looks like, in the column and in the card's tab strip alike. */
export const REACT_ELEMENT_SECTION_ID = 'element';
const REACT_ELEMENT_SECTION_ORDER = 1500;
export const REACT_STORY_SECTION_ID = 'story';
const REACT_STORY_SECTION_ORDER = 1600;

// --- widget mapping (the C2 "map PropertyDescriptor.type/group -> widget" table) ---

export type ReactPropertyWidgetKind =
  | 'color'
  | 'font'
  | 'gradient'
  | 'shadow'
  | 'text-shadow'
  | 'filter'
  | 'backdrop-filter'
  | 'radius'
  | 'transform'
  | 'scrub'
  | 'select'
  | 'checkbox'
  | 'json'
  | 'text';

function propNameFromPath(path: string): string {
  const idx = path.indexOf('.');
  return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * A single `PropertyDescriptor` -> the C1 widget that renders it. Structured
 * CSS values (gradient/shadow/filter/radius) are matched by their well-known
 * style-prop NAME (the react adapters' `STYLE_PROPERTIES` tables are the
 * only source of these paths today — `PropertyDescriptor.type` alone can't
 * distinguish a plain string from a composable CSS function list); every
 * other descriptor maps off its plain `type`.
 */
export function widgetKindFor(prop: PropertyDescriptor): ReactPropertyWidgetKind {
  const name = propNameFromPath(prop.path);
  if (prop.type === 'color') return 'color';
  if (/^fontFamily$/i.test(name)) return 'font';
  if (name === 'background' || name === 'backgroundImage') return 'gradient';
  if (name === 'boxShadow') return 'shadow';
  if (name === 'textShadow') return 'text-shadow';
  if (name === 'filter') return 'filter';
  if (name === 'backdropFilter') return 'backdrop-filter';
  if (name === 'borderRadius') return 'radius';
  // Scoped to `type: 'string'` (the react-world `style.transform` CSS-string
  // descriptor) so an unrelated `transform` name of a DIFFERENT type — e.g. a
  // three `vec3` position/transform prop — still falls through to its own
  // generic widget instead of being misread as a CSS transform string.
  if (prop.type === 'string' && name === 'transform') return 'transform';
  if (prop.type === 'boolean') return 'checkbox';
  if (prop.type === 'enum') return 'select';
  if (prop.type === 'json') return 'json';
  if (prop.type === 'number') return 'scrub';
  // 'string' / 'vec3' / 'asset' — no dedicated widget in this task's mapping;
  // falls through to a plain text input (see the report's "no widget" list).
  return 'text';
}

/** A composed row: either one property, or a "combo" of several sibling
 *  properties this section renders as ONE richer widget (per-side border,
 *  3x3 flex alignment) instead of N separate fields. */
export type PropertyRow =
  | {
      kind: 'border';
      width: PropertyDescriptor;
      style: PropertyDescriptor;
      color: PropertyDescriptor;
    }
  | { kind: 'align'; justify: PropertyDescriptor; align: PropertyDescriptor }
  | { kind: 'single'; prop: PropertyDescriptor };

/**
 * Groups the react-world adapter's separate `borderWidth`/`borderStyle`/
 * `borderColor` scalars into one `BorderEditor` row, and `justifyContent`/
 * `alignItems` into one `AlignmentGrid` row — order-preserving single pass
 * (a combo is emitted at the position of its FIRST member; already-consumed
 * members are skipped later in the pass). Any property list missing one or
 * more combo members (e.g. `DomAuthoringAdapter`'s flatter list) simply
 * never forms that combo — every member renders as its own `single` row.
 */
/** Detects the `borderWidth`/`borderStyle`/`borderColor` trio starting at
 *  `p` and, if all three are present, pushes ONE `border` combo row. Split
 *  out of {@link buildPropertyRows} to keep its own cognitive complexity
 *  under biome's ceiling (same discipline as `GradientEditor.tsx`'s helper
 *  extraction). Returns `true` only when a combo row was actually formed (so
 *  the caller can `continue` past all three consumed members); `false` when
 *  `p` isn't a border-trio member, or is one but its siblings aren't present
 *  (falls through to an ordinary `single` row instead). */
function tryBorderCombo(
  p: PropertyDescriptor,
  byPath: ReadonlyMap<string, PropertyDescriptor>,
  consumed: Set<string>,
  rows: PropertyRow[],
): boolean {
  const isBorderProp =
    p.path === 'style.borderWidth' ||
    p.path === 'style.borderStyle' ||
    p.path === 'style.borderColor';
  if (!isBorderProp) return false;
  const width = byPath.get('style.borderWidth');
  const style = byPath.get('style.borderStyle');
  const color = byPath.get('style.borderColor');
  if (!width || !style || !color) return false;
  rows.push({ kind: 'border', width, style, color });
  consumed.add(width.path);
  consumed.add(style.path);
  consumed.add(color.path);
  return true;
}

/** Detects the `justifyContent`/`alignItems` pair starting at `p` and, if
 *  both are present, pushes ONE `align` combo row. See {@link tryBorderCombo}'s
 *  doc comment for why this is its own function. */
function tryAlignCombo(
  p: PropertyDescriptor,
  byPath: ReadonlyMap<string, PropertyDescriptor>,
  consumed: Set<string>,
  rows: PropertyRow[],
): boolean {
  const isAlignProp = p.path === 'style.justifyContent' || p.path === 'style.alignItems';
  if (!isAlignProp) return false;
  const justify = byPath.get('style.justifyContent');
  const align = byPath.get('style.alignItems');
  if (!justify || !align) return false;
  rows.push({ kind: 'align', justify, align });
  consumed.add(justify.path);
  consumed.add(align.path);
  return true;
}

export function buildPropertyRows(props: readonly PropertyDescriptor[]): PropertyRow[] {
  const byPath = new Map(props.map((p) => [p.path, p] as const));
  const consumed = new Set<string>();
  const rows: PropertyRow[] = [];
  for (const p of props) {
    if (consumed.has(p.path)) continue;
    if (tryBorderCombo(p, byPath, consumed, rows)) continue;
    if (tryAlignCombo(p, byPath, consumed, rows)) continue;
    rows.push({ kind: 'single', prop: p });
  }
  return rows;
}

function numericValue(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function testIdFor(path: string): string {
  return `react-prop-${path.replace(/\./g, '-')}`;
}

const DEFAULT_GRADIENT: GradientValue = {
  type: 'linear',
  angle: 180,
  stops: [
    { color: '#ffffff', position: 0 },
    { color: '#000000', position: 1 },
  ],
};

/** A labeled row shell, matching `components/Inspector.tsx`'s own generic
 *  property row layout (`NUM_STYLE`'s spacing/label conventions, ported to
 *  this kit's `THEME`/`rowStyle`) so a react section slots in visually next
 *  to the sections it replaces. The wrapper's own test id is the row's
 *  `${testId}-row` — DISTINCT from the interactive control inside it (which
 *  carries the bare `testId`), so a select/text/json control and its row
 *  wrapper never collide (spec 27 §5 C2, S1). */
function Field({
  label,
  testId,
  children,
}: {
  label: string;
  testId?: string | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      data-testid={testId ? `${testId}-row` : undefined}
      style={{ ...rowStyle, padding: `${spaceVar[2]} ${spaceVar[4]}` }}
    >
      <span
        style={{
          width: LABEL_COL_WIDTH,
          flexShrink: 0,
          fontSize: fontSizeVar.base,
          color: THEME.textMuted,
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** {@link PropertyRow}'s two combo variants — excludes `single` so
 *  {@link ComboRow} (only ever called for a combo row, see `GroupBlock`)
 *  narrows on `row.kind` without TS widening back to the full union. */
type ComboPropertyRow = Extract<PropertyRow, { kind: 'border' } | { kind: 'align' }>;

interface ComboRowProps {
  adapter: AuthoringAdapter;
  id: string;
  row: ComboPropertyRow;
}

/** Every per-kind row renderer's shared inputs — `raw` is the CURRENT value
 *  read off `adapter.inspector.get`, `commit` writes a (possibly different)
 *  path through the SAME `adapter.inspector.set` + `notifyIngestEdit` pair
 *  (see the file doc comment) so a combo write-back (border/align, above)
 *  and a plain single-prop write share one code path. */
interface KindRowProps {
  prop: PropertyDescriptor;
  raw: unknown;
  disabled: boolean | undefined;
  testId: string;
  commit: (path: string, value: unknown) => void;
  fonts: readonly string[];
}

function ColorRow({ prop, raw, disabled, testId, commit }: KindRowProps): React.ReactElement {
  return (
    <Field label={prop.label} testId={testId}>
      <ColorSwatch
        testId={testId}
        value={String(raw ?? '#ffffff')}
        disabled={disabled}
        onChange={(c) => commit(prop.path, c)}
        onChangeEnd={(c) => commit(prop.path, c)}
        eyedropperFallback={() => effectiveColorFromChain([String(raw ?? '')])}
        // D3.d (spec 27 §6) — no native EyeDropper: begin an interactive
        // canvas-pick session (`RootSelectionOverlay` renders the
        // cursor-following swatch and resolves it) instead of the static
        // synchronous fallback above, which this session-based path replaces
        // whenever the host (this section, mounted inside the real editor)
        // is present to wire it.
        onEyedropperPick={(apply) => beginEyedropperSession(apply)}
      />
    </Field>
  );
}

function FontRow({ prop, raw, disabled, fonts, testId, commit }: KindRowProps): React.ReactElement {
  return (
    <Field label={prop.label} testId={testId}>
      <FontPicker
        testId={testId}
        value={String(raw ?? '')}
        fonts={fonts}
        disabled={disabled}
        onChange={(f) => commit(prop.path, f)}
      />
    </Field>
  );
}

function GradientRow({ prop, raw, disabled, testId, commit }: KindRowProps): React.ReactElement {
  const parsed = parseGradient(String(raw ?? 'none'));
  // S2 (anti-shim, CLAUDE.md "adapters never fabricate first-party data"): when
  // the element has NO real gradient (`parseGradient` -> null), render an honest
  // empty state — NOT a fabricated white→black `DEFAULT_GRADIENT` preview that
  // misrepresents the source as already having a gradient. `DEFAULT_GRADIENT` is
  // still the SEED for an explicit user "add" (a real, source-writing action),
  // never a passive display value.
  if (!parsed) {
    return (
      <Field label={prop.label} testId={testId}>
        <Button
          type="button"
          variant="secondary"
          className="vgai-field-trigger"
          data-testid={testId}
          disabled={disabled}
          onClick={() => commit(prop.path, composeGradient(DEFAULT_GRADIENT))}
        >
          No gradient — click to add
        </Button>
      </Field>
    );
  }
  return (
    <Field label={prop.label} testId={testId}>
      <GradientEditor
        testId={testId}
        value={parsed}
        disabled={disabled}
        onChange={(g) => commit(prop.path, composeGradient(g))}
        onChangeEnd={(g) => commit(prop.path, composeGradient(g))}
      />
    </Field>
  );
}

function ShadowRow({
  prop,
  raw,
  disabled,
  testId,
  commit,
  withSpreadInset,
}: KindRowProps & { withSpreadInset: boolean }): React.ReactElement {
  const parsed = parseShadows(String(raw ?? 'none'), withSpreadInset);
  const Widget = withSpreadInset ? ShadowEditor : TextShadowEditor;
  return (
    <Field label={prop.label} testId={testId}>
      <Widget
        value={parsed}
        disabled={disabled}
        onChange={(list) => commit(prop.path, composeShadows(list, withSpreadInset))}
        onChangeEnd={(list) => commit(prop.path, composeShadows(list, withSpreadInset))}
      />
    </Field>
  );
}

function FilterRow({
  prop,
  raw,
  disabled,
  testId,
  commit,
  label,
}: KindRowProps & { label: string }): React.ReactElement {
  const parsed = parseFilterFunctions(String(raw ?? 'none'));
  return (
    <Field label={prop.label} testId={testId}>
      <FilterEditor
        testId={testId}
        label={label}
        value={parsed}
        disabled={disabled}
        onChange={(f: FilterFunc[]) => commit(prop.path, composeFilter(f))}
        onChangeEnd={(f: FilterFunc[]) => commit(prop.path, composeFilter(f))}
      />
    </Field>
  );
}

/** Corner suffixes (`borderTopLeftRadius`, …) shared by {@link RadiusRow}'s
 *  read + write-back — the per-corner longhand CSS the shorthand `borderRadius`
 *  descriptor (`prop`/`raw`/`commit` above) never had a slot for. */
const RADIUS_CORNERS: ReadonlyArray<{ key: keyof BorderRadiusValue; suffix: string }> = [
  { key: 'topLeft', suffix: 'TopLeft' },
  { key: 'topRight', suffix: 'TopRight' },
  { key: 'bottomLeft', suffix: 'BottomLeft' },
  { key: 'bottomRight', suffix: 'BottomRight' },
];

/** U2 (spec 27 §5 "Effects: radius per-corner") — true per-corner write-back.
 *  Reads each corner's own `style.border<Corner>Radius` longhand through
 *  `adapter.inspector.get` (falling back to the shorthand `raw` when a
 *  corner's own computed value is unset/unparseable — the vitest `node` env
 *  resolver falls back to inline `.style`, which has no implicit per-corner
 *  values the way a REAL computed style always does) so the widget reflects
 *  a PRIOR non-uniform edit instead of collapsing back to uniform on every
 *  re-render. Write-back keeps the uniform shorthand fast-path (`commit`
 *  the same `borderRadius` path this row already used) but writes the four
 *  longhand corners when the widget reports a non-uniform value — removing
 *  the documented `:397-409` limitation (per-corner UI, uniform-only write). */
function RadiusRow({
  adapter,
  id,
  prop,
  raw,
  disabled,
  testId,
  commit,
  removeStyle,
}: KindRowProps & {
  adapter: AuthoringAdapter;
  id: string;
  removeStyle: (path: string) => void;
}): React.ReactElement {
  const fallback = numericValue(raw);
  const value: BorderRadiusValue = RADIUS_CORNERS.reduce((acc, { key, suffix }) => {
    const cornerRaw = adapter.inspector?.get(id, `style.border${suffix}Radius`);
    acc[key] = numericStyleValue(cornerRaw) ?? fallback;
    return acc;
  }, {} as BorderRadiusValue);
  const writeBack = (v: BorderRadiusValue): void => {
    if (isUniformRadius(v)) {
      commit(prop.path, v.topLeft);
      // D1 — a uniform edit must also CLEAR any per-corner longhands a prior
      // non-uniform edit wrote, or the stale longhand silently overrides the
      // shorthand on reload. `removeStyle` no-ops when the longhand isn't
      // authored, so this is safe on a clean element (never pollutes source).
      for (const { suffix } of RADIUS_CORNERS) {
        removeStyle(`style.border${suffix}Radius`);
      }
      return;
    }
    for (const { key, suffix } of RADIUS_CORNERS) {
      commit(`style.border${suffix}Radius`, v[key]);
    }
  };
  return (
    <Field label={prop.label} testId={testId}>
      <BorderRadiusEditor
        value={value}
        disabled={disabled}
        onChange={writeBack}
        onChangeEnd={writeBack}
      />
    </Field>
  );
}

function ScrubRow({ prop, raw, disabled, testId, commit }: KindRowProps): React.ReactElement {
  const unit = UNITLESS_NUMBER_PROPS.has(propNameFromPath(prop.path)) ? '' : 'px';
  return (
    <ScrubbableInput
      testId={testId}
      label={prop.label}
      value={numericValue(raw)}
      unit={unit}
      disabled={disabled}
      onChange={(v) => commit(prop.path, v)}
      onChangeEnd={(v) => commit(prop.path, v)}
      style={{ padding: `${spaceVar[2]} ${spaceVar[4]}` }}
    />
  );
}

function SelectRow({ prop, raw, disabled, testId, commit }: KindRowProps): React.ReactElement {
  return (
    <Field label={prop.label} testId={testId}>
      <Select
        data-testid={testId}
        value={String(raw ?? '')}
        disabled={disabled}
        data-dynamic={disabled || undefined}
        onChange={(e) => commit(prop.path, e.target.value)}
        style={{ width: '100%' }}
      >
        {(prop.options ?? []).map((o) => (
          <option key={String(o)} value={String(o)}>
            {String(o)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function CheckboxRow({ prop, raw, disabled, testId, commit }: KindRowProps): React.ReactElement {
  return (
    <label
      style={{
        display: 'flex',
        gap: spaceVar[3],
        alignItems: 'center',
        padding: `${spaceVar[3]} ${spaceVar[4]}`,
        fontSize: fontSizeVar.md,
      }}
    >
      <Checkbox
        className="vgai-checkbox"
        data-testid={testId}
        checked={raw !== false}
        disabled={disabled}
        onChange={(e) => commit(prop.path, e.target.checked)}
      />
      {prop.label}
    </label>
  );
}

function JsonRow({ prop, raw, disabled, testId, commit }: KindRowProps): React.ReactElement {
  return (
    <Field label={prop.label} testId={testId}>
      <TextArea
        data-testid={testId}
        defaultValue={JSON.stringify(raw ?? null)}
        disabled={disabled}
        data-dynamic={disabled || undefined}
        data-variant="code"
        style={{ width: '100%', minHeight: 40 }}
        onBlur={(e) => {
          try {
            commit(prop.path, JSON.parse(e.target.value));
          } catch {
            // Invalid JSON — leave the field as typed, don't write garbage.
          }
        }}
      />
    </Field>
  );
}

function TextRow({ prop, raw, disabled, testId, commit }: KindRowProps): React.ReactElement {
  // Commit once, on Enter/blur — a per-keystroke write re-projects the board
  // under the typist (see `ScrubbableInput`'s draft for the measurement).
  return (
    <Field label={prop.label} testId={testId}>
      <DraftTextInput
        type="text"
        data-testid={testId}
        readOnly={disabled}
        data-dynamic={disabled || undefined}
        value={String(raw ?? '')}
        onCommit={(next) => commit(prop.path, next)}
        style={{ width: '100%' }}
      />
    </Field>
  );
}

/** U3 (spec 27 §5 "Transform: rotate/scale") — a structured `{rotateDeg, scale}`
 *  pair, when `style.transform` is losslessly representable that way. */
export interface TransformValue {
  rotateDeg: number;
  scale: number;
}

const TRANSFORM_ROTATE_SCALE_RE = /^rotate\(\s*(-?[\d.]+)deg\s*\)\s*scale\(\s*(-?[\d.]+)\s*\)$/i;
const TRANSFORM_SCALE_ROTATE_RE = /^scale\(\s*(-?[\d.]+)\s*\)\s*rotate\(\s*(-?[\d.]+)deg\s*\)$/i;
// S3 — single-function literals (a JSX-authored `rotate(45deg)` or `scale(1.5)`
// alone, missing axis defaulted): computed style is always a matrix in the real
// browser, but these are exactly what an author hand-writes, so give them the
// structured row too rather than the raw TextRow.
const TRANSFORM_ROTATE_ONLY_RE = /^rotate\(\s*(-?[\d.]+)deg\s*\)$/i;
const TRANSFORM_SCALE_ONLY_RE = /^scale\(\s*(-?[\d.]+)\s*\)$/i;
const TRANSFORM_MATRIX_RE =
  /^matrix\(\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*\)$/;
const TRANSFORM_EPS = 1e-4;

/**
 * Parse a `style.transform` value (either the author's literal
 * `rotate(<deg>deg) scale(<n>)` — the exact form this row writes — or a
 * REAL browser's computed 2x2 `matrix(a, b, c, d, e, f)`, since Chromium
 * always normalizes an authored transform to matrix form, unlike this
 * repo's headless/vitest fallback which echoes the literal string straight
 * from inline style) into a structured `{rotateDeg, scale}` pair, or `null`
 * when the value can't be represented that way LOSSLESSLY — a nonzero
 * translate (`e`/`f`), a skew/non-uniform scale (`c !== -b` or `d !== a`),
 * `matrix3d(...)`, or any other transform function list. `null` is the
 * signal {@link TransformRow} uses to fall back to the plain `TextRow` —
 * every value this doesn't understand stays editable as raw text, so no
 * expressiveness is ever silently dropped.
 */
export function parseTransform(raw: string): TransformValue | null {
  const v = raw.trim();
  if (v === '' || v === 'none') return { rotateDeg: 0, scale: 1 };
  const lit = TRANSFORM_ROTATE_SCALE_RE.exec(v);
  if (lit) return { rotateDeg: Number(lit[1]), scale: Number(lit[2]) };
  const swapped = TRANSFORM_SCALE_ROTATE_RE.exec(v);
  if (swapped) return { rotateDeg: Number(swapped[2]), scale: Number(swapped[1]) };
  const rotOnly = TRANSFORM_ROTATE_ONLY_RE.exec(v);
  if (rotOnly) return { rotateDeg: Number(rotOnly[1]), scale: 1 }; // S3 — missing scale defaults 1
  const scaleOnly = TRANSFORM_SCALE_ONLY_RE.exec(v);
  if (scaleOnly) return { rotateDeg: 0, scale: Number(scaleOnly[1]) }; // S3 — missing rotate defaults 0
  const m = TRANSFORM_MATRIX_RE.exec(v);
  if (!m) return null; // matrix3d / translate / skew / any other function list
  const [a, b, c, d, e, f] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (Math.abs(e) > TRANSFORM_EPS || Math.abs(f) > TRANSFORM_EPS) return null; // has a translate
  if (Math.abs(c + b) > TRANSFORM_EPS || Math.abs(d - a) > TRANSFORM_EPS) return null; // skew / non-uniform scale
  const scale = Math.hypot(a, b);
  if (scale < TRANSFORM_EPS) return null; // degenerate (zero scale)
  const rotateDeg = (Math.atan2(b, a) * 180) / Math.PI;
  return {
    rotateDeg: Math.round(rotateDeg * 100) / 100,
    scale: Math.round(scale * 1000) / 1000,
  };
}

/** The inverse of {@link parseTransform}'s literal fast-path — always
 *  composes the readable `rotate()/scale()` form, never a matrix, so the
 *  written source stays human-editable. */
export function composeTransform(v: TransformValue): string {
  return `rotate(${v.rotateDeg}deg) scale(${v.scale})`;
}

function TransformRow(props: KindRowProps): React.ReactElement {
  const { prop, raw, disabled, testId, commit } = props;
  const parsed = parseTransform(String(raw ?? 'none'));
  if (!parsed) return <TextRow {...props} />; // safety net — no expressiveness lost
  const writeBack = (next: TransformValue): void => commit(prop.path, composeTransform(next));
  return (
    <Field label={prop.label} testId={testId}>
      <div style={{ display: 'flex', gap: spaceVar[3] }}>
        <ScrubbableInput
          testId={`${testId}-rotate`}
          label="Rotate"
          value={parsed.rotateDeg}
          unit="deg"
          disabled={disabled}
          onChange={(v) => writeBack({ ...parsed, rotateDeg: v })}
          onChangeEnd={(v) => writeBack({ ...parsed, rotateDeg: v })}
          style={{ flex: 1 }}
        />
        <ScrubbableInput
          testId={`${testId}-scale`}
          label="Scale"
          value={parsed.scale}
          unit="x"
          step={0.1}
          disabled={disabled}
          onChange={(v) => writeBack({ ...parsed, scale: v })}
          onChangeEnd={(v) => writeBack({ ...parsed, scale: v })}
          style={{ flex: 1 }}
        />
      </div>
    </Field>
  );
}

/** One `single`-kind row: reads the current value, picks the widget via
 *  {@link widgetKindFor}, and delegates to the matching `*Row` component
 *  above — each extracted so this dispatcher's own branching stays well
 *  under biome's complexity ceiling (same discipline `GradientEditor.tsx`/
 *  `ShadowEditor.tsx` document for their own helper splits). Both
 *  `onChange`/`onChangeEnd` route through the SAME `commit` (file doc
 *  comment: this adapter has one write path, not a separate preview mode). */
function SingleRow({
  adapter,
  id,
  prop,
  fonts,
}: {
  adapter: AuthoringAdapter;
  id: string;
  prop: PropertyDescriptor;
  fonts: readonly string[];
}): React.ReactElement {
  const store = useEditorStore();
  const commit = (path: string, value: unknown): void => {
    adapter.inspector?.set(id, path, value);
    store.notifyIngestEdit();
  };
  // D1 — remove a stale CSS longhand override (no-op when unauthored); optional
  // on the inspector, so a non-react adapter simply skips the cleanup.
  const removeStyle = (path: string): void => {
    adapter.inspector?.remove?.(id, path);
    store.notifyIngestEdit();
  };
  const rowProps: KindRowProps = {
    prop,
    raw: adapter.inspector?.get(id, prop.path),
    disabled: prop.readonly,
    testId: testIdFor(prop.path),
    commit,
    fonts,
  };
  switch (widgetKindFor(prop)) {
    case 'color':
      return <ColorRow {...rowProps} />;
    case 'font':
      return <FontRow {...rowProps} />;
    case 'gradient':
      return <GradientRow {...rowProps} />;
    case 'shadow':
      return <ShadowRow {...rowProps} withSpreadInset />;
    case 'text-shadow':
      return <ShadowRow {...rowProps} withSpreadInset={false} />;
    case 'filter':
      return <FilterRow {...rowProps} label="Filter" />;
    case 'backdrop-filter':
      return <FilterRow {...rowProps} label="Backdrop Filter" />;
    case 'radius':
      return <RadiusRow {...rowProps} adapter={adapter} id={id} removeStyle={removeStyle} />;
    case 'transform':
      return <TransformRow {...rowProps} />;
    case 'scrub':
      return <ScrubRow {...rowProps} />;
    case 'select':
      return <SelectRow {...rowProps} />;
    case 'checkbox':
      return <CheckboxRow {...rowProps} />;
    case 'json':
      return <JsonRow {...rowProps} />;
    default:
      return <TextRow {...rowProps} />;
  }
}

/** A `border`/`align` combo row — reads all its member props, composes the
 *  widget's structured value, and writes every member back on change. */
function ComboRow({ adapter, id, row }: ComboRowProps): React.ReactElement | null {
  const store = useEditorStore();
  const commit = (path: string, value: unknown): void => {
    adapter.inspector?.set(id, path, value);
    store.notifyIngestEdit();
  };
  const removeStyle = (path: string): void => {
    adapter.inspector?.remove?.(id, path);
    store.notifyIngestEdit();
  };
  if (row.kind === 'border') {
    // U2 (spec 27 §5 "Stroke: per-side border") — the shorthand descriptors
    // (`row.width`/`row.style`/`row.color`) are the uniform fallback; each
    // side's OWN longhand (`borderTopWidth`, …) is read through the same
    // `adapter.inspector.get` and wins when present, so a prior per-side
    // edit survives the next re-render instead of collapsing back to
    // uniform (mirrors `RadiusRow`'s corner read, same fallback rationale:
    // the vitest `node` env resolver has no implicit per-side computed
    // values the way a real `CSSStyleDeclaration` always does).
    const fallback: BorderSide = {
      width: numericValue(adapter.inspector?.get(id, row.width.path)),
      style: String(adapter.inspector?.get(id, row.style.path) ?? 'solid'),
      color: String(adapter.inspector?.get(id, row.color.path) ?? '#000000'),
    };
    const readSide = (suffix: 'Top' | 'Right' | 'Bottom' | 'Left'): BorderSide => {
      const w = numericStyleValue(adapter.inspector?.get(id, `style.border${suffix}Width`));
      const st = adapter.inspector?.get(id, `style.border${suffix}Style`);
      const c = adapter.inspector?.get(id, `style.border${suffix}Color`);
      // D1 — normalize the per-side color longhand through `cssColorToHex`: it's
      // not in `STYLE_PROPERTY_TYPE`, so `inspector.get` hands back the RAW
      // computed value (`rgb(…)`), and letting that flow into a later uniform
      // commit would rewrite the author's hex literal as an `rgb()` string.
      const cHex = typeof c === 'string' ? cssColorToHex(c) : undefined;
      return {
        width: w ?? fallback.width,
        style: typeof st === 'string' && st ? st : fallback.style,
        color: cHex ?? fallback.color,
      };
    };
    const value: BorderValue = {
      top: readSide('Top'),
      right: readSide('Right'),
      bottom: readSide('Bottom'),
      left: readSide('Left'),
    };
    // Uniform edits keep the pre-existing shorthand fast-path (3 commits to
    // the `borderWidth`/`borderStyle`/`borderColor` descriptors this row
    // always had); a non-uniform widget value now writes the 4 per-side
    // CSS longhands instead of collapsing to `.top` — removing the
    // documented limitation this file used to note here.
    const sideSuffixes = ['Top', 'Right', 'Bottom', 'Left'] as const;
    const writeBack = (v: BorderValue): void => {
      if (isUniformBorder(v)) {
        commit(row.width.path, v.top.width);
        commit(row.style.path, v.top.style);
        commit(row.color.path, v.top.color);
        // D1 — clear any per-side longhands a prior non-uniform edit wrote, so
        // the uniform shorthand actually wins on reload (removeStyle no-ops
        // when a longhand isn't authored — safe on a clean element).
        for (const suffix of sideSuffixes) {
          removeStyle(`style.border${suffix}Width`);
          removeStyle(`style.border${suffix}Style`);
          removeStyle(`style.border${suffix}Color`);
        }
        return;
      }
      const sides: ReadonlyArray<{
        suffix: 'Top' | 'Right' | 'Bottom' | 'Left';
        side: BorderSide;
      }> = sideSuffixes.map((suffix) => ({
        suffix,
        side: v[suffix.toLowerCase() as 'top' | 'right' | 'bottom' | 'left'],
      }));
      for (const { suffix, side } of sides) {
        commit(`style.border${suffix}Width`, side.width);
        commit(`style.border${suffix}Style`, side.style);
        commit(`style.border${suffix}Color`, side.color);
      }
    };
    return (
      <Field label="Border" testId="react-prop-border">
        <BorderEditor value={value} onChange={writeBack} onChangeEnd={writeBack} />
      </Field>
    );
  }
  const value: AlignmentValue = {
    justify:
      (adapter.inspector?.get(id, row.justify.path) as AlignmentValue['justify']) ?? 'flex-start',
    align: (adapter.inspector?.get(id, row.align.path) as AlignmentValue['align']) ?? 'flex-start',
  };
  return (
    <Field label="Align" testId="react-prop-align">
      <AlignmentGrid
        value={value}
        onChange={(v) => {
          commit(row.justify.path, v.justify);
          commit(row.align.path, v.align);
        }}
      />
    </Field>
  );
}

function rowKey(row: PropertyRow): string {
  if (row.kind === 'single') return row.prop.path;
  if (row.kind === 'border') return `border:${row.width.path}`;
  return `align:${row.justify.path}`;
}

function compactScrub(
  adapter: AuthoringAdapter,
  id: string,
  prop: PropertyDescriptor | undefined,
  label: string,
  commit: (path: string, value: unknown) => void,
): React.ReactElement | null {
  if (!prop) return null;
  const unit = UNITLESS_NUMBER_PROPS.has(propNameFromPath(prop.path)) ? '' : 'px';
  const testId = testIdFor(prop.path);
  return (
    <ScrubbableInput
      key={prop.path}
      testId={testId}
      label={label}
      value={numericValue(adapter.inspector?.get(id, prop.path))}
      unit={unit}
      disabled={prop.readonly}
      onChange={(value) => commit(prop.path, value)}
      onChangeEnd={(value) => commit(prop.path, value)}
      style={{ flex: 1, minWidth: 0 }}
    />
  );
}

function SemanticLayout({
  adapter,
  id,
  props,
  fonts,
  showConstraints,
  onToggleConstraints,
}: {
  adapter: AuthoringAdapter;
  id: string;
  props: readonly PropertyDescriptor[];
  fonts: readonly string[];
  showConstraints: boolean;
  onToggleConstraints: () => void;
}): React.ReactElement {
  const store = useEditorStore();
  const byName = new Map(props.map((prop) => [propNameFromPath(prop.path), prop] as const));
  const commit = (path: string, value: unknown): void => {
    adapter.inspector?.set(id, path, value);
    store.notifyIngestEdit();
  };
  const display = String(
    adapter.inspector?.get(id, byName.get('display')?.path ?? 'style.display') ?? '',
  );
  const isFlex = display === 'flex' || display === 'inline-flex';
  const isGrid = display === 'grid' || display === 'inline-grid';
  const displayProp = byName.get('display');
  const gapProp = byName.get('gap');
  const alignRows = buildPropertyRows(
    props.filter((prop) => ['justifyContent', 'alignItems'].includes(propNameFromPath(prop.path))),
  );
  const ordinary = ['flexDirection', 'flexWrap', 'overflow']
    .map((name) => byName.get(name))
    .filter((prop): prop is PropertyDescriptor => !!prop);
  return (
    <div style={{ padding: '2px 8px 7px' }}>
      <div style={{ display: 'flex', gap: spaceVar[3] }}>
        {compactScrub(adapter, id, byName.get('width'), 'W', commit)}
        {compactScrub(adapter, id, byName.get('height'), 'H', commit)}
      </div>
      {showConstraints && (
        <div data-testid="react-layout-constraints" style={{ marginTop: 5 }}>
          <div style={{ display: 'flex', gap: spaceVar[3] }}>
            {compactScrub(adapter, id, byName.get('minWidth'), 'Min W', commit)}
            {compactScrub(adapter, id, byName.get('minHeight'), 'Min H', commit)}
          </div>
          <div style={{ display: 'flex', gap: spaceVar[3], marginTop: spaceVar[2] }}>
            {compactScrub(adapter, id, byName.get('maxWidth'), 'Max W', commit)}
            {compactScrub(adapter, id, byName.get('maxHeight'), 'Max H', commit)}
          </div>
        </div>
      )}
      <Button
        type="button"
        variant="ghost"
        size="compact"
        data-testid="react-layout-toggle-constraints"
        onClick={onToggleConstraints}
        style={{ display: 'flex', margin: '2px auto 5px' }}
      >
        {showConstraints ? '− constraints' : '··· constraints'}
      </Button>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)',
          gap: spaceVar[3],
        }}
      >
        {displayProp && (
          <Select
            data-testid={testIdFor(displayProp.path)}
            value={display}
            disabled={displayProp.readonly}
            data-dynamic={displayProp.readonly || undefined}
            onChange={(event) => commit(displayProp.path, event.target.value)}
            style={{ width: '100%' }}
          >
            {(displayProp.options ?? []).map((option) => (
              <option key={String(option)} value={String(option)}>
                {String(option)}
              </option>
            ))}
          </Select>
        )}
        {compactScrub(adapter, id, gapProp, 'Gap', commit)}
      </div>
      {isFlex && (
        <div data-testid="react-layout-flex-controls" style={{ marginTop: 5 }}>
          {ordinary
            .filter((prop) => propNameFromPath(prop.path) !== 'overflow')
            .map((prop) => (
              <SingleRow key={prop.path} adapter={adapter} id={id} prop={prop} fonts={fonts} />
            ))}
          {alignRows.map((row) =>
            row.kind === 'single' ? (
              <SingleRow
                key={rowKey(row)}
                adapter={adapter}
                id={id}
                prop={row.prop}
                fonts={fonts}
              />
            ) : (
              <ComboRow key={rowKey(row)} adapter={adapter} id={id} row={row} />
            ),
          )}
        </div>
      )}
      {isGrid && (
        <div data-testid="react-layout-grid-controls" style={{ marginTop: 5 }}>
          <div style={{ display: 'flex', gap: spaceVar[3] }}>
            {gridCountScrub(adapter, id, byName.get('gridTemplateColumns'), 'Cols', commit)}
            {gridCountScrub(adapter, id, byName.get('gridTemplateRows'), 'Rows', commit)}
          </div>
          {[byName.get('gridTemplateColumns'), byName.get('gridTemplateRows')]
            .filter((prop): prop is PropertyDescriptor => !!prop)
            .map((prop) => (
              <SingleRow key={prop.path} adapter={adapter} id={id} prop={prop} fonts={fonts} />
            ))}
          <div style={{ display: 'flex', gap: spaceVar[3], marginTop: spaceVar[1] }}>
            {compactScrub(adapter, id, byName.get('rowGap'), 'Row Gap', commit)}
            {compactScrub(adapter, id, byName.get('columnGap'), 'Col Gap', commit)}
          </div>
          {byName.get('gridAutoFlow') && (
            <SingleRow
              adapter={adapter}
              id={id}
              prop={byName.get('gridAutoFlow') as PropertyDescriptor}
              fonts={fonts}
            />
          )}
        </div>
      )}
      {ordinary
        .filter((prop) => propNameFromPath(prop.path) === 'overflow')
        .map((prop) => (
          <SingleRow key={prop.path} adapter={adapter} id={id} prop={prop} fonts={fonts} />
        ))}
      <GridItemDisclosure adapter={adapter} id={id} byName={byName} fonts={fonts} />
    </div>
  );
}

/** The number of tracks in a `grid-template-*` value (`none` ⇒ 0). A COMPUTED
 *  template is a resolved list, but the optimistic echo hands back the
 *  AUTHORED string, so integer `repeat(N, tracks)` must expand (measured:
 *  without it, the echoed `repeat(3, 1fr)` counted as ONE track and the next
 *  commit collapsed the template back to `repeat(1, 1fr)`). `auto-fit`/
 *  `auto-fill` repeats count as one segment — their track count is genuinely
 *  not knowable from the text. */
export function gridTrackCount(template: string): number {
  const t = template.trim();
  if (!t || t === 'none') return 0;
  const segments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ' ' && depth === 0) {
      if (i > start) segments.push(t.slice(start, i));
      start = i + 1;
    }
  }
  if (start < t.length) segments.push(t.slice(start));
  let count = 0;
  for (const segment of segments) {
    const rep = /^repeat\(\s*(\d+)\s*,([\s\S]*)\)$/.exec(segment);
    count += rep?.[1] && rep[2] !== undefined ? Number(rep[1]) * gridTrackCount(rep[2]) : 1;
  }
  return count;
}

/** Figma's grid COUNT control on a CSS template: scrub/type the track count
 *  and the template becomes `repeat(N, 1fr)` — exactly what Figma's
 *  rows/columns numbers mean. A custom template (minmax, named lines) stays
 *  authorable through the template text row below; bumping the count
 *  deliberately rewrites to N equal tracks, same as Figma. */
function gridCountScrub(
  adapter: AuthoringAdapter,
  id: string,
  prop: PropertyDescriptor | undefined,
  label: string,
  commit: (path: string, value: unknown) => void,
): React.ReactElement | null {
  if (!prop) return null;
  // Dedupe instead of end-only (measured by the blind walk): with a noop
  // onChange the CONTROLLED input never echoed a keystroke — typing was dead
  // and only the raw template field worked. onChange must reach commit for
  // the echo to render; the duplicate-write warn the end-only shape avoided
  // is handled by skipping writes of the template just written.
  let lastWritten: string | null = null;
  const write = (value: number): void => {
    const n = Math.max(1, Math.round(value));
    const template = `repeat(${n}, 1fr)`;
    if (template === lastWritten) return;
    lastWritten = template;
    commit(prop.path, template);
  };
  return (
    <ScrubbableInput
      key={`${prop.path}-count`}
      testId={`${testIdFor(prop.path)}-count`}
      label={label}
      value={gridTrackCount(String(adapter.inspector?.get(id, prop.path) ?? ''))}
      min={1}
      disabled={prop.readonly}
      onChange={write}
      onChangeEnd={write}
      style={{ flex: 1, minWidth: 0 }}
    />
  );
}

/** The grid-ITEM half (placement lives on the child, not the container):
 *  `grid-column` / `grid-row` / `justify-self` behind a ghost disclosure —
 *  same idiom as the constraints toggle, because for most elements these
 *  are noise, and the inspector cannot cheaply know whether the PARENT is
 *  a grid (its reads are node-scoped). */
function GridItemDisclosure({
  adapter,
  id,
  byName,
  fonts,
}: {
  adapter: AuthoringAdapter;
  id: string;
  byName: ReadonlyMap<string, PropertyDescriptor>;
  fonts: readonly string[];
}): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const props = ['gridColumn', 'gridRow', 'justifySelf']
    .map((name) => byName.get(name))
    .filter((prop): prop is PropertyDescriptor => !!prop);
  if (props.length === 0) return null;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="compact"
        data-testid="react-layout-toggle-grid-item"
        onClick={() => setOpen((value) => !value)}
        style={{ display: 'flex', margin: '2px auto 0' }}
      >
        {open ? '− grid item' : '··· grid item'}
      </Button>
      {open && (
        <div data-testid="react-layout-grid-item">
          {props.map((prop) => (
            <SingleRow key={prop.path} adapter={adapter} id={id} prop={prop} fonts={fonts} />
          ))}
        </div>
      )}
    </>
  );
}

/** Split a `background-image` value into its top-level comma layers (CSS
 *  paints the FIRST layer on top). `none`/empty ⇒ []. */
export function splitFillLayers(value: string): string[] {
  const t = value.trim();
  if (!t || t === 'none') return [];
  const layers: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      layers.push(t.slice(start, i).trim());
      start = i + 1;
    }
  }
  layers.push(t.slice(start).trim());
  return layers.filter(Boolean);
}

/** One fill layer's URL, when the layer is an image paint. */
function fillLayerUrl(layer: string): string | null {
  const m = /^url\((['"]?)([\s\S]*)\1\)$/.exec(layer.trim());
  return m?.[2] ?? null;
}

/**
 * FILLS AS A LIST (design ledger: fill-as-list; the scoreboard's measured
 * gap was "exactly ONE colour and ONE gradient per element"). Figma's fill
 * list maps onto the web's own layer model: `background-image` is a
 * comma-separated stack of paints (first = topmost), and `background-color`
 * is the one solid underneath them all. Each layer row previews itself and
 * expands to its own editor (gradient editor / image url); add, remove and
 * reorder rewrite the list. Honest deltas, stated: CSS has no per-layer
 * visibility toggle (Figma's eye) — hiding is removing — and no per-layer
 * opacity knob for image paints (a gradient layer carries opacity in its
 * own color stops).
 */
function SemanticFill({
  adapter,
  id,
  props,
  fonts,
}: {
  adapter: AuthoringAdapter;
  id: string;
  props: readonly PropertyDescriptor[];
  fonts: readonly string[];
}): React.ReactElement {
  const store = useEditorStore();
  const byName = new Map(props.map((prop) => [propNameFromPath(prop.path), prop] as const));
  const commit = (path: string, value: unknown): void => {
    adapter.inspector?.set(id, path, value);
    store.notifyIngestEdit();
  };
  const imageProp = byName.get('backgroundImage');
  const colorProp = byName.get('backgroundColor');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [imageDraft, setImageDraft] = useState<string | null>(null);
  const raw = String(imageProp ? (adapter.inspector?.get(id, imageProp.path) ?? '') : '');
  const layers = splitFillLayers(raw);
  const write = (next: string[]): void => {
    if (!imageProp) return;
    if (next.length > 0) {
      commit(imageProp.path, next.join(', '));
      return;
    }
    // An emptied list REMOVES the member — `backgroundImage: 'none'` parked
    // in source is authored noise the element never had.
    adapter.inspector?.remove?.(id, imageProp.path);
    store.notifyIngestEdit();
  };
  const replaceLayer = (index: number, layer: string): void =>
    write(layers.map((l, j) => (j === index ? layer : l)));
  const removeLayer = (index: number): void => {
    setExpanded(null);
    write(layers.filter((_, j) => j !== index));
  };
  const moveLayer = (index: number, delta: number): void => {
    const next = [...layers];
    const swap = next[index + delta];
    if (swap === undefined || next[index] === undefined) return;
    next[index + delta] = next[index] as string;
    next[index] = swap;
    setExpanded(null);
    write(next);
  };
  // Image layers compose with DOUBLE-quoted urls: the style writer stores
  // members single-quoted, and an escaped inner quote fails its literal
  // grammar (LITERAL_RE) — the member becomes uneditable AND unremovable
  // (measured: a url('…') layer could not be removed through this list).
  const layerButton: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: THEME.textMuted,
    cursor: 'pointer',
    fontSize: fontSizeVar.base,
    // Real hit targets (blind-walk friction: the reorder/remove buttons were
    // a couple of pixels wide).
    padding: `${spaceVar[2]} ${spaceVar[3]}`,
    lineHeight: lineHeightVar.tight,
  };
  return (
    <div data-testid="react-fill-list" style={{ padding: '2px 8px 7px' }}>
      {layers.map((layer, index) => {
        const gradient = parseGradient(layer);
        const url = fillLayerUrl(layer);
        const label = gradient
          ? `${gradient.type} gradient`
          : url !== null
            ? (url.split('/').pop() ?? 'image')
            : layer.slice(0, 22);
        return (
          <div key={`${index}-${layer.slice(0, 24)}`} style={{ marginBottom: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <button
                type="button"
                data-testid={`react-fill-layer-${index}`}
                title={layer}
                onClick={() => setExpanded(expanded === index ? null : index)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: spaceVar[3],
                  flex: 1,
                  minWidth: 0,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: `${spaceVar[1]} 0`,
                  color: THEME.text,
                  fontSize: fontSizeVar.base,
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    flexShrink: 0,
                    borderRadius: radius.sm,
                    border: `1px solid ${THEME.border}`,
                    background: layer,
                    backgroundSize: 'cover',
                  }}
                />
                <span
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {label}
                </span>
              </button>
              {index > 0 && (
                <button
                  type="button"
                  data-testid={`react-fill-up-${index}`}
                  title="Raise this fill"
                  onClick={() => moveLayer(index, -1)}
                  style={layerButton}
                >
                  ↑
                </button>
              )}
              {index < layers.length - 1 && (
                <button
                  type="button"
                  data-testid={`react-fill-down-${index}`}
                  title="Lower this fill"
                  onClick={() => moveLayer(index, 1)}
                  style={layerButton}
                >
                  ↓
                </button>
              )}
              <button
                type="button"
                data-testid={`react-fill-remove-${index}`}
                title="Remove this fill (CSS has no hidden-layer state — removing is Figma's eye)"
                onClick={() => removeLayer(index)}
                style={layerButton}
              >
                ✕
              </button>
            </div>
            {expanded === index && gradient && (
              <GradientEditor
                testId={`react-fill-gradient-${index}`}
                value={gradient}
                onChange={(g) => replaceLayer(index, composeGradient(g))}
                onChangeEnd={(g) => replaceLayer(index, composeGradient(g))}
              />
            )}
            {expanded === index && url !== null && (
              <TextInput
                data-testid={`react-fill-url-${index}`}
                defaultValue={url}
                placeholder="image url"
                onBlur={(event) => replaceLayer(index, `url("${event.target.value.trim()}")`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter')
                    replaceLayer(index, `url("${event.currentTarget.value.trim()}")`);
                }}
                style={{ width: '100%', marginTop: spaceVar[1] }}
              />
            )}
          </div>
        );
      })}
      {imageDraft !== null && (
        <TextInput
          data-testid="react-fill-image-draft"
          value={imageDraft}
          placeholder="image url — Enter to add"
          autoFocus
          onChange={(event) => setImageDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && imageDraft.trim()) {
              write([`url("${imageDraft.trim()}")`, ...layers]);
              setImageDraft(null);
            }
            if (event.key === 'Escape') setImageDraft(null);
          }}
          style={{ width: '100%', marginBottom: 3 }}
        />
      )}
      <div style={{ display: 'flex', gap: spaceVar[2] }}>
        <Button
          type="button"
          variant="ghost"
          size="compact"
          data-testid="react-fill-add-gradient"
          onClick={() => {
            write([composeGradient(DEFAULT_GRADIENT), ...layers]);
            setExpanded(0);
          }}
        >
          + gradient
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="compact"
          data-testid="react-fill-add-image"
          onClick={() => setImageDraft('')}
        >
          + image
        </Button>
      </div>
      {layers.some((layer) => fillLayerUrl(layer) !== null) &&
        ['backgroundSize', 'backgroundPosition', 'backgroundRepeat']
          .map((name) => byName.get(name))
          .filter((prop): prop is PropertyDescriptor => !!prop)
          .map((prop) => (
            <SingleRow key={prop.path} adapter={adapter} id={id} prop={prop} fonts={fonts} />
          ))}
      {colorProp && <SingleRow adapter={adapter} id={id} prop={colorProp} fonts={fonts} />}
    </div>
  );
}

function SemanticPosition({
  adapter,
  id,
  props,
  fonts,
}: {
  adapter: AuthoringAdapter;
  id: string;
  props: readonly PropertyDescriptor[];
  fonts: readonly string[];
}): React.ReactElement {
  const store = useEditorStore();
  const byName = new Map(props.map((prop) => [propNameFromPath(prop.path), prop] as const));
  const position = byName.get('position');
  const positionValue = String(
    position ? (adapter.inspector?.get(id, position.path) ?? 'static') : 'static',
  );
  const commit = (path: string, value: unknown): void => {
    adapter.inspector?.set(id, path, value);
    store.notifyIngestEdit();
  };
  const offsets = ['top', 'right', 'bottom', 'left'];
  const itemProps = ['zIndex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf']
    .map((name) => byName.get(name))
    .filter((prop): prop is PropertyDescriptor => !!prop);
  return (
    <div style={{ padding: '2px 8px 7px' }}>
      {position && (
        <div
          data-testid={testIdFor(position.path)}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: spaceVar[1] }}
        >
          {(position.options ?? []).map((option) => {
            const value = String(option);
            const active = value === positionValue;
            return (
              <Button
                key={value}
                type="button"
                variant={active ? 'primary' : 'secondary'}
                size="compact"
                aria-pressed={active}
                title={value}
                disabled={position.readonly}
                onClick={() => commit(position.path, value)}
              >
                {value.slice(0, 3)}
              </Button>
            );
          })}
        </div>
      )}
      {positionValue !== 'static' && (
        <div
          data-testid="react-position-offsets"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: spaceVar[2],
            marginTop: spaceVar[3],
          }}
        >
          {offsets.map((name) =>
            compactScrub(adapter, id, byName.get(name), name[0]!.toUpperCase(), commit),
          )}
        </div>
      )}
      {itemProps.length > 0 && (
        <div style={{ borderTop: `1px solid ${THEME.border}`, marginTop: 7, paddingTop: 3 }}>
          <div style={{ color: THEME.textMuted, fontSize: fontSizeVar.xs, padding: '2px 0 1px' }}>
            STACKING &amp; FLEX ITEM
          </div>
          {itemProps.map((prop) => (
            <SingleRow key={prop.path} adapter={adapter} id={id} prop={prop} fonts={fonts} />
          ))}
        </div>
      )}
    </div>
  );
}

function SemanticSpacing({
  adapter,
  id,
  props,
}: {
  adapter: AuthoringAdapter;
  id: string;
  props: readonly PropertyDescriptor[];
}): React.ReactElement {
  const store = useEditorStore();
  const byName = new Map(props.map((prop) => [propNameFromPath(prop.path), prop] as const));
  const commit = (path: string, value: unknown): void => {
    adapter.inspector?.set(id, path, value);
    store.notifyIngestEdit();
  };
  // The BOX-MODEL diagram (owner feedback, 2026-08-31: the labeled M T/M R
  // grid "is not how figma works"). The value's PLACE on the nested box says
  // which side it is — margin the outer ring, padding the inner — the way
  // design tools draw CSS spacing (Webflow's spacing control, devtools'
  // box model; Figma's own H/V padding pair exists only because Figma has
  // no margin, so it cannot be transcribed onto CSS whole).
  const slot = (name: string): React.ReactElement => {
    const prop = byName.get(name);
    if (!prop) return <span key={name} />;
    return (
      <ScrubbableInput
        key={prop.path}
        testId={testIdFor(prop.path)}
        label=""
        value={numericValue(adapter.inspector?.get(id, prop.path))}
        unit="px"
        disabled={prop.readonly}
        onChange={(value) => commit(prop.path, value)}
        onChangeEnd={(value) => commit(prop.path, value)}
        style={{ width: 46, minWidth: 0, flex: 'none' }}
      />
    );
  };
  const ringLabel = (text: string): React.ReactElement => (
    <span
      style={{
        position: 'absolute',
        top: 2,
        left: 6,
        fontSize: 8,
        letterSpacing: '.08em',
        color: THEME.textMuted,
        pointerEvents: 'none',
      }}
    >
      {text}
    </span>
  );
  const centered: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
  return (
    <div
      style={{ padding: `${spaceVar[1]} ${spaceVar[4]} ${spaceVar[4]}` }}
      data-testid="react-spacing-box"
    >
      <div
        style={{
          position: 'relative',
          border: `1px solid ${THEME.border}`,
          borderRadius: 4,
          padding: '11px 4px 3px',
        }}
      >
        {ringLabel('MARGIN')}
        <div style={centered}>{slot('marginTop')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: spaceVar[1] }}>
          {slot('marginLeft')}
          <div
            style={{
              position: 'relative',
              flex: 1,
              minWidth: 0,
              border: `1px dashed ${THEME.border}`,
              borderRadius: 4,
              padding: '11px 4px 3px',
            }}
          >
            {ringLabel('PADDING')}
            <div style={centered}>{slot('paddingTop')}</div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: spaceVar[1],
              }}
            >
              {slot('paddingLeft')}
              {slot('paddingRight')}
            </div>
            <div style={centered}>{slot('paddingBottom')}</div>
          </div>
          {slot('marginRight')}
        </div>
        <div style={centered}>{slot('marginBottom')}</div>
      </div>
    </div>
  );
}

/**
 * ONE group's body — the widget-mapped rows for one descriptor group, with no
 * chrome of its own: the group IS an identified `InspectionSection` now
 * (see `reactInspectorSections`), so its title, icon, order and collapse
 * affordance belong to the projection rendering it, and repeating them here
 * would title the same block twice.
 */
function GroupBody({
  name,
  groupId,
  props,
  adapter,
  id,
  fonts,
}: {
  name: string;
  groupId: string;
  props: readonly PropertyDescriptor[];
  adapter: AuthoringAdapter;
  id: string;
  fonts: readonly string[];
}): React.ReactElement {
  const [showConstraints, setShowConstraints] = useState(false);
  const rows = buildPropertyRows(props);
  return (
    <div data-testid={`react-inspector-group-${groupId}`}>
      {name === 'Layout' && (
        <SemanticLayout
          adapter={adapter}
          id={id}
          props={props}
          fonts={fonts}
          showConstraints={showConstraints}
          onToggleConstraints={() => setShowConstraints((value) => !value)}
        />
      )}
      {name === 'Position' && (
        <SemanticPosition adapter={adapter} id={id} props={props} fonts={fonts} />
      )}
      {name === 'Spacing' && <SemanticSpacing adapter={adapter} id={id} props={props} />}
      {name === 'Fill' && <SemanticFill adapter={adapter} id={id} props={props} fonts={fonts} />}
      {name !== 'Layout' &&
        name !== 'Position' &&
        name !== 'Spacing' &&
        name !== 'Fill' &&
        rows.map((row) =>
          row.kind === 'single' ? (
            <SingleRow key={rowKey(row)} adapter={adapter} id={id} prop={row.prop} fonts={fonts} />
          ) : (
            <ComboRow key={rowKey(row)} adapter={adapter} id={id} row={row} />
          ),
        )}
    </div>
  );
}

function BreadcrumbBar({
  adapter,
  node,
}: {
  adapter: AuthoringAdapter;
  node: EditorNode;
}): React.ReactElement {
  const chain: EditorNode[] = [];
  let current: EditorNode | null = node;
  let guard = 0;
  while (current && guard++ < 100) {
    chain.unshift(current);
    current = current.parentId ? adapter.hierarchy.node(current.parentId) : null;
  }
  return (
    <nav
      aria-label="Selection ancestry"
      data-testid="react-inspector-breadcrumbs"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        padding: `${spaceVar[3]} ${spaceVar[4]}`,
        overflowX: 'auto',
        borderBottom: `1px solid ${THEME.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {chain.map((entry, index) => (
        <span key={entry.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          {index > 0 && <span style={{ color: THEME.textMuted }}>/</span>}
          <Button
            type="button"
            variant="ghost"
            size="compact"
            aria-current={entry.id === node.id ? 'page' : undefined}
            title={entry.secondaryLabel ?? entry.label}
            onClick={() => setAuthoringSelection(adapter, [entry.id])}
          >
            {entry.label}
          </Button>
        </span>
      ))}
    </nav>
  );
}

function StoryActions({
  owner,
  node,
}: {
  owner: ReactRootAuthoringAdapter;
  node: EditorNode;
}): React.ReactElement {
  const args = owner.portableArgs(node.id);
  // The CSF WRITE half: save-the-current-args as a new story, rename, delete
  // — inline inputs, never window.prompt (banned), refusals rendered where
  // the gesture happened.
  const [mode, setMode] = useState<'idle' | 'save-as' | 'rename' | 'confirm-delete'>('idle');
  const [draftName, setDraftName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const run = async (op: Parameters<ReactRootAuthoringAdapter['writeStory']>[1]): Promise<void> => {
    const result = await owner.writeStory(node.id, op);
    setNotice(result.changed ? null : (result.error ?? 'refused'));
    if (result.changed) {
      setMode('idle');
      setDraftName('');
    }
  };
  return (
    <div
      data-testid="react-story-controls-header"
      style={{ borderBottom: `1px solid ${THEME.border}` }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spaceVar[4],
          padding: '7px 8px',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ color: THEME.text, fontSize: fontSizeVar.md, fontWeight: 600 }}>
            {node.label}
          </div>
          <div style={{ color: THEME.textMuted, fontSize: fontSizeVar.sm }}>
            {args ? `${Object.keys(args).length} args · session controls` : 'Portable CSF story'}
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="compact"
          data-testid="react-story-reset-args"
          onClick={() => owner.resetPortableArgs(node.id)}
        >
          Reset
        </Button>
      </div>
      <div
        style={{
          display: 'flex',
          gap: spaceVar[2],
          padding: `0 ${spaceVar[4]} ${spaceVar[3]}`,
          flexWrap: 'wrap',
        }}
      >
        <Button
          type="button"
          variant="ghost"
          size="compact"
          data-testid="react-story-save-as"
          title="Write the CURRENT session args as a new story export in this file"
          onClick={() => {
            setNotice(null);
            setDraftName('');
            setMode(mode === 'save-as' ? 'idle' : 'save-as');
          }}
        >
          Save as…
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="compact"
          data-testid="react-story-rename"
          onClick={() => {
            setNotice(null);
            setDraftName('');
            setMode(mode === 'rename' ? 'idle' : 'rename');
          }}
        >
          Rename…
        </Button>
        {mode === 'confirm-delete' ? (
          <Button
            type="button"
            variant="secondary"
            size="compact"
            data-testid="react-story-delete-confirm"
            onClick={() => void run({ kind: 'delete' })}
          >
            Delete story?
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="compact"
            data-testid="react-story-delete"
            onClick={() => {
              setNotice(null);
              setMode('confirm-delete');
            }}
          >
            Delete
          </Button>
        )}
      </div>
      {(mode === 'save-as' || mode === 'rename') && (
        <div
          style={{
            display: 'flex',
            gap: spaceVar[2],
            padding: `0 ${spaceVar[4]} ${spaceVar[4]}`,
            alignItems: 'center',
          }}
        >
          <input
            data-testid="react-story-name-input"
            // Focus follows the gesture (blind re-walk nit: typing right
            // after "Save as…" went nowhere until a second click).
            // biome-ignore lint/a11y/noAutofocus: the input exists only because the user just asked for it.
            autoFocus
            value={draftName}
            placeholder={mode === 'save-as' ? 'NewStoryName' : `Rename ${node.label}`}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && draftName.trim()) {
                void run(
                  mode === 'save-as'
                    ? { kind: 'save-as', name: draftName.trim() }
                    : { kind: 'rename', newName: draftName.trim() },
                );
              }
              if (event.key === 'Escape') setMode('idle');
            }}
            style={{
              flex: 1,
              minWidth: 0,
              background: THEME.neutralHover,
              border: `1px solid ${THEME.border}`,
              borderRadius: 4,
              color: THEME.text,
              fontSize: fontSizeVar.base,
              padding: '3px 6px',
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="compact"
            data-testid="react-story-name-commit"
            onClick={() =>
              void run(
                mode === 'save-as'
                  ? { kind: 'save-as', name: draftName.trim() }
                  : { kind: 'rename', newName: draftName.trim() },
              )
            }
          >
            {mode === 'save-as' ? 'Save' : 'Rename'}
          </Button>
        </div>
      )}
      {notice && (
        <div
          data-testid="react-story-write-notice"
          style={{
            padding: `0 ${spaceVar[4]} ${spaceVar[4]}`,
            color: themeDanger(),
            fontSize: fontSizeVar.sm,
            lineHeight: lineHeightVar.normal,
          }}
        >
          {notice}
        </div>
      )}
    </div>
  );
}

/**
 * NAMED STYLES on the element (design ledger; Webflow prior art): the class
 * tokens the element wears, each with Webflow's "N elements share this class"
 * count and a remove affordance, plus one input that APPLIES an existing
 * first-party class or CREATES a new one from the element's literal inline
 * styles (the adapter decides which — `writeNamedStyle`). A chip whose class
 * has a first-party single-class rule is an editable named style; one without
 * (a utility/generated class) renders muted, because there is no rule of ours
 * behind it to edit.
 */
function ClassesBlock({
  owner,
  nodeId,
}: {
  owner: ReactRootAuthoringAdapter;
  nodeId: string;
}): React.ReactElement {
  const classes = owner.elementClasses(nodeId);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const commit = async (): Promise<void> => {
    const className = draft.trim().replace(/^\./, '');
    if (!className) return;
    const result = await owner.writeNamedStyle(nodeId, { kind: 'set', className });
    setNotice(result.changed ? null : (result.error ?? 'refused'));
    if (result.changed) setDraft('');
  };
  return (
    <div
      data-testid="react-element-classes"
      style={{
        padding: `${spaceVar[3]} ${spaceVar[4]}`,
        borderBottom: `1px solid ${THEME.border}`,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: spaceVar[2], alignItems: 'center' }}>
        <span
          style={{ fontSize: fontSizeVar.sm, color: THEME.textMuted, marginRight: spaceVar[1] }}
        >
          Style class
        </span>
        {classes.map((cls) => (
          <span
            key={cls.name}
            data-testid={`react-class-chip-${cls.name}`}
            title={
              cls.styledIn
                ? `.${cls.name} — ${cls.count} element${cls.count === 1 ? '' : 's'} in this game ` +
                  `share this style (${cls.styledIn.split('/').pop() ?? cls.styledIn})`
                : `.${cls.name} — utility/generated class (no first-party rule to edit)`
            }
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              fontFamily: FONT_MONO,
              fontSize: fontSizeVar.sm,
              color: cls.styledIn ? THEME.text : THEME.textMuted,
              background: THEME.neutralHover,
              border: `1px solid ${THEME.border}`,
              borderRadius: 4,
              padding: '1px 4px',
            }}
          >
            .{cls.name}
            {cls.count > 1 && (
              <span style={{ color: THEME.textMuted, fontSize: fontSizeVar.xs }}>×{cls.count}</span>
            )}
            <button
              type="button"
              data-testid={`react-class-remove-${cls.name}`}
              title={`Remove .${cls.name} from this element`}
              onClick={() =>
                void owner
                  .writeNamedStyle(nodeId, { kind: 'remove', className: cls.name })
                  .then((result) => setNotice(result.changed ? null : (result.error ?? 'refused')))
              }
              style={{
                background: 'none',
                border: 'none',
                color: THEME.textMuted,
                cursor: 'pointer',
                fontSize: fontSizeVar.base,
                // A real hit target (blind-walk friction: the ✕ was ~6px).
                padding: '3px 5px',
                margin: '-3px -4px -3px -1px',
                lineHeight: lineHeightVar.tight,
              }}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          data-testid="react-class-input"
          value={draft}
          placeholder={classes.length === 0 ? 'create style…' : 'add class…'}
          title="Type a class name — an existing first-party class is applied; a new name creates a style from this element's inline declarations"
          onChange={(event) => {
            setDraft(event.target.value);
            if (notice) setNotice(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void commit();
            if (event.key === 'Escape') setDraft('');
          }}
          style={{
            flex: 1,
            minWidth: 72,
            background: 'transparent',
            border: `1px dashed ${THEME.border}`,
            borderRadius: 4,
            color: THEME.text,
            fontSize: fontSizeVar.sm,
            fontFamily: FONT_MONO,
            padding: '2px 5px',
          }}
        />
      </div>
      {notice && (
        <div
          data-testid="react-class-notice"
          style={{
            paddingTop: spaceVar[2],
            color: themeDanger(),
            fontSize: fontSizeVar.sm,
            lineHeight: lineHeightVar.normal,
          }}
        >
          {notice}
        </div>
      )}
      <BreakpointRow />
    </div>
  );
}

/** The breakpoint selector — module session state (`breakpoint-state.ts`),
 *  because the authoring adapters are recreated across design-time re-renders
 *  and instance state silently reset to base between the select gesture and
 *  the next edit (measured). */
function BreakpointRow(): React.ReactElement {
  const bp = useSyncExternalStore(subscribeBreakpoint, activeBreakpoint);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, paddingTop: 5 }}>
        <span style={{ fontSize: fontSizeVar.sm, color: THEME.textMuted }}>Breakpoint</span>
        <Select
          data-testid="react-breakpoint-select"
          value={bp ?? ''}
          onChange={(event) => setActiveBreakpoint(event.target.value || null)}
          style={{
            fontSize: fontSizeVar.sm,
            flex: 1,
            ...(bp ? { color: THEME.accent, borderColor: THEME.accent } : {}),
          }}
        >
          {BREAKPOINT_OPTIONS.map((option) => (
            <option key={option.label} value={option.media ?? ''}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      {bp && (
        <div
          data-testid="react-breakpoint-note"
          style={{
            paddingTop: 3,
            color: THEME.textMuted,
            fontSize: fontSizeVar.xs,
            lineHeight: lineHeightVar.normal,
          }}
        >
          Style edits write @media {bp} — previewed live by frame width.
        </div>
      )}
    </>
  );
}

/** Webflow's cascade tiers as `@media` conditions. Base is the unscoped rule;
 *  each tier is max-width, so narrower inherits from wider — the same
 *  downward cascade Webflow teaches. A project's own additional conditions
 *  are honored wherever they already exist in its css; this list is only
 *  what the SELECT offers. */
const BREAKPOINT_OPTIONS: ReadonlyArray<{ label: string; media: string | null }> = [
  { label: 'Base', media: null },
  { label: 'Tablet ≤991', media: '(max-width: 991px)' },
  { label: 'Phone L ≤767', media: '(max-width: 767px)' },
  { label: 'Phone ≤479', media: '(max-width: 479px)' },
];

/** The danger tone for a story-write refusal, resolved lazily so this module
 *  keeps a single THEME import surface. */
function themeDanger(): string {
  return '#e06c75';
}

/** The Lane-B ("edits component source -> every instance") disclosure —
 *  ports `ui-editor/source-edit-panel.tsx`'s header COPY, not the component
 *  itself (that one is bound to `UIEditStore`/an ad hoc `/__ui-source/index`
 *  fetch — Rule zero bans importing `UIEditStore` into this shell-registered
 *  section). Shown only for a `ReactRootAuthoringAdapter` (real Lane B,
 *  `data-oid` component-source writes); a `DomAuthoringAdapter`
 *  (ingested, overlay-only — never touches source) gets its own honest note
 *  instead, so neither lane's write model is ever misrepresented. */
/**
 * C4 (spec §9): "the editor offers open/copy-path/go-to-line operations" for a DOM
 * element's mapped source location. Read-only — this ONLY surfaces where the source is
 * and copies a `file:line` locator; it has no write path (that stays SourceWriteBackend's
 * bounded style/className/text/struct ops, wired elsewhere). `open` degrades honestly to
 * copy-path when no editor-launch protocol is configured (documented fallback, not a
 * silent no-op): most terminals/OS shells don't register a handler for arbitrary custom
 * URI schemes, so we copy a `vscode://file/<abs>:<line>` link users can paste, rather than
 * assume a scheme is registered and fail silently if it isn't.
 */
function SourceLocationRow({ entry }: { entry: OidEntry }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const filePath = `${entry.file}:${entry.line}`;
  const short = `${entry.file.split('/').pop() ?? entry.file}:${entry.line}`;
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(filePath);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — the row still shows the path as text.
    }
  };
  return (
    <button
      type="button"
      data-testid="react-source-location"
      title={`${filePath} — click to copy the path`}
      onClick={() => void copy()}
      style={{
        fontFamily: FONT_MONO,
        fontSize: 'inherit',
        color: THEME.textMuted,
        cursor: 'pointer',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        minWidth: 0,
        background: 'none',
        border: 'none',
        padding: 0,
        textAlign: 'left',
      }}
    >
      {copied ? 'Copied' : short}
    </button>
  );
}

function LaneDisclosure({
  owner,
  node,
  nodeId,
}: {
  owner: ReactRootAuthoringAdapter | DomAuthoringAdapter;
  node: EditorNode | null;
  nodeId: string;
}): React.ReactElement {
  const isLaneB = owner instanceof ReactRootAuthoringAdapter;
  // C4: only Lane B (the OID/JSX source-writer path) has a source-location mapping —
  // Lane A (`DomAuthoringAdapter`, an ingested/overlay session) never stamps
  // `data-oid` or has an OID index (see its file doc comment), so it has nothing to
  // resolve here; that's the intended DOM-only degradation, not a bug.
  const sourceEntry = isLaneB ? owner.sourceLocation(nodeId) : undefined;
  // ONE quiet line, Figma-shaped (owner feedback, 2026-08-30): the inspector
  // leads with design controls, so provenance is a small muted row — the
  // short label + the file:line — with the full explanation living in the
  // tooltip instead of a callout paragraph.
  const short =
    node?.role === 'story'
      ? `Story · ${node.label}`
      : node?.role === 'document'
        ? `CSF · ${node.secondaryLabel ?? node.label}`
        : isLaneB
          ? 'Source'
          : 'Session overlay — not written to source';
  const explain =
    node?.role === 'story'
      ? `${node.label} is the active portable CSF design state.`
      : node?.role === 'document'
        ? `${node.secondaryLabel ?? node.label} owns this root's design states.`
        : isLaneB
          ? `Edits change ${node?.label ?? 'this component'}'s source — every rendered ` +
            'instance updates.'
          : 'This is an ingested game: edits persist as a per-project overlay only, never ' +
            'written to source.';
  return (
    <div
      data-testid={isLaneB ? 'react-lane-b-disclosure' : 'react-overlay-disclosure'}
      title={explain}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: spaceVar[3],
        padding: `${spaceVar[1]} ${spaceVar[4]} ${spaceVar[3]}`,
        borderBottom: `1px solid ${THEME.border}`,
        color: THEME.textMuted,
        fontSize: fontSizeVar.sm,
        lineHeight: lineHeightVar.normal,
        minWidth: 0,
      }}
    >
      <span style={{ flexShrink: 0, ...(isLaneB ? {} : { color: THEME.accent }) }}>{short}</span>
      {sourceEntry && <SourceLocationRow entry={sourceEntry} />}
    </div>
  );
}

/** The `element` facet's body: where it sits (ancestry), which lane owns it,
 *  and where its source is. The subject's own name and type live on the
 *  shell's identity row, not here. */
function ElementSection({
  adapter,
  node,
  nodeId,
  owner,
}: {
  adapter: AuthoringAdapter;
  node: EditorNode;
  nodeId: string;
  owner: ReactRootAuthoringAdapter | DomAuthoringAdapter;
}): React.ReactElement {
  return (
    <div data-testid="react-inspector-section">
      <BreadcrumbBar adapter={adapter} node={node} />
      {owner instanceof ReactRootAuthoringAdapter && <ClassesBlock owner={owner} nodeId={nodeId} />}
      <LaneDisclosure owner={owner} node={node} nodeId={nodeId} />
    </div>
  );
}

/** The Style/Layout/Position/Spacing/component-prop group bodies re-render on
 *  the shell's own subscription: every `SingleRow`/`ComboRow` calls
 *  `store.notifyIngestEdit()` on commit (its own `useEditorStore()`), which
 *  re-renders the inspector tree including these sections. */
function GroupSectionBody({
  adapter,
  id,
  name,
  groupId,
  props,
}: {
  adapter: AuthoringAdapter;
  id: string;
  name: string;
  groupId: string;
  props: readonly PropertyDescriptor[];
}): React.ReactElement {
  const fonts = useMemo(() => getAvailableFonts(), []);
  return (
    <GroupBody
      name={name}
      groupId={groupId}
      props={props}
      adapter={adapter}
      id={id}
      fonts={fonts}
    />
  );
}

/**
 * The react/DOM adapter as a PRODUCER of subject data (owner, 2026-08-06 —
 * "every section its own identified tab; no lumps").
 *
 * This adapter's inspector is not one thing: it is the element's identity,
 * its loose style declarations, and one block per descriptor GROUP (Layout,
 * Position, Spacing, a component's own props, the document's tokens…). Which
 * groups exist is a property of the NODE, so they can only be produced from
 * it — which is exactly what a producer registration is for. Each block comes
 * back as its own identified `InspectionSection`, so the compact card gives
 * it its own icon tab and the column its own titled block, with no projection
 * learning anything about React.
 *
 * The ids are the model's own (`properties` for the loose declarations,
 * `group:<id>` per group), so each block REPLACES the generic built-in of the
 * same id rather than appearing beside it.
 */
export function reactInspectorSections(
  node: EditorNode | null,
  adapter: AuthoringAdapter,
): readonly InspectionSection[] {
  const owner = resolveReactOwner(node, adapter);
  if (!owner || !node) return [];
  const nodeId = node.id;
  const props = (adapter.inspector?.properties(nodeId) ?? []).filter((p) => p.path !== 'name');
  const { ungrouped, groups } = groupProperties(props);
  const sections: InspectionSection[] = [
    {
      id: REACT_ELEMENT_SECTION_ID,
      // The facet's name, not the object's: what KIND of element this is
      // surfaces on the subject's identity row. This adapter sets no
      // `typeLabel`, so the row's kind label falls back to `node.kind` (the tag
      // name) — the `typeLabel ?? kind` chain in `compose.ts`'s `kindLabel`.
      title: 'Element',
      icon: faCode,
      order: REACT_ELEMENT_SECTION_ORDER,
      body: {
        kind: 'custom',
        render: () => createElement(ElementSection, { adapter, node, nodeId, owner }),
        // The AGENT half of the Element section (P18 + the Transform-section
        // editable precedent): the class chips and active breakpoint the
        // rendered chrome shows, published as data — and the breakpoint as a
        // writable field through the SAME `setActiveBreakpoint` the select
        // calls, so `editor.inspect()` can read the named-styles surface and
        // `editor.setField('element.breakpoint', …)` can arm it. Class
        // add/remove stays a structural gesture (writeNamedStyle), not a
        // field — a class list is not a value.
        ...(owner instanceof ReactRootAuthoringAdapter
          ? {
              data: {
                classes: owner.elementClasses(nodeId),
                breakpoint: activeBreakpoint(),
              },
              editable: {
                fields: [
                  {
                    path: 'element.breakpoint',
                    label: 'Breakpoint',
                    type: 'enum' as const,
                    options: BREAKPOINT_OPTIONS.map((option) => option.media ?? ''),
                  },
                ],
                io: {
                  get: (path: string) =>
                    path === 'element.breakpoint' ? (activeBreakpoint() ?? '') : undefined,
                  set: (path: string, value: unknown) => {
                    if (path === 'element.breakpoint') {
                      setActiveBreakpoint(typeof value === 'string' && value ? value : null);
                    }
                  },
                },
              },
            }
          : {}),
      },
    },
  ];
  if (node.role === 'story' && owner instanceof ReactRootAuthoringAdapter) {
    sections.push({
      id: REACT_STORY_SECTION_ID,
      title: 'Story',
      // The single selected story's own controls — a DIFFERENT facet from the
      // built-in `stories` collection/switcher (`faBookOpen`), and both can
      // compose on a story node. The compact card tells tabs apart by glyph
      // alone, so this one wears a distinct single-story glyph.
      icon: faBookBookmark,
      order: REACT_STORY_SECTION_ORDER,
      body: { kind: 'custom', render: () => createElement(StoryActions, { owner, node }) },
    });
  }
  if (ungrouped.length > 0) {
    sections.push({
      id: PROPERTIES_SECTION_ID,
      title: 'Style',
      icon: faPalette,
      order: PROPERTIES_SECTION_ORDER,
      defaultOpen: true,
      body: {
        kind: 'custom',
        render: () =>
          createElement(GroupSectionBody, {
            adapter,
            id: nodeId,
            name: 'Style',
            groupId: 'style',
            props: ungrouped,
          }),
      },
    });
  }
  groups.forEach((group, index) => {
    sections.push({
      id: groupSectionId(group.groupId),
      title: group.name,
      icon: groupIcon(group.name),
      order: GROUP_SECTION_ORDER + index,
      defaultOpen: true,
      body: {
        kind: 'custom',
        render: () =>
          createElement(GroupSectionBody, {
            adapter,
            id: nodeId,
            name: group.name,
            groupId: group.groupId,
            props: group.properties,
          }),
      },
    });
  });
  return sections;
}

const registrationGroup = createHmrRegistrationGroup(import.meta.hot, 'react-inspector-section');

/**
 * Idempotent one-time registration of this surface's Inspector section, called
 * by `@volter/editor-game/contributions/react/react-inspector.service.ts`.
 *
 * It used to run at module scope, reached by a bare `import
 * './authoring/react-inspector-section';` on line 33 of the host's `main.tsx`
 * — which is how the whole React/DOM design-time surface, 28 files, entered
 * every editor boot including a `models` build that authors no DOM. The
 * `ensure`/`track` shape is `@volter/editor-game`'s story contributions', for the same
 * reason recorded there: importing this module (in a test, or to reach
 * {@link resolveReactOwner}) must not mutate a registry.
 */
export function ensureReactInspectorSectionRegistered(): void {
  registrationGroup.ensure((track) => {
    track(
      registerInspectorSections({
        match: isDomSelection,
        sections: reactInspectorSections,
        // The descriptor channel is this adapter's own: its blocks ARE the node's
        // properties, mapped to the C1 widgets instead of the generic grid. Claimed
        // even for a node with no loose declarations, so the thin generic grid
        // never appears beside the rich blocks. (A react/DOM node has no transform
        // provider at all, so no Transform block is ever composed for one.)
        claims: [PROPERTIES_SECTION_ID],
      }),
    );
  });
}
