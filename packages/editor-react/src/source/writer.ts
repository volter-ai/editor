/**
 * Surgical source writer (C7/C8) — the visual-edit "edit source by offset, not by
 * AST rewrite" trick. Given the original source and an element's location (from the
 * OID index), it edits the inline `style={{…}}` object IN PLACE, preserving all
 * other properties (including dynamic ones), formatting, and comments — and refuses
 * to touch expression-bound (dynamic) values (the literal-vs-dynamic guard). Plus a
 * structural delete. Pure string ops (no parser, like visual-edit/writer.ts).
 */

import { UTILITY_CLASSES_UNPROVEN, type UtilityClassSupport } from './utility-class-support';

import type { DuplicateRewrite } from '@volter/editor-sdk/source-authoring';
export type { DuplicateRewrite } from '@volter/editor-sdk/source-authoring';

export interface StyleProperty {
  name: string;
  /** Raw value text as it appears in source. */
  raw: string;
  literal: boolean;
  valueStart: number;
  valueEnd: number;
  /**
   * The full `key: value` member span — from the first char of the key through the
   * end of the (trimmed) value, EXCLUDING any leading/trailing whitespace or the
   * separating comma (D-A2, `removeInlineStyle`). `memberEnd` always equals
   * `valueEnd` (the member ends exactly where its value ends); kept as a distinct
   * field for readability at removeInlineStyle's call site.
   */
  memberStart: number;
  memberEnd: number;
}

/** Find the `>` that closes the opening tag starting at `start` (a `<`). */
export function findTagEnd(code: string, start: number): number {
  let depth = 0;
  let str: string | null = null;
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if (str) {
      if (c === str && code[i - 1] !== '\\') str = null;
      continue;
    }
    // A COMMENT. JSX allows one between attributes and inside an attribute's
    // `{…}` expression alike, and an apostrophe in its prose ("the tab's drag
    // handle", "the palette's active ink") otherwise opens a string that
    // swallows the tag's own `>` and every element after it — measured on
    // `GameHierarchy.tsx` and its neighbours. A self-closing `/` is
    // followed by `>`, never by `/` or `*`, so it cannot be mistaken for one.
    if (c === '/' && code[i + 1] === '/') {
      const newline = code.indexOf('\n', i);
      if (newline < 0) return -1;
      i = newline;
      continue;
    }
    if (c === '/' && code[i + 1] === '*') {
      const close = code.indexOf('*/', i + 2);
      if (close < 0) return -1;
      i = close + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') str = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return i;
  }
  return -1;
}

/** Locate the inner range of `style={{ … }}` within the opening tag, or null. */
function findStyleObject(
  code: string,
  tagStart: number,
  tagEnd: number,
): { innerStart: number; innerEnd: number } | null {
  const seg = code.slice(tagStart, tagEnd);
  const m = seg.match(/style\s*=\s*\{\{/);
  if (!m || m.index == null) return null;
  const openBraceOuter = tagStart + m.index + m[0].length - 2; // position of first `{` of `{{`
  // inner object starts after the two `{`
  const innerStart = openBraceOuter + 2;
  // find the matching `}}` for the object: track brace depth from innerStart
  let depth = 2; // we are inside two open braces
  let str: string | null = null;
  for (let i = innerStart; i < tagEnd + 2 && i < code.length; i++) {
    const c = code[i];
    if (str) {
      if (c === str && code[i - 1] !== '\\') str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') str = c;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 1) {
        // this `}` closes the object (one brace — the expression brace — remains)
        return { innerStart, innerEnd: i };
      }
    }
  }
  return null;
}

const LITERAL_RE = /^\s*('[^']*'|"[^"]*"|`[^`]*`|-?\d+(\.\d+)?(px|em|rem|%|vh|vw)?)\s*$/;

/** Parse the top-level properties of a style object body (between the braces). */
export function analyzeStyleProperties(objBody: string, baseOffset: number): StyleProperty[] {
  const props: StyleProperty[] = [];
  let i = 0;
  const n = objBody.length;
  let str: string | null = null;
  let depth = 0;
  let keyStart = -1;
  let colon = -1;
  const flush = (end: number): void => {
    if (keyStart >= 0 && colon >= 0) {
      const name = objBody.slice(keyStart, colon).replace(/['"]/g, '').trim();
      const raw = objBody.slice(colon + 1, end);
      if (name) {
        const trimmed = raw.trim();
        const lead = raw.length - raw.trimStart().length;
        // A template literal with `${...}` interpolation is DYNAMIC, not literal,
        // even though it is delimited by backticks — never let it be editable.
        const isLiteral = LITERAL_RE.test(raw) && !trimmed.includes('${');
        const valueStart = baseOffset + colon + 1 + lead;
        const valueEnd = valueStart + trimmed.length;
        props.push({
          name,
          raw: trimmed,
          literal: isLiteral,
          valueStart,
          valueEnd,
          memberStart: baseOffset + keyStart,
          memberEnd: valueEnd,
        });
      }
    }
    keyStart = -1;
    colon = -1;
  };
  for (; i < n; i++) {
    const c = objBody[i] as string;
    if (str) {
      if (c === str && objBody[i - 1] !== '\\') str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      str = c;
      continue;
    }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (depth === 0) {
      if (c === ':' && colon < 0) colon = i;
      else if (c === ',') {
        flush(i);
      } else if (keyStart < 0 && /\S/.test(c)) keyStart = i;
    }
  }
  flush(n);
  return props;
}

export interface StyleEditResult {
  code: string;
  changed: boolean;
  /** True if the edit was refused because the existing value is a JS expression. */
  dynamic: boolean;
  /**
   * D-A1: true ONLY when `setInlineStyle` took the APPEND branch — the
   * element's style object had no literal (and no dynamic expression) for this prop
   * before the write, e.g. it was absent entirely or spread-derived (`style={{
   * ...vars }}`). False/absent on a replace, a dynamic-value refusal, or a no-op.
   * Undo must know this: replaying the write with the prior value would find the
   * NOW-appended literal and REPLACE it — restoring a hardcoded value into a spot
   * the source never had one — instead of removing the prop to truly restore the
   * pre-edit source.
   */
  appended?: boolean;
  /**
   * Refused because the property's existing value is a CSS CUSTOM-PROPERTY
   * REFERENCE — `backgroundColor: 'var(--brand-color)'`. Carries the reference
   * text so the refusal can name the token the author would otherwise have lost.
   *
   * A `var()` is a literal string, so the dynamic-expression guard above never
   * saw it: an ordinary colour-picker commit rewrote a design-token binding to
   * `#ff0000`, silently, on one click. Guarding it is the same idiom for the
   * same reason — the source value is a REFERENCE, and replacing it with a
   * literal is a loss no widget can compose back.
   */
  tokenRef?: string;
}

/**
 * THE ONE SENTENCE a `var()` refusal is said in — the writer's error, the
 * adapter's console warning, and the inspector field's read-only reason are
 * all this string, so an author reads the same thing wherever they meet it.
 */
export function tokenReferenceGuardText(prop: string, tokenRef: string): string {
  return (
    `"${prop}" is a design-token reference (${tokenRef}) in this source, so replacing ` +
    'it with a literal is guarded — the binding would be lost and no widget can compose ' +
    'a var() back.'
  );
}

/** The `var(--token, …)` reference a style value's SOURCE TEXT contains, or
 *  `null`. Deliberately a scan of the whole value, not an equality test: a
 *  composed value (`'1px solid var(--line)'`) loses the reference just as
 *  completely when a widget overwrites it. */
export function customPropertyReference(valueText: string): string | null {
  return /var\(\s*--[A-Za-z0-9_-]+[^)]*\)/.exec(valueText)?.[0] ?? null;
}

/**
 * Set an inline style property on the element at `elementStart` (a `<`). Replaces a
 * literal value, refuses a dynamic one or a `var()` token reference (guards), or
 * appends a new property; inserts a `style={{…}}` if none exists. Other properties
 * are untouched.
 */
export function setInlineStyle(
  code: string,
  elementStart: number,
  prop: string,
  value: string | number,
): StyleEditResult {
  const tagEnd = findTagEnd(code, elementStart);
  if (tagEnd < 0) return { code, changed: false, dynamic: false };
  // Escape the value so a quote/backslash can't break source syntax.
  const valueText =
    typeof value === 'number'
      ? String(value)
      : `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const styleObj = findStyleObject(code, elementStart, tagEnd);

  if (styleObj) {
    const body = code.slice(styleObj.innerStart, styleObj.innerEnd);
    const props = analyzeStyleProperties(body, styleObj.innerStart);
    const existing = props.find((p) => p.name === prop);
    if (existing) {
      if (!existing.literal) return { code, changed: false, dynamic: true }; // guard
      // A literal that REFERENCES a design token is guarded too — see
      // `StyleEditResult.tokenRef`. `dynamic: false`: this is not an
      // expression, and calling it one would put the wrong sentence in front
      // of the author. The ONE sanctioned replacement is another token
      // reference: rebinding `var(--a)` → `var(--b)` is the compose gesture
      // the guard exists to protect (the destruction it prevents is a token
      // silently INLINED to a literal), so a new value that is itself a
      // `var()` passes through.
      const token = customPropertyReference(code.slice(existing.valueStart, existing.valueEnd));
      const rebinding = typeof value === 'string' && customPropertyReference(value) !== null;
      if (token && !rebinding) return { code, changed: false, dynamic: false, tokenRef: token };
      const next = code.slice(0, existing.valueStart) + valueText + code.slice(existing.valueEnd);
      return { code: next, changed: true, dynamic: false };
    }
    // append a property, preserving existing content
    const trimmedBody = body.trimEnd();
    const sep = trimmedBody.length === 0 ? '' : trimmedBody.endsWith(',') ? ' ' : ', ';
    const insertAt = styleObj.innerStart + trimmedBody.length;
    const next = `${code.slice(0, insertAt)}${sep}${prop}: ${valueText}${code.slice(insertAt)}`;
    return { code: next, changed: true, dynamic: false, appended: true };
  }

  // A whole-attribute dynamic style (`style={expr}`, single brace) exists but is
  // not an editable object literal — refuse rather than appending a duplicate attr.
  const openSeg = code.slice(elementStart, tagEnd);
  if (/style\s*=\s*\{/.test(openSeg)) {
    return { code, changed: false, dynamic: true };
  }

  // no style attr — insert before the tag end (handle self-closing `/>`)
  const selfClose = code[tagEnd - 1] === '/';
  const insertAt = selfClose ? tagEnd - 1 : tagEnd;
  const next = `${code.slice(0, insertAt)} style={{ ${prop}: ${valueText} }}${code.slice(insertAt)}`;
  return { code: next, changed: true, dynamic: false };
}

/**
 * D-A2: surgically REMOVE a literal `prop: value` entry from the
 * element's `style={{…}}` object at `elementStart` — the correct undo for a write
 * that took `setInlineStyle`'s APPEND branch (`appended: true`). Fixes up the
 * neighbouring separator/trailing comma so the remaining object stays
 * syntactically valid; if `prop` was the object's ONLY content, collapses to an
 * empty `style={{}}` rather than stripping the attribute entirely (keeps redo — a
 * plain re-append — trivially reversible, and avoids re-deriving the
 * whole-attribute insertion position `setInlineStyle`'s no-style-attr branch
 * uses). `changed: false` (and no-op) if `prop` isn't present as a literal member
 * at all — including a DYNAMIC member (mirrors `setInlineStyle`'s
 * literal-vs-dynamic guard: never remove an expression-bound value the caller
 * didn't write).
 */
export function removeInlineStyle(
  code: string,
  elementStart: number,
  prop: string,
): StyleEditResult {
  const tagEnd = findTagEnd(code, elementStart);
  if (tagEnd < 0) return { code, changed: false, dynamic: false };
  const styleObj = findStyleObject(code, elementStart, tagEnd);
  if (!styleObj) return { code, changed: false, dynamic: false }; // no style attr — nothing to remove

  const body = code.slice(styleObj.innerStart, styleObj.innerEnd);
  const props = analyzeStyleProperties(body, styleObj.innerStart);
  const existing = props.find((p) => p.name === prop);
  if (!existing) return { code, changed: false, dynamic: false }; // absent — nothing to remove
  if (!existing.literal) return { code, changed: false, dynamic: true }; // guard, mirrors setInlineStyle

  // Prefer consuming a comma that FOLLOWS this member (it precedes others in the
  // list); else one that PRECEDES it (it is last); else this was the ONLY thing in
  // the object — collapse to `{}` instead.
  let after = existing.memberEnd;
  while (after < styleObj.innerEnd && /\s/.test(code[after] ?? '')) after++;
  if (code[after] === ',') {
    let end = after + 1;
    if (code[end] === ' ') end++;
    return {
      code: code.slice(0, existing.memberStart) + code.slice(end),
      changed: true,
      dynamic: false,
    };
  }

  let before = existing.memberStart - 1;
  while (before >= styleObj.innerStart && /\s/.test(code[before] ?? '')) before--;
  if (code[before] === ',') {
    return {
      code: code.slice(0, before) + code.slice(existing.memberEnd),
      changed: true,
      dynamic: false,
    };
  }

  return {
    code: code.slice(0, styleObj.innerStart) + code.slice(styleObj.innerEnd),
    changed: true,
    dynamic: false,
  };
}

/**
 * Skip one `{…}` JSX expression container whole, from its opening brace to the
 * index AFTER the matching `}` (or `-1` when the file ends first).
 *
 * This is the ONLY place between two tags where a quote opens a string and
 * `//` / `/* *​/` open comments — see {@link findElementEnd}, whose walk
 * this exists to keep out of them.
 */
function skipJsxExpression(code: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < code.length) {
    const c = code[i];
    if (c === '/' && code[i + 1] === '/') {
      const newline = code.indexOf('\n', i);
      i = newline < 0 ? code.length : newline + 1;
      continue;
    }
    if (c === '/' && code[i + 1] === '*') {
      const close = code.indexOf('*/', i + 2);
      i = close < 0 ? code.length : close + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < code.length && !(code[i] === c && code[i - 1] !== '\\')) i++;
      i++;
      continue;
    }
    if (c === '{') {
      depth++;
      i++;
      continue;
    }
    if (c === '}') {
      depth--;
      i++;
      if (depth === 0) return i;
      continue;
    }
    // NESTED JSX — `{cond ? <div>the shot's takes</div> : null}`. Inside the
    // element the quotes are TEXT again, so the element is handed back to
    // `findElementEnd`, whose walk knows that; scanning it here would read
    // that apostrophe as a string exactly like the defect this pair fixes.
    // A `<` is only a tag in EXPRESSION-START position — after an identifier,
    // `)` or `]` it is the less-than operator (`a < b`), never JSX.
    if (c === '<' && opensNestedJsx(code, i)) {
      const elementEnd = findElementEnd(code, i);
      if (elementEnd > i) {
        i = elementEnd;
        continue;
      }
    }
    i++;
  }
  return -1;
}

/** Is the `<` at `i`, inside a `{…}` expression, the start of a JSX element? */
function opensNestedJsx(code: string, i: number): boolean {
  const next = code[i + 1];
  if (next === undefined || !(next === '>' || /[A-Za-z]/.test(next))) return false;
  let before = i - 1;
  while (before >= 0 && /\s/.test(code[before] ?? '')) before--;
  return !/[A-Za-z0-9_$)\]]/.test(code[before] ?? '');
}

/** `<` starts a TAG only before `/`, a name, `>` (a fragment) or `!`. Anything
 *  else is ordinary text this walk steps over one character at a time. */
function startsTag(code: string, i: number): boolean {
  const next = code[i + 1];
  return (
    next !== undefined && (next === '/' || next === '>' || next === '!' || /[A-Za-z]/.test(next))
  );
}

/**
 * Find the end (exclusive) of a full JSX element starting at `<Tag` — balancing
 * nested same-tag elements and skipping `{…}` expressions whole (C8).
 *
 * **A QUOTE BETWEEN TWO TAGS IS TEXT, NOT A STRING**, and reading it as one
 * destroyed source. This walk used to flip into "inside a string" on any `'`,
 * `"` or backtick it met, exactly as {@link findTagEnd} does INSIDE a tag —
 * but between tags those characters are JSX children, and an apostrophe is an
 * ordinary English one. Measured 2026-09-19 on the game template's own
 * `MainScene.tsx`: the JSX comment inside `<group name="Light Rig">` says
 * *"The sun's position… that component's header… than this scene's."* — three
 * apostrophes, so the walk was left mid-"string", never saw `</group>`, and
 * answered with the END OF THE FILE. Every consumer of that answer takes the
 * whole rest of the component: Delete on the Light Rig row would have removed
 * it, copy would have copied it, and `group` wrote a structurally broken file
 * (that is how this was found).
 *
 * So: enter a string only inside a `{…}` expression container, where
 * {@link skipJsxExpression} also handles `//` and block comments — which is
 * what makes a JSX comment's prose invisible to this walk — and step over any
 * OTHER element's opening tag with {@link findTagEnd}, so its attributes'
 * quotes and braces never reach here either. Only our own tag moves `depth`,
 * so another element's children stay in this walk and cost nothing.
 */
export function findElementEnd(code: string, start: number): number {
  const tagEnd = findTagEnd(code, start);
  if (tagEnd < 0) return -1;
  if (code[tagEnd - 1] === '/') return tagEnd + 1; // self-closing
  const tagNameMatch = code.slice(start + 1, tagEnd).match(/^([A-Za-z0-9_.]+)/);
  const tag = tagNameMatch?.[1];
  if (!tag) return -1;
  let depth = 1;
  let i = tagEnd + 1;
  while (i < code.length && depth > 0) {
    const c = code[i];
    if (c === '{') {
      const after = skipJsxExpression(code, i);
      i = after < 0 ? code.length : after;
      continue;
    }
    if (c !== '<' || !startsTag(code, i)) {
      i++;
      continue;
    }
    if (code.startsWith(`</${tag}`, i)) {
      depth--;
      const close = code.indexOf('>', i);
      i = close < 0 ? code.length : close + 1;
      if (depth === 0) return i;
      continue;
    }
    if (code.startsWith(`<${tag}`, i) && /[\s/>]/.test(code[i + 1 + tag.length] ?? '')) {
      // A nested SAME-TAG element: only a non-self-closing one increments depth.
      // A self-closing `<tag .../>` opens+closes in one tag and must NOT bump depth
      // (else the balancer runs past the real closing tag and over-deletes).
      const nestedTagEnd = findTagEnd(code, i);
      if (nestedTagEnd < 0) {
        // An unreadable opening tag is still an OPEN one: count it and step
        // past the name. Returning here would end the element at its own first
        // child, which is a worse answer than the imperfect scan.
        depth++;
        i += 1 + tag.length;
        continue;
      }
      if (code[nestedTagEnd - 1] !== '/') depth++;
      i = nestedTagEnd + 1;
      continue;
    }
    const otherTagEnd = findTagEnd(code, i);
    i = otherTagEnd < 0 ? i + 1 : otherTagEnd + 1;
  }
  return i;
}

// --- F5: multi-path style routing (inline handled above; className below) ---

/**
 * Encode a CSS prop:value as a Tailwind-style utility class. Numeric/color values
 * use ARBITRARY values (`w-[200px]`, `bg-[#059669]`) so the round-trip is LOSSLESS
 * (a named utility like `bg-emerald-600` would NOT recover the exact hex). Enums map
 * to named utilities.
 */
// Cap 6 (React visual-edit parity): broadened to the grouped-inspector property set. Enum
// values map to NAMED utilities; each named utility string is unique across groups so the
// ENUM_GROUP reverse map (dedupe) stays unambiguous.
const ENUM_UTILITIES: Record<string, Record<string, string>> = {
  display: {
    flex: 'flex',
    block: 'block',
    grid: 'grid',
    inline: 'inline',
    'inline-block': 'inline-block',
    'inline-flex': 'inline-flex',
    none: 'hidden',
  },
  flexDirection: {
    row: 'flex-row',
    column: 'flex-col',
    'row-reverse': 'flex-row-reverse',
    'column-reverse': 'flex-col-reverse',
  },
  flexWrap: { wrap: 'flex-wrap', nowrap: 'flex-nowrap', 'wrap-reverse': 'flex-wrap-reverse' },
  justifyContent: {
    'flex-start': 'justify-start',
    'flex-end': 'justify-end',
    center: 'justify-center',
    'space-between': 'justify-between',
    'space-around': 'justify-around',
    'space-evenly': 'justify-evenly',
  },
  alignItems: {
    'flex-start': 'items-start',
    'flex-end': 'items-end',
    center: 'items-center',
    baseline: 'items-baseline',
    stretch: 'items-stretch',
  },
  textAlign: {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
    justify: 'text-justify',
  },
  position: {
    relative: 'relative',
    absolute: 'absolute',
    fixed: 'fixed',
    sticky: 'sticky',
    static: 'static',
  },
  overflow: {
    visible: 'overflow-visible',
    hidden: 'overflow-hidden',
    scroll: 'overflow-scroll',
    auto: 'overflow-auto',
  },
  borderStyle: {
    none: 'border-none',
    solid: 'border-solid',
    dashed: 'border-dashed',
    dotted: 'border-dotted',
    double: 'border-double',
  },
  textTransform: {
    uppercase: 'uppercase',
    lowercase: 'lowercase',
    capitalize: 'capitalize',
    none: 'normal-case',
  },
  whiteSpace: {
    normal: 'whitespace-normal',
    nowrap: 'whitespace-nowrap',
    pre: 'whitespace-pre',
    'pre-wrap': 'whitespace-pre-wrap',
  },
  fontStyle: { italic: 'italic', normal: 'not-italic' },
  mixBlendMode: {
    normal: 'mix-blend-normal',
    multiply: 'mix-blend-multiply',
    screen: 'mix-blend-screen',
    overlay: 'mix-blend-overlay',
  },
};
// Reverse map: a named utility -> its logical group (for dedupe of enum utilities).
const ENUM_GROUP: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [group, m] of Object.entries(ENUM_UTILITIES))
    for (const u of Object.values(m)) out[u] = group;
  return out;
})();
// Arbitrary-value utilities. `color`/`fontSize` both map to `text-`, so they use
// Tailwind TYPE HINTS (`text-[color:..]` vs `text-[length:..]`) to disambiguate —
// which also makes property-based dedupe unambiguous.
const ARB_MAP: Record<string, { prefix: string; hint?: 'color' | 'length' }> = {
  backgroundColor: { prefix: 'bg' },
  // `border` covers both border-color and border-width, so — like `text-` — they use type
  // hints to stay unambiguous for property-based dedupe (Cap 6).
  borderColor: { prefix: 'border', hint: 'color' },
  borderWidth: { prefix: 'border', hint: 'length' },
  color: { prefix: 'text', hint: 'color' },
  fontSize: { prefix: 'text', hint: 'length' },
  width: { prefix: 'w' },
  height: { prefix: 'h' },
  minWidth: { prefix: 'min-w' },
  minHeight: { prefix: 'min-h' },
  maxWidth: { prefix: 'max-w' },
  maxHeight: { prefix: 'max-h' },
  padding: { prefix: 'p' },
  paddingTop: { prefix: 'pt' },
  paddingRight: { prefix: 'pr' },
  paddingBottom: { prefix: 'pb' },
  paddingLeft: { prefix: 'pl' },
  margin: { prefix: 'm' },
  marginTop: { prefix: 'mt' },
  marginRight: { prefix: 'mr' },
  marginBottom: { prefix: 'mb' },
  marginLeft: { prefix: 'ml' },
  top: { prefix: 'top' },
  right: { prefix: 'right' },
  bottom: { prefix: 'bottom' },
  left: { prefix: 'left' },
  borderRadius: { prefix: 'rounded' },
  borderTopLeftRadius: { prefix: 'rounded-tl' },
  borderTopRightRadius: { prefix: 'rounded-tr' },
  borderBottomLeftRadius: { prefix: 'rounded-bl' },
  borderBottomRightRadius: { prefix: 'rounded-br' },
  gap: { prefix: 'gap' },
  fontWeight: { prefix: 'font' },
  lineHeight: { prefix: 'leading' },
  letterSpacing: { prefix: 'tracking' },
  flexBasis: { prefix: 'basis' },
  opacity: { prefix: 'opacity' },
  zIndex: { prefix: 'z' },
  boxShadow: { prefix: 'shadow' },
};

const sanitizeClass = (s: string): string => s.replace(/\s+/g, '_');

/** Encode a CSS prop:value as a lossless Tailwind-style utility class. */
export function cssToUtilityClass(prop: string, value: string | number): string {
  const v = String(value);
  if (ENUM_UTILITIES[prop]?.[v]) return ENUM_UTILITIES[prop][v] as string;
  const arb = ARB_MAP[prop];
  if (!arb) return `[${sanitizeClass(prop)}:${sanitizeClass(v)}]`; // arbitrary property — lossless
  const val = typeof value === 'number' ? `${value}px` : v;
  const inner = arb.hint ? `${arb.hint}:${sanitizeClass(val)}` : sanitizeClass(val);
  return `${arb.prefix}-[${inner}]`;
}

/** The dedupe group of an existing utility class (so a re-set replaces same-property classes). */
function classGroup(cls: string): string {
  if (ENUM_GROUP[cls]) return ENUM_GROUP[cls];
  const arb =
    cls.indexOf('-[') >= 0 ? cls.slice(0, cls.indexOf('-[') + 2) : cls.startsWith('[') ? '[' : '';
  if (!arb) return cls;
  // include a type hint (color:/length:) in the group so text-[color:..] != text-[length:..]
  const hintMatch = cls.match(/\[(color|length):/);
  return hintMatch ? `${arb}${hintMatch[1]}:` : arb;
}

/**
 * Merge a class into the element's `className="..."` literal, or add the
 * attribute.
 *
 * D-A1 assessment: unlike `setInlineStyle`, this function has NO
 * distinguishable append-vs-replace branch to surface as `appended` — it
 * always does the SAME operation (filter out any class in the target's dedupe
 * GROUP, then push the new class), regardless of whether a same-group class
 * existed before. Scoped OUT of this wave's fix: see the design doc's SHIPPED
 * note for why the className route's undo correctness is a separate, broader
 * pre-existing gap, not this bug.
 */
export function setClassName(code: string, elementStart: number, cls: string): StyleEditResult {
  const tagEnd = findTagEnd(code, elementStart);
  if (tagEnd < 0) return { code, changed: false, dynamic: false };
  const openSeg = code.slice(elementStart, tagEnd);
  const m = openSeg.match(/className\s*=\s*"([^"]*)"/);
  if (m && m.index != null) {
    // dedupe by PROPERTY GROUP (not raw prefix) so re-setting any prop replaces its
    // prior class — incl. color-vs-fontSize (both `text-`) and enum/arbitrary-prop.
    const group = classGroup(cls);
    const existing = (m[1] ?? '')
      .split(/\s+/)
      .filter((c) => c && c !== cls && classGroup(c) !== group);
    const merged = [...existing, cls].join(' ').trim();
    const valStart = elementStart + (m.index ?? 0) + m[0].indexOf('"') + 1;
    const valEnd = valStart + (m[1]?.length ?? 0);
    return {
      code: `${code.slice(0, valStart)}${merged}${code.slice(valEnd)}`,
      changed: true,
      dynamic: false,
    };
  }
  if (/className\s*=\s*\{/.test(openSeg)) return { code, changed: false, dynamic: true }; // dynamic className
  const selfClose = code[tagEnd - 1] === '/';
  const insertAt = selfClose ? tagEnd - 1 : tagEnd;
  return {
    code: `${code.slice(0, insertAt)} className="${cls}"${code.slice(insertAt)}`,
    changed: true,
    dynamic: false,
  };
}

/**
 * Route a style edit to the right target (F5). TWO conditions gate the class
 * route, and the second one is the whole point:
 *
 *  1. the element has a literal `className` the class can be merged into, AND
 *  2. the PROJECT was observed to interpret utility classes
 *     (`support.supported` — see `utility-class-support.ts` for the probe and
 *     why it is strict).
 *
 * Without (2) a `bg-[#059669]` written into a plain-CSS project is inert: it
 * paints nothing in the editor after a remount and nothing in the game's own
 * build, because no transformer exists on either side to compile it. So no
 * evidence ⇒ the inline `style={{…}}` route, which paints in EVERY project,
 * leaving the element's literal className untouched.
 *
 * When neither target is honest — the element's style attribute is a dynamic
 * expression and there is no compiled class route to fall back to — this
 * REFUSES with a named reason (`changed: false`, `dynamic: true`, `error`)
 * rather than writing bytes that never paint.
 */
export function writeStyleAuto(
  code: string,
  elementStart: number,
  prop: string,
  value: string | number,
  support: UtilityClassSupport = UTILITY_CLASSES_UNPROVEN,
): StyleEditResult & { route: 'class' | 'inline'; error?: string } {
  const tagEnd = findTagEnd(code, elementStart);
  const openSeg = tagEnd > 0 ? code.slice(elementStart, tagEnd) : '';
  const inline = setInlineStyle(code, elementStart, prop, value);
  // THE TOKEN GUARD SITS AHEAD OF THE CLASS ROUTE. An inline `var()` beats any
  // utility class, so routing around it would write a class that never paints
  // — the very outcome the refusal below exists to prevent — while leaving the
  // author with no sign their token binding was ignored.
  if (inline.tokenRef) {
    return {
      ...inline,
      route: 'inline',
      error: tokenReferenceGuardText(prop, inline.tokenRef),
    };
  }
  if (support.supported && /className\s*=\s*"/.test(openSeg)) {
    return { ...setClassName(code, elementStart, cssToUtilityClass(prop, value)), route: 'class' };
  }
  if (!inline.changed && inline.dynamic) {
    const why = support.supported
      ? 'the element has no literal className to carry a utility class'
      : `this project does not compile utility classes (${support.evidence})`;
    return {
      ...inline,
      route: 'inline',
      error:
        `no honest target for "${prop}": the element's style is a dynamic expression and ` +
        `${why} — refusing rather than writing source that never paints.`,
    };
  }
  return { ...inline, route: 'inline' };
}

// --- Cap 2: CSS-file editing (visual-edit writer.ts surgicalCssEdit :1109) ---

/** camelCase CSS prop -> kebab-case, for matching a declaration in a CSS rule body. */
export function cssCamelToKebab(s: string): string {
  return s.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/** Find a standalone occurrence of `selectorText` in CSS source (not a substring of a
 *  longer selector). Returns the index or -1. */
function findSelectorIndex(cssSource: string, selectorText: string): number {
  let searchFrom = 0;
  while (searchFrom < cssSource.length) {
    const idx = cssSource.indexOf(selectorText, searchFrom);
    if (idx === -1) break;
    const before = idx > 0 ? cssSource[idx - 1] : '\n';
    if (idx === 0 || /[\s\n{},;]/.test(before ?? '')) {
      const after = cssSource[idx + selectorText.length];
      if (after === '{' || after === ' ' || after === '\n' || after === '\r' || after === '\t') {
        return idx;
      }
    }
    searchFrom = idx + 1;
  }
  return -1;
}

/** The `{ … }` body range of the rule whose selector starts at `selectorIdx`, or null. */
function findRuleBody(
  cssSource: string,
  selectorIdx: number,
  selectorText: string,
): { bodyStart: number; bodyEnd: number } | null {
  let i = selectorIdx + selectorText.length;
  while (i < cssSource.length && cssSource[i] !== '{') i++;
  if (i >= cssSource.length) return null;
  const bodyStart = i + 1;
  let depth = 1;
  i++;
  while (i < cssSource.length && depth > 0) {
    if (cssSource[i] === '{') depth++;
    else if (cssSource[i] === '}') depth--;
    if (depth > 0) i++;
  }
  return { bodyStart, bodyEnd: i };
}

/**
 * Surgically replace (or append) a property value inside a CSS RULE BODY, editing the
 * source in place and preserving all other declarations/formatting (visual-edit
 * `surgicalCssEdit` :1109). Returns the edited source, or `null` when the selector is not
 * present in the file (i.e. it's GENERATED CSS — a Tailwind utility, styled-components —
 * that must not be hand-edited; the caller falls back to class/inline routing).
 */
export function surgicalCssEdit(
  cssSource: string,
  selectorText: string,
  propName: string,
  newValue: string,
): string | null {
  const selectorIdx = findSelectorIndex(cssSource, selectorText);
  if (selectorIdx === -1) return null;
  const rng = findRuleBody(cssSource, selectorIdx, selectorText);
  if (!rng) return null;
  const { bodyStart, bodyEnd } = rng;
  const body = cssSource.slice(bodyStart, bodyEnd);

  const kebabProp = cssCamelToKebab(propName);
  const escaped = kebabProp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const propRegex = new RegExp(`(^|[;\\n\\s])\\s*(${escaped})\\s*:`, 'm');
  const match = propRegex.exec(body);

  if (match) {
    const matchStart = bodyStart + match.index + match[0].length; // right after the ':'
    let valEnd = matchStart;
    while (valEnd < bodyEnd && cssSource[valEnd] !== ';' && cssSource[valEnd] !== '}') valEnd++;
    return `${cssSource.slice(0, matchStart)} ${newValue}${cssSource.slice(valEnd)}`;
  }

  // Property absent — append it before the closing '}', matching existing indentation.
  let indent = '  ';
  for (const line of body.split('\n')) {
    if (line.trim().includes(':')) {
      indent = line.match(/^(\s*)/)?.[1] ?? indent;
      break;
    }
  }
  const trimmed = body.trimEnd();
  const needsSemi = trimmed.length > 0 && !trimmed.endsWith(';');
  const insertion = `${needsSemi ? ';\n' : '\n'}${indent}${kebabProp}: ${newValue};\n`;
  return cssSource.slice(0, bodyEnd) + insertion + cssSource.slice(bodyEnd);
}

/**
 * The breakpoint write (design ledger: breakpoints): surgically edit — or
 * create — `selector`'s rule INSIDE a top-level `@media <media>` block,
 * creating the block itself when the stylesheet has none. The source keeps
 * real `@media` truth; the dev server's serve-time rewrite is what turns it
 * into a per-frame container query for preview. Conditions compare
 * whitespace-normalized, so `(max-width:767px)` finds `(max-width: 767px)`.
 */
export function surgicalCssEditInMedia(
  cssSource: string,
  media: string,
  selectorText: string,
  propName: string,
  newValue: string,
): string {
  const kebabProp = cssCamelToKebab(propName);
  const normalize = (t: string): string => t.replace(/\s+/g, ' ').trim();
  const wanted = normalize(media);
  // Find a top-level @media block with the same condition.
  const mediaRe = /@media([^{]+)\{/g;
  let match = mediaRe.exec(cssSource);
  while (match) {
    if (normalize(match[1] ?? '') === wanted) {
      // Block body range by brace balance.
      let depth = 1;
      let i = match.index + match[0].length;
      while (i < cssSource.length && depth > 0) {
        if (cssSource[i] === '{') depth++;
        else if (cssSource[i] === '}') depth--;
        if (depth > 0) i++;
      }
      const bodyStart = match.index + match[0].length;
      const bodyEnd = i;
      const body = cssSource.slice(bodyStart, bodyEnd);
      const editedBody = surgicalCssEdit(body, selectorText, propName, newValue);
      if (editedBody !== null) {
        return cssSource.slice(0, bodyStart) + editedBody + cssSource.slice(bodyEnd);
      }
      // Selector absent inside the block — insert a fresh rule before its `}`.
      const insertion = `  ${selectorText} {\n    ${kebabProp}: ${newValue};\n  }\n`;
      const needsNl = bodyEnd > bodyStart && cssSource[bodyEnd - 1] !== '\n';
      return (
        cssSource.slice(0, bodyEnd) + (needsNl ? '\n' : '') + insertion + cssSource.slice(bodyEnd)
      );
    }
    match = mediaRe.exec(cssSource);
  }
  // No block with this condition — append one.
  const lead = cssSource.length === 0 || cssSource.endsWith('\n') ? '' : '\n';
  return (
    `${cssSource}${lead}\n@media ${media.trim()} {\n` +
    `  ${selectorText} {\n    ${kebabProp}: ${newValue};\n  }\n}\n`
  );
}

/** A matched CSS rule as produced by `inspect.ts`'s `getMatchedCssRules` — the subset the
 *  CSS write path needs. */
export interface CssRuleTarget {
  selectorText: string;
  sourceFile: string;
  properties: Record<string, string>;
}

/**
 * Pick the target rule for a property write: the LAST matched rule that declares the
 * property (cascade — last declaration wins), mirroring visual-edit `writeCssRuleChange`
 * :1198. Returns the rule + the prior value (for the undo inverse), or null when no
 * matched rule declares the property (⇒ caller routes to class/inline instead).
 */
export function pickCssRuleTarget(
  matchedRules: readonly CssRuleTarget[],
  prop: string,
): { rule: CssRuleTarget; prevValue: string } | null {
  const kebabProp = cssCamelToKebab(prop);
  let target: CssRuleTarget | null = null;
  for (const rule of matchedRules) {
    if (kebabProp in rule.properties) target = rule;
  }
  if (!target) return null;
  return { rule: target, prevValue: target.properties[kebabProp] ?? '' };
}

/**
 * The element's NAMED STYLE, if it wears one: the LAST matched first-party rule
 * whose selector is exactly one of the element's own classes (`.chip`). This is
 * the Webflow-shaped routing extension to {@link pickCssRuleTarget}: once an
 * element carries a named style, a property the class does not declare YET
 * should land IN the class (surgicalCssEdit appends absent declarations), so
 * the class stays the element's one style home instead of new edits forking
 * back to inline. Only consulted when no matched rule declares the property and
 * the element has no inline declaration of it (inline would win the cascade and
 * the appended declaration would never paint).
 */
export function namedStyleRuleFor(
  matchedRules: readonly CssRuleTarget[],
  classList: readonly string[],
): CssRuleTarget | null {
  let target: CssRuleTarget | null = null;
  for (const rule of matchedRules) {
    const selector = rule.selectorText.trim();
    if (classList.some((cls) => selector === `.${cls}`)) target = rule;
  }
  return target;
}

/** A literal inline-style member, ready to move into a class rule. */
export interface LiteralInlineStyle {
  /** The JSX member name (camelCase, e.g. `fontSize`). */
  name: string;
  /** The literal value text as authored (quotes included for strings). */
  raw: string;
}

/**
 * The element's LITERAL inline-style members — the declarations
 * "create a named style from this selection" moves into the new class rule.
 * Dynamic members (expressions, interpolated templates) are simply not listed:
 * they are not the writer's to move, and leaving them inline is correct
 * (the element keeps them, cascade-above the class).
 * Empty when there is no literal `style={{…}}` at all.
 */
export function collectLiteralInlineStyles(
  code: string,
  elementStart: number,
): LiteralInlineStyle[] {
  const tagEnd = findTagEnd(code, elementStart);
  if (tagEnd < 0) return [];
  const styleObj = findStyleObject(code, elementStart, tagEnd);
  if (!styleObj) return [];
  const body = code.slice(styleObj.innerStart, styleObj.innerEnd);
  return analyzeStyleProperties(body, styleObj.innerStart)
    .filter((p) => p.literal)
    .map((p) => ({ name: p.name, raw: p.raw }));
}

/**
 * Add ONE class token to a literal `className` (inserting the attribute when
 * absent) — the named-style APPLY gesture. Unlike {@link setClassName} there is
 * no utility-group dedupe: a named style is an identity, not a per-property
 * utility, and applying `.chip` must never evict `.card`. No-op when the token
 * is already present; `dynamic: true` refusal on a `className={expr}`.
 */
export function addClassNameToken(
  code: string,
  elementStart: number,
  cls: string,
): StyleEditResult {
  const tagEnd = findTagEnd(code, elementStart);
  if (tagEnd < 0) return { code, changed: false, dynamic: false };
  const openSeg = code.slice(elementStart, tagEnd);
  const m = openSeg.match(/className\s*=\s*"([^"]*)"/);
  if (m && m.index != null) {
    const existing = (m[1] ?? '').split(/\s+/).filter(Boolean);
    if (existing.includes(cls)) return { code, changed: false, dynamic: false };
    const merged = [...existing, cls].join(' ');
    const valStart = elementStart + m.index + m[0].indexOf('"') + 1;
    const valEnd = valStart + (m[1]?.length ?? 0);
    return {
      code: `${code.slice(0, valStart)}${merged}${code.slice(valEnd)}`,
      changed: true,
      dynamic: false,
    };
  }
  if (/className\s*=\s*\{/.test(openSeg)) return { code, changed: false, dynamic: true };
  const selfClose = code[tagEnd - 1] === '/';
  const insertAt = selfClose ? tagEnd - 1 : tagEnd;
  return {
    code: `${code.slice(0, insertAt)} className="${cls}"${code.slice(insertAt)}`,
    changed: true,
    dynamic: false,
  };
}

/**
 * Remove ONE class token from a literal `className` — dropping the attribute
 * entirely when it empties (an empty `className=""` is authored noise). No-op
 * when the token is absent; `dynamic: true` refusal on a `className={expr}`.
 */
export function removeClassNameToken(
  code: string,
  elementStart: number,
  cls: string,
): StyleEditResult {
  const tagEnd = findTagEnd(code, elementStart);
  if (tagEnd < 0) return { code, changed: false, dynamic: false };
  const openSeg = code.slice(elementStart, tagEnd);
  const m = openSeg.match(/className\s*=\s*"([^"]*)"/);
  if (!m || m.index == null) {
    return /className\s*=\s*\{/.test(openSeg)
      ? { code, changed: false, dynamic: true }
      : { code, changed: false, dynamic: false };
  }
  const existing = (m[1] ?? '').split(/\s+/).filter(Boolean);
  if (!existing.includes(cls)) return { code, changed: false, dynamic: false };
  const remaining = existing.filter((c) => c !== cls);
  if (remaining.length > 0) {
    const valStart = elementStart + m.index + m[0].indexOf('"') + 1;
    const valEnd = valStart + (m[1]?.length ?? 0);
    return {
      code: `${code.slice(0, valStart)}${remaining.join(' ')}${code.slice(valEnd)}`,
      changed: true,
      dynamic: false,
    };
  }
  // Attribute empties — remove it, and the one space that separated it.
  let attrStart = elementStart + m.index;
  while (attrStart > elementStart && /\s/.test(code[attrStart - 1] ?? '')) attrStart--;
  const attrEnd = elementStart + m.index + m[0].length;
  return { code: code.slice(0, attrStart) + code.slice(attrEnd), changed: true, dynamic: false };
}

// --- Cap 3: text-content editing (visual-edit writer.ts getEditableText :817 /
//     editTextContent :861) ---

/** The `<`-relative content range (between the opening tag's `>` and the closing `</`)
 *  of the element at `elementStart`, plus whether it is a pure-text (editable) body. */
function findTextContentRange(
  code: string,
  elementStart: number,
): { contentStart: number; closingTagStart: number; content: string } | null {
  if (code[elementStart] !== '<') return null;
  const tagEnd = findTagEnd(code, elementStart);
  if (tagEnd < 0 || code[tagEnd - 1] === '/') return null; // self-closing ⇒ no text body
  const contentStart = tagEnd + 1;
  const elementEnd = findElementEnd(code, elementStart);
  if (elementEnd < 0) return null;
  // The closing tag is the last `</` before elementEnd.
  let closingTagStart = elementEnd - 1;
  while (
    closingTagStart > contentStart &&
    !(code[closingTagStart] === '<' && code[closingTagStart + 1] === '/')
  ) {
    closingTagStart--;
  }
  return { contentStart, closingTagStart, content: code.slice(contentStart, closingTagStart) };
}

/**
 * Return an element's editable text — its content trimmed — IFF the body is pure text (no
 * `{expression}` and no child `<element>`); else null (visual-edit `getEditableText` :817).
 * This is the double-click-to-edit gate: only a leaf text node is editable in place.
 */
export function getEditableText(code: string, elementStart: number): string | null {
  const rng = findTextContentRange(code, elementStart);
  if (!rng) return null;
  if (rng.content.includes('{') || rng.content.includes('<')) return null; // dynamic/children
  const trimmed = rng.content.trim();
  return trimmed ? trimmed : null;
}

/** Escape the JSX-structural characters so replacement text can't break the source tree
 *  (`<`/`{`/`}` become entities; `&` first so we don't double-encode). */
function escapeJsxText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}

/**
 * Replace an element's text content in place, preserving the surrounding whitespace
 * (only the trimmed text portion is swapped — visual-edit `editTextContent` :861). Refuses
 * (guard) when the body is not pure text (`dynamic: true`), exactly like the read gate.
 */
export function editTextContent(
  code: string,
  elementStart: number,
  newText: string,
): StyleEditResult {
  const rng = findTextContentRange(code, elementStart);
  if (!rng) return { code, changed: false, dynamic: false };
  const { contentStart, closingTagStart, content } = rng;
  if (content.includes('{') || content.includes('<'))
    return { code, changed: false, dynamic: true };
  const leading = content.length - content.trimStart().length;
  const trailing = content.length - content.trimEnd().length;
  const replaceStart = contentStart + leading;
  const replaceEnd = closingTagStart - trailing;
  const next = code.slice(0, replaceStart) + escapeJsxText(newText) + code.slice(replaceEnd);
  return { code: next, changed: next !== code, dynamic: false };
}

// --- Cap 4: JSX prop / attribute editing (visual-edit writer.ts analyzeJsxAttributes
//     :913 / writePropChange :1018 / fetchPropAnalysis :1069) ---

export interface JsxAttrInfo {
  name: string;
  /** Value char range in `code` (exclusive of quotes/braces). -1 for a boolean shorthand. */
  valueStart: number;
  valueEnd: number;
  rawValue: string;
  /** True if the value is a `{…}` expression container (vs a `"…"` string). */
  isExpression: boolean;
  /** True if the value is a literal we can safely rewrite (string, number, boolean). */
  isLiteral: boolean;
  /** Byte range of the WHOLE attribute (`speed={2}`), name included — the unit
   *  {@link removePropAttribute} deletes. */
  attrStart: number;
  attrEnd: number;
}

/** Skip a `{…}` region (spread or expression), respecting nested braces + strings. Returns
 *  the index just past the matching `}`. */
function skipBraces(code: string, from: number): number {
  let i = from + 1;
  let depth = 1;
  let inStr: string | null = null;
  while (i < code.length && depth > 0) {
    const ch = code[i];
    if (inStr) {
      if (ch === inStr && code[i - 1] !== '\\') inStr = null;
    } else if (ch === "'" || ch === '"' || ch === '`') inStr = ch;
    else if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  return i;
}

/** Read a quoted string value starting at the opening quote; returns [valueStart, valueEnd,
 *  indexAfterClosingQuote]. */
function readQuotedValue(code: string, openQuote: number, delim: string): [number, number, number] {
  let i = openQuote + 1;
  const valueStart = i;
  while (i < code.length && code[i] !== delim) {
    if (code[i] === '\\') i++;
    i++;
  }
  return [valueStart, i, i + 1];
}

const NUMBER_LITERAL_SOURCE = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;
const NUMBER_LITERAL_RE = new RegExp(`^${NUMBER_LITERAL_SOURCE}$`);

/**
 * A NUMBER-TUPLE literal (`[0, 1.5, 0]`, any arity incl. empty,
 * ints/floats/negatives, whitespace/newlines/trailing comma tolerated). This
 * is the 3D value shape R3F props use for
 * `position`/`rotation`/`scale`/`args`; a tuple containing anything but a
 * plain signed number literal (`[x, 1, 0]`, `[f(), 0]`) is DYNAMIC and stays
 * behind the literal-vs-dynamic guard.
 */
export function isNumberTupleLiteral(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return false;
  const inner = trimmed.slice(1, -1).trim();
  if (inner === '') return true; // empty tuple — degenerate but literal
  const parts = inner.split(',').map((p) => p.trim());
  // A trailing comma yields one empty final part — tolerate exactly that.
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return parts.every((p) => NUMBER_LITERAL_RE.test(p));
}

const LITERAL_EXPR_RE = new RegExp(`^(?:${NUMBER_LITERAL_SOURCE}|true|false|'[^']*'|"[^"]*")$`);

/**
 * Parse the attributes of a JSX opening tag `<Tag …>` (visual-edit `analyzeJsxAttributes`
 * :913). Handles string values, `{expression}` values (literal detection), boolean
 * shorthand, and `{...spread}` (skipped). Pure string scan — no parser.
 */
export function analyzeJsxAttributes(
  code: string,
  tagStart: number,
  tagEnd: number,
): JsxAttrInfo[] {
  const attrs: JsxAttrInfo[] = [];
  const skipWs = (i: number): number => {
    while (i <= tagEnd && /\s/.test(code[i] ?? '')) i++;
    return i;
  };
  let i = tagStart + 1; // skip '<'
  while (i <= tagEnd && !/[\s>/]/.test(code[i] ?? '>')) i++; // skip tag name

  while (i <= tagEnd) {
    i = skipWs(i);
    if (i > tagEnd || code[i] === '>' || (code[i] === '/' && code[i + 1] === '>')) break;
    if (code[i] === '{') {
      i = skipBraces(code, i); // {...spread}
      continue;
    }
    const nameStart = i;
    while (i <= tagEnd && /[\w-]/.test(code[i] ?? '')) i++;
    const name = code.slice(nameStart, i);
    if (!name) {
      i++;
      continue;
    }
    const nameEnd = i;
    i = skipWs(i);
    if (code[i] !== '=') {
      attrs.push(booleanShorthand(name, nameStart, nameEnd)); // e.g. `disabled`
      continue;
    }
    i = skipWs(i + 1); // skip '=' + whitespace
    const parsed = readAttrValue(code, i);
    if (!parsed) {
      i++;
      continue;
    }
    attrs.push(makeAttr(code, name, parsed, nameStart));
    i = parsed.next;
  }
  return attrs;
}

/** A boolean-shorthand attribute descriptor (`disabled` ⇒ `true`, no value range). */
function booleanShorthand(name: string, attrStart: number, attrEnd: number): JsxAttrInfo {
  return {
    name,
    valueStart: -1,
    valueEnd: -1,
    rawValue: 'true',
    isExpression: false,
    isLiteral: true,
    attrStart,
    attrEnd,
  };
}

/** Read an attribute value starting at `i` (the delimiter after `=`). Returns the value
 *  range + whether it's an expression + the index past it, or null for an unrecognized
 *  delimiter (the caller advances one char). */
function readAttrValue(
  code: string,
  i: number,
): { valueStart: number; valueEnd: number; isExpression: boolean; next: number } | null {
  const delim = code[i];
  if (delim === '"' || delim === "'") {
    const [valueStart, valueEnd, next] = readQuotedValue(code, i, delim);
    return { valueStart, valueEnd, isExpression: false, next };
  }
  if (delim === '{') {
    const valueEnd = skipBraces(code, i) - 1;
    return { valueStart: i + 1, valueEnd, isExpression: true, next: valueEnd + 1 };
  }
  return null;
}

/** Build a `JsxAttrInfo` from a parsed value range (computes rawValue + literal flag). */
function makeAttr(
  code: string,
  name: string,
  parsed: { valueStart: number; valueEnd: number; isExpression: boolean; next: number },
  attrStart: number,
): JsxAttrInfo {
  const rawValue = code.slice(parsed.valueStart, parsed.valueEnd).trim();
  const isLiteral =
    !parsed.isExpression || LITERAL_EXPR_RE.test(rawValue) || isNumberTupleLiteral(rawValue);
  return {
    name,
    valueStart: parsed.valueStart,
    valueEnd: parsed.valueEnd,
    rawValue,
    isExpression: parsed.isExpression,
    isLiteral,
    attrStart,
    attrEnd: parsed.next,
  };
}

/** Props never surfaced as editable component props (visual-edit `fetchPropAnalysis` skip
 *  set + on* handlers — event handlers are always dynamic). */
const PROP_SKIP = new Set(['key', 'ref', 'data-oid', 'style', 'className', 'children']);
const isSkippedProp = (name: string): boolean => PROP_SKIP.has(name) || /^on[A-Z]/.test(name);

/** Split a component's JSX attributes into editable (literal) vs dynamic (expression) —
 *  the Props inspector uses this to gate which props can be written (visual-edit
 *  `fetchPropAnalysis` :1069). */
export function analyzeProps(
  code: string,
  elementStart: number,
): { editable: string[]; dynamic: string[] } {
  const empty = { editable: [], dynamic: [] };
  if (code[elementStart] !== '<') return empty;
  const tagEnd = findTagEnd(code, elementStart);
  if (tagEnd < 0) return empty;
  const editable: string[] = [];
  const dynamic: string[] = [];
  for (const attr of analyzeJsxAttributes(code, elementStart, tagEnd)) {
    if (isSkippedProp(attr.name)) continue;
    (attr.isLiteral ? editable : dynamic).push(attr.name);
  }
  return { editable, dynamic };
}

/** Format the replacement for a prop write, matching the original value's shape (number/
 *  boolean/tuple/quoted expression, or a plain string attribute). Returns `null` when the
 *  new value cannot take the original's shape (a non-tuple replacing a tuple) — the caller
 *  refuses rather than clobbering a structured literal with a quoted string.
 *
 *  `allowShapeUpgrade` (R2 — OPT-IN, default off so react-dom and every existing path are
 *  byte-identical): permits exactly ONE shape change — a plain number literal replaced by
 *  a number-TUPLE literal for the same prop (the R3F `scale={1.5}` scalar shorthand
 *  upgraded to `scale={[x, y, z]}` by a non-uniform gizmo drag). Dynamic values stay
 *  refused upstream (the `isLiteral` guard in {@link writePropChange} runs before this
 *  function is ever reached), and no other shape pair is upgraded. */
function formatPropReplacement(
  attr: JsxAttrInfo,
  newValue: string,
  allowShapeUpgrade = false,
): string | null {
  if (!attr.isExpression) return newValue; // string attribute — content between the quotes
  const raw = attr.rawValue;
  if (NUMBER_LITERAL_RE.test(raw)) {
    if (isNumberTupleLiteral(newValue)) {
      // R2: a tuple replacing a plain number is a SHAPE CHANGE — allowed only
      // under the explicit opt-in; otherwise refused outright (never the
      // quoted-string fallback below, which would clobber `scale={1.5}` with
      // a junk string literal).
      return allowShapeUpgrade ? newValue.trim() : null;
    }
    const num = Number(newValue);
    return Number.isNaN(num) ? `'${newValue}'` : String(num);
  }
  if (raw === 'true' || raw === 'false') {
    return newValue === 'true' || newValue === 'false' ? newValue : `'${newValue}'`;
  }
  // W2 — a number-tuple literal is replaced ONLY by another number-tuple
  // literal, verbatim (the caller controls spacing inside the brackets).
  if (isNumberTupleLiteral(raw)) {
    return isNumberTupleLiteral(newValue) ? newValue.trim() : null;
  }
  if (/^"[^"]*"$/.test(raw)) return `"${newValue.replace(/"/g, '\\"')}"`;
  return `'${newValue.replace(/'/g, "\\'")}'`;
}

/**
 * Format a BRAND-NEW attribute's source text for {@link writePropChange}'s
 * opt-in `addIfMissing` branch: tuples/numbers/booleans get an expression
 * container, everything else a double-quoted string attribute.
 */
function formatNewAttr(propName: string, newValue: string): string {
  if (
    isNumberTupleLiteral(newValue) ||
    NUMBER_LITERAL_RE.test(newValue) ||
    newValue === 'true' ||
    newValue === 'false'
  ) {
    return `${propName}={${newValue.trim()}}`;
  }
  return `${propName}="${newValue.replace(/"/g, '&quot;')}"`;
}

/**
 * Write a component prop change back to source at the call site (visual-edit
 * `writePropChange` :1018). Refuses (guards) a dynamic (non-literal) prop and skips the
 * event-handler / structural props. `elementStart` is the call-site element's `<`.
 *
 * `opts.addIfMissing` (W2 — OPT-IN, default off so react-dom prop-write behavior is
 * unchanged): when the prop is absent from the opening tag, APPEND it (` prop={value}`
 * / ` prop="value"`) before the tag end instead of no-op'ing — the R3F gizmo path needs
 * this for a mesh whose source never authored a `position`/`rotation`/`scale` tuple
 * yet.
 *
 * `opts.allowShapeUpgrade` (R2 — OPT-IN, default off): permit a number-tuple literal to
 * replace a plain NUMBER literal for the same prop (scalar→tuple upgrade; see {@link
 * formatPropReplacement}). The R3F adapter passes it only for `scale` writes coming
 * from a non-uniform gizmo drag.
 */
/**
 * Where to put a new attribute on a tag whose attributes each occupy their own
 * line, and with what indentation — or null when the tag is single-line and the
 * inline insert is right. Keyed off the LAST attribute actually starting a
 * line, so a tag mixing both styles follows its own majority tail.
 */
function ownLineAttributeInsert(
  code: string,
  elementStart: number,
  attrs: readonly JsxAttrInfo[],
): { at: number; indent: string } | null {
  const last = attrs.at(-1);
  if (!last) return null;
  // Does this attribute begin its own line?
  let lineStart = last.attrStart;
  while (lineStart > elementStart && code[lineStart - 1] !== '\n') lineStart--;
  if (lineStart <= elementStart) return null; // same line as the tag name
  const indent = code.slice(lineStart, last.attrStart);
  if (/\S/.test(indent)) return null; // something else precedes it on the line
  return { at: last.attrEnd, indent };
}

export function writePropChange(
  code: string,
  elementStart: number,
  propName: string,
  newValue: string,
  opts?: { addIfMissing?: boolean; allowShapeUpgrade?: boolean },
): StyleEditResult {
  if (code[elementStart] !== '<') return { code, changed: false, dynamic: false };
  const tagEnd = findTagEnd(code, elementStart);
  if (tagEnd < 0) return { code, changed: false, dynamic: false };
  if (isSkippedProp(propName)) return { code, changed: false, dynamic: false };
  const attrs = analyzeJsxAttributes(code, elementStart, tagEnd);
  const attr = attrs.find((a) => a.name === propName);
  if (!attr) {
    if (!opts?.addIfMissing) return { code, changed: false, dynamic: false };
    // A tag that puts its attributes on their own lines gets the new one on its
    // own line too, indented to match. Appending inline before the `>` is
    // syntactically fine but reflows the author's formatting — which matters
    // now that removing and re-adding a prop is an ordinary inspector round
    // trip (revert to default, then override again).
    const ownLine = ownLineAttributeInsert(code, elementStart, attrs);
    if (ownLine) {
      const next =
        code.slice(0, ownLine.at) +
        `\n${ownLine.indent}${formatNewAttr(propName, newValue)}` +
        code.slice(ownLine.at);
      return { code: next, changed: true, dynamic: false };
    }
    const selfClose = code[tagEnd - 1] === '/';
    const insertAt = selfClose ? tagEnd - 1 : tagEnd;
    // Byte-minimal insert: a single leading space only when the preceding
    // char isn't already whitespace; a trailing space only before a `/` that
    // isn't already preceded by one. Everything around the insert survives
    // byte-for-byte.
    const lead = /\s/.test(code[insertAt - 1] ?? '') ? '' : ' ';
    const trail = selfClose ? ' ' : '';
    const next =
      code.slice(0, insertAt) +
      `${lead}${formatNewAttr(propName, newValue)}${trail}` +
      code.slice(insertAt);
    return { code: next, changed: true, dynamic: false };
  }
  if (!attr.isLiteral) return { code, changed: false, dynamic: true };
  if (attr.valueStart < 0) {
    // Native JSX boolean shorthand is still a literal. Preserve it for `true`;
    // expand it surgically for `false` so `<mesh visible />` is as editable as
    // `<mesh visible={true} />` without teaching the adapter a second writer.
    if (newValue === 'true') return { code, changed: false, dynamic: false };
    if (newValue !== 'false') return { code, changed: false, dynamic: false };
    const next = `${code.slice(0, attr.attrStart)}${propName}={false}${code.slice(attr.attrEnd)}`;
    return { code: next, changed: true, dynamic: false };
  }
  const replacement = formatPropReplacement(attr, newValue, opts?.allowShapeUpgrade === true);
  if (replacement === null) return { code, changed: false, dynamic: false }; // shape mismatch — refuse
  const next = code.slice(0, attr.valueStart) + replacement + code.slice(attr.valueEnd);
  return { code: next, changed: next !== code, dynamic: false };
}

/**
 * REMOVE a whole attribute from the element at `elementStart` — the inverse of
 * {@link writePropChange}'s `addIfMissing` append, and what "revert to default"
 * means in a JSX world: with no attribute, the value in force is the one the
 * component's own signature declares. (Contrast `removeInlineStyle`, which
 * removes one member from inside a `style={{…}}` object.)
 *
 * Refuses a DYNAMIC value, mirroring every other writer here: never delete an
 * expression the caller did not write. Deleting the attribute takes its leading
 * whitespace with it, so `<A a b />` → `<A a />` and a prop on its own line
 * takes the line, leaving the rest of the tag byte-identical.
 */
export function removePropAttribute(
  code: string,
  elementStart: number,
  propName: string,
): StyleEditResult {
  if (code[elementStart] !== '<') return { code, changed: false, dynamic: false };
  const tagEnd = findTagEnd(code, elementStart);
  if (tagEnd < 0) return { code, changed: false, dynamic: false };
  if (isSkippedProp(propName)) return { code, changed: false, dynamic: false };
  const attr = analyzeJsxAttributes(code, elementStart, tagEnd).find((a) => a.name === propName);
  if (!attr) return { code, changed: false, dynamic: false }; // absent — nothing to revert
  if (!attr.isLiteral) return { code, changed: false, dynamic: true }; // guard

  // Take the separator with the attribute, so a prop on its own line takes its
  // line and an inline one takes its space. Which side to eat depends on
  // position: normally the whitespace BEFORE it, but the FIRST attribute must
  // eat the whitespace after it instead — consuming its leading space would
  // weld the next attribute onto the tag name.
  let nameEnd = elementStart + 1;
  while (nameEnd <= tagEnd && !/[\s>/]/.test(code[nameEnd] ?? '>')) nameEnd++;

  let start = attr.attrStart;
  while (start > nameEnd && /\s/.test(code[start - 1] ?? '')) start--;
  let end = attr.attrEnd;
  if (start <= nameEnd) {
    start = attr.attrStart;
    while (end < tagEnd && /\s/.test(code[end] ?? '')) end++;
  }
  const next = code.slice(0, start) + code.slice(end);
  return { code: next, changed: next !== code, dynamic: false };
}

// --- Cap 5: source structural ops (visual-edit writer.ts reorderChild :483 /
//     duplicateElement :559 / wrapElement :634 / unwrapElement :679 /
//     reparentElement :743) ---

export interface StructEditResult {
  code: string;
  changed: boolean;
}

/** Expand a JSX element at `elementStart` to its full LINE block (leading whitespace on the
 *  first line, trailing newline on the last) — the unit these line-based ops move/copy. */
function lineBlockRange(
  code: string,
  elementStart: number,
): { lineStart: number; lineEnd: number } | null {
  if (code[elementStart] !== '<') return null;
  const end = findElementEnd(code, elementStart);
  if (end < 0) return null;
  let lineStart = elementStart;
  while (lineStart > 0 && code[lineStart - 1] !== '\n') lineStart--;
  let lineEnd = end;
  while (lineEnd < code.length && code[lineEnd] !== '\n') lineEnd++;
  if (lineEnd < code.length && code[lineEnd] === '\n') lineEnd++;
  return { lineStart, lineEnd };
}

/** The `<` of a parent's closing tag, given the parent's opening `<` (visual-edit's
 *  backwards scan from the element end). */
function closingTagStartOf(code: string, parentStart: number): number | null {
  const parentEnd = findElementEnd(code, parentStart);
  if (parentEnd < 0) return null;
  let i = parentEnd;
  while (i > parentStart && code[i - 1] !== '<') i--;
  return i - 1; // point at the '<'
}

/** Nudge one element's literal `position` by an offset — added when absent
 *  (absent IS the origin), left alone when dynamic. Shared by the duplicate
 *  rewrite and the paste-snippet offset. */
function offsetElementPosition(
  code: string,
  elementStart: number,
  [dx, dy, dz]: readonly [number, number, number],
): string {
  const fmt = (n: number): string => String(Number(n.toFixed(3)));
  const tagEnd = findTagEnd(code, elementStart);
  const attr =
    tagEnd < 0
      ? undefined
      : analyzeJsxAttributes(code, elementStart, tagEnd).find((a) => a.name === 'position');
  if (!attr) {
    return writePropChange(code, elementStart, 'position', `[${fmt(dx)}, ${fmt(dy)}, ${fmt(dz)}]`, {
      addIfMissing: true,
    }).code;
  }
  if (!attr.isLiteral || !isNumberTupleLiteral(attr.rawValue)) return code;
  const parts = attr.rawValue
    .replace(/^\s*\[|\]\s*$/g, '')
    .split(',')
    .map((part) => Number(part.trim()));
  if (parts.length !== 3 || !parts.every((n) => Number.isFinite(n))) return code;
  const [x, y, z] = parts as [number, number, number];
  return writePropChange(
    code,
    elementStart,
    'position',
    `[${fmt(x + dx)}, ${fmt(y + dy)}, ${fmt(z + dz)}]`,
  ).code;
}

/**
 * Shift every TOP-LEVEL element in a paste snippet by one offset — the block
 * moves as a unit, so relative arrangement inside the copy survives. A paste
 * that landed byte-identically ON its source read as "nothing was pasted"
 * to a human tester until they happened to drag the top one off.
 */
export function offsetSnippetPositions(
  snippet: string,
  offset: readonly [number, number, number],
): string {
  let out = snippet;
  let searchFrom = 0;
  while (searchFrom < out.length) {
    const start = out.indexOf('<', searchFrom);
    if (start < 0) break;
    if (findElementEnd(out, start) < 0) break;
    out = offsetElementPosition(out, start, offset);
    const end = findElementEnd(out, start);
    if (end <= start) break;
    searchFrom = end + 1;
  }
  return out;
}

/** Duplicate the element's line block, inserting the copy immediately after it (visual-edit
 *  `duplicateElement` :559). `rewrite` edits the copy only — see {@link DuplicateRewrite}. */
export function duplicateElement(
  code: string,
  elementStart: number,
  rewrite?: DuplicateRewrite,
): StructEditResult {
  const r = lineBlockRange(code, elementStart);
  if (!r) return { code, changed: false };
  const block = code.slice(r.lineStart, r.lineEnd);
  let next = code.slice(0, r.lineEnd) + block + code.slice(r.lineEnd);
  if (!rewrite) return { code: next, changed: true };
  const copyStart = r.lineEnd + (elementStart - r.lineStart);
  if (rewrite.name !== undefined) {
    next = writePropChange(next, copyStart, 'name', rewrite.name).code;
  }
  if (rewrite.positionOffset) {
    next = offsetElementPosition(next, copyStart, rewrite.positionOffset);
  }
  return { code: next, changed: true };
}

/** Wrap the element in a new `<wrapperTag>…</wrapperTag>` container, re-indenting the
 *  wrapped block one level (visual-edit `wrapElement` :634). */
export function wrapElement(
  code: string,
  elementStart: number,
  wrapperTag = 'div',
): StructEditResult {
  const r = lineBlockRange(code, elementStart);
  if (!r) return { code, changed: false };
  const block = code.slice(r.lineStart, r.lineEnd);
  const indent = block.match(/^(\s*)/)?.[1] ?? '';
  const reindented = block
    .split('\n')
    .map((line) => (line.length > 0 ? `  ${line}` : line))
    .join('\n');
  const wrapper = `${indent}<${wrapperTag}>\n${reindented}${indent}</${wrapperTag}>\n`;
  return { code: code.slice(0, r.lineStart) + wrapper + code.slice(r.lineEnd), changed: true };
}

/** Unwrap the element — replace it with its children, dedented one level (visual-edit
 *  `unwrapElement` :679). A self-closing element simply deletes.
 *
 *  For the LINE-BLOCK shape — the opening tag ends its line and the closing tag sits alone
 *  on its own line, exactly what {@link wrapElement} writes — the newline after the opening
 *  tag and the closing tag's leading indent are consumed too, making unwrap the exact BYTE
 *  INVERSE of wrap (previously those survived as a stray blank line plus loose indentation
 *  merged into the following line). Inline children keep the original splice behavior. */
export function unwrapElement(code: string, elementStart: number): StructEditResult {
  if (code[elementStart] !== '<') return { code, changed: false };
  const end = findElementEnd(code, elementStart);
  const openTagEnd = findTagEnd(code, elementStart);
  if (end < 0 || openTagEnd < 0) return { code, changed: false };
  if (code[openTagEnd - 1] === '/') return deleteElement(code, elementStart); // self-closing
  let closingTagStart = end;
  while (closingTagStart > elementStart && code[closingTagStart - 1] !== '<') closingTagStart--;
  closingTagStart--; // point at '<'
  const children = code.slice(openTagEnd + 1, closingTagStart);
  const r = lineBlockRange(code, elementStart);
  if (!r) return { code, changed: false };
  const dedentLine = (line: string): string =>
    line.startsWith('  ') ? line.slice(2) : line.startsWith('\t') ? line.slice(1) : line;
  const lastNewline = children.lastIndexOf('\n');
  if (
    children.startsWith('\n') &&
    lastNewline > 0 &&
    /^[ \t]*$/.test(children.slice(lastNewline + 1))
  ) {
    // Line-block shape: children are whole lines between the tags.
    const dedented = children
      .slice(1, lastNewline + 1)
      .split('\n')
      .map(dedentLine)
      .join('\n');
    return { code: code.slice(0, r.lineStart) + dedented + code.slice(r.lineEnd), changed: true };
  }
  const dedented = children.split('\n').map(dedentLine).join('\n');
  return { code: code.slice(0, r.lineStart) + dedented + code.slice(r.lineEnd), changed: true };
}

/** Insert a new child element `<tag />` just before `parentStart`'s closing tag, indented
 *  to match the parent's children (the "create" primitive).
 *
 *  `snippet` (R3 — optional; `tag` is ignored when it is provided): a MULTI-LINE JSX
 *  snippet inserted verbatim instead of the bare `<tag />`, each line re-indented one
 *  level under the parent (the R3F preset-create path needs a `<mesh>` with
 *  geometry+material children, not an empty tag). The snippet is authored flush-left with
 *  its own 2-space internal nesting; blank lines stay blank (no trailing whitespace).
 *  Must start with `<` — anything else is refused (`changed: false`), the same
 *  honest-refusal convention every other writer op uses. */
export function insertChildElement(
  code: string,
  parentStart: number,
  tag = 'div',
  snippet?: string,
): StructEditResult {
  const tagEnd = findTagEnd(code, parentStart);
  if (tagEnd < 0) return { code, changed: false };
  let parentLineStart = parentStart;
  while (parentLineStart > 0 && code[parentLineStart - 1] !== '\n') parentLineStart--;
  const parentIndent = code.slice(parentLineStart, parentStart).match(/^(\s*)/)?.[1] ?? '';
  const childIndent = `${parentIndent}  `;
  let child: string;
  if (snippet !== undefined) {
    const trimmed = snippet.trim();
    if (!trimmed.startsWith('<')) return { code, changed: false }; // not a JSX snippet — refuse
    child = `${trimmed
      .split('\n')
      .map((line) => (line.trim().length > 0 ? childIndent + line.trimEnd() : ''))
      .join('\n')}\n`;
  } else {
    child = `${childIndent}<${tag} />\n`;
  }
  // A self-closing parent (`<Transport tempo={92} />`) has no children yet: it opens, takes the
  // child, and closes on its own line. Walking back to a `<` from its end would find the parent's
  // OWN tag and put the child beside it.
  if (code[tagEnd - 1] === '/') {
    const name = code.slice(parentStart + 1, tagEnd).match(/^([A-Za-z0-9_.$:-]+)/)?.[1];
    if (!name) return { code, changed: false };
    let open = tagEnd - 1;
    while (open > parentStart && /\s/.test(code[open - 1] ?? '')) open--;
    const opened = `${code.slice(0, open)}>\n${child}${parentIndent}</${name}>`;
    return { code: opened + code.slice(tagEnd + 1), changed: true };
  }
  const closingTagStart = closingTagStartOf(code, parentStart);
  if (closingTagStart == null) return { code, changed: false };
  // The child goes on its own line before the closing tag: at that line's start when the closing
  // tag begins its line, else (a one-line parent, `<Clip>…</Clip>`) broken onto a new line there.
  let insertPos = closingTagStart;
  while (insertPos > 0 && (code[insertPos - 1] === ' ' || code[insertPos - 1] === '\t')) insertPos--;
  if (insertPos > 0 && code[insertPos - 1] !== '\n') {
    return { code: `${code.slice(0, closingTagStart)}\n${child}${parentIndent}${code.slice(closingTagStart)}`, changed: true };
  }
  return { code: code.slice(0, insertPos) + child + code.slice(insertPos), changed: true };
}

/**
 * Insert a JSX `snippet` as a new SIBLING immediately after the element at
 * `elementStart`, at that element's own indentation.
 *
 * The sibling counterpart to {@link insertChildElement}, and the only way to add
 * a top-level element to a world whose root JSX is a FRAGMENT: a fragment carries
 * no OID, so there is no parent offset to insert INTO — but every one of its
 * children has one, so "append to the world" is expressible as "put this after the
 * last top-level element". Same line-block unit `duplicateElement` moves, and the
 * same snippet contract `insertChildElement` documents: flush-left with its own
 * 2-space internal nesting, must start with `<` (anything else is refused with
 * `changed: false`), blank lines stay blank.
 */
export function insertSiblingElement(
  code: string,
  elementStart: number,
  snippet: string,
): StructEditResult {
  const trimmed = snippet.trim();
  if (!trimmed.startsWith('<')) return { code, changed: false };
  const r = lineBlockRange(code, elementStart);
  if (!r) return { code, changed: false };
  const indent = code.slice(r.lineStart, elementStart).match(/^(\s*)/)?.[1] ?? '';
  const block = `${trimmed
    .split('\n')
    .map((line) => (line.trim().length > 0 ? indent + line.trimEnd() : ''))
    .join('\n')}\n`;
  return { code: code.slice(0, r.lineEnd) + block + code.slice(r.lineEnd), changed: true };
}

/** Reorder the element among its siblings: before `beforeStart` (an OID-resolved sibling
 *  offset), or — when `beforeStart` is null — at the end of `parentStart` (visual-edit
 *  `reorderChild` :483). OID-resolved offsets, immune to index races. */
export function reorderChild(
  code: string,
  elementStart: number,
  beforeStart: number | null,
  parentStart: number | null,
): StructEditResult {
  const r = lineBlockRange(code, elementStart);
  if (!r) return { code, changed: false };
  const { lineStart, lineEnd } = r;
  const block = code.slice(lineStart, lineEnd);
  const removedLength = lineEnd - lineStart;

  let targetLineStart: number;
  if (beforeStart != null) {
    targetLineStart = beforeStart;
    while (targetLineStart > 0 && code[targetLineStart - 1] !== '\n') targetLineStart--;
    if (targetLineStart === lineStart) return { code, changed: false }; // same position
  } else if (parentStart != null) {
    const closingTagStart = closingTagStartOf(code, parentStart);
    if (closingTagStart == null) return { code, changed: false };
    targetLineStart = closingTagStart;
    while (targetLineStart > 0 && code[targetLineStart - 1] !== '\n') targetLineStart--;
    if (lineStart >= targetLineStart) return { code, changed: false }; // already at end
  } else {
    return { code, changed: false };
  }

  const without = code.slice(0, lineStart) + code.slice(lineEnd);
  const adj = targetLineStart > lineStart ? targetLineStart - removedLength : targetLineStart;
  return { code: without.slice(0, adj) + block + without.slice(adj), changed: true };
}

/**
 * Turn `<Tag … />` into the paired `<Tag …>` / `</Tag>` shape, so the element has an
 * authored children slot to receive one.
 *
 * Why this exists (R3F reparent hardening, R3): in idiomatic R3F source almost every
 * hierarchy row IS a self-closing component callsite (`<JumpPad name="West" … />`), and
 * {@link reparentElement}'s `closingTagStartOf` scan finds the element's OWN `<` for such
 * a tag — so "drop into this row" silently became "insert a PRECEDING SIBLING". Opening
 * the slot is the honest edit an author would make by hand; it writes no value and
 * invents no data, it only gives the tag a body. The caller
 * (`reparent-guard.ts`) has already proven the destination renders its children.
 *
 * Refuses (`changed: false`) anything that is not a well-formed self-closing tag.
 */
export function openChildrenSlot(code: string, elementStart: number): StructEditResult {
  if (code[elementStart] !== '<') return { code, changed: false };
  const tagEnd = findTagEnd(code, elementStart);
  if (tagEnd < 0 || code[tagEnd - 1] !== '/') return { code, changed: false };
  let nameEnd = elementStart + 1;
  while (nameEnd < code.length && !/[\s>/]/.test(code[nameEnd] ?? '>')) nameEnd++;
  const tag = code.slice(elementStart + 1, nameEnd);
  if (!/^[A-Za-z0-9_.]+$/.test(tag)) return { code, changed: false };
  let lineStart = elementStart;
  while (lineStart > 0 && code[lineStart - 1] !== '\n') lineStart--;
  const indent = code.slice(lineStart, elementStart).match(/^(\s*)/)?.[1] ?? '';
  // Drop the `/` and the whitespace that only existed to separate it.
  let cut = tagEnd - 1;
  while (cut > nameEnd && /\s/.test(code[cut - 1] ?? '')) cut--;
  return {
    code: `${code.slice(0, cut)}>\n${indent}</${tag}>${code.slice(tagEnd + 1)}`,
    changed: true,
  };
}

/** Reparent the element to be the last child of `parentStart`, re-indented to the parent's
 *  child level (visual-edit `reparentElement` :743). Same-file only (the caller guards).
 *
 *  The R3F hierarchy calls this through `planReparent` (`reparent-guard.ts`), which owns
 *  the scope/transform/legality gates; this function stays the raw textual move. */
export function reparentElement(
  code: string,
  elementStart: number,
  parentStart: number,
): StructEditResult {
  const r = lineBlockRange(code, elementStart);
  if (!r) return { code, changed: false };
  const { lineStart: elLineStart, lineEnd: elLineEnd } = r;
  const block = code.slice(elLineStart, elLineEnd);
  const closingTagStart = closingTagStartOf(code, parentStart);
  if (closingTagStart == null) return { code, changed: false };

  let parentLineStart = parentStart;
  while (parentLineStart > 0 && code[parentLineStart - 1] !== '\n') parentLineStart--;
  const parentIndent = code.slice(parentLineStart, parentStart).match(/^(\s*)/)?.[1] ?? '';
  const childIndent = `${parentIndent}  `;
  const reindented = block
    .split('\n')
    .map((line) => {
      const trimmed = line.replace(/^\s*/, '');
      return trimmed ? childIndent + trimmed : '';
    })
    .join('\n');

  const without = code.slice(0, elLineStart) + code.slice(elLineEnd);
  let adjustedClosing = closingTagStart;
  if (elLineStart < closingTagStart) adjustedClosing -= elLineEnd - elLineStart;
  let insertPos = adjustedClosing;
  while (insertPos > 0 && without[insertPos - 1] !== '\n') insertPos--;
  return {
    code: without.slice(0, insertPos) + reindented + without.slice(insertPos),
    changed: true,
  };
}

/** Delete the element starting at `elementStart` from source (C8). */
export function deleteElement(
  code: string,
  elementStart: number,
): { code: string; changed: boolean } {
  const end = findElementEnd(code, elementStart);
  if (end < 0) return { code, changed: false };
  // also consume leading whitespace on the line + trailing newline
  let s = elementStart;
  while (s > 0 && (code[s - 1] === ' ' || code[s - 1] === '\t')) s--;
  let e = end;
  if (code[e] === '\n') e++;
  return { code: code.slice(0, s) + code.slice(e), changed: true };
}

/**
 * Delete MULTIPLE elements from a SINGLE `code` snapshot, given every target's
 * `elementStart` offset resolved against that SAME snapshot (delete-order-residual
 * fix — `vite-plugin-ui-oid.ts`'s `handleStructMany`). Sound and caller-order-
 * independent: every offset is resolved from the file ONCE, up front, then applied
 * highest-offset-first — each `deleteElement` call only ever removes text AT OR
 * AFTER its own target, so every offset still queued (all of them numerically
 * SMALLER, since we process descending) is untouched by it and stays valid. A
 * nested descendant's `elementStart` is always numerically greater than its
 * ancestor's (it appears later in source), so this single offset-value rule also
 * deletes a selected descendant before a selected ancestor, with no separate
 * ancestor/descendant case to reason about. Unlike re-resolving each target by
 * re-scanning/re-transforming the file between deletes, this never recomputes an
 * OID's identity mid-batch — it only ever reads the ALREADY-RESOLVED offsets handed
 * to it, so it cannot suffer the occurrence-index churn a live re-transform would
 * introduce (deleting one same-tag sibling shifts every later sibling's own
 * `component:tag:nthOccurrence` signature, which would silently relabel it as a
 * DIFFERENT, already-used oid if resolution were re-derived from a fresh transform
 * mid-batch — the reason `handleStruct`'s per-call resolution is not simply looped
 * here without change).
 */
export function deleteElements(
  code: string,
  elementStarts: readonly number[],
): { code: string; changed: boolean } {
  const sorted = [...elementStarts].sort((a, b) => b - a); // highest offset first
  let cur = code;
  let changed = false;
  for (const off of sorted) {
    const result = deleteElement(cur, off);
    if (result.changed) {
      cur = result.code;
      changed = true;
    }
  }
  return { code: cur, changed };
}

/** Group source-addressed sibling JSX elements beneath one ordinary R3F
 * `<group name="Group">`. The adapter verifies common hierarchy ownership;
 * this writer additionally requires non-overlapping line blocks with identical
 * indentation, then performs one offset-stable rewrite from a single snapshot. */
export function groupSiblingElements(
  code: string,
  elementStarts: readonly number[],
  wrapperTag = 'group',
): StructEditResult {
  const starts = [...new Set(elementStarts)].sort((a, b) => a - b);
  if (starts.length < 2) return { code, changed: false };
  const blocks = starts.map((start) => ({ start, range: lineBlockRange(code, start) }));
  if (blocks.some(({ range }) => !range)) return { code, changed: false };
  const resolved = blocks as { start: number; range: { lineStart: number; lineEnd: number } }[];
  for (let index = 1; index < resolved.length; index++) {
    if (resolved[index - 1]!.range.lineEnd > resolved[index]!.range.lineStart) {
      return { code, changed: false };
    }
  }
  const indents = resolved.map(({ start, range }) => code.slice(range.lineStart, start));
  const indent = indents[0] ?? '';
  if (!/^[ \t]*$/.test(indent) || indents.some((candidate) => candidate !== indent)) {
    return { code, changed: false };
  }
  const selected = resolved
    .map(({ range }) => code.slice(range.lineStart, range.lineEnd))
    .map((block) =>
      block
        .split('\n')
        .map((line) => (line.length > 0 ? `  ${line}` : line))
        .join('\n'),
    )
    .join('');
  const insertion = resolved[0]!.range.lineStart;
  let without = code;
  for (const { range } of [...resolved].reverse()) {
    without = without.slice(0, range.lineStart) + without.slice(range.lineEnd);
  }
  const labelProp = wrapperTag === 'group' ? 'name' : 'label';
  const wrapper = `${indent}<${wrapperTag} ${labelProp}="Group">\n${selected}${indent}</${wrapperTag}>\n`;
  return {
    code: without.slice(0, insertion) + wrapper + without.slice(insertion),
    changed: true,
  };
}
