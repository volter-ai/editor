/**
 * THE TWO SHARED SETTINGS LAYERS on disk (ARCHITECTURE-CORE §Editor chrome,
 * "Settings have four layers with named homes"):
 *
 *   GET/POST /__editor/settings/user      ~/.vgai/settings.json
 *   GET/POST /__editor/settings/project   <project>/.vgai/settings.json
 *
 * A read validates the file against `EditorSettingsSchema` and, when it does
 * not parse, answers `{ settings: {}, issues }` naming the file's problems so
 * the editor still opens and the person sees exactly what to fix. A write is
 * refused (400, same issues) rather than persisting a document the next read
 * would reject. Whole-document replace, like `/__editor/editor-state`: the
 * client store is the one writer and merges its own patches.
 *
 * The user file's home is `VGAI_USER_SETTINGS_PATH` when set (the same
 * override idiom as `VGAI_ACCOUNT_PATH`), else `~/.vgai/settings.json`.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Request, Response } from 'express';
import { type EditorSettings, parseEditorSettings } from '@volter/editor-project/settings/schema';
import type { EditorServerRouter } from '../editor-server';
import type { RouteContext } from './context';

export const USER_SETTINGS_PATH = process.env['VGAI_USER_SETTINGS_PATH']
  ? resolve(process.env['VGAI_USER_SETTINGS_PATH'])
  : join(homedir(), '.vgai', 'settings.json');

export function projectSettingsPath(projectRoot: string): string {
  return join(projectRoot, '.vgai', 'settings.json');
}

export interface SettingsFileRead {
  readonly settings: EditorSettings;
  /** Validation problems with the file on disk, empty when it parsed (or is absent). */
  readonly issues: readonly string[];
  readonly path: string;
}

export async function readSettingsFile(path: string): Promise<SettingsFileRead> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    return { settings: {}, issues: [], path };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return { settings: {}, issues: [`not JSON: ${(cause as Error).message}`], path };
  }
  const result = parseEditorSettings(parsed);
  return result.settings
    ? { settings: result.settings, issues: [], path }
    : { settings: {}, issues: result.issues, path };
}

const pendingWrites = new Map<string, Promise<void>>();

export async function writeSettingsFile(path: string, settings: EditorSettings): Promise<void> {
  const text = `${JSON.stringify(settings, null, 2)}\n`;
  // Applying a style sets several axes in one turn. Concurrent truncating
  // writes used to interleave, leaving a JSON document with another's tail.
  // Order this server's writes and publish atomically for other sessions.
  const write = (pendingWrites.get(path) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, text, { encoding: 'utf-8', mode: 0o600 });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
    });
  pendingWrites.set(path, write);
  try {
    await write;
  } finally {
    if (pendingWrites.get(path) === write) pendingWrites.delete(path);
  }
}

export function registerSettingsRoutes(router: EditorServerRouter, ctx: RouteContext): void {
  const register = (layer: 'user' | 'project', pathFor: () => string | null) => {
    router.get(`/__editor/settings/${layer}`, async (_req: Request, res: Response) => {
      const path = pathFor();
      if (!path) {
        res.json({ settings: {}, issues: [], path: null });
        return;
      }
      res.json(await readSettingsFile(path));
    });
    router.post(`/__editor/settings/${layer}`, async (req: Request, res: Response) => {
      const path = pathFor();
      if (!path) {
        res.status(400).json({ error: 'No project open.' });
        return;
      }
      const result = parseEditorSettings(req.body);
      if (!result.settings) {
        res.status(400).json({ error: `Invalid ${layer} settings.`, issues: result.issues });
        return;
      }
      try {
        await writeSettingsFile(path, result.settings);
        res.json({ ok: true, path });
      } catch (cause) {
        res.status(500).json({ error: `Could not write ${path}: ${(cause as Error).message}` });
      }
    });
  };
  register('user', () => USER_SETTINGS_PATH);
  register('project', () =>
    ctx.projectRoot === ctx.engineRoot ? null : projectSettingsPath(ctx.projectRoot),
  );
}
