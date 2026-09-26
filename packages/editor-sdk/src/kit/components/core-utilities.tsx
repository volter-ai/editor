/**
 * The editor's built-in DRAWER utilities, registered through the same
 * W0 workspace-utility registry every other utility uses, so the utility
 * region is registry-driven end to end:
 *
 *  - **Console** (B3): always available; its error/warn count becomes the
 *    registry `badge()` in the open tab, plus the three standard level counts
 *    in the status line while the drawer is hidden.
 *    Ordinary log traffic never auto-opens the region; only actionable
 *    failures reveal it automatically (today: a world that failed to mount —
 *    `workspace-utility-commands.ts`).
 * Animation and state machines are deliberately absent: each is an authored
 * center document (animation inside its owning Asset Lab; an XState machine as
 * its own Machine document), not a global debugger drawer instrument.
 * The Profiler bench and State Watch are deliberately absent: both moved to
 * `@vgai/game` as the `profiler.utility` / `state-watch.utility`
 * contributions (WORKBENCH.md §The invariants — the host imports no package).
 * GENERATIONS is absent for the same reason: the paid-provider lane's gallery
 * is `@vgai/game`'s `generation.service.ts`, which registers the tab (badge and
 * all) through this same registry.
 * *
 * PROBLEMS (§4.1 mock's `Problems` tab) is deliberately NOT registered —
 * the W4 decision, recorded in the inventory: no truthful problem SOURCE
 * exists today (there is no in-editor typecheck surface; scene-validation
 * and mount failures already surface as console errors plus their own
 * status-bar items), and
 * §4.3's spirit forbids fabricating a surface with nothing real to feed it.
 * The status bar's console counters (`status-contributions.tsx`) read the
 * same real source — the truthful signal that does exist. A real Problems
 * utility lands when a real diagnostics source does.
 *
 * Idempotent-ensure idiom mirrors `build-documents.tsx`'s
 * `ensureBuildContributionsRegistered`.
 */

import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { createHmrRegistrationGroup, type HmrRegistrationContext } from '@volter/editor-sdk/kit/hmr-registration-group';
import { CORE_WORKSPACE_UTILITIES } from '@volter/editor-sdk/kit/workspace-core-utilities';
import {
  registerWorkspaceUtility,
  type WorkspaceUtilityBadge,
} from '@volter/editor-sdk/kit/workspace-utility-registry';
import { ConsolePanel } from './ConsolePanel';
import { LightExplorerPanel } from './LightExplorerPanel';

const registrationGroup = createHmrRegistrationGroup(
  // Vite's HMR context when a dev server serves this module; the SDK carries no bundler types.
  (import.meta as ImportMeta & { hot?: HmrRegistrationContext }).hot,
  'core-utilities',
);

/** The Console tab's attention badge: error count (error severity) else
 *  warn count (warn severity) else none. Exported for tests. */
export function consoleUtilityBadge(): WorkspaceUtilityBadge | null {
  const { error, warn } = editorConsole.counts;
  if (error > 0) return { count: error + warn, severity: 'error' };
  if (warn > 0) return { count: warn, severity: 'warn' };
  return null;
}

/** Idempotent one-time registration of the built-in workspace utilities. */
export function ensureCoreUtilitiesRegistered(): void {
  registrationGroup.ensure((track) => {
    track(
      registerWorkspaceUtility({
        ...CORE_WORKSPACE_UTILITIES.console,
        order: -100, // first utility tab, matching the §4.1 mock's tab order
        Content: ConsolePanel,
        badge: consoleUtilityBadge,
        subscribeBadge: editorConsole.subscribe,
        badgeSnapshot: editorConsole.getSnapshot,
        visibleByDefault: false,
        closeable: true,
      }),
    );
    track(
      // Scene-wide light inventory over the active authoring adapter's real
      // hierarchy + inspector fields. Closed by default and opened from the
      // viewport display toolbar or Window menu; no parallel light registry.
      registerWorkspaceUtility({
        ...CORE_WORKSPACE_UTILITIES.lightExplorer,
        order: 21,
        Content: LightExplorerPanel,
        visibleByDefault: false,
        closeable: true,
      }),
    );
  });
}

/** Test-only: allow re-registration after a registry reset. */
export function __resetCoreUtilitiesForTest(): void {
  registrationGroup.reset();
}
