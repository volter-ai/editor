import { Button, Checkbox } from '../design-system';
/**
 * ShadowEditor / TextShadowEditor — a list of box/text shadows (add/remove,
 * x/y/blur/(spread)/color, inset for box-shadow) (spec 27 §5 C1). Ported from
 * `visual-edit/inspector.tsx`'s `ShadowEditor`/`ShadowRow` (:632-769) and
 * `TextShadowEditor`/`TextShadowRow` (:1622-1788) — folded into one generic
 * `ShadowListEditor` since the two are the same list-of-rows shape with
 * `spread`/`inset` present only for box-shadow.
 */

import { ColorSwatch } from './ColorPicker';
import { rgbStringToHex } from './color-utils';
import { ScrubbableInput } from './ScrubbableInput';
import { type ChangeHandlers, fireChange, fireEnd, THEME } from './shared';

export interface ShadowValue {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  inset: boolean;
  enabled: boolean;
}

export const DEFAULT_SHADOW: ShadowValue = {
  x: 0,
  y: 4,
  blur: 8,
  spread: 0,
  color: 'rgba(0,0,0,0.25)',
  inset: false,
  enabled: true,
};

export const DEFAULT_TEXT_SHADOW: ShadowValue = {
  x: 0,
  y: 2,
  blur: 4,
  spread: 0,
  color: 'rgba(0,0,0,0.3)',
  inset: false,
  enabled: true,
};

function composeOne(s: ShadowValue, withSpreadInset: boolean): string {
  const parts = withSpreadInset
    ? [s.inset ? 'inset' : '', `${s.x}px`, `${s.y}px`, `${s.blur}px`, `${s.spread}px`, s.color]
    : [`${s.x}px`, `${s.y}px`, `${s.blur}px`, s.color];
  return parts.filter(Boolean).join(' ');
}

/** `boxShadow`/`textShadow` CSS string <-> the widget's `ShadowValue[]`. */
export function composeShadows(shadows: ShadowValue[], withSpreadInset = true): string {
  const enabled = shadows.filter((s) => s.enabled);
  if (enabled.length === 0) return 'none';
  return enabled.map((s) => composeOne(s, withSpreadInset)).join(', ');
}

/** Pulls the color token (`rgba(...)`/hex) out of a shadow's numeric-part
 *  tail -> `{color, nums}` (nums = whatever's left to parse as x/y/blur/
 *  spread). Split out of `parseOne` to keep it under biome's
 *  cognitive-complexity ceiling. */
function extractShadowColor(rest: string): { color: string; nums: string } {
  const rgbMatch = rest.match(/(rgba?\([^)]+\))/);
  if (rgbMatch?.[1]) return { color: rgbMatch[1], nums: rest.replace(rgbMatch[1], '').trim() };
  const hexMatch = rest.match(/(#[0-9a-fA-F]{3,8})/);
  if (hexMatch?.[1]) return { color: hexMatch[1], nums: rest.replace(hexMatch[1], '').trim() };
  return { color: '#000000', nums: rest };
}

function parseOne(value: string, withSpreadInset: boolean): Omit<ShadowValue, 'enabled'> | null {
  if (!value || value === 'none') return null;
  const v = value.trim();
  const inset = withSpreadInset && v.startsWith('inset');
  const rest = inset ? v.slice(5).trim() : v;
  const { color, nums } = extractShadowColor(rest);
  const parts = nums
    .split(/\s+/)
    .map((s) => Number.parseFloat(s))
    .filter((n) => !Number.isNaN(n));
  if (withSpreadInset) {
    return {
      inset,
      x: parts[0] ?? 0,
      y: parts[1] ?? 0,
      blur: parts[2] ?? 0,
      spread: parts[3] ?? 0,
      color,
    };
  }
  if (parts.length < 2) return null;
  return {
    inset: false,
    x: parts[0] ?? 0,
    y: parts[1] ?? 0,
    blur: parts[2] ?? 0,
    spread: 0,
    color,
  };
}

export function parseShadows(value: string, withSpreadInset = true): ShadowValue[] {
  if (!value || value === 'none') return [];
  const parts = value.split(/,\s*(?![^(]*\))/);
  const result: ShadowValue[] = [];
  for (const part of parts) {
    const p = parseOne(part.trim(), withSpreadInset);
    if (p) result.push({ ...p, enabled: true });
  }
  return result;
}

export interface ShadowListEditorProps extends ChangeHandlers<ShadowValue[]> {
  /** `false` for text-shadow: hides the spread/inset controls. */
  withSpreadInset?: boolean | undefined;
  label?: string | undefined;
  testId?: string | undefined;
  recentColors?: string[] | undefined;
  onAddRecentColor?: ((color: string) => void) | undefined;
}

export function ShadowListEditor({
  value,
  onChange,
  onChangeEnd,
  disabled,
  withSpreadInset = true,
  label = 'Shadow',
  testId = 'shadow-editor',
  recentColors,
  onAddRecentColor,
}: ShadowListEditorProps): React.ReactElement {
  const apply = (next: ShadowValue[], commit: boolean): void => {
    if (commit) fireEnd({ onChange, onChangeEnd }, next);
    else fireChange({ onChange }, next);
  };

  const update = (index: number, partial: Partial<ShadowValue>, commit = false): void => {
    apply(
      value.map((s, i) => (i === index ? { ...s, ...partial } : s)),
      commit,
    );
  };

  const remove = (index: number): void => {
    apply(
      value.filter((_, i) => i !== index),
      true,
    );
  };

  const add = (): void => {
    apply([...value, { ...(withSpreadInset ? DEFAULT_SHADOW : DEFAULT_TEXT_SHADOW) }], true);
  };

  return (
    <div data-testid={testId}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: value.length > 0 ? 4 : 0,
        }}
      >
        <span style={{ fontSize: 9, color: THEME.textMuted }}>{label}</span>
        <div style={{ flex: 1 }} />
        {!disabled && (
          <Button
            type="button"
            variant="ghost"
            size="compact"
            data-testid={`${testId}-add`}
            onClick={add}
          >
            +
          </Button>
        )}
      </div>
      {value.map((shadow, i) => {
        const hexColor = shadow.color.startsWith('#') ? shadow.color : rgbStringToHex(shadow.color);
        return (
          <div
            key={i}
            data-testid={`${testId}-row-${i}`}
            style={{ marginBottom: 6, padding: '4px 0', borderBottom: `1px solid ${THEME.border}` }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <Button
                type="button"
                variant="ghost"
                size="compact"
                aria-pressed={shadow.enabled}
                data-testid={`${testId}-toggle-${i}`}
                onClick={() => {
                  if (!disabled) update(i, { enabled: !shadow.enabled }, true);
                }}
              >
                {shadow.enabled ? '●' : '○'}
              </Button>
              <ColorSwatch
                testId={`${testId}-color-${i}`}
                value={hexColor}
                disabled={disabled}
                onChange={(c) => update(i, { color: c })}
                onChangeEnd={(c) => update(i, { color: c }, true)}
                recentColors={recentColors}
                onAddRecentColor={onAddRecentColor}
              />
              {withSpreadInset && (
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    fontSize: 8,
                    color: THEME.textMuted,
                    cursor: 'pointer',
                  }}
                >
                  <Checkbox
                    // Standard checkbox size via the shared class (I-30: this
                    // was the one checkbox in the codebase with its own 10px
                    // explicit dimensions).
                    className="vgai-checkbox"
                    data-testid={`${testId}-inset-${i}`}
                    checked={shadow.inset}
                    disabled={disabled}
                    onChange={(e) => update(i, { inset: e.target.checked }, true)}
                  />
                  in
                </label>
              )}
              <div style={{ flex: 1 }} />
              {!disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="compact"
                  aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
                  data-testid={`${testId}-remove-${i}`}
                  onClick={() => remove(i)}
                >
                  ×
                </Button>
              )}
            </div>
            {shadow.enabled && (
              <div style={{ display: 'flex', gap: 4 }}>
                <ScrubbableInput
                  label="X"
                  value={shadow.x}
                  disabled={disabled}
                  onChange={(v) => update(i, { x: v })}
                  onChangeEnd={(v) => update(i, { x: v }, true)}
                  style={{ flex: 1 }}
                />
                <ScrubbableInput
                  label="Y"
                  value={shadow.y}
                  disabled={disabled}
                  onChange={(v) => update(i, { y: v })}
                  onChangeEnd={(v) => update(i, { y: v }, true)}
                  style={{ flex: 1 }}
                />
                <ScrubbableInput
                  label="B"
                  value={shadow.blur}
                  min={0}
                  disabled={disabled}
                  onChange={(v) => update(i, { blur: Math.max(0, v) })}
                  onChangeEnd={(v) => update(i, { blur: Math.max(0, v) }, true)}
                  style={{ flex: 1 }}
                />
                {withSpreadInset && (
                  <ScrubbableInput
                    label="S"
                    value={shadow.spread}
                    disabled={disabled}
                    onChange={(v) => update(i, { spread: v })}
                    onChangeEnd={(v) => update(i, { spread: v }, true)}
                    style={{ flex: 1 }}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ShadowEditor(
  props: Omit<ShadowListEditorProps, 'withSpreadInset' | 'testId'>,
): React.ReactElement {
  return (
    <ShadowListEditor
      {...props}
      withSpreadInset
      testId="box-shadow-editor"
      label={props.label ?? 'Shadow'}
    />
  );
}

export function TextShadowEditor(
  props: Omit<ShadowListEditorProps, 'withSpreadInset' | 'testId'>,
): React.ReactElement {
  return (
    <ShadowListEditor
      {...props}
      withSpreadInset={false}
      testId="text-shadow-editor"
      label={props.label ?? 'Text Shadow'}
    />
  );
}
