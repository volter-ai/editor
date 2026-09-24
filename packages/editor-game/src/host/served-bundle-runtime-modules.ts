/**
 * THE SERVED BUNDLE'S DEPENDENCY LIST — what a vendored game's bare imports
 * resolve to when its bytes are served as a static bundle rather than being
 * part of the editor's own Vite graph.
 *
 * A game vendored as a SERVABLE BUNDLE (`public/ingest/<id>/`,
 * `ingest/served-bundle.ts`) is fetched and bundled in the page
 * (`browser-transpile.ts`, esbuild-wasm), with every bare import marked
 * external. This module answers those externals: each one maps to a LAZY
 * import of the editor's own live copy — `three`, `react`, fiber, Pixi, the
 * engine — so the game shares the singletons the editor already runs (two
 * copies of three break `instanceof`; two reconcilers cannot own one canvas).
 *
 * THE LIST IS DERIVED, NOT CURATED (owner decision, 2026-08-27). Capabilities
 * are the sanctioned way a game gains functionality, so the union of what the
 * template, every example and every catalog capability imports IS the
 * definition of the dependencies this resolver may have to answer — and it is
 * computable. `scripts/validate-browser-runtime-modules.mjs` (pre-commit)
 * holds this table to that union: a capability that starts importing a
 * package this list does not ship fails the commit naming the package, and
 * the fix is one loader below. An import outside the list is a wall
 * `browser-transpile.ts` states in product words; nothing degrades silently.
 *
 * THREE FAMILIES, one resolver ({@link servedBundleRuntimeModuleLoader}):
 *   - the explicit table below (packages and package subpaths);
 *   - every RUNTIME-PACKAGE module, by glob — `@vgai/project/<path>`,
 *     `@vgai/threejs-runtime/<path>` and `@vgai/game-runtime/<path>` resolve
 *     to the editor's own source, minus each package's Node-only modules;
 *   - three's two spellings of one file (`three/addons/*` ≡
 *     `three/examples/jsm/*`), so either registers both.
 *
 * Resolution is LAZY per specifier a game actually imports: a table this wide
 * must never be awaited whole on first Play.
 */

import { registerRuntimeModuleResolver } from './browser-transpile';

let _resolverRegistered = false;

export const BUNDLE_RUNTIME_MODULE_LOADERS: Record<string, () => Promise<unknown>> = {
  three: () => import('three'),
  'three/addons/controls/OrbitControls.js': () => import('three/addons/controls/OrbitControls.js'),
  'three/addons/controls/TrackballControls.js': () =>
    import('three/addons/controls/TrackballControls.js'),
  'three/addons/environments/RoomEnvironment.js': () =>
    import('three/addons/environments/RoomEnvironment.js'),
  'three/addons/math/ConvexHull.js': () => import('three/addons/math/ConvexHull.js'),
  'three/addons/objects/MarchingCubes.js': () => import('three/addons/objects/MarchingCubes.js'),
  'three/addons/interactive/SelectionBox.js': () =>
    import('three/addons/interactive/SelectionBox.js'),
  'three/addons/geometries/ConvexGeometry.js': () =>
    import('three/addons/geometries/ConvexGeometry.js'),
  'three/addons/geometries/TextGeometry.js': () =>
    import('three/addons/geometries/TextGeometry.js'),
  'three/addons/geometries/DecalGeometry.js': () =>
    import('three/addons/geometries/DecalGeometry.js'),
  'three/addons/geometries/RoundedBoxGeometry.js': () =>
    import('three/addons/geometries/RoundedBoxGeometry.js'),
  'three/addons/loaders/FontLoader.js': () => import('three/addons/loaders/FontLoader.js'),
  'three/addons/loaders/HDRLoader.js': () => import('three/addons/loaders/HDRLoader.js'),
  'three/addons/loaders/EXRLoader.js': () => import('three/addons/loaders/EXRLoader.js'),
  'three/addons/loaders/GLTFLoader.js': () => import('three/addons/loaders/GLTFLoader.js'),
  'three/addons/loaders/RGBELoader.js': () => import('three/addons/loaders/RGBELoader.js'),
  'three/addons/objects/Sky.js': () => import('three/addons/objects/Sky.js'),
  'three/addons/libs/lil-gui.module.min.js': () =>
    import('three/addons/libs/lil-gui.module.min.js'),
  'three/addons/libs/mikktspace.module.js': () => import('three/addons/libs/mikktspace.module.js'),
  'three/addons/libs/stats.module.js': () => import('three/addons/libs/stats.module.js'),
  'three/addons/libs/tween.module.js': () => import('three/addons/libs/tween.module.js'),
  'three/addons/modifiers/SimplifyModifier.js': () =>
    import('three/addons/modifiers/SimplifyModifier.js'),
  'three/addons/postprocessing/EffectComposer.js': () =>
    import('three/addons/postprocessing/EffectComposer.js'),
  'three/addons/postprocessing/OutputPass.js': () =>
    import('three/addons/postprocessing/OutputPass.js'),
  'three/addons/postprocessing/RenderPass.js': () =>
    import('three/addons/postprocessing/RenderPass.js'),
  'three/addons/postprocessing/UnrealBloomPass.js': () =>
    import('three/addons/postprocessing/UnrealBloomPass.js'),
  'three/addons/renderers/CSS3DRenderer.js': () =>
    import('three/addons/renderers/CSS3DRenderer.js'),
  'three/addons/utils/BufferGeometryUtils.js': () =>
    import('three/addons/utils/BufferGeometryUtils.js'),
  'three/addons/utils/SkeletonUtils.js': () => import('three/addons/utils/SkeletonUtils.js'),
  // Same module, second spelling: `three/addons/*` and `three/examples/jsm/*`
  // are one file behind two export paths, and a shim is keyed by SPECIFIER, so
  // both have to be registered — the examples' character code uses this one.
  'three/examples/jsm/utils/SkeletonUtils.js': () =>
    import('three/examples/jsm/utils/SkeletonUtils.js'),
  'three/examples/jsm/animation/CCDIKSolver.js': () =>
    import('three/examples/jsm/animation/CCDIKSolver.js'),
  'three.quarks': () => import('three.quarks'),
  'troika-three-text': () => import('troika-three-text'),
  'quarks.core': () => import('quarks.core'),
  postprocessing: () => import('postprocessing'),
  'recast-navigation': () => import('recast-navigation'),
  'recast-navigation/generators': () => import('recast-navigation/generators'),
  gsap: () => import('gsap'),
  zod: () => import('zod'),
  react: () => import('react'),
  'react/jsx-runtime': () => import('react/jsx-runtime'),
  'react-dom/client': () => import('react-dom/client'),
  // R3F — what a game's world roots are made of. Without these,
  // `browser-transpile.ts` throws "not a registered runtime module" and a TSX
  // world in a served bundle cannot mount at all. Measured against what the
  // template and every example import: fiber (23 sites), drei (15), rapier (11).
  '@react-three/fiber': () => import('@react-three/fiber'),
  '@react-three/drei': () => import('@react-three/drei'),
  '@react-three/rapier': () => import('@react-three/rapier'),
  // Native Canvas TSX uses the editor's existing Pixi renderer and display
  // classes. A bundled second copy would create a second reconciler/runtime
  // around objects mounted into the same canvas tree.
  '@pixi/react': () => import('@pixi/react'),
  '@pixi/tilemap': () => import('@pixi/tilemap'),
  'fastnoise-lite': () => import('fastnoise-lite'),
  'pixi.js': () => import('pixi.js'),
  // Project source spells a runtime import by its published package name, and
  // the loader resolves it through the editor's own source, so the project and
  // the editor share one live module namespace.
  '@vgai/threejs-runtime/adapter/constraint': () =>
    import('@vgai/threejs-runtime/adapter/constraint'),
  '@vgai/game-runtime/adapter/first-party-audio-system': () =>
    import('@vgai/game-runtime/adapter/first-party-audio-system'),
  '@vgai/threejs-runtime/adapter/first-party-navigation-system': () =>
    import('@vgai/threejs-runtime/adapter/first-party-navigation-system'),
  '@vgai/threejs-runtime/adapter/hierarchy-marks': () =>
    import('@vgai/threejs-runtime/adapter/hierarchy-marks'),
  '@vgai/project/adapter/system-adapter': () => import('@vgai/project/adapter/system-adapter'),
  '@vgai/threejs-runtime/ai/navigation': () => import('@vgai/threejs-runtime/ai/navigation'),
  '@vgai/threejs-runtime/animation/animation-clock': () =>
    import('@vgai/threejs-runtime/animation/animation-clock'),
  '@vgai/threejs-runtime/animation/xstate-animation-binding': () =>
    import('@vgai/threejs-runtime/animation/xstate-animation-binding'),
  '@vgai/game-runtime/canvas-react': () => import('@vgai/game-runtime/canvas-react'),
  // `@vgai/game-runtime/config` also exports the Node-only Vite data-check plugin.
  // Hosted project code only consumes its browser-safe schema primitives, so
  // assemble that namespace from their source modules without pulling node:fs
  // into the editor build.
  '@vgai/game-runtime/config': async () => ({
    ...(await import('@vgai/game-runtime/data/curve')),
    ...(await import('@vgai/game-runtime/data/data-ref')),
  }),
  '@vgai/game-runtime/data/curve': () => import('@vgai/game-runtime/data/curve'),
  '@vgai/game-runtime/data/data-asset': () => import('@vgai/game-runtime/data/data-asset'),
  '@vgai/game-runtime/dev/instruments': () => import('@vgai/game-runtime/dev/instruments'),
  '@vgai/threejs-runtime/loader': () => import('@vgai/threejs-runtime/loader'),
  '@vgai/game-runtime/react/world-state': () => import('@vgai/game-runtime/react/world-state'),
  '@vgai/game-runtime/runtime/debug-registry': () =>
    import('@vgai/game-runtime/runtime/debug-registry'),
  '@vgai/game-runtime/runtime/game': () => import('@vgai/game-runtime/runtime/game'),
  '@vgai/game-runtime/world3d-react': () => import('@vgai/game-runtime/world3d-react'),
  '@vgai/game-runtime/world3d-react/rapier-physics-bridge': () =>
    import('@vgai/game-runtime/world3d-react/rapier-physics-bridge'),
  // …and the factory that mounts an example's default-exported world. A
  // three root cannot mount hosted without it.
  // The mesh-kit's two library-backed modifiers. `src/lib/mesh/modifiers.ts` —
  // scaffolded into EVERY default project by the humanoid capability, and
  // present verbatim in the template and four examples — imports both at
  // module scope (`Brush`/`Evaluator` from three-bvh-csg, `MeshBVH` from
  // three-mesh-bvh). The moment that source is browser-transpiled instead of
  // pre-bundled, an unregistered specifier makes `shimUrlFor` throw "not a
  // registered runtime module" — in the DEPLOYED build only, where typecheck
  // cannot see it. Registered here so the transpile path resolves them to the
  // editor's live singletons, same as `three` itself — both build on THREE
  // (`Brush extends THREE.Mesh`; `MeshBVH` is handed real BufferGeometry), so
  // a second copy carrying its own THREE would break `instanceof`.
  'three-bvh-csg': () => import('three-bvh-csg'),
  'three-mesh-bvh': () => import('three-mesh-bvh'),
  // The mesh kit's third library-backed op, `decimate` (DECIMATE Collapse).
  // Its import is DYNAMIC — the wasm simplifier instantiates on first use, so
  // a project that never decimates never pays for it — but a dynamic
  // specifier goes through this table exactly like a static one, and an
  // unregistered one throws only in the deployed build.
  'meshoptimizer/simplifier': () => import('meshoptimizer/simplifier'),
  // `@vgai/project/adapter` is TYPE-ONLY since P-6, so a project importing it emits
  // nothing and never reaches this table; the entry stays as a harmless
  // backstop. The seam's IMPLEMENTERS now live at their own paths, and a
  // project that calls one needs that path registered — top-down-strategy's
  // `use-squad.ts` calls `createNavigationAdapter`. Caught by
  // `browser-bundle-runtime-modules.test.ts`, which regenerates the real
  // bundle; without this, hosted Play throws "not a registered runtime module".
  '@vgai/project/adapter': () => import('@vgai/project/adapter'),
  '@dimforge/rapier3d-compat': () => import('@dimforge/rapier3d-compat'),
  // feature-scenes' WaterSurface loads its detail normal map via the shared cache:
  '@vgai/threejs-runtime/asset-loaders': () => import('@vgai/threejs-runtime/asset-loaders'),
  '@vgai/threejs-runtime/ecs/scene-query': () => import('@vgai/threejs-runtime/ecs/scene-query'),
  '@vgai/threejs-runtime/ecs/user-data': () => import('@vgai/threejs-runtime/ecs/user-data'),
  '@vgai/threejs-runtime/setup/setup-renderer': () =>
    import('@vgai/threejs-runtime/setup/setup-renderer'),
  // littlest-tokyo (GLTF quick-start) extras:
  '@vgai/game-runtime/input/rebind-controller': () =>
    import('@vgai/game-runtime/input/rebind-controller'),
  // The generic fetched-asset parse error — the template's and
  // top-down-strategy's `runtime/pixi-adapter.ts` raise it, so a canvas root
  // cannot mount hosted without it registered.
  '@vgai/threejs-runtime/asset-parse-error': () =>
    import('@vgai/threejs-runtime/asset-parse-error'),
  // E5 — XState-driven character animation (third-person/rts/third-person-arena):
  xstate: () => import('xstate'),
  // rendering-scale's render lab drives the engine's batch renderer + scoped
  // render settings directly:
  '@vgai/threejs-runtime/render/render-batch-system': () =>
    import('@vgai/threejs-runtime/render/render-batch-system'),
  '@vgai/threejs-runtime/render/render-settings': () =>
    import('@vgai/threejs-runtime/render/render-settings'),
  // The bundle inlines @colyseus/schema (modular-action's rooms), and the
  // library's own BUFFER_SIZE warning string contains a verbatim
  // `import ... from "@colyseus/schema"` snippet the drift-guard's lexical
  // scan cannot tell from a real external. Registering the loader is the
  // safe answer either way: if the specifier ever becomes a true external,
  // hosted Play resolves it instead of throwing.
  '@colyseus/schema': () => import('@colyseus/schema'),
  // The rest of the estate's runtime closure, measured 2026-08-27 across the
  // template, every example and every catalog capability (the gate script
  // prints the same sweep). Each entry names its importer so a future removal
  // can be checked against the same sweep.
  '@colyseus/sdk': () => import('@colyseus/sdk'), // template main.ts, colyseus capability
  'react-data-grid': () => import('react-data-grid'), // data-tables capability
  // A stylesheet import in project source: Vite's `?inline` answers with the
  // CSS text as the default export, which is the shape the sheet expects.
  'react-data-grid/lib/styles.css?inline': () => import('react-data-grid/lib/styles.css?inline'),
  tone: () => import('tone'), // music capability
  'clipper2-js': () => import('clipper2-js'), // sprite capability verbs
  'maxrects-packer': () => import('maxrects-packer'), // sprite capability atlas
  '@dimforge/rapier2d-compat': () => import('@dimforge/rapier2d-compat'), // the Pixi surface's physics
  'jolt-physics/wasm-compat': () => import('jolt-physics/wasm-compat'), // motion cloth-sim
  '@pixiv/three-vrm-springbone': () => import('@pixiv/three-vrm-springbone'), // motion spring-chain
  '@supabase/supabase-js': () => import('@supabase/supabase-js'), // first-person player-services
  'react-dom': () => import('react-dom'), // react-root adapter's flushSync
  '@babylonjs/core': () => import('@babylonjs/core'), // babylon-first-party example
  // ---- Editor-citizen modules PROJECT TOOL CONTRIBUTIONS import. A
  // contribution is project source rendered inside the editor's own panels,
  // so these must resolve to the editor's LIVE modules — a second copy of the
  // contributions SDK would register into a registry nothing reads, exactly
  // the two-reconcilers failure `@pixi/react` documents above.
  '@vgai/editor-sdk': () => import('@vgai/editor-sdk'),
  '@vgai/editor-sdk/layouts': () => import('@vgai/editor-sdk/layouts'),
  '@vgai/editor-sdk/layout-arrangements': () => import('@vgai/editor-sdk/layout-arrangements'),
  '@vgai/editor-sdk/contributions': () => import('@vgai/editor-sdk/contributions'),
  '@vgai/editor-sdk/widgets': () => import('@vgai/editor-sdk/widgets'),
  '@editor/game-module-access': () => import('./game-module-access'),
  '@vgai/sdk/tools': () => import('../../vgai-sdk/src/tools'),
  '@vgai/sdk/generations': () => import('../../vgai-sdk/src/generations'),
  // Project stories usually import `@storybook/react` types only (erased),
  // but a value import must be the SAME csf-tools instance the editor's
  // story registry composes with.
  '@storybook/react': () => import('@storybook/react'),
  // three subpaths the estate spells out (both spellings resolve — see the
  // resolver below); GLTFExporter is the bake tools' writer, FBX/OBJ the
  // model-import readers, ShaderPass/Pass the post-processing customizers.
  'three/addons/exporters/GLTFExporter.js': () => import('three/addons/exporters/GLTFExporter.js'),
  'three/addons/loaders/FBXLoader.js': () => import('three/addons/loaders/FBXLoader.js'),
  'three/addons/loaders/OBJLoader.js': () => import('three/addons/loaders/OBJLoader.js'),
  'three/addons/postprocessing/ShaderPass.js': () =>
    import('three/addons/postprocessing/ShaderPass.js'),
  'three/addons/postprocessing/Pass.js': () => import('three/addons/postprocessing/Pass.js'),
  'three/addons/animation/CCDIKSolver.js': () => import('three/addons/animation/CCDIKSolver.js'),
  // drei's per-component entries — the same module graph as the package root
  // (drei has no `exports` map; these are its real files), so identities match.
  '@react-three/drei/core/RoundedBox': () => import('@react-three/drei/core/RoundedBox'),
  '@react-three/drei/core/OrbitControls': () => import('@react-three/drei/core/OrbitControls'),
  '@react-three/drei/core/PerspectiveCamera': () =>
    import('@react-three/drei/core/PerspectiveCamera'),
  '@react-three/drei/core/OrthographicCamera': () =>
    import('@react-three/drei/core/OrthographicCamera'),
  '@react-three/drei/core/Gltf': () => import('@react-three/drei/core/Gltf'),
};

/** The bundle-external specifiers this resolver can shim at Play time. */
export const REGISTERED_BUNDLE_SPECIFIERS: readonly string[] = Object.keys(
  BUNDLE_RUNTIME_MODULE_LOADERS,
);

/**
 * Every RUNTIME-PACKAGE source module, lazily, keyed by its path under that
 * package's `src/`. A game's source spells a runtime package by its published
 * name (`@vgai/threejs-runtime/adapter/constraint`), and it resolves HERE, to
 * the editor's own copy, which is what keeps the runtime's singletons single.
 * The exclusions name each package's Node-only modules (`node:fs` at module
 * scope); a project importing one gets the wall, correctly — they do not
 * exist in a browser.
 *
 * One `import.meta.glob` per package because the call must be statically
 * analyzable: Vite reads the literal array, so a loop over package names
 * cannot express it.
 *
 * `@vgai/game-runtime/config` stays in the explicit table above: its published
 * entry also exports the Node-only Vite data plugin, so the browser namespace
 * is assembled from its browser-safe halves there, and the explicit table wins.
 */
const PROJECT_SOURCE_MODULES = import.meta.glob([
  '../../project/src/**/*.ts',
  '../../project/src/**/*.tsx',
  '!**/*.d.ts',
  '!**/manifest/load-file.ts',
  '!**/manifest/locate.ts',
  '!**/manifest/kind-modules.ts',
  '!**/manifest/runtime-environment.ts',
]) as Record<string, () => Promise<unknown>>;

const THREEJS_RUNTIME_SOURCE_MODULES = import.meta.glob([
  '../../threejs-runtime/src/**/*.ts',
  '../../threejs-runtime/src/**/*.tsx',
  '!**/*.d.ts',
]) as Record<string, () => Promise<unknown>>;

const GAME_RUNTIME_SOURCE_MODULES = import.meta.glob([
  '../../game-runtime/src/**/*.ts',
  '../../game-runtime/src/**/*.tsx',
  '!**/*.d.ts',
  '!**/data/vite-plugin-data.ts',
  // `config.ts` statically re-exports the data-check Vite plugin (node:fs), so
  // the published entry is Node-tainted as a whole — the explicit table above
  // assembles `@vgai/game-runtime/config`'s browser-safe namespace instead.
  '!**/src/config.ts',
]) as Record<string, () => Promise<unknown>>;

/** package name -> [its glob root, its lazy module table]. */
const RUNTIME_PACKAGE_SOURCES: readonly (readonly [
  string,
  string,
  Record<string, () => Promise<unknown>>,
])[] = [
  ['@vgai/project', '../../project/src/', PROJECT_SOURCE_MODULES],
  ['@vgai/threejs-runtime', '../../threejs-runtime/src/', THREEJS_RUNTIME_SOURCE_MODULES],
  ['@vgai/game-runtime', '../../game-runtime/src/', GAME_RUNTIME_SOURCE_MODULES],
];

function runtimePackageLoader(specifier: string): (() => Promise<unknown>) | undefined {
  for (const [name, root, modules] of RUNTIME_PACKAGE_SOURCES) {
    if (specifier !== name && !specifier.startsWith(`${name}/`)) continue;
    const subpath = specifier === name ? 'index' : specifier.slice(name.length + 1);
    const base = `${root}${subpath.replace(/\.(?:[cm]?js|tsx?)$/, '')}`;
    return modules[`${base}.ts`] ?? modules[`${base}.tsx`] ?? modules[`${base}/index.ts`];
  }
  return undefined;
}

/**
 * The one resolver `browser-transpile.ts` asks: a bare specifier → a lazy
 * loader of the editor's live copy, or `undefined` when the editor does not
 * ship it. `scripts/validate-browser-runtime-modules.mjs` mirrors
 * these three rules over the estate's source (it cannot import this module,
 * which is Vite-only through `import.meta.glob`); the two are kept to the same
 * shape on purpose, and the gate's header names this function as its twin.
 */
export function servedBundleRuntimeModuleLoader(
  specifier: string,
): (() => Promise<unknown>) | undefined {
  const explicit = BUNDLE_RUNTIME_MODULE_LOADERS[specifier];
  if (explicit) return explicit;
  const runtimePackage = runtimePackageLoader(specifier);
  if (runtimePackage) return runtimePackage;
  if (specifier.startsWith('three/examples/jsm/')) {
    return BUNDLE_RUNTIME_MODULE_LOADERS[specifier.replace('three/examples/jsm/', 'three/addons/')];
  }
  if (specifier.startsWith('three/addons/')) {
    return BUNDLE_RUNTIME_MODULE_LOADERS[specifier.replace('three/addons/', 'three/examples/jsm/')];
  }
  return undefined;
}

/** Install the resolver once. Nothing loads here — a specifier loads the first
 *  time a project imports it (`ensureBareImportsLoaded`). */
export async function ensureServedBundleRuntimeModules(): Promise<void> {
  if (_resolverRegistered) return;
  registerRuntimeModuleResolver(servedBundleRuntimeModuleLoader);
  _resolverRegistered = true;
}
