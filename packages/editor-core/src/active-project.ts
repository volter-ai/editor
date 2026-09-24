/**
 * THE ACTIVE PROJECT — the one store every surface reads the open project
 * from, and nothing else. Split out of `project-manager.ts` so a host that
 * only needs to know WHICH project is open (a bounded host, the
 * contribution loader) does not carry the server boot path — the launcher,
 * the server-project probe, the recent-projects list — and the server-SDK
 * barrel those import. `project-manager.ts` re-exports everything here, so
 * its importers are unchanged; a surface below the shell imports THIS file.
 */

import type { LearnMetadata } from '@volter/editor-project/manifest/schema';
import type { HierarchyProjection } from '@volter/editor-sdk/kit/hierarchy-projection';

/** One `run[]` declaration as the manifest carries it: the envelope plus the
 *  kind's own fields (spelled here, not imported, so a bounded host's closure
 *  stays free of the engine's kind registry). */
export interface ConfigurationDeclaration {
  readonly id: string;
  readonly kind: string;
  readonly [param: string]: unknown;
}

export interface ProjectConfig {
  /** Project-file schema version. Kept distinct from game and engine versions. */
  manifestVersion: 2;
  name: string;
  /** The authored game's own release version. */
  version: string;
  /** Exact engine identity the project is pinned to. */
  engine: { version: string };
  /** Editor-only organization. It never changes which runtime roots mount. */
  authoring?: { hierarchy?: HierarchyProjection | undefined } | undefined;
  resolution?: { width: number; height: number } | undefined;
  appId?: string | undefined;
  /**
   * Multiplayer server config from the manifest (`server.room` — the Colyseus
   * room this game registers), if declared. Carried here so edit-mode
   * networking can answer "does this project declare a server" from the
   * already-parsed manifest, NOT by re-reading `vgai.project.json` through the
   * asset-scoped `StorageBackend.read` (which resolves under `public/` and so
   * returns the SPA fallback for a root manifest — the bug that left the
   * player-count picker hidden on the local dev server).
   */
  /** The manifest's run configurations (ARCHITECTURE-CORE §The project model). */
  configurations?: readonly ConfigurationDeclaration[] | undefined;
  /**
   * Derived from the manifest roots. `false` means the editor must not
   * fabricate its native Three scene document for this project. Optional
   * only for legacy callers/tests; current project readers always provide it.
   */
  hasThreeRoot?: boolean | undefined;
  /** How many roots the manifest declares — what MOUNTS. Zero is a real
   *  shape (ARCHITECTURE-CORE §Roots): the chrome that only means something
   *  for a running world (transport, instances, play state, analytics) is
   *  derived from this, never from a project kind. */
  rootCount?: number | undefined;
  /**
   * The project's default scene path, or `null` when the manifest's first
   * world declares no scene (e.g. an `entry`-only world — §7.1-12). Always
   * present when derived from the manifest (`readProjectView`, server-side).
   * Consumers must NOT default a missing/null value to a guessed path: a
   * guess resolves to a file nobody declared, and writing to it silently
   * creates a placeholder the project never asked for.
   */
  defaultScene?: string | null | undefined;
  /**
   * FT-5 learner-facing metadata from the manifest's `learn` block. Carried
   * for BUNDLED EXAMPLES opened read-only in the hosted editor so the shell
   * can offer the example's Learn-site lesson ("This example has a lesson →",
   * G6); absent everywhere else.
   */
  learn?: LearnMetadata | undefined;
}

export interface ActiveProject {
  /** Absolute path to the project root (as passed via URL param / env). */
  rootPath: string;
  /** Parsed vgai.project.json project configuration plus derived editor fields. */
  config: ProjectConfig;
}

let _activeProject: ActiveProject | null = null;
const _listeners = new Set<() => void>();

function _notify(): void {
  for (const fn of _listeners) fn();
}

/**
 * Set or clear the active project directly (project screen and bounded hosts).
 *
 * This is also where a project SESSION ends: switching to a different project
 * without a page reload is a real path (the project screen's five open sites),
 * and the editor's module-level session singletons do not reset themselves on
 * it. Anything that must not outlive the previous project registers with
 * {@link onProjectSessionEnd} — see `project-session-reset.ts`, the one
 * subscriber, for the list.
 */
export function setActiveProject(project: ActiveProject | null): void {
  const previous = _activeProject;
  _activeProject = project;
  // Only a genuine CHANGE of project ends a session: re-setting the same
  // project (a config refresh after a manifest save) is not a switch, and
  // resetting session state under it would drop a live mount for nothing.
  if (previous && previous.rootPath !== project?.rootPath) {
    for (const fn of _sessionEndListeners) fn();
  }
  _notify();
}

/**
 * The boot/open path's own assignment: install the project just resolved
 * WITHOUT the session-end notice — a session ends on a SWITCH
 * ({@link setActiveProject}); resolving a project at boot or re-reading its
 * manifest is not one. Same notify as the setter.
 */
export function assignActiveProject(project: ActiveProject): ActiveProject {
  _activeProject = project;
  _notify();
  return project;
}

/** Get the currently open project, or null if none. */
export function getCurrentProject(): ActiveProject | null {
  return _activeProject;
}

/** Subscribe to project changes. Returns unsubscribe function. */
export function onProjectChange(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

const _sessionEndListeners = new Set<() => void>();

/**
 * Subscribe to the END of a project session — fired by {@link setActiveProject}
 * when a DIFFERENT project (or none) takes over.
 *
 * The sibling of {@link onProjectChange}, and deliberately not the same hook:
 * `onProjectChange` means "re-derive against whatever project is open now" and
 * fires for every notify, while this one means "the previous project's live
 * state is over, drop it". Nothing but `project-session-reset.ts` subscribes;
 * add a reset there rather than a second subscriber here.
 */
export function onProjectSessionEnd(fn: () => void): () => void {
  _sessionEndListeners.add(fn);
  return () => _sessionEndListeners.delete(fn);
}

/** The identity every per-project cache keys on: the open project's folder,
 *  and a fixed unscoped key when no project is active. */
export function activeProjectKey(): string {
  return getCurrentProject()?.rootPath ?? '__unscoped__';
}
