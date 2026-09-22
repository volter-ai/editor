/**
 * The set of `WebGLRenderer`s the editor-side Three integration owns — its viewport, and every
 * offscreen renderer it spins up for thumbnails, asset previews and asset
 * compare.
 *
 * Why this exists: ingest's scene-capture trap
 * (`@volter/editor-threejs-runtime/adapter/ingest/scene-capture`) is installed on the SHARED
 * `three.WebGLRenderer.prototype` — that sharing is the whole mechanism, it is
 * how an unmodified game's renderer gets instrumented without touching the
 * game's source. But it means the editor's own renders arrive at the trap too,
 * and the trap captures the first scene it sees. Any host renderer constructed
 * after the trap installs (a thumbnail bake, an asset preview) could therefore
 * be captured AS THE INGESTED GAME.
 *
 * That is not hypothetical: it is what made the "a game bundling its own three
 * is DETECTED, never silently mistaken for a capture" spec pass or fail on
 * timing alone. When it failed, the editor
 * had adopted its own thumbnail scene as the game: a hierarchy of the editor's
 * own lights, presented as the game's content.
 *
 * Marking is explicit at each construction site rather than inferred, because
 * the honest question ("did the HOST make this renderer?") has no reliable
 * signal at the trap: a host renderer and a game renderer are the same class,
 * both constructed after install, and both render real scenes.
 */

const _hostRenderers = new WeakSet<object>();

/** Record `renderer` as the editor's own. Returns it, so it can wrap a `new`. */
/**
 * WebGL contexts are a HARD, SMALL browser budget (order of sixteen per page),
 * and this is the one chokepoint every editor-constructed renderer passes
 * through — so it is where an editor that is quietly accumulating them can be
 * caught naming its own culprit.
 *
 * A tester adding and deleting prefabs hit "too many active WebGL contexts"
 * after five rounds and the whole viewport turned white, because the browser
 * evicts the OLDEST context when the limit is reached and the oldest is the
 * main viewport (runhuman pass 104). Three's warning comes from inside
 * `three.module.js` and names nothing about who asked, which is what made it
 * undiagnosable from the report.
 *
 * The count is LIVE: `dispose()` is wrapped so a renderer that is properly
 * torn down stops counting. Past the budget the warning carries the creating
 * stack, so the next sighting names the leak instead of the victim.
 */
const LIVE_RENDERER_WARN_AT = 8;
let liveHostRenderers = 0;

export function markHostRenderer<T extends object>(renderer: T): T {
  _hostRenderers.add(renderer);
  liveHostRenderers += 1;
  const disposable = renderer as { dispose?: () => void };
  const dispose = disposable.dispose;
  if (typeof dispose === 'function') {
    let counted = true;
    disposable.dispose = function wrappedDispose(this: unknown, ...args: unknown[]) {
      if (counted) {
        counted = false;
        liveHostRenderers -= 1;
      }
      return (dispose as (...a: unknown[]) => unknown).apply(this, args);
    } as () => void;
  }
  if (liveHostRenderers >= LIVE_RENDERER_WARN_AT) {
    // biome-ignore lint/suspicious/noConsole: the standing warning channel for a budget the browser enforces by destroying the viewport
    console.warn(
      `[host-renderers] ${liveHostRenderers} editor WebGL renderers are live at once. The ` +
        'browser evicts the OLDEST context past its limit, which is the main viewport — a white ' +
        'viewport and "too many active WebGL contexts" is this. Creating stack:',
      new Error('renderer created here').stack,
    );
  }
  return renderer;
}

/** Live count of editor-constructed renderers — for diagnostics that want the
 *  number without waiting for the warning threshold. */
export function liveHostRendererCount(): number {
  return liveHostRenderers;
}

/** True when `renderer` is one the editor constructed for its own rendering. */
export function isHostRenderer(renderer: unknown): boolean {
  return typeof renderer === 'object' && renderer !== null && _hostRenderers.has(renderer);
}
