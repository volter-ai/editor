/** The `@scope` transform the session applies to a game's stylesheets, for a
 *  page that must scope CSS a game creates at runtime. Its own module so the
 *  transform's parser loads only where a game's page asks for it. */
export { scopeGameCss } from '@volter/editor-sdk/session/scoped-game-css';
