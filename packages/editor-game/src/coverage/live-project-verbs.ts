/**
 * THE `project.*` COVERAGE OF THE OPEN PROJECT — the live half of
 * `coverage/project-verb-coverage.ts`.
 *
 * It reads the session's own singletons plus two project files the browser
 * cannot read for itself, and hands the facts to the pure derivation. The
 * report goes out the doors coverage already uses — `vgai status`'s
 * `projectCoverage` facet, and the editor console via
 * `coverage/session-coverage.ts`, which unions this family with the other two
 * so one headline counts them all. No new transport, no new panel: the console
 * sync forwards every warning to the server's unresolved ledger, which is what
 * makes an absent verb a STANDING condition rather than a line somebody
 * scrolled past.
 *
 * ## Why this family does NOT stand down for an ingested mount
 *
 * `coverage/native-system-coverage.ts` steps aside for an ingest because that
 * lane has a STRONGER measurement of the same slots (the game's declared
 * carrier). Nothing of the sort exists here: "can this project build" is a
 * question about the opened PROJECT, and a vendored game opened as a
 * project has it just as much as a scaffolded one. One producer, both lanes —
 * which is also why every other report passes `projectVerbs: []`.
 *
 * ## Asking is part of the job
 *
 * The file-facts source is cached-on-first-ask and asked by nothing else, so
 * this module KICKS OFF the read rather than reporting `unanswered` forever —
 * a row whose whole point is "nobody looked" must not be the reason nobody
 * looks.
 */

import {
  type CapabilityCoverageReport,
  deriveCapabilityCoverage,
} from '../host/coverage/capability-coverage';
import {
  measureProjectVerbs,
  type ProjectRootFact,
  type ProjectVerbFacts,
} from '../host/coverage/project-verb-coverage';
import { editorServerJson } from '@volter/editor-sdk/kit/editor-server-response';
import { getCurrentProject } from '@volter/editor-core/project-manager';

/** What the server answers on `/__editor/project-verbs` — facts only. */
interface ProjectFileFacts {
  readonly scripts: readonly string[] | null;
  readonly hasPackageJson: boolean;
  readonly dependencies?: readonly string[] | null;
  readonly roots: readonly ProjectRootFact[] | null;
  readonly unavailable: string | null;
}

/** Unread until the server answers, and unread is NOT "there is none". */
let _files: ProjectFileFacts | null = null;
let _request: Promise<ProjectFileFacts> | null = null;
/** Which project `_files` describes, so a project switch re-asks instead of
 *  reporting the previous project's scripts against the new one. */
let _filesFor: string | null = null;

/**
 * Drop the cached file facts so the next read re-asks the dev server. Called
 * on `vgai restart` (a restart is precisely "my project's files changed —
 * re-read them"; the probe-measured failure was the dependency detector
 * grading rows against a package.json edit two restarts old) and by tests.
 */
export function invalidateProjectFileFacts(): void {
  _files = null;
  _request = null;
  _filesFor = null;
}

/**
 * Ask the dev server for the project's own files, once per open project.
 *
 * A transport failure is NOT an absence: it lands as `scripts: null` with the
 * reason, which the rules report as unmeasured. There is exactly one safe
 * direction for this question to fail in.
 */
async function loadProjectFileFacts(
  rootPath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProjectFileFacts> {
  if (_files && _filesFor === rootPath) return _files;
  if (_request && _filesFor === rootPath) return _request;
  _filesFor = rootPath;
  _files = null;
  _request = (async () => {
    let answer: ProjectFileFacts;
    try {
      const res = await fetchImpl('/__editor/project-verbs');
      answer = await editorServerJson<ProjectFileFacts>(res, 'project-verbs did not answer');
    } catch (error) {
      answer = {
        scripts: null,
        hasPackageJson: false,
        dependencies: null,
        roots: null,
        unavailable: `the editor could not reach its dev server to read this project's own files (${
          error instanceof Error ? error.message : String(error)
        })`,
      };
    }
    _files = answer;
    return answer;
  })();
  return _request;
}

/**
 * The open project's dependency NAMES, off the SAME single fetch the verb rows
 * use — the `system.*` family's detector input.
 *
 * `null` is "not answered yet / not answerable" (an unlanded fetch, an
 * unreadable package.json), and every caller must treat it as such:
 * an absent library list is not evidence that a library is absent, and reading
 * it as one would fabricate the very reassurance the detector exists to
 * withhold. Deliberately does NOT kick off the fetch itself —
 * {@link projectVerbFacts} owns that, so there is one request and one cache.
 */
export function projectDependencyNames(): readonly string[] | null {
  const project = getCurrentProject();
  if (!project) return null;
  const files = _filesFor === project.rootPath ? _files : null;
  return files?.dependencies ?? null;
}

/**
 * Everything the rules read, assembled from the live session — and the reads
 * kicked off where they have not happened yet.
 *
 * `null` when there is no open project at all: a verb report about no project
 * would be three fabricated gaps, which is worse than no rows.
 */
export function projectVerbFacts(): ProjectVerbFacts | null {
  const project = getCurrentProject();
  if (!project) return null;
  void loadProjectFileFacts(project.rootPath);
  const files = _filesFor === project.rootPath ? _files : null;
  return {
    scripts: files?.scripts ?? null,
    hasPackageJson: files?.hasPackageJson ?? false,
    roots: files?.roots ?? null,
    unavailable:
      files?.unavailable ??
      (files ? null : 'the editor has not finished reading this project’s own files yet'),
  };
}

/**
 * The `project.*` report for the open project, re-derived on every read — the
 * scripts a project declares change while it is open (`vgai add` writes them),
 * so a cached answer would start lying.
 */
export function projectVerbCoverage(): CapabilityCoverageReport | null {
  const facts = projectVerbFacts();
  if (!facts) return null;
  const project = getCurrentProject();
  return deriveCapabilityCoverage({
    worldId: project?.config.name ?? 'project',
    projectVerbs: measureProjectVerbs(facts),
  });
}
