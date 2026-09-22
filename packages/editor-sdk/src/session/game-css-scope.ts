/**
 * The ONE spelling of the game-CSS scope marker, and the act of putting it on
 * an element.
 *
 * A game's page-level stylesheet is served rewritten into
 * `@scope ([data-vgai-game-styles]) { … }` (`server/scoped-game-css.ts`), so
 * the attribute below is the entire contract between the two halves: the
 * server emits the selector, and every host container that owns a game's DOM
 * wears the attribute. Both sides import it from here rather than spelling it,
 * because a drift between them is silent — the sheet loads, matches nothing,
 * and the HUD is unstyled exactly as it was before the feature existed.
 *
 * Deliberately dependency-free: the server imports this module, and a server
 * import must not drag the editor's browser modules into a Node process.
 */

/** Attribute a host container wears to become a game-CSS scope root. */
export const GAME_CSS_SCOPE_ATTRIBUTE = 'data-vgai-game-styles';

/** The `@scope (…)` selector the served stylesheet is rooted at. */
export const GAME_CSS_SCOPE_SELECTOR = `[${GAME_CSS_SCOPE_ATTRIBUTE}]`;

/**
 * Make `element` a game-CSS scope root. Idempotent, and deliberately the only
 * writer of the attribute — a container that stops being a scope root is torn
 * down with its mount, never un-marked.
 */
export function markGameCssScope(element: HTMLElement): void {
  element.setAttribute(GAME_CSS_SCOPE_ATTRIBUTE, '');
}
