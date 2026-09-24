/**
 * `@volter/game-runtime/world3d-react/renderer-config` — a published entry point.
 *
 * The engine package's export map is the wildcard `"./*"`, so every file under
 * `packages/project/src/` is an entry point a game outside this repo can import by path. The module
 * itself now lives in the adapter seam (`@volter/threejs-runtime/adapter/renderer-config`, which its header
 * explains), and this file keeps the path that shipped resolving to it. Import the seam path in
 * new code.
 */

export * from '@volter/threejs-runtime/adapter/renderer-config';
