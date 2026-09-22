/**
 * WHAT THE SESSION IS DOING RIGHT NOW, and the agent-facing doors that read
 * it: `/__editor/state`, `/__editor/validation-log`, `/__editor/editor-state`
 * and the `/__vgai*` family.
 *
 * `/__vgai` is the agent poke surface — one self-describing index over the
 * status, validation, provider-state and screenshot reads beneath it. The
 * screenshot route is deliberately SERVER-side: the server owns the
 * filesystem, so the PNG lands under the project where an agent's file reader
 * can open it without leaving its sandbox.
 *
 * `/__editor/editor-state` is the durable half (`.vgai/editor-state.json`);
 * `/__editor/state` is the live half a browser tab reports and the CLI reads.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  assertEditorCompatibility,
  assertProjectCompatibility,
  ProjectCompatibilityError,
} from '@volter/editor-sdk/session/editor-compatibility';
import type { Request, Response } from 'express';
import type { EditorServerRouter } from '../editor-server';
import { clientCount } from '../editor-sse';
import { readProjectView } from '../project-view';
import { commandResponseFor } from '../server-utils';
import type { RouteContext } from './context';
import type { ControlPlane } from './control-plane';

export function registerProjectStateRoutes(
  router: EditorServerRouter,
  ctx: RouteContext,
  plane: ControlPlane,
): void {
  const {
    compatibilityIdentity,
    consoleLedger,
    currentValidationLogEntries,
    editorStatesByClient,
    engineRoot,
    participantConnections,
    projectValidation,
    projectWarnings,
    trustedShareIdentity,
  } = ctx;
  const {
    clientsInDeliveryOrder,
    decorateWithCommandListener,
    handleEditorState,
    relayCommandResult,
    tabTableFor,
  } = plane;

  // ---- Editor state (browser reports / CLI reads) ----
  router.get('/__editor/state', async (req: Request, res: Response) => {
    // `ctx.editorState` is the last snapshot a browser POSTed; it persists even
    // after every tab closes. Stamp the response with the TAB TABLE so callers
    // can distinguish "a tab is here now" from "this is stale cache from a tab
    // that has since gone away" — and, when a tab is here but quiet, see the
    // heartbeat ages that say so.
    const stateParticipantId =
      trustedShareIdentity(req)?.participantId ??
      ctx.hostParticipantId ??
      (participantConnections.size > 0 ? '__vgai_missing_local_host__' : undefined);
    const table = tabTableFor(stateParticipantId ?? null);
    // `connected`/`editorsConnected` derive from the TABLE, never from a
    // socket count: a tab mid-reload holds no socket and is still here, and a
    // socket without a tab behind it was never worth counting.
    const reported = table?.report() ?? [];
    const connected = reported.length;
    // P36: the table's `channel`/`unresponsive` are facts about the CONTROL
    // CHANNEL, which the pre-React entry opens before any module loads. A page
    // that dies during boot therefore reads as fully healthy there. This is the
    // fact about the DOCUMENT, decorated on per tab from the receipt/attach
    // paths the relay already uses — never synthesized when a tab is unknown.
    const tabs = decorateWithCommandListener(reported, table, Date.now());
    // TABS THAT ARE GONE, and what happened to them. `closed` and `crashed`
    // are verdicts about a tab that is no longer present, so they can only be
    // said from the table's short departure memory — and they are the two
    // answers nobody could get before (2026-09-17: a renderer killed by a
    // dev-server reload and a wedged main thread reached every reader as the
    // same silence). A SEPARATE array from `tabs` above, because
    // `editorsConnected` counts that one and a dead row inside it would make a
    // crashed tab read as a connected one.
    const departedTabs = table?.departedReport() ?? [];
    // The snapshot to report is the BLESSED TAB's own — one truth, the same
    // one the relay routes to. Reading it from a separately-computed
    // "controller" was how `vgai status` and `vgai play` could disagree about
    // which tab they were talking about.
    const blessed = table?.blessedTabId() ?? null;
    const controllerClientId =
      blessed === null ? undefined : clientsInDeliveryOrder(blessed, table)[0];
    // A reload can leave the outgoing page registered for minutes. Select
    // the relay's preferred page before looking up its snapshot: falling
    // through to an older page would report stopped while the successor runs,
    // or playing before the successor has mounted anything.
    const controlledState =
      controllerClientId === undefined ? undefined : editorStatesByClient.get(controllerClientId);
    const useUnscopedState = blessed === null && !stateParticipantId;
    const state = controlledState?.state ?? (useUnscopedState ? ctx.editorState : {});
    const stateUpdatedAt =
      controlledState?.updatedAt ?? (useUnscopedState ? ctx.editorStateUpdatedAt : null);
    // #124: project identity, server-computed exactly like `projectValidation`
    // below (never part of the browser-POSTed snapshot) — lets a watcher/relay
    // holding only a port number tell which project that port serves. Mirrors
    // `/__editor/project`'s own `ctx.projectRoot === engineRoot` -> "no project"
    // convention rather than introducing a new one.
    const projectOpen = ctx.projectRoot !== engineRoot;
    const view = projectOpen ? await readProjectView(ctx.projectRoot) : null;
    const nameField = view?.['name'];
    // The compatibility verdict for the project this server is SERVING.
    //
    // The gate itself is not new: the browser preflights it on activation and
    // renders the refusal, and the project-switch endpoint enforces it. But an
    // editor started on an incompatible project serves happily — the server
    // never activates anything — so the refusal lived only in the tab, and
    // every CLI surface reported a healthy session. `vgai status` said
    // `connected: true` with empty validation, and `vgai play` timed out into
    // "Editor reloaded during play startup; retrying…", which reads as a flaky
    // socket and sends you bisecting the toolchain. An agent drives this editor
    // THROUGH the CLI, so a gate that reports itself only in pixels is
    // invisible by construction, and the retry message actively misdirects.
    //
    // Server-computed on every read like its `projectValidation` neighbour, so
    // it cannot go stale against a project switch or an edited manifest.
    const projectCompatibility = (() => {
      if (!view) return null;
      try {
        const identity = compatibilityIdentity();
        assertEditorCompatibility(identity);
        assertProjectCompatibility(view, identity);
        return null;
      } catch (error) {
        if (error instanceof ProjectCompatibilityError) {
          return { error: error.message, recovery: error.recovery };
        }
        throw error;
      }
    })();
    res.json({
      // FIRST key, for the same reason `commandResponseFor` puts it first: the
      // unresolved console set is the one fact a reader must not scroll past.
      // Server-computed, so it is current even when the browser-POSTed
      // snapshot below is stale cache from a tab that has since died — which
      // is exactly the case the whole ledger exists for.
      unresolvedConsole: consoleLedger.summary(),
      ...state,
      // The session's own children, computed here on every read like
      // `projectValidation` below — never part of the browser-POSTed snapshot,
      // which is a page's report about itself and knows nothing about a
      // workbench this process spawned.
      workbench: ctx.options.workbench?.() ?? null,
      product: ctx.options.product?.() ?? null,
      editorsConnected: connected,
      connected: connected > 0,
      // The whole table, one row per present tab. Owner: "if they DO get
      // disconnected make it clear that it happened" — `lastBeatAgo` and
      // `epochCount` are how an agent sees a gap or a reload loop without
      // reading a log.
      tabs,
      departedTabs,
      // The auto-open runaway guard's state, so a session that gave up
      // opening windows says so where somebody will read it.
      tabAutoOpen: {},
      // #run2-cold-vite: null until the FIRST genuine index-page GET this
      // server has served (see the response-observing middleware above).
      // P20 also reads it as "when the running document last fully loaded",
      // which is what the asset-divergence comparison below needs.
      lastIndexRequestAt: ctx.lastIndexRequestAt,
      // P20 — server-OBSERVED writes under `public/` (the same chokidar
      // watcher that broadcasts `assets-changed`), never browser-reported.
      // `lastChangedAt: null` means nothing has changed this server lifetime,
      // which is not the same as "the page's caches are current".
      publicAssets: {
        lastChangedAt: ctx.publicAssetsLastChangedAt,
        lastPath: ctx.publicAssetsLastPath,
        changedCount: ctx.publicAssetsChangedCount,
      },
      ...(stateUpdatedAt !== null ? { stateUpdatedAt } : {}),
      // WHEN THIS ANSWER WAS COMPOSED. `stateUpdatedAt` above is the PAGE's
      // reading (when a tab last POSTed its snapshot); this is the SERVER's,
      // and every field it computes itself — the tab table, project
      // validation, public-asset writes — is as of this instant. A reader with
      // both can age each half against the right clock instead of assuming a
      // snapshot is current because it arrived just now. Always present: an
      // answer with no time on it is the whole defect this closes.
      servedAt: Date.now(),
      // #103: server-computed (never part of the browser-POSTed snapshot
      // above), so it's always current — a file present here is currently
      // failing validation; a clean project reports `{}`. `vgai status`
      // prints this whole object as-is, so no CLI changes were needed to
      // surface it.
      projectValidation: Object.fromEntries(projectValidation),
      projectWarnings: Object.fromEntries(projectWarnings),
      // PD-14: the qualifier on the two maps above — `'awaiting-src'` means
      // the source half of that pass is not running at all, so an empty
      // `projectValidation` says nothing about `src/`. Server-computed like
      // its neighbors, so it is always current.
      sourceValidation: ctx.sourceValidation,
      // `null` when the project and this editor agree — the same always-present
      // shape as the two maps above, so an absent key never has to be read as
      // either "compatible" or "not checked".
      projectCompatibility,
      projectRoot: projectOpen ? ctx.projectRoot : null,
      projectName: typeof nameField === 'string' ? nameField : null,
    });
  });

  router.post('/__editor/state', (req: Request, res: Response) => {
    const outcome = handleEditorState(req.body as Record<string, unknown>);
    if (outcome.status === 200) res.json({ ok: true });
    else res.status(outcome.status).json({ error: outcome.error });
  });

  // ---- #146: the agent poke surface (rung 2)
  //
  // Plain-GET reads for the operations an agent repeats most — check state,
  // check validation, grab a frame. Deliberately curl-shaped: no JSON body to
  // quote, terse output, and bulky payloads returned as PATHS inside the
  // project (never blobs — an agent's context budget is metered, and a
  // sandboxed agent can read project-internal paths without permission
  // prompts). Mutations stay on POST `/__editor/command`. The index below is
  // the wire's self-discovery: arbitrary endpoint names are fine when
  // queryable, fatal when memorized.
  router.get('/__vgai', (_req: Request, res: Response) => {
    res.json({
      project: ctx.projectRoot !== engineRoot ? ctx.projectRoot : null,
      connected: clientCount() > 0,
      endpoints: {
        'GET /__vgai': 'this index',
        'GET /__vgai/state': 'every observable game-state provider (play mode must be running)',
        'GET /__vgai/state/:provider': 'one provider, e.g. /__vgai/state/gemGame',
        'GET /__vgai/validation':
          'validate-on-save results for this project (failing: {} means clean)',
        'GET /__vgai/screenshot':
          'capture the live game canvas to <project>/.vgai/captures/<ts>.png and return its path',
        'POST /__editor/command': 'the full command relay (bridge-call, play, stop, select, …)',
      },
    });
  });

  // The edit→verify loop's other half: after writing a scene/manifest/asset
  // file, one cheap GET answers "was my last save accepted?" instead of
  // tailing the (detached) dev-server log. Same server-computed map
  // `/__editor/state` exposes as `projectValidation`, purpose-shaped.
  // PD-13: the same validation state, pre-formatted as `server-log` payloads
  // so a tab can PULL what it missed.
  //
  // `server-log` is a live broadcast and nothing replays it, but both maps are
  // routinely populated with no tab attached: the boot scan
  // (`validateSourceTree`, run from `startWatcher()` while the server is still
  // coming up) precedes every browser connection, and `runFileValidation`
  // deliberately re-broadcasts a warning only when its SET CHANGES. So the
  // terminal carried the R3F00x findings, `/__editor/state` carried them, and
  // the editor console — the third surface the project manual promises — was
  // empty. This is a GET rather than a write-on-SSE-connect because
  // `connectEvents()` hands back a SHARED, ref-counted EventSource: whichever
  // consumer opens it first wins the socket, so anything the server writes at
  // connect time can land before `connectServerLogs()` has attached its
  // listener (measured — the same race the tab-lifecycle listeners are
  // installed in-tick to avoid). A pull cannot race.
  //
  // The server stays the single formatter: these are byte-identical to the
  // live broadcast's payloads, so a replayed line and a live one render
  // through exactly one path in `editor-console.ts`.
  router.get('/__editor/validation-log', (_req: Request, res: Response) => {
    res.json({ entries: currentValidationLogEntries() });
  });

  router.get('/__vgai/validation', (_req: Request, res: Response) => {
    res.json({
      clean: projectValidation.size === 0,
      failing: Object.fromEntries(projectValidation),
      warnings: Object.fromEntries(projectWarnings),
      // PD-14: "was my last save accepted?" has a third answer — "nothing
      // under src/ was looked at". `clean: true` alone would be a lie while
      // this reads `'awaiting-src'`.
      sourceValidation: ctx.sourceValidation,
    });
  });

  router.get('/__vgai/state', async (_req: Request, res: Response) => {
    const result = await relayCommandResult({
      type: 'bridge-call',
      method: 'stateAll',
      callArgs: [],
    });
    const { status, body } = commandResponseFor(result, consoleLedger.summary());
    res.status(status).json(body);
  });

  router.get('/__vgai/state/:provider', async (req: Request, res: Response) => {
    const result = await relayCommandResult({
      type: 'bridge-call',
      method: 'state',
      callArgs: [req.params['provider']],
    });
    const { status, body } = commandResponseFor(result, consoleLedger.summary());
    res.status(status).json(body);
  });

  // Paths-not-blobs: the page hands back base64 over the relay
  // (`bridge-screenshot` — a pure "hand back the pixels" primitive), and THIS
  // side owns the filesystem, so the PNG lands under the project where the
  // agent's Read tool can open it without leaving the sandbox.
  router.get('/__vgai/screenshot', async (_req: Request, res: Response) => {
    if (ctx.projectRoot === engineRoot) {
      res.status(400).json({ ok: false, error: 'no project open' });
      return;
    }
    let result = await relayCommandResult({ type: 'bridge-screenshot' });
    // A starved host loop is not a dead end. The page refuses its provably
    // stale canvas with `BRIDGE_SCREENSHOT_STALE`
    // and names the recovery — but a poke surface has nobody to read the
    // sentence and no way to foreground a browser tab, so it takes the
    // recovery itself: one deterministic tick, captured, and stamped
    // `loopRecoveryFrame` in the response so the frame is never mistaken for
    // ordinary presentation. The refusal survives only if the refresh fails.
    if (!result.ok && result.data?.['code'] === 'BRIDGE_SCREENSHOT_STALE') {
      result = await relayCommandResult({ type: 'bridge-screenshot', refreshStarvedFrame: true });
    }
    if (!result.ok) {
      const { status, body } = commandResponseFor(result, consoleLedger.summary());
      res.status(status).json(body);
      return;
    }
    const base64 = result.data?.['base64'];
    if (typeof base64 !== 'string') {
      res.status(500).json({ ok: false, error: 'bridge-screenshot returned no image data' });
      return;
    }
    const capturesDir = join(ctx.projectRoot, '.vgai', 'captures');
    await mkdir(capturesDir, { recursive: true });
    const file = join(capturesDir, `capture-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
    await writeFile(file, Buffer.from(base64, 'base64'));
    // Paths-not-blobs means the caller never sees the pixels, so whatever the
    // pixels are worth has to travel as data: `flatness.warning` when the
    // frame is one flat surface, `loopRecoveryFrame` when it exists because we
    // ticked a starved runtime to make it.
    const flatness = result.data?.['flatness'] as { warning?: string } | undefined;
    res.json({
      ok: true,
      path: file,
      relativePath: relative(ctx.projectRoot, file),
      ...(flatness ? { flatness } : {}),
      ...(result.data?.['loopRecoveryFrame'] === true ? { loopRecoveryFrame: true } : {}),
      ...(typeof flatness?.warning === 'string' ? { warning: flatness.warning } : {}),
    });
  });
  // ---- Persistent editor state (.vgai/editor-state.json) ----
  router.get('/__editor/editor-state', async (_req: Request, res: Response) => {
    if (ctx.projectRoot === engineRoot) {
      res.json({});
      return;
    }
    try {
      const raw = await readFile(join(ctx.projectRoot, '.vgai', 'editor-state.json'), 'utf-8');
      res.json(JSON.parse(raw));
    } catch {
      res.json({});
    }
  });

  router.post('/__editor/editor-state', async (req: Request, res: Response) => {
    if (ctx.projectRoot === engineRoot) {
      res.status(400).json({ error: 'No project open.' });
      return;
    }
    try {
      const vgaiDir = join(ctx.projectRoot, '.vgai');
      await mkdir(vgaiDir, { recursive: true });
      await writeFile(
        join(vgaiDir, 'editor-state.json'),
        JSON.stringify(req.body, null, 2),
        'utf-8',
      );
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to save editor state.' });
    }
  });
}
