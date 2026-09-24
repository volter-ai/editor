/**
 * Validate-on-change (owner decision, GitHub issue #103): hand-editing
 * project files is an accepted authoring path, so the dev server validates
 * `vgai.project.json` on every write and
 * surfaces failures immediately — instead of the previous behavior, where a
 * bad hand-edit only errored at next load.
 *
 * This module owns CONTENT validation only — classify a path, then either
 * parse+validate its JSON or, for a `src/` module, PARSE IT AS A PROGRAM and
 * run the authoring detectors over it. It deliberately reuses the exact
 * Zod-backed parser
 * `validate-manifest.ts` ships to every project
 * (`loadGameManifest`), never
 * re-implementing schema logic. Debouncing, terminal/SSE/state reporting,
 * and file-watcher wiring live in `editor-server.ts`, which owns the
 * chokidar watchers and mutable project state this needs no knowledge of.
 */

import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { ZodError } from 'zod';
import { AssetParseError } from '@volter/editor-threejs/asset-parse-error';
import { loadGameManifest } from '@volter/editor-project/manifest/load';
import { sourceAuthoringDiagnostics } from './source-analysis';
import { oidSurfaceSourceConflicts, resolveProjectFileRegion } from './project-root-surface';
import { findVendoredTarget } from './vendored-lock-recorder';

export type ValidatableKind = 'manifest' | 'source';

export interface ValidateProjectFileOptions {
  /** The engine checkout, so a source file can be tested against the vendored
   *  game locks (`vendor/games/<id>.UPSTREAM.lock`). Omitted by callers that
   *  have no checkout to test against, which simply validates everything. */
  readonly engineRoot?: string | undefined;
}

/**
 * Classify an absolute file path as one of the validate-on-change formats, or
 * `null` if it's none of them. The manifest is a single fixed-name file at
 * the project root (matched by basename — `vgai.project.json` never appears anywhere
 * else in a project).
 */
export function classifyValidatableFile(absPath: string): ValidatableKind | null {
  if (/[/\\]src[/\\].*\.[cm]?[jt]sx?$/.test(absPath)) return 'source';
  const base = absPath.split(/[/\\]/).pop();
  if (base === 'vgai.project.json') return 'manifest';
  return null;
}

export interface ValidationOk {
  ok: true;
  warnings?: string[];
}

export interface ValidationFail {
  ok: false;
  /** One formatted message per issue — `path.to.field: message` for Zod
   *  issues, or the raw error message for read/parse/cross-field failures. */
  errors: string[];
  warnings?: string[];
}

export type ValidationResult = ValidationOk | ValidationFail;

function formatIssues(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): string[] {
  // Zod v4's issue `path` is typed `PropertyKey[]` (it can carry a `symbol`
  // for branded keys) — `Array.prototype.join` calls the implicit `ToString`
  // coercion on each element, which THROWS for a bare symbol. Map through
  // `String()` explicitly so this stays safe even on that rare path.
  return issues.map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`);
}

/** Run the Zod-backed manifest parser. Throws on failure (same contract as
 *  `loadGameManifest`) — `validateProjectFile` below is the one place that
 *  catches it. */
function parseByKind(json: unknown): void {
  loadGameManifest(json);
}

/** Map a thrown parse error to its reported message list — one formatted
 *  entry per Zod issue for schema violations, or the raw message for a
 *  manifest cross-field `Error` (`loadGameManifest` throws those directly).
 *
 *  Exported because it is the ONE readable rendering of a manifest failure:
 *  `project-view.ts` reports the same failure over `/__editor/project`'s
 *  `serving.error`, and a raw `ZodError.message` there is a pretty-printed
 *  JSON array of issue objects — the failing key is in it, buried twelve lines
 *  deep, which is not a diagnosis anyone reads. */
export function errorsFor(err: unknown): string[] {
  if (err instanceof AssetParseError) return formatIssues(err.issues);
  if (err instanceof ZodError) return formatIssues(err.issues);
  return [err instanceof Error ? err.message : String(err)];
}

/** The esbuild loader for a project source file, chosen exactly the way the
 *  dev server's own transform chooses it. That parity is the whole point:
 *  anything Vite will serve has to survive this parse, and anything that fails
 *  here would have failed the dev server's transform too. `.js` is `jsx`, not
 *  `js`, for the same parity reason: the dev server accepts JSX inside a
 *  project's `.js` files (the CRA-era idiom — `vite-plugin-project-jsx-js.ts`
 *  is the serving half and names all three seams), so redding them here would
 *  fill `vgai status` with false errors for a game that mounts fine. `jsx` is
 *  a strict parse superset of `js`, so nothing formerly valid now reds. */
function sourceLoader(absPath: string): 'ts' | 'tsx' | 'jsx' {
  if (/\.tsx$/i.test(absPath)) return 'tsx';
  if (/\.[cm]?ts$/i.test(absPath)) return 'ts';
  return 'jsx';
}

/**
 * Does this file PARSE? Returns one formatted message per syntax error, or an
 * empty array when the file is syntactically fine.
 *
 * Nothing else in this module answers that question — the detectors below are
 * regexes and an error-TOLERANT `ts.createSourceFile`, so a project file that
 * cannot be compiled at all used to validate `{ ok: true }` and the promised
 * loud path stayed silent. The failure then surfaced only when the browser
 * re-fetched the module, as a Vite transform error, which is the channel this
 * verdict exists to make redundant.
 *
 * esbuild's `transform` (already a declared dependency of this package) is the
 * cheapest real parser available and is the same one Vite runs, so the verdict
 * matches what the dev server will do with the file. `target: 'esnext'` keeps
 * it a PARSE: no syntax lowering, so nothing is reported for an environment
 * this check has no opinion about.
 */
async function parseErrors(raw: string, absPath: string): Promise<string[]> {
  try {
    await transform(raw, { loader: sourceLoader(absPath), sourcefile: absPath, target: 'esnext' });
    return [];
  } catch (err) {
    const messages = (err as { errors?: { text?: string; location?: EsbuildLocation }[] }).errors;
    if (!Array.isArray(messages) || messages.length === 0) {
      return [err instanceof Error ? err.message : String(err)];
    }
    return messages.map((message) => {
      const text = message.text ?? 'syntax error';
      const at = message.location;
      // esbuild columns are 0-based; `+ 1` matches the 1-based `line:col` the
      // R3F authoring warnings below already print.
      return at ? `line ${at.line}:${at.column + 1}: ${text}` : text;
    });
  }
}

interface EsbuildLocation {
  line: number;
  column: number;
}

async function validateSource(
  raw: string,
  absPath: string,
  opts?: ValidateProjectFileOptions,
): Promise<ValidationResult> {
  // Parse FIRST and short-circuit. Every detector below reads a source it
  // cannot trust once the file is unparseable, so their findings would be
  // noise stacked on top of the one error that actually matters.
  const syntax = await parseErrors(raw, absPath);
  if (syntax.length > 0) return { ok: false, errors: syntax };

  // PARSE-ONLY inside a lock-recorded vendored game. Everything below this line
  // is ADVICE TO EDIT THE FILE — "declare a react adapter root", "accept and
  // spread the matching ThreeElements props", "add the ordinary R3F name prop"
  // — and a vendored game's bytes are pinned by `vendor/games/<id>.UPSTREAM.lock`
  // to the upstream commit. A real deviation there is a RECORDED PATCH with a
  // written rationale, a deliberate act; a background linter repeating
  // unactionable advice about upstream code on every boot is noise a reader
  // cannot act on and cannot clear. The parse verdict above still applies,
  // because that one is actionable: a vendored file that does not parse is a
  // mount that will fail.
  //
  // Measured on the repo-vendored racing-game the moment the boot scan started
  // covering the manifest's real source tree: 1 error + 13 warnings, all of
  // them asking for edits to pinned upstream bytes — including
  // `src/main.tsx`'s `createRoot`, the game's own standalone page entry, which
  // the host shim deliberately never imports.
  if (opts?.engineRoot && findVendoredTarget(absPath, opts.engineRoot)) return { ok: true };

  // The R3F authoring rules apply to a `three` region and to nothing else, and
  // "which region?" is the resolver's answer, never the file's own text. This
  // call site has no live import graph, so it gets the graph-FREE half —
  // declared region `include` globs and root entries — exactly as its
  // `oidSurfaceSourceConflicts` sibling below does, and for the same reason:
  // without a graph every non-entry file looks unplaced, and reporting on that
  // basis is a claim the tier cannot support. The reach-dependent files are
  // analyzed at stamp time (the source-authoring integration's serving plugin), where the graph exists.
  const knownThreeSurface = resolveProjectFileRegion(absPath).surface === 'three';
  const warnings = [
    ...sourceAuthoringDiagnostics(raw, absPath, { knownThreeSurface }).map(
      (diagnostic) =>
        `line ${diagnostic.line}:${diagnostic.col + 1} [${diagnostic.code}] ${diagnostic.message}`,
    ),
    // Task #45 — the OID-stamping surface conflicts that make an element
    // unselectable in the editor. Only the graph-FREE subset belongs here (see
    // `oidSurfaceSourceConflicts`); the reach-dependent ones are reported at
    // stamp time by the source-authoring integration's serving plugin, where a live import graph exists.
    ...oidSurfaceSourceConflicts(absPath, raw).map(
      (diagnostic) => `[${diagnostic.code}] ${diagnostic.message}`,
    ),
  ];
  return { ok: true, ...(warnings.length > 0 ? { warnings } : {}) };
}

/**
 * Validate one project file's on-disk content against the same schema the
 * engine's runtime loader and `validate-scenes.ts`/`validate-manifest.ts`
 * enforce. Never throws — a file-watcher callback has no caller to catch a
 * throw, so every failure mode (unreadable file, malformed JSON, schema
 * violation, manifest cross-field rule) collapses into a `ValidationFail`
 * with one or more human-readable messages.
 */
export async function validateProjectFile(
  absPath: string,
  kind: ValidatableKind,
  opts?: ValidateProjectFileOptions,
): Promise<ValidationResult> {
  let raw: string;
  try {
    raw = await readFile(absPath, 'utf-8');
  } catch (err) {
    // Most commonly ENOENT — a delete (or a rename's transient unlink) racing
    // the debounce timer. Not this module's job to distinguish; just report.
    return {
      ok: false,
      errors: [`could not read file: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  let json: unknown;
  if (kind === 'source') return validateSource(raw, absPath, opts);

  try {
    json = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      errors: [`invalid JSON: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  try {
    parseByKind(json);
    return { ok: true };
  } catch (err) {
    return { ok: false, errors: errorsFor(err) };
  }
}
