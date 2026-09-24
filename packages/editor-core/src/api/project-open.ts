/**
 * Choosing, creating and OPENING a project — the New Project screen's client
 * half, plus the runtime project switch.
 *
 * The user-triggered actions with no browser equivalent throw a clear, honest
 * `Error` rather than doing a doomed fetch (`createProject`, `browseFolder`,
 * `openProjectOnServer`, `revealInFinder`); the browser-mode UI either hides
 * the affordance or catches the throw into an existing error banner.
 */

import {
  assertProjectCompatibility,
  editorServerUnavailableError,
  isStartupRecovery,
  ProjectCompatibilityError,
} from '@volter/editor-sdk/session/editor-compatibility';
import type { ProjectInspection } from '@volter/editor-project/inspection';
import {
  assertEditorServerAnswered,
  assertEditorServerResponse,
  editorServerJson,
} from '@volter/editor-sdk/kit/editor-server-response';
import { BASE } from '@volter/editor-sdk/kit/api-base';
import { requireEditorCompatibility } from '@volter/editor-sdk/kit/api-project-identity';

/** One row of the launcher's recent-projects list. */
export interface RecentProject {
  name: string;
  path: string;
  lastOpened: string;
  thumbnail?: string;
}
/** List recently opened projects — the folders this machine's sessions have
 *  opened, tracked by the editor server. */
export async function listRecentProjects(): Promise<RecentProject[]> {
  try {
    const res = await fetch(`${BASE}/recent-projects`);
    const data = await editorServerJson<{ projects: RecentProject[] }>(
      res,
      'Could not list recent projects',
    );
    return data.projects;
  } catch {
    return [];
  }
}

/** Forget one launcher entry without touching the project folder. */
export async function removeRecentProject(path: string): Promise<void> {
  const response = await fetch(`${BASE}/recent-projects`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  assertEditorServerResponse(response, 'Could not remove recent project');
}

/** User-global launcher preferences (G5). */
export interface LauncherSettings {
  reopenLastProject: boolean;
}

const DEFAULT_LAUNCHER_SETTINGS: LauncherSettings = { reopenLastProject: false };

/** Read the launcher preferences. Any failure degrades to the documented
 *  defaults — a preferences read must never be able to block boot. */
export async function getLauncherSettings(): Promise<LauncherSettings> {
  try {
    const res = await fetch(`${BASE}/launcher-settings`);
    const data = await editorServerJson<Partial<LauncherSettings>>(
      res,
      'Could not read launcher settings',
    );
    return {
      reopenLastProject:
        typeof data.reopenLastProject === 'boolean'
          ? data.reopenLastProject
          : DEFAULT_LAUNCHER_SETTINGS.reopenLastProject,
    };
  } catch {
    return { ...DEFAULT_LAUNCHER_SETTINGS };
  }
}

/** Persist a launcher preference. Unlike the read above this throws on
 *  failure: a toggle that silently does nothing would leave the checkbox
 *  lying about what happens at the next launch. */
export async function updateLauncherSettings(
  update: Partial<LauncherSettings>,
): Promise<LauncherSettings> {
  const res = await fetch(`${BASE}/launcher-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  return await editorServerJson<LauncherSettings>(res, 'Could not save launcher settings');
}

/** Create a project from a registry source. The server validates the plain
 * string against the scaffolder's live capability tuple. */
export async function createProject(
  name: string,
  location: string,
  template: string,
  exampleId?: string,
  presentation?: string,
  additions: readonly string[] = [],
): Promise<{ ok: boolean; path?: string; config?: { name: string }; error?: string }> {
  const res = await fetch(`${BASE}/create-project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      location,
      template,
      ...(exampleId ? { exampleId } : {}),
      ...(presentation ? { presentation } : {}),
      ...(additions.length > 0 ? { additions } : {}),
    }),
  });
  // The route reports its own refusals in `{ ok: false, error }` with a non-2xx
  // status, and the New Project form renders that string — so only the "did the
  // editor server answer at all" half applies here.
  assertEditorServerAnswered(res, 'Could not create the project');
  return (await res.json()) as {
    ok: boolean;
    path?: string;
    config?: { name: string };
    error?: string;
  };
}

/** Open a native folder picker dialog. Returns the selected path, or null if cancelled. */
export async function browseFolder(title?: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/browse-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const data = await editorServerJson<{ path: string | null }>(
      res,
      'Could not open the folder picker',
    );
    return data.path;
  } catch {
    return null;
  }
}

/** Inspect an arbitrary local folder without opening it or writing VGAI files. */
export async function inspectProjectFolder(
  path: string,
): Promise<{ path: string; report: ProjectInspection }> {
  const res = await fetch(`${BASE}/inspect-project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  assertEditorServerAnswered(res, `Could not inspect ${path}`);
  const payload = (await res.json()) as {
    ok?: boolean;
    path?: string;
    report?: ProjectInspection;
    error?: string;
  };
  if (!res.ok || !payload.path || !payload.report) {
    throw new Error(payload.error ?? `Could not inspect ${path}.`);
  }
  return { path: payload.path, report: payload.report };
}

/** Add the one-file VGAI metadata bridge after the user approves an inspection. */
export async function adaptProjectFolder(
  path: string,
  selection?: { surface?: ProjectInspection['suggestedSurface']; entry?: string },
): Promise<{ path: string; writes: string[] }> {
  const res = await fetch(`${BASE}/adapt-project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, ...selection }),
  });
  assertEditorServerAnswered(res, `Could not add Volter Editor metadata to ${path}`);
  const payload = (await res.json()) as { path?: string; writes?: string[]; error?: string };
  if (!res.ok || !payload.path || !payload.writes) {
    throw new Error(payload.error ?? `Could not add Volter Editor metadata to ${path}.`);
  }
  return { path: payload.path, writes: payload.writes };
}

/** Reveal a file or folder in the OS file manager. */
export async function revealInFinder(targetPath: string): Promise<void> {
  const res = await fetch(`${BASE}/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: targetPath }),
  });
  // Every caller is a fire-and-forget menu action, so this rejection reaches
  // the editor console through the page's `unhandledrejection` capture
  // (`editor-console.ts`) — which is still a report, where the unread response
  // was a file manager that never opened and nothing said so.
  assertEditorServerResponse(res, `Could not reveal ${targetPath}`);
}

/** Save a viewport thumbnail for the current project — background bookkeeping
 *  for the recent-projects list, not a user-facing promise. */
export async function saveThumbnail(dataUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/save-thumbnail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl }),
    });
    assertEditorServerResponse(res, 'Could not save the project thumbnail');
    return true;
  } catch {
    return false;
  }
}

export interface ServerProject {
  path: string;
  config: {
    manifestVersion: 2;
    name: string;
    version: string;
    engine: { version: string };
    [key: string]: unknown;
  };
  /** Whether the project ships src/ui/registry.ts (scene-UI project mode, D9). */
  hasUiRegistry?: boolean;
  /** Whether this server is the no-monorepo-checkout packaged runtime
   *  (`packages/editor/server/packaged.ts`) — see `binding-resolver.ts`'s
   *  `isPackagedRuntime` for why a react world's mount needs this. */
  packaged?: boolean;
  /** The engine package resolved from this project's own node_modules graph. */
  enginePackage?: {
    name: '@vgai/game-runtime';
    version: string | null;
    path: string;
    installPath: string;
    linked: boolean;
  } | null;
}

/**
 * What the server says it is serving — with the failures kept apart from the
 * answer "nothing".
 *
 * `getCurrentServerProject` (below) flattens all three negatives to `null`,
 * which is fine for a background read that only wants the happy path. It is
 * NOT fine at boot: `null` there routes to the launcher, so a lost request or
 * an unreadable manifest silently claimed the server had no project while it
 * was serving one. See `boot-routing.ts`'s `decideServerProjectBoot`.
 */
export type ServerProjectProbe =
  | { status: 'project'; project: ServerProject }
  | { status: 'none' }
  /** Serving `path`, but the server could not describe it (broken manifest). */
  | { status: 'unreadable'; path: string; error: string }
  /** The ask itself failed — server down, mid-restart, malformed answer. */
  | { status: 'unknown'; error: string };

interface ServerProjectResponse {
  project: ServerProject | null;
  serving?: { path?: unknown; error?: unknown } | null;
}

/** Ask the server what it serves, keeping the reason when it cannot say. */
export async function probeCurrentServerProject(): Promise<ServerProjectProbe> {
  // Browser mode has no Node dev server to ask — same honest no-fetch
  // degrade as the other background reads in this file.
  let data: ServerProjectResponse;
  try {
    const res = await fetch(`${BASE}/project`);
    data = await editorServerJson<ServerProjectResponse>(res, `No answer from ${BASE}/project`);
  } catch (error) {
    return {
      status: 'unknown',
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (data.project) return { status: 'project', project: data.project };
  const serving = data.serving;
  if (serving && typeof serving.path === 'string') {
    return {
      status: 'unreadable',
      path: serving.path,
      error: typeof serving.error === 'string' ? serving.error : 'unknown error',
    };
  }
  if (data.project === null) return { status: 'none' };
  return { status: 'unknown', error: `Unrecognized ${BASE}/project response` };
}

/** Query the server for the currently active project (if any). Every failure
 *  reads as "no project" — see `probeCurrentServerProject` for the callers
 *  (boot) that must not make that trade. */
export async function getCurrentServerProject(): Promise<ServerProject | null> {
  const probe = await probeCurrentServerProject();
  return probe.status === 'project' ? probe.project : null;
}

/** Open/switch to a project by its filesystem path. */
export async function openProjectOnServer(projectPath: string): Promise<{
  ok: boolean;
  config?: {
    manifestVersion: 2;
    name: string;
    version: string;
    engine: { version: string };
    [key: string]: unknown;
  };
}> {
  const compatibility = await requireEditorCompatibility();
  const res = await fetch(`${BASE}/open-project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: projectPath }),
  });
  let payload: unknown;
  try {
    // The fallback check goes INSIDE this try so a page-fallback answer reaches
    // the same startup-recovery error class the parse failure already used —
    // now naming the cause instead of "invalid response".
    assertEditorServerAnswered(res, `Could not open project at ${projectPath}`);
    payload = await res.json();
  } catch (cause) {
    throw editorServerUnavailableError(
      cause instanceof Error ? cause.message : `HTTP ${res.status} returned an invalid response`,
    );
  }
  if (!res.ok) {
    if (payload && typeof payload === 'object') {
      const failure = payload as Record<string, unknown>;
      if (typeof failure['error'] === 'string' && isStartupRecovery(failure['recovery'])) {
        throw new ProjectCompatibilityError(failure['error'], failure['recovery']);
      }
      if (typeof failure['error'] === 'string') throw new Error(failure['error']);
    }
    throw new Error(`Could not open project at ${projectPath}: HTTP ${res.status}`);
  }
  const result = payload as {
    ok: boolean;
    config?: {
      manifestVersion: 2;
      name: string;
      version: string;
      engine: { version: string };
      [key: string]: unknown;
    };
  };
  if (result.config) assertProjectCompatibility(result.config, compatibility);
  return result;
}
