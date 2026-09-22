/**
 * Transitive mount-id propagation — the isolation half of multi-instance
 * authoring (ARCHITECTURE-CORE §Observability, "N INSTANCES of one project").
 *
 * WHY THIS EXISTS, and the shortcut it replaces
 * ---------------------------------------------
 * `project-module-url.ts` stamps every ROOT ENTRY url with a mount epoch, and
 * it is tempting to read that as isolation already solved: browser module
 * identity is per-url, so two mounts at different epochs "obviously" have
 * separate module graphs. That is FALSE, and
 * `cross-root-module-identity.test.ts` is the measurement. The epoch rides the
 * ENTRY only; Vite's import-analysis rewrites an entry's own imports to the
 * bare resolved path (`/src/state.ts`, plus `?t=` when invalidated), which
 * carries no epoch. Two entries mounted at different epochs therefore name ONE
 * url for their shared dependency and the browser hands both the SAME
 * instance — one `let snapshot` across both mounts.
 *
 * So the mount id has to PROPAGATE: a project module served under a mount id
 * rewrites its own project-relative imports to carry that same id, and the
 * whole subtree keys per instance.
 *
 * THE CONSTRAINT THAT DEFINES THE RULE: only PROJECT-OWNED modules duplicate
 * -------------------------------------------------------------------------
 * Duplicating everything would be catastrophic, not merely wasteful. The
 * editor and an ingested game deliberately SHARE one `three` instance — that
 * sharing IS the ingestion mechanism — and a second React instance breaks
 * hooks outright (the packaged-runtime dual-React class this repo has already
 * paid for twice). The shared heap is exactly why iframes were rejected for
 * this feature; duplicating packages would reintroduce the same split without
 * the second realm.
 *
 * Hence: rewrite RELATIVE (`./x`, `../x`) and ROOT-ABSOLUTE (`/src/x`)
 * specifiers, which are project source. Never touch a BARE specifier
 * (`three`, `react`, `@react-three/fiber`) — those stay one instance per page,
 * shared by every mount, which is what makes N instances cheap rather than N
 * copies of the engine.
 *
 * `import.meta.hot.accept('./dep', …)` NAMES A DEPENDENCY TOO
 * ----------------------------------------------------------
 * Measured live 2026-08-06 in a scaffolded project, editor running, play live:
 * every write to `src/data/tuning.data.json` produced
 * `[vite] (client) page reload …/tuning.data.json` and a real navigation,
 * destroying the play session — even though the scaffold's `tuning.ts` carries
 * `import.meta.hot?.accept('./tuning.data.json', (m) => tuning.hotSwap(…))`
 * precisely so that edit hot-swaps into the running game instead.
 *
 * The module graph said why. `tuning.ts?vgai-mount=1` imported
 * `tuning.data.json?vgai-mount=1` (its import specifier WAS stamped) while its
 * `acceptedHmrDeps` held the BARE `tuning.data.json` — because the accept
 * call's specifier is a string ARGUMENT, not an import statement, so the
 * rewrite below never saw it. Two consequences, both bad:
 *
 *   1. resolving that bare specifier MINTS a third, importer-less module node
 *      for the file. Vite's `propagateUpdate` reaches it, finds
 *      `importers.size === 0`, and returns its "dead end" — which IS
 *      `full-reload`.
 *   2. even with no reload the accept could never fire, because the node the
 *      importer accepts is not the node it imports.
 *
 * An accepted dep is a project-owned specifier in exactly the sense this
 * module already defines, so it is stamped the same way. The scan mirrors
 * Vite's own `lexAcceptedHmrDeps` (`.hot`, an optional `?.`, then `.accept`; a
 * single string literal or an array of them; `.acceptExports` excluded because
 * its arguments are EXPORT NAMES, not specifiers) so the specifier stamped
 * here is exactly the one Vite will go on to resolve.
 *
 * This module is deliberately pure and side-effect free so it is unit-testable
 * without booting Vite (the same split, and for the same reason, as
 * `game-globals-shadow.ts`).
 */
import { init, parse } from 'es-module-lexer';

/** The query key a project entry url carries. Kept in sync with
 *  `src/project-module-url.ts`'s `PROJECT_MOUNT_QUERY` by
 *  `project-module-instance.test.ts`, which imports both and compares them —
 *  the server half cannot import the browser half's module without dragging
 *  DOM-typed code into `tsconfig.server.json`. */
export const MOUNT_QUERY_KEY = 'vgai-mount';

/** Kept in sync with `src/project-module-url.ts` by the same tripwire as
 *  {@link MOUNT_QUERY_KEY}. */
export const SELECTION_QUERY_KEY = 'vgai-selection';
export const SCENE_QUERY_KEY = 'vgai-scene';

/**
 * Isolation loads a SCREEN CLASS, not the running game. Vendor entries
 * (`main.ts`) call `init()` at module scope — append the live canvas, go to
 * Title. Importing TitleScreen pulls navigation → main → that boot, so Edit
 * grew a live game on `document.body`. The isolate query keys a separate
 * module graph whose `init();` is silenced; Play keeps the unstamped graph.
 */
export const ISOLATE_QUERY_KEY = 'vgai-isolate';
export const ISOLATE_QUERY_VALUE = '1';

/** Read a swap-slot remount off a module id, or `undefined` when it carries none. */
export function selectionOverrideOf(
  moduleId: string,
): { readonly selection: string; readonly key: string } | undefined {
  const query = moduleId.split('?')[1];
  if (query === undefined) return undefined;
  const params = new URLSearchParams(query);
  const selection = params.get(SELECTION_QUERY_KEY);
  const key = params.get(SCENE_QUERY_KEY);
  if (!selection || !key) return undefined;
  return { selection, key };
}

/**
 * A specifier that names PROJECT SOURCE rather than a package.
 *
 * Relative and root-absolute only. A bare specifier is a package and must stay
 * shared (see this module's header) — as must Vite's own internal `/@id/`,
 * `/@fs/` and `/@vite/` routes, which are not the project's modules even
 * though they start with `/`.
 */
export function isProjectOwnedSpecifier(specifier: string): boolean {
  if (specifier.startsWith('./') || specifier.startsWith('../')) return true;
  if (!specifier.startsWith('/')) return false;
  return !specifier.startsWith('/@');
}

/** Read the mount id off a module id/url, or `undefined` when it carries none. */
export function mountIdOf(moduleId: string): string | undefined {
  const query = moduleId.split('?')[1];
  if (query === undefined) return undefined;
  return new URLSearchParams(query).get(MOUNT_QUERY_KEY) ?? undefined;
}

/** Append the mount id to one specifier, preserving any query it already has. */
export function withMountId(specifier: string, mountId: string): string {
  return withQuery(specifier, MOUNT_QUERY_KEY, mountId);
}

/** True when this module was imported as an isolation piece. */
export function isolateFlagOf(moduleId: string): boolean {
  const query = moduleId.split('?')[1];
  if (query === undefined) return false;
  return new URLSearchParams(query).get(ISOLATE_QUERY_KEY) === ISOLATE_QUERY_VALUE;
}

/** Stamp one specifier so its isolated graph stays isolated. */
export function withIsolateFlag(specifier: string): string {
  return withQuery(specifier, ISOLATE_QUERY_KEY, ISOLATE_QUERY_VALUE);
}

/** A root-absolute import of vendored game source (`/vendor/games/<id>/…`). */
export function isVendorGameSpecifier(specifier: string): boolean {
  return specifier.split('?')[0]!.startsWith('/vendor/games/');
}

/**
 * True when `file` is under a project root's own `src/` — prefabs, lib,
 * stories. `entry.ts` / the shim live next to `src/` and must keep the
 * unstamped vendor graph so Play still boots.
 */
export function isProjectSrcModule(file: string, roots: Iterable<string>): boolean {
  const normalized = file.replace(/\\/g, '/').split('?')[0]!;
  for (const root of roots) {
    const src = `${root.replace(/\\/g, '/').replace(/\/$/, '')}/src/`;
    if (normalized.startsWith(src)) return true;
  }
  return false;
}

function withQuery(specifier: string, key: string, value: string): string {
  const query = specifier.split('?')[1];
  if (query !== undefined && new URLSearchParams(query).get(key) !== null) return specifier;
  const separator = specifier.includes('?') ? '&' : '?';
  return `${specifier}${separator}${key}=${value}`;
}

/**
 * A vendor game's boot is a module-scope `init();` (bubbo `main.ts`: append
 * the canvas, `goToScreen(TitleScreen)`). Isolation imported the class
 * through that graph and the live game appeared in Edit. Play still runs
 * the unstamped module; this only rewrites the isolated copy.
 */
export function silenceIsolatedEntrypointBoot(code: string): string | null {
  const pattern = /^[ \t]*init\(\);[ \t]*$/gm;
  if (!pattern.test(code)) return null;
  return code.replace(/^[ \t]*init\(\);[ \t]*$/gm, 'void 0;');
}

/** A string-literal specifier found inside an `import.meta.hot.accept(` call,
 *  bounded by the quotes (so the quote characters themselves survive a splice). */
interface AcceptedDepSpecifier {
  readonly start: number;
  readonly end: number;
  readonly specifier: string;
}

/**
 * The string-literal dependencies of the `import.meta.hot.accept(` call whose
 * `(` sits at `openParen` — a faithful subset of Vite's `lexAcceptedHmrDeps`:
 * one bare string literal, or an array of them, and nothing else.
 *
 * Deliberately NEVER throws. Vite lexes the same call moments later and owns
 * reporting a malformed one; a transform that threw here would turn a bad
 * `accept()` into a dead dev server. Anything unrecognized (a callback, an
 * interpolated template, an identifier) simply ends the scan, leaving whatever
 * was already read — the same "unprovable specifiers fall back to the shared
 * instance" degrade the header describes for computed imports.
 */
function acceptedDepSpecifiers(code: string, openParen: number): AcceptedDepSpecifier[] {
  const deps: AcceptedDepSpecifier[] = [];
  let inArray = false;
  let i = openParen + 1;
  while (i < code.length) {
    const char = code[i]!;
    // Whitespace, the array's `[`, and its separators are the only things that
    // may sit BETWEEN literals. Anything else (a callback, an identifier, `]`)
    // ends the dep list.
    if (
      /\s/.test(char) ||
      (char === '[' && !inArray && deps.length === 0) ||
      (inArray && char === ',')
    ) {
      inArray ||= char === '[';
      i++;
      continue;
    }
    if (char !== "'" && char !== '"' && char !== '`') return deps;
    const end = closingQuote(code, i);
    if (end === undefined) return deps; // unterminated or interpolated — Vite's to report
    deps.push({ start: i + 1, end, specifier: code.slice(i + 1, end) });
    // The single-literal form takes exactly one dep; the rest is the callback.
    if (!inArray) return deps;
    i = end + 1;
  }
  return deps;
}

/** Index of the quote closing the literal opened at `open`, or `undefined` when
 *  the literal is unterminated or interpolates (`${…}`) and so names no static
 *  specifier. Escapes are not handled, matching Vite's own lexer. */
function closingQuote(code: string, open: number): number | undefined {
  const quote = code[open];
  for (let i = open + 1; i < code.length; i++) {
    if (code[i] === quote) return i;
    if (quote === '`' && code[i] === '$' && code[i + 1] === '{') return undefined;
  }
  return undefined;
}

/**
 * Where the string-literal deps of an `import.meta.hot.accept(` call start, for
 * the `import.meta` occurrence the lexer reported at `[start, end)` — or
 * `undefined` when this occurrence is not such a call.
 *
 * Character-for-character Vite's own test in `vite:import-analysis`, including
 * the optional `?.` after `.hot` (the scaffold's own `import.meta.hot?.accept`
 * spelling) and the `.acceptExports` exclusion.
 */
function acceptCallOpenParen(code: string, end: number): number | undefined {
  if (code.slice(end, end + 4) !== '.hot') return undefined;
  const afterHot = end + 4 + (code[end + 4] === '?' ? 1 : 0);
  if (code.slice(afterHot, afterHot + 7) !== '.accept') return undefined;
  if (code.slice(afterHot, afterHot + 14) === '.acceptExports') return undefined;
  const open = code.indexOf('(', afterHot + 7);
  return open === -1 ? undefined : open;
}

/** One splice into the source: `[start, end)` replaced by `text`. */
interface SpecifierEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * The edits that stamp `mountId` onto the project-owned deps of the
 * `import.meta` occurrence the lexer reported at `[start, end)`. Empty for
 * every other `import.meta` use (`.env`, `.url`, a self-accept, `.dispose`).
 */
function acceptedDepEdits(
  code: string,
  start: number,
  end: number,
  stamp: (specifier: string) => string,
): SpecifierEdit[] {
  if (code.slice(start, end) !== 'import.meta') return [];
  const open = acceptCallOpenParen(code, end);
  if (open === undefined) return [];
  const edits: SpecifierEdit[] = [];
  for (const dep of acceptedDepSpecifiers(code, open)) {
    if (!isProjectOwnedSpecifier(dep.specifier)) continue;
    const rewritten = stamp(dep.specifier);
    if (rewritten === dep.specifier) continue;
    // Bounds exclude the quotes, so the source's own quoting survives.
    edits.push({ start: dep.start, end: dep.end, text: rewritten });
  }
  return edits;
}

/**
 * Rewrite every project-owned import specifier in `code` to carry `mountId`.
 * Returns `null` when nothing changed, which is the Vite `transform` contract
 * for "not mine" and keeps the module's identity untouched.
 *
 * Uses `es-module-lexer` — Vite's own import scanner — rather than a regex, so
 * a specifier inside a string literal or a comment is not mistaken for an
 * import. Dynamic `import()` is included when its argument is a static string
 * (the lexer reports the others without usable bounds, and a computed
 * specifier cannot be rewritten at build time anyway; those fall back to the
 * shared instance, which is the honest degrade rather than a silent guess).
 *
 * Call `await init` before this — `initLexer()` below is the one-liner.
 */
export function rewriteProjectImportsForMount(code: string, mountId: string): string | null {
  return rewriteProjectImports(code, (specifier) => withMountId(specifier, mountId));
}

/** Same rewrite as the mount id, carrying the isolate flag through the vendor graph. */
export function rewriteProjectImportsForIsolate(code: string): string | null {
  return rewriteProjectImports(code, withIsolateFlag);
}

/**
 * Project `src/` reaching into `/vendor/games/` is a design-time piece, not
 * the live mount. Stamp isolate here so prefabs do not write the query.
 */
export function rewriteVendorImportsForIsolate(code: string): string | null {
  return rewriteProjectImports(code, (specifier) =>
    isVendorGameSpecifier(specifier) ? withIsolateFlag(specifier) : specifier,
  );
}

function rewriteProjectImports(code: string, stamp: (specifier: string) => string): string | null {
  const [imports] = parse(code);
  // Right-to-left so each splice leaves earlier offsets valid.
  const edits: SpecifierEdit[] = [];
  for (const record of imports) {
    if (record.n === undefined) {
      // The lexer reports `import.meta` here too, and an
      // `import.meta.hot.accept('./dep', …)` names a dependency exactly like an
      // import statement does — see this module's header for the page reload
      // that not stamping it caused.
      edits.push(...acceptedDepEdits(code, record.s, record.e, stamp));
      continue;
    }
    if (!isProjectOwnedSpecifier(record.n)) continue;
    const rewritten = stamp(record.n);
    if (rewritten === record.n) continue;
    // The two import forms bound their specifier DIFFERENTLY, and getting this
    // wrong is silent syntax corruption rather than a missed rewrite: for a
    // STATIC import `s..e` excludes the quotes, while for a DYNAMIC one
    // (`d > -1`) it spans the whole argument expression INCLUDING them. Writing
    // the bare specifier over a dynamic import's bounds yields
    // `import(./state?vgai-mount=3)`. Re-quote with the source's own quote
    // character so the module's style survives too.
    if (record.d > -1) {
      const quote = code[record.s];
      if (quote !== "'" && quote !== '"') continue; // not a plain string literal
      edits.push({ start: record.s, end: record.e, text: `${quote}${rewritten}${quote}` });
      continue;
    }
    edits.push({ start: record.s, end: record.e, text: rewritten });
  }
  if (edits.length === 0) return null;
  let out = code;
  // Sorted, then applied right-to-left, so every splice leaves the offsets of
  // the edits still to come valid. Sorting is not decoration: accepted-dep
  // offsets come from a scan AHEAD of their `import.meta` record, so record
  // order alone no longer implies source order.
  edits.sort((a, b) => a.start - b.start);
  for (const edit of edits.reverse()) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

/** `es-module-lexer` needs its wasm initialized once per process. */
export async function initLexer(): Promise<void> {
  await init;
}
