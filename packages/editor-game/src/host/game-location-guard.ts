/**
 * NAVIGATION, REFUSED OUT LOUD — the fourth thing a page-owning game does that
 * the editor cannot survive.
 *
 * A game that owns its tab is entitled to leave it: a main menu with a "quit"
 * entry assigns `window.location.href`.
 * Run in-realm, that assignment navigates the EDITOR away — the whole session,
 * every other root, and any unsaved authoring with it. It is one line of
 * ordinary game code and there is no cooperative way for a game to know better.
 *
 * So the game realm's `location` is a facade: reads of the game's own
 * query keep working, host control-plane keys (`play`, `project`, `vgai-*`,
 * …) are stripped from `search`/`href` (bubbo's `getUrlParam('play')` is a
 * debug skip-to-Game; the editor's `?play=1` autoplay is not that flag),
 * and every write that would NAVIGATE is refused with a `console.error`
 * naming the game, the exact assignment, and this mechanism. Refused, never
 * swallowed — a silent no-op would make "the quit button does nothing" an
 * unexplainable bug, and the console line is a real product door
 * (`vgai status` reports page console errors).
 *
 * `hash` is deliberately NOT refused: it changes the URL without leaving the
 * document, and games use it for their own state.
 */

/** The `Location` properties whose assignment leaves the current document. */
const NAVIGATING_PROPS = new Set<string>([
  'href',
  'protocol',
  'host',
  'hostname',
  'port',
  'pathname',
  'search',
]);

/** The `Location` methods that leave the current document. */
const NAVIGATING_METHODS = new Set<string>(['assign', 'replace', 'reload']);

/** Query keys the HOST owns. A game reading `location.search` must not see
 *  them: bubbo treats `play` as "skip the title and start the match." */
const HOST_SEARCH_KEYS = new Set([
  'play',
  'project',
  'hub',
  'scene',
  'ingest',
  'create-from',
  'checkout_id',
]);

function isHostSearchKey(key: string): boolean {
  return HOST_SEARCH_KEYS.has(key) || key.startsWith('vgai');
}

/** The search string a game is allowed to read — host keys removed. */
export function gameVisibleSearch(search: string): string {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (!raw) return '';
  const kept = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(raw)) {
    if (!isHostSearchKey(key)) kept.append(key, value);
  }
  const qs = kept.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

function gameVisibleHref(href: string): string {
  try {
    const url = new URL(href);
    url.search = gameVisibleSearch(url.search);
    return url.href;
  } catch {
    return href;
  }
}

/**
 * Wrap a real `Location` so game code can read its own query but never
 * navigate with it, and never see the host's control-plane keys.
 * `refuse` receives a human description of exactly what was attempted.
 */
export function guardedGameLocation(
  real: Location,
  refuse: (attempt: string) => void,
  options?: {
    /**
     * `location.reload()` translated to what it MEANS on this surface. A
     * page-owning game reloading its window is restarting ITSELF (cuberun's
     * death-screen RESTART is literally `window.location.reload()`), and the
     * realm's window IS the pane — so when the host can restart the game, the
     * idiom is honored rather than refused. Returns true when handled; false
     * falls back to the loud refusal. Measured: a human tester played cuberun
     * and reported RESTART 'does nothing' (runhuman, 2026-08-28).
     */
    readonly reloadGame?: () => boolean;
  },
): Location {
  // The proxy TARGET is a plain object, NEVER the real Location. `assign`,
  // `replace` and `reload` are unforgeable own data properties (non-writable,
  // non-configurable) on a real Location, and the proxy invariant for such
  // properties requires the get trap to return the REAL value — so a proxy
  // over the real object THROWS TypeError on every `location.reload` access
  // instead of running the trap. Measured on cuberun's death-screen RESTART
  // (`window.location.reload()`): the click dispatched, the handler died on
  // its first property read, and nothing on screen said why — meaning the
  // guard's refusal path for these three methods had NEVER fired on any
  // tier. An empty target has no own properties, so every trap is free.
  const dummy = Object.create(null) as Location;
  return new Proxy(dummy, {
    get(_target, prop) {
      if (typeof prop === 'string' && NAVIGATING_METHODS.has(prop)) {
        return (...args: unknown[]): void => {
          if (prop === 'reload' && options?.reloadGame?.()) return;
          refuse(`location.${prop}(${args.map((a) => String(a)).join(', ')})`);
        };
      }
      if (prop === 'search') return gameVisibleSearch(String(Reflect.get(real, 'search') ?? ''));
      if (prop === 'href') return gameVisibleHref(String(Reflect.get(real, 'href') ?? ''));
      const value = Reflect.get(real, prop);
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(real)
        : value;
    },
    set(_target, prop, value) {
      if (typeof prop === 'string' && NAVIGATING_PROPS.has(prop)) {
        refuse(`location.${prop} = ${String(value)}`);
        // Report success to the game: an assignment that THROWS would abort
        // whatever routine tried it (the game's own menu handler), which is a
        // second failure on top of the one we just prevented. The console line
        // above is what makes this non-silent.
        return true;
      }
      return Reflect.set(real, prop, value);
    },
    has(_target, prop) {
      return Reflect.has(real, prop);
    },
  });
}

/** The one message shape for a refused navigation, so every surface that
 *  reports one reads the same. */
export function refusedNavigationMessage(attempt: string): string {
  return (
    `Ingested game attempted to navigate the editor away (${attempt}) — refused. ` +
    "A game running in-realm shares the editor's document, so leaving it would take the " +
    'whole session with it; game code sees a scoped `location` facade whose reads pass ' +
    'through and whose navigating writes do not (packages/editor/src/game-location-guard.ts).'
  );
}
