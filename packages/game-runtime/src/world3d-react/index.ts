/**
 * world3d-react — the react-three-fiber bridge for vgai's three surface
 * (`@volter/game-runtime/world3d-react`).
 *
 * An OPT-IN module, mirroring how `pixi/` is the PixiJS surface's opt-in home:
 * a peer surface module the engine CORE never imports (enforced by
 * `packages/engine/test/react-core-import-ban.test.ts` — this directory is an
 * allowed react-importing entry alongside `react/`, and core files may not
 * import it).
 *
 * Peer contract: an importing PROJECT already depends on `react`,
 * `@react-three/fiber`, and `three` (fiber's three must be deduped to the
 * host's single instance — `resolve.dedupe: ['three', 'react', 'react-dom']`
 * in the project's Vite config). The engine package deliberately declares no
 * hard dependency on fiber: only projects that already mount through fiber
 * ever import this module.
 *
 * Surface:
 *  - `r3fRootFactory` / `resolveR3FEntryAdapter` — what a three entry module
 *    MEANS: a default-exported component (`export default function World()`),
 *    mounted as a first-party `kind: "three"` world under the host's gated
 *    loop. The world's vgai surface is its entry module's static exports
 *    (`export { debug, systems } from './commands'`), connected by the host
 *    at mount.
 *
 * Deliberately NOT re-exported here: `<RapierPhysicsBridge>`
 * (`@volter/game-runtime/world3d-react/rapier-physics-bridge`), which publishes an R3F
 * world's `@react-three/rapier` physics to the module slot the entry's
 * `systems.physics` declaration forwards — so the colliders instrument and
 * the editor's transform coordination can see it. It imports
 * `@react-three/rapier`, and only a world that already depends on that library
 * should pull it into its graph; a deep import keeps this barrel's peer
 * contract to `react`/`@react-three/fiber`/`three` alone.
 */

export {
  applyWorldRendererConfig,
  type WorldOutputColorSpace,
  type WorldRendererConfig,
  type WorldToneMapping,
} from '@volter/threejs-runtime/adapter/renderer-config';
export { r3fRootFactory, resolveR3FEntryAdapter } from './r3f-root-factory';
