/**
 * canvas-react — the `@pixi/react` lane for vgai's canvas surface
 * (`@volter/game-runtime/canvas-react`).
 *
 * The canvas surface is source-as-truth: a canvas root's document IS its
 * TSX world file, exactly as a three root's document is its R3F source. This
 * module is the peer of `pixi/`, which holds what the host needs to mount
 * and inspect a PixiJS game it did NOT write.
 *
 * The engine CORE never imports this (enforced by
 * `packages/engine/test/react-core-import-ban.test.ts` — this directory is an
 * allowed react-importing entry, and core files may not import it), so a
 * three-only bundle never pays for react or the Pixi reconciler.
 *
 * Surface:
 *  - `PixiPrimitive` / `adoptNow` — the canvas surface's `<primitive object={…}>`:
 *    render a container the game already owns, and place a spawn in the
 *    display tree ahead of the commit that renders it.
 *
 * The Pixi runtime itself is NOT re-exported here. A component reaches the live
 * `Application` (and therefore `stage`, `renderer`, `ticker`) with
 * `@pixi/react`'s own `useApplication()`, ticks with its `useTick()`, and loads
 * assets with Pixi's own `Assets` — the library's API, not a second one.
 */

export { adoptNow, PixiPrimitive, type PixiPrimitiveProps } from './pixi-primitive';
