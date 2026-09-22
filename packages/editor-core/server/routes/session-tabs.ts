/**
 * `/__editor/heartbeat`, the heartbeat worker script, `/__editor/tab/**` and
 * `/__editor/tab-yielded` — the TAB BIJECTION's HTTP surface.
 *
 * Per edited game, one and only one tab: extras yield, a lost tab self-heals,
 * shutdown closes it. These routes are deliberately trivial, because presence
 * has to keep working no matter what is wrong with the rest of the page — the
 * worker POSTs a beat whenever its own socket cannot carry one, and a yielded
 * tab lands on a static page rather than a running editor.
 *
 * The decisions all live in `tab-lifecycle.ts` and the control plane; this
 * module is the doorway.
 */

import type { Request, Response } from 'express';
import { renderEditorBrandPage } from '../editor-brand-html';
import type { EditorServerRouter } from '../editor-server';
import { allowCrossOriginFrameEmbedding } from '../server-utils';
import { readTabBootstrapSource, TAB_BOOTSTRAP_PATH } from '../tab-bootstrap';
import {
  parseBeat,
  parseTabClose,
  TAB_CLOSE_PATH,
  TAB_HEARTBEAT_WORKER_PATH,
  TAB_HEARTBEAT_WORKER_SOURCE,
} from '../tab-heartbeat';
import type { RouteContext } from './context';
import type { ControlPlane } from './control-plane';

export function registerSessionTabRoutes(
  router: EditorServerRouter,
  ctx: RouteContext,
  plane: ControlPlane,
): void {
  const { hostTabLifecycle, participantTabLifecycles, tabBijectionOptions, trustedShareIdentity } =
    ctx;
  const { handleTabRoute } = plane;

  // ---- The tab bootstrap (tab-bootstrap.ts) ----
  //
  // What makes a PAGE a TAB, for a page vgai does not author: the Code-OSS
  // frame loads this exact script — index.html's own inline bootstrap, read
  // out of index.html, never copied — and from there it mints an identity,
  // beats, and departs like any other tab. See tab-bootstrap.ts's header.
  router.get(TAB_BOOTSTRAP_PATH, (_req: Request, res: Response) => {
    let source: string;
    try {
      source = readTabBootstrapSource();
    } catch (error) {
      // A frame that cannot get this script is a tab that never beats, so the
      // failure is stated in the body the page will have in its console —
      // never an empty 200 that looks like it worked.
      res.status(500).type('text/plain').send(String(error));
      return;
    }
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    // Never cached, for the heartbeat worker's reason and one more: Electron's
    // HTTP cache is what made a desktop page straddle two module generations
    // (docs/CODE-OSS.md §Desktop traps), and the bootstrap is the one script
    // whose staleness the session cannot detect.
    res.setHeader('Cache-Control', 'no-store');
    allowCrossOriginFrameEmbedding(res);
    res.send(source);
  });

  // ---- The tab heartbeat (tab-heartbeat.ts) ----
  //
  // The worker script, and the POST the worker falls back to whenever its own
  // socket cannot carry a beat. Both are deliberately trivial: presence must
  // survive whatever is wrong with the rest of the page.
  router.get(TAB_HEARTBEAT_WORKER_PATH, (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    // Never cached: a stale worker is a tab that beats a protocol the server
    // has moved on from, and the file is under 4 KB.
    res.setHeader('Cache-Control', 'no-store');
    allowCrossOriginFrameEmbedding(res);
    res.send(TAB_HEARTBEAT_WORKER_SOURCE);
  });

  router.post('/__editor/heartbeat', (req: Request, res: Response) => {
    const beat = parseBeat(req.body);
    if (beat === null) {
      res.status(400).json({ error: 'heartbeat requires { tabId, epoch, seq, visibility }' });
      return;
    }
    res.json({ reply: hostTabLifecycle.onBeat(beat) });
  });

  // THE PAGE'S GOODBYE. `pagehide` → `navigator.sendBeacon`, which is the one
  // transport the browser promises to deliver for a document that is already
  // gone — so this route must do nothing but record and answer. It is what
  // lets the table say `closed`/`reloading` where it could previously only
  // watch the beats stop and call it `crashed`. No response body: a beacon's
  // sender is gone and cannot read one.
  router.post(TAB_CLOSE_PATH, (req: Request, res: Response) => {
    const beacon = parseTabClose(req.body);
    if (beacon === null) {
      res.status(400).json({ error: 'tab close requires { tabId, epoch }' });
      return;
    }
    hostTabLifecycle.onTabClose(beacon);
    for (const lifecycle of participantTabLifecycles.values()) lifecycle?.onTabClose(beacon);
    res.status(204).end();
  });

  // ---- Tab bijection (one browser tab per edited game — tab-lifecycle.ts) ----
  //
  // POST /__editor/tab/ensure — `vgai edit`/`create`'s idempotent
  // convergence: focus/retarget the blessed tab, wait for an arriving one,
  // or open exactly one. `{ open: false }` (the caller's --no-open) never
  // opens. When bijection is off for this session, answer honestly from the
  // raw SSE count so the CLI can decide for itself.
  router.post('/__editor/tab/ensure', (req: Request, res: Response) => {
    const open = (req.body as { open?: unknown } | undefined)?.['open'] !== false;
    if (!tabBijectionOptions) {
      // Bijection is off for this session, but the TABLE still knows whether
      // a tab is here — answer from it, not from a socket count.
      res.json({
        status: hostTabLifecycle.blessedTabId() !== null ? 'focused' : 'disabled',
      });
      return;
    }
    res.json({ status: hostTabLifecycle.ensure(open) });
  });

  // POST /__editor/tab/route — the page saying which surface it is showing
  // ('project' = the editor on this session's project; 'no-project' = the
  // launcher or the startup-failure surface). A launcher tab holds the same
  // SSE connection as an editor tab, so the bijection SEES it (before this it
  // held none at all, and the lifecycle happily opened a second tab beside a
  // perfectly good one); the route is what keeps `ensure` honest about
  // whether that tab is on the project yet.
  router.post('/__editor/tab/route', (req: Request, res: Response) => {
    const outcome = handleTabRoute(
      (req.body ?? {}) as Record<string, unknown>,
      trustedShareIdentity(req),
    );
    if (outcome.status === 200) res.json({ ok: true });
    else res.status(outcome.status).json({ error: outcome.error });
  });

  // POST /__editor/tab/claim — the yield page's "Use here instead": the
  // current blessed tab is told to yield; the claimant reloads `/` and its
  // fresh connection takes the blessing.
  router.post('/__editor/tab/claim', (req: Request, res: Response) => {
    const claimedParticipantId = (req.body as { participantId?: unknown } | undefined)
      ?.participantId;
    const trusted = trustedShareIdentity(req);
    if (
      trusted &&
      typeof claimedParticipantId === 'string' &&
      trusted.participantId !== claimedParticipantId
    ) {
      res.status(403).json({ error: 'A shared tab can only claim its own participant.' });
      return;
    }
    const participantId = trusted?.participantId ?? claimedParticipantId;
    const lifecycle =
      typeof participantId === 'string'
        ? participantTabLifecycles.get(participantId)
        : trusted
          ? undefined
          : hostTabLifecycle;
    lifecycle?.claim();
    res.json({ ok: true });
  });

  // POST /__editor/tab/expect-restart — a successor server is about to take
  // this port (source-change restart): keep the tab, it will reconnect.
  router.post('/__editor/tab/expect-restart', (_req: Request, res: Response) => {
    for (const lifecycle of new Set([hostTabLifecycle, ...participantTabLifecycles.values()])) {
      lifecycle?.expectRestart();
    }
    res.json({ ok: true });
  });

  // GET /__editor/tab-yielded — the static page a yielded tab lands on when
  // `window.close()` is refused (user-opened tabs). Minimal on purpose: the
  // editor must never RUN in two tabs for one session.
  router.get('/__editor/tab-yielded', (_req: Request, res: Response) => {
    res.type('html').send(
      renderEditorBrandPage({
        subject: 'Editor open in another tab',
        description: 'This Volter Editor session is active in another browser tab.',
        contentHtml:
          "<h1>Editor open in another tab</h1><p>This game's editor is active elsewhere.</p>" +
          '<button id="claim">Use here instead</button>',
        scriptHtml:
          'document.getElementById("claim").addEventListener("click",async()=>{' +
          'const participantId=new URLSearchParams(location.search).get("participantId");' +
          'try{await fetch("/__editor/tab/claim",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({participantId})})}catch{}' +
          'location.replace("/")});',
      }),
    );
  });
}
