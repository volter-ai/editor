/**
 * THE TRANSLATION, AS OUR BLENDER'S RELEASE SHIPS IT (WS-AC, cut 4).
 *
 * "Our Blender renders with three.js" is one implementation, built once at
 * release time out of this package's source into ONE self-contained ES module
 * (`blender-three.mjs`, three inlined, the display tables beside it) and
 * delivered wherever the wasm is delivered. A host fetches it from the
 * artifact base next to `blender.wasm`, imports it, and attaches ONE presenter
 * to the Blender it started:
 *
 *     const { createPresenter, attachPresenter } = await import(url);
 *     const detach = attachPresenter(filesystem, "/tmp/vgai-presenter", createPresenter());
 *
 * NO HOST BUNDLES THIS. The module is GPL because it is part of the Blender
 * release; a host loads it the way it loads the wasm -- by URL, under a pinned
 * hash -- and its own build graph never touches this package. The editor is
 * the one consumer that does NOT load this file: it imports the same source
 * with its own three and wraps its own document around it, because two copies
 * of three on one page is the thing this arrangement exists to prevent.
 *
 * `vite.release.config.ts` beside this package's manifest is the build;
 * `npm run build:blender-three -w @volter/blender-engine` runs it.
 */
export { attachPresenter } from './attach-presenter';
export type { AttachablePresenter, PresenterFileSystem } from './attach-presenter';
export { createPresenter } from './presenter';
export type { Presenter, PresenterOptions } from './presenter';
