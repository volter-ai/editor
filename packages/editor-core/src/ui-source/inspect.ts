/**
 * Live-DOM inspection helpers (Cap 1 of the React visual-edit parity port). These are
 * `../../../visual-edit/preload.ts`'s inspection FUNCTIONS ported as DIRECT-CALL helpers.
 *
 * The no-iframe adaptation (see the parity spec): visual-edit injects `preload.ts` into
 * an iframe and inspects the target app across a `postMessage` bridge. vgai mounts React
 * roots as DOM layers in the SAME document and `ReactRootAuthoringAdapter` already holds
 * the live root — so these run against the live element directly, no iframe/bridge.
 *
 * Headless-testable: none of these reach for a DOM global unconditionally. Fiber reads
 * work on any object carrying a `__reactFiber$…` key (a plain fixture satisfies it).
 * `getComputedStyles` takes a resolver (defaulting to `window.getComputedStyle` in a real
 * browser, or the element's inline `.style` under vitest's `node` env — no jsdom).
 * `getMatchedCssRules` takes its stylesheet list (defaulting to `document.styleSheets`).
 *
 * C4 (spec §9) fiber-access contract: `__reactFiber$…`/`__reactInternalInstance$…` are
 * React's OWN internal instance keys — never a documented, versioned public API (the
 * exact prefix has changed across React major versions, and nothing guarantees it won't
 * again). `findFiber` therefore treats a missing/renamed key as an ORDINARY, expected
 * outcome, not an error: it returns `null` rather than throwing, and every caller
 * (`getReactComponentName`, `getCallSiteOid`, `readFiberProps`, `getComponentProps`) is
 * `null`-safe from there. The one caller-visible fallback this enables is
 * `getEffectiveOid`: call-site OID (from the fiber) when available, else the element's
 * own `data-oid` DOM attribute — i.e. inspection degrades to DOM-only (oid/selection
 * still work; component-name/props enrichment silently disappears) instead of failing.
 * Covered by `ui-source-inspect.test.ts`'s "no fiber" case (a plain DOM-shaped fixture
 * with no `__reactFiber$…` key at all, simulating both "fiber absent" and "key renamed").
 */

import { warnGuessedFromText } from '../inference-diagnostics';

const OID_ATTR = 'data-oid';

/** The ~70 most-edited CSS properties visual-edit's `getComputedStyles` captures (:73). */
export const COMPUTED_STYLE_PROPS: readonly string[] = [
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'display',
  'flexDirection',
  'flexWrap',
  'justifyContent',
  'alignItems',
  'gap',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'alignSelf',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'backgroundColor',
  'backgroundImage',
  'color',
  'fontSize',
  'fontWeight',
  'fontFamily',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'border',
  'borderWidth',
  'borderColor',
  'borderStyle',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderTopStyle',
  'borderRightStyle',
  'borderBottomStyle',
  'borderLeftStyle',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'opacity',
  'overflow',
  'zIndex',
  'transform',
  'mixBlendMode',
  'filter',
  'backdropFilter',
  'textShadow',
  'boxShadow',
  'textAlign',
  'lineHeight',
  'letterSpacing',
  'textTransform',
  'textDecoration',
  'whiteSpace',
  'wordWrap',
  'cursor',
];

/** camelCase CSS prop -> kebab-case (`fontSize` -> `font-size`). */
export function camelToKebab(prop: string): string {
  return prop.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/** kebab-case CSS prop -> camelCase (`font-size` -> `fontSize`). */
export function kebabToCamel(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** The minimal shape a resolved computed-style value source needs. A real
 *  `CSSStyleDeclaration` satisfies this structurally. */
export interface ComputedStyleLike {
  getPropertyValue(prop: string): string;
}

/** Resolves an element to a `getPropertyValue`-capable style source (kebab keys). */
export type ComputedStyleResolver = (el: unknown) => ComputedStyleLike;

/** Read one inline style property off an element's `.style` of either shape (a real
 *  `CSSStyleDeclaration` or a plain-object test fixture) — the same read
 *  `react-world-authoring-adapter.ts` uses. */
function inlineStyleProp(style: unknown, prop: string): unknown {
  return style ? (style as Record<string, unknown>)[prop] : undefined;
}

/**
 * The default resolver: real `window.getComputedStyle` in a browser (so CLASS-styled
 * and CSS-file-styled properties resolve, fixing the "class-styled props show blank"
 * bug), or — under vitest's `node` env (no `window`) — a shim reading the element's
 * inline `.style` object, so headless fixtures keep working unchanged.
 */
export const browserOrInlineResolver: ComputedStyleResolver = (el) => {
  const w = (globalThis as { window?: { getComputedStyle?: (e: unknown) => ComputedStyleLike } })
    .window;
  if (w?.getComputedStyle) return w.getComputedStyle(el);
  const style = (el as { style?: unknown }).style;
  return { getPropertyValue: (k: string) => String(inlineStyleProp(style, kebabToCamel(k)) ?? '') };
};

/**
 * Capture the commonly-edited computed styles of an element as a camelCase-keyed record
 * (visual-edit `getComputedStyles` :73). The resolver is injectable for headless tests;
 * the default resolves against the live browser DOM (or inline style under `node`).
 */
export function getComputedStyles(
  el: unknown,
  resolve: ComputedStyleResolver = browserOrInlineResolver,
): Record<string, string> {
  const cs = resolve(el);
  const result: Record<string, string> = {};
  for (const p of COMPUTED_STYLE_PROPS) result[p] = cs.getPropertyValue(camelToKebab(p));
  return result;
}

/** Read a single computed style property (camelCase), via the same resolver. */
export function getComputedStyleValue(
  el: unknown,
  prop: string,
  resolve: ComputedStyleResolver = browserOrInlineResolver,
): string {
  return resolve(el).getPropertyValue(camelToKebab(prop));
}

// --- React fiber inspection (visual-edit preload.ts :110/:134/:158) ---

/** A minimal fiber node shape — enough for the reads below (`preload.ts` uses `any`). */
interface FiberLike {
  return?: FiberLike | null;
  type?: unknown;
  memoizedProps?: Record<string, unknown> | null;
}

/** Find the React fiber attached to a DOM element (React 18+ `__reactFiber$…`, older
 *  `__reactInternalInstance$…`). Works on any object carrying such a key — a plain
 *  fixture with `{ __reactFiber$x: {...} }` satisfies it headlessly. */
export function findFiber(el: unknown): FiberLike | null {
  if (!el || typeof el !== 'object') return null;
  const key = Object.keys(el as object).find(
    (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
  );
  if (!key) return null;
  return ((el as Record<string, unknown>)[key] as FiberLike) ?? null;
}

/** The parent fiber IF this element is the ROOT element of a function component
 *  (`fiber.return` points straight at the component fiber). Else null. */
function componentParentFiber(el: unknown): FiberLike | null {
  const fiber = findFiber(el);
  if (!fiber?.return) return null;
  const parent = fiber.return;
  return parent.type && typeof parent.type === 'function' ? parent : null;
}

/** Nearest component name for an element that is a component's root element
 *  (visual-edit `getReactComponentName` :110). */
export function getReactComponentName(el: unknown): string | null {
  const parent = componentParentFiber(el);
  if (!parent) return null;
  const type = parent.type as { displayName?: string; name?: string };
  return type.displayName || type.name || null;
}

/** The call-site `data-oid` prop passed to a component root (`<StatCard data-oid="x"/>`)
 *  read off the component fiber's props (visual-edit `getCallSiteOid` :134). */
export function getCallSiteOid(el: unknown): string | null {
  const parent = componentParentFiber(el);
  if (!parent) return null;
  const v = parent.memoizedProps?.[OID_ATTR];
  return typeof v === 'string' ? v : null;
}

/** Call-site OID for component roots, else the element's own `data-oid`
 *  (visual-edit `getEffectiveOid` :148). */
export function getEffectiveOid(el: { getAttribute?(name: string): string | null }): string | null {
  return getCallSiteOid(el) ?? el.getAttribute?.(OID_ATTR) ?? null;
}

/** Primitive (string/number/boolean) props of a component root, stringified
 *  (visual-edit `readFiberProps` :158). Skips children/key/ref/data-oid/style/className
 *  and any non-primitive value. Returns null when there are none. */
export function readFiberProps(el: unknown): Record<string, string> | null {
  const parent = componentParentFiber(el);
  if (!parent) return null;
  const props = parent.memoizedProps;
  if (!props || typeof props !== 'object') return null;

  const SKIP = new Set(['children', 'key', 'ref', OID_ATTR, 'style', 'className']);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    if (SKIP.has(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = String(value);
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

/** The component's call-site OID + its editable primitive props, or null if the element
 *  is not a component root with props (visual-edit `getComponentProps` :463). Cap 4 feeds
 *  the Props inspector section from this. */
export function getComponentProps(
  el: { getAttribute?(name: string): string | null } & unknown,
): { callSiteOid: string; props: Record<string, string> } | null {
  const callSiteOid = getCallSiteOid(el);
  if (!callSiteOid) return null;
  const props = readFiberProps(el);
  if (!props) return null;
  return { callSiteOid, props };
}

// --- Matched CSS rules (visual-edit preload.ts getMatchedCssRules :473) ---

export interface MatchedCssRule {
  selectorText: string;
  properties: Record<string, string>;
  /** The source file the owning `<style>`/`<link>` traces to (via `data-vite-dev-id`). */
  sourceFile: string;
}

/** The minimal element shape needed to trace matched rules — `matches(selector)`. */
export interface MatchableElement {
  matches(selector: string): boolean;
}

/** A structural stand-in for a `CSSStyleRule` (headless-testable). */
export interface StyleRuleLike {
  selectorText: string;
  style: { length: number; getPropertyValue(prop: string): string; [index: number]: string };
}

/** A structural stand-in for a `CSSStyleSheet` + its owner node. */
export interface StyleSheetLike {
  ownerNode?: { id?: string; getAttribute?(name: string): string | null } | null;
  cssRules: ArrayLike<unknown>;
}

/** The id of visual-edit's own preview `<style>` tag — skipped when tracing rules. */
const PREVIEW_STYLE_TAG_ID = '__visual-edit-preview-styles';

/** Is this rule a style rule (vs `@media`/`@keyframes`)? Uses `CSSStyleRule` when the DOM
 *  provides it, else a structural check so headless fixtures work. */
function isStyleRule(rule: unknown): rule is StyleRuleLike {
  const CSR = (globalThis as { CSSStyleRule?: unknown }).CSSStyleRule;
  if (typeof CSR === 'function') return rule instanceof (CSR as new () => unknown);
  const r = rule as Partial<StyleRuleLike>;
  return !!r && typeof r.selectorText === 'string' && !!r.style;
}

/** Read every declared property off a style rule's declaration block. */
function readRuleProperties(rule: StyleRuleLike): Record<string, string> {
  const properties: Record<string, string> = {};
  for (let i = 0; i < rule.style.length; i++) {
    const prop = rule.style[i] as string;
    properties[prop] = rule.style.getPropertyValue(prop);
  }
  return properties;
}

/**
 * Trace the CSS rules from first-party stylesheets that MATCH an element, keyed back to
 * their source file via the owner node's `data-vite-dev-id` (visual-edit
 * `getMatchedCssRules` :473). Only rules from a stylesheet with a `data-vite-dev-id`
 * (i.e. a real source file Vite is serving) are returned — Cap 2 edits those files.
 * Sheets default to `document.styleSheets`; injectable for headless tests.
 */
/**
 * Walk every STYLE rule of every first-party stylesheet (one with a
 * `data-vite-dev-id` — a real source file Vite is serving), DESCENDING grouping
 * rules. Descent is the load-bearing half: the dev server wraps a project
 * stylesheet's whole body in `@scope ([data-vgai-game-styles]) { … }`
 * (server/scoped-game-css.ts), so in the served CSSOM every project rule is a
 * grouping-rule CHILD — a top-level-only walk sees none of them, which is
 * exactly why the Cap-2 cascade route never fired for scoped game CSS. A
 * `@media` group is only entered when its condition currently HOLDS
 * (`matchMedia`): a rule inside a non-matching breakpoint is not in cascade
 * and must not be offered as an edit target.
 */
function visitFirstPartyStyleRules(
  sheets: Iterable<StyleSheetLike>,
  visit: (rule: StyleRuleLike, sourceFile: string) => void,
): void {
  const mm = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia;
  const walk = (rules: ArrayLike<unknown>, sourceFile: string): void => {
    for (const rule of Array.from(rules)) {
      if (isStyleRule(rule)) {
        visit(rule, sourceFile);
        continue;
      }
      const group = rule as {
        cssRules?: ArrayLike<unknown>;
        media?: { mediaText?: string };
        containerQuery?: unknown;
        cssText?: string;
      };
      if (!group.cssRules) continue;
      const mediaText = group.media?.mediaText;
      if (typeof mediaText === 'string' && mm && !mm(mediaText).matches) continue;
      // A @container group is a BREAKPOINT scope (the serve-time responsive
      // preview rewrites width @media into these). Whether it applies depends
      // on each frame's own size — unanswerable from this element-independent
      // walk — and offering its rules as silent cascade targets would route a
      // BASE edit into a breakpoint. Breakpoint writes take the explicit
      // media-scoped door instead.
      if (
        typeof group.containerQuery === 'string' ||
        group.cssText?.trimStart().startsWith('@container')
      )
        continue;
      walk(group.cssRules, sourceFile);
    }
  };
  for (const sheet of sheets) {
    const owner = sheet.ownerNode;
    if (owner?.id === PREVIEW_STYLE_TAG_ID) continue;
    const sourceFile = owner?.getAttribute?.('data-vite-dev-id') ?? null;
    if (!sourceFile) continue;
    try {
      walk(sheet.cssRules, sourceFile);
    } catch {
      // Cross-origin stylesheet — its `cssRules` throws; skip it (same as visual-edit).
    }
  }
}

/** Where a named style (a single-class rule `.name`) is declared, if any
 *  first-party stylesheet declares one — the fact that decides APPLY (the
 *  class exists, add the token) vs CREATE (write a new rule). Later sheets
 *  win, matching cascade order. */
export function findClassRuleSource(
  className: string,
  sheets: Iterable<StyleSheetLike> = (
    globalThis as { document?: { styleSheets?: Iterable<StyleSheetLike> } }
  ).document?.styleSheets ?? [],
): { sourceFile: string } | null {
  let found: { sourceFile: string } | null = null;
  visitFirstPartyStyleRules(sheets, (rule, sourceFile) => {
    if (rule.selectorText.trim() === `.${className}`) found = { sourceFile };
  });
  return found;
}

/** The distinct first-party stylesheet source files currently serving CSS, in
 *  document order — the candidate homes for a NEW named-style rule when no
 *  matched rule already names one. */
export function firstPartyStylesheetFiles(
  sheets: Iterable<StyleSheetLike> = (
    globalThis as { document?: { styleSheets?: Iterable<StyleSheetLike> } }
  ).document?.styleSheets ?? [],
): string[] {
  const files: string[] = [];
  for (const sheet of sheets) {
    const owner = sheet.ownerNode;
    if (owner?.id === PREVIEW_STYLE_TAG_ID) continue;
    const sourceFile = owner?.getAttribute?.('data-vite-dev-id') ?? null;
    if (!sourceFile) continue;
    const clean = sourceFile.split('?')[0] ?? sourceFile;
    if (clean.endsWith('.css') && !files.includes(sourceFile)) files.push(sourceFile);
  }
  return files;
}

export function getMatchedCssRules(
  el: MatchableElement,
  sheets: Iterable<StyleSheetLike> = (
    globalThis as { document?: { styleSheets?: Iterable<StyleSheetLike> } }
  ).document?.styleSheets ?? [],
): MatchedCssRule[] {
  const matched: MatchedCssRule[] = [];
  visitFirstPartyStyleRules(sheets, (rule, sourceFile) => {
    if (el.matches(rule.selectorText)) {
      matched.push({
        selectorText: rule.selectorText,
        properties: readRuleProperties(rule),
        sourceFile,
      });
    }
  });
  return matched;
}

// --- Design tokens (visual-edit preload.ts getDesignTokens :506) — Cap 7 ---

export interface DesignToken {
  name: string;
  value: string;
  category: 'color' | 'spacing' | 'other';
  /**
   * WHERE the token is declared, when a project stylesheet rule declares it —
   * the write address `writeCss(file, selector, --name, value)` targets, which
   * is what upgrades the token's inspector row from read-only to editable. A
   * token with no declaration trace (set inline on `:root` by script — e.g. a
   * theme data module mirroring itself, or an inherited host style) stays
   * read-only, and its EDIT door is the declaring source itself.
   */
  declaredIn?: { sourceFile: string; selector: string };
}

/**
 * Trace `:root`-scope custom-property DECLARATIONS to their stylesheet
 * source (`data-vite-dev-id`, the same trace {@link getMatchedCssRules}
 * uses). Later declarations win, matching the cascade for equal-specificity
 * `:root` rules. Rules under `[data-theme]`/media scopes are deliberately
 * NOT the base declaration — modes override the base; the base row is what
 * a token edit writes.
 */
export function traceTokenDeclarations(
  sheets: Iterable<StyleSheetLike> = (
    globalThis as { document?: { styleSheets?: Iterable<StyleSheetLike> } }
  ).document?.styleSheets ?? [],
): Map<string, { sourceFile: string; selector: string }> {
  const out = new Map<string, { sourceFile: string; selector: string }>();
  const visit = (rule: unknown, sourceFile: string, inScope: boolean): void => {
    if (isStyleRule(rule)) {
      const selector = rule.selectorText;
      // The dev server rewrites a project stylesheet's `:root { … }` into
      // `@scope ([data-vgai-game-styles]) { :scope { … } }` (measured), so a
      // scope-wrapped `:scope` IS a `:root` declaration — and the recorded
      // write address is the SOURCE's `:root`, because the css writer edits
      // source text, not the served rewrite.
      const scopeBase = inScope && /(^|,)\s*:scope\s*($|,)/.test(selector);
      const rootBase =
        /(^|,)\s*(:root|html)\s*($|,)/.test(selector) && !selector.includes('[data-theme');
      if (!scopeBase && !rootBase) return;
      for (let i = 0; i < rule.style.length; i++) {
        const prop = rule.style[i]!;
        if (!prop.startsWith('--')) continue;
        out.set(prop, { sourceFile, selector: scopeBase ? ':root' : selector });
      }
      return;
    }
    const group = rule as { cssRules?: ArrayLike<unknown>; cssText?: string };
    if (!group.cssRules) return;
    const scoped = inScope || Boolean(group.cssText?.trimStart().startsWith('@scope'));
    for (const child of Array.from(group.cssRules)) visit(child, sourceFile, scoped);
  };
  for (const sheet of sheets) {
    const owner = sheet.ownerNode;
    if (owner?.id === PREVIEW_STYLE_TAG_ID) continue;
    const sourceFile = owner?.getAttribute?.('data-vite-dev-id') ?? null;
    if (!sourceFile) continue;
    try {
      for (const rule of Array.from(sheet.cssRules)) visit(rule, sourceFile, false);
    } catch {
      // Cross-origin stylesheet — its `cssRules` throws; skip it.
    }
  }
  return out;
}

/**
 * Enumerate the `:root` CSS custom properties (design tokens) resolved on the document
 * root, classified color/spacing/other (visual-edit `getDesignTokens` :506). Captures
 * Tailwind v4 `@theme`/`oklch` vars; skips Tailwind internal `--tw-*`, Font
 * Awesome internals, and the editor chrome's reserved `--vgai-*` namespace.
 * The latter is infrastructure inherited from the editor host, never authored
 * game data. The computed declaration is injectable for headless tests
 * (defaults to the live `:root`).
 */
export function getDesignTokens(
  computed: (ComputedStyleLike & ArrayLike<string>) | undefined = readRootComputed(),
): DesignToken[] {
  if (!computed) return [];
  const tokens: DesignToken[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < computed.length; i++) {
    const name = computed[i] as string;
    if (
      !name.startsWith('--') ||
      name.startsWith('--tw-') ||
      name.startsWith('--fa-') ||
      name.startsWith('--vgai-') ||
      // Code-OSS theme tokens inherit into game roots but belong to the host.
      name.startsWith('--vscode-') ||
      name === '--chat-input-control-height' ||
      // The `--dv-*` chrome variables inherit from the editor shell into
      // every game-CSS scope root, so a board's token read sees them
      // (measured: 15 heuristic warnings per board open). Editor chrome, not
      // game data — same exclusion as `--vgai-*`.
      name.startsWith('--dv-') ||
      seen.has(name)
    )
      continue;
    seen.add(name);
    const value = computed.getPropertyValue(name).trim();
    if (!value) continue;
    tokens.push({ name, value, category: classifyToken(name, value) });
  }
  const declarations = traceTokenDeclarations();
  // The indexed loop above only lists custom properties the SUPPLIED style
  // declares directly — an element inside a game-CSS scope RESOLVES its
  // inherited tokens (`getPropertyValue`) but does not ITERATE them
  // (measured). The declaration trace supplies the missing names, so scoped
  // game tokens enumerate wherever the caller's element can resolve them.
  for (const name of declarations.keys()) {
    if (seen.has(name) || name.startsWith('--tw-') || name.startsWith('--fa-')) continue;
    if (
      name.startsWith('--vgai-') ||
      name.startsWith('--dv-') ||
      name.startsWith('--vscode-') ||
      name === '--chat-input-control-height'
    )
      continue;
    seen.add(name);
    const value = computed.getPropertyValue(name).trim();
    if (!value) continue;
    tokens.push({ name, value, category: classifyToken(name, value) });
  }
  // Best-effort declaration trace — a token with no traced rule simply has no
  // `declaredIn`, which the inspector renders as read-only (see the field).
  for (const token of tokens) {
    const declared = declarations.get(token.name);
    if (declared) token.declaredIn = declared;
  }
  return tokens;
}

const COLOR_VALUE_RE = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\()/i;
const SPACING_NAME_RE = /spacing|gap|margin|padding|radius|size|width|height/i;

const COLOR_NAME_RE = /color/i;

/**
 * Classify a design token by its name + value (visual-edit `getDesignTokens`
 * :524), in two rungs.
 *
 * The VALUE is ground truth: `oklch(…)`/`#rrggbb` IS a color, whatever the
 * token is called. Only when the value settles nothing does the NAME decide —
 * and that rung is a guess about someone else's naming convention
 * (`--brand-colorway` is not a color; `--icon-size: 2` is not spacing if it is
 * a count). The guess still stands, because a swatch for `--accent: red` is
 * better than a text box; it is just no longer silent
 * (ARCHITECTURE-CORE §The editor protocol, "Zero inference").
 *
 * `other` is not a guess — it is the honest "nothing said", and reports nothing.
 */
function classifyToken(name: string, value: string): DesignToken['category'] {
  if (COLOR_VALUE_RE.test(value)) return 'color';
  if (COLOR_NAME_RE.test(name)) {
    warnGuessedFromText(':root', name, 'color');
    return 'color';
  }
  if (SPACING_NAME_RE.test(name) && /^\d/.test(value)) {
    warnGuessedFromText(':root', name, 'spacing');
    return 'spacing';
  }
  return 'other';
}

// --- Cap 8: UX-polish helpers (visual-edit preload.ts getElementsInRect :635 /
//     getSnapTargets :592 / getEmptyContainers :563 / getColorAtPoint :667 /
//     getAvailableFonts :677). Ported as pure/injectable direct-call helpers. ---

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Axis-aligned rectangle intersection test (edges from x/y/width/height). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  if (a.x + a.width < b.x || a.x > b.x + b.width) return false;
  if (a.y + a.height < b.y || a.y > b.y + b.height) return false;
  return true;
}

/** A marquee candidate: an OID-tagged element's rect + the oids of its OID-tagged
 *  descendants (for the deepest-element filter). */
export interface MarqueeCandidate {
  oid: string;
  rect: Rect;
  descendantOids: string[];
}

/**
 * Marquee-select: the OID elements intersecting `rect`, filtered to the DEEPEST matches —
 * an element is dropped if any of its OID descendants also matched (visual-edit
 * `getElementsInRect` :635). Zero-area candidates are ignored. Pure; the browser wrapper
 * builds candidates from `document.querySelectorAll('[data-oid]')`.
 */
export function getElementsInRect(
  rect: Rect,
  candidates: readonly MarqueeCandidate[],
): { oid: string; rect: Rect }[] {
  const hit = candidates.filter(
    (c) => (c.rect.width > 0 || c.rect.height > 0) && rectsIntersect(c.rect, rect),
  );
  const hitOids = new Set(hit.map((c) => c.oid));
  return hit
    .filter((c) => !c.descendantOids.some((d) => d !== c.oid && hitOids.has(d)))
    .map((c) => ({ oid: c.oid, rect: c.rect }));
}

/** Per-side padding of a container (px). */
export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Snap targets for dragging a child: the parent's PADDING box + its other children's rects
 * (visual-edit `getSnapTargets` :592). Pure geometry.
 */
export function computeSnapTargets(
  parentRect: Rect,
  padding: Padding,
  siblingRects: readonly Rect[],
): { paddingBox: Rect; siblingRects: Rect[] } {
  return {
    paddingBox: {
      x: parentRect.x + padding.left,
      y: parentRect.y + padding.top,
      width: parentRect.width - padding.left - padding.right,
      height: parentRect.height - padding.top - padding.bottom,
    },
    siblingRects: siblingRects.filter((r) => r.width > 0 && r.height > 0),
  };
}

/** An empty-container candidate (an OID element with no visible children/text). */
export interface EmptyCandidate {
  oid: string;
  rect: Rect;
  displayName: string;
  hasVisibleChildren: boolean;
  hasText: boolean;
}

/**
 * Empty-container hint targets: OID elements with no visible children, no text, and a
 * collapsed dimension (< 8px) — shown as a placeholder so an empty flex/grid container is
 * still selectable (visual-edit `getEmptyContainers` :563). The placeholder rect is grown
 * to a minimum tappable size AROUND the measured box. Keeping the measured center fixed is
 * load-bearing: a zero-width/height flex item denotes a line/point, and growing only toward
 * the bottom-right makes the grey dashed hint appear displaced from that authored position.
 */
export function findEmptyContainers(
  candidates: readonly EmptyCandidate[],
): { oid: string; rect: Rect; displayName: string }[] {
  const out: { oid: string; rect: Rect; displayName: string }[] = [];
  for (const c of candidates) {
    if (c.hasVisibleChildren || c.hasText) continue;
    if (c.rect.width >= 8 && c.rect.height >= 8) continue;
    const width = Math.max(c.rect.width, 40);
    const height = Math.max(c.rect.height, 24);
    out.push({
      oid: c.oid,
      displayName: c.displayName,
      rect: {
        x: c.rect.x - (width - c.rect.width) / 2,
        y: c.rect.y - (height - c.rect.height) / 2,
        width,
        height,
      },
    });
  }
  return out;
}

const TRANSPARENT_BG = new Set(['', 'transparent', 'rgba(0, 0, 0, 0)']);

/** Is a computed background color effectively transparent? */
export function isTransparentBackground(bg: string): boolean {
  return TRANSPARENT_BG.has(bg);
}

/**
 * Eyedropper: the effective background color at a point — the first non-transparent
 * background walking from the hit element up its ancestor chain, else `#fff` (visual-edit
 * `getColorAtPoint` :667 / `getEffectiveBackground` :63). `bgChain` is hit-element-first.
 */
export function effectiveColorFromChain(bgChain: readonly string[]): string {
  for (const bg of bgChain) if (!isTransparentBackground(bg)) return bg;
  return '#fff';
}

const WEB_SAFE_FONTS = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Verdana',
  'Courier New',
  'Impact',
  'Trebuchet MS',
  'Palatino Linotype',
  'Lucida Console',
  'monospace',
  'sans-serif',
  'serif',
];

/** The available font families: the loaded fonts (quotes stripped) merged with the
 *  web-safe fallbacks, de-duped and sorted (visual-edit `getAvailableFonts` :677). */
export function mergeFonts(loaded: readonly string[] = []): string[] {
  const fonts = new Set<string>();
  for (const f of loaded) fonts.add(f.replace(/^["']|["']$/g, ''));
  for (const f of WEB_SAFE_FONTS) fonts.add(f);
  return [...fonts].sort((a, b) => a.localeCompare(b));
}

/** Browser wrapper: enumerate `document.fonts` families merged with the web-safe list.
 *  Returns just the web-safe list under a headless (no `document.fonts`) environment. */
export function getAvailableFonts(): string[] {
  const g = globalThis as { document?: { fonts?: Iterable<{ family: string }> } };
  const loaded: string[] = [];
  const docFonts = g.document?.fonts;
  if (docFonts) for (const f of docFonts) loaded.push(f.family);
  return mergeFonts(loaded);
}

function readRootComputed(): (ComputedStyleLike & ArrayLike<string>) | undefined {
  const g = globalThis as {
    window?: { getComputedStyle?: (e: unknown) => ComputedStyleLike & ArrayLike<string> };
    document?: { documentElement?: unknown };
  };
  const root = g.document?.documentElement;
  if (!root || !g.window?.getComputedStyle) return undefined;
  return g.window.getComputedStyle(root);
}
