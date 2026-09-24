/**
 * Project manager — manages the active game project.
 *
 * How the editor learns which project is open depends on the surface, and the
 * split is the whole point:
 *
 *  - LOCAL (server-backed) — it ASKS the server. The editor server holds
 *    "which project is open" as session state, re-rooted live by
 *    `POST /__editor/open-project` (the project browser, `vgai edit <path>`).
 *    The URL carries no project identity at all, so a
 *    refresh or a tab-heal navigation back to the bare origin lands in the
 *    same project — a VS Code window, not a deep link. A `?project=` on a
 *    local URL is a loud boot error (`assertNoRemovedBootParams`).
 *
 * Sibling deep-link param (the §6 contract):
 * `?create-from=<templateOrExampleId>` — handled at AppRoot's routing layer,
 * NOT here. When no explicit project target wins, it opens the
 * hub's New Project wizard with that template/example preselected and the name
 * field focused (invalid ids degrade to the default selection plus a
 * non-blocking notice). An explicit project target always takes precedence.
 *
 * Boot precedence (§5/FT-7, unit G5) is decided by `boot-routing.ts`'s pure
 * `resolveBootTarget` and merely EXECUTED here: explicit target → opted-in
 * reopen-last → hub. `?hub=1` forces the hub, and a reopen-last project that
 * fails to open falls back to the hub rather than trapping the user.
 */

import { assertProjectCompatibility } from '@volter/editor-sdk/session/editor-compatibility';
import { hasRootOnSurface } from '@volter/editor-project/adapter/manifest-interpreter';
import { loadGameManifest } from '@volter/editor-project/manifest/load';
import { type ActiveProject, assignActiveProject, type ProjectConfig } from '@volter/editor-sdk/kit/active-project';
import {
  assertNoRemovedBootParams,
  decideServerProjectBoot,
  describeServerProjectFailure,
  hubRequestedFromSearch,
  resolveBootTarget,
  ServerProjectDetectionError,
} from './boot-routing';
import {
  getLauncherSettings,
  listRecentProjects,
  probeCurrentServerProject,
  requireEditorCompatibility,
} from './editor-api';
import { parseHierarchyProjection } from '@volter/editor-sdk/kit/hierarchy-projection';

function describeManifestError(error: unknown): string {
  const issues =
    error && typeof error === 'object' && Array.isArray((error as { issues?: unknown }).issues)
      ? (error as { issues: unknown[] }).issues
      : null;
  if (!issues) return error instanceof Error ? error.message : String(error);

  return issues
    .map((issue) => {
      if (!issue || typeof issue !== 'object') return String(issue);
      const candidate = issue as { path?: unknown; message?: unknown };
      const path = Array.isArray(candidate.path)
        ? candidate.path.map(String).join('.') || '(root)'
        : '(root)';
      const message =
        typeof candidate.message === 'string' ? candidate.message : 'Invalid manifest value';
      return `${path}: ${message}`;
    })
    .join('\n');
}

/** Open a project by its root path. Fetches the sole v2 project manifest. */
export async function openProject(rootPath: string): Promise<ActiveProject> {
  const compatibility = await requireEditorCompatibility();
  const res = await fetch('/vgai.project.json');
  if (!res.ok) {
    throw new Error(
      `Could not open project at ${rootPath}.\n` +
        `Failed to load vgai.project.json: ${res.status} ${res.statusText}`,
    );
  }
  let rawManifest: unknown;
  try {
    rawManifest = await res.json();
  } catch (error) {
    throw new Error(
      `Could not open project at ${rootPath}.\n` +
        `vgai.project.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  assertProjectCompatibility(
    rawManifest && typeof rawManifest === 'object'
      ? (rawManifest as {
          manifestVersion?: unknown;
          engine?: { version?: unknown };
          roots?: unknown;
        })
      : {},
    compatibility,
  );
  let manifest: ReturnType<typeof loadGameManifest>;
  try {
    manifest = loadGameManifest(rawManifest, { configurationKinds: 'defer' });
  } catch (error) {
    throw new Error(
      `Could not open project at ${rootPath}.\n` +
        `vgai.project.json does not match the current project format:\n${describeManifestError(error)}`,
    );
  }
  const config: ProjectConfig = {
    manifestVersion: manifest.manifestVersion,
    name: manifest.name,
    version: manifest.version,
    engine: manifest.engine,
    appId: manifest.appId,
    resolution: manifest.resolution,
    authoring: manifest.authoring
      ? { hierarchy: parseHierarchyProjection(manifest.authoring.hierarchy) }
      : undefined,
    hasThreeRoot: hasRootOnSurface(manifest, 'three'),
    rootCount: manifest.roots.length,
    configurations: manifest.configurations,
  };
  return assignActiveProject({ rootPath, config });
}

/** How many times boot may re-ask a server that failed to answer at all, and
 *  how long it waits between tries. Both small: `detectProject` runs inside
 *  AppRoot's detection timeout, and a failing fetch fails fast. */
export const SERVER_PROJECT_PROBE_ATTEMPTS = 3;
export const SERVER_PROJECT_PROBE_RETRY_MS = 300;

/**
 * Detect and open whatever project the server currently has active.
 * Used in production where __VGAI_PROJECT_PATH__ isn't available at build time.
 *
 * Returns null ONLY when the server said it has no project open — that is the
 * one answer the launcher is a truthful response to. A server that is serving
 * a project it cannot describe, or that could not be asked at all, THROWS
 * (after bounded retries for the transient shape), because rendering the
 * launcher there tells the user their project does not exist when it does.
 * The ladder itself is `boot-routing.ts`'s `decideServerProjectBoot`.
 */
export async function detectServerProject(): Promise<ActiveProject | null> {
  const compatibility = await requireEditorCompatibility();
  for (let attempt = 1; ; attempt++) {
    const probe = await probeCurrentServerProject();
    const action = decideServerProjectBoot({
      status: probe.status,
      attempt,
      maxAttempts: SERVER_PROJECT_PROBE_ATTEMPTS,
    });
    if (action === 'continue-ladder') return null;
    if (action === 'open' && probe.status === 'project') {
      const info = probe.project;
      assertProjectCompatibility(info.config, compatibility);
      return assignActiveProject({ rootPath: info.path, config: info.config as ProjectConfig });
    }
    if (action === 'retry') {
      await new Promise((resolve) => setTimeout(resolve, SERVER_PROJECT_PROBE_RETRY_MS));
      continue;
    }
    // 'fail' is only reachable from the two failure shapes, and the surface
    // that renders this must name the served path and the server's own error
    // separately — a launcher with a banner is what this fix exists to stop.
    throw new ServerProjectDetectionError(
      describeServerProjectFailure(
        probe.status === 'unreadable'
          ? { status: 'unreadable', path: probe.path, error: probe.error }
          : {
              status: 'unknown',
              error: probe.status === 'unknown' ? probe.error : 'no answer from the server',
            },
      ),
    );
  }
}

/**
 * Detect which project is open, by ASKING the session. Returns the project if
 * found, null if the project screen should be shown.
 */
export async function detectProject(): Promise<ActiveProject | null> {
  // One gate before anything is resolved: a removed boot
  // param errors loudly naming its replacement rather than falling through
  // (boot-routing.ts) — including `?project=` itself: project identity is
  // session-held.
  assertNoRemovedBootParams(window.location.search);

  // 1. ASK THE SESSION. This is the one explicit target —
  //    `vgai edit <path>`, `VGAI_PROJECT`, and the project browser all reach
  //    the client the same way, because they all move the SERVER's project
  //    and the client reads it from there. There is no URL param and no
  //    boot-time Vite define snapshot in this path: the define is a
  //    build-time value, and `POST /__editor/open-project` moves the session
  //    live, so a snapshot could disagree with the server that serves the
  //    files.
  const serverProject = await detectServerProject();
  if (serverProject) return serverProject;

  // 2. Reopen-last (G5). Only reached when the server said it has no project
  //    open: a live session project outranks the preference.
  return reopenLastProjectIfEnabled();
}

/**
 * The opted-in "Reopen last project on launch" rung of the §5 ladder.
 *
 * Returns the reopened project, or null to fall through to the hub — which is
 * also what a FAILED reopen returns. That fallback is deliberate and is half
 * the reason the escape hatch exists: a project that was deleted, moved, or
 * broken since it was last opened must not be able to wedge the launcher in a
 * boot loop the user cannot click their way out of. Unreal behaves the same
 * way. The failure is reported to the console rather than thrown, because a
 * thrown error here would render the startup-failure screen instead of the hub
 * and hide the recents list the user needs in order to pick something else.
 */
async function reopenLastProjectIfEnabled(): Promise<ActiveProject | null> {
  const [settings, recents] = await Promise.all([getLauncherSettings(), listRecentProjects()]);
  const target = resolveBootTarget({
    explicitTarget: null,
    hubRequested: hubRequestedFromSearch(window.location.search),
    reopenLastEnabled: settings.reopenLastProject,
    recents,
  });
  if (target.kind !== 'reopen-last') return null;
  try {
    return await openProject(target.path);
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: a failed auto-reopen must be visible; the editor console isn't mounted yet at boot.
    console.warn(
      `[vgai] "Reopen last project on launch" could not open ${target.path}; showing the project browser instead.`,
      err,
    );
    return null;
  }
}

export {
  type ActiveProject,
  getCurrentProject,
  onProjectChange,
  onProjectSessionEnd,
  type ProjectConfig,
  setActiveProject,
} from '@volter/editor-sdk/kit/active-project';
