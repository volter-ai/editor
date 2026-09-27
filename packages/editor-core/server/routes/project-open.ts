/**
 * Choosing, creating and OPENING a project — the New Project screen's server
 * half, plus the runtime project switch itself.
 *
 * `/__editor/launcher-settings`, `/__editor/recent-projects`,
 * `/__editor/inspect-project`, `/__editor/adapt-project`,
 * `/__editor/create-project`, `/__editor/browse-folder`, `/__editor/reveal`,
 * `/__editor/save-thumbnail`, `/__editor/project-thumbnail` and
 * `/__editor/open-project`.
 *
 * `inspect-project` deliberately precedes open/create in this file and in the
 * user's flow: selecting an arbitrary game folder must never make it a VGAI
 * project or touch its source as a side effect. Adaptation is a separate,
 * explicit action with its own consent boundary.
 */

import { writeWorkbenchDeclaration } from '@volter/editor-sdk/session/workbench-locator';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  assertEditorCompatibility,
  assertProjectCompatibility,
  ProjectCompatibilityError,
} from '@volter/editor-sdk/session/editor-compatibility';
import {
  createIngestManifest,
  inspectProject,
  type SuggestedAdapterSurface,
} from '@volter/editor-project/inspection';
import type { Request, Response } from 'express';
import { IDLE_TRIPWIRE_GATE } from '../support/project/build-discipline';
import { nodeProjectInspectionReader } from '../support/project/inspection-node';
import { openSessionJournal } from '../support/project/session-journal';
import { canonicalProjectRoot } from '../canonical-path';
import {
  type EditorServerRouter,
  loadRecentProjects,
  saveRecentProjects,
  slugify,
} from '../editor-server';
import { broadcast } from '../editor-sse';
import {
  type LauncherSettings,
  loadLauncherSettings,
  saveLauncherSettings,
} from '../launcher-settings';
import { sessionCreatePresets } from '../product-presets';
import { readProjectView } from '../project-view';
import { escapeAppleScriptString } from '../server-utils';
import type { RouteContext } from './context';

export function registerProjectOpenRoutes(router: EditorServerRouter, ctx: RouteContext): void {
  const {
    compatibilityIdentity,
    engineRoot,
    harnessChat,
    journalEvent,
    launcherSettingsPath,
    options,
    projectWork,
    recentProjectsPath,
    recordRecentProject,
    reconcileGenerations,
    startWatcher,
  } = ctx;

  // ---- Launcher settings (G5 — user-global, not project-scoped) ----
  router.get('/__editor/launcher-settings', async (_req: Request, res: Response) => {
    res.json(await loadLauncherSettings(launcherSettingsPath));
  });
  router.put('/__editor/launcher-settings', async (req: Request, res: Response) => {
    const body = req.body as { reopenLastProject?: unknown };
    const update: Partial<LauncherSettings> = {};
    if (typeof body.reopenLastProject === 'boolean') {
      update.reopenLastProject = body.reopenLastProject;
    }
    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: 'no recognized launcher setting in body' });
      return;
    }
    res.json(await saveLauncherSettings(update, launcherSettingsPath));
  });

  // ---- Recent projects ----
  router.get('/__editor/recent-projects', async (_req: Request, res: Response) => {
    const projects = await loadRecentProjects(recentProjectsPath);
    res.json({ projects });
  });
  router.delete('/__editor/recent-projects', async (req: Request, res: Response) => {
    const path = (req.body as { path?: unknown }).path;
    if (typeof path !== 'string' || path.length === 0) {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    const projects = await loadRecentProjects(recentProjectsPath);
    const canonicalPath = canonicalProjectRoot(path);
    await saveRecentProjects(
      projects.filter((project) => canonicalProjectRoot(project.path) !== canonicalPath),
      recentProjectsPath,
    );
    res.json({ ok: true });
  });
  // ---- Read-only first-contact inspection ----
  // This route deliberately precedes open/create. Selecting an arbitrary game
  // folder must never make it a VGAI project or touch its source as a side
  // effect; adaptation is a separate, explicit action.
  router.post('/__editor/inspect-project', async (req: Request, res: Response) => {
    const candidate = (req.body as { path?: unknown }).path;
    if (typeof candidate !== 'string' || candidate.length === 0) {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    const root = canonicalProjectRoot(candidate);
    try {
      const report = await inspectProject(nodeProjectInspectionReader(root));
      res.json({ ok: true, path: root, report });
    } catch (error) {
      res.status(400).json({
        error: `Could not inspect ${root}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  // Explicit consent boundary for bringing in an existing game. This writes
  // exactly one sidecar metadata file and never rewrites the app's source.
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one auditable inspect/validate/consent-write transaction.
  router.post('/__editor/adapt-project', async (req: Request, res: Response) => {
    const body = req.body as {
      path?: unknown;
      surface?: unknown;
      entry?: unknown;
    };
    if (typeof body.path !== 'string' || body.path.length === 0) {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    const root = canonicalProjectRoot(body.path);
    const reader = nodeProjectInspectionReader(root);
    const report = await inspectProject(reader);
    if (report.hasManifest) {
      res.status(409).json({ error: 'This folder already has a vgai.project.json manifest.' });
      return;
    }
    const surface = body.surface;
    const entry = body.entry;
    if (
      (surface !== undefined && surface !== 'three' && surface !== 'canvas' && surface !== 'dom') ||
      (entry !== undefined &&
        (typeof entry !== 'string' || !report.entryCandidates.includes(entry)))
    ) {
      res.status(400).json({ error: 'The selected adapter surface or entry is invalid.' });
      return;
    }
    let projectName = basename(root);
    try {
      const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf-8')) as {
        name?: unknown;
      };
      if (typeof packageJson.name === 'string' && packageJson.name.length > 0) {
        projectName = packageJson.name;
      }
    } catch {}
    try {
      const manifest = createIngestManifest(report, {
        name: projectName,
        engineVersion: compatibilityIdentity().engineVersion ?? '0.0.0',
        ...(surface !== undefined ? { surface: surface as SuggestedAdapterSurface } : {}),
        ...(typeof entry === 'string' ? { entry } : {}),
      });
      await writeFile(join(root, 'vgai.project.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: 'utf-8',
        flag: 'wx',
      });
      res.json({ ok: true, path: root, manifest, writes: ['vgai.project.json'] });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ---- Create project from template ----
  router.post('/__editor/create-project', async (req: Request, res: Response) => {
    const { name, location, template, exampleId, additions, presentation } = req.body ?? {};
    if (typeof name !== 'string' || typeof location !== 'string' || !slugify(name)) {
      res.status(400).json({ error: 'A name and location are required.' }); return;
    }
    if (exampleId !== undefined || presentation !== undefined || (Array.isArray(additions) && additions.length)) {
      res.status(400).json({ error: 'Project composition is supplied by the product creator.' }); return;
    }
    try {
      const presets = await sessionCreatePresets(ctx.projectRoot);
      if (!presets) { res.status(409).json({error: 'No product is running to create this project.'}); return; }
      const targetDir = resolve(location.startsWith('~/') ? join(homedir(), location.slice(2)) : location, slugify(name));
      const result = await presets.declaration.create({ name, targetDir, ...(template === undefined ? {} : {template}) });
      const workbench = ctx.options.workbench?.();
      if (workbench) writeWorkbenchDeclaration(result.targetDir, workbench.dir);
      await recordRecentProject(name, result.targetDir);
      res.json({ok: true, path: result.targetDir, config: result.manifest});
    } catch (error) { res.status(400).json({error: error instanceof Error ? error.message : String(error)}); }
  });

  // ---- Native folder dialog ----
  router.post('/__editor/browse-folder', async (req: Request, res: Response) => {
    const body = req.body as { title?: string };
    const title = body.title ?? 'Select Folder';
    const os = platform();

    try {
      let selectedPath: string | null = null;

      if (os === 'darwin') {
        // macOS: use osascript to open a native folder dialog
        const result = await new Promise<string>((ok, fail) => {
          execFile(
            'osascript',
            [
              '-e',
              // S4: escape backslashes BEFORE quotes (and strip control chars)
              // so the title can't break out of the AppleScript string literal.
              `set theFolder to choose folder with prompt "${escapeAppleScriptString(title)}"`,
              '-e',
              'return POSIX path of theFolder',
            ],
            (err, stdout) => {
              if (err) fail(err);
              else ok(stdout.trim());
            },
          );
        });
        if (result) selectedPath = result.replace(/\/$/, ''); // strip trailing slash
      } else if (os === 'linux') {
        // Linux: try zenity, fall back to kdialog
        const result = await new Promise<string>((ok, fail) => {
          execFile(
            'zenity',
            ['--file-selection', '--directory', `--title=${title}`],
            (err, stdout) => {
              if (err) {
                // Try kdialog as fallback
                execFile(
                  'kdialog',
                  ['--getexistingdirectory', homedir(), '--title', title],
                  (err2, stdout2) => {
                    if (err2) fail(err2);
                    else ok(stdout2.trim());
                  },
                );
              } else {
                ok(stdout.trim());
              }
            },
          );
        });
        if (result) selectedPath = result;
      }

      res.json({ path: selectedPath });
    } catch {
      // User cancelled the dialog or no dialog tool available
      res.json({ path: null });
    }
  });

  // ---- Reveal in file manager ----
  router.post('/__editor/reveal', (req: Request, res: Response) => {
    const body = req.body as { path: string };
    const targetPath = body.path;
    if (!targetPath) {
      res.status(400).json({ error: 'Missing path.' });
      return;
    }

    const os = platform();
    if (os === 'darwin') {
      spawn('open', ['-R', targetPath], { stdio: 'ignore', detached: true }).unref();
    } else if (os === 'linux') {
      spawn('xdg-open', [dirname(targetPath)], { stdio: 'ignore', detached: true }).unref();
    } else if (os === 'win32') {
      spawn('explorer', ['/select,', targetPath], { stdio: 'ignore', detached: true }).unref();
    }
    res.json({ ok: true });
  });

  // ---- Save project thumbnail ----
  router.post('/__editor/save-thumbnail', async (req: Request, res: Response) => {
    const body = req.body as { dataUrl: string };
    if (!body.dataUrl || ctx.projectRoot === engineRoot) {
      res.status(400).json({ error: 'No project open or missing data.' });
      return;
    }

    try {
      // Save thumbnail as .vgai/thumbnail.png in project root
      const base64Data = body.dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const vgaiDir = join(ctx.projectRoot, '.vgai');
      await mkdir(vgaiDir, { recursive: true });
      const thumbnailPath = join(vgaiDir, 'thumbnail.png');
      await writeFile(thumbnailPath, Buffer.from(base64Data, 'base64'));

      // Update recent projects entry with thumbnail path
      const projects = await loadRecentProjects(recentProjectsPath);
      const entry = projects.find((p) => p.path === ctx.projectRoot);
      if (entry) {
        entry.thumbnail = `/__editor/project-thumbnail?path=${encodeURIComponent(ctx.projectRoot)}`;
        await saveRecentProjects(projects, recentProjectsPath);
      }

      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to save thumbnail.' });
    }
  });

  // ---- Serve project thumbnail ----
  router.get('/__editor/project-thumbnail', async (req: Request, res: Response) => {
    const targetPath = (req.query['path'] as string) ?? '';
    if (!targetPath) {
      res.status(400).json({ error: 'Missing path.' });
      return;
    }

    const thumbnailPath = join(resolve(targetPath), '.vgai', 'thumbnail.png');
    try {
      const data = await readFile(thumbnailPath);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=60' });
      res.end(data);
    } catch {
      res.status(404).end();
    }
  });

  // ---- Open project (runtime switching) ----
  router.post('/__editor/open-project', async (req: Request, res: Response) => {
    const body = req.body as { path: string };
    const newPath = body.path;

    if (!newPath) {
      res.status(400).json({ error: 'Missing path.' });
      return;
    }

    // Canonicalized (symlink-resolved), not a plain `resolve` — see
    // canonical-path.ts's doc comment (T6.2 slice 3 finding: one project module
    // loads twice if this path and Vite's own resolver disagree on a symlinked
    // segment).
    const absPath = canonicalProjectRoot(newPath);

    // Read the v2 game manifest and derive the editor project view.
    const config = await readProjectView(absPath);
    if (!config) {
      res.status(400).json({ error: `No valid vgai.project.json at ${absPath}` });
      return;
    }

    // Compatibility is enforced by the process that owns the mutable project
    // state, immediately before activation. The browser also preflights this
    // for fast feedback, but it cannot make a client-side check atomic and
    // non-browser API callers must not be able to bypass the contract.
    try {
      const compatibility = compatibilityIdentity();
      assertEditorCompatibility(compatibility);
      assertProjectCompatibility(config, compatibility);
    } catch (error) {
      if (error instanceof ProjectCompatibilityError) {
        res.status(409).json({ error: error.message, recovery: error.recovery });
        return;
      }
      throw error;
    }

    // Update mutable state
    const previousProject = ctx.projectRoot === engineRoot ? null : ctx.projectRoot;
    ctx.projectRoot = absPath;
    ctx.publicRoot = resolve(absPath, 'public');
    // The journal lives INSIDE the project, so a switch to a different project
    // moves it. The switch is written to BOTH files — the departing project's
    // journal ends with where the session went, the arriving one opens with
    // where it came from — so neither reads as an unexplained stop/start.
    // Re-opening the SAME project keeps appending to the same file.
    if (previousProject !== absPath) {
      journalEvent({ kind: 'project-opened', project: absPath, previousProject });
      ctx.journal = openSessionJournal(absPath);
      journalEvent({ kind: 'project-opened', project: absPath, previousProject });
    }
    // A switch starts a fresh build on a fresh project: restart the
    // "never played" clock and forget what was announced about the old one.
    ctx.servingProjectSince = Date.now();
    ctx.cadenceGate = IDLE_TRIPWIRE_GATE;
    ctx.unplayedGate = IDLE_TRIPWIRE_GATE;

    // Clear stale editor state from previous project
    ctx.editorState = {};
    ctx.editorStateUpdatedAt = null;
    ctx.editorStatesByClient.clear();

    // Ensure .vgai/ directory exists
    await mkdir(join(absPath, '.vgai'), { recursive: true });
    void reconcileGenerations();

    // Restart file watcher on new project
    startWatcher();

    // Allow Vite to serve /@fs/ paths from the project directory
    await options.onProjectOpened?.(absPath);

    // Track in recent projects (unless this session is nobody's launcher —
    // see `recordRecentProject`). This route is exactly where an agent's
    // `vgai edit <scratchpad>` used to plant its project in the owner's
    // Recents, by retargeting the owner's idle editor.
    await recordRecentProject((config['name'] as string) ?? 'Untitled', absPath);

    // Notify all connected editors
    broadcast('project-changed', { path: absPath, config });
    // Coding sessions are project-scoped. Tear down only editor-owned
    // Supercode runtime/follower state and rediscover the new folder; this
    // never touches an independently-running terminal harness process.
    void Promise.all([harnessChat.setWorkspace(), projectWork.setWorkspace()]).catch((error) => {
      broadcast('server-log', {
        level: 'error',
        message: `Harness Chat could not switch projects: ${error instanceof Error ? error.message : String(error)}`,
      });
    });

    res.json({ ok: true, config });
  });
}
