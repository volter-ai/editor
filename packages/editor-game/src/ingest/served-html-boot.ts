/**
 * Booting a served bundle THE WAY ITS OWN DOCUMENT SAYS TO.
 *
 * Every other ingest entry is an ES module and the host imports it. A bundle
 * built by a CLASSIC-SCRIPT toolchain is not one, and importing it as a module
 * is not a degraded boot — it is a different language mode. Measured on
 * `public/ingest/cuberun` (Create React App / webpack 4, the recorded build
 * recipe in `scripts/cuberun/steps/01-build.mjs`):
 *
 *   TypeError: Cannot read properties of undefined (reading 'webpackJsonpcubeworld')
 *
 * because the chunk opens `(this.webpackJsonpcubeworld = this.webpackJsonpcubeworld || [])`
 * and top-level `this` is the window in a classic script and `undefined` in an
 * ES module. Two more facts come with it: the entry is the LAST of three
 * scripts (webpack runtime, vendor chunk, app chunk) that must run in order,
 * and the app mounts into a `<div id="root">` its own document declares.
 *
 * ZERO INFERENCE about any of that. `index.html` beside the bundle is the
 * game's OWN statement of its boot: which scripts, in what order, in which
 * language mode, and what DOM exists before they run. This module reads that
 * statement and does what it says; it never sniffs the source, and a bundle
 * whose entry the document loads with `type="module"` (tanks, simcity, every
 * three.js example here) takes the ordinary module path untouched.
 *
 * WHAT THIS DOES NOT DO, because the host already does it:
 *  - SIZE/CONTAIN the page. `mountIngestGame` makes `hostEl` the realm's
 *    `document.body` (`setGameSurface`), absolutely positioned and full-size,
 *    so the transplanted body lands in a real box.
 *  - STYLE it. The root's `styles` manifest field serves the bundle's own
 *    stylesheet rewritten into `@scope` (`server/scoped-game-css.ts`), which is
 *    what turns `#root,body,html{width:100%;height:100%}` into a sized root
 *    without the editor seeing one of those rules. A `<link rel=stylesheet>` in
 *    the document is NOT auto-loaded here: an unscoped page sheet restyles the
 *    editor, and the declaration is the mechanism that already exists for it.
 *  - SHADOW globals. The concatenated source is prefixed with
 *    `GAME_GLOBALS_PRELUDE`, whose own doc comment records that it is kept
 *    evaluable outside ES-module scope precisely so a non-module evaluation
 *    path like this one can use it.
 */

import { loadGameCssScoper, SCOPED_STYLE_MARK } from '../host/game-realm-page';
import { GAME_GLOBALS_PRELUDE, gameRealmPage } from '../host/gated-globals';
import { ingestGameRealmWindow } from './game-contract-realm';

/** One `<script>` the document declares, in document order. */
export interface DeclaredScript {
  /** Absolute served URL, or `null` for an inline script. */
  readonly src: string | null;
  /** Inline body; empty for a `src` script. */
  readonly inline: string;
  /** `true` when the document loads it with `type="module"`. */
  readonly module: boolean;
}

/** What a served bundle's own `index.html` declares about its boot. */
export interface DeclaredBoot {
  /** The document's own inline `<style>` texts, in order — installed SCOPED. */
  readonly inlineCss: readonly string[];
  readonly scripts: readonly DeclaredScript[];
  /** The document's body markup with every `<script>` removed. */
  readonly bodyHtml: string;
}

/**
 * Parse a served bundle's `index.html`. `null` when the folder ships none —
 * an ordinary case (a bundle built as a bare module has nothing to declare),
 * and never an error.
 */
export async function readDeclaredBoot(
  baseUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<DeclaredBoot | null> {
  let html: string;
  try {
    const response = await fetchImpl(`${baseUrl}index.html`);
    if (!response.ok) return null;
    html = await response.text();
  } catch {
    return null;
  }
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  // The dev server answers an unknown path with the EDITOR's index.html, which
  // parses perfectly well and would then be read as this game's boot. A served
  // bundle's own document is the one whose scripts resolve under its own base.
  // The page's own inline <style> blocks are part of its statement too — a
  // game may size its mount div there (phaser-catch-the-cat's
  // `#catch-the-cat { width: 100% }`). They are collected for SCOPED
  // installation (the same `@scope` transform declared sheets get), never
  // injected raw: an unscoped page rule would restyle the editor.
  const inlineCss: string[] = [];
  for (const el of Array.from(parsed.querySelectorAll('style'))) {
    const text = el.textContent ?? '';
    if (text.trim().length > 0) inlineCss.push(text);
    el.remove();
  }
  const scripts: DeclaredScript[] = [];
  for (const el of Array.from(parsed.querySelectorAll('script'))) {
    // A `<script>` with a non-JS `type` is DATA the game reads back out of
    // the DOM (`x-shader/x-vertex` blocks fetched by id — three.js example
    // convention), never code. It must SURVIVE into the staged DOM, not be
    // queued for evaluation: concatenating GLSL as JS is a SyntaxError, and
    // stripping it left `getElementById('vertexshader')` null (measured:
    // three-points-waves' TypeError, 2026-08-27). Head-
    // declared data tags are moved into the body so the transplant carries
    // them.
    const type = el.getAttribute('type');
    const executable =
      type === null || type === 'module' || /^(text|application)\/javascript$/i.test(type);
    if (!executable) {
      if (!parsed.body.contains(el)) parsed.body.prepend(el);
      continue;
    }
    const rawSrc = el.getAttribute('src');
    // A cross-origin script keeps its FULL href: flattening a CDN URL to its
    // pathname re-rooted it onto this origin, where the SPA fallback answered
    // with HTML (server-survival's three.min.js CDN dependency, 2026-08-27).
    const resolved =
      rawSrc === null ? null : new URL(rawSrc, `${globalThis.location.origin}${baseUrl}`);
    scripts.push({
      src:
        resolved === null
          ? null
          : resolved.origin === globalThis.location.origin
            ? resolved.pathname
            : resolved.href,
      inline: rawSrc === null ? (el.textContent ?? '') : '',
      module: type === 'module',
    });
    el.remove();
  }
  if (!scripts.some((script) => script.src?.startsWith(baseUrl))) return null;
  return { scripts, bodyHtml: parsed.body.innerHTML, inlineCss };
}

/**
 * Does this document load `entryUrl` as a CLASSIC script?
 *
 * `false` for "as a module" AND for "does not mention it at all" — in both
 * cases the ordinary module import is the right and unchanged behaviour.
 */
export function declaresClassicEntry(boot: DeclaredBoot | null, entryUrl: string): boolean {
  const declared = boot?.scripts.find((script) => script.src === entryUrl);
  return declared !== undefined && !declared.module;
}

/**
 * Run the bundle exactly as its document declares: its body DOM first, then
 * every script in order, as ONE classic script with `this === window`.
 *
 * The scripts are concatenated into a single function body rather than
 * evaluated one at a time because that is what classic scripts on a page
 * actually get — a shared variable environment. A webpack build communicates
 * only through `this.webpackJsonp<name>`, so either shape boots it; a bundle
 * that splits a `var` across two scripts needs the shared one.
 */
/**
 * Transplant the declared document's BODY into the game realm — the DOM the
 * game's own scripts assume exists before they run (mount divs, and the
 * non-JS `<script>` data tags `readDeclaredBoot` preserves). Shared by the
 * classic boot below and by {@link import('./served-bundle').servedEntryLoader}'s
 * MODULE branch: a module-entry game reads its page's elements exactly as a
 * classic one does, and the module path used to import with an empty realm —
 * `getElementById(...)` answered null and the mount failed by TypeError
 * (three-points-waves, 2026-08-27). Idempotent per realm: a
 * previous transplant is replaced, never doubled.
 */
export async function stageDeclaredDom(boot: DeclaredBoot): Promise<void> {
  const realmDocument = ingestGameRealmWindow().document;
  realmDocument.querySelector('[data-vgai-declared-dom]')?.remove();
  if (boot.bodyHtml.trim().length === 0 && boot.inlineCss.length === 0) return;
  const holder = realmDocument.createElement('div');
  holder.setAttribute('data-vgai-declared-dom', '');
  // `pointer-events:none` on the WRAPPER, restored per child: the holder is a
  // host artifact, not part of the game's page, and it blanketed the game's
  // canvas — a Babylon game whose whole UI is in-canvas (space-truckers' GUI
  // 'press any key') never received a single click, which two human passes
  // read as 'no input works' (2026-08-28). The game's own DOM children stay
  // fully interactive; only the wrapper's empty area falls through.
  holder.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  holder.innerHTML = boot.bodyHtml;
  for (const child of Array.from(holder.children)) {
    if (child instanceof HTMLElement && child.style.pointerEvents === '') {
      child.style.pointerEvents = 'auto';
    }
  }
  if (boot.inlineCss.length > 0) {
    // Scoped through the SAME transform declared sheets get — CSS applies
    // document-wide wherever the element sits, so containment comes from
    // `@scope`, and lifecycle comes from living inside the holder.
    try {
      const scopeCss = await loadGameCssScoper();
      const style = realmDocument.createElement('style');
      const scoped = boot.inlineCss.map(scopeCss).join('\n');
      // Already scoped: the realm's injected-style observer must not scope it twice.
      style.dataset[SCOPED_STYLE_MARK] = scoped;
      style.textContent = scoped;
      holder.prepend(style);
    } catch {
      // Unscopeable inline CSS stays uninstalled — never injected raw.
    }
  }
  realmDocument.body.appendChild(holder);
  // An id the page itself supplies wins over the host's stand-ins for it.
  // Two stand-ins exist and both would shadow the real element in
  // `getElementById` order: a host-made stub (appended before the page was
  // staged) and the mount host itself, which carries `id="container"` for
  // games that expect to mount into one (`ingest-root-adapter.ts`). The
  // game's scripts have not run yet, so retiring them here loses nothing —
  // and keeping them measured as css3d_periodictable's renderer landing on
  // the HOST after the page's own menu, painting over its buttons.
  const surface = realmDocument.body;
  for (const staged of holder.querySelectorAll('[id]')) {
    if (surface.id === staged.id) surface.removeAttribute('id');
    for (const stub of surface.querySelectorAll(
      `[data-vgai-dom-stub][id="${CSS.escape(staged.id)}"]`,
    )) {
      if (stub !== staged) stub.remove();
    }
  }
}

export async function bootDeclaredDocument(
  boot: DeclaredBoot,
  entryUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  await stageDeclaredDom(boot);
  const sources: string[] = [];
  for (const script of boot.scripts) {
    // Module scripts belong to the module system, never to this classic
    // concatenation — the entry itself is imported by `servedEntryLoader`,
    // and evaluating module syntax as a classic script is a SyntaxError.
    if (script.module) continue;
    if (script.src === null) {
      sources.push(script.inline);
      continue;
    }
    let response: Response;
    try {
      response = await fetchImpl(script.src);
    } catch (error) {
      // A bare TypeError('Failed to fetch') names nothing; the script URL is
      // the whole diagnosis (a cross-origin CDN without CORS headers cannot
      // be fetch()ed at all — script TAGS don't need CORS, fetch does).
      throw new Error(
        `served bundle boot: could not fetch its own declared <script src="${script.src}"> — ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      throw new Error(
        `served bundle boot: its own index.html declares <script src="${script.src}">, and that ` +
          `URL answers ${response.status} ${response.statusText}.`,
      );
    }
    sources.push(await response.text());
  }
  // `.call(window)` is the whole point: `window` here is the prelude's
  // realm-shadowed binding, and a classic script's top-level `this` IS the
  // window. An ES-module evaluation makes it `undefined`, which is the exact
  // TypeError this path exists to stop.
  // CLASSIC-PAGE GLOBAL SCOPING, scoped to what games actually author. On a
  // real page, `window.THREE = ...` in one script and a bare `THREE` in the
  // next are one binding. Here the write lands on the prelude's shadowed
  // realm window, which a bare read never consults — measured twice
  // (phaser-catch-the-cat's inline `new CatchTheCatGame(...)`,
  // server-survival's vendor script reading `THREE`, 2026-08-27). A blanket
  // `with (window)` is NOT the answer: it re-binds every bare identifier in
  // minified code against ALL window properties and broke cuberun's webpack
  // chunks outright. The scope object below answers `has` ONLY for keys that
  // are not browser built-ins (pristine set, snapshotted before any script
  // runs) — i.e. the globals the game itself authors — so built-ins and
  // minified locals resolve exactly as before, while game-authored globals
  // become one binding across scripts, page-fashion. Lookups consult the
  // LIVE realm window each time, so script N sees what script N-1 wrote.
  // The proxy TARGET is a plain empty object, never the window itself: `has`
  // hiding a target's own non-configurable property is a proxy INVARIANT
  // violation ("trap returned falsish for property 'window'"), so the traps
  // delegate to the captured realm window instead of proxying it.
  const scope =
    'var __vgaiPristine = new Set(Object.getOwnPropertyNames(globalThis));\n' +
    '__vgaiPristine.add("__vgaiPristine"); __vgaiPristine.add("__vgaiRealmGlobals");\n' +
    'var __vgaiRealmGlobals = (function (w) {\n' +
    '  return new Proxy({}, {\n' +
    '    has: function (_, k) { return typeof k === "string" && !__vgaiPristine.has(k) && k in w; },\n' +
    '    get: function (_, k) { return typeof k === "string" ? w[k] : undefined; },\n' +
    '    set: function (_, k, v) { w[k] = v; return true; },\n' +
    '  });\n' +
    '})(window);\n';
  const body = `${GAME_GLOBALS_PRELUDE}\n${scope}\nreturn (function(){ with (__vgaiRealmGlobals) {\n${sources.join('\n;\n')}\n} }).call(window);`;
  gameRealmPage().withCurrentScript(entryUrl, () => new Function(body)());
}
