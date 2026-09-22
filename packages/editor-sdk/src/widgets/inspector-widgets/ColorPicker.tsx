import { Button, EditorPopover, TextInput } from '../design-system';
/**
 * ColorPicker — HSV area + hue/alpha sliders, hex↔rgb↔hsl format cycle,
 * eyedropper, recent colors (spec 27 §5 C1). Ported from
 * `visual-edit/inspector.tsx`'s `ColorPicker` (:1043-1421). The reference
 * threaded `onCommit`/`onClose`/an imperative `onActivateEyedropper` callback
 * that the HOST app wired to its own canvas-hit-test eyedropper mode; this
 * port instead feature-detects the native `EyeDropper` API directly (per the
 * spec's explicit ask) and falls back to a caller-supplied
 * `eyedropperFallback` (wired at the C2 step to
 * `ui-source/inspect.ts:effectiveColorFromChain` over whatever background
 * chain the host resolves at the click point — this pure widget has no DOM
 * reach of its own, Rule zero). `value`/`onChange`/`onChangeEnd` are the
 * kit-wide contract (`shared.tsx`); `onClose` is optional (a bare popover
 * caller can omit it and just unmount the picker on outside click itself).
 *
 * D3.d (spec 27 §6) completes that fallback: `onEyedropperPick`, when given,
 * is preferred over the synchronous `eyedropperFallback` and begins an
 * INTERACTIVE canvas-pick session (`../../authoring/eyedropper-session.ts`) —
 * this widget hands the session ITS OWN `applySampledColor` callback and
 * returns immediately; the canvas (`RootSelectionOverlay`) shows a
 * cursor-following swatch and resolves the session on click/Escape, which
 * invokes the callback this widget passed in (or not at all, on cancel).
 * `eyedropperFallback` stays as the synchronous, no-canvas-context fallback
 * (e.g. a widget gallery/story with neither native EyeDropper nor a host that
 * wires the session).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type ColorFormat,
  colorToString,
  hexToRgb,
  hslToRgb,
  hsvToRgb,
  parseAlpha,
  rgbToHsv,
  toHex,
} from './color-utils';
import { fireChange, fireEnd, THEME } from './shared';

const PICKER_W = 200;
const PICKER_H = 150;
const HUE_H = 14;

export interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  onChangeEnd?: ((color: string) => void) | undefined;
  onClose?: (() => void) | undefined;
  recentColors?: string[] | undefined;
  onAddRecentColor?: ((color: string) => void) | undefined;
  /** Feature-detected native browser eyedropper, with a caller-supplied
   *  fallback (see file doc comment) for browsers without the API. */
  eyedropperFallback?: (() => string | null) | undefined;
  /** D3.d — preferred over `eyedropperFallback` when given: begins an
   *  interactive canvas-pick session instead of reading one static value (see
   *  file doc comment). */
  onEyedropperPick?: ((apply: (color: string | null) => void) => void) | undefined;
  disabled?: boolean | undefined;
}

export function ColorPicker({
  value,
  onChange,
  onChangeEnd,
  onClose,
  recentColors,
  onAddRecentColor,
  eyedropperFallback,
  onEyedropperPick,
  disabled,
}: ColorPickerProps): React.ReactElement {
  const initialHex = toHex(value);
  const initialRgb = hexToRgb(initialHex);
  const [hsv, setHsv] = useState<[number, number, number]>(() => rgbToHsv(...initialRgb));
  const [alpha, setAlpha] = useState(() => parseAlpha(value));
  const [format, setFormat] = useState<ColorFormat>('hex');
  const [colorInput, setColorInput] = useState(initialHex);
  const containerRef = useRef<HTMLDivElement>(null);
  const satCanvasRef = useRef<HTMLCanvasElement>(null);
  const hueCanvasRef = useRef<HTMLCanvasElement>(null);
  const alphaCanvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef<'sat' | 'hue' | 'alpha' | null>(null);

  const currentColor = useCallback(
    (h = hsv, a = alpha, f = format): string => {
      const [r, g, b] = hsvToRgb(h[0], h[1], h[2]);
      return colorToString(r, g, b, a, f);
    },
    [hsv, alpha, format],
  );

  useEffect(() => {
    setColorInput(currentColor());
  }, [currentColor]);

  // Saturation/value canvas.
  useEffect(() => {
    const canvas = satCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const [hr, hg, hb] = hsvToRgb(hsv[0], 1, 1);
    const gradH = ctx.createLinearGradient(0, 0, PICKER_W, 0);
    gradH.addColorStop(0, '#ffffff');
    gradH.addColorStop(1, `rgb(${hr},${hg},${hb})`);
    ctx.fillStyle = gradH;
    ctx.fillRect(0, 0, PICKER_W, PICKER_H);
    const gradV = ctx.createLinearGradient(0, 0, 0, PICKER_H);
    gradV.addColorStop(0, 'rgba(0,0,0,0)');
    gradV.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gradV;
    ctx.fillRect(0, 0, PICKER_W, PICKER_H);
  }, [hsv[0]]);

  // Hue slider.
  useEffect(() => {
    const canvas = hueCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const grad = ctx.createLinearGradient(0, 0, PICKER_W, 0);
    for (let i = 0; i <= 6; i++) {
      const [r, g, b] = hsvToRgb(i / 6, 1, 1);
      grad.addColorStop(i / 6, `rgb(${r},${g},${b})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, PICKER_W, HUE_H);
  }, []);

  // Alpha slider.
  useEffect(() => {
    const canvas = alphaCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const size = 4;
    for (let y = 0; y < HUE_H; y += size) {
      for (let x = 0; x < PICKER_W; x += size) {
        ctx.fillStyle = (x / size + y / size) % 2 === 0 ? '#ffffff' : '#cccccc';
        ctx.fillRect(x, y, size, size);
      }
    }
    const [r, g, b] = hsvToRgb(hsv[0], hsv[1], hsv[2]);
    const grad = ctx.createLinearGradient(0, 0, PICKER_W, 0);
    grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},1)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, PICKER_W, HUE_H);
  }, [hsv]);

  useEffect(() => {
    if (!onClose) return;
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose?.();
    }
    function handleClick(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose?.();
    }
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick, true);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick, true);
    };
  }, [onClose]);

  /** sat/hue/alpha canvases all resolve `{hsv?, alpha?}` from a point the
   *  SAME way (ratio-of-rect, sat also inverts Y) — one function both
   *  `beginDrag` (mousedown, `e.currentTarget`) and the module-level
   *  `mousemove`/`mouseup` listener (no `currentTarget`, refs instead) call,
   *  keeping each of THOSE under biome's cognitive-complexity ceiling. */
  const applyDragPoint = useCallback(
    (
      which: 'sat' | 'hue' | 'alpha',
      canvas: HTMLCanvasElement | null,
      clientX: number,
      clientY: number,
    ): void => {
      const rect = canvas?.getBoundingClientRect();
      if (!rect) return;
      if (which === 'sat') {
        const next: [number, number, number] = [
          hsv[0],
          ratio(clientX, rect.left, rect.width),
          invRatio(clientY, rect.top, rect.height),
        ];
        setHsv(next);
        fireChange({ onChange }, currentColor(next));
      } else if (which === 'hue') {
        const next: [number, number, number] = [
          ratio(clientX, rect.left, rect.width),
          hsv[1],
          hsv[2],
        ];
        setHsv(next);
        fireChange({ onChange }, currentColor(next));
      } else {
        const a = Math.round(ratio(clientX, rect.left, rect.width) * 100) / 100;
        setAlpha(a);
        fireChange({ onChange }, currentColor(hsv, a));
      }
    },
    [hsv, currentColor, onChange],
  );

  useEffect(() => {
    function handleMove(e: MouseEvent): void {
      const which = draggingRef.current;
      if (!which) return;
      e.preventDefault();
      const canvas =
        which === 'sat'
          ? satCanvasRef.current
          : which === 'hue'
            ? hueCanvasRef.current
            : alphaCanvasRef.current;
      applyDragPoint(which, canvas, e.clientX, e.clientY);
    }
    function handleUp(): void {
      if (draggingRef.current) {
        draggingRef.current = null;
        const c = currentColor();
        fireEnd({ onChange, onChangeEnd }, c);
        onAddRecentColor?.(c);
      }
    }
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [applyDragPoint, currentColor, onChange, onChangeEnd, onAddRecentColor]);

  const beginDrag = (
    which: 'sat' | 'hue' | 'alpha',
    e: React.MouseEvent<HTMLCanvasElement>,
  ): void => {
    if (disabled) return;
    e.preventDefault();
    draggingRef.current = which;
    applyDragPoint(which, e.currentTarget, e.clientX, e.clientY);
  };

  const handleColorInputSubmit = (): void => {
    const val = colorInput.trim();
    const hex = parseHexInput(val);
    const parsed = hex
      ? { r: hex[0], g: hex[1], b: hex[2], a: 1 }
      : (parseRgbaInput(val) ?? parseHslaInput(val));
    if (!parsed) return;
    setHsv(rgbToHsv(parsed.r, parsed.g, parsed.b));
    setAlpha(parsed.a);
    const c = hex ? val : colorToString(parsed.r, parsed.g, parsed.b, parsed.a, format);
    fireChange({ onChange }, c);
    fireEnd({ onChange, onChangeEnd }, c);
    onAddRecentColor?.(c);
  };

  const cycleFormat = (): void => {
    setFormat((f) => (f === 'hex' ? 'rgb' : f === 'rgb' ? 'hsl' : 'hex'));
  };

  const canEyedrop = typeof (globalThis as { EyeDropper?: unknown }).EyeDropper === 'function';

  const applySampledColor = (sampled: string): void => {
    const h = toHex(sampled);
    setHsv(rgbToHsv(...hexToRgb(h)));
    setAlpha(parseAlpha(sampled));
    fireChange({ onChange }, sampled);
    fireEnd({ onChange, onChangeEnd }, sampled);
  };

  const handleEyedropper = async (): Promise<void> => {
    if (canEyedrop) {
      try {
        const ED = (
          globalThis as unknown as {
            EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> };
          }
        ).EyeDropper;
        const res = await new ED().open();
        applySampledColor(res.sRGBHex);
      } catch {
        /* cancelled */
      }
      return;
    }
    // D3.d — no native EyeDropper: prefer the interactive canvas-pick session
    // when the host wired one; a canvas-less caller (gallery/story) falls
    // back to the synchronous, single-value `eyedropperFallback`.
    if (onEyedropperPick) {
      onEyedropperPick((color) => {
        if (color) applySampledColor(color);
      });
      return;
    }
    const fallback = eyedropperFallback?.();
    if (fallback) applySampledColor(fallback);
  };

  const [r, g, b] = hsvToRgb(hsv[0], hsv[1], hsv[2]);
  const previewBg = `rgba(${r},${g},${b},${alpha})`;

  return (
    <EditorPopover
      ref={containerRef}
      data-testid="inspector-color-picker"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        padding: 10,
        width: PICKER_W + 16,
        boxSizing: 'border-box',
      }}
    >
      <canvas
        ref={satCanvasRef}
        data-testid="color-picker-sv"
        width={PICKER_W}
        height={PICKER_H}
        onMouseDown={(e) => beginDrag('sat', e)}
        style={{ cursor: 'crosshair', borderRadius: THEME.radiusSmall, display: 'block' }}
      />
      <canvas
        ref={hueCanvasRef}
        data-testid="color-picker-hue"
        width={PICKER_W}
        height={HUE_H}
        onMouseDown={(e) => beginDrag('hue', e)}
        style={{
          cursor: 'pointer',
          borderRadius: THEME.radiusSmall,
          display: 'block',
          marginTop: 6,
        }}
      />
      <canvas
        ref={alphaCanvasRef}
        data-testid="color-picker-alpha"
        width={PICKER_W}
        height={HUE_H}
        onMouseDown={(e) => beginDrag('alpha', e)}
        style={{
          cursor: 'pointer',
          borderRadius: THEME.radiusSmall,
          display: 'block',
          marginTop: 6,
        }}
      />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: THEME.radiusSmall,
            flexShrink: 0,
            border: `1px solid ${THEME.border}`,
            background: previewBg,
          }}
        />
        <TextInput
          type="text"
          data-testid="color-picker-text"
          value={colorInput}
          onChange={(e) => setColorInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleColorInputSubmit();
          }}
          onBlur={handleColorInputSubmit}
          data-density="compact"
          data-monospace="true"
          style={{ flex: 1 }}
        />
        <Button
          type="button"
          variant="secondary"
          size="compact"
          data-testid="color-format-toggle"
          onClick={cycleFormat}
          title="Cycle color format"
          style={{ flexShrink: 0 }}
        >
          {format.toUpperCase()}
        </Button>
        {(canEyedrop || eyedropperFallback || onEyedropperPick) && (
          <Button
            type="button"
            variant="secondary"
            size="compact"
            data-testid="color-picker-eyedropper"
            onClick={handleEyedropper}
            title="Eyedropper"
            style={{ flexShrink: 0 }}
          >
            ⌖
          </Button>
        )}
      </div>
      {recentColors && recentColors.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 3,
            marginTop: 8,
            paddingTop: 6,
            borderTop: `1px solid ${THEME.border}`,
          }}
        >
          {recentColors.map((rc, i) => (
            <div
              key={`${rc}-${i}`}
              data-testid="color-picker-recent"
              onClick={() => {
                const h = toHex(rc);
                setHsv(rgbToHsv(...hexToRgb(h)));
                setAlpha(parseAlpha(rc));
                fireChange({ onChange }, rc);
                fireEnd({ onChange, onChangeEnd }, rc);
              }}
              title={rc}
              style={{
                width: 16,
                height: 16,
                borderRadius: THEME.radiusSmall,
                cursor: 'pointer',
                background: rc,
                border: `1px solid ${THEME.border}`,
              }}
            />
          ))}
        </div>
      )}
    </EditorPopover>
  );
}

/** A compact swatch that opens a `ColorPicker` popover — the row-style usage
 *  most inspector sections want (visual-edit's `ColorRow`/`StrokeColorSwatch`,
 *  :1425-1512 — folded into one configurable component here since both were
 *  the identical swatch+popover shell around different labels). */
export interface ColorSwatchProps extends ColorPickerProps {
  label?: string | undefined;
  testId?: string | undefined;
}

export function ColorSwatch({
  label,
  value,
  onChange,
  onChangeEnd,
  recentColors,
  onAddRecentColor,
  eyedropperFallback,
  onEyedropperPick,
  disabled,
  testId,
}: ColorSwatchProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const hex = toHex(value);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
      <div
        data-testid={testId ? `${testId}-swatch` : 'color-swatch'}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
        style={{
          width: 20,
          height: 20,
          borderRadius: THEME.radiusSmall,
          flexShrink: 0,
          background: hex,
          border: `1px solid ${THEME.border}`,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      />
      {label && (
        <span style={{ fontSize: 10, color: THEME.textMuted, flexShrink: 0 }}>{label}</span>
      )}
      {open && !disabled && (
        <div
          style={{
            position: 'absolute',
            zIndex: 'var(--vgai-z-dropdown)',
            top: '100%',
            left: 0,
            marginTop: 4,
          }}
        >
          <ColorPicker
            value={value}
            onChange={onChange}
            onChangeEnd={onChangeEnd}
            onClose={() => setOpen(false)}
            recentColors={recentColors}
            onAddRecentColor={onAddRecentColor}
            eyedropperFallback={eyedropperFallback}
            onEyedropperPick={onEyedropperPick}
          />
        </div>
      )}
    </div>
  );
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** `clientPos` as a 0..1 fraction of `[start, start+size]`. */
function ratio(clientPos: number, start: number, size: number): number {
  return clamp01(size ? (clientPos - start) / size : 0);
}

/** Same as `ratio`, but Y-inverted — canvas top is `v=1` for the sat/value area. */
function invRatio(clientPos: number, start: number, size: number): number {
  return clamp01(size ? 1 - (clientPos - start) / size : 0);
}

/** `"#rrggbb"` -> its RGB triple, or `null` if `val` isn't a bare 6-digit hex. */
function parseHexInput(val: string): [number, number, number] | null {
  return /^#[0-9a-fA-F]{6}$/.test(val) ? hexToRgb(val) : null;
}

/** `"rgb(a)(r, g, b[, a])"` -> `{r,g,b,a}`, or `null` if it doesn't match. */
function parseRgbaInput(val: string): { r: number; g: number; b: number; a: number } | null {
  const m = val.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  const [, rs, gs, bs, as] = m;
  return {
    r: Number.parseInt(rs ?? '0', 10),
    g: Number.parseInt(gs ?? '0', 10),
    b: Number.parseInt(bs ?? '0', 10),
    a: as ? Number.parseFloat(as) : 1,
  };
}

/** `"hsl(a)(h, s%, l%[, a])"` -> `{r,g,b,a}` (converted to RGB), or `null`. */
function parseHslaInput(val: string): { r: number; g: number; b: number; a: number } | null {
  const m = val.match(/hsla?\((\d+),\s*(\d+)%?,\s*(\d+)%?(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  const [, hs, ss, ls, as] = m;
  const [r, g, b] = hslToRgb(
    Number.parseInt(hs ?? '0', 10) / 360,
    Number.parseInt(ss ?? '0', 10) / 100,
    Number.parseInt(ls ?? '0', 10) / 100,
  );
  return { r, g, b, a: as ? Number.parseFloat(as) : 1 };
}
