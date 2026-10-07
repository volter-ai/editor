/**
 * The session verbs every product's CLI runs against its project's live
 * editor session: `sessions`, `project`, `projects`, `open`, `screenshot` and
 * `restart`. Transferred from Volter's CLI (`packages/volter-cli/src/index.ts`'s
 * cases of the same names); each reaches the page through the same
 * `EditorClient` member volter used. The product only says who it is
 * (`command`, the name a person types).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { resolveSession } from '@volter/editor-live';
import { EditorClient } from '@volter/editor-sdk/client';
import { relayCommandTimeoutMs } from '@volter/editor-sdk/session/command-table';
import type { AssetPreviewShotSetDefinition, AssetPreviewSource, EditorState } from '@volter/editor-sdk';
import { currentPageErrors, startupRefusals } from './launch';
import {
  fetchEditorState,
  requestEditorTabEnsure,
  verifiedSessions,
  waitForEditorTabAdopted,
  waitForVerifiedEditorOpen,
} from './editor-sessions';
import { probeRestartReadiness, restartToReady, type RestartTabOutcome } from './restart-readiness';
import {
  ambiguousTargetRefusal,
  classifyScreenshotTarget,
  resolveEntityTarget,
  resolveModelTarget,
  type EntityTargetRow,
} from './screenshot-target';

/** The project's live session, resolved from the cwd exactly as `status` does. */
async function sessionClient(): Promise<{ client: EditorClient; url: string; projectRoot: string }> {
  const session = await resolveSession();
  const url = `http://127.0.0.1:${session.port}`;
  return { client: new EditorClient({ url }), url, projectRoot: session.projectRoot };
}

/** `sessions` — every live editor session on this machine, port → project. */
export async function listSessions(): Promise<void> {
  const sessions = await verifiedSessions();
  if (sessions.length === 0) {
    console.log('No live editor sessions.');
    return;
  }
  for (const s of sessions) {
    const tag = s.pid === null ? '  (unregistered server)' : '';
    console.log(`  http://127.0.0.1:${s.port}/  →  ${s.project ?? '(no project)'}${tag}`);
    // A session serving a project it cannot describe is still that project's
    // session — say why it is degraded rather than render `(no project)`.
    if (s.manifestError !== null) {
      for (const line of s.manifestError.split('\n')) console.log(`      ${line}`);
    }
  }
}

/** `project` — the project the running editor has open (`GET /__editor/project`). */
export async function showProject(): Promise<void> {
  const { client } = await sessionClient();
  const project = await client.getProject();
  if (project) console.log(JSON.stringify(project, null, 2));
  else console.log('No project open');
}

/** `projects` — recently opened projects (`GET /__editor/recent-projects`). */
export async function listRecentProjects(): Promise<void> {
  const { client } = await sessionClient();
  const projects = await client.listRecentProjects();
  if (projects.length === 0) {
    console.log('No recent projects');
    return;
  }
  for (const p of projects) console.log(`${p.name}  ${p.path}  (${p.lastOpened})`);
}

/**
 * `open <path>` — switch the running editor to a project (`POST /__editor/open-project`).
 *
 * THE SWITCH IS THE SERVER'S; THE OPEN IS THE TAB'S. The route switches the session and
 * broadcasts `project-changed`, on which the page reloads onto the new project
 * (`command-listener.ts`). Until 2026-10-06 this printed "Opened project" the moment the route
 * answered, whether or not any page existed to show the project or the reloaded page came up —
 * a project the page then refused (a pinned engine, a broken manifest) read as success.
 *
 * NOW IT WAITS ON THE PAGE, NOT ON A CLOCK. A healthy switch can take a long time (a cold Vite
 * transform, a big project, a loaded machine), so there is no deadline: it says what it is
 * waiting on every 20 s and ends only on an answer — the new page-load running the editor
 * (success), the page's own refusal (its words), the server's verdict that the page is never
 * coming up, or no page left at all.
 */
export async function openProject(path: string, command: string): Promise<void> {
  const { client, url } = await sessionClient();
  const before = await fetchEditorState(url);
  const loadBefore = await currentLoadId(url);
  const openAttemptAt = Date.now();
  await client.openProject(path);
  if (before.tabs.length === 0 && before.editorsConnected === 0) {
    throw new Error(
      `The session now serves ${path}, but no editor page is open to show it. Open one: \`${command} edit ${path}\`.`,
    );
  }
  let lastProgressAt = openAttemptAt;
  let noPageSince: number | null = null;
  for (;;) {
    const refused = await startupRefusals(url, openAttemptAt);
    if (refused.length > 0) {
      throw new Error(`The session now serves ${path}, but its editor page refused it:\n${refused.map((message) => `  ${message}`).join('\n')}`);
    }
    const state = await fetchEditorState(url);
    // A NEW page-load running the document: the old page answers until it reloads, and the
    // ledger's load id moves only when the new one's editor has mounted (`noteLoad`).
    const load = await currentLoadId(url);
    if (load !== null && load !== loadBefore && state.tabs.some((tab) => tab.commandListener === 'ready')) break;
    if (state.tabs.some((tab) => tab.unresponsive)) {
      const said = await currentPageErrors(url);
      throw new Error(
        `The session now serves ${path}, but its editor page is not coming up (the session's own verdict)` +
          (said.length > 0 ? `:\n${said.map((message) => `  ${message}`).join('\n')}` : `; \`${command} console\` has what it reported.`),
      );
    }
    const now = Date.now();
    // NO PAGE AT ALL, for longer than a reload's own gap, is a dead end rather than a slow start.
    if (state.tabs.length === 0 && state.editorsConnected === 0) {
      noPageSince ??= now;
      if (now - noPageSince >= NO_PAGE_DEAD_END_MS)
        throw new Error(`The session now serves ${path}, but its editor page closed instead of reopening it. Open one: \`${command} edit ${path}\`.`);
    } else noPageSince = null;
    if (now - lastProgressAt >= 20_000) {
      lastProgressAt = now;
      console.log(`Waiting for the editor page to reopen on ${path} (${Math.round((now - openAttemptAt) / 1000)}s)…`);
    }
    await delay(500);
  }
  console.log(`Opened project: ${path}`);
}

/** How long `open` lets the session see NO page before calling it closed: a reload keeps its
 *  tab row, so a session with no tab at all for this long has lost the page. */
const NO_PAGE_DEAD_END_MS = 10_000;

/** The page-load the session's console ledger calls current, or null with no page / no answer. */
async function currentLoadId(url: string): Promise<string | null> {
  try {
    const response = await fetch(new URL('/__editor/console?all=1', url), { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { currentLoadId?: unknown };
    return typeof body.currentLoadId === 'string' ? body.currentLoadId : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// restart
// ---------------------------------------------------------------------------

export interface RestartOptions {
  /** The product's witnessed page reload (the game product's
   *  `page.reload()`); without one, a stale public/ asset cache is reported
   *  rather than cured. */
  reloadPage?: () => Promise<unknown>;
}

/**
 * `restart` — dispose and remount every game root, acknowledging only when
 * the session is READY for the next command (`restart-readiness.ts`). The
 * remount is the `play` relay command, re-issued against a reconnected tab
 * when the page reloads mid-command.
 */
export async function restart(command: string, options: RestartOptions = {}): Promise<void> {
  const { client, url, projectRoot } = await sessionClient();
  const noOpen = Boolean(process.env['VOLTER_NO_OPEN']);
  // A source remount cannot freshen page-lifetime binary caches. When public/
  // bytes changed after the current document loaded, destroy that document
  // before asking it to remount — through the product's own witnessed reload
  // (a new tab epoch, then a command answered by the new document). With no
  // tab attached, the tab convergence below opens a fresh document anyway.
  const before = await client.getState().catch(() => null);
  const divergence = staleAssetCacheWarning(before);
  const attached = before?.connected === true || (before?.editorsConnected ?? 0) > 0;
  if (divergence && attached && options.reloadPage) {
    console.error(`${command} restart: public/ assets changed after this tab loaded — reloading the document before remounting…`);
    try {
      await options.reloadPage();
    } catch (error) {
      console.error(`✗ ${command} restart: the required asset-cache reload did not complete — ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
      return;
    }
  } else if (divergence) console.error(divergence);

  const result = await restartToReady({
    command,
    target: url,
    probe: () => probeRestartReadiness(url),
    ensureTab: () => ensureOneTab(url, noOpen),
    play: () => playWithRelayReloadRetry(client, (attempt, max) =>
      console.error(`Editor reloaded during the remount; retrying in the reconnected tab (attempt ${attempt}/${max})…`)),
    wait: (ms, signal) => delay(ms, undefined, signal ? { signal } : {}).catch(() => {}),
    note: message => console.error(message),
    timings: { playBudgetMs: relayCommandTimeoutMs('play') },
  });

  if (!result.ready) {
    console.error(`✗ ${result.message}`);
    if (result.reason === 'play-not-running' || result.reason === 'play-timed-out') {
      const state = await client.getState().catch(() => null);
      if (state) console.error(`  play: ${state.playState}`);
      console.error(`  Logs: ${join(projectRoot, 'logs')}/play-*.jsonl`);
    }
    process.exitCode = 1;
    return;
  }

  const entries = await client.getLogEntries().catch(() => null);
  const ready = 'session ready — play running, editor tab connected';
  if (entries === null) {
    console.log(`↻ Restarted — ${ready}`);
    console.error('  ⚠ could not read the session log; the restart may hold errors this ack cannot see');
    if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = 1;
  } else {
    const errors = entries.filter(e => e.level === 'error');
    console.log(`↻ Restarted${errors.length > 0 ? ' (with errors)' : ''} — ${ready}`);
    for (const err of errors) console.error(`  ✗ ${err.msg}`);
  }
  console.log('  Logs: logs/play-*.jsonl');
  // Another public/ write can land during the remount window; keep the
  // postcondition loud rather than claim fresh pixels over that race.
  const after = staleAssetCacheWarning(await client.getState().catch(() => null));
  if (after) console.error(after);
}

/** "public/ bytes changed after the running document loaded" — a divergence,
 *  never a verdict. */
function staleAssetCacheWarning(state: EditorState | null): string | null {
  const changedAt = state?.publicAssets?.lastChangedAt ?? null;
  const tabs = state?.tabs ?? [];
  const blessed = tabs.find(tab => tab.blessed) ?? tabs[0];
  const loadedAt = blessed?.epochAgeMs !== undefined ? Date.now() - blessed.epochAgeMs : (state?.lastIndexRequestAt ?? null);
  if (changedAt === null || loadedAt === null || changedAt <= loadedAt) return null;
  const path = state?.publicAssets?.lastPath;
  return (
    `⚠ public/ assets changed after this tab last loaded (${path ?? 'unknown path'}). Module-scope loaders ` +
    'and page-lifetime asset caches outlive a remount, so the remount can still be handed the OLD bytes. ' +
    'Reload the editor tab and look again to rule it out.'
  );
}

const TRANSIENT_RELAY_ERRORS = [
  'controlling this command disconnected',
  'Editor page disconnected while the command was pending',
  'Editor disconnected before the command could be delivered',
] as const;

/** A page reload landing mid-`play` drops the command; re-issue it against the
 *  reconnected tab (Volter's `play-retry.ts`). Every other failure is final. */
async function playWithRelayReloadRetry(client: EditorClient, onRetry: (attempt: number, max: number) => void): Promise<unknown> {
  const maxAttempts = 5;
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.play();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= maxAttempts || !TRANSIENT_RELAY_ERRORS.some(fragment => message.includes(fragment))) throw error;
      onRetry(attempt + 1, maxAttempts);
      await delay(2_500);
    }
  }
}

/** Converge the session on one attached tab through the server's tab
 *  bijection (`POST /__editor/tab/ensure`), the same door `edit` uses. */
async function ensureOneTab(serverUrl: string, noOpen: boolean): Promise<RestartTabOutcome> {
  const openAttemptAt = Date.now();
  const ensured = await requestEditorTabEnsure(serverUrl, !noOpen);
  if (ensured === 'unsupported') return 'no-tab';
  if (ensured === 'disabled' || (noOpen && ensured === 'noop')) return 'skipped';
  if (ensured === 'adopt') return (await waitForEditorTabAdopted(serverUrl)) ? 'attached' : 'unadopted';
  const outcome = await waitForVerifiedEditorOpen(serverUrl, {
    openAttemptAt,
    onProgress: ms => console.error(`Waiting for the editor page (${Math.round(ms / 1000)}s)…`),
  });
  if (outcome.status === 'connected') return 'attached';
  return outcome.status === 'stuck' ? 'stuck' : 'no-tab';
}

// ---------------------------------------------------------------------------
// screenshot
// ---------------------------------------------------------------------------

/** The flags the look lanes accept, as `parseArgs` hands them over. */
export interface ScreenshotOptions {
  size?: string | undefined;
  width?: string | undefined;
  height?: string | undefined;
  shots?: string | undefined;
  compare?: string | undefined;
  export?: string | undefined;
}

/** `parseArgs` option declarations for {@link screenshot}'s flags. */
export const SCREENSHOT_OPTIONS = {
  size: { type: 'string' }, width: { type: 'string' }, height: { type: 'string' },
  shots: { type: 'string' }, compare: { type: 'string' }, export: { type: 'string' },
} as const;

export const SCREENSHOT_USAGE =
  'screenshot [<file.glb> | <src/models/x.ts> | <entity>] [--size|--width|--height <64-1024>] ' +
  '[--shots <set>] [--compare <ref.glb>] [--export <fn>]';

interface LookFlags {
  width?: number;
  height?: number;
  shots?: string;
  compare?: string;
  exportName?: string;
}

function parseLookFlags(options: ScreenshotOptions): LookFlags {
  const dimension = (name: string, raw: string): number => {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 64 || parsed > 1024) {
      throw new Error(
        `--${name} must be an integer from 64 to 1024 — the editor's own ceiling: the views cross ` +
          'the relay as base64 JSON, and 1024 is where a full sheet still fits its request limit.',
      );
    }
    return parsed;
  };
  const flags: LookFlags = {};
  if (options.size !== undefined) flags.width = flags.height = dimension('size', options.size);
  if (options.width !== undefined) flags.width = dimension('width', options.width);
  if (options.height !== undefined) flags.height = dimension('height', options.height);
  if (options.shots !== undefined) {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(options.shots)) throw new Error('--shots must be a short shot-set name (letters/digits/dashes)');
    flags.shots = options.shots;
  }
  if (options.compare !== undefined) flags.compare = options.compare;
  if (options.export !== undefined) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(options.export)) throw new Error('--export must name a module export');
    flags.exportName = options.export;
  }
  return flags;
}

/** `<project>/.volter/screenshots/<stamp>[-<slug>]` — machine-written evidence
 *  lives in one gitignored place. */
function screenshotPath(projectRoot: string, slug?: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = (slug ?? '').toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
  return join(projectRoot, '.volter', 'screenshots', slug === undefined ? `${stamp}.png` : `${safe === '' ? 'look' : safe}-${stamp}`);
}

/**
 * `screenshot [<target>]` — the one look verb. The target chooses the lane
 * (`screenshot-target.ts`); every lane rasterizes in the live session.
 */
export async function screenshot(target: string | undefined, options: ScreenshotOptions): Promise<void> {
  const flags = parseLookFlags(options);
  const classified = classifyScreenshotTarget(target);
  const session = await sessionClient();
  switch (classified.lane) {
    case 'session': {
      if (Object.keys(flags).length > 0) {
        throw new Error('--size/--width/--height/--shots/--compare/--export need a target — they modify a look at a model file, a module or an entity.');
      }
      return sessionLook(session.client, session.projectRoot);
    }
    case 'model': {
      const resolved = resolveModelTarget(classified.path, {
        cwd: process.cwd(), projectRoot: session.projectRoot,
        exists: path => existsSync(path) && statSync(path).isFile(),
      });
      if ('error' in resolved) throw new Error(resolved.error);
      await assertUnambiguousTarget(session.client, classified.path, resolved.file);
      return assetLabLook(session.client, { assetPath: resolved.assetPath }, flags, screenshotPath(session.projectRoot, basename(resolved.file)));
    }
    case 'module':
      return moduleLook(session.client, session.projectRoot, classified.path, flags);
    case 'entity': {
      const asFile = resolve(process.cwd(), classified.entityId);
      if (existsSync(asFile) && statSync(asFile).isFile()) await assertUnambiguousTarget(session.client, classified.entityId, asFile);
      const resolved = resolveEntityTarget(classified.entityId, await liveEntityRows(session.client));
      if ('error' in resolved) throw new Error(resolved.error);
      return assetLabLook(session.client, { entityId: resolved.entityId }, flags, screenshotPath(session.projectRoot, resolved.entityId), 'scene');
    }
  }
}

/**
 * No target: what the session is showing. While play runs that is the running
 * game — the composited game stack (`bridge-screenshot`, Volter's no-target
 * lane); otherwise the active document as the editor presents it
 * (`capture-active-document`).
 */
async function sessionLook(client: EditorClient, projectRoot: string): Promise<void> {
  const outPath = screenshotPath(projectRoot);
  const state = await client.getState();
  if (state.playState === 'playing') {
    let capture;
    let loopRecoveryFrame = false;
    try {
      capture = await client.captureGame();
    } catch (error) {
      // A starved host loop holds a provably stale frame; the relay renders
      // one deterministic tick on request. Every other refusal is final.
      if ((error as { code?: unknown }).code !== 'BRIDGE_SCREENSHOT_STALE') throw error;
      capture = await client.captureGame({ refreshStarvedFrame: true });
      loopRecoveryFrame = true;
    }
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, Buffer.from(capture.base64, 'base64'));
    console.log(outPath);
    if (capture.flatness?.degenerate === true && capture.flatness.warning !== undefined) console.error(`warning — ${capture.flatness.warning}`);
    if (loopRecoveryFrame || capture.loopRecoveryFrame === true) {
      console.error('This PNG is a LOOP-RECOVERY FRAME — the host loop was starved, so the runtime rendered one deterministic tick on demand. It is current; it was not produced by ordinary presentation.');
    }
    if (!capture.composite) console.error('warning — the HUD/DOM composite leg could not run; this PNG is the game CANVAS only.');
    if (capture.recording?.notice !== undefined) console.error(capture.recording.notice);
    return;
  }
  const capture = await client.captureActiveDocument();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(capture.base64, 'base64'));
  console.log(outPath);
  console.error(`${capture.document.title} (${capture.document.kind}${capture.document.sourcePath ? `, ${capture.document.sourcePath}` : ''}) — ${capture.source}`);
}

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

/** `parseArgs` option declarations for {@link capture}'s flags. */
export const CAPTURE_OPTIONS = { region: { type: 'string' }, out: { type: 'string' }, force: { type: 'boolean' } } as const;

export const CAPTURE_USAGE = 'capture [--region document|play|page] [--out <file.png> [--force]]';

const CAPTURE_REGIONS = ['document', 'play', 'page'] as const;

/**
 * `capture` — `editor.captureEditorChrome({ region })`, saved as a PNG, its
 * path printed. The editor as the PERSON sees it: `document` is the active
 * document's box with its overlays (navigation gizmo, readouts), `play` the
 * live Play frame with its React UI and no authoring chrome, `page` the whole
 * editor. `screenshot` with no target is the document's RENDER alone
 * (`captureActiveDocument`), a different question.
 *
 * Why a verb and not an `eval` line: the eval answer is base64 inside JSON,
 * and an agent that wants a file it can open had to write its own decoder
 * script first (measured 2026-10, an agent building an obby). This is the
 * same `writeFileSync(Buffer.from(base64))` {@link sessionLook} does, behind
 * a name. The default lands beside the screenshots, in the project's
 * gitignored `.volter/`.
 *
 * `--out` NEVER REPLACES A FILE unless `--force` says to: a named path is the
 * caller's, and a capture silently landing on a reference image or an earlier
 * capture destroys the very thing it was going to be compared with. The check
 * runs before the capture, so a refusal costs nothing; the write itself is
 * exclusive too, so a file appearing in between is refused rather than lost.
 */
export async function capture(options: { region?: string | undefined; out?: string | undefined; force?: boolean | undefined }): Promise<void> {
  const region = options.region ?? 'document';
  if (!(CAPTURE_REGIONS as readonly string[]).includes(region))
    throw new Error(`--region must be one of ${CAPTURE_REGIONS.join(', ')}; got ${region}.`);
  if (options.out !== undefined && !/\.png$/i.test(options.out)) throw new Error('--out names a .png file.');
  if (options.force === true && options.out === undefined) throw new Error('--force belongs to --out: the default path is always new.');
  const named = options.out === undefined ? null : resolve(process.cwd(), options.out);
  if (named !== null && options.force !== true && existsSync(named))
    throw new Error(`${named} already exists; pass --force to replace it, or choose another --out.`);
  const session = await sessionClient();
  const shot = await session.client.captureEditorChrome({ region: region as (typeof CAPTURE_REGIONS)[number] });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = named ?? join(session.projectRoot, '.volter', 'captures', `${region}-${stamp}.png`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(shot.base64, 'base64'), { flag: options.force === true ? 'w' : 'wx' });
  console.log(outPath);
  console.error(`${region}: ${shot.size.width}x${shot.size.height} at ${shot.scale}x (${shot.layers.canvases} canvas, ${shot.layers.domOverlays} DOM layer${shot.layers.domOverlays === 1 ? '' : 's'})`);
  if (shot.flatness?.degenerate === true && shot.flatness.warning !== undefined) console.error(`warning — ${shot.flatness.warning}`);
}

/** Refuse a target that reads BOTH as a file and as a live entity. */
async function assertUnambiguousTarget(client: EditorClient, target: string, file: string): Promise<void> {
  const entities = await liveEntityRows(client);
  if (entities?.some(entity => entity.id === target || entity.name === target)) throw new Error(ambiguousTargetRefusal(target, file));
}

async function liveEntityRows(client: EditorClient): Promise<EntityTargetRow[] | undefined> {
  try {
    return (await client.getState()).entities;
  } catch {
    return undefined;
  }
}

/** The Asset Lab lanes — a model file, or a live entity — through
 *  `capture-asset-preview`. */
async function assetLabLook(client: EditorClient, source: AssetPreviewSource, flags: LookFlags, outputDirectory: string, defaultStage?: 'scene'): Promise<void> {
  if (flags.exportName !== undefined) throw new Error('--export names a module export; it applies to a .ts/.tsx target only');
  const dimensions = {
    ...(flags.width === undefined ? {} : { width: flags.width }),
    ...(flags.height === undefined ? {} : { height: flags.height }),
  };
  mkdirSync(outputDirectory, { recursive: true });
  if (flags.compare !== undefined) {
    if (flags.shots !== undefined) throw new Error('--compare cannot be combined with --shots');
    const refBytes = readFileSync(resolve(flags.compare));
    const maxRefBytes = 32 * 1024 * 1024;
    if (refBytes.byteLength > maxRefBytes) throw new Error(`--compare reference GLB must be ${maxRefBytes / 1024 / 1024} MiB or less.`);
    const capture = await client.captureAssetComparePreview(source, refBytes.toString('base64'), dimensions);
    const iou: Record<string, number> = {};
    for (const view of capture.views) {
      iou[view.view] = view.iou;
      for (const [suffix, image] of [['overlay', view.overlay], ['asset', view.asset], ['ref', view.ref]] as const) {
        writeFileSync(join(outputDirectory, `compare-${view.view}-${suffix}.png`), Buffer.from(image.base64, 'base64'));
      }
    }
    console.log(JSON.stringify({ compare: { iou } }));
    console.log(`Compare preview written to ${outputDirectory}`);
    return;
  }
  if (flags.shots !== undefined) {
    // A project-defined shot set: its DEFINITION is project data, returned by
    // the registered `project.<set>.previewShots` tool.
    const toolName = `project.${flags.shots}.previewShots`;
    const outcome = await client.runProjectTool(toolName, {});
    if (!outcome.ok) {
      if (outcome.error?.code === 'PROJECT_TOOL_NOT_FOUND') {
        throw new Error(`This project registers no '${flags.shots}' shot set: no project tool is named '${toolName}'.`);
      }
      throw new Error(`Shot-set tool '${toolName}' failed: ${outcome.error?.message ?? 'unknown error'}`);
    }
    const capture = await client.captureShotSetPreview(source, outcome.data as AssetPreviewShotSetDefinition, dimensions);
    const warnings = new Map((capture.warnings ?? []).map(warning => [warning.label, warning]));
    for (const image of capture.shots) {
      const file = join(outputDirectory, `${image.label}.png`);
      writeFileSync(file, Buffer.from(image.base64, 'base64'));
      const warning = warnings.get(image.label);
      if (warning) console.warn(`WARNING  ${file}: ${warning.message}`);
    }
    writeFileSync(join(outputDirectory, 'contact-sheet.png'), Buffer.from(capture.contactSheet.base64, 'base64'));
    const empty = capture.warnings?.length ?? 0;
    console.log(`Shot set '${flags.shots}' preview (${capture.shots.length} shots${empty > 0 ? `, ${empty} EMPTY — see the warnings above` : ''}) written to ${outputDirectory}`);
    return;
  }
  const capture = await client.captureAssetPreview(source, { ...dimensions, ...(defaultStage === undefined ? {} : { stage: defaultStage }) });
  for (const image of capture.views) writeFileSync(join(outputDirectory, `${image.view}.png`), Buffer.from(image.base64, 'base64'));
  writeFileSync(join(outputDirectory, 'contact-sheet.png'), Buffer.from(capture.contactSheet.base64, 'base64'));
  console.log(`${join(outputDirectory, 'contact-sheet.png')}   ← every view on one sheet`);
  console.log(`  per-view frames beside it: ${capture.views.map(image => `${image.view}.png`).join(' ')}`);
  if (capture.orientation && capture.orientation.yawDegrees !== 0) {
    console.log(
      `NOTE  subject yawed ${capture.orientation.yawDegrees}° to face the front camera ` +
        `(declared forward [${capture.orientation.forward.join(', ')}]): authored axes differ from screen axes — ` +
        "read each view's corner marker (`+X>` = authored +X points screen-right, `<+X` = screen-left).",
    );
  }
}

/**
 * A project module: the `project.bake.preview` project tool builds its export
 * headlessly in Node, exports the Object3D to an in-memory GLB and has the
 * live session photograph it. Nothing is written under public/.
 */
async function moduleLook(client: EditorClient, projectRoot: string, modulePath: string, flags: LookFlags): Promise<void> {
  if (flags.shots !== undefined || flags.compare !== undefined) {
    throw new Error('--shots/--compare do not apply to a module target — the module lane builds bytes that stand nowhere and writes its fixed views under .volter/screenshots/.');
  }
  if (flags.width !== undefined && flags.height !== undefined && flags.width !== flags.height) {
    throw new Error('a module look renders square views — use --size, not --width/--height');
  }
  const toolName = 'project.bake.preview';
  const size = flags.width ?? flags.height;
  const outcome = await client.runProjectTool(toolName, {
    modulePath,
    ...(flags.exportName === undefined ? {} : { exportName: flags.exportName }),
    ...(size === undefined ? {} : { size }),
  });
  if (!outcome.ok) {
    const missing = outcome.error?.code === 'PROJECT_TOOL_NOT_FOUND'
      ? ` This project registers no ${toolName} tool (package.json#volter.tools).` : '';
    throw new Error(`${toolName} refused '${modulePath}' — ${outcome.error?.message ?? 'unknown error'}.${missing}`);
  }
  const result = outcome.data as {
    files?: string[];
    contactSheet?: string;
    emptyFrames?: Array<{ label: string; message: string }>;
    triangleCount?: number;
    vertexCount?: number;
    meshCount?: number;
    invertedTriangleCount?: number;
    boundaryEdgeCount?: number;
    boundaryEdgeSamples?: [number, number, number][];
    nonFiniteVertexCount?: number;
    bounds?: { min: [number, number, number]; max: [number, number, number] };
  };
  const files = (result.files ?? []).map(file => resolve(projectRoot, file));
  const sheet = result.contactSheet ? resolve(projectRoot, result.contactSheet) : null;
  if (sheet && files.includes(sheet)) {
    console.log(`${sheet}   ← every view on one sheet; one read judges the model`);
    const frames = files.filter(file => file !== sheet).map(file => basename(file));
    if (frames.length > 0) console.log(`  per-view frames beside it (the same pixels, the same size): ${frames.join(' ')}`);
  } else for (const file of files) console.log(file);
  if (result.bounds) {
    const { min, max } = result.bounds;
    const m = (n: number) => n.toFixed(3).replace(/\.?0+$/, '');
    console.log(
      `${result.triangleCount} triangles, ${result.vertexCount} vertices, ${result.meshCount} mesh${result.meshCount === 1 ? '' : 'es'}; ` +
        `size ${m(max[0] - min[0])} × ${m(max[1] - min[1])} × ${m(max[2] - min[2])} m (x × y × z), y from ${m(min[1])} to ${m(max[1])}`,
    );
  }
  if ((result.nonFiniteVertexCount ?? 0) > 0) {
    console.warn(`WARNING  ${result.nonFiniteVertexCount} of ${result.vertexCount} vertices are NaN or infinite — print the position attribute after each stage of the build to find the first one.`);
  }
  if ((result.boundaryEdgeCount ?? 0) > 0) {
    const samples = result.boundaryEdgeSamples ?? [];
    console.warn(
      `WARNING  ${result.boundaryEdgeCount} open edges (one triangle on the edge after welding): a hole, an unclosed cap, ` +
        'or a part never joined. A closed asset has zero; a deliberate opening is fine — say so.' +
        (samples.length ? ` Near ${samples.map(([x, y, z]) => `[${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}]`).join(', ')}${(result.boundaryEdgeCount ?? 0) > samples.length ? ', …' : ''}.` : ''),
    );
  }
  if ((result.invertedTriangleCount ?? 0) > 0) {
    console.warn(`WARNING  ${result.invertedTriangleCount} of ${result.triangleCount} triangles face INWARD (inside-out shells or non-contiguous winding) — recalculate normals outside.`);
  }
  for (const empty of result.emptyFrames ?? []) console.warn(`WARNING  ${empty.label}: ${empty.message}`);
}
