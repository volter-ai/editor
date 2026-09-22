/**
 * SCOPED GAME CSS — a foreign game's page-level stylesheet, rewritten so it
 * paints only inside a container the host designates, and nothing else.
 *
 * The problem this exists for, stated as it was measured: the vendored pmndrs
 * `racing-game` keeps its HUD's whole layout in `src/styles.css` — `.clock`,
 * `.speed`, `.leaderboard`, plus `html, body, #root { width: 100vw; height:
 * 100vh }` and a `body` background/colour/font. That sheet cannot be loaded
 * into the editor's document: its `html`/`body`/`*`/`button` rules would
 * restyle the EDITOR (its own canvases are sized by exactly those page rules).
 * So the host shim deliberately never imported it, and every surface that
 * shows the game's DOM — the UI board's story cards, the ingest surface in
 * Play — rendered the HUD with zero layout. That was a recorded host-capability
 * gap, not a game defect. This module closes it.
 *
 * ## The mechanism: native CSS `@scope`, not selector prefixing
 *
 * The whole sheet is wrapped in `@scope (<scopeSelector>) { … }`. The browser
 * then matches every rule inside it ONLY against the scope root and its
 * descendants — `.a .b`, `>` combinators, `:hover`, `::before`, `:is()`,
 * attribute selectors, counters and anything CSS grows later, all with the
 * engine's own semantics and with the sheet's internal cascade order intact.
 *
 * The alternative — parsing every selector and prefixing it with the container
 * — was rejected because it means REIMPLEMENTING selector semantics: `*` would
 * stop matching the container itself, specificity would silently shift by one
 * class, and every future selector syntax is a new bug. `@scope` moves all of
 * that into the engine that will render it. It is Baseline-available (Chrome
 * 118+, Safari 17.4+, Firefox 128+) and the editor is a current-Chrome surface;
 * `CSSScopeRule` is the feature detection the client half uses so a browser
 * without it reports an honest note instead of leaking the sheet.
 *
 * What `@scope` does NOT do, and is therefore the entire remaining transform:
 *
 * 1. **Page-level selectors go inert.** `html`, `body` and `:root` are
 *    ANCESTORS of the scope root, so inside `@scope` they can never match — the
 *    `body { color: white }` that makes the HUD legible would silently vanish.
 *    Every such compound is rewritten to `:scope`, and runs of `:scope` left
 *    adjacent by that rewrite (`html body` → `:scope :scope`) collapse to one.
 *    The scope container's own BOX is not taken from the game: the host sets
 *    width/height/position inline on it (a story frame's `content`, the ingest
 *    `#container`), and an inline declaration beats any rule in this sheet — so
 *    `width: 100vw` arrives, loses, and costs nothing.
 * 2. **Non-scopable at-rules must be hoisted.** `@keyframes`, `@font-face`,
 *    `@import` and friends define global names rather than matching elements;
 *    they are lifted out of the `@scope` block and emitted ahead of it.
 *    Keyframe names are deliberately NOT namespaced: measured on this repo,
 *    all 17 of the editor's own `@keyframes` are `vgai-`-prefixed while
 *    racing's two are `boostBlink`/`hideSoundIcon`, so the collision the
 *    namespacing would prevent does not exist — and buying it would require a
 *    correct `animation` shorthand rewriter, which is real machinery paid for
 *    with nothing.
 * 3. **Relative `url()`s would resolve against the EDITOR's page.** They are
 *    rebased onto the stylesheet's own served URL, so a game asset request goes
 *    where the game meant it to.
 *
 * The game's bytes on disk are never touched: this runs at serve time, over a
 * copy read out of the vendored tree, which is what keeps
 * `vendor/games/verify-unaltered.mjs` green.
 */

import { GAME_CSS_SCOPE_SELECTOR } from '@volter/editor-sdk/session/game-css-scope';
import postcss, { type AtRule } from 'postcss';

/**
 * At-rules whose block holds ordinary style rules and therefore stays INSIDE
 * the `@scope` wrapper — conditional groups plus `@layer`'s block form. Every
 * other at-rule defines a global name (`@keyframes`, `@font-face`,
 * `@property`, `@counter-style`) or is a header directive (`@import`,
 * `@charset`, `@namespace`) and is hoisted ahead of the wrapper.
 */
const SCOPABLE_AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'scope']);

/** At-rules that must precede every other rule in the emitted sheet. */
const HEADER_AT_RULES = new Set(['charset', 'import', 'namespace']);

/**
 * A compound selector whose type/pseudo part addresses the PAGE rather than an
 * element inside it. Anchored at the compound's start; the negative lookahead
 * keeps `bodyguard`/`html-frame` (real class-free custom element names) out.
 */
const PAGE_COMPOUND = /^(html|body|:root)(?![\w-])/i;

/** Any character that can start a top-level combinator run. */
const COMBINATOR_CHAR = /[\s>+~]/;

export interface ScopeGameCssOptions {
  /** The stylesheet's own bytes, exactly as read from disk. */
  readonly css: string;
  /** Selector the emitted `@scope` block is rooted at, e.g. `[data-x]`. */
  readonly scopeSelector: string;
  /**
   * Root-relative URL path the stylesheet itself is served at (e.g.
   * `/@fs/…/styles.css`) — the base every relative `url()` in it is rebased
   * onto. Omitted, `url()`s are left untouched: a caller with no served
   * identity for the sheet has nothing honest to rebase against.
   */
  readonly styleSheetPath?: string;
}

/**
 * Origin the rebase arithmetic borrows. `URL` cannot resolve against a
 * relative base, and the emitted url must stay ORIGIN-RELATIVE — a served game
 * asset is on whatever origin the editor is on, and baking one in would break
 * the moment a session moves port.
 */
const REBASE_ORIGIN = 'http://vgai.invalid';

/**
 * Rewrite one stylesheet so it applies only inside `scopeSelector`. Pure: no
 * disk, no network, no globals — the whole point is that the interesting half
 * of this feature is testable against racing's real `styles.css` offline.
 */
export function scopeGameCss({ css, scopeSelector, styleSheetPath }: ScopeGameCssOptions): string {
  const root = postcss.parse(css, { from: undefined });

  if (styleSheetPath !== undefined) {
    root.walkDecls((decl) => {
      const rebased = rebaseUrls(decl.value, styleSheetPath);
      if (rebased !== decl.value) decl.value = rebased;
    });
  }

  // Hoist BEFORE selectors are rewritten: a `@keyframes` block's children are
  // ordinary postcss `Rule`s whose "selectors" are `from`/`to`/`50%`, and
  // rewriting those would be nonsense. Lifting them out first means the
  // selector walk below cannot see them at all.
  const hoisted: AtRule[] = [];
  root.each((node) => {
    if (node.type !== 'atrule') return;
    if (SCOPABLE_AT_RULES.has(node.name.replace(/^-\w+-/, '').toLowerCase())) return;
    hoisted.push(node);
  });
  for (const node of hoisted) node.remove();

  root.walkRules((rule) => {
    const rewritten = dedupeSelectors(rule.selectors.map(rewritePageSelector));
    if (rewritten.length > 0) rule.selectors = rewritten;
  });

  // RESPONSIVE PREVIEW (design ledger: breakpoints — the beat-Figma move).
  // Every game surface shares the one editor window, so a width `@media` in
  // game CSS can never fire per-frame: a 375px story frame would still take
  // the desktop styles. Rewriting width/height-only media conditions into
  // `@container` queries — with every scope root made a size container
  // below — means the frame's OWN width answers the query: a phone-preset
  // frame actually applies the game's phone styles, live, next to a desktop
  // frame applying the desktop ones. Serve-time only: the source (and any
  // exported build) keeps real `@media` truth. Conditions with any
  // non-dimensional feature (prefers-*, hover, print, …) are left as
  // `@media` — rewriting them would be a lie, not a preview.
  root.walkAtRules('media', (at) => {
    const condition = containerConditionForMedia(at.params);
    if (condition === null) return;
    at.name = 'container';
    at.params = condition;
  });

  const scoped = postcss.atRule({
    name: 'scope',
    params: `(${scopeSelector})`,
    nodes: [],
    raws: { before: '\n', afterName: ' ', between: ' ', after: '\n' },
  });
  scoped.append(root.nodes.map((node) => node.clone()));
  // The container-query half of the responsive preview: the scope root IS the
  // frame content, so it is the container the rewritten queries resolve
  // against. Appended last, so a game's own `:scope` styling never wins the
  // container-type back.
  scoped.append(
    postcss.rule({
      selector: ':scope',
      nodes: [postcss.decl({ prop: 'container-type', value: 'inline-size' })],
      raws: { before: '\n', between: ' ', after: ' ' },
    }),
  );
  root.removeAll();
  // The first node inside a freshly-built block carries whatever `before` raw
  // it had at the old top level (an empty string, for the very first rule of a
  // file) — which would emit `@scope (…) {* { … }` on one line.
  if (scoped.first) scoped.first.raws.before = '\n';

  const header = hoisted.filter((node) => HEADER_AT_RULES.has(node.name.toLowerCase()));
  const globals = hoisted.filter((node) => !HEADER_AT_RULES.has(node.name.toLowerCase()));
  const out = postcss.root();
  for (const node of [...header, ...globals]) out.append(node);
  out.append(scoped);
  return out.toString();
}

/**
 * Replace every page-level compound in one selector with `:scope`, then
 * collapse the adjacent duplicates that produces.
 *
 * `body` → `:scope`; `body.loading .x` → `:scope.loading .x`; `html body #root`
 * → `:scope #root`. A selector with no page compound comes back untouched, so
 * the overwhelming majority of a game's rules pass through byte-for-byte.
 */
export function rewritePageSelector(selector: string): string {
  const compounds = splitCompounds(selector);
  let sawPageCompound = false;
  const mapped = compounds.map((part) => {
    if (part.combinator) return part;
    if (!PAGE_COMPOUND.test(part.text)) return part;
    sawPageCompound = true;
    return { ...part, text: part.text.replace(PAGE_COMPOUND, ':scope') };
  });
  if (!sawPageCompound) return selector;
  return collapseScopeRuns(mapped)
    .map((part) => part.text)
    .join('');
}

interface SelectorPart {
  readonly text: string;
  readonly combinator: boolean;
}

/**
 * Split a complex selector into alternating compound / combinator parts,
 * ignoring anything inside `(…)`, `[…]` or a string — so `:is(a, b) > c` and
 * `[title="a b"]` survive intact.
 */
function splitCompounds(selector: string): SelectorPart[] {
  const parts: SelectorPart[] = [];
  let depth = 0;
  let quote: string | null = null;
  let buffer = '';
  const flush = (combinator: boolean): void => {
    if (buffer.length > 0) parts.push({ text: buffer, combinator });
    buffer = '';
  };
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i]!;
    if (quote) {
      buffer += ch;
      if (ch === quote && selector[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buffer += ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    if (depth === 0 && COMBINATOR_CHAR.test(ch)) {
      // Consume the whole run of combinator characters and whitespace.
      let run = '';
      let j = i;
      while (j < selector.length && COMBINATOR_CHAR.test(selector[j]!)) {
        run += selector[j]!;
        j += 1;
      }
      flush(false);
      parts.push({ text: run, combinator: true });
      i = j - 1;
      continue;
    }
    buffer += ch;
  }
  flush(false);
  return parts;
}

/**
 * `:scope :scope .x` → `:scope .x`. Only a DESCENDANT run collapses: `:scope >
 * :scope` names a real (and, after the rewrite, unsatisfiable) relationship,
 * and silently flattening it would change what the author asked for.
 */
function collapseScopeRuns(parts: readonly SelectorPart[]): SelectorPart[] {
  const out: SelectorPart[] = [];
  for (const part of parts) {
    const previousCombinator = out.at(-1);
    const previousCompound = out.at(-2);
    if (
      part.text === ':scope' &&
      previousCombinator?.combinator === true &&
      previousCombinator.text.trim() === '' &&
      previousCompound?.text === ':scope'
    ) {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out;
}

/** `:scope, :scope, #root` → `:scope, #root`; order of first appearance kept. */
function dedupeSelectors(selectors: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const selector of selectors) {
    const key = selector.trim();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Rebase every relative `url()` in one declaration value onto `basePath` (a
 * root-relative served path), emitting a root-relative url. Absolute urls,
 * protocol-relative urls, root-relative urls, `data:`/`blob:` payloads and
 * bare fragments are left exactly as authored — rebasing any of those would
 * change what the sheet requests.
 */
export function rebaseUrls(value: string, basePath: string): string {
  return value.replace(
    /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)/gi,
    (whole, doubleQuoted?: string, singleQuoted?: string, bare?: string) => {
      const target = doubleQuoted ?? singleQuoted ?? bare ?? '';
      if (target.length === 0) return whole;
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(target)) return whole;
      try {
        const resolved = new URL(target, `${REBASE_ORIGIN}${basePath}`);
        return `url("${resolved.pathname}${resolved.search}${resolved.hash}")`;
      } catch {
        return whole;
      }
    },
  );
}

// ---------------------------------------------------------------------------
// The project's declared sheets, and the honest verdict about them
// ---------------------------------------------------------------------------

/** What one root declared, read straight off the raw manifest. */
interface DeclaredStyles {
  /** Project-root-relative paths, manifest order, de-duplicated. */
  readonly paths: string[];
  /**
   * True when a root mounts a game whose own page this host replaced — an
   * `{ ingest }` adapter. It is the one case where "this project declares no
   * stylesheet" is EVIDENCE of a gap rather than a normal fact: the game had a
   * page, the host shim is standing in for it, and page-level CSS is precisely
   * what a shim cannot carry. A first-party project has no page to lose, so it
   * is never told anything.
   */
  readonly replacesGamePage: boolean;
}

/** Read `roots[].styles` and the ingest verdict off a parsed manifest. */
export function declaredGameStyles(manifest: unknown): DeclaredStyles {
  const roots = (manifest as { roots?: unknown } | null)?.roots;
  const paths: string[] = [];
  let replacesGamePage = false;
  if (!Array.isArray(roots)) return { paths, replacesGamePage };
  for (const root of roots) {
    if (!root || typeof root !== 'object') continue;
    const record = root as { styles?: unknown; adapter?: unknown };
    const adapter = record.adapter;
    if (adapter && typeof adapter === 'object' && 'ingest' in adapter) replacesGamePage = true;
    if (!Array.isArray(record.styles)) continue;
    for (const entry of record.styles) {
      if (typeof entry === 'string' && entry.length > 0 && !paths.includes(entry))
        paths.push(entry);
    }
  }
  return { paths, replacesGamePage };
}

/** One declared sheet, as the caller's I/O found it. */
export interface LoadedStyleSheet {
  /** The bytes on disk, untouched. */
  readonly css: string;
  /** Root-relative path the sheet is served at — the `url()` rebase base. */
  readonly servedPath: string;
}

/** What the editor client is handed for the open project. */
export interface ScopedGameStyles {
  /** The concatenated, scoped stylesheet — `''` when there is nothing to serve. */
  readonly css: string;
  /** The declared paths that were actually read, in emission order. */
  readonly sources: string[];
  /**
   * Non-null when the host KNOWS a surface showing this game's DOM will be
   * missing page-level styling, phrased for the person looking at that surface.
   * Null is not "everything is fine" in general — it is "this host has no
   * evidence of a gap", which for a first-party project is the ordinary state.
   */
  readonly note: string | null;
}

/**
 * Turn the open project's manifest into the stylesheet its game surfaces need.
 *
 * Pure over its `readStyleSheet` callback so the whole decision — which paths,
 * what gets scoped, and what the surfaces are told when it cannot be done — is
 * testable with no disk and no server.
 */
export function buildScopedGameStyles(options: {
  readonly manifest: unknown;
  readonly readStyleSheet: (projectRelativePath: string) => LoadedStyleSheet | null;
}): ScopedGameStyles {
  const { paths, replacesGamePage } = declaredGameStyles(options.manifest);

  if (paths.length === 0) {
    return {
      css: '',
      sources: [],
      note: replacesGamePage
        ? 'unstyled — this project ingests a game whose page-level stylesheet it never declared. ' +
          'Add it as `styles` on that root in vgai.project.json and the editor will serve it ' +
          'scoped to the game.'
        : null,
    };
  }

  const chunks: string[] = [];
  const sources: string[] = [];
  const missing: string[] = [];
  for (const path of paths) {
    const sheet = options.readStyleSheet(path);
    if (!sheet) {
      missing.push(path);
      continue;
    }
    sources.push(path);
    chunks.push(
      scopeGameCss({
        css: sheet.css,
        scopeSelector: GAME_CSS_SCOPE_SELECTOR,
        styleSheetPath: sheet.servedPath,
      }),
    );
  }

  return {
    css: chunks.join('\n'),
    sources,
    note:
      missing.length === 0
        ? null
        : `unstyled — declared stylesheet${missing.length === 1 ? '' : 's'} ` +
          `${missing.map((path) => `\`${path}\``).join(', ')} could not be read from this project.`,
  };
}

/**
 * The `@container` condition equivalent to a width/height-only `@media`
 * prelude, or null when the prelude uses anything else (media types other
 * than screen/all, `not`, commas, non-dimensional features) — those stay
 * `@media`, honestly window-scoped. Handles both the colon form
 * `(max-width: 600px)` and the range form `(width <= 600px)`.
 */
export function containerConditionForMedia(params: string): string | null {
  let p = params.trim();
  p = p.replace(/^only\s+/i, '');
  p = p.replace(/^(screen|all)\s+and\s+/i, '');
  if (/^(screen|all)$/i.test(p)) return null; // type-only prelude — nothing to query
  if (/,|\bnot\b|\bor\b/i.test(p)) return null;
  const terms = p.split(/\s+and\s+/i);
  const dimensional = /^\(\s*((min-|max-)?(width|height)\s*:|(width|height)\s*[<>=])[^()]*\)$/i;
  if (!terms.every((term) => dimensional.test(term.trim()))) return null;
  return p;
}
