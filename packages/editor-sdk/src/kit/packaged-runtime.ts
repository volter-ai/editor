/**
 * Runtime detection of the PACKAGED editor server (`packages/editor/server/
 * packaged.ts` — a `@vgai/editor` npm package with NO monorepo checkout on
 * disk) from editor CLIENT code. Needed because a react world's mount
 * (`react-mount-runtime.ts`'s `resolveReactRootMountRuntime`) must resolve its
 * `react`/`react-dom/client` from the
 * PROJECT's own module graph ONLY under this runtime — see that function's
 * doc comment, and `packaged.ts`'s header doc comment ("React-world OID
 * authoring parity"), for the dual-React-instance bug this closes. Under
 * dev, this must resolve `false` so the existing static-import path
 * stays byte-unchanged (one shared Vite instance already collapses both
 * react copies via `resolve.dedupe`).
 *
 * Reads the server's own `packaged` flag off `/__editor/project`'s response
 * (computed server-side via `isMonorepoScaffoldRoot`, `server-utils.ts`)
 * rather than probing a URL that only resolves in packaged mode: an
 * unconditional dynamic `import()` probe would 404 (and log an
 * unsuppressible browser console error) on EVERY react-world mount under
 * dev — the exact reasoning `binding-resolver.ts`'s
 * `loadProjectUIRegistry` doc comment already recorded for `hasUiRegistry`
 * ("the client must not probe /@fs for it").
 *
 * A plain inline `fetch()`, not `editor-api.ts`'s `getCurrentServerProject`
 * — same reasoning `loadProjectUIRegistry` documents: this module (via
 * `binding-resolver.ts`) must stay importable by headless Node/vitest
 * suites, and `editor-api.ts`'s module top level pulls in `./storage`.
 *
 * A HOST THAT SERVES NO `/__editor/project` is answered locally rather than by
 * a doomed fetch: it is never the packaged runtime, because "packaged" names a
 * Node host serving a project's own module graph, and a 404's console error is
 * unsuppressible on every doorway of every mount. Same guard, same reason, as
 * `ui-source/tier-source-write-backend.ts`'s `serverSourceWriteRoutes`.
 *
 * ## What is memoized, and what a FAILED probe does
 *
 * An ANSWER is memoized for the page — the runtime a server process runs
 * under cannot change without a restart, so a settled answer is settled. A
 * probe that never got an answer is NOT memoized, and does NOT resolve: it
 * drops the memo and REJECTS, so the next caller asks again.
 *
 * Both halves were bought by one measured failure. A `.catch(() => false)`
 * latch turned a single unreachable fetch — a mount landing in the window
 * while `vgai edit` restarts its dev server, which it does on any
 * server-file change — into a page where EVERY doorway
 * (`three-ingest-runtime`, `canvas-entry-runtime`, `r3f-entry-runtime`,
 * the two story runtimes, `binding-resolver`'s react
 * mount) silently resolved the SHELL's namespace for the rest of the
 * session. Under the packaged runtime that is the wrong graph, and the cost
 * lands 10–15 seconds later as a mount failure whose message blames the
 * GAME ("bundles its own (un-shared) copy of three") for a defect in this
 * host — the exact mis-attribution `three-ingest-runtime.ts`'s own
 * loud-throw comment already refuses to make for the sibling case.
 *
 * So "I don't know" is never spent as "dev". Every doorway reads this with
 * `await isPackagedRuntime()` and does nothing else with the answer, so the
 * rejection propagates to the mount site unchanged: nothing mounts on a
 * guessed graph, the message names this host, and because the memo is
 * dropped the remedy it states — retry the mount — is a real one rather
 * than advice.
 */

import { editorServerJson } from '@volter/editor-sdk/kit/editor-server-response';

let cachedIsPackaged: Promise<boolean> | null = null;

export function isPackagedRuntime(): Promise<boolean> {
  if (!cachedIsPackaged) {
    // The `fetch` call is INSIDE the chain so that a synchronous throw from it
    // is a rejected probe like any other, rather than an exception thrown at
    // whoever happened to ask first.
    const probe: Promise<boolean> = Promise.resolve()
      .then(() => fetch('/__editor/project'))
      .then((res) =>
        editorServerJson<{ project?: { packaged?: boolean } | null }>(
          res,
          '`/__editor/project` did not answer',
        ),
      )
      .then((data) => Boolean(data.project?.packaged))
      .catch((err: unknown) => {
        if (cachedIsPackaged === probe) cachedIsPackaged = null;
        throw new Error(
          "This editor session's runtime is unknown — `/__editor/project` did not answer, so " +
            'which module graph a world mounts in (this shell’s, or the project’s) cannot be ' +
            'decided and nothing was mounted on a guess. This is a fault in the editor host, ' +
            'not in the game. The answer is not latched: retry the mount (reopen the project) ' +
            `and the question is asked again. (${err instanceof Error ? err.message : String(err)})`,
          { cause: err },
        );
      });
    cachedIsPackaged = probe;
  }
  return cachedIsPackaged;
}

/** Test-only: reset the memoized result between tests (mirrors
 *  `setCachedProjectUIRegistry`'s test-seam shape). */
export function resetPackagedRuntimeCacheForTest(): void {
  cachedIsPackaged = null;
}

/** Test-only: pre-seed the probe's answer. jsdom has no `/__editor/project` to
 *  ask (vitest's MODE is not `web`, so the browser short-circuit does not
 *  apply), and the loud unknown-runtime refusal — correct in a live session —
 *  is pure noise in a suite that mounts portable stories. */
export function setPackagedRuntimeForTest(packaged: boolean): void {
  cachedIsPackaged = Promise.resolve(packaged);
}
