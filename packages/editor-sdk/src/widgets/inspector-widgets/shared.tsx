import { Button } from '../design-system';
/**
 * Shared theme + tiny primitives for the inspector widget kit (spec 27 §5
 * C1). Values are now sourced from `../../theme.ts` (editor-style-polish
 * U0) — the editor's single canonical token module — rather than
 * independently retyped here, which is how this kit's accent had drifted
 * from the app's semantic accent (C-2).
 * `THEME.accent` now follows whichever palette is composed with the active
 * material. `FONT` also drops
 * `'Inter'` (never loaded anywhere — 0 `@font-face` hits — so it only ever
 * silently fell back to its own fallback chain, per finding I-29); `FONT`/
 * `FONT_MONO` now resolve through the editor theme variables. Interactive
 * controls themselves come from the canonical design-system primitives so
 * this helper module cannot create a competing inline paint recipe.
 */

import type React from 'react';
import { themeVars } from '../design-system';

export const THEME = {
  bg: themeVars.surface.panel,
  surface: themeVars.surface.chrome,
  surfaceHover: themeVars.surface.raised,
  border: themeVars.boundary.default,
  text: themeVars.content.primary,
  textMuted: themeVars.content.muted,
  onAccent: themeVars.content.onAccent,
  accent: themeVars.accent.default,
  neutralHover: themeVars.neutralOverlay.hover,
  radiusSmall: themeVars.shape.small,
  radiusMedium: themeVars.shape.medium,
  inputBg: themeVars.surface.inset,
  dynamic: themeVars.semantic.dynamic,
  dynamicBg: themeVars.semantic.dynamicMuted,
} as const;

export const FONT = themeVars.typography.sans;
export const FONT_MONO = themeVars.typography.mono;

/**
 * Every widget's change contract (report §"prop shape" for the C2 wiring
 * step): `onChange` fires on every interaction tick (drag/scrub/keystroke —
 * the LIVE PREVIEW a caller can apply immediately, mirroring `boxEdit.apply`/
 * `inspector.set`'s optimistic echo, T0 §2/A4); `onChangeEnd` fires once per
 * gesture (pointerup/blur/Enter — the COMMIT a caller should push through
 * `writeStyleAuto`/`inspector.set` as a single undo step, mirroring
 * `BoxEditProvider.end`). A caller that only cares about single-shot edits
 * (a `<Select>`, a click) may omit `onChangeEnd` — widgets fall back to
 * treating `onChange` as the commit in that case.
 */
export interface ChangeHandlers<T> {
  value: T;
  onChange: (value: T) => void;
  onChangeEnd?: ((value: T) => void) | undefined;
  disabled?: boolean | undefined;
}

export function fireChange<T>(handlers: Pick<ChangeHandlers<T>, 'onChange'>, value: T): void {
  handlers.onChange(value);
}

export function fireEnd<T>(
  handlers: Pick<ChangeHandlers<T>, 'onChange' | 'onChangeEnd'>,
  value: T,
): void {
  (handlers.onChangeEnd ?? handlers.onChange)(value);
}

export const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4 };

/* ------------------------------------------------------------------------ */
/* Inspector-section style kit (editor-style-polish U3, I-8/I-10/I-12/I-13/  */
/* I-17/I-22) — the ONE home for the style objects the first-party sections  */
/* used to hand-duplicate ~15 times each with tiny unintentional drift.      */
/* ------------------------------------------------------------------------ */

/** Stacked field label ("label on its own line, field below" grammar) —
 *  replaces the `{fontSize:10, color:'#8c8c8c', marginBottom:2}` literal
 *  re-authored in nearly every `components/inspectors/*` section (I-8). */
export const fieldLabelStyle: React.CSSProperties = {
  fontSize: 'var(--vgai-font-sm)',
  color: themeVars.content.muted,
  marginBottom: 2,
};

/** Sub-header / group label ("label over a related cluster of fields") — the
 *  ONE treatment for what used to be four (I-12): `Inspector.tsx`'s generic
 *  group header (11/600/uppercase/ls 0.4/#9aa0a6 — the incumbent this
 *  standardizes on), `ParticleSection.subHeaderStyle`,
 *  `PostProcessingSection.effectLabel`, and `MaterialSection`'s Textures. */
export const groupLabelStyle: React.CSSProperties = {
  fontSize: 'var(--vgai-font-base)',
  fontWeight: 600,
  color: themeVars.content.muted,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

/** One label-column width for every label-left/field-right row (I-13 —
 *  replaces the 56/64/70/76/80 ladder across Inspector.tsx/`Field`/
 *  `ComponentsSection`). */
export const LABEL_COL_WIDTH = 72;

export function ToggleButton({
  label,
  active,
  disabled,
  onClick,
  testId,
}: {
  label: React.ReactNode;
  active: boolean;
  disabled?: boolean | undefined;
  onClick: () => void;
  testId?: string | undefined;
}): React.ReactElement {
  return (
    <Button
      variant={active ? 'primary' : 'secondary'}
      size="compact"
      aria-pressed={active}
      disabled={disabled}
      data-testid={testId}
      onClick={() => {
        if (!disabled) onClick();
      }}
      style={{ flex: 1 }}
    >
      {label}
    </Button>
  );
}

/** `parseNumericValue('12.5px') -> {num: 12.5, unit: 'px'}` (visual-edit :98). */
export function parseNumericValue(value: string): { num: number; unit: string } {
  const match = value.match(/^(-?\d+\.?\d*)\s*(px|em|rem|%|vh|vw|deg|s|ms)?$/);
  if (match) return { num: Number.parseFloat(match[1] ?? '0'), unit: match[2] || '' };
  const num = Number.parseFloat(value);
  return { num: Number.isNaN(num) ? 0 : num, unit: '' };
}
