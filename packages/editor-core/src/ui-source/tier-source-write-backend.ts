/**
 * WHERE A DESIGN-TIME SOURCE EDIT GOES, decided by what THIS SESSION'S HOST
 * actually serves — the one home for a choice that used to be written out
 * byte-for-byte in `r3f-design-session.ts` and `canvas-design-mount.ts`.
 *
 * ## The bug the duplication carried, twice
 *
 * Both copies read `import.meta.env.DEV ? createHttpSourceWriteBackend() :
 * undefined`, with a comment claiming "a production build has no
 * `/__ui-source/*` middleware". That is FALSE of the packaged editor a registry
 * install runs (`server/packaged.ts`), which
 * registers `uiOidPlugin()` and genuinely serves `/__ui-source/*` — while the
 * editor shell it serves is a PRODUCTION build, so `import.meta.env.DEV` is
 * `false` there. Net effect on every `npm i @vgai/editor` install: gizmo and
 * inspector edits mounted, applied to the running object, and were silently
 * discarded, because the recorder was reachable and nobody asked it.
 *
 * `import.meta.env.DEV` is a fact about how the SHELL BUNDLE was built. Whether
 * source writes are recorded is a fact about the HOST SERVING IT. They are not
 * the same axis, and the doctrine is explicit that a standing build flag may
 * never be what decides whether writes happen — only the recorder's actual
 * existence may.
 *
 * ## What decides it now
 *
 * The server states it: `/__editor/project` carries a top-level `sourceWrite`
 * boolean, which the host derives from its OWN Vite plugin list (whether
 * `uiOidPlugin()` — the plugin that serves the `/__ui-source/*` read/write
 * endpoints — is registered), never from a hand-maintained second declaration.
 * So dev and packaged each answer with what they really carry, and a
 * future host cannot forget to.
 *
 * Reading a server-stated flag rather than probing the route directly is the
 * shape `packaged-runtime.ts` already established for the sibling question
 * ("is this the packaged runtime?"), for the reason recorded there: a probe
 * that only resolves on some hosts logs an unsuppressible browser console error
 * on the others. It is memoized per page load for the same reason — the runtime
 * a server process is running under cannot change without a restart.
 *
 * ## The honest floor
 *
 * "No recorder" is decided PER LANE and per tier, never per build. On the
 * hosted (browser) tier the native/OID lane HAS one — the storage-backed
 * recorder — while the ingest lane genuinely does not, because
 * `IngestSourcePersistence` speaks `/__ingest-source/*` HTTP and has no
 * storage-backed equivalent. Both answers are stated by asking what this
 * session actually carries; neither is inferred from the other.
 *
 * When no recorder exists, this returns `undefined` and NOTHING fabricates a
 * write path. The adapter then exposes no `persistence` provider, which is what
 * makes the standing capability report say so in the product's own words
 * (`adapter-reach.ts`, `PROVIDER_GAP.persistence`: "edits to this world are
 * live-only — the mount carries no write-back route to the game's own source").
 * That is a warning that keeps firing, not a grade.
 */

import { editorServerJson } from '../editor-server-response';
import { createHttpSourceWriteBackend, type SourceWriteBackend } from './source-write-backend';

/**
 * The two write routes a host may serve, as it states them.
 *
 * Two booleans rather than one because they are two PLUGINS — `uiOidPlugin`
 * serves `/__ui-source/*` (the native + OID lanes' recorder) and
 * `creationSiteWritePlugin` serves `/__ingest-source/*` (the ingest lane's), and
 * a host can register either without the other. They arrive in ONE probe
 * because they are two fields of one response, not two questions.
 */
interface SourceWriteRoutes {
  readonly ui: boolean;
  readonly ingest: boolean;
}

let cachedSourceWriteRoutes: Promise<SourceWriteRoutes> | null = null;
/** The ANSWER, once a probe has actually produced one — what the synchronous
 *  readers below serve. `null` means "not asked yet, or asked and not
 *  answered"; it is never set from a failed probe, for the reason the memo's
 *  own doc comment records. */
let settledSourceWriteRoutes: SourceWriteRoutes | null = null;

/**
 * What this origin's host says it serves — the one probe both flags read.
 *
 * A plain inline `fetch()` rather than `editor-api.ts`'s project reader, for
 * the reason `packaged-runtime.ts` records: this module is reachable from
 * design-mount code that headless Node/vitest suites import, and
 * `editor-api.ts`'s module top level pulls in `./storage`.
 *
 * An ANSWER is memoized for the page; a probe that never got one is not. The
 * memo exists because the runtime a server process runs under cannot change
 * without a restart — but a probe that failed to reach the server learned
 * nothing about that runtime, and latching its fallback would turn one
 * unlucky fetch (a design mount landing in the window while `vgai edit`
 * restarts its dev server — a routine event, it restarts on any server-file
 * change) into a page whose authoring is live-only until someone reloads.
 * `packaged-runtime.ts` drops a failed probe for the same reason — its own
 * latch was measured doing the same damage on the graph-identity axis — and
 * the two differ only in what the failed probe's OWN caller gets: that one
 * rejects (a mount on a guessed module graph is not a degraded mount, it is
 * the wrong one), while this flag answers `false` for that caller, because
 * live-only-for-one-mount is a real, sayable degrade and this module says it
 * out loud in {@link primedRoutes}.
 *
 * THE BROWSER TIER IS ANSWERED HERE, not at each call site. There is no
 * `/__editor/project` on that origin, and a fetch that 404s logs an
 * unsuppressible console error on a page whose answer is already known. The
 * guard lived on `primeSourceWriteRuntime` alone, which left
 * `ingest-root-adapter.ts`'s `readServedOidIndex` — the one caller that
 * reaches this once per ingest mount — firing exactly the fetch this rule
 * exists to prevent, and re-firing it on every mount because a failed probe
 * deliberately does not latch.
 */
function serverSourceWriteRoutes(): Promise<SourceWriteRoutes> {
  if (!cachedSourceWriteRoutes) {
    // The call is INSIDE the chain, so a `fetch` that throws SYNCHRONOUSLY is a
    // rejected probe like any other rather than an exception thrown at whoever
    // asked. That matters now that `primedRoutes` kicks this from a synchronous
    // mount path: a throw there would take the whole mount down over a question
    // whose honest answer is "no recorder".
    const probe: Promise<SourceWriteRoutes> = Promise.resolve()
      .then(() => fetch('/__editor/project'))
      .then((res) =>
        editorServerJson<{ sourceWrite?: boolean; ingestSourceWrite?: boolean }>(
          res,
          '`/__editor/project` did not answer the source-write probe',
        ),
      )
      .then((data) => {
        const answer: SourceWriteRoutes = {
          ui: Boolean(data.sourceWrite),
          ingest: Boolean(data.ingestSourceWrite),
        };
        settledSourceWriteRoutes = answer;
        return answer;
      })
      .catch(() => {
        if (cachedSourceWriteRoutes === probe) cachedSourceWriteRoutes = null;
        return { ui: false, ingest: false };
      });
    cachedSourceWriteRoutes = probe;
  }
  return cachedSourceWriteRoutes;
}

/** Does the server on this origin serve the `/__ui-source/*` recorder? See
 *  {@link serverSourceWriteRoutes} for the memo's rules. */
export function serverRecordsSourceWrites(): Promise<boolean> {
  return serverSourceWriteRoutes().then((routes) => routes.ui);
}

/**
 * Ask the question ONCE, at editor boot, so the synchronous reader below has a
 * real answer by the time any surface mounts. Called from the frame bridge
 * beside the other install-time wiring; every other caller still asks through
 * the two functions above and gets this same memo.
 */
export function primeSourceWriteRuntime(): void {
  void serverSourceWriteRoutes();
}

/**
 * The settled routes, or `null` with the warning already said — the shared body
 * of the two synchronous readers below, so the three-case contract documented on
 * {@link sourceWriteBackendIfPrimed} is written once.
 */
/**
 * Say a not-yet-primed mount out loud. Shared by both tiers because it is the
 * same degrade on each — this mount's edits are live-only, and a remount is a
 * real remedy because the caller kicked the prime on the way out.
 *
 * The console IS the loud leg: capture feeds editorConsole and console-sync
 * forwards it to `vgai console`, without this module importing the editor-api
 * graph a headless design mount must not pull in.
 */
function warnUnprimed(surface: string): void {
  // biome-ignore lint/suspicious/noConsole: see this function's doc comment
  console.warn(
    `[vgai-editor] ${surface} mounted before this session's source-write route was ` +
      'confirmed, so its edits are live-only. Remount the surface (reopen the project) ' +
      'to author against the game’s own source.',
  );
}

function primedRoutes(surface: string): SourceWriteRoutes | null {
  // The BROWSER tier never reaches here for the `ui` question — that is
  // answered by `sourceWriteBackendIfPrimed`'s own storage-backed path. The
  // ingest question now has a storage answer too: `IngestSourcePersistence`
  // runs against `authoring/browser-ingest-source.ts`'s route emulation for a
  // storage-backed project (a staged example/ingest keeps the honest "no").
  if (settledSourceWriteRoutes === null) {
    // ASK AGAIN, so the remedy this warning names is a real one. The boot prime
    // is ONE probe, and a probe that never reached the server (a mount landing
    // while `vgai edit` restarts its dev server) settles nothing — after which
    // only `ingest-root-adapter.ts`'s `readServedOidIndex` re-asks, and it is on
    // the three lane alone. Without this kick the canvas-ingest and ingest-DOM
    // surfaces warn for the LIFE OF THE PAGE and "remount the surface" changes
    // nothing, which is the silent live-only session this whole seam exists to
    // end. Fire-and-forget: this caller is synchronous and honestly live-only
    // either way; the kick is what makes the NEXT mount recorded. A probe
    // already in flight is the memo, so this cannot stack.
    void serverSourceWriteRoutes();
    warnUnprimed(surface);
    return null;
  }
  return settledSourceWriteRoutes;
}

/**
 * The source-write backend for a mount whose call site is SYNCHRONOUS, or
 * `undefined` when there is honestly no recorder for it.
 *
 * Same axis as {@link tierSourceWriteBackend} — what the HOST serves, never how
 * the shell was built — read from the memo above instead of awaited. The three
 * answers, stated because a sync reader of an async fact has to state them:
 *
 * 1. **Primed** (the ordinary case): `primeSourceWriteRuntime()` runs at boot,
 *    before a project is open and therefore before anything here can mount, so
 *    by the time an ingest sibling, an ingest DOM surface or a Play→source
 *    committer is constructed the route fact is in hand and this returns the
 *    real recorder on any host that serves `/__ui-source/*`.
 * 2. **Answered `false`**: no recorder, `undefined`, and nothing is fabricated
 *    — the honest floor described in this module's header.
 * 3. **Not yet answered**: `undefined` AND A WARNING, never a silent
 *    `undefined`. This can only happen when a surface mounts inside the boot
 *    probe's own round trip (or while a restarting dev server is unreachable),
 *    and the cost is one mount's edits being live-only, so it is said out loud
 *    on the channel `console-sync.ts` forwards to `vgai console` — the same
 *    place every other unresolved editor condition lands — naming the surface
 *    and the remedy. It also RE-ASKS on the way out, which is what makes that
 *    remedy true rather than advice: a boot probe that never reached the server
 *    leaves nothing to settle, and these surfaces have no async door of their
 *    own to re-open it with. Deliberately NOT an assert: none of these call
 *    sites is reachable only after a design mount (an ingest root mounts with
 *    no design session at all), so "this cannot happen" would be a claim, not
 *    a fact.
 *
 * The BROWSER tier answers with its storage-backed recorder, primed at boot by
 * {@link primeSourceWriteRuntime}. It used to answer `undefined` here on the
 * grounds that a dynamic import is unreachable from a synchronous call site —
 * true of the import, but the conclusion drawn from it was false: that tier has
 * a real, working recorder ({@link tierSourceWriteBackend} builds and uses it),
 * so `undefined` made four surfaces report "cannot write project source" on a
 * tier that can. Priming moved the import off the call site instead of asking a
 * sync function to await. If the prime has not landed yet, the same case-3
 * warning below applies, and it re-kicks the build for the same reason.
 */
export function sourceWriteBackendIfPrimed(surface: string): SourceWriteBackend | undefined {
  return primedRoutes(surface)?.ui ? createHttpSourceWriteBackend() : undefined;
}

/**
 * The ingest lane's half: may this session write an ingest edit into the game's
 * own source through `/__ingest-source/*`?
 *
 * Same three cases, same reasons, same channel as
 * {@link sourceWriteBackendIfPrimed} — a different route because it is a
 * different plugin. `false` is the honest floor and the caller builds no writer,
 * so the ingest adapter reports live-only in the product's own words rather than
 * failing at the first apply.
 */
export function ingestSourceWritesRecordedIfPrimed(surface: string): boolean {
  return primedRoutes(surface)?.ingest === true;
}

/** Test-only: reset the memoized result (mirrors
 *  `resetPackagedRuntimeCacheForTest`'s seam shape). */
export function resetSourceWriteRuntimeCacheForTest(): void {
  cachedSourceWriteRoutes = null;
  settledSourceWriteRoutes = null;
}

/**
 * The source-write backend this session can honestly use, or `undefined` when
 * there is no recorder to write through — the session's own `/__ui-source/*`
 * route, confirmed once by {@link serverRecordsSourceWrites}.
 */
export async function tierSourceWriteBackend(): Promise<SourceWriteBackend | undefined> {
  return (await serverRecordsSourceWrites()) ? createHttpSourceWriteBackend() : undefined;
}
