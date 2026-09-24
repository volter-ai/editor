/**
 * How a host constructs an editor server, and the one message every caller
 * gets when a relayed command finds no browser tab.
 *
 * Two hosts build this object — `dev.ts` and `packaged.ts` — and what differs
 * between them IS this interface. It lives beside the factory rather than
 * inside it so the differences can be read in one place.
 */

import { commandLine } from '../src/product-command';
import type { EditorState } from '@volter/editor-sdk/index';
import type { CollaborationAccountSession } from './account-service';
import type { EditorBootTimings } from './boot-timings';
import type { ProjectModuleLoader } from './project-tools';

export interface EditorServerOptions {
  /** Absolute path to the editor/engine repo root (for build scripts + artifacts). */
  engineRoot: string;
  /** Initial project path (optional — can be set later via open-project endpoint). */
  projectPath?: string | undefined;
  /**
   * Does THIS host serve the `/__ui-source/*` source-write endpoints?
   *
   * Reported verbatim as `/__editor/project`'s `sourceWrite`, which is what the
   * editor client reads to decide whether an authoring edit is RECORDED to the
   * game's own source or is honestly live-only
   * (`src/ui-source/tier-source-write-backend.ts`). Hosts that boot a Vite
   * instance derive it from their own resolved plugin list
   * (`servesUiSourceRoutes`, `vite-plugin-ui-oid.ts`) rather than declaring it,
   * so the flag cannot drift from the registration it describes.
   *
   * Defaults to `false`: a bare router with no Vite in front of it carries no
   * recorder, and the honest answer for an unstated host is "no write path",
   * never an assumed one.
   */
  sourceWriteRoutes?: boolean | undefined;
  /**
   * The ingest lane's half of the same question: does THIS host serve the
   * `/__ingest-source/*` ownership + write routes?
   *
   * Reported verbatim as `/__editor/project`'s `ingestSourceWrite`. A separate
   * boolean from `sourceWriteRoutes` because it is a separate PLUGIN
   * (`servesIngestSourceRoutes`, `vite-plugin-creation-site-write.ts`) — the two
   * happen to travel together on every Vite host today, and collapsing them
   * into one flag would be the second declaration this pair exists to avoid.
   * Same `false` default, for the same reason.
   */
  ingestSourceWriteRoutes?: boolean | undefined;
  /** Loopback port owned by this editor process. Enables its private share host. */
  collaborationPort?: number | undefined;
  /** Focused tests may supply a verified account authority without public OAuth. */
  collaborationAccountSession?: (() => Promise<CollaborationAccountSession>) | undefined;
  /** Focused request-boundary tests may make gateway claim signatures deterministic. */
  shareGatewaySecret?: string | undefined;
  /** Called when a project is opened at runtime — allows the host to update
   * Vite's serving boundary and finish any project-specific preparation that
   * must precede the one intentional editor reload. */
  onProjectOpened?: ((projectPath: string) => void | Promise<void>) | undefined;
  /**
   * The import URL THIS host serves `packages/editor/src/frame/bridge.tsx` at —
   * the editor's entry point under the Code-OSS frame.
   *
   * The one caller is `/__editor/served-modules` (routes/served-modules.ts),
   * which is what the fork's contribution asks before it imports the editor.
   * Supplied by the hosts that own a bundler, because only they know how the
   * editor reaches the browser here: `dev.ts` answers the module's own path in
   * its Vite graph, `packaged.ts` answers the built entry of the editor's
   * production build. Omitted by a bare router, which then refuses by name
   * rather than answering an empty list a frame would read as "no bridge
   * declared".
   *
   * THROWING IS AN ANSWER. A host that can serve a bridge in principle but
   * cannot find one (a `dist/` cut before the frame entry existed) throws with
   * the command that fixes it, and the route relays that sentence as the
   * refusal — the frame's own error then names the real cause instead of a
   * missing file two layers down.
   */
  frameBridgeUrl?: (() => string | null) | undefined;
  /**
   * The PRODUCT this session is serving, or `null` when it is serving none.
   * Read on every `/__editor/state`, a THUNK for the same reason
   * {@link workbench} is one: `open-project` can switch the project under a
   * live session, and which product opens it is a fact about the project.
   *
   * `vgai status` prints it on the workbench's line: the two together are what
   * the running product IS — this code, in that workbench.
   */
  product?: (() => EditorState['product']) | undefined;
  /**
   * The Code-OSS workbench this session is running, or `null` while it is not
   * running one. Read on every `/__editor/state` — a THUNK rather than a value
   * because the workbench boots after this router is built, and a snapshot
   * taken here would report `null` forever.
   *
   * The session's children are the session's to report, exactly as its run
   * configurations are (`routes/configurations.ts`). `vgai status` prints it.
   */
  workbench?: (() => EditorState['workbench']) | undefined;
  /** Dev checkout only: mark this long-running process stale when server-loaded source changes. */
  watchEngineSource?: boolean | undefined;
  /**
   * The host's own boot spans, journaled as ONE `boot` row when the first page
   * proves it is running the editor document — the honest end of the wait
   * between "Editor ready at" and a usable editor. Optional because only a
   * host that MEASURED its boot has an answer; a host that omits it writes no
   * row. See `boot-timings.ts`.
   */
  bootTimings?: (() => EditorBootTimings | null) | undefined;
  /** Focused tests may shrink the delivery-receipt window (defaults to
   * `RELAY_DELIVERY_ACK_MS`) so the expiry paths run in milliseconds instead
   * of standing through the real 8s window. */
  relayDeliveryAckMs?: number | undefined;
  /** Focused tests may shrink the live-socket receipt ceiling (defaults to
   * `RELAY_DELIVERY_MAX_WAIT_MS`) for the same reason. */
  relayDeliveryMaxWaitMs?: number | undefined;
  /** Dev-host lifecycle hook fired once when watched checkout source first
   * makes this Node process stale. The ordinary CLI uses it to replace the
   * process; embedded/test hosts may omit it and retain the loud handshake. */
  onEngineSourceStale?: ((change: { changedPath: string; changedAt: string }) => void) | undefined;
  /** Node-side project-module loader. Vite's ssrLoadModule supplies this in
   * dev and packaged editors so discoverable project tools can remain
   * ordinary TypeScript using the project's own dependency graph. */
  loadProjectModule?: ProjectModuleLoader | undefined;
  /**
   * Drop everything the Node module lane has cached for the open project.
   * Supplied by the bundler-owning hosts as
   * `vite.environments.ssr.moduleGraph.invalidateAll()`; the editor calls it
   * when the project's dependency manifests move, so a package installed under
   * a LIVE session (`vgai add <capability>`, or a hand-run `npm install`) is
   * visible to the very next tool call. Without it, Vite's SSR module runner
   * replays the rejected load forever — see
   * `project-dependency-invalidation.ts` for the measured mechanism.
   */
  invalidateProjectModules?: (() => void) | undefined;
  /** Tests/embedded hosts may isolate launcher history from the user's home. */
  recentProjectsPath?: string | undefined;
  /**
   * Does this session write the PERSON's launcher memory (recent projects)?
   * Defaults to `writesRecentProjects()` — false for an ephemeral probe or a
   * headless (`VGAI_NO_OPEN`) session, which has no human at a launcher. See
   * that predicate's doc comment for why an agent's transient
   * session must not seed the owner's Recents.
   */
  recordsRecentProjects?: boolean | undefined;
  /** Same isolation for the user-global launcher preferences (G5). */
  launcherSettingsPath?: string | undefined;
  /**
   * Tab-bijection maintenance (see tab-lifecycle.ts): one blessed browser tab
   * per session — duplicates yield, a lost tab self-heals, shutdown closes it.
   * Omitted (or `enabled: false`) for headless sessions (`--no-open` /
   * `VGAI_NO_OPEN`), embedded hosts, and test servers — that disables the
   * WHOLE loop for the session, not just the first open.
   */
  tabBijection?:
    | {
        enabled: boolean;
        /** The URL the session's one tab shows (and the one auto-open opens). */
        editorUrl: string;
        /** Injectable browser hand-off (tests); defaults to the platform opener. */
        openUrl?: ((url: string) => void) | undefined;
      }
    | undefined;
}

/**
 * What a caller is told when a relayed command finds NO browser tab on this
 * session — every rasterizing lane (`vgai screenshot`, story/asset/module
 * previews), every play control, every inspect.
 *
 * A live server with no tab is a state a person cannot see and a session list
 * cannot show: `vgai sessions` reports the session, `vgai edit` reports it
 * ready, and the capture then fails for a reason none of that mentions. So the
 * message names the missing TAB (not the session), the URL that fixes it, and —
 * when the session was launched headless — that fact, since a `--no-open`
 * session never opens or self-heals a tab at all and no amount of retrying
 * changes that.
 */
export function noEditorConnectedMessage(
  tabBijection: { enabled: boolean; editorUrl: string } | undefined,
): string {
  const url = tabBijection?.editorUrl;
  const open = url ? `Open ${url} in a browser` : 'Open this editor in a browser tab';
  if (tabBijection?.enabled === true) {
    return `No editor connected — this session has no browser tab attached. ${open} (or run ${commandLine('edit')} for this project, which converges on its one tab), then retry.`;
  }
  return (
    'No editor connected — this session runs headless (--no-open / VGAI_NO_OPEN), so it never ' +
    `opens or maintains a browser tab, and a relayed command needs one. ${open}, or restart ` +
    `the session with ${commandLine('edit')} (no --no-open), then retry.`
  );
}
