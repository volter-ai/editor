/**
 * CUSTOM PALETTE DOCUMENTS on disk (ARCHITECTURE-CORE §Editor chrome,
 * "Settings have four layers with named homes": themes stay v3 palette
 * DOCUMENTS under `themes/` at the user and project homes):
 *
 *   GET    /__editor/themes/user            ~/.vgai/themes/<id>.json
 *   POST   /__editor/themes/user            { id, document } → write one
 *   DELETE /__editor/themes/user?id=<id>    remove one
 *   …/project                               <project>/.vgai/themes/<id>.json
 *
 * The server stores JSON objects by id; the palette contract itself
 * (`theme-library.ts`, `parseCustomEditorThemeDocument`) is the editor's,
 * so a listing returns every parseable file and the client reports the ones
 * that fail the contract by path. One file per theme, the file name is the
 * id, so a theme is shared the way a `.vscode` file is: copy the file.
 */
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Request, Response } from 'express';
import type { EditorServerRouter } from '../editor-server';
import type { RouteContext } from './context';
import { USER_SETTINGS_PATH } from './settings';

export const USER_THEMES_DIR = join(dirname(USER_SETTINGS_PATH), 'themes');

export function projectThemesDir(projectRoot: string): string {
  return join(projectRoot, '.vgai', 'themes');
}

const THEME_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface ThemeFileRead {
  readonly id: string;
  readonly path: string;
  readonly document: unknown;
}

export async function readThemeDocuments(
  dir: string,
): Promise<{ documents: ThemeFileRead[]; issues: string[] }> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { documents: [], issues: [] };
  }
  const documents: ThemeFileRead[] = [];
  const issues: string[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -'.json'.length);
    const path = join(dir, name);
    if (!THEME_ID.test(id)) {
      issues.push(`${path}: a theme file is named by its id (lower-case letters, digits, - and _)`);
      continue;
    }
    try {
      documents.push({ id, path, document: JSON.parse(await readFile(path, 'utf-8')) });
    } catch (cause) {
      issues.push(`${path}: ${(cause as Error).message}`);
    }
  }
  return { documents, issues };
}

export function registerThemeRoutes(router: EditorServerRouter, ctx: RouteContext): void {
  const register = (layer: 'user' | 'project', dirFor: () => string | null) => {
    router.get(`/__editor/themes/${layer}`, async (_req: Request, res: Response) => {
      const dir = dirFor();
      if (!dir) {
        res.json({ documents: [], issues: [], dir: null });
        return;
      }
      res.json({ ...(await readThemeDocuments(dir)), dir });
    });
    router.post(`/__editor/themes/${layer}`, async (req: Request, res: Response) => {
      const dir = dirFor();
      if (!dir) {
        res.status(400).json({ error: 'No project open.' });
        return;
      }
      const body = req.body as { id?: unknown; document?: unknown } | undefined;
      const id = typeof body?.id === 'string' ? body.id : '';
      if (!THEME_ID.test(id) || !body?.document || typeof body.document !== 'object') {
        res.status(400).json({ error: 'A theme write names an id and carries a JSON document.' });
        return;
      }
      try {
        await mkdir(dir, { recursive: true });
        const path = join(dir, `${id}.json`);
        await writeFile(path, `${JSON.stringify(body.document, null, 2)}\n`, 'utf-8');
        res.json({ ok: true, path });
      } catch (cause) {
        res.status(500).json({ error: `Could not write the theme: ${(cause as Error).message}` });
      }
    });
    router.delete(`/__editor/themes/${layer}`, async (req: Request, res: Response) => {
      const dir = dirFor();
      const id = typeof req.query['id'] === 'string' ? req.query['id'] : '';
      if (!dir || !THEME_ID.test(id)) {
        res.status(400).json({ error: 'A theme delete names an id.' });
        return;
      }
      try {
        await unlink(join(dir, `${id}.json`));
        res.json({ ok: true });
      } catch (cause) {
        res.status(404).json({ error: `No theme ${id}: ${(cause as Error).message}` });
      }
    });
  };
  register('user', () => USER_THEMES_DIR);
  register('project', () =>
    ctx.projectRoot === ctx.engineRoot ? null : projectThemesDir(ctx.projectRoot),
  );
}
