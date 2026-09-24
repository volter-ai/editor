/**
 * THE INGEST LANE, started (`@volter/editor-sdk/services`, a
 * `workspace.service` contribution).
 *
 * Three jobs, and the order matters:
 *
 * 1. IMPORTING the lane's modules is what runs their registrations. A package
 *    module runs only when something imports it, and the lane's live-session
 *    registration, its `ingest`/`ingestCaptureWait` state facets and its
 *    `onShellStore` binding are module-load side effects of
 *    `mount-ingest-root.ts`. The static import below is therefore load-bearing
 *    — `vgai status` carries `ingest: null` / `ingestCaptureWait: null` before
 *    contribution pass. A product that composes no `@volter/editor-game` reports
 *    neither key, which is the honest state: no lane claims to mount
 *    unmodified games.
 *
 * 2. AUTO-LAUNCH on `project.onReady`. The two boot chains (`the world root's stage`,
 *    `NonThreeAuthoringBootstrap`) used to call `autoLaunchIngest(store)` by
 *    name; they now only run the project-ready hook, and this is its first
 *    registrant (WORK.md §P4). That hook is LATCHED per project, because a
 *    contribution pass can finish on either side of the boot chain;
 *    `autoLaunchIngest`'s own dedupe makes the second arrival a no-op. And
 *    `hosted-example.ts`'s auto-play decision still runs AFTER the hook, so
 *    `isIngestActive()` is answered by a mount this hook already made.
 *
 * 3. REGISTERING THIS LANE'S ADAPTER DECLARATIONS. A repo-vendored game does
 *    not ship its own `vgai.adapter.ts` — by the REALM rule its host-realm
 *    declaration lives in the in-tree registry (`@editor/ingest/registry`),
 *    which the host used to import directly and therefore carried in every
 *    editor boot, a `models` build that mounts no unmodified game included.
 *    The host now owns only the PRECEDENCE and asks a registered source
 *    (`@editor/project-adapter`'s `registerAdapterDefinitionSource`); this lane owns the table,
 *    because these are ITS declarations for content IT mounts. The host WAITS
 *    for this registration when a project's manifest declares an ingest root
 *    — a contract fact it reads before any contribution loads — so the
 *    registration arriving on the contribution pass is on time by
 *    construction, never a re-mount after a wrong one.
 *
 * The store comes from `@editor/shell-store-door`, the same arrival
 * `mount-ingest-root.ts` binds itself on — read at launch time rather than
 * captured, so neither ordering can leave the launch holding `null`.
 */
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { importIngestAdapterModule, ingestAdapterModulePath } from '../src/host/ingest/registry';
import { registerAdapterDefinitionSource } from '@volter/editor-core/project-adapter';
import { threeStoreForHost } from '@volter/editor-core/shell-store-door';
import { editorHost } from '@volter/editor-sdk/host';
import { autoLaunchIngest } from '../src/ingest/mount-ingest-root';

export const point = 'workspace.service';

export function start(): () => void {
  const stopSource = registerAdapterDefinitionSource({
    id: 'in-tree-ingest-registry',
    owner: '@volter/editor-game/contributions/ingest.service.ts',
    modulePathFor: (rootId) => ingestAdapterModulePath(rootId),
    // A module that exists and throws is left to throw: `defineAdapter`
    // validates at evaluation time, and the host names that failure by path
    // rather than swallowing it into the native default.
    importModule: async (rootId) => await importIngestAdapterModule(rootId),
  });
  const stopReady = editorHost().project.onReady(async () => {
    const store = threeStoreForHost();
    if (!store) {
      // The store arrives with `AppRoot`, long before any boot chain reaches
      // ready, so this cannot happen quietly — say so rather than skipping an
      // auto-launch the manifest asked for.
      editorConsole.error(
        'Ingest auto-launch skipped: the editor shell store had not arrived at project ready.',
        'ingest',
      );
      return;
    }
    await autoLaunchIngest(store);
  });
  return () => {
    stopReady();
    stopSource();
  };
}
