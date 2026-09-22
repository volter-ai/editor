/**
 * THE PROJECT WATCHER — the half of the editor server that reacts to the
 * filesystem rather than to a request.
 *
 * Four things, and they are one subsystem because they share the same
 * chokidar streams and the same debounce discipline:
 *
 *  - **Asset watching**, with move detection: an unlink followed within
 *    `MOVE_WINDOW_MS` by an add of identical bytes is a MOVE, not a delete,
 *    and the hash/size cache is what makes that decidable without re-reading
 *    the whole tree.
 *  - **The component index**, invalidated by `src/` writes and warmed lazily,
 *    so the inspector's component list is a live folder scan and never a
 *    cached manifest.
 *  - **Per-file validation**, whose verdicts reach the terminal, the SSE
 *    broadcast and the replayable validation log through ONE formatter, so a
 *    replayed line and a live one render identically.
 *  - **The build-discipline tripwires**, which ride the save event and the
 *    play event and nothing else.
 *
 * It takes a `ProjectWatchHost` rather than the full route context: this runs
 * BEFORE the context exists (the context reads several of its outputs), and
 * the narrow interface is what makes that ordering possible instead of
 * circular. Everything mutable it owns is exposed as an accessor for the same
 * reason the context does it — a project switch reassigns the roots underneath
 * a watcher that is already running.
 */

import { type Dirent, existsSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { MANIFEST_FILENAME } from '@volter/editor-project/manifest/filename';
import { resolveManifestPath } from '@volter/editor-project/manifest/locate';
import {
  advancePersistedTripwireGate,
  commitCadenceBanner,
  commitCadenceGateKey,
  commitCadenceTier,
  IDLE_TRIPWIRE_GATE,
  newestEvidenceMtime,
  readUncommittedWork,
  shouldEvaluateTripwires,
  type TripwireGate,
  unplayedSessionBanner,
  unplayedSessionGateKey,
  unplayedSessionTier,
} from './support/project/build-discipline';
import type { SessionJournalEvent } from './support/project/session-journal';
import type { ProjectComponentEntry } from '../src/asset-workflow/project-content';
import { ADAPTER_MODULE_FILENAME } from '../src/ui-source/adapter-region-includes';
import { canonicalProjectRoot } from './canonical-path';
import type { AgentAuthorLease } from './collaboration-attribution';
import { filesystemMutationAuthor } from './collaboration-attribution';
import type { CollaborationSession } from './collaboration-session';
import type { ConsoleLedger } from './console-ledger';
import { broadcast } from './editor-sse';
import { discoverProjectComponents } from './project-components';
import { collaborationSourceSnapshot, hashAndSize, scanDirForHashes } from './project-file-scan';
import { classifyValidatableFile, validateProjectFile } from './project-validation';
import type { SourceValidationState } from './routes/context';
import {
  classifyProjectSrcPath,
  findUniqueMoveMatch,
  isPathInside,
  projectStorySourceDirs,
  resolveWatcherPollOptions,
} from './server-utils';

/** What the watcher needs from the session it belongs to. */
export interface ProjectWatchHost {
  readonly engineRoot: string;
  readonly consoleLedger: Pick<ConsoleLedger, 'resolve'>;
  /** Read live — a project switch reassigns both under a running watcher. */
  readonly projectRoot: () => string;
  readonly publicRoot: () => string;
  readonly journalEvent: (event: SessionJournalEvent) => void;
  readonly servingProjectSince: () => number;
  /** The open project's collaboration session, or `null` when none is open. */
  readonly currentCollaboration: () => CollaborationSession | null;
  /** (Re)bind the collaboration session after a project switch. */
  readonly bindCollaboration: () => void;
  /** The live agent-author lease, so a watched write is attributed correctly. */
  readonly recentAgentAuthor: () => AgentAuthorLease | null;
  /** The open project's parsed manifest, or `null` when it cannot be read. */
  readonly readProjectManifest: () => unknown;
}

export interface ProjectWatch {
  /** (Re)start every watcher for whatever the roots now are. */
  readonly start: () => void;
  readonly currentProjectComponents: () => Promise<ProjectComponentEntry[]>;
  readonly currentValidationLogEntries: () => { level: 'error' | 'warn'; message: string }[];
  readonly announceBuildDisciplineTripwires: () => void;
  readonly projectValidation: Map<string, { errors: string[]; at: number }>;
  readonly projectWarnings: Map<string, { warnings: string[]; at: number }>;
  readonly expectedEditorMutations: Map<string, { sha: string | null; expiresAt: number }>;
  sourceValidation: SourceValidationState;
  cadenceGate: TripwireGate;
  unplayedGate: TripwireGate;
  publicAssetsLastChangedAt: number | null;
  publicAssetsLastPath: string | null;
  publicAssetsChangedCount: number;
  /** Teardown: stop every stream and clear every pending timer. */
  readonly close: () => Promise<void>;
}

/** Does a manifest (as read, unvalidated) declare any root — anything `vgai play`
 *  could run? A models project declares `roots: []`. */
function manifestDeclaresRoots(manifest: unknown): boolean {
  const roots = (manifest as { roots?: unknown } | null)?.roots;
  return Array.isArray(roots) && roots.length > 0;
}

export function createProjectWatch(host: ProjectWatchHost): ProjectWatch {
  const { bindCollaboration, currentCollaboration, engineRoot, journalEvent, readProjectManifest } =
    host;

  // P20 — the OTHER half of the load clock. `lastIndexRequestAt` (the server's)
  // says when the running document loaded; these say when bytes under
  // `public/` last moved. A write that POSTDATES the load is the divergence
  // `vgai restart` used to paper over: `restart` remounts every root from
  // fresh SOURCE, and re-running module-scope loaders against a page-lifetime
  // asset cache (Pixi `Assets`, three's loader caches) can hand the remounted
  // world the OLD bytes with nothing reporting it. Naming the divergence is
  // all this does — invalidation is not built here (P20 stays open).
  let publicAssetsLastChangedAt: number | null = null;
  let publicAssetsLastPath: string | null = null;
  let publicAssetsChangedCount = 0;

  // ---- File hash cache + move detection ----
  const fileHashCache = new Map<string, string>();
  const fileSizeCache = new Map<string, number>();

  interface PendingUnlink {
    absPath: string;
    relativePath: string;
    hash: string;
    size: number;
    timestamp: number;
  }

  const MOVE_WINDOW_MS = 3000;
  const pendingUnlinks: PendingUnlink[] = [];

  // ---- Asset move broadcast ----
  //
  // BROADCAST ONLY. The watcher deliberately rewrites no file itself: asset-ref
  // rewriting for the formats that DO carry references lives in the editor's own
  // `asset-workflow/project-asset-operations.ts`, which routes writes through
  // project history rather than writing behind the editor's back.
  async function handleAssetMove(oldPath: string, newPath: string): Promise<void> {
    broadcast('asset-moved', { oldPath, newPath, updatedFiles: [] });
  }

  // ---- Chokidar watcher ----
  let watcher: FSWatcher | null = null;
  // An editor-owned atomic write is also observed by chokidar. Match that
  // event by path and resulting digest so it cannot race the authoritative
  // editor mutation into a duplicate, misattributed filesystem revision.
  const expectedEditorMutations = new Map<string, { sha: string | null; expiresAt: number }>();
  let srcWatcher: FSWatcher | null = null;
  let referencesWatcher: FSWatcher | null = null;
  let manifestWatcher: FSWatcher | null = null;

  // The component index is DERIVED from project source, never a manifest and
  // never persisted. Its first cold scan used to sit directly on the 3D-board
  // gesture (715ms–3.6s in Doctor). Prime it while the editor is booting and
  // invalidate from the same source/declaration watchers that define its
  // inputs. A generation check prevents a request whose scan overlapped a
  // save from publishing the pre-save answer.
  let componentIndexGeneration = 0;
  let componentIndexCache: {
    readonly root: string;
    readonly generation: number;
    readonly promise: ReturnType<typeof discoverProjectComponents>;
  } | null = null;
  let componentIndexWarmTimer: ReturnType<typeof setTimeout> | null = null;
  function invalidateComponentIndex(): void {
    componentIndexGeneration += 1;
    componentIndexCache = null;
    if (componentIndexWarmTimer) clearTimeout(componentIndexWarmTimer);
    if (host.projectRoot() === engineRoot) return;
    // Source saves frequently arrive as a short chokidar burst. Re-prime once
    // at its trailing edge so the NEXT gallery/board gesture does not inherit
    // the rescan, while never running one scan per low-level event.
    componentIndexWarmTimer = setTimeout(() => {
      componentIndexWarmTimer = null;
      void currentProjectComponents().catch(() => {});
    }, 100);
  }
  async function currentProjectComponents(): Promise<
    Awaited<ReturnType<typeof discoverProjectComponents>>
  > {
    if (host.projectRoot() === engineRoot) return [];
    const generation = componentIndexGeneration;
    const cached = componentIndexCache;
    const promise =
      cached && cached.root === host.projectRoot() && cached.generation === generation
        ? cached.promise
        : discoverProjectComponents(host.projectRoot());
    if (promise !== cached?.promise) {
      componentIndexCache = { root: host.projectRoot(), generation, promise };
    }
    let components: Awaited<ReturnType<typeof discoverProjectComponents>>;
    try {
      components = await promise;
    } catch (error) {
      // A failed cold scan is not a durable cache entry. The warm-up caller
      // deliberately ignores its failure; the first real request retries and
      // reports that result instead of inheriting a rejected promise forever.
      if (componentIndexCache?.promise === promise) componentIndexCache = null;
      throw error;
    }
    if (
      generation !== componentIndexGeneration ||
      componentIndexCache?.root !== host.projectRoot()
    ) {
      return currentProjectComponents();
    }
    return components;
  }

  // Coalesce event bursts (e.g. a git checkout adding several files at once)
  // into one broadcast per event name, trailing ~250ms after the last event.
  const pendingBroadcasts = new Map<string, ReturnType<typeof setTimeout>>();
  function broadcastDebounced(event: string, data: unknown, ms = 250): void {
    const existing = pendingBroadcasts.get(event);
    if (existing) clearTimeout(existing);
    pendingBroadcasts.set(
      event,
      setTimeout(() => {
        pendingBroadcasts.delete(event);
        broadcast(event, data);
      }, ms),
    );
  }

  // ---- Validate-on-change (owner decision, GitHub #103) ----
  //
  // Hand-editing project files is an accepted authoring path — the
  // requirement is that invalid output surfaces IMMEDIATELY and OBVIOUSLY
  // instead of only erroring at next load. `project-validation.ts` owns the
  // content check (reusing the engine's own Zod parsers, same ones
  // validate-scenes.ts/validate-manifest.ts run); this section owns
  // debouncing + the three report surfaces: the terminal, connected editor
  // tabs (the existing `server-log` SSE event `editor-console.ts` already
  // listens for — previously unused, since nothing ever broadcast it), and
  // `/__editor/state`'s `projectValidation` field.
  //
  // A file is present in `projectValidation` ONLY while it is currently
  // failing — a valid write removes its entry entirely ("ok" is represented
  // by absence, not a stored value), which is what keeps the happy path
  // silent both on the wire and in the terminal (rule 4: editor-originated
  // autosaves validate clean by construction and must produce zero noise).
  interface FileValidationFailure {
    errors: string[];
    at: number;
  }
  interface FileValidationWarnings {
    warnings: string[];
    at: number;
  }
  const projectValidation = new Map<string, FileValidationFailure>();
  const projectWarnings = new Map<string, FileValidationWarnings>();
  // PD-14: whether source validation (the `<project>/src` watcher and the
  // boot-equivalent tree scan behind it) is actually running.
  //
  // `'awaiting-src'` is the honest name for a project with no `src/` yet: the
  // watcher is armed on the not-yet-existing path and starts by itself when
  // the directory appears, but until then NOTHING under `src/` is checked.
  // That state used to be permanent AND silent — the source watcher was gated
  // on a single `existsSync()` at boot, so a project scaffolded into an
  // already-open editor (or one whose `src/` was deleted and recreated) was
  // never source-validated again for the server's whole lifetime, and every
  // surface reported a clean project that had simply never been looked at.
  // Degrade loudly: the terminal, the editor console (via the
  // `/__editor/validation-log` replay) and the status payload all say so.
  let sourceValidation: SourceValidationState = 'no-project';
  /**
   * The directories source validation covers — `projectStorySourceDirs` over
   * the open manifest, set by `startWatcher` and read by the warning below.
   *
   * NOT `<project>/src` alone. A repo-vendored game's manifest declares a root
   * whose `entry` resolves OUTSIDE the project folder
   * (`packages/editor/src/ingest/games/<id>/` holds the manifest and the host
   * shim; the game's source is `vendor/games/<id>/src/`), and the
   * ingest-authoring model writes THAT tree. Keying the scan on
   * `<project>/src` meant every such project reported "source validation is
   * NOT running" forever while the watcher beside it — already derived from
   * the manifest since it had the same bug — was watching the real source
   * tree the whole time. The two halves now read one set.
   */
  let sourceValidationDirs: string[] = [join(host.projectRoot(), 'src')];
  const validationDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const VALIDATION_DEBOUNCE_MS = 150;
  const MAX_PRINTED_ERRORS = 5;

  /** Project-relative, forward-slash path — the key `projectValidation` and
   *  the terminal/SSE messages use. */
  function relKey(absPath: string): string {
    return relative(host.projectRoot(), absPath).split(sep).join('/');
  }

  function printValidationFailure(rel: string, errors: string[]): void {
    const shown = errors.slice(0, MAX_PRINTED_ERRORS);
    const rest = errors.length - shown.length;
    console.error(
      `\n  \x1b[31m\x1b[1m✖ Invalid project file\x1b[0m \x1b[36m${rel}\x1b[0m\n` +
        shown.map((e) => `    \x1b[31m•\x1b[0m ${e}`).join('\n') +
        (rest > 0 ? `\n    … and ${rest} more issue(s)` : '') +
        '\n',
    );
  }

  function printValidationRecovery(rel: string): void {
    console.log(`  \x1b[32m✓ ${rel} is valid again\x1b[0m`);
  }

  function validationMessage(rel: string, errors: string[]): string {
    const shown = errors.slice(0, MAX_PRINTED_ERRORS);
    const rest = errors.length - shown.length;
    return (
      `Invalid project file ${rel}:\n` +
      shown.map((e) => `  - ${e}`).join('\n') +
      (rest > 0 ? `\n  … and ${rest} more issue(s)` : '')
    );
  }

  function warningMessage(rel: string, warnings: string[]): string {
    const shown = warnings.slice(0, MAX_PRINTED_ERRORS);
    const rest = warnings.length - shown.length;
    return (
      `R3F authoring conventions in ${rel}:\n` +
      shown.map((warning) => `  - ${warning}`).join('\n') +
      (rest > 0 ? `\n  … and ${rest} more warning(s)` : '')
    );
  }

  /** Every directory the scan covers that is not on disk — the reason
   *  validation is not running, named rather than assumed. */
  function missingSourceDirs(): string[] {
    return sourceValidationDirs.filter((dir) => !existsSync(dir));
  }

  /** PD-14: the one wording for "nothing under the project's source tree is
   *  being validated", shared by the terminal line, the live `server-log`
   *  broadcast and the `/__editor/validation-log` replay so all three read
   *  identically. It names EVERY declared source dir (see
   *  `sourceValidationDirs`), because for a repo-vendored game the one that
   *  matters is not `<project>/src`. */
  function sourceValidationWarningMessage(): string {
    const missing = missingSourceDirs();
    return (
      `Source validation is NOT running: ${missing.join(', ') || join(host.projectRoot(), 'src')} ` +
      `${missing.length === 1 ? 'does' : 'do'} not exist.\n` +
      "  Nothing under this project's source tree is being checked — the watcher " +
      'starts by itself the moment the directory appears (no editor restart needed).'
    );
  }

  /** Announce a change in whether source validation is running. Silent when
   *  nothing changed, and silent for the happy path (a project that has
   *  `src/` at boot) — same rule the per-file pass follows. */
  function setSourceValidation(next: SourceValidationState): void {
    const previous = sourceValidation;
    if (previous === next) return;
    sourceValidation = next;
    if (next === 'awaiting-src') {
      const message = sourceValidationWarningMessage();
      console.warn(
        `\n  \x1b[33m\x1b[1m⚠ Source validation is not running\x1b[0m\n    ${message.split('\n').join('\n  ')}\n`,
      );
      broadcast('server-log', { level: 'warn', message });
      return;
    }
    if (next === 'active' && previous === 'awaiting-src') {
      const message = `${sourceValidationDirs.filter((dir) => existsSync(dir)).join(', ')} appeared — source validation is running`;
      console.log(`  \x1b[32m✓ ${message}\x1b[0m`);
      broadcast('server-log', { level: 'info', message });
    }
  }

  /**
   * Every currently-known validation failure and authoring warning, shaped as
   * `server-log` payloads — the same `{ level, message }` the live broadcasts
   * below emit, so the editor console renders a replayed line identically to
   * one it received as it happened.
   *
   * PD-13: this exists because the live broadcast is the ONLY thing that ever
   * fed the editor console, and both maps are routinely populated before any
   * tab is connected (the boot scan) or re-populated with an unchanged set (no
   * re-broadcast, by design — see `runFileValidation`). Reading the maps at
   * connect time is what makes the console surface state rather than history.
   */
  function currentValidationLogEntries(): { level: 'error' | 'warn'; message: string }[] {
    const entries: { level: 'error' | 'warn'; message: string }[] = [];
    // PD-14: first, because it qualifies everything below it — an empty
    // failure list means nothing while the source pass is not running.
    if (sourceValidation === 'awaiting-src') {
      entries.push({ level: 'warn', message: sourceValidationWarningMessage() });
    }
    for (const [rel, failure] of projectValidation) {
      entries.push({ level: 'error', message: validationMessage(rel, failure.errors) });
    }
    for (const [rel, warned] of projectWarnings) {
      entries.push({ level: 'warn', message: warningMessage(rel, warned.warnings) });
    }
    return entries;
  }

  // ---- Build-discipline tripwires on the save event (P53) ----
  //
  // "This work has been uncommitted for 40 minutes" and "this session has
  // never once played the game" used to reach an agent through `vgai status`
  // and nowhere else. Measured on a blind probe: a 17-minute build ran the
  // editor, `playtest` and `eval` and invoked `vgai status` ZERO times, so
  // neither banner had a delivery path and the build still landed as one
  // end-of-run commit. The mechanisms were right; "a building agent polls
  // status constantly" was false.
  //
  // This terminal is the one an agent DOES watch — it is where save-validation
  // failures appear — so the same banners ride the save event that is already
  // being handled a few lines below. Deliberately not a timer and not a new
  // watcher: no event, no reads. `@vgai/sdk/build-discipline` owns every word
  // and every threshold; this is only a channel.
  let cadenceGate: TripwireGate = IDLE_TRIPWIRE_GATE;
  let unplayedGate: TripwireGate = IDLE_TRIPWIRE_GATE;

  /**
   * Report whichever tripwire just CROSSED a step, at most once per crossing.
   *
   * Two bounds, both from `build-discipline.ts` and both needed because a
   * "save" here means a chokidar event and an agent's write wave is dozens of
   * them a second: `shouldEvaluateTripwires` caps how often the git/stat reads
   * run at all, and the gate prints only when the measured step is higher than
   * the highest one already printed (so a burst prints once, the escalation
   * prints again, and a commit or a play re-arms it).
   *
   * The gate is `advancePersistedTripwireGate`, not the in-memory fold: this
   * process restarts far more often than a dirty batch resolves, and a gate
   * that lived only here re-armed at "nothing announced" on every restart — a
   * measured 45-minute build was NOTICED three times and never once escalated
   * to the loud step. See that function's header for the whole story.
   */
  function announceBuildDisciplineTripwires(): void {
    if (host.projectRoot() === engineRoot) return;
    const now = Date.now();
    // The two gates advance together, so either one answers "is a read due?".
    if (!shouldEvaluateTripwires(cadenceGate, now)) return;
    try {
      const work = readUncommittedWork(host.projectRoot(), now);
      const cadenceTier = commitCadenceTier(work);
      const cadenceStep = advancePersistedTripwireGate(
        host.projectRoot(),
        'commit-cadence',
        commitCadenceGateKey(host.projectRoot()),
        cadenceGate,
        cadenceTier,
        now,
      );
      cadenceGate = cadenceStep.gate;
      if (cadenceStep.announce) {
        // Journal the CROSSING as data first, then render the banner — the
        // banner is prose an agent may never look at, the line is the fact.
        journalEvent({
          kind: 'tripwire',
          tripwire: 'commit-cadence',
          tier: cadenceTier,
          ageMs: work?.ageMs ?? 0,
          fileCount: work?.fileCount ?? 0,
        });
        const banner = commitCadenceBanner(work);
        if (banner) console.warn(`\n${banner}\n`);
      }

      const evidence = newestEvidenceMtime(host.projectRoot());
      const playable = manifestDeclaresRoots(readProjectManifest());
      const unplayedTier = unplayedSessionTier(host.servingProjectSince(), evidence, now, playable);
      const unplayedStep = advancePersistedTripwireGate(
        host.projectRoot(),
        'unplayed-session',
        unplayedSessionGateKey(evidence),
        unplayedGate,
        unplayedTier,
        now,
      );
      unplayedGate = unplayedStep.gate;
      if (unplayedStep.announce) {
        journalEvent({
          kind: 'tripwire',
          tripwire: 'unplayed-session',
          tier: unplayedTier,
          servingForMs: now - host.servingProjectSince(),
        });
        const banner = unplayedSessionBanner(host.servingProjectSince(), evidence, now, playable);
        if (banner) console.warn(`\n${banner}\n`);
      }
    } catch {
      // A tripwire that breaks a save is worse than a tripwire that misses one.
    }
  }

  /**
   * The ONE emit point for a save-validation verdict.
   *
   * It appends the journal line and THEN renders it to the two live surfaces
   * (this terminal, the editor console). Nothing prints a verdict anywhere
   * else, which is what makes "no event prints without journaling" structural
   * rather than a convention: a renderer that forgot the journal would have to
   * be a second copy of this function.
   *
   * Only the surface-worthy TRANSITIONS pass through here — the same set that
   * already printed. A clean save over an already-clean file stays silent in
   * the journal too (the happy-path silence rule), so the file an agent reads
   * is a record of what changed, not a keystroke log.
   */
  function emitValidationVerdict(
    rel: string,
    fileKind: string,
    verdict:
      | { outcome: 'error'; errors: string[] }
      | { outcome: 'recovered' }
      | { outcome: 'warning'; warnings: string[] },
  ): void {
    if (verdict.outcome === 'error') {
      journalEvent({
        kind: 'validation',
        path: rel,
        fileKind,
        ok: false,
        errors: verdict.errors,
      });
      printValidationFailure(rel, verdict.errors);
      broadcast('server-log', { level: 'error', message: validationMessage(rel, verdict.errors) });
      return;
    }
    if (verdict.outcome === 'recovered') {
      journalEvent({ kind: 'validation', path: rel, fileKind, ok: true });
      printValidationRecovery(rel);
      broadcast('server-log', { level: 'info', message: `${rel} is valid again` });
      return;
    }
    journalEvent({
      kind: 'validation',
      path: rel,
      fileKind,
      ok: true,
      warnings: verdict.warnings,
    });
    const message = warningMessage(rel, verdict.warnings);
    console.warn(
      `\n  \x1b[33m\x1b[1m⚠ R3F authoring warnings\x1b[0m \x1b[36m${rel}\x1b[0m\n${message.split('\n').slice(1).join('\n')}\n`,
    );
    broadcast('server-log', { level: 'warn', message });
  }

  /** Run (already-debounced) validation for one absolute path and report the
   *  result on all three surfaces. Non-validatable paths are a silent no-op
   *  so callers can invoke this unconditionally from watcher events. */
  async function runFileValidation(absPath: string): Promise<void> {
    const kind = classifyValidatableFile(absPath);
    if (!kind) return;
    // A project file just landed — the event the tripwires ride. Before the
    // validation result, because it must fire whether the save was valid or
    // not: a broken save is not a reason to go quiet about the last 40
    // minutes.
    announceBuildDisciplineTripwires();
    const rel = relKey(absPath);
    const result = await validateProjectFile(absPath, kind, { engineRoot });
    const previousErrors = projectValidation.get(rel)?.errors ?? [];
    const wasFailing = previousErrors.length > 0;
    const previousWarnings = projectWarnings.get(rel)?.warnings ?? [];
    const warnings = result.warnings ?? [];
    if (previousWarnings.length && JSON.stringify(previousWarnings) !== JSON.stringify(warnings)) {
      host.consoleLedger.resolve(
        [{ severity: 'warn', message: warningMessage(rel, previousWarnings) }],
        'project-validation',
      );
    }
    if (
      previousErrors.length &&
      (result.ok || JSON.stringify(previousErrors) !== JSON.stringify(result.errors))
    ) {
      host.consoleLedger.resolve(
        [{ severity: 'error', message: validationMessage(rel, previousErrors) }],
        'project-validation',
      );
    }
    if (warnings.length === 0) {
      projectWarnings.delete(rel);
    } else {
      projectWarnings.set(rel, { warnings, at: Date.now() });
      if (JSON.stringify(previousWarnings) !== JSON.stringify(warnings)) {
        emitValidationVerdict(rel, kind, { outcome: 'warning', warnings });
      }
    }

    if (result.ok) {
      if (wasFailing) {
        projectValidation.delete(rel);
        emitValidationVerdict(rel, kind, { outcome: 'recovered' });
      }
      // Clean write, never previously failing — the happy-path silence rule:
      // no terminal line, no broadcast, no state entry.
      return;
    }

    projectValidation.set(rel, { errors: result.errors, at: Date.now() });
    emitValidationVerdict(rel, kind, { outcome: 'error', errors: result.errors });
  }

  /** Debounce per absolute file path (~150ms) so a burst of writes to the
   *  same file (editors/OSes routinely write-then-touch, or write in two
   *  chunks) triggers exactly one validation pass. */
  function scheduleFileValidation(absPath: string): void {
    if (!classifyValidatableFile(absPath)) return;
    const existing = validationDebounceTimers.get(absPath);
    if (existing) clearTimeout(existing);
    validationDebounceTimers.set(
      absPath,
      setTimeout(() => {
        validationDebounceTimers.delete(absPath);
        void runFileValidation(absPath);
      }, VALIDATION_DEBOUNCE_MS),
    );
  }

  /** A deleted file can no longer be "invalid" — drop any stale entry/timer
   *  so `projectValidation` doesn't keep reporting a ghost error. */
  function clearFileValidation(absPath: string): void {
    const timer = validationDebounceTimers.get(absPath);
    if (timer) {
      clearTimeout(timer);
      validationDebounceTimers.delete(absPath);
    }
    const rel = relKey(absPath);
    const errors = projectValidation.get(rel)?.errors;
    const warnings = projectWarnings.get(rel)?.warnings;
    if (errors)
      host.consoleLedger.resolve(
        [{ severity: 'error', message: validationMessage(rel, errors) }],
        'project-validation',
      );
    if (warnings)
      host.consoleLedger.resolve(
        [{ severity: 'warn', message: warningMessage(rel, warnings) }],
        'project-validation',
      );
    projectValidation.delete(rel);
    projectWarnings.delete(rel);
  }

  async function validateSourceTree(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith('.'))
        .map(async (entry) => {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) return validateSourceTree(full);
          if (entry.isFile()) return runFileValidation(full);
        }),
    );
  }

  function startWatcher(): void {
    watcher?.close();
    srcWatcher?.close();
    referencesWatcher?.close();
    manifestWatcher?.close();
    srcWatcher = null;
    referencesWatcher = null;
    manifestWatcher = null;
    fileHashCache.clear();
    fileSizeCache.clear();
    pendingUnlinks.length = 0;
    invalidateComponentIndex();
    // Validation state is project-scoped — a previous project's failures
    // must not leak into (or block reporting for) the newly opened one.
    for (const timer of validationDebounceTimers.values()) clearTimeout(timer);
    validationDebounceTimers.clear();
    projectValidation.clear();
    projectWarnings.clear();
    // PD-14: reset before the src watcher re-decides below, so the newly
    // opened project ANNOUNCES its own state (a src-less project switched to
    // from a healthy one must warn) rather than inheriting the previous
    // project's — and so a project that has `src/` stays silent either way.
    sourceValidation = 'no-project';
    // …and the SET it is a verdict about, so a project opened before the src
    // watcher re-derives below cannot be described by the previous one's dirs.
    sourceValidationDirs = [join(host.projectRoot(), 'src')];
    bindCollaboration();
    const snapshotRoot = host.projectRoot();
    const snapshotSession = currentCollaboration();
    const snapshotRevision = snapshotSession?.snapshot().revision ?? 0;
    if (snapshotSession) {
      void collaborationSourceSnapshot(snapshotRoot)
        .then((resources) => {
          if (canonicalProjectRoot(host.projectRoot()) !== canonicalProjectRoot(snapshotRoot))
            return;
          // The initial scan is only a baseline. If an editor write or watcher
          // revision landed while the filesystem walk was in flight, applying
          // its later view would race that attributed mutation and steal its
          // authorship as a generic filesystem change.
          if (snapshotSession.snapshot().revision !== snapshotRevision) return;
          snapshotSession.synchronizeSourceSnapshot('host', resources);
        })
        .catch((error) => {
          broadcast('server-log', {
            level: 'error',
            message: `Collaboration source baseline failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        });
    }

    const recordFilesystemMutation = async (
      absPath: string,
      knownSha?: string | null,
    ): Promise<void> => {
      const collaboration = currentCollaboration();
      const abs = resolve(absPath);
      if (!collaboration || !isPathInside(host.projectRoot(), abs)) return;
      try {
        const sha = knownSha === undefined ? (await hashAndSize(abs)).hash : knownSha;
        const relativePath = relative(host.projectRoot(), abs).split(sep).join('/');
        const expected = expectedEditorMutations.get(relativePath);
        if (expected) {
          if (expected.expiresAt >= Date.now() && expected.sha === sha) return;
          expectedEditorMutations.delete(relativePath);
        }
        collaboration.recordSourceMutation({
          authorId: filesystemMutationAuthor(host.recentAgentAuthor()),
          source: 'filesystem',
          resources: [{ path: relativePath, sha }],
        });
      } catch {
        // A write may be replaced again before chokidar's event is handled;
        // the subsequent event records the bytes that actually survived.
      }
    };

    // Seed hash cache in background
    scanDirForHashes(host.publicRoot(), fileHashCache, fileSizeCache);

    // #131: on drvfs (WSL /mnt/<drive>) inotify never fires, so without
    // polling every broadcast below is dead and the editor UI sits stale
    // until a manual refresh. Auto-detection keys off the PROJECT root and is
    // skipped in engine-repo mode (host.projectRoot() === engineRoot), where
    // `public/` includes the vendored-game trees — `VGAI_WATCH_POLL` still
    // forces it there. Re-derived on every startWatcher() call so a project
    // switch onto/off a drvfs mount re-decides correctly.
    const pollOptions = resolveWatcherPollOptions(
      host.projectRoot() === engineRoot ? null : host.projectRoot(),
    );

    watcher = chokidar.watch(host.publicRoot(), {
      ignoreInitial: true,
      ignored: /(^|[/\\])\../, // ignore dotfiles
      ...pollOptions,
    });

    const broadcastPublicAssetChanged = (absPath: string): void => {
      const path = relative(host.publicRoot(), absPath).split(sep).join('/');
      // P20 — the session's own record that bytes under `public/` MOVED, and
      // when. This watcher is the door rather than the project-outputs writer
      // (`project-output-writer.ts`) deliberately: the writer sees only the
      // batches that go through it, while this sees the bytes actually
      // landing — a bake through the outputs door, a `vgai add` copy, and a
      // hand-written file all stamp the same way, because what matters
      // downstream is that the running document's caches predate them.
      publicAssetsLastChangedAt = Date.now();
      publicAssetsLastPath = path;
      publicAssetsChangedCount += 1;
      broadcast('assets-changed', { paths: [path] });
    };

    watcher.on('change', async (filePath: string) => {
      const abs = resolve(filePath);
      if (!isPathInside(host.publicRoot(), abs)) return;
      try {
        const { hash, size } = await hashAndSize(abs);
        fileHashCache.set(abs, hash);
        fileSizeCache.set(abs, size);
        void recordFilesystemMutation(abs, hash);
      } catch {
        /* ignore */
      }

      // Validate-on-change (#103): a hand-edited (or autosaved) document change
      // gets checked against the engine's own Zod parsers — see the
      // "Validate-on-change" section above and `classifyValidatableFile`.
      scheduleFileValidation(abs);
      broadcastPublicAssetChanged(abs);
    });

    watcher.on('unlink', (filePath: string) => {
      const abs = resolve(filePath);
      if (!isPathInside(host.publicRoot(), abs)) return;
      clearFileValidation(abs);
      void recordFilesystemMutation(abs, null);
      broadcastPublicAssetChanged(abs);
      const hash = fileHashCache.get(abs);
      const size = fileSizeCache.get(abs);
      if (hash !== undefined && size !== undefined) {
        const rel = `/${relative(host.publicRoot(), abs)}`;
        pendingUnlinks.push({ absPath: abs, relativePath: rel, hash, size, timestamp: Date.now() });
        fileHashCache.delete(abs);
        fileSizeCache.delete(abs);
      }
    });

    watcher.on('add', async (filePath: string) => {
      const abs = resolve(filePath);
      if (!isPathInside(host.publicRoot(), abs)) return;
      // A brand-new scene file (not just an edit of an existing one)
      // deserves the same immediate check.
      scheduleFileValidation(abs);
      broadcastPublicAssetChanged(abs);

      try {
        const { hash, size } = await hashAndSize(abs);
        fileHashCache.set(abs, hash);
        fileSizeCache.set(abs, size);
        void recordFilesystemMutation(abs, hash);

        // SC2: only treat a delete+create as a move when it is unambiguous —
        // matching hash AND size, and a single such pending unlink. Otherwise
        // an unrelated delete+create could silently rewrite scene refs.
        const match = findUniqueMoveMatch(pendingUnlinks, hash, size, Date.now(), MOVE_WINDOW_MS);
        if (match) {
          const idx = pendingUnlinks.indexOf(match);
          if (idx >= 0) pendingUnlinks.splice(idx, 1);
          const newRelPath = `/${relative(host.publicRoot(), abs)}`;
          await handleAssetMove(match.relativePath, newRelPath);
        }
      } catch {
        /* ignore read errors */
      }
    });

    // ---- Second watcher: <project>/src (W6a) ----
    //
    // The watcher above is scoped to `host.publicRoot()` (`<project>/public`) only —
    // it never sees `src/tools/*.tool.tsx` or `src/**/*.stories.tsx`, so a
    // NEW file there never showed up without a full editor reload (spec §7
    // W4 field note c). Vite's own HMR (`vgai-script-hmr` in dev.ts, and
    // `tool-loader.ts`'s listener on it) only fires on `change`, and the
    // `VGAI_WATCH_POLL` poll-watcher (dev.ts) forwards its synthetic events
    // into VITE's chokidar watcher only — never into this one. So this
    // second watcher is self-contained here: it works in dev AND
    // packaged/prod (this module is shared by both), and on drvfs
    // (`/mnt/c`, no inotify) via the same `VGAI_WATCH_POLL` env var.
    //
    // Tool/story lists use add/unlink. Registered tool modules also use
    // change because their metadata and implementation are Node-loaded.
    //
    // PD-14: this used to be gated on `existsSync(srcDir)`, evaluated ONCE
    // here — so a project with no `src/` at boot got neither this watcher nor
    // the `validateSourceTree` scan below, for the server's entire lifetime.
    // That is the exact shape of an agent scaffolding into an already-open
    // editor, and of a `src/` deleted and restored (a branch switch, a
    // regenerate). The gate is gone: chokidar watches a not-yet-existing path
    // fine — the same property the manifest watcher below already relies on,
    // and measured for a DIRECTORY on chokidar 5 (an `addDir` for `src`
    // itself, then `add` per file, including a fully-populated directory
    // renamed into place and a delete/recreate cycle). Presence is therefore a
    // RUNTIME transition (`addDir`/`unlinkDir` on a watched dir), never a boot
    // fact.
    if (host.projectRoot() !== engineRoot) {
      // Every STORY SOURCE DIR the manifest implies, not just `<project>/src`
      // — for a project whose root entry lives outside its folder (a
      // repo-vendored game) that game's own source tree is where its stories
      // are, so watching only `<project>/src` would leave "add a story, the
      // board appears" dead there while it works everywhere else. Same set the
      // `/__editor/story-files` scan uses; `projectStorySourceDirs` always
      // leads with `<project>/src`, so the tools half below is unaffected.
      //
      // VALIDATION reads the same set (`sourceValidationDirs`). The two halves
      // used to disagree — this watcher derived, the validation scan and its
      // "is it running" predicate hard-coded to `<project>/src` — so a
      // repo-vendored game watched the right tree and reported, permanently,
      // that nothing was being checked.
      const watchDirs = projectStorySourceDirs(host.projectRoot(), readProjectManifest());
      sourceValidationDirs = watchDirs;
      // #131: same polling decision as the host.publicRoot() watcher above (env
      // contract matches dev.ts's poller; auto-on for drvfs projects).
      srcWatcher = chokidar.watch(watchDirs, {
        ignoreInitial: true,
        ignored: /(^|[/\\])\../, // ignore dotfiles
        ...pollOptions,
      });
      const onListChange = (filePath: string) => {
        const rel = relative(host.projectRoot(), resolve(filePath)).split(sep).join('/');
        const kind = classifyProjectSrcPath(rel);
        const event = kind
          ? {
              tools: 'tool-files-changed',
              stories: 'story-files-changed',
            }[kind]
          : // Everything else under src/ — a model module, a page, a data
            // file a contributed FINDER reads. The adapter table is built
            // from those files and nothing imports them, so no HMR reaches
            // the page when one appears: a models project's Content panel
            // did not list a new `src/models/*.ts` until something unrelated
            // refreshed the table (measured 2026-09-06, an owner watching an
            // agent's mushroom sit as "a ts file"). The page refreshes the
            // table when the path matches a finder's include glob.
            'source-files-changed';
        broadcastDebounced(event, { path: rel });
      };
      // Journal every event first — the durable answer to "what did the
      // watcher see" when a page reloads or a table refreshes for no visible
      // reason (2026-09-06: three reloads on tsconfig 'changes' whose mtime
      // never moved, and hot-updates for files a scaffold had deleted
      // minutes before the server started).
      srcWatcher.on('all', (event, filePath) => {
        const rel = relative(host.projectRoot(), resolve(filePath)).split(sep).join('/');
        let mtimeMs: number | null = null;
        try {
          mtimeMs = statSync(filePath).mtimeMs;
        } catch {
          /* gone */
        }
        journalEvent({ kind: 'src-watch', event, path: rel, mtimeMs });
      });
      srcWatcher.on('add', onListChange);
      srcWatcher.on('unlink', onListChange);
      // CHANGE too (blind-walk beat 9): a story saved from the editor's own
      // header MODIFIES an existing .stories.tsx — add/unlink alone meant the
      // new export was invisible until a full page reload, and a
      // rename-then-delete chained on the stale list. Hand edits to a
      // stories/tools file get the same refresh, which was its own gap.
      srcWatcher.on('change', onListChange);
      srcWatcher.on('add', invalidateComponentIndex);
      srcWatcher.on('change', invalidateComponentIndex);
      srcWatcher.on('unlink', invalidateComponentIndex);
      // Registered callable tool edits need a fresh Node-side catalog read;
      // contribution modules still ride ordinary Vite HMR in the browser.
      srcWatcher.on('change', (filePath) => {
        const rel = relative(host.projectRoot(), resolve(filePath)).split(sep).join('/');
        if (classifyProjectSrcPath(rel) === 'tools') {
          broadcastDebounced('tool-files-changed', { path: rel });
        }
      });
      srcWatcher.on('add', (filePath) => scheduleFileValidation(resolve(filePath)));
      srcWatcher.on('change', (filePath) => scheduleFileValidation(resolve(filePath)));
      srcWatcher.on('unlink', (filePath) => clearFileValidation(resolve(filePath)));
      srcWatcher.on('add', (filePath) => void recordFilesystemMutation(resolve(filePath)));
      srcWatcher.on('change', (filePath) => void recordFilesystemMutation(resolve(filePath)));
      srcWatcher.on('unlink', (filePath) => void recordFilesystemMutation(resolve(filePath), null));

      // PD-14: a source dir materializing is the boot that never happened —
      // run the SAME scan boot runs. The per-file `add` events above already
      // cover a directory populated one file at a time, but a tree moved or
      // extracted into place atomically can deliver its contents in one
      // filesystem event, and the scan is a single readdir walk, so it stays
      // the authority on "everything that is there right now" rather than a
      // bet on event granularity.
      //
      // Both handlers ask the FILESYSTEM rather than comparing the event path
      // to a watched root: this watcher is rooted at exactly those dirs, so any
      // `addDir` from it already proves one exists, and `existsSync`
      // distinguishes "a watched root itself went away" from "a subdirectory
      // under it did" without depending on whether chokidar hands paths back
      // symlink-resolved.
      const scanSourceDirs = (): void => {
        for (const dir of sourceValidationDirs) if (existsSync(dir)) void validateSourceTree(dir);
      };
      const anySourceDirExists = (): boolean => sourceValidationDirs.some((dir) => existsSync(dir));
      srcWatcher.on('addDir', () => {
        if (sourceValidation === 'active') return;
        setSourceValidation('active');
        scanSourceDirs();
      });
      srcWatcher.on('unlinkDir', () => {
        if (anySourceDirExists()) return;
        setSourceValidation('awaiting-src');
      });

      if (anySourceDirExists()) {
        setSourceValidation('active');
        scanSourceDirs();
      } else {
        setSourceValidation('awaiting-src');
      }
    }

    // ---- Third watcher: <project>/references (reference material) ----
    //
    // Reference media — moodboards, generated stills and clips — lives beside
    // `public/` and is listed by Content like any other media, so a file that
    // lands there must appear WITHOUT anyone pressing refresh. That is this
    // watcher's whole job, and it is deliberately the thinnest of the three:
    // references are not shipped, so there is no hashing, no validation, no
    // move-rewriting and no collaboration record — nothing downstream of
    // `public/`'s semantics applies to a file the build never copies.
    //
    // It broadcasts the UNSCOPED `assets-changed`, the same shape the asset
    // library uses: the paths in a scoped event are PUBLIC-relative by
    // contract, and a `references/…` string in that field would be
    // indistinguishable from a public folder named `references`.
    if (host.projectRoot() !== engineRoot) {
      referencesWatcher = chokidar.watch(join(host.projectRoot(), 'references'), {
        ignoreInitial: true,
        ignored: /(^|[/\\])\../,
        ...pollOptions,
      });
      const onReferenceChange = (event: string): void => {
        if (event !== 'add' && event !== 'change' && event !== 'unlink') return;
        broadcastDebounced('assets-changed', {});
      };
      referencesWatcher.on('all', onReferenceChange);
    }

    // ---- Fourth watcher: <project>/vgai.project.json (#103 validate-on-change) ----
    //
    // The manifest lives at the PROJECT ROOT, outside both `host.publicRoot()` and
    // `src/` — neither watcher above ever sees it. It's a single fixed-name
    // file, so this watches that exact path rather than a directory (chokidar
    // supports watching a not-yet-existing file and reports its later `add`).
    if (host.projectRoot() !== engineRoot) {
      const manifestPath = resolveManifestPath(host.projectRoot());
      // #131: same polling decision as the watchers above. There is ONE
      // manifest filename, and it can appear later (chokidar watches
      // not-yet-existing paths fine).
      const adapterModulePath = join(host.projectRoot(), ADAPTER_MODULE_FILENAME);
      manifestWatcher = chokidar.watch(
        [join(host.projectRoot(), MANIFEST_FILENAME), adapterModulePath],
        {
          ignoreInitial: true,
          ...pollOptions,
        },
      );
      const onDeclarationChange = (event: string, filePath: string): void => {
        if (event !== 'add' && event !== 'change' && event !== 'unlink') return;
        invalidateComponentIndex();
        broadcastDebounced('project-declarations-changed', {});
        const absPath = resolve(filePath);
        if (absPath !== manifestPath) return;
        if (event === 'unlink') {
          clearFileValidation(manifestPath);
          void recordFilesystemMutation(manifestPath, null);
          return;
        }
        scheduleFileValidation(manifestPath);
        void recordFilesystemMutation(manifestPath);
      };
      manifestWatcher.on('all', onDeclarationChange);
    }

    // Warm the transient index behind ordinary editor boot. The request path
    // still awaits this same promise, and failures are retried there rather
    // than becoming an unhandled background rejection.
    void currentProjectComponents().catch(() => {
      componentIndexCache = null;
    });
  }

  // Start initial watcher
  startWatcher();

  // Periodic cleanup of stale pending unlinks
  const moveSweepTimer = setInterval(() => {
    const cutoff = Date.now() - MOVE_WINDOW_MS * 2;
    while (pendingUnlinks.length > 0 && pendingUnlinks[0]!.timestamp < cutoff) {
      pendingUnlinks.shift();
    }
  }, 5000);
  return {
    start: startWatcher,
    currentProjectComponents,
    currentValidationLogEntries,
    announceBuildDisciplineTripwires,
    projectValidation,
    projectWarnings,
    expectedEditorMutations,
    get sourceValidation() {
      return sourceValidation;
    },
    set sourceValidation(next: SourceValidationState) {
      sourceValidation = next;
    },
    get cadenceGate() {
      return cadenceGate;
    },
    set cadenceGate(next: TripwireGate) {
      cadenceGate = next;
    },
    get unplayedGate() {
      return unplayedGate;
    },
    set unplayedGate(next: TripwireGate) {
      unplayedGate = next;
    },
    get publicAssetsLastChangedAt() {
      return publicAssetsLastChangedAt;
    },
    set publicAssetsLastChangedAt(next: number | null) {
      publicAssetsLastChangedAt = next;
    },
    get publicAssetsLastPath() {
      return publicAssetsLastPath;
    },
    set publicAssetsLastPath(next: string | null) {
      publicAssetsLastPath = next;
    },
    get publicAssetsChangedCount() {
      return publicAssetsChangedCount;
    },
    set publicAssetsChangedCount(next: number) {
      publicAssetsChangedCount = next;
    },
    close: async () => {
      clearInterval(moveSweepTimer);
      for (const timer of validationDebounceTimers.values()) clearTimeout(timer);
      validationDebounceTimers.clear();
      for (const timer of pendingBroadcasts.values()) clearTimeout(timer);
      pendingBroadcasts.clear();
      if (componentIndexWarmTimer) clearTimeout(componentIndexWarmTimer);
      await Promise.all([
        watcher?.close(),
        srcWatcher?.close(),
        referencesWatcher?.close(),
        manifestWatcher?.close(),
      ]);
    },
  };
}
