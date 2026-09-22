/**
 * THE GENERIC PROPERTIES VIEW — every `bl_rna` property of the active
 * datablock, drawn in OUR panels (WORK.md §Blender in the tab is Blender,
 * "Inspection parity", I1; ARCHITECTURE-CORE §Blender north star, "Inspection
 * parity, not editing parity"). Blender's UI layer is never run, ported or
 * recorded: what arrives is `session.py`'s RNA rows, and what is drawn here is
 * this file's own widgets.
 *
 * ## The geometry is Blender's SOURCE, not an eyedropper
 *
 * Every number below cites the file and constant it came from, read at the
 * engine's own pin (Blender 5.2.0, `fbe6228777e7`, `~/volter/blender-src`).
 * That is the rule as of 2026-09-19: a theme value or a metric traces to
 * `userdef_default_theme.c` / `interface_*.cc`, and a frame is what confirms
 * the result rather than what supplies the number.
 *
 *   UI_UNIT_Y            20  `UI_interface_c.hh:2346` (`U.widget_unit`, 1x)
 *   row gap               2  `interface_style.cc:110`  (`buttonspacey`)
 *   label column        40%  `interface_layout.cc:79`  (UI_ITEM_PROP_SEP_DIVIDE)
 *   label alignment   right  `interface_layout.cc:3394` (LayoutAlign::Right)
 *   panel header         25  `interface_intern.hh:152` (PNL_HEADER = 1.25 UI_UNIT_Y)
 *   panel label x        20  `interface_panel.cc:1054` (UI_UNIT_X * 1.0)
 *   sub-panel indent     14  `interface_panel.cc:1058` (+0.7 UI_UNIT_X)
 *   panel padding         8  `interface_style.cc:111`  (`panelspace`)
 *   panel radius          4  `interface_panel.cc:1103` (panel_roundness 0.4 x unit x 0.5)
 *   widget radius   0.2 x h  `interface_widgets.cc` widget_radius_from_rcti,
 *                            `userdef_default_theme.c:100` wcol_num.roundness
 *   text margin           8  `interface_intern.hh:1503` (UI_TEXT_MARGIN_X 0.4 x unit)
 *   font                 11  `UI_interface_c.hh:425` (UI_DEFAULT_TEXT_POINTS)
 *   read-only alpha     0.5  `interface_widgets.cc` widget_alpha_factor /
 *                            widget_color_disabled — EVERY widget colour at
 *                            half alpha, which is why a read-only row here is
 *                            DIMMED rather than a disabled control.
 *
 * Colours, from `release/datafiles/userdef/userdef_default_theme.c`:
 *   panel header/back  #3d3d3d  :281,:282   sub-panel back  #0000001f  :283
 *   panel outline    #ffffff11  :284        panel title     #e6e6e6    :285
 *   widget inner       #545454  :95         widget outline  #3d3d3d    :93
 *   widget text        #e6e6e6  :98         number slider   #4772b3    :97
 *   checkbox mark      #ffffff  :77 (wcol_option.item)
 *
 * The values are literal rather than `var(--vgai-…)` because the palette is
 * the FRAME's grading (U8/U9) and eyedropped: `blender.palette.json` carries
 * `surface.panel` #2f2f2f where the source says `.space_properties.back` is
 * #303030, and `content.primary` #e5e5e5 against `.text` #e6e6e6. Where a
 * token and the source agree, the token is used.
 */

import type {
  BlenderRnaCollectionValue,
  BlenderRnaContext,
  BlenderRnaPointer,
  BlenderRnaRow,
  BlenderRnaView,
} from '@volter/blender-engine/browser/rna';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  type BlenderSubject,
  blenderPropertiesState,
  blenderPropertiesVersion,
  blenderRnaViewFor,
  showBlenderSubject,
  subscribeBlenderProperties,
  writeBlenderRnaProperty,
} from './blender-properties-model';

const UNIT = 20;
const ROW_GAP = 2;
const LABEL_COLUMN = '40%';
const PANEL_HEADER = 25;
const PANEL_LABEL_X = 20;
const PANEL_PAD = 8;
const PANEL_RADIUS = 4;
const TEXT_MARGIN = 8;
const FONT = 11;
const READONLY_ALPHA = 0.5;

const INK = '#e6e6e6';
const PANEL_BAND = '#3d3d3d';
const PANEL_OUTLINE = '#ffffff11';
const SUB_PANEL_BACK = 'rgba(0,0,0,0.12)';
const WIDGET_INNER = '#545454';
const WIDGET_OUTLINE = '#3d3d3d';
const WIDGET_ITEM = '#4772b3';
/** `wcol_state.error` (`userdef_default_theme.c:234`) — the ink Blender puts
 *  on a widget whose state is an error. The door's refusals are drawn in it. */
const ERROR_INK = '#991616';
/** The collapse triangle's optical size and the gap after it. Blender draws
 *  the triangle as an icon inside `panel_label_offset`'s UI_UNIT_X lead-in
 *  (`interface_panel.cc:1049-1060`) rather than as text; 8 is that mark's
 *  height at a 25 px header, and 6 is the space it leaves before the label. */
const TRIANGLE_SIZE = 8;
const TRIANGLE_GAP = 6;

/** `widget_radius_from_rcti`: `roundness * height`, and `wcol_num.roundness`
 *  is 0.2 for every widget this view draws. */
const widgetRadius = (height: number) => Math.round(height * 0.2);

/**
 * WHAT BLENDER DRAWS NOWHERE, WE DRAW NOWHERE — RNA's own `PROP_HIDDEN`
 * (`BlenderRnaRow.hidden`, `rna_rna.cc:795-799`). The door reports the whole
 * surface and this is the one place it is narrowed, so "hidden" stays
 * Blender's answer rather than a list of ours.
 *
 * AND THE SECOND RULE, ruled on after I2 measured it: UNDRAWN STATE
 * (`BlenderRnaRow.undrawn`). The `PROP_HIDDEN` flag above does NOT cover a
 * modifier's panel-open booleans (`open_advanced_panel` and its siblings) —
 * there is not one `PROP_HIDDEN` in the whole of `rna_modifier.cc`, because
 * `rna_def_modifier_panel_open_prop` (`rna_modifier.cc:2694-2705`) sets
 * `PROP_NO_DEG_UPDATE` and an sdna bit and no flag. What RNA does say is that
 * they carry no `RNA_def_property_ui_text` at all, so
 * `rna_define.cc:1311-1312`'s definition-time defaults still stand: `name`
 * equal to the identifier, `description` empty. A property Blender never gave
 * UI text to is a property Blender never meant to draw, and the generic view
 * omits it here for exactly the same reason it omits a hidden one. The
 * curated lists need no change: `bl_ui` names none of them.
 */
const shown = (rows: readonly BlenderRnaRow[]): readonly BlenderRnaRow[] =>
  rows.filter((row) => row.hidden !== true && row.undrawn !== true);

export function useBlenderProperties() {
  return useSyncExternalStore(
    subscribeBlenderProperties,
    blenderPropertiesVersion,
    blenderPropertiesVersion,
  );
}

// ---- Blender's panel -------------------------------------------------------

function Panel({
  title,
  sub = false,
  closed = false,
  note,
  count,
  children,
}: {
  readonly title: string;
  readonly sub?: boolean;
  /** Blender's `bl_options = {'DEFAULT_CLOSED'}` — a panel that opens shut. */
  readonly closed?: boolean;
  /** The header's tooltip; the curated panels say which of Blender's
   *  properties this datablock does not carry. */
  readonly note?: string;
  /** A list panel's length, beside its title — Blender's `template_list`
   *  shows the rows and the count is what a collapsed panel can still say. */
  readonly count?: number;
  readonly children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!closed);
  return (
    <div
      style={{
        marginBottom: PANEL_PAD,
        borderRadius: PANEL_RADIUS,
        // `panel_outline` #ffffff11 (`userdef_default_theme.c:284`), drawn by
        // `panel_draw_border` around the header AND body as one box.
        boxShadow: sub ? 'none' : `inset 0 0 0 1px ${PANEL_OUTLINE}`,
        background: sub ? SUB_PANEL_BACK : 'transparent',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          height: PANEL_HEADER,
          // `panel_header` #3d3d3d (`userdef_default_theme.c:281`).
          background: sub ? 'transparent' : PANEL_BAND,
          border: 'none',
          // `panel_label_offset`: the label sits UI_UNIT_X in, and a sub-panel
          // a further 0.7 UI_UNIT_X (`interface_panel.cc:1049-1060`). The
          // triangle lives in the space before it.
          padding: `0 ${TEXT_MARGIN}px 0 ${sub ? PANEL_LABEL_X + 14 - 20 : 0}px`,
          color: INK,
          font: `${FONT}px inherit`,
          textAlign: 'left',
          cursor: 'pointer',
          gap: TRIANGLE_GAP,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: PANEL_LABEL_X - 8,
            textAlign: 'center',
            // Blender's collapse triangle: down when open, right when closed.
            fontSize: TRIANGLE_SIZE,
            opacity: 0.85,
          }}
        >
          {open ? '▼' : '▶'}
        </span>
        <span style={{ fontWeight: 400 }} title={note}>
          {title}
        </span>
        {count === undefined ? null : (
          <span style={{ opacity: READONLY_ALPHA, marginLeft: 'auto' }}>{count}</span>
        )}
      </button>
      {open ? <div style={{ padding: PANEL_PAD }}>{children}</div> : null}
    </div>
  );
}

// ---- one property row ------------------------------------------------------

function Row({
  label,
  title,
  readonly,
  identifier,
  children,
}: {
  readonly label: string;
  readonly title?: string;
  readonly readonly: boolean;
  /** The RNA identifier this row draws, when it draws one — the name the
   *  product's chrome door reports so a reading of the rail is addressed the
   *  way `bpy` addresses it, not by the label's English. */
  readonly identifier?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div
      // WHAT THIS ROW IS, published so it can be READ. The rail is a VS Code
      // view (`editor-document-probe.ts` scope `'rail'`), and before these
      // three attributes a reading of it could recover a label only as the
      // row's text and could not say which RNA property that label belonged
      // to or whether the field was writable. They change nothing about what
      // is drawn.
      data-rna-field={identifier ?? ''}
      data-field-label={label}
      data-field-readonly={readonly ? 'true' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        minHeight: UNIT,
        marginBottom: ROW_GAP,
        gap: TEXT_MARGIN,
        // `widget_color_disabled` puts EVERY colour at half alpha, so a
        // read-only row is the same widget, dimmed — never a greyed-out
        // control of a different shape.
        opacity: readonly ? READONLY_ALPHA : 1,
      }}
      title={title}
    >
      <span
        style={{
          flex: `0 0 ${LABEL_COLUMN}`,
          // `LayoutAlign::Right` on the split's label column.
          textAlign: 'right',
          color: INK,
          fontSize: FONT,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <span style={{ flex: '1 1 0', minWidth: 0, display: 'flex', gap: ROW_GAP }}>{children}</span>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  height: UNIT,
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  background: WIDGET_INNER,
  border: `1px solid ${WIDGET_OUTLINE}`,
  borderRadius: widgetRadius(UNIT),
  color: INK,
  fontSize: FONT,
  padding: `0 ${TEXT_MARGIN}px`,
  // Blender's number and text buttons centre their value.
  textAlign: 'center',
};

function StaticValue({ children }: { readonly children: React.ReactNode }) {
  return (
    <span
      style={{
        ...fieldStyle,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

/** Blender's checkbox: a square of the row's height shrunk by
 *  `(h - 2*pixelsize)/6` a side (`widget_optionbut`, `interface_widgets.cc`) —
 *  14 px at a 20 px row — with the mark in `wcol_option.item` #ffffff. */
const CHECKBOX = UNIT - 2 * Math.floor((UNIT - 2) / 6);

function Checkbox({
  value,
  readonly,
  label,
  onChange,
}: {
  readonly value: boolean;
  readonly readonly: boolean;
  /** The row's own label, on the CONTROL. A field whose value lives in
   *  `input.value` reports that value and no name, so without this a reading
   *  of the rail could not say which property a number belonged to without a
   *  second query for the row around it. It is also simply what an unlabelled
   *  form control owes a screen reader. */
  readonly label?: string;
  readonly onChange: (next: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      checked={value}
      readOnly={readonly}
      {...(label === undefined ? {} : { 'aria-label': label })}
      onChange={(event) => !readonly && onChange(event.target.checked)}
      style={{
        width: CHECKBOX,
        height: CHECKBOX,
        margin: `${(UNIT - CHECKBOX) / 2}px 0`,
        accentColor: WIDGET_ITEM,
        cursor: readonly ? 'default' : 'pointer',
      }}
    />
  );
}

function Numeric({
  row,
  value,
  index,
  onWrite,
}: {
  readonly row: BlenderRnaRow;
  readonly value: number;
  readonly index?: number;
  readonly onWrite: (next: number, index?: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const decimals = row.type === 'FLOAT' ? (row.precision ?? 3) : 0;
  const shown = draft ?? (row.type === 'FLOAT' ? value.toFixed(decimals) : String(value));
  if (row.readonly) return <StaticValue>{shown}</StaticValue>;
  return (
    <input
      type="number"
      // The FULL name on every component — the drawn label says `Location  X`
      // on the first row and a bare `Y` on the next (Blender's own economy),
      // so the control carries the whole one. See {@link Checkbox}'s `label`.
      aria-label={fieldName(row, index)}
      value={shown}
      // The SOFT range is what Blender's own field drags between; the hard
      // range is the clamp the engine applies, and it refuses out of it.
      {...(row.softMin === undefined ? {} : { min: row.softMin })}
      {...(row.softMax === undefined ? {} : { max: row.softMax })}
      {...(row.step === undefined ? {} : { step: row.type === 'FLOAT' ? row.step / 100 : 1 })}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = Number(draft);
        setDraft(null);
        if (draft !== null && Number.isFinite(next) && next !== value) onWrite(next, index);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        if (event.key === 'Escape') setDraft(null);
      }}
      style={fieldStyle}
    />
  );
}

/** X/Y/Z/W — `RNA_property_array_item_char`'s own letters for a vector or
 *  colour; anything longer is numbered, as Blender numbers it. */
const ARRAY_LETTERS = ['X', 'Y', 'Z', 'W'];

/** A field's WHOLE name, for the control's `aria-label` — the property's UI
 *  name (its RNA identifier when it has none), plus the array component's
 *  letter. Never the drawn label, which omits the property name on every
 *  component after the first. */
function fieldName(row: BlenderRnaRow, index?: number): string {
  const name = row.name || row.identifier;
  return index === undefined ? name : `${name} ${ARRAY_LETTERS[index] ?? index}`;
}

function colourOf(values: readonly number[]): string {
  const byte = (channel: number) =>
    Math.max(0, Math.min(255, Math.round((values[channel] ?? 0) ** (1 / 2.2) * 255)));
  return `rgb(${byte(0)}, ${byte(1)}, ${byte(2)})`;
}

/** A property's widget, by RNA TYPE — the dispatcher is one `switch` and each
 *  arm is its own component, because "which widget does this type get" is the
 *  whole mapping this view is and it should read as a list. */
interface WidgetProps {
  readonly row: BlenderRnaRow;
  readonly path: string;
  readonly write: (next: unknown, index?: number) => void;
  readonly onOpen: (path: string) => void;
}

function PointerWidget({ row, onOpen }: WidgetProps) {
  const value = row.value as BlenderRnaPointer | null;
  if (value === null || value.path === null)
    return <StaticValue>{value === null ? 'None' : (value.name ?? value.type)}</StaticValue>;
  const target = value.path;
  return (
    <button
      type="button"
      aria-label={fieldName(row)}
      onClick={() => onOpen(target)}
      style={{ ...fieldStyle, cursor: 'pointer', textAlign: 'left' }}
      title={target}
    >
      {value.name ?? value.type}
    </button>
  );
}

function EnumWidget({ row, write }: WidgetProps) {
  const items = row.items ?? [];
  if (row.isFlag) {
    const held = (row.value as readonly string[] | null) ?? [];
    return <StaticValue>{held.length === 0 ? 'None' : held.join(', ')}</StaticValue>;
  }
  const value = String(row.value ?? '');
  if (row.readonly)
    return <StaticValue>{items.find((i) => i.identifier === value)?.name ?? value}</StaticValue>;
  return (
    <select
      aria-label={fieldName(row)}
      value={value}
      onChange={(event) => write(event.target.value)}
      style={{ ...fieldStyle, textAlign: 'left' }}
    >
      {items.map((item) => (
        <option key={item.identifier} value={item.identifier}>
          {item.name}
        </option>
      ))}
    </select>
  );
}

function StringWidget({ row, write }: WidgetProps) {
  const value = String(row.value ?? '');
  return row.readonly ? (
    <StaticValue>{value}</StaticValue>
  ) : (
    <TextField value={value} label={fieldName(row)} onWrite={(next) => write(next)} />
  );
}

/** A COLOR subtype is a swatch, not three numbers — `PropertyRNA.subtype` is
 *  exactly what says so, and it is why the door carries `subtype` at all. */
function ColourWidget({ row }: WidgetProps) {
  const values = (row.value as readonly number[] | null) ?? [];
  return (
    <span
      style={{ ...fieldStyle, background: colourOf(values), display: 'block' }}
      title={values.map((value) => value.toFixed(3)).join(', ')}
    />
  );
}

/** Blender stacks an array's components as their own rows, labelled by
 *  `RNA_property_array_item_char` (X/Y/Z/W) and numbered past four.
 *
 *  A BOOLEAN ARRAY IS AN ARRAY, and that is why this function dispatches on
 *  the element type rather than being numeric-only. `Object.lock_location` is
 *  three booleans, and Blender draws all three: `properties_object.py:49`
 *  (`OBJECT_PT_transform`) is `row.prop(ob, "lock_location", text="",
 *  emboss=False, icon='DECORATE_UNLOCKED')` — a whole-array `prop()` beside
 *  the location vector, which Blender's layout engine expands into one lock
 *  toggle per component, stacked alongside the three number fields (the same
 *  shape at `:59`/`:74` for `lock_rotation` and `:83` for `lock_scale`).
 *  Measured 2026-09-21 in the rail before this: `lock_location` fell to the
 *  single-checkbox arm of {@link widgetFor}, so ONE unchecked box stood for
 *  three values — and its write was `setattr(ob, "lock_location", true)`, a
 *  scalar into a three-element array, which is a refusal rather than the lock
 *  the person asked for. Each toggle here writes its own index (the door's
 *  `index` argument, `session.py::rna_set`'s `getattr(target, id)[index]`). */
function ArrayRows({ row, label, title, write }: WidgetProps & { label: string; title: string }) {
  const values = (row.value as readonly (number | boolean)[] | null) ?? [];
  return (
    <>
      {values.map((value, index) => (
        <Row
          key={`${row.identifier}-${ARRAY_LETTERS[index] ?? index}`}
          label={componentLabel(label, index, values.length)}
          title={title}
          readonly={row.readonly}
          identifier={`${row.identifier}[${index}]`}
        >
          {row.type === 'BOOLEAN' ? (
            <Checkbox
              value={value === true}
              readonly={row.readonly}
              label={fieldName(row, index)}
              onChange={(next) => write(next, index)}
            />
          ) : (
            <Numeric
              row={row}
              value={Number(value)}
              index={index}
              onWrite={(next, at) => write(next, at)}
            />
          )}
        </Row>
      ))}
    </>
  );
}

function componentLabel(label: string, index: number, length: number): string {
  if (length > ARRAY_LETTERS.length) return index === 0 ? label : `${label} ${index}`;
  return `${index === 0 ? `${label}  ` : ''}${ARRAY_LETTERS[index]}`;
}

function widgetFor(props: WidgetProps): React.ReactNode {
  const { row, write } = props;
  switch (row.type) {
    case 'POINTER':
      return <PointerWidget {...props} />;
    case 'ENUM':
      return <EnumWidget {...props} />;
    case 'STRING':
      return <StringWidget {...props} />;
    case 'BOOLEAN':
      return (
        <Checkbox
          value={row.value === true}
          readonly={row.readonly}
          label={fieldName(row)}
          onChange={write}
        />
      );
    default:
      return <Numeric row={row} value={Number(row.value ?? 0)} onWrite={(next) => write(next)} />;
  }
}

function PropertyRow({
  row,
  path,
  onOpen,
}: {
  readonly row: BlenderRnaRow;
  readonly path: string;
  readonly onOpen: (path: string) => void;
}) {
  const write = (next: unknown, index?: number) =>
    void writeBlenderRnaProperty(path, row.identifier, next, index);
  const label = row.name || row.identifier;
  const title = `${row.identifier} — ${row.type}${row.subtype === 'NONE' ? '' : `/${row.subtype}`}${
    row.readonly ? ' (read-only)' : ''
  }${row.description ? `\n${row.description}` : ''}`;
  const props: WidgetProps = { row, path, write, onOpen };
  const unreadable = row.valueOmitted ?? row.valueError;

  if (unreadable !== undefined)
    return (
      <Row label={label} title={title} readonly identifier={row.identifier}>
        <StaticValue>{unreadable}</StaticValue>
      </Row>
    );
  if (row.type === 'COLLECTION')
    return (
      <CollectionRow
        label={label}
        title={title}
        value={(row.value ?? { count: 0 }) as BlenderRnaCollectionValue}
        identifier={row.identifier}
        onOpen={() => onOpen(`${path}.${row.identifier}`)}
      />
    );
  const numericArray = row.type === 'INT' || row.type === 'FLOAT';
  if (row.arrayLength > 0 && (numericArray || row.type === 'BOOLEAN')) {
    if (numericArray && (row.subtype === 'COLOR' || row.subtype === 'COLOR_GAMMA'))
      return (
        <Row label={label} title={title} readonly={row.readonly} identifier={row.identifier}>
          <ColourWidget {...props} />
        </Row>
      );
    return <ArrayRows {...props} label={label} title={title} />;
  }
  return (
    <Row label={label} title={title} readonly={row.readonly} identifier={row.identifier}>
      {widgetFor(props)}
    </Row>
  );
}

function TextField({
  value,
  label,
  onWrite,
}: {
  readonly value: string;
  /** The row's own label, on the control — see {@link Checkbox}'s `label`. */
  readonly label?: string;
  readonly onWrite: (next: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="text"
      {...(label === undefined ? {} : { 'aria-label': label })}
      value={draft ?? value}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== value) onWrite(draft);
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        if (event.key === 'Escape') setDraft(null);
      }}
      style={{ ...fieldStyle, textAlign: 'left' }}
    />
  );
}

function CollectionRow({
  label,
  title,
  value,
  identifier,
  onOpen,
}: {
  readonly label: string;
  readonly title: string;
  readonly value: BlenderRnaCollectionValue;
  readonly identifier: string;
  readonly onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const names = value.names ?? [];
  return (
    <>
      <Row label={label} title={title} readonly={false} identifier={identifier}>
        <button
          type="button"
          aria-label={label}
          onClick={() => (names.length ? setOpen(!open) : onOpen())}
          style={{ ...fieldStyle, cursor: 'pointer', textAlign: 'left' }}
        >
          {names.length ? `${open ? '▼' : '▶'} ` : ''}
          {value.count} {value.count === 1 ? 'item' : 'items'}
        </button>
      </Row>
      {open
        ? names.map((name) => (
            <Row key={name} label="" readonly>
              <StaticValue>{name}</StaticValue>
            </Row>
          ))
        : null}
    </>
  );
}

// ---- the curated body ------------------------------------------------------

/**
 * ONE OF BLENDER'S OWN PANELS, as data.
 *
 * A tab module declares a list of these and the view draws them ABOVE the
 * generic RNA view, which stays beneath under "All properties". The list is a
 * transcription of the matching `scripts/startup/bl_ui/properties_*.py`:
 * `bl_label` is the title, each `layout.prop(ob, "x")` is an entry of
 * {@link properties} IN BLENDER'S ORDER, and a `bl_parent_id` panel is a
 * {@link sub}. Blender's UI layer is never run, ported or recorded
 * (ARCHITECTURE-CORE §Blender north star) — the Python file is read as the
 * SPECIFICATION of which properties this tab shows and in what order, and
 * what draws them is this file's own widgets over the RNA door's rows.
 *
 * WHAT IS DELIBERATELY NOT TRANSCRIBED: the `poll`/`if` conditions Blender's
 * draw functions carry. A `properties_object.py` panel hides
 * `show_all_edges` for a non-mesh by branching in Python; here the property is
 * simply NOT ON the datablock RNA answered with, so it does not render and
 * the panel header says how many of Blender's it found. That is the same
 * outcome by a mechanism that cannot go stale — a transcribed condition is a
 * copy of Blender's logic, which is the one thing the ruling forbids.
 */
/**
 * ONE ENTRY OF A PANEL'S PROPERTY LIST.
 *
 * A bare identifier reads the panel's own datablock, which is the ordinary
 * case. The qualified form is for the panels where BLENDER'S OWN draw
 * function reads two structs into one list — `RENDER_PT_eevee_raytracing`
 * (`properties_render.py:387`) draws `scene.eevee`'s `use_raytracing` and
 * `ray_tracing_method` beside `scene.eevee.ray_tracing_options`'s
 * `resolution_scale`, in that order, in one panel. Keeping the row in
 * Blender's position while naming the datablock it actually comes from is
 * what this is for; the alternative — a nested block per struct — would put
 * the rows in an order Blender does not use.
 */
export type BlenderCuratedProperty = string | { readonly from: string; readonly property: string };

const identifierOf = (entry: BlenderCuratedProperty): string =>
  typeof entry === 'string' ? entry : entry.property;

/** ONE TEST A BLENDER `poll` MAKES ON A VALUE ({@link BlenderCuratedPanel.when}). */
export interface BlenderPanelCondition {
  /** Which of the tab's datablocks holds it, by the label `rna_context` gave
   *  it. The panel's own `from` when omitted. */
  readonly from?: string;
  readonly property: string;
  /** The values Blender's `poll` accepts. */
  readonly is?: readonly (string | number | boolean)[];
  /** …or the ones it refuses (`part.child_type != 'NONE'`). */
  readonly isNot?: readonly (string | number | boolean)[];
}

export interface BlenderCuratedPanel {
  readonly title: string;
  /** Which of the TAB's own datablocks this panel reads, by the label
   *  `session.py::rna_context` gave it ("Object", "Object Data", "Vertex
   *  Groups"…). The tab's first path when omitted. */
  readonly from?: string;
  /** RNA identifiers, in the order Blender's own draw function lists them. */
  readonly properties: readonly BlenderCuratedProperty[];
  /** Blender's `bl_options = {'DEFAULT_CLOSED'}`. */
  readonly closed?: boolean;
  /** A `bl_parent_id` child panel. */
  readonly sub?: readonly BlenderCuratedPanel[];
  /**
   * THE DATABLOCK IS A COLLECTION, and the panel is Blender's `template_list`
   * over it — the Vertex Groups, Shape Keys, UV Maps and Material Slots
   * panels are all this shape. Each member becomes its own sub-panel of
   * {@link properties}, and the member the context calls ACTIVE is marked, the
   * way Blender's list highlights the active row.
   */
  readonly collection?: boolean;
  /**
   * AND THEN EVERYTHING THE MEMBER'S OWN STRUCT DECLARES, after the named
   * properties, in RNA's order.
   *
   * It exists for the modifier stack and its siblings, where Blender draws a
   * per-TYPE panel: `properties_data_modifier.py` delegates to one draw
   * function per modifier type, sixty-odd of them, each listing that type's
   * own properties. Transcribing sixty lists is not a reading of the source,
   * it is a copy of it — and RNA already says which struct declares each
   * property (`BlenderRnaRow.group`), so "the type's own settings" is exactly
   * the rows whose declaring struct is the member's own
   * (`SubsurfModifier`, `ArmatureModifier`), with the shared `Modifier` base
   * named above them. Derived, and it cannot go stale.
   */
  readonly andDeclared?: boolean;
  /**
   * BLENDER'S `COMPAT_ENGINES`, the one `poll` that IS transcribed.
   *
   * Every other `poll` is dropped because RNA already answers it: a property
   * a type does not carry is simply not in the door's rows, so the panel does
   * not draw (see the note above). The engine polls are the exception that
   * proves the rule — `scene.eevee` and `scene.display` exist under EVERY
   * engine, so nothing about the datablock says whether Blender would draw
   * the panel. The condition is `context.engine in cls.COMPAT_ENGINES`
   * (`properties_render.py`, once per panel class), and what is read here is
   * the ENGINE's own answer to it: `rna_context`'s `engine`, which is
   * `scene.render.engine`. Not a copy of Blender's logic — a copy of
   * Blender's LIST, checked against the engine's live value.
   */
  readonly engine?: readonly string[];
  /**
   * A `poll` THAT TESTS A VALUE, for the same reason: `part.physics_type ==
   * 'BOIDS'`, `tex.type == 'CLOUDS'`, `rbo.type == 'ACTIVE'`. These panels
   * are about a MODE the datablock is in, and every mode's properties live on
   * the same struct, so RNA cannot answer it either. Each condition names a
   * property of one of the tab's datablocks and the values Blender's own
   * `poll` accepts; all of them must hold. A condition whose datablock has
   * not been read yet holds the panel back rather than guessing.
   */
  readonly when?: readonly BlenderPanelCondition[];
  /** Which of the context's active handles marks a row of this collection —
   *  `activeVertexGroup`, `activeMaterial`, `activeModifier`,
   *  `activeShapeKey`, `activeConstraint`, `activeParticleSystem`,
   *  `activeBone`. Read only with {@link collection}. */
  readonly active?: keyof BlenderRnaContext;
}

/**
 * WHICH MEMBER OF THIS COLLECTION THE CONTEXT CALLS ACTIVE — by address when
 * RNA gives the member one, and by INDEX when it does not.
 *
 * The index half is not a convenience, it is the only answer for two of the
 * three lists that need one, and the live walk is what said so (2026-09-19):
 * a `VertexGroup` has no `path_from_id()` at all — I1 recorded that — so
 * `activeVertexGroup` carries only its index, and `activeMaterial` carries the
 * MATERIAL's address while the list being drawn is of material SLOTS, so its
 * path never matches a row. Both marked nothing. `rna_context` reports
 * `index` for exactly those two (`session.py::rna_context`), which is what
 * Blender's own `template_list` highlights by.
 */
function activeMember(panel: BlenderCuratedPanel): { path: string | null; index: number | null } {
  if (panel.active === undefined) return { path: null, index: null };
  const handle = blenderPropertiesState().context?.[panel.active];
  if (typeof handle !== 'object' || handle === null) return { path: null, index: null };
  const record = handle as { path?: string | null; index?: number };
  return {
    path: record.path ?? null,
    index: typeof record.index === 'number' ? record.index : null,
  };
}

function CuratedCollectionPanel({
  panel,
  path,
  onOpen,
}: {
  readonly panel: BlenderCuratedPanel;
  readonly path: string;
  readonly onOpen: (path: string) => void;
}) {
  useBlenderProperties();
  const view = blenderRnaViewFor(path);
  const active = activeMember(panel);
  if (view === undefined)
    return (
      <Panel title={panel.title} closed={panel.closed === true}>
        <div style={{ color: INK, opacity: READONLY_ALPHA, fontSize: FONT }}>Reading {path}…</div>
      </Panel>
    );
  if (view.kind !== 'collection')
    return (
      <Panel title={panel.title} closed={panel.closed === true} note={path}>
        <div style={{ color: ERROR_INK, fontSize: FONT }}>
          {path} is not a collection — this panel is declared `collection: true`.
        </div>
      </Panel>
    );
  return (
    <Panel title={panel.title} closed={panel.closed === true} note={path} count={view.count}>
      {view.items.length === 0 ? (
        <div style={{ color: INK, opacity: READONLY_ALPHA, fontSize: FONT }}>None</div>
      ) : null}
      {view.items.map((item, index) => (
        <Panel
          key={item.path ?? item.name ?? item.type}
          title={`${
            (item.path !== null && item.path === active.path) || index === active.index ? '● ' : ''
          }${item.name ?? item.type}`}
          sub
        >
          {item.path === null ? (
            <div style={{ color: INK, opacity: READONLY_ALPHA, fontSize: FONT }}>
              {item.type} — RNA gives this member no address.
            </div>
          ) : (
            <CuratedRows
              path={item.path}
              properties={panel.properties}
              andDeclared={panel.andDeclared === true}
              onOpen={onOpen}
            />
          )}
        </Panel>
      ))}
    </Panel>
  );
}

/** A named property list over one addressed struct — the body both curated
 *  panel shapes draw. */
function CuratedRows({
  path,
  properties,
  andDeclared = false,
  onOpen,
}: {
  readonly path: string;
  readonly properties: readonly BlenderCuratedProperty[];
  readonly andDeclared?: boolean;
  readonly onOpen: (path: string) => void;
}) {
  useBlenderProperties();
  const view = blenderRnaViewFor(path);
  if (view === undefined)
    return (
      <div style={{ color: INK, opacity: READONLY_ALPHA, fontSize: FONT }}>Reading {path}…</div>
    );
  const rows = view.kind === 'struct' ? view.groups.flatMap((group) => group.rows) : [];
  const byIdentifier = new Map(rows.map((row) => [row.identifier, row]));
  // A collection member is addressed by its own path, so a qualified entry is
  // read here as the identifier alone — the datablock it names belongs to the
  // TAB, and a member of a list is not one of those.
  const named = properties
    .map((entry) => byIdentifier.get(identifierOf(entry)))
    .filter((row): row is BlenderRnaRow => row !== undefined);
  // The member's OWN struct's rows — a `SubsurfModifier`'s, not the shared
  // `Modifier` base's, which the named list above carries.
  const declared =
    andDeclared && view.kind === 'struct'
      ? shown(rows).filter(
          (row) =>
            row.group === view.type &&
            !properties.some((entry) => identifierOf(entry) === row.identifier),
        )
      : [];
  return (
    <>
      {[...named, ...declared].map((row) => (
        <PropertyRow key={row.identifier} row={row} path={path} onOpen={onOpen} />
      ))}
    </>
  );
}

/**
 * DOES BLENDER'S `poll` STAND? Three answers, because "not yet read" is not
 * "no": `true` draw, `false` do not, `null` the engine has not answered yet.
 */
function panelStands(
  panel: BlenderCuratedPanel,
  paths: readonly { readonly label: string; readonly path: string }[],
): boolean | null {
  if (panel.engine !== undefined) {
    const engine = blenderPropertiesState().context?.engine;
    if (engine === undefined) return null;
    if (!panel.engine.includes(engine)) return false;
  }
  for (const condition of panel.when ?? []) {
    const label = condition.from ?? panel.from;
    const entry = label ? paths.find((item) => item.label === label) : paths[0];
    if (entry === undefined) return false;
    const view = blenderRnaViewFor(entry.path);
    if (view === undefined) return null;
    if (view.kind !== 'struct') return false;
    const row = view.groups
      .flatMap((group) => group.rows)
      .find((item) => item.identifier === condition.property);
    if (row === undefined) return false;
    const value = row.value;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
      return false;
    if (condition.is !== undefined && !condition.is.includes(value)) return false;
    if (condition.isNot !== undefined && condition.isNot.includes(value)) return false;
  }
  return true;
}

function CuratedPanel({
  panel,
  paths,
  onOpen,
}: {
  readonly panel: BlenderCuratedPanel;
  readonly paths: readonly { readonly label: string; readonly path: string }[];
  readonly onOpen: (path: string) => void;
}) {
  useBlenderProperties();
  if (panelStands(panel, paths) !== true) return null;
  const entry = panel.from ? paths.find((item) => item.label === panel.from) : paths[0];
  if (entry !== undefined && panel.collection === true)
    return <CuratedCollectionPanel panel={panel} path={entry.path} onOpen={onOpen} />;
  // A panel whose datablock this context does not carry is not drawn at all —
  // the same answer Blender's `poll` gives, from the door rather than from a
  // copy of its conditions.
  if (entry === undefined) return null;
  const view = blenderRnaViewFor(entry.path);
  const sub = panel.sub ?? [];
  // EACH ENTRY IS READ FROM THE DATABLOCK BLENDER READS IT FROM: the panel's
  // own, or the one a qualified entry names ({@link BlenderCuratedProperty}).
  // Order is Blender's list, whichever struct a row comes from.
  const found: { identifier: string; row: BlenderRnaRow; path: string }[] = [];
  const missing: string[] = [];
  for (const item of panel.properties) {
    const identifier = identifierOf(item);
    const where = typeof item === 'string' ? entry : paths.find((path) => path.label === item.from);
    const source = where === undefined ? undefined : blenderRnaViewFor(where.path);
    const row =
      source?.kind === 'struct'
        ? source.groups.flatMap((group) => group.rows).find((it) => it.identifier === identifier)
        : undefined;
    if (row === undefined || where === undefined) missing.push(identifier);
    else found.push({ identifier, row, path: where.path });
  }
  if (view === undefined)
    return (
      <Panel title={panel.title} closed={panel.closed === true}>
        <div style={{ color: INK, opacity: READONLY_ALPHA, fontSize: FONT }}>
          Reading {entry.path}…
        </div>
      </Panel>
    );
  if (found.length === 0 && sub.length === 0) return null;
  return (
    <Panel
      title={panel.title}
      closed={panel.closed === true}
      note={
        missing.length === 0
          ? `${entry.path}`
          : `${entry.path}\nNot on this datablock: ${missing.join(', ')}`
      }
    >
      {found.map((item) => (
        <PropertyRow key={item.identifier} row={item.row} path={item.path} onOpen={onOpen} />
      ))}
      {/* KEYED BY POSITION, NOT BY TITLE: Blender ships two panels with the
          same `bl_label` under different engines and expects the poll to pick
          one — Render's "Sampling" (EEVEE `:675`, Workbench `:1004`) and
          "Film" (`:757`, `:1025`), View Layer's "Data" (`:111`, `:137`). A
          title key made those React duplicates, which the live walk found by
          name ("Encountered two children with the same key"). */}
      {sub.map((child, index) => (
        <CuratedPanel key={`${index}:${child.title}`} panel={child} paths={paths} onOpen={onOpen} />
      ))}
    </Panel>
  );
}

// ---- one addressed datablock ----------------------------------------------

function DatablockView({
  path,
  onOpen,
}: {
  readonly path: string;
  readonly onOpen: (path: string) => void;
}) {
  useBlenderProperties();
  const view: BlenderRnaView | undefined = blenderRnaViewFor(path);
  if (view === undefined)
    return (
      <div style={{ color: INK, opacity: READONLY_ALPHA, fontSize: FONT, padding: PANEL_PAD }}>
        Reading {path}…
      </div>
    );
  if (view.kind === 'collection')
    return (
      <>
        {view.items.length === 0 ? (
          <div style={{ color: INK, opacity: READONLY_ALPHA, fontSize: FONT }}>
            {view.count === 0 ? 'None' : `${view.count} items`}
          </div>
        ) : null}
        {view.items.map((item) => (
          <Panel key={item.path ?? item.name ?? item.type} title={item.name ?? item.type} sub>
            {item.path === null ? (
              <div style={{ color: INK, opacity: READONLY_ALPHA, fontSize: FONT }}>
                {item.type} — RNA gives this member no address.
              </div>
            ) : (
              <DatablockView path={item.path} onOpen={onOpen} />
            )}
          </Panel>
        ))}
      </>
    );
  return (
    <>
      {view.groups.map((group) => {
        const rows = shown(group.rows);
        if (rows.length === 0) return null;
        return (
          <Panel key={group.id} title={group.label} sub>
            {rows.map((row) => (
              <PropertyRow key={row.identifier} row={row} path={view.path} onOpen={onOpen} />
            ))}
          </Panel>
        );
      })}
    </>
  );
}

// ---- the section body ------------------------------------------------------

/**
 * ONE PROPERTIES TAB'S BODY. `tabId` names the tab this section IS; the
 * context door says which datablocks that tab shows and in what order
 * (`session.py::rna_context`, mirrored from `buttons_context.cc`).
 *
 * A pointer row DRILLS: clicking it replaces the shown datablock with the
 * target, and the breadcrumb walks back. That is the "pointer → the target's
 * name as a link that changes the active datablock" half of I1, and it is what
 * makes `object.data.materials[0].node_tree` reachable with no per-tab code.
 */
export function BlenderPropertiesSection({
  tabId,
  subject,
  curated = [],
}: {
  readonly tabId: string;
  readonly subject: BlenderSubject;
  /** Blender's own panels for this tab, in Blender's order
   *  ({@link BlenderCuratedPanel}). Empty — the tab has not been curated yet —
   *  and the generic view is the whole body, uncollapsed. */
  readonly curated?: readonly BlenderCuratedPanel[];
}) {
  useBlenderProperties();
  useEffect(() => showBlenderSubject(subject), [subject]);
  const [drill, setDrill] = useState<string[]>([]);
  const state = blenderPropertiesState();
  const tab = state.context?.tabs.find((entry) => entry.id === tabId) ?? null;

  // A drill belongs to the datablock it was opened from; a new subject or a
  // tab whose paths moved starts at the top again.
  const paths = tab?.paths ?? [];
  const anchor = paths.map((entry) => entry.path).join('|');
  useEffect(() => setDrill([]), [anchor]);

  if (state.error !== null)
    return (
      <div style={{ color: ERROR_INK, fontSize: FONT, padding: PANEL_PAD }}>{state.error}</div>
    );
  if (tab === null)
    return (
      <div style={{ color: INK, opacity: READONLY_ALPHA, fontSize: FONT, padding: PANEL_PAD }}>
        {state.loading ? 'Reading the engine…' : 'Blender shows no properties here.'}
      </div>
    );

  const open = (path: string) => setDrill((held) => [...held, path]);
  const drilled = drill[drill.length - 1];

  return (
    <div style={{ padding: `${PANEL_PAD}px 0` }}>
      {drill.length > 0 ? (
        <button
          type="button"
          onClick={() => setDrill((held) => held.slice(0, -1))}
          style={{
            ...fieldStyle,
            width: 'auto',
            marginBottom: PANEL_PAD,
            cursor: 'pointer',
            textAlign: 'left',
          }}
          title={drilled}
        >
          {'← '}
          {tab.label}
        </button>
      ) : null}
      {drilled !== undefined ? (
        <Panel title={drilled.slice(drilled.lastIndexOf('.') + 1)}>
          <DatablockView path={drilled} onOpen={open} />
        </Panel>
      ) : (
        <>
          {curated.map((panel, index) => (
            // Position, not title — see the note on the sub-panel map above.
            <CuratedPanel
              key={`${index}:${panel.title}`}
              panel={panel}
              paths={paths}
              onOpen={open}
            />
          ))}
          {/* THE GENERIC VIEW STAYS BENEATH. A curated body is Blender's own
              panels, which are a SELECTION of the datablock's RNA — the rest
              of it is still the same data and still worth reading, so it sits
              here collapsed rather than being hidden. On an uncurated tab
              there is nothing above and this is simply the body, open. */}
          {curated.length > 0 ? (
            <Panel title="All properties" closed>
              {paths.map((entry) => (
                <Panel key={entry.path} title={entry.label} sub>
                  <DatablockView path={entry.path} onOpen={open} />
                </Panel>
              ))}
            </Panel>
          ) : (
            paths.map((entry) => (
              <Panel key={entry.path} title={entry.label}>
                <DatablockView path={entry.path} onOpen={open} />
              </Panel>
            ))
          )}
        </>
      )}
    </div>
  );
}
