import { FieldGroup, FieldRow, NumberInput, Text } from '@volter/editor-sdk/widgets';
import type { Transform, TransformChannel } from '@volter/editor-project/adapter';
import { useRef, useState } from 'react';
import { rotationDegrees, type TransformAxis, withRotationDegrees } from './inspector-transform';

/** The industry-convention axis tint (X red, Y green, Z blue) — muted to the
 *  panel's palette. A first-time tester reported the three unlabeled number
 *  boxes made "Position X" unguessable (runhuman, 2026-08-27); the aria-label
 *  alone labels nothing a sighted user can see. */
const AXIS_COLORS: Record<string, string> = { x: '#e0726d', y: '#83bd66', z: '#6390dd' };

/**
 * One row of axis fields, each the editor's shared scrub field (`NumberInput`):
 * drag to scrub, click to type with the whole value selected, commit on
 * Enter/blur. This used to be three native `<input type="number">`s committing
 * on EVERY keystroke — so typing "10" wrote 1 and then 10 (two source writes,
 * two remounts, the second re-rendering the field mid-word: "it didn't give me
 * time to type", runhuman pass 128), and a click landing on the native spinner
 * bumped the value by one before the author typed anything (measured on the
 * GPU instrument: click a field showing -5, type -7 → -47; double-click, type
 * -9 → -459 — runhuman passes 122 and 127's "everything's there, just not
 * where I wanted it").
 *
 * The three callbacks are ONE gesture shape for both scrub and typing: the
 * first change opens it (`onBegin`), every change previews (`onPreview`), the
 * release/Enter commits (`onCommit`) — the same begin/apply/end the gizmo
 * drives, so a scrub is one undo step and one source write.
 */
function AxisRow({
  axes,
  label,
  values,
  testidPrefix,
  step,
  precision,
  onBegin,
  onPreview,
  onCommit,
  readOnly,
  readOnlyReason,
}: {
  readonly axes: Array<{ axis: TransformAxis; name: string }>;
  readonly label: string;
  readonly values: [number, number, number];
  readonly testidPrefix: string;
  readonly step: number;
  readonly precision: number;
  readonly onBegin: (() => void) | undefined;
  readonly onPreview: ((axis: TransformAxis, value: number) => void) | undefined;
  readonly onCommit: (axis: TransformAxis, value: number) => void;
  readonly readOnly: boolean;
  readonly readOnlyReason?: string;
}) {
  // The value under the hand while a gesture is open: the projection's
  // `values` follow the adapter's own notifications, which need not arrive
  // per scrub move, and a field that lags its own drag reads as stuck.
  const [live, setLive] = useState<{ axis: TransformAxis; value: number } | null>(null);
  const gestureOpen = useRef(false);
  return (
    <FieldRow label={label} style={{ padding: '4px 8px' }}>
      {axes.map(({ axis, name }) => (
        <NumberInput
          key={name}
          testId={`${testidPrefix}-${name}`}
          label={name}
          labelColor={AXIS_COLORS[name]}
          // The reason shows whether or not the field is disabled. A `reason`
          // does not imply `writable: false`: the ingest adapter declares a
          // WRITABLE channel whose reason states that the edit is live-only and
          // names the source line it would have to be written to.
          title={readOnlyReason}
          disabled={readOnly}
          step={step}
          precision={precision}
          value={
            live?.axis === axis ? live.value : Number.isFinite(values[axis]) ? values[axis] : 0
          }
          style={{ flex: 1, minWidth: 0 }}
          onChange={(value) => {
            if (!gestureOpen.current) {
              gestureOpen.current = true;
              onBegin?.();
            }
            setLive({ axis, value });
            onPreview?.(axis, value);
          }}
          onChangeEnd={(value) => {
            gestureOpen.current = false;
            setLive(null);
            onCommit(axis, value);
          }}
        />
      ))}
    </FieldRow>
  );
}

export function InspectorTransformSection({
  dimensions = '3d',
  transform,
  readOnly = false,
  channelEditability,
  note,
  onBegin,
  onPreview,
  onCommit,
}: {
  readonly dimensions?: '2d' | '3d';
  readonly transform: Transform;
  readonly readOnly?: boolean;
  readonly channelEditability?: Partial<
    Record<TransformChannel, { writable: boolean; reason?: string }>
  >;
  /**
   * A sentence about what editing THESE numbers does, when that is not what a
   * reader would assume — today the world-anchored instanced class
   * (`instanced-presentation.ts`), whose container transform offsets future
   * placements rather than moving the content already on screen.
   *
   * It is a visible line rather than a `title` like the per-channel reasons
   * above, because it is not a refusal to explain on hover: the channels are
   * writable and the surprise arrives after the write.
   */
  readonly note?: string | undefined;
  /** A gesture is opening — the adapter's `beginEdit` (one undo step, one
   *  write, however many previews follow). Optional: a caller with no live
   *  path gets `onCommit` alone, which is a complete gesture by itself. */
  readonly onBegin?: () => void;
  /** The value under the hand mid-gesture — the adapter's live `apply`,
   *  never a write. */
  readonly onPreview?: (transform: Transform) => void;
  /** The gesture's end — the adapter's `endEdit`, the one write. */
  readonly onCommit: (transform: Transform) => void;
}) {
  const xyAxes: Array<{ axis: TransformAxis; name: string }> = [
    { axis: 0, name: 'x' },
    { axis: 1, name: 'y' },
  ];
  const xyzAxes: Array<{ axis: TransformAxis; name: string }> = [...xyAxes, { axis: 2, name: 'z' }];
  const withVector = (axis: TransformAxis, key: 'position' | 'scale', value: number) => {
    const next: Transform = {
      position: [...transform.position] as [number, number, number],
      rotation: [...transform.rotation] as [number, number, number, number],
      scale: [...transform.scale] as [number, number, number],
    };
    next[key][axis] = value;
    return next;
  };
  const vector =
    (key: 'position' | 'scale', deliver: ((transform: Transform) => void) | undefined) =>
    (axis: TransformAxis, value: number) => {
      if (Number.isFinite(value)) deliver?.(withVector(axis, key, value));
    };
  const rotation =
    (deliver: ((transform: Transform) => void) | undefined) =>
    (axis: TransformAxis, value: number) => {
      if (Number.isFinite(value)) deliver?.(withRotationDegrees(transform, axis, value));
    };
  const channelState = (channel: TransformChannel) => {
    const state = channelEditability?.[channel];
    const channelReadOnly = readOnly || state?.writable === false;
    return state?.reason
      ? { readOnly: channelReadOnly, readOnlyReason: state.reason }
      : { readOnly: channelReadOnly };
  };
  // A GRAYED FIELD SAYS WHY WHERE THE EYE IS. The reason used to live only in
  // the field's hover title, so a tester who dropped a self-placing prefab
  // met "the Position X field is grayed out and uneditable" and concluded the
  // test could not continue (runhuman pass 130) — the sentence that would
  // have sent them to the component's own code was one hover away. Each
  // distinct reason of a read-only channel is printed once, below the rows.
  const readOnlyReasons = [
    ...new Set(
      (['position', 'rotation', 'scale'] as const)
        .map((channel) => channelState(channel))
        .filter((state) => state.readOnly && state.readOnlyReason)
        .map((state) => state.readOnlyReason as string),
    ),
  ];

  // No header of its own: the PROJECTION heads every section with its title
  // and icon (`components/InspectionProjection.tsx`), so a "Transform" title
  // printed here would be the second one on screen.
  return (
    <FieldGroup>
      <AxisRow
        axes={dimensions === '2d' ? xyAxes : xyzAxes}
        label="Position"
        testidPrefix="ingest-position"
        values={transform.position}
        step={0.1}
        precision={3}
        {...channelState('position')}
        onBegin={onBegin}
        onPreview={onPreview && vector('position', onPreview)}
        onCommit={vector('position', onCommit)}
      />
      <AxisRow
        axes={dimensions === '2d' ? [{ axis: 2, name: 'z' }] : xyzAxes}
        label={dimensions === '2d' ? 'Rotation (degrees)' : 'Rotation'}
        testidPrefix="ingest-rotation"
        values={rotationDegrees(transform.rotation)}
        step={1}
        precision={1}
        {...channelState('rotation')}
        onBegin={onBegin}
        onPreview={onPreview && rotation(onPreview)}
        onCommit={rotation(onCommit)}
      />
      <AxisRow
        axes={dimensions === '2d' ? xyAxes : xyzAxes}
        label="Scale"
        testidPrefix="ingest-scale"
        values={transform.scale}
        step={0.01}
        precision={3}
        {...channelState('scale')}
        onBegin={onBegin}
        onPreview={onPreview && vector('scale', onPreview)}
        onCommit={vector('scale', onCommit)}
      />
      {readOnlyReasons.map((reason) => (
        <Text
          key={reason}
          data-testid="inspector-transform-readonly-reason"
          variant="caption"
          tone="muted"
          style={{ display: 'block', padding: '4px 8px', overflowWrap: 'anywhere' }}
        >
          {reason}
        </Text>
      ))}
      {note && (
        <Text
          data-testid="inspector-transform-note"
          variant="caption"
          tone="muted"
          style={{ display: 'block', padding: '4px 8px', overflowWrap: 'anywhere' }}
        >
          {note}
        </Text>
      )}
    </FieldGroup>
  );
}
