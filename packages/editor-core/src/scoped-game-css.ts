/**
 * The client half of SCOPED GAME CSS — fetch the open project's page-level
 * stylesheet (already rewritten into `@scope ([data-vgai-game-styles])` by
 * `server/scoped-game-css.ts`), install it ONCE, and report honestly when
 * there is nothing to install.
 *
 * ONE `<style>` element per project, never one per surface. Every container
 * that owns game DOM — each UI-board story card's content, each story
 * document's preview, the ingest surface the game mounts into — becomes a
 * scope root by wearing the attribute (`markGameCssScope`, `game-css-scope.ts`),
 * and the single scoped sheet paints all of them. Duplicating the sheet per
 * card would multiply a foreign game's whole stylesheet by the size of the
 * board for no behavioural difference at all.
 *
 * ## The refusal path is the point
 *
 * A surface that shows a game's DOM with no page CSS looks BROKEN, not empty —
 * the owner hit exactly that three times before this existed and read it as
 * wreckage, because nothing on screen said what was missing. So this module's
 * state is a value the surfaces read (`note`), not a silent side effect: a
 * board card whose project declares no stylesheet, or whose stylesheet could
 * not be read, or a browser with no `@scope`, says so on the card.
 *
 * `@scope` is the feature detection and it is deliberately a REFUSAL, not a
 * fallback: without it the served sheet's `:scope` rules would not be
 * contained, and installing it anyway would restyle the editor — the precise
 * failure the whole feature exists to prevent.
 */

import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { editorServerJson } from '@volter/editor-sdk/kit/editor-server-response';

/** What the open project's game CSS turned out to be. */
export interface ScopedGameStylesState {
  /** True once the project's scoped stylesheet is attached to the document. */
  readonly installed: boolean;
  /** The declared stylesheet paths that were served, in emission order. */
  readonly sources: readonly string[];
  /**
   * Surface-facing sentence naming what is missing, or `null` when the host
   * has no evidence of a gap. Rendered ON a story card rather than logged,
   * because the card is where the missing styling is SEEN.
   */
  readonly note: string | null;
}

const NOTHING_DECLARED: ScopedGameStylesState = { installed: false, sources: [], note: null };

/** `data-*` marker on the one installed element, so a re-install can find it. */
const STYLE_ELEMENT_MARKER = 'data-vgai-scoped-game-css';

/** Per-project memo: the fetch+install runs once per open project, not per card. */
let pending: { projectRoot: string; state: Promise<ScopedGameStylesState> } | null = null;

/** Latest resolved state, for the synchronous readers (a board painting notes). */
let resolved: ScopedGameStylesState = NOTHING_DECLARED;

/** The installed sheet's own text — see {@link scopedGameStylesCssText}. */
let installedCss: string | null = null;

/**
 * The installed stylesheet's text, or null when none is installed.
 *
 * Exists for ONE reader: the DOM capture leg (`composite-screenshot.ts`),
 * which rasterizes a DETACHED clone of the surface through an SVG
 * `foreignObject`. A detached fragment carries no document stylesheet, so
 * without re-inlining this the look verb would photograph a correctly styled
 * screen as unstyled — an instrument disagreeing with the product it is
 * pointed at, which is worse than no instrument. (The same leg already
 * re-inlines its motion freeze for the same structural reason.)
 */
export function scopedGameStylesCssText(): string | null {
  return installedCss;
}

/**
 * True when this browser implements CSS `@scope`. Without it the served sheet
 * cannot be contained, so nothing is installed at all.
 */
function supportsCssScope(): boolean {
  return typeof (globalThis as { CSSScopeRule?: unknown }).CSSScopeRule === 'function';
}

/**
 * Fetch and install the open project's scoped game stylesheet, at most once per
 * project. Safe to call from every surface that mounts game DOM — later calls
 * await the same promise.
 */
export async function ensureScopedGameStyles(projectRoot: string): Promise<ScopedGameStylesState> {
  if (pending?.projectRoot === projectRoot) return pending.state;
  const state = loadScopedGameStyles(projectRoot);
  pending = { projectRoot, state };
  return state;
}

/**
 * The most recent resolved state. Surfaces that paint a note read this
 * synchronously AFTER awaiting {@link ensureScopedGameStyles} — it exists so a
 * board does not have to thread the promise through its own layout pass.
 */
export function scopedGameStylesState(): ScopedGameStylesState {
  return resolved;
}

async function loadScopedGameStyles(projectRoot: string): Promise<ScopedGameStylesState> {
  const next = await fetchScopedGameStyles(projectRoot);
  resolved = next;
  return next;
}

async function fetchScopedGameStyles(projectRoot: string): Promise<ScopedGameStylesState> {
  let payload: { css?: unknown; sources?: unknown; note?: unknown };
  try {
    const response = await fetch('/__editor/scoped-game-css');
    // A page fallback in front of the route fails the reader below and lands
    // in the same graceful no-op story discovery takes. Nothing is claimed
    // about the project's styling.
    payload = await editorServerJson<typeof payload>(
      response,
      'Could not read the project scoped game CSS',
    );
  } catch {
    return NOTHING_DECLARED;
  }

  const css = typeof payload.css === 'string' ? payload.css : '';
  const sources = Array.isArray(payload.sources) ? (payload.sources as string[]) : [];
  const note = typeof payload.note === 'string' ? payload.note : null;

  if (css.length === 0) return { installed: false, sources, note };

  if (!supportsCssScope()) {
    const refusal =
      'unstyled — this browser has no CSS `@scope`, so the game stylesheet cannot be contained ' +
      'to the game. Loading it anyway would restyle the editor.';
    editorConsole.warn(`[scoped-game-css] ${refusal}`, 'authoring');
    return { installed: false, sources, note: refusal };
  }

  installStyleElement(projectRoot, css);
  return { installed: true, sources, note };
}

/** Attach (or replace) the ONE style element carrying the project's game CSS. */
function installStyleElement(projectRoot: string, css: string): void {
  const existing = document.head.querySelector(`style[${STYLE_ELEMENT_MARKER}]`);
  const element = existing instanceof HTMLStyleElement ? existing : document.createElement('style');
  element.setAttribute(STYLE_ELEMENT_MARKER, projectRoot);
  element.textContent = css;
  if (!element.isConnected) document.head.appendChild(element);
  installedCss = css;
}
