/**
 * The server half of creation-site write-back — ownership, path
 * containment, and the read/plan/apply handlers behind `/__ingest-source/*`.
 *
 * The client never decides any of this. It sends an anchor
 * (`{file, line, col}`, project-root-RELATIVE — the string the creation-site
 * registry hands out) plus the value in force and the value the user produced; this
 * module resolves that to a real path inside the project, reads it, runs the
 * pure planner, and hands back exact bytes or a named refusal. Three properties
 * are deliberately server-side and unreachable from the browser:
 *
 *  - OWNERSHIP. Whether the base may be written at all, and WHO RECORDS the
 *    resulting diff, are facts about the filesystem and about which folder this
 *    editor was pointed at. A client cannot be trusted to answer either and is
 *    never asked to; it renders whatever {@link ingestSourceOwnership} says,
 *    including the reason and the recorder.
 *  - CONTAINMENT. {@link resolveIngestSourceFile} refuses any path that escapes
 *    the roots an anchor may name, including through `..`, an absolute path, or
 *    a symlink (the resolution is `realpath`-based, so a link planted inside a
 *    root cannot be used to write outside it). There are TWO such roots and
 *    that is not a widening: the opened project, and — only for a file some
 *    `vendor/games/<id>.UPSTREAM.lock` actually claims — the repo-vendored
 *    home, which is the set this route can write WITH its lock in one gesture.
 *    This is the only door, so it is the only place the check has to be right.
 *  - THE CHECKSUM GUARD. `apply` refuses a write whose `ifMatchSha` no longer
 *    matches the file on disk, which is what makes undo/redo safe against a
 *    file the user edited in their own editor meanwhile.
 *
 * WHY A SEPARATE ROUTE FAMILY FROM `/__ui-source/*`. That family's scope guard
 * (`resolveEditableSourceFile`) admits `.tsx` under the project's `src/` and
 * project TypeScript — it is the JSX/R3F authoring door, and its shape encodes
 * that. An ingested game is somebody else's JavaScript, laid out however they
 * laid it out (`src/scripts/sim/city.js`), and it is reachable ONLY through an
 * anchor this editor itself stamped. Widening the JSX door to admit arbitrary
 * `.js` would hand every existing oid-driven endpoint a scope it was never
 * designed for; a second door with its own, narrower key does not.
 */

import { createHash } from 'node:crypto';
import {
  accessSync,
  constants,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  type CreationSiteEditRequest,
  type CreationSiteLiteralReport,
  type CreationSiteLiteralRequest,
  type CreationSiteSurface,
  type CreationSiteWriteScope,
  planCreationSiteEdit,
  planCreationSiteRemoval,
  readCreationSiteLiteral,
} from '../src/creation-site-edit';
import {
  type HmrInvalidationGraph,
  staleModuleWarning,
  stampHmrInvalidation,
} from './project-script-hmr';
import { isPathInside } from './server-utils';
import {
  findVendoredTarget,
  settleVendoredWrite,
  LOCKS_DIR as VENDORED_HOME,
  writeRecordedVendoredFile,
} from './vendored-lock-recorder';

/** The JSON response a handler produces (status defaults to 200). */
export interface HandlerResult {
  readonly status?: number;
  readonly body: unknown;
}

export interface IngestSourceOwnership {
  /** May this session write the game's own source at all? */
  readonly writable: boolean;
  /** Always present when `writable` is false — never a blank (honest-floor). */
  readonly reason?: string;
  /** Echoed back so the surface can name the folder it is talking about. */
  readonly projectRoot: string | null;
  /**
   * WHO RECORDS the diff this session's edits produce, in one phrase a surface
   * can show. Present whenever `writable` — the two answers are the user's own
   * version control, and (for a repo-vendored copy) that game's UPSTREAM lock,
   * updated in the same gesture as the write.
   */
  readonly recorder?: string;
}

/** Hashes BYTES. Every digest this route quotes — `ifMatchSha`, the one it
 *  returns — has to mean the same thing as the vendored lock's and the
 *  verifier's, and those hash the file's bytes. */
function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The wire form of a file's content.
 *
 * Source is text and stays text. But a vendored game's authorable truth is not
 * always source: a level-based game's placed objects live in a binary level
 * file, so the same route has to carry megabytes of binary data, and a JSON
 * string cannot hold it — UTF-8 round-tripping those bytes silently produces a
 * different, longer file. `encoding` is explicit on the wire rather than sniffed, so a
 * client that forgets it gets a wrong SHA and a refusal, not a corrupted game.
 */
function decodeSource(source: string, encoding: unknown): Buffer | null {
  if (encoding === 'base64') return Buffer.from(source, 'base64');
  if (encoding === undefined || encoding === 'utf8') return Buffer.from(source, 'utf8');
  return null;
}

/** Git's own rule: a NUL byte near the front means this is not text. */
function looksBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Whether an ingest session may write the game's own source, WHO RECORDS the
 * diff, and — when it may not — the sentence the UI shows verbatim.
 *
 * OWNERSHIP DECIDES THE RECORDER, NOT WHETHER TO WRITE. Persistence works the
 * same way it does in the native lane: an authored edit edits the game's own
 * code, and the only thing that varies is where the resulting divergence is
 * accounted for. A folder the user owns records in their version control. A
 * repo-vendored copy records in its own `vendor/games/<id>.UPSTREAM.lock`, in
 * the same server gesture as the write, so the estate's bar — zero UNRECORDED
 * diff, never zero diff — holds at every instant (`vendored-lock-recorder.ts`).
 *
 * What is left here is the filesystem's own answer: a folder has to exist and
 * be writable. Everything else this function used to decide was a policy about
 * whose files these are, and that policy now lives one layer down, in which
 * recorder runs.
 */
export function ingestSourceOwnership(
  projectRoot: string | undefined | null,
  engineRoot: string,
): IngestSourceOwnership {
  if (!projectRoot) {
    return {
      writable: false,
      reason: 'no project folder is open — this session has no source to write',
      projectRoot: null,
    };
  }
  const root = realOrSelf(resolve(projectRoot));
  try {
    if (!statSync(root).isDirectory()) {
      return { writable: false, reason: 'the project path is not a folder', projectRoot: root };
    }
    accessSync(root, constants.W_OK);
  } catch {
    return { writable: false, reason: 'the project folder is not writable', projectRoot: root };
  }
  return { writable: true, projectRoot: root, recorder: recorderFor(root, engineRoot) };
}

/** The one phrase naming who accounts for this session's edits. */
function recorderFor(projectRoot: string, engineRoot: string): string {
  const vendored = findVendoredTarget(projectRoot, engineRoot);
  return vendored
    ? `the vendored game’s own lock (vendor/games/${vendored.id}.UPSTREAM.lock), updated in the same gesture as the write`
    : 'your own version control — these are your project’s files';
}

/** Resolve `clean` under `root`, contained on both sides of symlink resolution. */
function resolveInsideRoot(clean: string, rootDir: string): string | null {
  const root = realOrSelf(resolve(rootDir));
  const candidate = resolve(root, clean);
  if (!isPathInside(root, candidate)) return null;
  let real: string;
  try {
    real = realpathSync(candidate);
    if (!statSync(real).isFile()) return null;
  } catch {
    return null;
  }
  // Re-checked AFTER symlink resolution: a link inside the root pointing out of
  // it passes the first check and fails this one.
  return isPathInside(root, real) ? real : null;
}

/**
 * The absolute path an anchor's root-relative `file` names, or `null` when it
 * escapes every root an anchor may be written against (or does not exist).
 *
 * TWO ROOTS, because an anchor is relative to whichever root OWNS the module,
 * and `vite-plugin-creation-site`'s `creationSiteScopeFor` picks that root from
 * the same set the game-globals shadow uses (`ingestGameShadowRoots`): an
 * opened project, AND the repo-vendored home. So a repo-vendored game's
 * creation site arrives as `<id>/src/...`, relative to `vendor/games` — a path
 * that cannot resolve inside the opened project and, until this, was refused as
 * "not a file inside this project". MEASURED on the bubbo-bubbo ingest: every
 * edit to that game stayed live-only with that reason, which was TRUE and
 * beside the point — the file is not the project's, it is the vendored game's,
 * and `vendored-lock-recorder.ts` exists precisely to write it.
 *
 * The vendored leg's containment is not a path prefix but the RECORDER's own
 * answer: `findVendoredTarget` must claim the resolved file, i.e. some
 * `vendor/games/<id>.UPSTREAM.lock` covers it. That is strictly stronger than
 * "under vendor/games", because it is exactly the set of files this route can
 * write WITH their lock in the same gesture (`handleIngestApply`) — a file the
 * recorder does not claim can never be written here, so it is never resolved
 * here either.
 *
 * Every rejection is the same `null` on purpose: a client that can distinguish
 * "outside the project" from "does not exist" can probe the host's filesystem
 * one guess at a time.
 */
export function resolveIngestSourceFile(
  file: unknown,
  projectRoot: string,
  engineRoot?: string,
): string | null {
  if (typeof file !== 'string' || file.length === 0) return null;
  const clean = file.split('?')[0] ?? file;
  // An ANCHOR is always root-relative — an absolute path did not come from the
  // registry, so it is refused rather than resolved.
  if (isAbsolute(clean)) return null;
  const inProject = resolveInsideRoot(clean, projectRoot);
  if (inProject) return inProject;
  if (engineRoot === undefined) return null;
  const inVendored = resolveInsideRoot(clean, join(engineRoot, ...VENDORED_HOME));
  return inVendored && findVendoredTarget(inVendored, engineRoot) ? inVendored : null;
}

/**
 * Complete any vendored write that died between its own artifacts, BEFORE this
 * request reads the file. A journalled write is finished by the next request
 * that touches the game, which is why every route calls this and not just the
 * writing one — planning an edit against half-written bytes would produce a
 * plan that is wrong in a way no later check could catch.
 *
 * When it does roll bytes forward it stamps the same invalidation a write of
 * our own stamps: settling REPLACES the file's content, so a dev server that
 * kept serving the pre-settle module would hand the next mount source that no
 * longer exists on disk — the defect `invalidateWrittenSource` above was added
 * for, reaching the graph through the settle instead of through the write.
 */
function settlePendingRecord(resolvedFile: string, engineRoot: string): void {
  const vendored = findVendoredTarget(resolvedFile, engineRoot);
  if (vendored && settleVendoredWrite(vendored)) invalidateWrittenSource(resolvedFile);
}

/**
 * Stable identity for the history registry (mirrors the `/__ui-source` family's
 * `sourceResourcePath`).
 *
 * A vendored game's file is not under the project root, so a plain `relative()`
 * would key it by a ladder of `..` segments that describes the host's directory
 * layout rather than the file. It is keyed by its position in the vendored home
 * instead — the same `<id>/…` string the creation-site anchor already uses, so
 * one file has one identity whichever route reached it.
 */
function resourcePathOf(file: string, projectRoot: string, engineRoot: string): string {
  const vendorHome = realOrSelf(resolve(join(engineRoot, ...VENDORED_HOME)));
  const root = isPathInside(vendorHome, file) ? vendorHome : realOrSelf(resolve(projectRoot));
  return relative(root, file).split(sep).join('/');
}

/** The wire shape of a prepare request — the anchor plus the two values.
 *  `remove: true` plans a REMOVAL instead (`planCreationSiteRemoval`): `next`
 *  is absent because absence is not a value, and the same route carries it so
 *  ownership, path containment and the checksum-guarded apply are literally
 *  the same code for either direction. */
interface PrepareBody {
  readonly site?: { file?: unknown; line?: unknown; col?: unknown };
  readonly instances?: unknown;
  readonly writeScope?: unknown;
  readonly property?: unknown;
  readonly surface?: unknown;
  readonly baseline?: unknown;
  readonly next?: unknown;
  readonly remove?: unknown;
}

function writeScopeOf(value: unknown): CreationSiteWriteScope | 'invalid' {
  if (value === undefined || value === 'instance') return 'instance';
  if (value === 'creation-site') return 'creation-site';
  return 'invalid';
}

/**
 * Which surface vocabulary the client's `property` is in — validated here rather
 * than cast, because it selects the CHANNEL TABLE and an unrecognized value must
 * not silently fall through to the other surface's meaning of the same word
 * (`position` is a 3-vector on three and a 2-vector on canvas).
 */
function surfaceOf(value: unknown): CreationSiteSurface | 'invalid' {
  if (value === undefined || value === 'three') return 'three';
  if (value === 'pixi' || value === 'babylon') return value;
  return 'invalid';
}

export interface PreparedCreationSiteEdit {
  readonly changed: boolean;
  readonly file?: string;
  readonly resourcePath?: string;
  readonly prevSource?: string;
  readonly newSource?: string;
  readonly prevSha?: string;
  readonly newSha?: string;
  /** Present iff `!changed` — the named refusal. */
  readonly reason?: string;
}

/**
 * POST `/__ingest-source/prepare` — plan one property edit against the game's
 * own source. Reads, never writes.
 *
 * The planning itself is `planCreationSiteEdit`, which is pure and shared with
 * the unit tests, so what a test proves is what the server does.
 */
export function handleIngestPrepare(
  body: PrepareBody,
  projectRoot: string | undefined | null,
  engineRoot: string,
): HandlerResult {
  const ownership = ingestSourceOwnership(projectRoot, engineRoot);
  if (!ownership.writable || !ownership.projectRoot) {
    return { status: 403, body: { changed: false, reason: ownership.reason } };
  }
  const site = body.site ?? {};
  const surface = surfaceOf(body.surface);
  const writeScope = writeScopeOf(body.writeScope);
  if (
    typeof site.file !== 'string' ||
    typeof site.line !== 'number' ||
    typeof site.col !== 'number' ||
    typeof body.property !== 'string' ||
    typeof body.instances !== 'number' ||
    surface === 'invalid' ||
    writeScope === 'invalid'
  ) {
    return {
      status: 400,
      body: { changed: false, reason: 'malformed creation-site edit request' },
    };
  }
  const resolved = resolveIngestSourceFile(site.file, ownership.projectRoot, engineRoot);
  if (!resolved) {
    return {
      status: 403,
      body: { changed: false, reason: 'the creation site is not a file inside this project' },
    };
  }
  settlePendingRecord(resolved, engineRoot);
  const source = readFileSync(resolved, 'utf8');
  const plan =
    body.remove === true
      ? planCreationSiteRemoval(source, {
          site: { file: site.file, line: site.line, col: site.col },
          instances: body.instances,
          writeScope,
          property: body.property,
          surface,
        })
      : planCreationSiteEdit(source, {
          site: { file: site.file, line: site.line, col: site.col },
          instances: body.instances,
          writeScope,
          property: body.property,
          surface,
          baseline: body.baseline as CreationSiteEditRequest['baseline'],
          next: body.next as CreationSiteEditRequest['next'],
        });
  if (!plan.changed) {
    return { body: { changed: false, reason: plan.reason ?? 'the edit was refused' } };
  }
  return {
    body: {
      changed: true,
      file: site.file,
      resourcePath: resourcePathOf(resolved, ownership.projectRoot, engineRoot),
      prevSource: plan.prevSource,
      newSource: plan.newSource,
      prevSha: sha256(Buffer.from(plan.prevSource, 'utf8')),
      newSha: sha256(Buffer.from(plan.newSource, 'utf8')),
    } satisfies PreparedCreationSiteEdit,
  };
}

/** The wire shape of an inspect request — one anchor, many properties, each
 *  with the value in force on the live object. */
interface InspectBody {
  readonly site?: { file?: unknown; line?: unknown; col?: unknown };
  readonly instances?: unknown;
  readonly writeScope?: unknown;
  readonly surface?: unknown;
  readonly properties?: unknown;
}

/**
 * POST `/__ingest-source/inspect` — what the construction statement SAYS each of
 * these properties is, so the inspector can show the live object's value as an
 * override of the site's own literal. Reads, never writes, never plans.
 *
 * ONE ROUND TRIP FOR THE WHOLE SUBJECT, not one per property: the file is read
 * and parsed once per request, and a per-property route would re-parse the
 * game's source for every row the inspector draws.
 *
 * It is the same `readCreationSiteLiteral` the unit tests drive, for the same
 * reason `prepare` is `planCreationSiteEdit`: what a test proves is what the
 * server does. The route is deliberately NOT gated on the session's "persist to
 * game source" consent — reading what a line of the game says is a read, and the
 * write consent is checked where a byte would actually move.
 */
export function handleIngestInspect(
  body: InspectBody,
  projectRoot: string | undefined | null,
  engineRoot: string,
): HandlerResult {
  const ownership = ingestSourceOwnership(projectRoot, engineRoot);
  if (!ownership.writable || !ownership.projectRoot) {
    return { status: 403, body: { error: ownership.reason } };
  }
  const site = body.site ?? {};
  const surface = surfaceOf(body.surface);
  const writeScope = writeScopeOf(body.writeScope);
  if (
    typeof site.file !== 'string' ||
    typeof site.line !== 'number' ||
    typeof site.col !== 'number' ||
    typeof body.instances !== 'number' ||
    !Array.isArray(body.properties) ||
    surface === 'invalid' ||
    writeScope === 'invalid'
  ) {
    return { status: 400, body: { error: 'malformed creation-site inspect request' } };
  }
  const resolved = resolveIngestSourceFile(site.file, ownership.projectRoot, engineRoot);
  if (!resolved) {
    return { status: 403, body: { error: 'the creation site is not a file inside this project' } };
  }
  settlePendingRecord(resolved, engineRoot);
  const source = readFileSync(resolved, 'utf8');
  const properties: Record<string, CreationSiteLiteralReport> = {};
  for (const entry of body.properties as ReadonlyArray<{ property?: unknown; live?: unknown }>) {
    if (typeof entry?.property !== 'string') continue;
    properties[entry.property] = readCreationSiteLiteral(source, {
      site: { file: site.file, line: site.line, col: site.col },
      instances: body.instances,
      writeScope,
      property: entry.property,
      surface,
      live: entry.live as CreationSiteLiteralRequest['live'],
    });
  }
  return { body: { file: site.file, properties } };
}

/** POST `/__ingest-source/read` — one scope-checked file, for history capture
 *  and the undo/redo preflight. */
export function handleIngestRead(
  body: { file?: unknown },
  projectRoot: string | undefined | null,
  engineRoot: string,
): HandlerResult {
  const ownership = ingestSourceOwnership(projectRoot, engineRoot);
  if (!ownership.writable || !ownership.projectRoot) {
    return { status: 403, body: { error: ownership.reason } };
  }
  const resolved = resolveIngestSourceFile(body.file, ownership.projectRoot, engineRoot);
  if (!resolved) return { status: 403, body: { error: 'file out of project scope' } };
  settlePendingRecord(resolved, engineRoot);
  const bytes = readFileSync(resolved);
  // Binary comes back base64-tagged so the caller can hand the SAME bytes back
  // through `apply` for undo — which is the only thing that makes undo of a
  // level-data edit byte-exact.
  const binary = looksBinary(bytes);
  return {
    body: {
      source: binary ? bytes.toString('base64') : bytes.toString('utf8'),
      encoding: binary ? 'base64' : 'utf8',
      sha: sha256(bytes),
      resourcePath: resourcePathOf(resolved, ownership.projectRoot, engineRoot),
    },
  };
}

/**
 * THE MODULE GRAPH `handleIngestApply` MUST INVALIDATE — and why the editor
 * cannot leave that to the file watcher.
 *
 * The editor writes the ingested game's own bytes itself, so making that write
 * visible to the next mount is its own job. Vite serves a source module from
 * `ModuleGraph.transformResult` until something invalidates it, and the only
 * thing that ever did here was the filesystem watcher's change event. Where the
 * watcher is not watching, the write lands on disk, the ack is honest, the diff
 * is real — and the next mount re-derives the game from the PRE-EDIT bytes.
 *
 * That is not a hypothetical environment: the root config's
 * `server.watch.ignored` carries a `.claude` glob (it stops one agent
 * worktree's churn reloading every OTHER live session's tab), so every project
 * opened from inside a worktree gets no watcher event for its own source at
 * all. Measured on the `/__ui-source/*` family first — an authored
 * `position={[0,1.5,0]}` read back as `[0,0,0]` after a reload — and closed
 * there by the kit's `writeSource` service (`project-serving-services.ts`). This is the
 * same defect on the ingest lane's own write door, closed the same way. A write
 * path may not depend on an ignore list it does not own.
 *
 * Graph-only, deliberately: this stamps invalidation exactly the way
 * `handleProjectScriptHotUpdate` does when it swallows Vite's HMR, and sends no
 * client event, so hot-update behaviour on a watched project is untouched (its
 * watcher event still arrives and still drives the custom events) and stamping
 * twice is idempotent.
 */
let writtenSourceInvalidationGraph: HmrInvalidationGraph | undefined;
let writtenSourceStampBoundary: ((moduleFile: string) => boolean) | undefined;

/** Called once by `creationSiteWritePlugin`'s `configureServer` — these routes
 *  are mounted on exactly one dev server. `stampBoundary` bounds the stamp's
 *  importer propagation at editor-chrome modules (see
 *  `project-script-hmr.ts`'s `stampHmrInvalidation` doc for the
 *  split-singleton failure an unbounded walk shipped): a written GAME module
 *  must re-evaluate on the next mount, and the editor modules that imported
 *  it must not be re-instanced mid-session. */
export function bindIngestWriteInvalidation(
  graph: HmrInvalidationGraph,
  stampBoundary?: (moduleFile: string) => boolean,
): void {
  writtenSourceInvalidationGraph = graph;
  writtenSourceStampBoundary = stampBoundary;
}

function invalidateWrittenSource(file: string): void {
  if (!writtenSourceInvalidationGraph) return;
  const outcome = stampHmrInvalidation(
    writtenSourceInvalidationGraph,
    file,
    undefined,
    writtenSourceStampBoundary,
  );
  const warning = staleModuleWarning(file, outcome);
  if (warning) console.warn(warning);
}

/**
 * POST `/__ingest-source/apply` — the guarded whole-file write used by commit,
 * undo and redo.
 *
 * `ifMatchSha` is not optional and there is no force: a stale digest means the
 * file changed under us, and the only honest response is to refuse and say so.
 *
 * THE RECORDER RUNS INSIDE THIS ROUTE, not beside it. When the target is a
 * repo-vendored game, the bytes and that game's lock move in ONE operation
 * (`writeRecordedVendoredFile`), so there is no instant at which the file has
 * changed and its lock has not. Undo needs no counterpart: it comes back
 * through this same route with the previous bytes, and the recorder reconciles
 * to whatever those bytes are — including all the way back to upstream's own,
 * which removes the record entirely.
 *
 * `note` is an optional hint from the client naming the edit (the property and
 * the creation site) for the generated record. It is a HINT: the record's
 * truth — the diff and both shas — is derived from the bytes on either side, so
 * an absent or stale note can make the prose less specific and can never make
 * it wrong.
 */
export function handleIngestApply(
  body: {
    file?: unknown;
    source?: unknown;
    encoding?: unknown;
    ifMatchSha?: unknown;
    note?: unknown;
  },
  projectRoot: string | undefined | null,
  engineRoot: string,
): HandlerResult {
  const ownership = ingestSourceOwnership(projectRoot, engineRoot);
  if (!ownership.writable || !ownership.projectRoot) {
    return { status: 403, body: { applied: false, error: ownership.reason } };
  }
  const resolved = resolveIngestSourceFile(body.file, ownership.projectRoot, engineRoot);
  if (!resolved)
    return { status: 403, body: { applied: false, error: 'file out of project scope' } };
  if (typeof body.source !== 'string' || typeof body.ifMatchSha !== 'string') {
    return { status: 400, body: { applied: false, error: 'malformed apply request' } };
  }
  const next = decodeSource(body.source, body.encoding);
  if (next === null) {
    return {
      status: 400,
      body: {
        applied: false,
        error: `unknown source encoding ${String(body.encoding)} — expected "utf8" or "base64"`,
      },
    };
  }
  settlePendingRecord(resolved, engineRoot);
  const vendored = findVendoredTarget(resolved, engineRoot);
  const current = readFileSync(resolved);
  // Every path below this line reads `current`, which is now settled.
  const currentSha = sha256(current);
  if (currentSha !== body.ifMatchSha) {
    return {
      status: 409,
      body: {
        applied: false,
        error: 'the file changed on disk since this edit was planned',
        sha: currentSha,
      },
    };
  }
  if (vendored) {
    const outcome = writeRecordedVendoredFile(
      vendored,
      next,
      typeof body.note === 'string' ? body.note : undefined,
    );
    if (!outcome.ok) {
      // The lock could not be brought along, so the bytes do not move either:
      // an unrecordable edit to a vendored game is refused, never written.
      return {
        status: 409,
        body: {
          applied: false,
          error: `the edit was not written — its divergence could not be recorded in ${vendored.id}'s lock: ${outcome.error}`,
        },
      };
    }
    invalidateWrittenSource(resolved);
    return { body: { applied: true, sha: sha256(next), recorded: outcome.recorded } };
  }
  writeFileSync(resolved, next);
  invalidateWrittenSource(resolved);
  return { body: { applied: true, sha: sha256(next) } };
}

/** GET `/__ingest-source/ownership`. */
export function handleIngestOwnership(
  projectRoot: string | undefined | null,
  engineRoot: string,
): HandlerResult {
  return { body: ingestSourceOwnership(projectRoot, engineRoot) };
}
