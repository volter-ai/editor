import { Button } from '../design-system';
/**
 * AlignmentGrid — a 3×3 flex `justify-content`×`align-items` picker (spec 27
 * §5 C1). Ported from `visual-edit/inspector.tsx`'s `AlignmentGrid`
 * (:304-351). `AnchorPresets` below REUSES the existing `ui-editor/
 * inspector.tsx` `ANCHOR_PRESETS` table's VALUES (now exported there for
 * this reuse) as a data-only copy — not a live import — because
 * `ui-editor/inspector.tsx` pulls in `UIEditStore`/`react-store`/
 * `node-ops`/the inspector-section-registry (a whole editing-mode runtime
 * graph this pure, adapter-free widget kit must not drag in, Rule zero's
 * "talk ONLY to the AuthoringAdapter contract" spirit extended to "don't
 * import a store-coupled module just for one constant"). Keep this table in
 * sync with `ui-editor/inspector.tsx`'s `ANCHOR_PRESETS` if either changes —
 * C2's wiring step is the natural point to collapse them into one shared,
 * dependency-free `anchor-presets.ts` module both sides import.
 */

import { type ChangeHandlers, THEME } from './shared';

const ANCHOR_PRESETS: Record<
  string,
  { anchor: AnchorRect['anchor']; offset: AnchorRect['offset'] }
> = {
  full: {
    anchor: { left: 0, top: 0, right: 1, bottom: 1 },
    offset: { left: 0, top: 0, right: 0, bottom: 0 },
  },
  top: {
    anchor: { left: 0, top: 0, right: 1, bottom: 0 },
    offset: { left: 0, top: 0, right: 0, bottom: 0 },
  },
  bottom: {
    anchor: { left: 0, top: 1, right: 1, bottom: 1 },
    offset: { left: 0, top: 0, right: 0, bottom: 0 },
  },
  left: {
    anchor: { left: 0, top: 0, right: 0, bottom: 1 },
    offset: { left: 0, top: 0, right: 0, bottom: 0 },
  },
  right: {
    anchor: { left: 1, top: 0, right: 1, bottom: 1 },
    offset: { left: 0, top: 0, right: 0, bottom: 0 },
  },
  center: {
    anchor: { left: 0.5, top: 0.5, right: 0.5, bottom: 0.5 },
    offset: { left: -60, top: -20, right: 60, bottom: 20 },
  },
  'top-left': {
    anchor: { left: 0, top: 0, right: 0, bottom: 0 },
    offset: { left: 0, top: 0, right: 120, bottom: 40 },
  },
  'top-right': {
    anchor: { left: 1, top: 0, right: 1, bottom: 0 },
    offset: { left: -120, top: 0, right: 0, bottom: 40 },
  },
};

const JUSTIFY = ['flex-start', 'center', 'flex-end'] as const;
const ALIGN = ['flex-start', 'center', 'flex-end'] as const;

export interface AlignmentValue {
  justify: (typeof JUSTIFY)[number];
  align: (typeof ALIGN)[number];
}

/** One 3×3 dot — split out of `AlignmentGrid`'s double `.map` purely to keep
 *  each function under biome's cognitive-complexity ceiling; same markup. */
function AlignmentCell({
  row,
  col,
  justify,
  align,
  isActive,
  disabled,
  onSelect,
}: {
  row: number;
  col: number;
  justify: AlignmentValue['justify'];
  align: AlignmentValue['align'];
  isActive: boolean;
  disabled?: boolean | undefined;
  onSelect: (justify: AlignmentValue['justify'], align: AlignmentValue['align']) => void;
}): React.ReactElement {
  return (
    <div
      data-testid={`alignment-grid-${row}-${col}`}
      onClick={() => {
        if (!disabled) onSelect(justify, align);
      }}
      style={{
        width: 16,
        height: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        borderRadius: THEME.radiusSmall,
        background: isActive ? THEME.accent : 'transparent',
      }}
    >
      <div
        style={{
          width: isActive ? 6 : 4,
          height: isActive ? 6 : 4,
          borderRadius: '50%',
          background: isActive ? THEME.onAccent : THEME.textMuted,
        }}
      />
    </div>
  );
}

export function AlignmentGrid({
  value,
  onChange,
  disabled,
}: ChangeHandlers<AlignmentValue>): React.ReactElement {
  const jIdx = JUSTIFY.indexOf(value.justify);
  const aIdx = ALIGN.indexOf(value.align);

  return (
    <div
      data-testid="alignment-grid"
      style={{
        display: 'inline-grid',
        gridTemplateColumns: 'repeat(3, 16px)',
        gridTemplateRows: 'repeat(3, 16px)',
        gap: 1,
        background: THEME.inputBg,
        borderRadius: THEME.radiusMedium,
        padding: 4,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      {ALIGN.map((a, row) =>
        JUSTIFY.map((j, col) => (
          <AlignmentCell
            key={`${row}-${col}`}
            row={row}
            col={col}
            justify={j}
            align={a}
            isActive={row === aIdx && col === jIdx}
            disabled={disabled}
            onSelect={(justify, align) => onChange({ justify, align })}
          />
        )),
      )}
    </div>
  );
}

export interface AnchorRect {
  anchor: { left: number; top: number; right: number; bottom: number };
  offset: { left: number; top: number; right: number; bottom: number };
}

export interface AnchorPresetsProps {
  onSelect: (name: string, preset: AnchorRect) => void;
  disabled?: boolean | undefined;
}

export function AnchorPresets({ onSelect, disabled }: AnchorPresetsProps): React.ReactElement {
  return (
    <div data-testid="anchor-presets" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {Object.entries(ANCHOR_PRESETS).map(([name, preset]) => (
        <Button
          key={name}
          type="button"
          variant="secondary"
          size="compact"
          data-testid={`anchor-preset-${name}`}
          disabled={disabled}
          onClick={() => onSelect(name, preset)}
        >
          {name}
        </Button>
      ))}
    </div>
  );
}
