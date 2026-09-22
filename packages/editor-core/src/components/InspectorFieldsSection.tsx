/**
 * The ONE renderer for an inspection section whose body is `kind: 'fields'`
 * (`inspection/model.ts`) — a `FieldDescriptor` list plus the io that reads
 * and writes it. Extracted verbatim from `components/Inspector.tsx`'s former
 * inline `renderProperty`, so the stacked column and the compact card render
 * a field identically: one per-`type` switch, one revert arrow rule, one
 * testid rule.
 *
 * Chrome (a collapsible title, a group's `data-testid`) belongs to the
 * PROJECTION, not here — this component renders rows and nothing else.
 */

import { faRotateLeft } from '@fortawesome/free-solid-svg-icons';
import {
  AssetSlotPicker,
  Checkbox,
  DraftTextInput,
  EditorIcon,
  IconButton,
  LABEL_COL_WIDTH,
  Select,
  TextArea,
  themeVars,
  Vec3Input,
} from '@volter/editor-sdk/widgets';
import { useState } from 'react';
import {
  type FieldDescriptor,
  fieldReadonlyReason,
  type InspectionFieldIo,
  isMixed,
} from '../inspection/model';
import { revertActionLabel } from './inspector-revert-label';
import { DraftColorInput } from './primitives/DraftColorInput';
import { useProjectImageAssets } from './use-project-image-assets';

/** Layout-only remnant of the old hand-rolled field style — chrome now comes
 *  from the shared `.vgai-input`/`.vgai-select` classes (theme.css), so
 *  every field here shares one height/padding/radius/focus treatment. */
const NUM_STYLE: React.CSSProperties = { width: 64 };

/** Row label (label-left/field-right grammar) — one width via
 *  `LABEL_COL_WIDTH` (I-13). */
export const ROW_LABEL_STYLE: React.CSSProperties = {
  width: LABEL_COL_WIDTH,
  fontSize: 'var(--vgai-font-md)',
  color: themeVars.content.muted,
};

/** One rule, no exceptions: `visible` used to get a hand-carved
 *  `ingest-visible` testid for an e2e spec that no longer exists. */
function testidFor(path: string): string {
  return `ingest-prop-${path.replace(/\./g, '-')}`;
}

/**
 * The `asset` row's control — a project-asset slot (a material's texture map).
 *
 * Its own component because it holds two things a stateless row cannot: the
 * shared project-image scan, and WHAT THE LAST ASSIGNMENT ANSWERED. The second
 * is the point — a slot whose live half worked and whose file half did not is
 * indistinguishable from a saved edit unless the ack is shown, so the write
 * pipe's `persisted: false` is rendered here rather than dropped on the floor.
 */
function AssetFieldControl({
  field,
  io,
  value,
}: {
  readonly field: FieldDescriptor;
  readonly io: InspectionFieldIo;
  readonly value: string;
}) {
  const { paths, failures } = useProjectImageAssets(true);
  // The ack is remembered WITH the value it answered for. A row is reused as
  // the selection moves between subjects that both publish this path, so an
  // ack held on its own would go on claiming "not saved" about an edit made to
  // something else — the exact confusion the note exists to prevent.
  const [ack, setAck] = useState<{ readonly forValue: string; readonly text: string } | null>(null);
  const assign = (next: string): void => {
    setAck(null);
    // An empty selection CLEARS the slot; `null` is the value an adapter reads
    // as "no asset", not the empty string, which would be a path of length 0.
    void Promise.resolve(io.set(field.path, next === '' ? null : next)).then((answer) => {
      setAck(
        answer && !answer.persisted
          ? {
              forValue: next,
              text: `Not saved — ${answer.destination}. See the editor console for the mechanism.`,
            }
          : null,
      );
    });
  };
  const ackNote = ack?.forValue === value ? ack.text : undefined;
  const scanNote =
    failures.length > 0
      ? `${failures.length} folder(s) under public/ could not be read — this list may be incomplete.`
      : undefined;
  return (
    <AssetSlotPicker
      testId={testidFor(field.path)}
      value={value}
      options={paths}
      previewUrlFor={(path) => `/${path}`}
      disabled={field.readonly}
      note={ackNote ?? scanNote}
      onChange={assign}
    />
  );
}

export function InspectorField({
  field,
  io,
}: {
  readonly field: FieldDescriptor;
  readonly io: InspectionFieldIo;
}) {
  const p = field;
  const raw = io.get(p.path);
  // MIXED means "these subjects disagree" — there is no single value to show,
  // which is exactly the blank/placeholder rendering an unset field already
  // has. Normalized once, here, so no field widget below carries a second
  // notion of emptiness.
  const v = isMixed(raw) ? undefined : raw;
  // UNSET: the document does not carry this property AND nobody could tell us
  // what governs it in absence (a library component's defaults live in its
  // implementation, not its type). Render it as genuinely blank — a `0` in a
  // number field or an unchecked box would be a claim about the value, and
  // `gravityScale` actually defaults to 1, `canSleep` to true. The field is
  // still editable: typing into it writes the property for the first time.
  const unset = p.defaulted === true && v === undefined;
  const readonlyReason = p.readonly ? fieldReadonlyReason(p) : undefined;
  /** The revert arrow, rendered only on rows the adapter says can lose their
   *  override. Occupies no space otherwise, so rows stay aligned. */
  const revertButton = p.resettable ? (
    <IconButton
      data-testid={`ingest-revert-${p.path.replace(/\./g, '-')}`}
      aria-label={revertActionLabel(p)}
      title={revertActionLabel(p)}
      onClick={() => io.remove?.(p.path)}
    >
      <EditorIcon icon={faRotateLeft} />
    </IconButton>
  ) : null;

  if (p.type === 'boolean') {
    return (
      <label
        title={readonlyReason}
        style={{
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          padding: '6px 8px',
          fontSize: 'var(--vgai-font-md)',
        }}
      >
        <Checkbox
          data-testid={testidFor(p.path)}
          checked={Boolean(v)}
          // Indeterminate says "not set here" without claiming false.
          ref={(el: HTMLInputElement | null) => {
            if (el) el.indeterminate = unset;
          }}
          disabled={p.readonly}
          onChange={(e) => io.set(p.path, e.target.checked)}
        />
        <span style={p.defaulted ? { color: themeVars.content.dim } : undefined}>{p.label}</span>
        {revertButton}
      </label>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px' }}>
      {/* A defaulted row is greyed: the value is the owner's declared
          default, not something this document says. Editing it writes the
          property in for the first time. */}
      <span
        style={p.defaulted ? { ...ROW_LABEL_STYLE, color: themeVars.content.dim } : ROW_LABEL_STYLE}
        title={readonlyReason ?? (p.defaulted ? `${p.label} — default (not set here)` : p.label)}
      >
        {p.label}
      </span>
      {p.type === 'color' ? (
        <DraftColorInput
          data-testid={p.path === 'material.color' ? 'ingest-color' : testidFor(p.path)}
          value={(v as string) ?? '#ffffff'}
          disabled={p.readonly}
          onCommit={(next) => io.set(p.path, next)}
          // Live while the picker is open (adapters that cannot show a value
          // without writing it omit `preview`, and this is a no-op).
          onPreview={(next) => io.preview?.(p.path, next)}
        />
      ) : p.type === 'number' ? (
        <DraftTextInput
          type="number"
          data-testid={testidFor(p.path)}
          disabled={p.readonly}
          value={typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : ''}
          placeholder={unset ? '—' : undefined}
          onCommit={(text) => {
            const parsed = Number.parseFloat(text);
            if (Number.isFinite(parsed)) io.set(p.path, parsed);
          }}
          style={NUM_STYLE}
        />
      ) : p.type === 'enum' ? (
        <Select
          data-testid={testidFor(p.path)}
          disabled={p.readonly}
          value={String(v ?? '')}
          onChange={(e) => {
            const value =
              p.options?.find((option) => String(option) === e.target.value) ?? e.target.value;
            io.set(p.path, value);
          }}
          style={{ width: 120 }}
        >
          {unset && <option value="">—</option>}
          {(p.options ?? []).map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </Select>
      ) : p.type === 'vec3' ? (
        <div style={{ width: 190 }}>
          <Vec3Input
            value={
              Array.isArray(v) && v.length === 3
                ? [Number(v[0]), Number(v[1]), Number(v[2])]
                : [null, null, null]
            }
            disabled={Boolean(p.readonly)}
            testIdPrefix={testidFor(p.path)}
            onChange={(value) => io.set(p.path, value)}
          />
        </div>
      ) : p.type === 'asset' ? (
        <AssetFieldControl field={p} io={io} value={typeof v === 'string' ? v : ''} />
      ) : p.type === 'json' ? (
        <TextArea
          key={`${p.path}:${JSON.stringify(v ?? null)}`}
          data-testid={testidFor(p.path)}
          data-variant="code"
          disabled={p.readonly}
          defaultValue={unset ? '' : JSON.stringify(v ?? null)}
          placeholder={unset ? '—' : undefined}
          onBlur={(event) => {
            try {
              io.set(p.path, JSON.parse(event.target.value));
            } catch {
              // Keep the authored value unchanged until the edit is valid JSON.
            }
          }}
          style={{ width: 160 }}
        />
      ) : (
        <DraftTextInput
          type="text"
          data-testid={testidFor(p.path)}
          readOnly={p.readonly}
          value={String(v ?? '')}
          placeholder={unset ? '—' : undefined}
          onCommit={(text) => io.set(p.path, text)}
          style={{ width: 120 }}
        />
      )}
      {revertButton}
    </div>
  );
}

export function InspectorFieldsSection({
  fields,
  io,
}: {
  readonly fields: readonly FieldDescriptor[];
  readonly io: InspectionFieldIo;
}) {
  return (
    <>
      {fields.map((field) => (
        <InspectorField key={field.path} field={field} io={io} />
      ))}
    </>
  );
}
