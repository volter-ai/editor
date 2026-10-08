/**
 * A game's DOM surface starts from a page's text defaults, as the game's
 * `<body>` does when it ships: otherwise the editor's own typography (11px, its
 * line height and colour) inherits into the game's DOM.
 *
 * The defaults are a ZERO-specificity rule (`:where(...)`), not inline style, so
 * the game's own page rules win over them as they do in its build: a game's
 * `html`/`body` rules arrive scoped as `:scope` (`scoped-game-css.ts`), on this
 * same element, and an inline `font: initial` beat them — a game that sets its
 * font on `body` rendered in the browser's default serif in the editor.
 */

/** The attribute that marks an element as a game's page surface. */
export const GAME_SURFACE_ATTRIBUTE = 'data-volter-game-surface';

const DEFAULTS_STYLE_MARK = 'data-volter-game-surface-defaults';

const DEFAULTS_CSS =
  `:where([${GAME_SURFACE_ATTRIBUTE}]){font:initial;color:initial;letter-spacing:normal;` +
  'word-spacing:normal;text-align:start;text-indent:0;text-transform:none;' +
  'white-space:normal;direction:ltr;cursor:auto}';

/** Mark `element` as a game surface, installing the defaults rule once per document. */
export function markGameSurface(element: HTMLElement): void {
  const document = element.ownerDocument;
  if (!document.querySelector(`style[${DEFAULTS_STYLE_MARK}]`)) {
    const style = document.createElement('style');
    style.setAttribute(DEFAULTS_STYLE_MARK, '');
    style.textContent = DEFAULTS_CSS;
    (document.head ?? document.documentElement).prepend(style);
  }
  element.setAttribute(GAME_SURFACE_ATTRIBUTE, '');
}
