/**
 * THE GAME EDITOR, COMPOSED — this file is the whole product.
 *
 * Thin code that stitches packages onto the editor kit and holds only what
 * building a game needs. Three decisions, each a product's to make and nobody
 * else's:
 *
 *  - WHICH PACKAGES, in mount order. `vgai:contributions/<package>` is that
 *    package's own `package.json#vgai.contributions`, read at build time
 *    (`@volter/editor-core/build/product-contributions`) — the product names
 *    the package, never its modules, so a package that grows a contribution
 *    grows this product with no edit here.
 *  - THE LOOK. `classic` — the editor's own Graphite, which is the reference
 *    frame every host-default shape was measured against. A DEFAULT:
 *    `~/.vgai/settings.json`, the project's own, and its adapter's declaration
 *    each outrank it.
 *  - THE WORKSPACE. `game` — `@volter/editor-game`'s own workspace
 *    contribution, which applies to a project with at least one root that
 *    plays.
 *
 * `mountVgai` is what the workbench contribution reads off this module once
 * `/__editor/served-modules` hands it this file's URL.
 */

import blender from 'vgai:contributions/@volter/editor-blender';
import game from 'vgai:contributions/@volter/editor-game';
import { product } from '@volter/editor-core/frame/product';

export const { mountVgai } = product({
  id: 'game-editor',
  packages: {
    '@volter/editor-game': game,
    '@volter/editor-blender': blender,
  },
  look: 'classic',
  workspace: 'game',
  nativeMenus: true,
});
