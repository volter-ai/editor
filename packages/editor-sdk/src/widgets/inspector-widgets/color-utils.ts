/**
 * Color math for the inspector widget kit (spec 27 §5 C1). Ported from
 * `visual-edit/inspector.tsx`'s free-floating hex/rgb/hsv/hsl helpers
 * (993-1035:2781-2855) — pure functions, zero deps, zero DOM. Colour-CHAIN
 * resolution (the eyedropper's "what's the effective background here" logic)
 * is NOT re-implemented here — that's `effectiveColorFromChain` in
 * `ui-source/inspect.ts`, reused as-is by `ColorPicker.tsx`.
 */

export type ColorFormat = 'hex' | 'rgb' | 'hsl';

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3)
    h = `${h[0] ?? '0'}${h[0] ?? '0'}${h[1] ?? '0'}${h[1] ?? '0'}${h[2] ?? '0'}${h[2] ?? '0'}`;
  const n = Number.parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((c) =>
      Math.round(Math.max(0, Math.min(255, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((((gn - bn) / d) % 6) + 6) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h /= 6;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
    default:
      break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function hsvToHex(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t0: number): number => {
      let t = t0;
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  return [h, s, l];
}

/** Normalize any hex/rgb(a)/hsl(a) string to a 6-digit hex (alpha dropped). */
export function toHex(color: string): string {
  if (color.startsWith('#') && (color.length === 4 || color.length === 7)) return color;
  if (color.startsWith('#') && color.length === 9) return color.slice(0, 7); // strip alpha from #RRGGBBAA
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) {
    const [, r, g, b] = m;
    return `#${[r ?? '0', g ?? '0', b ?? '0'].map((c) => Number.parseInt(c, 10).toString(16).padStart(2, '0')).join('')}`;
  }
  const hsl = color.match(/hsla?\((\d+),\s*(\d+)%?,\s*(\d+)%?/);
  if (hsl) {
    const [r, g, b] = hslToRgb(
      Number.parseInt(hsl[1] ?? '0', 10) / 360,
      Number.parseInt(hsl[2] ?? '0', 10) / 100,
      Number.parseInt(hsl[3] ?? '0', 10) / 100,
    );
    return rgbToHex(r, g, b);
  }
  return '#000000';
}

export function parseAlpha(color: string): number {
  const rgbaMatch = color.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
  if (rgbaMatch?.[1]) return Number.parseFloat(rgbaMatch[1]);
  const hslaMatch = color.match(/hsla\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
  if (hslaMatch?.[1]) return Number.parseFloat(hslaMatch[1]);
  if (color.startsWith('#') && color.length === 9)
    return Number.parseInt(color.slice(7, 9), 16) / 255;
  return 1;
}

export function colorToString(
  r: number,
  g: number,
  b: number,
  a: number,
  format: ColorFormat,
): string {
  if (format === 'hex') {
    const hex = rgbToHex(r, g, b);
    return a < 1 ? `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})` : hex;
  }
  if (format === 'rgb') {
    return a < 1 ? `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})` : `rgb(${r}, ${g}, ${b})`;
  }
  const [h, s, l] = rgbToHsl(r, g, b);
  const hDeg = Math.round(h * 360);
  const sPct = Math.round(s * 100);
  const lPct = Math.round(l * 100);
  return a < 1
    ? `hsla(${hDeg}, ${sPct}%, ${lPct}%, ${a.toFixed(2)})`
    : `hsl(${hDeg}, ${sPct}%, ${lPct}%)`;
}

export function rgbStringToHex(rgb: string): string {
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return '#000000';
  return `#${[m[0] ?? '0', m[1] ?? '0', m[2] ?? '0'].map((n) => Number.parseInt(n, 10).toString(16).padStart(2, '0')).join('')}`;
}
