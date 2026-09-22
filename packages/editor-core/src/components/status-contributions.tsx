/**
 * The editor's core STATUS-BAR contributions (inventory rows H3/V9/V12 +
 * the §4.1 mock's `0 errors | Play stopped | localhost:5187`):
 *
 *  - `save-status` (H3): moved out of the global command header. Success is
 *    silent; `Unsaved` appears when actionable (click saves — the one
 *    deliberate command-shaped exception, kept because the retry affordance
 *    must live where the state is shown). There is no `Save failed` state:
 *    `PersistenceProvider` exposes no failure signal, so nothing could set
 *    one truthfully (see `authoring/shell-document-ops.ts`).
 *  - `console-counts` (V12's count half): the truthful message/warning/error
 *    signals that exist today (scene-validation failures, engine/server
 *    errors all land there). There is NO separate
 *    Problems source (no in-editor typecheck surface), so no fabricated
 *    `N problems` — see `core-utilities.tsx`'s recorded Problems decision.
 *  - `mount-failure`: a manifest world that did not mount at all. Sticky
 *    (a dead world stays dead until it is fixed) and danger-toned, naming
 *    every failed world in its title and opening the Console — which the
 *    auto-open policy has already revealed — on click.
 *  - `asset-materialization`: a declared starter-pack asset that did not
 *    download, carrying D-AP4's Retry affordance.
 *
 * The last two used to be full-width red BANNERS across the top of the shell
 * (`DefaultEditorLayout`'s since-deleted `.vgai-shell-banners` strip). Two
 * error homes means users learn two places to look, so both now present
 * here — the editor's one error surface: console line + bottom-left status
 * item + a revealed Console utility.
 *  - `play-state`: §4.1 "Play stopped" / "Playing" / "Paused".
 *  - `connection` (V9): compact connection state WHILE a networking
 *    adapter is active (the §5 rule) — detailed room/replication info
 *    opens the Debugger's Network view.
 *  - `example-lesson` (right, G6): "This example has a lesson →" while a
 *    bundled example is open read-only and its FT-5 `learn.lesson` URL is
 *    set; nothing otherwise.
 *
 * `build-progress` (B4/B15) is registered by `build-documents.tsx` (server
 * mode) — the W3 contribution this bar finally renders.
 */

import {
  faCircleInfo,
  faExclamationTriangle,
  faTimesCircle,
} from '@fortawesome/free-solid-svg-icons';
import { Button, EditorIcon, editorIcons } from '@volter/editor-sdk/widgets';
import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  type AssetMaterializationFailure,
  getAssetMaterializationFailures,
  retryAssetMaterialization,
  subscribeToAssetMaterializationFailures,
} from '../asset-workflow/asset-materialization-report';
import {
  getMountFailureReports,
  type MountFailureReport,
  subscribeToMountFailures,
} from '../authoring/mount-failure-report';
import { editorConsole } from '../editor-console';
import {
  editorLeaseView,
  editorLeaseViewVersion,
  subscribeEditorLeaseView,
} from '../editor-lease-view';
import { useEditorStore } from '../editor-runtime';
import { createHmrRegistrationGroup } from '../hmr-registration-group';
import { useProjectMounts } from '../project-shape';
import { getStorageBackend } from '../storage';
import { showWorkspaceUtility } from '../workspace-host-commands';
import { registerWorkspaceStatus } from '../workspace-status-registry';
import { showConsoleUtility } from '../workspace-utility-commands';
import {
  availableWorkspaceUtilities,
  subscribeWorkspaceUtilities,
  workspaceUtilityRegistryVersion,
} from '../workspace-utility-registry';
import { SaveStatus } from './SaveStatus';

/** Standard console counters remain visible when the drawer is closed. */
export function ErrorCountStatus() {
  useSyncExternalStore(editorConsole.subscribe, editorConsole.getSnapshot);
  const counts = editorConsole.counts;
  const levels = [
    { id: 'info', icon: faCircleInfo, label: 'message', count: counts.info },
    { id: 'warn', icon: faExclamationTriangle, label: 'warning', count: counts.warn },
    { id: 'error', icon: faTimesCircle, label: 'error', count: counts.error },
  ] as const;
  return (
    <span className="vgai-console-status-counts" data-testid="status-console-counts">
      {levels.map((level) => (
        <Button
          key={level.id}
          type="button"
          variant="ghost"
          size="compact"
          className="vgai-status-action vgai-console-status-count"
          data-testid={`status-console-${level.id}`}
          data-console-level={level.id}
          data-has-count={level.count > 0 ? true : undefined}
          data-has-errors={level.id === 'error' && level.count > 0 ? true : undefined}
          onClick={() => showConsoleUtility()}
          title={`${level.count} console ${level.label}${level.count === 1 ? '' : 's'} — open Console`}
        >
          <EditorIcon icon={level.icon} size="xs" />
          {level.count}
        </Button>
      ))}
    </span>
  );
}

/**
 * One line per failed world, carrying exactly what the deleted banner showed:
 * the root id, its substrate/adapter identity and the caught error message.
 * Exported so the item's information content is assertable without reading a
 * DOM attribute transcript.
 */
export function formatMountFailureTitle(reports: readonly MountFailureReport[]): string {
  const lines = reports.map(
    (report) => `"${report.worldId}" (${report.kind} / ${report.identity}) — ${report.message}`,
  );
  return [...lines, 'See the Console for the full trace.'].join('\n');
}

/**
 * A manifest world that failed to mount at all — sticky until the world
 * mounts successfully (`clearMountFailureReport`) or the whole attempt
 * resets (`clearMountFailureReports`). Nothing to dismiss by hand: the item
 * is the shell's compact problem signal, and hiding it would also blank the
 * report `vgai status` reads.
 */
export function MountFailureStatus() {
  const reports = useSyncExternalStore(subscribeToMountFailures, getMountFailureReports);
  if (reports.length === 0) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="compact"
      className="vgai-status-action"
      data-testid="status-mount-failure"
      data-status-tone="danger"
      onClick={() => showConsoleUtility()}
      title={formatMountFailureTitle(reports)}
    >
      {reports.length === 1
        ? '1 world failed to mount'
        : `${reports.length} worlds failed to mount`}
    </Button>
  );
}

/** One line per entry, matching the console line's subject/reason pair. */
export function formatAssetMaterializationTitle(
  failures: readonly AssetMaterializationFailure[],
): string {
  const lines = failures.map((failure) => `${failure.dest} — ${failure.reason}`);
  return [
    ...lines,
    'Nothing was written for them, so features that read those files degrade.',
    'See the Console (subsystem `assets`) for the full lines.',
  ].join('\n');
}

/**
 * D-AP4's "editor console + status surface with a retry affordance": a
 * declared starter-pack asset that did not download. Unlike a mount failure
 * this one is RECOVERABLE (usually a dead network), so it keeps Retry —
 * `retryAssetMaterialization` reports its own outcome through the same slot,
 * so success clears this item by itself.
 */
export function AssetMaterializationStatus() {
  const failures = useSyncExternalStore(
    subscribeToAssetMaterializationFailures,
    getAssetMaterializationFailures,
  );
  const [retrying, setRetrying] = useState(false);
  const onRetry = useCallback(() => {
    setRetrying(true);
    void retryAssetMaterialization(getStorageBackend()).finally(() => setRetrying(false));
  }, []);

  if (failures.length === 0) return null;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="compact"
        className="vgai-status-action"
        data-testid="status-asset-materialization"
        data-status-tone="danger"
        onClick={() => showConsoleUtility()}
        title={formatAssetMaterializationTitle(failures)}
      >
        {failures.length === 1
          ? '1 starter asset did not download'
          : `${failures.length} starter assets did not download`}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="compact"
        className="vgai-status-action"
        data-testid="status-asset-materialization-retry"
        disabled={retrying}
        onClick={onRetry}
      >
        {retrying ? 'Retrying…' : 'Retry'}
      </Button>
    </>
  );
}

/** §4.1 play state ("Play stopped" quiet; running/paused colored). */
export function PlayStateStatus() {
  // EVERY hook above the first early return. This component rendered one hook
  // before the project's mounts resolved and three after, so React tore the
  // whole editor chrome down with "Rendered more hooks than during the
  // previous render" on any project whose mounts resolve asynchronously —
  // which is every scaffold the moment it declares a root (found 2026-09-19
  // by a contributor's first session, not by us).
  const mounts = useProjectMounts();
  const store = useEditorStore();
  useSyncExternalStore(store.subscribe, store.getShellSnapshot ?? store.getSnapshot);
  if (!mounts) return null;
  const state = store.playState;
  const view = {
    stopped: { label: 'Play stopped', tone: undefined },
    playing: { label: 'Playing', tone: 'success' },
    paused: { label: 'Paused', tone: 'warning' },
  }[state];
  return (
    <span
      className="vgai-status-copy"
      data-testid="status-play-state"
      data-play-state={state}
      data-status-tone={view.tone}
    >
      {view.label}
    </span>
  );
}

/** Compact connection state while a NetworkingAdapter is active (V9);
 *  renders nothing otherwise — single-player sessions register none. */
/** The editor's OWN connection — VS Code's remote indicator, far left: quiet
 *  while served, a warning while the server is slow, red when it is gone.
 *  Click reloads once a server answers here again. */
export function EditorServerStatus() {
  useSyncExternalStore(subscribeEditorLeaseView, editorLeaseViewVersion, editorLeaseViewVersion);
  const view = editorLeaseView();
  if (view.kind === 'quiet') return null;
  const tone = view.kind === 'void' ? 'error' : 'warning';
  const label =
    view.kind === 'void'
      ? view.reason === 'taken-over'
        ? 'Editor yielded'
        : 'Editor disconnected'
      : view.subject === 'busy'
        ? 'Editor slow'
        : 'Editor stale';
  return (
    <Button
      type="button"
      variant="ghost"
      size="compact"
      className="vgai-status-action"
      data-testid="status-editor-lease"
      data-lease-state={view.kind}
      data-tone={tone}
      onClick={() => window.location.reload()}
      title={
        view.kind === 'void' && view.reloadOffered
          ? 'The editor is served here again — reload'
          : 'The editor server is not answering — reload once it is served here again'
      }
    >
      <EditorIcon icon={tone === 'error' ? editorIcons.status.error : editorIcons.status.warning} />{' '}
      {label}
    </Button>
  );
}

// `AssetImportStatus` stood here until phase 1 unit 21. Its ledger's only
// writers are the online catalog's browser and its detail view, and the
// status registry it filled is a CONTRIBUTION point — so the item registers
// from `@vgai/asset-library` now, beside the progress-event connection that
// feeds it.

/**
 * One chip per PROJECT-contributed drawer utility (the `tool:*` cluster) —
 * the same click-to-open affordance the Console counts teach, for the game's
 * own faces. Measured gap (owner report, 2026-08-21): a game's Analytics tab
 * registered hidden in the drawer with no visible button anywhere — the
 * Tools menu carried the only entry, and nobody found it. A face doctrine
 * calls "the build's progress meter" must have a standing door on screen.
 * Null when the open project contributes none.
 */
export function ProjectUtilitiesStatus() {
  useSyncExternalStore(subscribeWorkspaceUtilities, workspaceUtilityRegistryVersion);
  const project = availableWorkspaceUtilities().filter((u) => u.section === 'project');
  if (project.length === 0) return null;
  return (
    <>
      {project.map((u) => (
        <Button
          key={u.id}
          type="button"
          variant="ghost"
          size="compact"
          className="vgai-status-action"
          data-testid={`status-project-utility-${u.id}`}
          onClick={() => showWorkspaceUtility(u.id)}
          title={`Open the ${u.title} drawer tab (this project's own face)`}
        >
          {u.title}
        </Button>
      ))}
    </>
  );
}

const registrationGroup = createHmrRegistrationGroup(import.meta.hot, 'core-status-contributions');

/** Idempotent one-time registration of the core status contributions
 *  (same ensure idiom as `ensureBuildContributionsRegistered`). */
export function ensureCoreStatusContributionsRegistered(): void {
  registrationGroup.ensure((track) => {
    track(
      registerWorkspaceStatus({
        id: 'editor-lease',
        name: 'Editor server',
        align: 'left',
        order: -90,
        Content: EditorServerStatus,
      }),
    );
    track(
      registerWorkspaceStatus({
        id: 'save-status',
        name: 'Save state',
        align: 'left',
        order: 0,
        Content: SaveStatus,
      }),
    );
    track(
      registerWorkspaceStatus({
        id: 'console-counts',
        name: 'Console errors and warnings',
        align: 'left',
        order: 10,
        Content: ErrorCountStatus,
      }),
    );
    // The two failure items sit either side of the console counts — same
    // neighbourhood as the counts they contribute to, ahead of play state.
    track(
      registerWorkspaceStatus({
        id: 'mount-failure',
        name: 'Mount failure',
        align: 'left',
        order: 5,
        Content: MountFailureStatus,
      }),
    );
    track(
      registerWorkspaceStatus({
        id: 'asset-materialization',
        name: 'Asset materialization',
        align: 'left',
        order: 15,
        Content: AssetMaterializationStatus,
      }),
    );
    track(
      registerWorkspaceStatus({
        id: 'play-state',
        name: 'Play state',
        align: 'left',
        order: 20,
        Content: PlayStateStatus,
      }),
    );
    track(
      registerWorkspaceStatus({
        id: 'project-utilities',
        name: 'Project utilities',
        align: 'left',
        order: 25,
        Content: ProjectUtilitiesStatus,
      }),
    );
    // `build-progress` (build-documents.tsx) registers with order 0/default
    // and a later sequence, so it lands after `save-status` among the order-0
    // items — visually beside the session state it extends.
  });
}

/** Test-only: allow re-registration after a registry reset. */
export function __resetCoreStatusContributionsForTest(): void {
  registrationGroup.reset();
}
