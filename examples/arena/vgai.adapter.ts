/**
 * This game's ADAPTER — the server side of the editor protocol.
 *
 * The editor is a universal CLIENT of a fixed protocol, and every game supplies
 * its own adapter: a statically evaluable binding table mapping this project's
 * regions to the libraries that serve them, its scene table, and whatever it
 * declares about itself. An adapter's SIZE measures this game's distance from
 * native — which is why a first-party example's is one line.
 *
 * `nativeAdapter()` derives every region mechanically from
 * `vgai.project.json`'s `roots[]` and finds the scene table with the shipped
 * finders (scenes from this entrypoint's own selection; prefabs from their
 * colocated stories). Add a root to the manifest and its region appears here for
 * free — no edit to this file.
 *
 * `regionIncludes` states the one thing that derivation cannot: which source
 * files each region owns beyond its entry's import REACH. Reach is what the dev
 * server's module graph holds at that moment, and a prefab opened through its
 * own colocated story is reached from nothing — at which point the editor would
 * stamp `data-oid` on THREE objects, which fiber pierces and then throws on. So
 * this game's R3F folders say so once, and the answer stops depending on which
 * module the browser asked for first.
 *
 * When this game grows something else the native bindings do not cover, state it
 * HERE rather than letting the host guess; see
 * `packages/editor/template/vgai.adapter.ts` for the worked `defineAdapter`
 * shape. Unknown keys are rejected by name — this file is validated the moment
 * it is evaluated, so a typo fails here rather than becoming silence in the
 * editor.
 */

import {
  defineAdapter,
  EXPORTED_COMPOSITION_REGIONS,
} from '@volter/editor-project/adapter/adapter-module';

export default defineAdapter({
  regions: 'manifest-roots',
  regionIncludes: {
    // Every `.tsx` under these folders renders on the `world` root's `three`
    // surface. Scoped to `.tsx` because the declaration places JSX modules on a
    // reconciler; the `.ts` beside them renders nothing.
    world: {
      include: [
        'src/components/**/*.tsx',
        'src/prefabs/**/*.tsx',
        'src/scenes/**/*.tsx',
        'src/lib/ik/**/*.tsx',
      ],
    },
    ui: {
      include: ['src/ui/**/*.tsx'],
    },
  },
  // `nativeAdapter()`'s own two finders, restated, plus the one this game
  // needs beyond them. This file was ONE LINE until the weapon kit became a
  // bpy script (M2): a `.blend` is a document the editor can only see if a
  // selection names it, and `nativeAdapter` takes extra scenes and region
  // includes but not extra finders. Restating the native pair is what a
  // scaffolded project with the `mesh` addition ships
  // (`packages/create-vgai-project/src/additions.ts`), so this is the shape
  // rather than a local invention.
  documents: {
    find: [
      { finder: 'scenesFromEntrypointSelection', regions: EXPORTED_COMPOSITION_REGIONS },
      { finder: 'prefabsFromStories' },
      { finder: 'modelsFromBlendFiles', include: ['src/models/**/*.blend'] },
      { finder: 'machinesFromModules', include: ['src/**/*.ts', 'src/**/*.tsx'] },
    ],
  },
});
