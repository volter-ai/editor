/**
 * `levels` and `levels cook [<level>…]` — A GAME'S LEVELS (`docs/LEVELS.md`). Every `.blend` under
 * the project's `src/` is a level, named for its file (`src/models/film-intro.blend` is
 * `film-intro`). A game loads one with `play.load('<level>')` from its COOK: the frame, the clips
 * and the movie written into `.volter/levels/<level>/` (`blender-cook-level`), so no Blender is in
 * the loop when it loads.
 *
 * `levels` lists them, each `cooked`, `stale` (its `.blend` changed since) or `uncooked`.
 * `levels cook` cooks the named levels, or every one not cooked and current: Blender in the editor
 * opens each in turn, it is cooked once presented, and the editor goes back to the document it was
 * showing. A level's file is opened and read, never saved.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { connect } from '@volter/live';

export const LEVELS_USAGE = 'levels | levels cook [<level>...]';

const LEVELS_DIR = join('.volter', 'levels');
const MANIFEST = 'level.json';
/** How long a level is given to open and be presented in the editor before its cook is refused. */
const OPEN_LIMIT_MS = 180_000;

interface Level {
  readonly level: string;
  readonly blend: string;
  readonly state: 'cooked' | 'stale' | 'uncooked';
  readonly cookedAt: string | null;
}

/** Every `.blend` under `src/`, project-relative with forward slashes. */
function blends(project: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.blend$/i.test(name)) out.push(relative(project, path).split(sep).join('/'));
    }
  };
  if (existsSync(join(project, 'src'))) walk(join(project, 'src'));
  return out.sort();
}

const levelOf = (blend: string): string => (blend.split('/').pop() ?? blend).replace(/\.blend$/i, '');
const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

export function listLevels(project: string): Level[] {
  return blends(project).map((blend) => {
    const level = levelOf(blend);
    const manifest = join(project, LEVELS_DIR, level, MANIFEST);
    if (!existsSync(manifest)) return { level, blend, state: 'uncooked', cookedAt: null };
    const cooked = JSON.parse(readFileSync(manifest, 'utf8')) as { hash?: string; cookedAt?: string };
    return { level, blend, state: cooked.hash === sha256(join(project, blend)) ? 'cooked' : 'stale', cookedAt: cooked.cookedAt ?? null };
  });
}

export async function levels(project: string, args: readonly string[], log: (line: string) => void = (line) => console.log(line)): Promise<unknown> {
  const [verb, ...names] = args;
  if (verb === undefined) return listLevels(project);
  if (verb !== 'cook') throw new Error(`Usage: cyclotron ${LEVELS_USAGE}`);
  const all = listLevels(project);
  const unknown = names.filter((name) => !all.some((one) => one.level === name));
  if (unknown.length) throw new Error(`No level named ${unknown.map((one) => `"${one}"`).join(', ')}; the levels are ${all.map((one) => one.level).join(', ')}.`);
  const todo = names.length ? all.filter((one) => names.includes(one.level)) : all.filter((one) => one.state !== 'cooked');
  if (!todo.length) { log('Every level is cooked and current.'); return listLevels(project); }
  const { editor } = await connect(project);
  const before = ((await editor.status()) as { activeDocumentId?: string | null }).activeDocumentId ?? null;
  const results: unknown[] = [];
  try {
    for (const one of todo) {
      log(`Cooking ${one.level} (${one.blend})…`);
      await editor.open(`model:${one.blend}`);
      const deadline = Date.now() + OPEN_LIMIT_MS;
      for (;;) {
        // (a refused command throws: the editor says why, and "not presented yet" is a wait, not a failure)
        const answer = await editor.blender<{ ok?: boolean; error?: string; ms?: number; bakes?: number; failed?: readonly string[] }>('blender-cook-level', { blend: one.blend })
          .catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }));
        if (answer.ok !== false) {
          log(`  ${one.level}: cooked in ${((answer.ms ?? 0) / 1000).toFixed(1)} s, ${answer.bakes ?? 0} clip(s)${answer.failed?.length ? `; not baked: ${answer.failed.join('; ')}` : ''}`);
          results.push({ level: one.level, ...answer });
          break;
        }
        // Opening a level takes Blender a while; the cook says so until it is presented.
        if (!/not been presented yet/.test(answer.error ?? '') || Date.now() > deadline)
          throw new Error(`levels cook ${one.level}: ${answer.error ?? 'the editor refused the cook'}`);
        await new Promise((done) => setTimeout(done, 2000));
      }
    }
  } finally {
    // Back to what the person was looking at.
    if (before?.startsWith('document:')) await editor.open(before.slice('document:'.length)).catch(() => undefined);
  }
  return { cooked: results, levels: listLevels(project) };
}
