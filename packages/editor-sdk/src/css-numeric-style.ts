/**
 * THE ONE PLACE that knows a CSS numeric style value is not the same thing as
 * its CSS TEXT.
 *
 * React's own rule (`dangerousStyleValue`): a NUMBER style value is emitted
 * verbatim when it is `0` or the property is unitless, and suffixed with `px`
 * otherwise. So `style={{ width: 300 }}` paints 300px while
 * `style={{ width: '300' }}` paints NOTHING — the CSSOM rejects a unitless
 * length and keeps the previous value.
 *
 * That is why the inspector's numeric descriptors must reach source as
 * NUMBERS: stringifying `300` on the way to the writer produced
 * `width: '300'`, which React passed through verbatim, which the CSSOM
 * rejected — a write that changed source, changed nothing on screen, and
 * acked `persisted: true`.
 *
 * The two consumers are the two halves of one write: the SOURCE (a bare `300`
 * in the JSX style object, which React px-ifies at render) and the LIVE inline
 * patch / CSS-file declaration (which are CSS TEXT and need the unit spelled).
 * {@link cssTextForStyleValue} is the second half.
 */

/**
 * Properties whose numeric value is unitless in CSS — the exact set the
 * inspector's numeric widgets already print with no `px` suffix.
 *
 * Deliberately the SHIPPED list rather than React's full internal table: this
 * set covers every `type: 'number'` descriptor the adapters declare
 * (`STYLE_PROPERTIES`), and a descriptor added outside it would be wrong in
 * the widget's suffix before it was wrong here.
 */
export const UNITLESS_NUMBER_PROPS: ReadonlySet<string> = new Set([
  'opacity',
  'zIndex',
  'flexGrow',
  'flexShrink',
  // React's own unitless set includes these two, and px-ifying them writes
  // INVALID CSS the browser silently drops (blind re-walk: extracting a
  // class from an element with `fontWeight: 900` emitted
  // `font-weight: 900px`, losing the weight). A numeric lineHeight is the
  // unitless multiplier form — px-ifying it changes meaning, not just
  // validity.
  'fontWeight',
  'lineHeight',
]);

/**
 * THE READ HALF of the same rule: parse a real `CSSStyleDeclaration`'s
 * length-property VALUE (always a unit-suffixed STRING, e.g. `"16px"` — CSSOM
 * never hands back a bare number) into the plain number a `type: 'number'`
 * `PropertyDescriptor` needs to render/edit correctly (`Inspector.tsx`'s
 * generic renderer does `typeof v === 'number' ? … : 0` — without this parse,
 * EVERY numeric style field would silently display `0` against a real browser
 * DOM, even though plain-object `style: {}` fixtures never caught it, because
 * a hand-built fixture can hold a bare JS number directly). Strips a trailing
 * CSS unit (`px`/`em`/`rem`/`%`/`vh`/`vw`, mirroring `ui-source/writer.ts`'s
 * own `LITERAL_RE` unit set); a value already handed over AS a number (or
 * `undefined`/unset) passes through unchanged.
 *
 * It lived in `react-world-authoring-adapter.ts` until 2026-09-18 and moved
 * here for the reason this module's header states — this is the one place that
 * knows CSS numeric value and CSS text are different things — and because one
 * host module that is NOT the React surface reads it: the overlay gesture bus
 * (`components/world-overlay-gestures.ts`) parses a computed border width to
 * place a resize handle. That single edge dragged the whole 3,848-line React
 * root adapter into every editor boot (phase 1 of the open-source launch).
 */
export function numericStyleValue(raw: unknown): number | undefined {
  if (typeof raw === 'number') return raw;
  if (typeof raw !== 'string' || raw === '') return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Numeric inspector edits change the magnitude of an authored CSS dimension.
 * Keep relative units; ordinary React numbers and px values remain numbers. */
export function preserveNumericStyleUnit(
  value: string | number,
  authored: unknown,
): string | number {
  if (typeof value !== 'number' || typeof authored !== 'string') return value;
  const unit = authored.trim().match(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?([a-z]+|%)$/i)?.[1];
  return unit && unit.toLowerCase() !== 'px' ? `${value}${unit}` : value;
}

/**
 * The CSS TEXT for a style value — React's `dangerousStyleValue` rule.
 *
 * A string passes through untouched (it is already CSS text — `'12px'`,
 * `'var(--brand)'`, `'50%'`). A number becomes `${n}px` unless it is `0` or
 * the property is unitless.
 */
export function cssTextForStyleValue(prop: string, value: string | number): string {
  if (typeof value !== 'number') return value;
  if (value === 0 || UNITLESS_NUMBER_PROPS.has(prop)) return String(value);
  return `${value}px`;
}
