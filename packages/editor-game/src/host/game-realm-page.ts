/**
 * THE GAME'S PAGE, IN A BOX — the host-side half of "an ingested game runs
 * in-realm, but it does not own the tab".
 *
 * `gated-globals.ts` already pipes a SCOPED `window`/`document` into game
 * modules so their input listeners can be gated. This module is the same idea
 * carried to everything else a page-owning game reaches for, because a game
 * written to own the whole browser window says so in four ways that all break
 * the editor when it runs inside a pane:
 *
 *  1. `document.body.appendChild(canvas)` — the game's canvas, title screen,
 *     pause overlay and game-over screen all land at PAGE level, painting over
 *     editor chrome (such a title wrapper is typically `position:fixed` with a
 *     z-index in the hundreds). Substituting the mount's adopted
 *     surface for `document.body` puts every one of them inside the pane
 *     instead — including the ones the host never sees, because it is the
 *     game's OWN append that is redirected, not a post-hoc reparent of the
 *     things we thought to look for. It is also what makes teardown total:
 *     removing the surface removes the game's whole DOM, overlays included.
 *  2. `position:fixed` inside that surface would STILL escape to the viewport,
 *     so the surface declares {@link GAME_SURFACE_CONTAINMENT_CSS} — `contain:
 *     layout` makes it the containing block for fixed and absolute
 *     descendants, so a game's full-screen overlay is full-PANE instead. This
 *     is a host policy, not per-game CSS: every ingested game with page-level
 *     overlays gets it.
 *  3. `window.innerWidth`/`innerHeight` + a `resize` listener is how a game
 *     computes its own letterbox, in its `onResize` handler and again at
 *     init. Reporting the real window to
 *     a game living in a pane is a lie that shows up as a stretched or
 *     cropped picture, so the realm reports the SURFACE's size and the host
 *     dispatches `resize` to the realm's own listeners when the pane changes.
 *     A game that letterboxes itself then letterboxes to the pane, with no
 *     host aspect policy to get wrong.
 *  4. `window.location.href = …` navigates the EDITOR away (a game menu with a
 *     "quit" link does exactly this). See
 *     `game-location-guard.ts`.
 *
 * ONE page per game realm, registered by the mount that owns the surface and
 * dropped when it disposes. Nothing here is per-game: the mount registers a
 * surface, the realm reports it, and a game that never touches `document.body`
 * or `window.innerWidth` cannot tell the difference.
 */

/**
 * What the host stamps on an adopted surface so a game's `position:fixed`
 * overlay is contained to the pane.
 *
 * `contain: layout` makes the element a containing block for absolutely AND
 * fixed positioned descendants — the one CSS primitive that does this without
 * the side effects of the alternatives (`transform`/`filter` also create the
 * containing block but force a compositing layer and, on the ADOPTED element
 * itself, are exactly the stamp {@link claimHostSurfaceBox} exists to clear).
 */
export const GAME_SURFACE_CONTAINMENT_CSS = 'contain: layout;';

/** `EventTarget`'s own listener identity is (type, callback, capture) — read
 *  the capture flag out of either options form so the page's registration
 *  bookkeeping dedupes exactly the way the bus does. */
function captureOf(options?: boolean | AddEventListenerOptions | EventListenerOptions): boolean {
  return typeof options === 'boolean' ? options : (options?.capture ?? false);
}

/** Mark carrying the text this observer last wrote, so its own write is not
 *  re-scoped and a game's next rewrite is. */
export const SCOPED_STYLE_MARK = 'vgaiScopedCss';

/**
 * The `@scope` rewriter, loaded on FIRST USE — the one page-side door to the
 * CSS transform. The transform itself is a pure postcss function that happens
 * to live under `server/` because the dev server's `/__editor/scoped-game-css`
 * route is its other caller; the lazy import (and the reason it is lazy) is
 * {@link observeInjectedStyles}'s note below, and every page-side caller shares
 * this one memo so a realm that scopes both boot-time inline CSS and runtime
 * injected `<style>`s parses the loader once.
 *
 * Named here rather than re-derived per caller because the `@editor/` alias is
 * the only door a PACKAGE has into the host: the ingest lane's
 * `served-html-boot.ts` scopes a served document's inline CSS through exactly
 * this function, and a package reaching `packages/editor/server/` directly is
 * not a seam that exists.
 */
let gameCssScoper: Promise<(css: string) => string> | null = null;
export function loadGameCssScoper(): Promise<(css: string) => string> {
  gameCssScoper ??= Promise.all([
    import('@volter/editor-core/game-css-scope-transform'),
    import('@volter/editor-sdk/session/game-css-scope'),
  ]).then(
    ([{ scopeGameCss }, { GAME_CSS_SCOPE_SELECTOR }]) =>
      (css: string) =>
        scopeGameCss({ css, scopeSelector: GAME_CSS_SCOPE_SELECTOR, styleSheetPath: '/' }),
  );
  return gameCssScoper;
}

/**
 * CSS applies document-wide wherever its `<style>` sits, so a style element a
 * game creates at RUNTIME — a CDN utility framework's live sheet, a game's own
 * theme injection — would restyle the editor chrome from inside the realm's
 * head div. This observer runs every added or rewritten `<style>` under the
 * surface through the SAME `@scope` transform declared sheets and boot-time
 * inline CSS get. The heavy transform (postcss) loads on first use; until it
 * does, the raw text is cleared rather than left leaking — a game's sheet
 * arriving a beat late is honest, the editor repainted by it is not.
 *
 * ## "First use" means the first STYLE, not the first surface
 *
 * The import below is deliberately started by {@link scopeStyle}, not by this
 * function. Attaching a surface is not evidence that anything will ever inject
 * a `<style>`, and the overwhelming majority of games never do — a first-party
 * R3F/Pixi world paints into a canvas and touches no page CSS at all.
 *
 * Loading it on ATTACH made every Play in every project pay for a CSS parser
 * it would not use, and the cost was not just bytes: `postcss` destructures
 * `fs`/`path`/`url`/`source-map-js` at module scope, and Vite honours postcss's
 * own `browser` field by substituting a proxy that console.warns per property
 * read. So a bare scaffolded project pressing Play emitted THIRTEEN
 * "Module … has been externalized for browser compatibility" warnings —
 * `fs.existsSync/readFileSync/realpathSync`,
 * `path.isAbsolute/resolve/dirname/join/relative/sep`,
 * `url.fileURLToPath/pathToFileURL`,
 * `source-map-js.SourceMapConsumer/SourceMapGenerator` — straight into the
 * game realm's console, which made the console-silence contract unreachable in
 * a fresh scaffold and every `vgai` verb exit non-zero (measured three times:
 * the donut, cold-barrel and lit-lanes probes). The chain was
 * `play-mode.enterPlayModeInner` -> `gated-globals.setGameSurface` ->
 * `GameRealmPage.surface` -> `observeInjectedStyles` -> `import('../server/
 * scoped-game-css')` -> `postcss`. A game that genuinely injects a runtime
 * `<style>` still loads it, because there the parser is the feature working.
 */
function observeInjectedStyles(surface: HTMLElement): MutationObserver {
  let scoper: ((css: string) => string) | null = null;
  const loadScoper = (): Promise<void> =>
    loadGameCssScoper().then((loaded) => {
      scoper = loaded;
    });
  const scopeStyle = (style: HTMLStyleElement): void => {
    const text = style.textContent ?? '';
    if (text.length === 0 || style.dataset[SCOPED_STYLE_MARK] === text) return;
    if (!scoper) {
      const raw = text;
      style.textContent = '';
      void loadScoper().then(() => {
        if (style.isConnected && (style.textContent ?? '') === '') {
          style.textContent = raw;
          scopeStyle(style);
        }
      });
      return;
    }
    let scoped: string;
    try {
      scoped = scoper(text);
    } catch {
      style.textContent = ''; // unscopeable CSS stays uninstalled — never raw
      return;
    }
    style.dataset[SCOPED_STYLE_MARK] = scoped;
    style.textContent = scoped;
  };
  const styleOf = (node: Node): HTMLStyleElement | null => {
    if (node instanceof HTMLStyleElement) return node;
    const parent = node.parentElement;
    return parent instanceof HTMLStyleElement ? parent : null;
  };
  const observer = new MutationObserver((records) => {
    const seen = new Set<HTMLStyleElement>();
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of record.addedNodes) {
          const direct = styleOf(node);
          if (direct) seen.add(direct);
          else if (node instanceof Element) {
            for (const style of node.querySelectorAll('style')) seen.add(style);
          }
        }
      } else if (record.type === 'characterData') {
        const style = styleOf(record.target);
        if (style) seen.add(style);
      }
    }
    for (const style of seen) if (style.isConnected) scopeStyle(style);
  });
  observer.observe(surface, { childList: true, subtree: true, characterData: true });
  for (const style of surface.querySelectorAll('style')) scopeStyle(style);
  return observer;
}

/**
 * The page one game realm sees. Holds the surface element, the realm-scoped
 * `resize` bus, and a live count of the game's own resize listeners — that
 * count is the predicate the mount reads to decide whether the GAME resizes
 * itself or the HOST resizes it (see `ingest-root-adapter.ts`'s `resize`).
 */
export class GameRealmPage {
  /** The element this realm sees as `document.body`. */
  private surfaceElement: HTMLElement | null = null;
  /** Scopes every `<style>` the game injects at runtime — see {@link attachSurface}. */
  private injectedStyles: MutationObserver | null = null;

  get surface(): HTMLElement | null {
    return this.surfaceElement;
  }

  set surface(el: HTMLElement | null) {
    this.injectedStyles?.disconnect();
    this.injectedStyles = null;
    this.surfaceElement = el;
    if (el) this.injectedStyles = observeInjectedStyles(el);
  }

  /** Page metadata is realm state, not permission to rename the editor tab. */
  private pageTitle = '';

  /**
   * The classic script the host is evaluating for this page.
   *
   * A served bundle still runs through the realm-shadowing prelude rather than
   * directly in the editor tab. That means the browser cannot populate
   * `document.currentScript` for it, even though webpack's automatic public
   * path runtime requires that ordinary classic-script signal. The served
   * document loader carries the declared entry here for exactly the duration
   * of evaluation, and the document proxy reports it below.
   */
  private executingClassicScript: HTMLScriptElement | null = null;

  /** A connected, surface-owned destination for page-level style/script/link
   * inserts. It intentionally is not the editor's real `document.head`. */
  private headElement: HTMLElement | null = null;

  /** Where the realm's own `window.addEventListener('resize', …)` lands.
   *  Replaced wholesale by {@link reset} — `EventTarget` has no "remove them
   *  all", and a dead game's handlers must not survive into the next mount. */
  private resizeBus = new EventTarget();

  /**
   * The game's live `resize` registrations, keyed exactly the way `EventTarget`
   * itself keys them: (listener, capture). A plain counter was WRONG in both
   * directions — a duplicate `addEventListener` with the same pair bumped it
   * while the bus deduped, and a `removeEventListener` that matched nothing
   * decremented it anyway — and the count is not bookkeeping: it IS the
   * predicate {@link gameResizesItself} the mount reads to decide whether the
   * host may size the game.
   */
  private readonly resizeListeners = new Map<EventListenerOrEventListenerObject, Set<boolean>>();

  addResizeListener(
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    let captures = this.resizeListeners.get(listener);
    if (!captures) {
      captures = new Set();
      this.resizeListeners.set(listener, captures);
    }
    captures.add(captureOf(options));
    this.resizeBus.addEventListener('resize', listener, options);
  }

  removeResizeListener(
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    const captures = this.resizeListeners.get(listener);
    if (captures) {
      captures.delete(captureOf(options));
      if (captures.size === 0) this.resizeListeners.delete(listener);
    }
    this.resizeBus.removeEventListener('resize', listener, options);
  }

  /**
   * True when the game registered at least one `resize` listener of its own —
   * i.e. it has a size policy and the host must not overwrite it.
   */
  get gameResizesItself(): boolean {
    return this.resizeListeners.size > 0;
  }

  /**
   * Return the page to "no game is running".
   *
   * A page OUTLIVES the mount that registered its surface — it is keyed by
   * realm id in `gated-globals.ts`'s `pages` map, and the realm's proxies close
   * over the object, so it cannot be dropped and replaced. Clearing only the
   * surface therefore leaked a dead game's size POLICY into the next mount in
   * the same tab: the second ingest inherited `gameResizesItself === true` from
   * a game that no longer exists, and the host stopped sizing it. The listeners
   * on the bus leaked with it.
   */
  reset(): void {
    this.headElement?.remove();
    this.headElement = null;
    this.pageTitle = '';
    this.executingClassicScript = null;
    this.surface = null;
    this.resizeListeners.clear();
    this.resizeBus = new EventTarget();
  }

  /** Tell the game its window changed size. Called by the mount's pane
   *  ResizeObserver; a no-op for a game that registered nothing. */
  dispatchResize(): void {
    this.resizeBus.dispatchEvent(new Event('resize'));
  }

  /** The realm's `window.innerWidth`/`innerHeight`, or `null` before a surface
   *  is registered (then the real window's values stand). */
  viewport(): { width: number; height: number } | null {
    const el = this.surface;
    if (!el) return null;
    return { width: el.clientWidth, height: el.clientHeight };
  }

  get title(): string {
    return this.pageTitle;
  }

  set title(value: string) {
    this.pageTitle = String(value);
  }

  /** What this realm sees as `document.currentScript`. */
  get currentScript(): HTMLScriptElement | null {
    return this.executingClassicScript;
  }

  /**
   * Evaluate one host-loaded classic entry with the same `currentScript.src`
   * its real `<script src>` would have supplied. Restoration is stack-safe so
   * a nested loader cannot leak its carrier into its caller.
   */
  withCurrentScript<T>(src: string, run: () => T): T {
    const previous = this.executingClassicScript;
    const script = document.createElement('script');
    script.src = src;
    this.executingClassicScript = script;
    try {
      return run();
    } finally {
      this.executingClassicScript = previous;
    }
  }

  /** The game's page head, contained by its mount. Created lazily so a game
   * that never uses page-level inserts adds no DOM of its own. */
  head(): HTMLElement | null {
    const surface = this.surface;
    if (!surface) return null;
    if (!this.headElement || this.headElement.parentElement !== surface) {
      const head = document.createElement('div');
      head.dataset['vgaiGameHead'] = '';
      head.hidden = true;
      surface.prepend(head);
      this.headElement = head;
    }
    return this.headElement;
  }
}
