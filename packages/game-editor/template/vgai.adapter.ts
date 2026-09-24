/**
 * This game's ADAPTER — the server side of the editor protocol.
 *
 * The editor is a universal CLIENT of a fixed protocol, and every game
 * supplies its own adapter: a statically evaluable binding table mapping this
 * project's regions to the libraries that serve them, its document table, and
 * whatever it declares about itself. An adapter's SIZE measures this game's
 * distance from native — which is why yours fits on a screen.
 *
 * Regions are derived mechanically from `vgai.project.json`'s `roots[]` — add
 * a root to the manifest and its region appears here for free, with no edit to
 * this file. `regionIncludes` states the PARAMETERS that derivation cannot
 * produce: which source files each region owns beyond its entry's import reach.
 * The rule stays selected; only the parameters are declared.
 *
 * WHY THAT TABLE IS NOT OPTIONAL. A file's region normally comes from which
 * root's import closure reaches it — but reach is what the dev server's module
 * graph holds AT THAT MOMENT, and a prefab opened through its own colocated
 * story is reached from nothing. The editor stamps one source-id attribute per
 * file (`userData-oid` for the R3F reconciler, `data-oid` for react-dom), and
 * `data-oid` on a THREE object is not a degraded stamp: fiber pierces the dash,
 * writes `object.data`, and THROWS the next time that object is applied to. So
 * every directory of this game's R3F source says so here, once, and the answer
 * stops depending on which module the browser asked for first. Add a component
 * folder that renders R3F and add it to this list; the editor names the file
 * and this fix (`OID001`/`OID003`) if you forget.
 *
 * What else IS stated below is this game's own document table — scenes and
 * prefabs are its first two kinds; a page, a model, a bake are kinds the same
 * way — because only
 * this game knows where its scenes are declared:
 *
 *   - `scenesFromEntrypointSelection` reads `src/world.tsx`'s module-level
 *     `const scenes = { … }` swap slot and answers one entry per key. That
 *     reference is LOAD-BEARING — the world itself mounts through it — so it
 *     cannot drift the way a `src/scenes/` folder convention can. Every entry
 *     becomes a viewport document in the editor, and `default` is the one open
 *     when the project opens.
 *   - `prefabsFromStories` reads the colocated portable-CSF stories: a
 *     component is a placeable prefab exactly when a story's `meta.component`
 *     names it.
 *
 * Drop `selection` (and name no region) for a world that mounts ONE
 * composition with no swap slot; the finder then answers with the single-scene
 * degenerate table instead.
 *
 * Unknown keys are rejected by name — this file is validated the moment it is
 * evaluated, so a typo fails here rather than becoming silence in the editor.
 */

import { defineAdapter } from '@volter/editor-project/adapter/adapter-module';

export default defineAdapter({
  regionIncludes: {
    // Every `.tsx` under these folders renders on the `world` root's `three`
    // surface. Scoped to `.tsx` on purpose: the declaration places JSX modules
    // on a reconciler, and the plain `.ts` beside them (a capability's math, a
    // shared state helper an overlay also imports) renders nothing at all.
    world: {
      include: [
        'src/components/**/*.tsx',
        'src/prefabs/**/*.tsx',
        'src/scenes/**/*.tsx',
        'src/lib/reflections/**/*.tsx',
        'src/lib/static-batch/**/*.tsx',
      ],
    },
  },
  documents: {
    find: [
      { finder: 'scenesFromEntrypointSelection', regions: ['world'], selection: 'scenes' },
      { finder: 'prefabsFromStories' },
      { finder: 'machinesFromModules', include: ['src/**/*.ts', 'src/**/*.tsx'] },
    ],
    default: 'main',
  },
});
