import { Button, Select } from '../design-system';
/**
 * BorderEditor (per-side width/style/color) + BorderRadiusEditor (per-corner)
 * (spec 27 §5 C1). Ported from `visual-edit/inspector.tsx`'s `BorderEditor`
 * (:1853-1951) and `BorderRadiusEditor` (:1794-1847) — both keep the
 * reference's uniform<->per-side/per-corner expand toggle (a single border/
 * radius is the common case; independent sides are one click away).
 */

import { faBorderAll, faBorderTopLeft } from '@fortawesome/free-solid-svg-icons';
import { useState } from 'react';
import { EditorIcon } from '../design-system';
import { ColorSwatch } from './ColorPicker';
import { ScrubbableInput } from './ScrubbableInput';
import { type ChangeHandlers, fireChange, fireEnd, THEME } from './shared';

const BORDER_STYLES = ['none', 'solid', 'dashed', 'dotted', 'double'];

export interface BorderSide {
  width: number;
  style: string;
  color: string;
}

export interface BorderValue {
  top: BorderSide;
  right: BorderSide;
  bottom: BorderSide;
  left: BorderSide;
}

export function uniformBorder(side: BorderSide): BorderValue {
  return { top: side, right: side, bottom: side, left: side };
}

/** `true` when all 4 sides share width/style/color (safe to render collapsed). */
export function isUniformBorder(v: BorderValue): boolean {
  const key = (s: BorderSide): string => `${s.width}|${s.style}|${s.color}`;
  const k = key(v.top);
  return key(v.right) === k && key(v.bottom) === k && key(v.left) === k;
}

export interface BorderEditorProps extends ChangeHandlers<BorderValue> {
  recentColors?: string[] | undefined;
  onAddRecentColor?: ((color: string) => void) | undefined;
}

export function BorderEditor({
  value,
  onChange,
  onChangeEnd,
  disabled,
  recentColors,
  onAddRecentColor,
}: BorderEditorProps): React.ReactElement {
  const [expanded, setExpanded] = useState(!isUniformBorder(value));

  const applyAll = (partial: Partial<BorderSide>, commit: boolean): void => {
    const side = { ...value.top, ...partial };
    const next = uniformBorder(side);
    if (commit) fireEnd({ onChange, onChangeEnd }, next);
    else fireChange({ onChange }, next);
  };

  const applySide = (
    key: keyof BorderValue,
    partial: Partial<BorderSide>,
    commit: boolean,
  ): void => {
    const next = { ...value, [key]: { ...value[key], ...partial } };
    if (commit) fireEnd({ onChange, onChangeEnd }, next);
    else fireChange({ onChange }, next);
  };

  if (!expanded) {
    return (
      <div
        data-testid="border-editor-uniform"
        style={{ display: 'flex', gap: 6, alignItems: 'center' }}
      >
        <ColorSwatch
          testId="border-color"
          value={value.top.color}
          disabled={disabled}
          onChange={(c) => applyAll({ color: c }, false)}
          onChangeEnd={(c) => applyAll({ color: c }, true)}
          recentColors={recentColors}
          onAddRecentColor={onAddRecentColor}
        />
        <ScrubbableInput
          testId="border-width"
          label="W"
          value={value.top.width}
          min={0}
          disabled={disabled}
          onChange={(v) => applyAll({ width: v }, false)}
          onChangeEnd={(v) => applyAll({ width: v }, true)}
          style={{ width: 64 }}
        />
        <Select
          className="vgai-select"
          data-testid="border-style"
          value={value.top.style}
          disabled={disabled}
          data-dynamic={disabled || undefined}
          onChange={(e) => applyAll({ style: e.target.value }, true)}
          style={{ flex: 1 }}
        >
          {BORDER_STYLES.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          data-testid="border-expand"
          title="Per-side borders"
          aria-label="Edit borders per side"
          onClick={() => setExpanded(true)}
          variant="ghost"
          size="compact"
        >
          <EditorIcon icon={faBorderAll} />
        </Button>
      </div>
    );
  }

  const sides: Array<{ key: keyof BorderValue; label: string }> = [
    { key: 'top', label: 'T' },
    { key: 'right', label: 'R' },
    { key: 'bottom', label: 'B' },
    { key: 'left', label: 'L' },
  ];

  return (
    <div
      data-testid="border-editor-expanded"
      style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 10, color: THEME.textMuted }}>Per-side</span>
        <div style={{ flex: 1 }} />
        <Button
          type="button"
          variant="primary"
          size="compact"
          data-testid="border-collapse"
          title="Uniform border"
          aria-label="Use one border for all sides"
          onClick={() => setExpanded(false)}
        >
          <EditorIcon icon={faBorderAll} />
        </Button>
      </div>
      {sides.map(({ key, label }) => (
        <div key={key} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: THEME.textMuted, width: 10, textAlign: 'center' }}>
            {label}
          </span>
          <ColorSwatch
            testId={`border-${key}-color`}
            value={value[key].color}
            disabled={disabled}
            onChange={(c) => applySide(key, { color: c }, false)}
            onChangeEnd={(c) => applySide(key, { color: c }, true)}
            recentColors={recentColors}
            onAddRecentColor={onAddRecentColor}
          />
          <ScrubbableInput
            testId={`border-${key}-width`}
            label=""
            value={value[key].width}
            min={0}
            disabled={disabled}
            onChange={(v) => applySide(key, { width: v }, false)}
            onChangeEnd={(v) => applySide(key, { width: v }, true)}
            style={{ width: 48 }}
          />
          <Select
            className="vgai-select"
            data-testid={`border-${key}-style`}
            value={value[key].style}
            disabled={disabled}
            data-density="compact"
            data-dynamic={disabled || undefined}
            onChange={(e) => applySide(key, { style: e.target.value }, true)}
            style={{ flex: 1 }}
          >
            {BORDER_STYLES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </div>
      ))}
    </div>
  );
}

export interface BorderRadiusValue {
  topLeft: number;
  topRight: number;
  bottomLeft: number;
  bottomRight: number;
}

export function uniformRadius(n: number): BorderRadiusValue {
  return { topLeft: n, topRight: n, bottomLeft: n, bottomRight: n };
}

export function isUniformRadius(v: BorderRadiusValue): boolean {
  return v.topLeft === v.topRight && v.topRight === v.bottomLeft && v.bottomLeft === v.bottomRight;
}

export function BorderRadiusEditor({
  value,
  onChange,
  onChangeEnd,
  disabled,
}: ChangeHandlers<BorderRadiusValue>): React.ReactElement {
  const [expanded, setExpanded] = useState(!isUniformRadius(value));

  const applyAll = (n: number, commit: boolean): void => {
    const next = uniformRadius(n);
    if (commit) fireEnd({ onChange, onChangeEnd }, next);
    else fireChange({ onChange }, next);
  };

  const applyCorner = (key: keyof BorderRadiusValue, n: number, commit: boolean): void => {
    const next = { ...value, [key]: n };
    if (commit) fireEnd({ onChange, onChangeEnd }, next);
    else fireChange({ onChange }, next);
  };

  if (!expanded) {
    return (
      <div
        data-testid="border-radius-editor-uniform"
        style={{ display: 'flex', gap: 4, alignItems: 'center' }}
      >
        <ScrubbableInput
          testId="border-radius"
          label={<EditorIcon icon={faBorderTopLeft} label="Radius" />}
          value={value.topLeft}
          min={0}
          disabled={disabled}
          onChange={(v) => applyAll(v, false)}
          onChangeEnd={(v) => applyAll(v, true)}
          style={{ flex: 1 }}
        />
        <Button
          type="button"
          data-testid="border-radius-expand"
          title="Independent corners"
          aria-label="Edit radius per corner"
          onClick={() => setExpanded(true)}
          variant="ghost"
          size="compact"
        >
          <EditorIcon icon={faBorderTopLeft} />
        </Button>
      </div>
    );
  }

  const corners: Array<{ key: keyof BorderRadiusValue; label: string }> = [
    { key: 'topLeft', label: 'TL' },
    { key: 'topRight', label: 'TR' },
    { key: 'bottomLeft', label: 'BL' },
    { key: 'bottomRight', label: 'BR' },
  ];

  return (
    <div data-testid="border-radius-editor-expanded">
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: THEME.textMuted }}>Corners</span>
        <div style={{ flex: 1 }} />
        <Button
          type="button"
          variant="primary"
          size="compact"
          data-testid="border-radius-collapse"
          title="Uniform radius"
          aria-label="Use one radius for all corners"
          onClick={() => setExpanded(false)}
        >
          <EditorIcon icon={faBorderTopLeft} />
        </Button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
        {corners.map(({ key, label }) => (
          <ScrubbableInput
            key={key}
            testId={`border-radius-${key}`}
            label={label}
            value={value[key]}
            min={0}
            disabled={disabled}
            onChange={(v) => applyCorner(key, v, false)}
            onChangeEnd={(v) => applyCorner(key, v, true)}
          />
        ))}
      </div>
    </div>
  );
}
