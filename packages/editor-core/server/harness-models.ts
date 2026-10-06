/**
 * THE MODELS AND REASONING EFFORTS A CHAT CAN CHOOSE, READ FROM EACH HARNESS ITSELF.
 *
 * Claude Code states both in its own `--help`: `--effort <level>` lists its levels
 * ("low, medium, high, xhigh, max" in 2.1.291) and `--model` names its aliases.
 * Codex keeps the models its account can use, each with its own effort levels, in
 * `$CODEX_HOME/models_cache.json` (the file Codex's own model picker reads). A harness
 * whose list cannot be read offers only its default plus an exact model ID, so a new
 * CLI's levels appear without an editor release and a list is never invented.
 */
import { exec, execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface HarnessModelChoice {
  id: string;
  name: string;
  description?: string;
  /** The efforts this model takes, in the harness's own order; `[]` when it takes none. */
  efforts: string[];
}

const HARNESS_DEFAULT = 'Harness default';

/** Claude Code's models and efforts from its `--help` text. */
export function claudeChoicesFromHelp(help: string): HarnessModelChoice[] {
  // Each option's text runs to the next option line, so another option's parenthetical is never read as its levels.
  const effortText = /--effort <[^>]+>([\s\S]*?)\n\s{0,4}-/.exec(help)?.[1] ?? '';
  const effortLine = /\(([^)]*)\)/.exec(effortText)?.[1] ?? '';
  const efforts = effortLine.split(/,\s*|\s+or\s+/).map(level => level.trim()).filter(level => /^[a-z]+$/.test(level));
  const modelText = /--model <[^>]+>([\s\S]*?)\n\s{0,4}-/.exec(help)?.[1] ?? '';
  const aliases = [...modelText.matchAll(/'([a-z][a-z0-9.-]*)'/g)].map(match => match[1]!);
  return [
    { id: '', name: HARNESS_DEFAULT, efforts },
    ...[...new Set(aliases)].map(id => ({ id, name: `Claude ${id[0]!.toUpperCase()}${id.slice(1)}`, description: 'Latest model of this name', efforts })),
  ];
}

/** Codex's listed models and each one's efforts from its own models cache. */
export function codexChoicesFromCache(cache: unknown): HarnessModelChoice[] {
  const models = (cache as { models?: unknown } | null)?.models;
  const listed = Array.isArray(models) ? models.filter((model): model is Record<string, unknown> =>
    typeof model === 'object' && model !== null && typeof model['slug'] === 'string' && model['visibility'] === 'list') : [];
  const effortsOf = (model: Record<string, unknown>) => Array.isArray(model['supported_reasoning_levels'])
    ? model['supported_reasoning_levels'].map(level => (level as { effort?: unknown })?.effort).filter((effort): effort is string => typeof effort === 'string' && /^[a-z]+$/.test(effort))
    : [];
  // The default model is the account's, not named here: offer only the efforts every listed model takes.
  const levels = listed.map(effortsOf);
  const common = levels.length ? levels[0]!.filter(effort => levels.every(model => model.includes(effort))) : [];
  return [
    { id: '', name: HARNESS_DEFAULT, efforts: common },
    ...listed.map(model => ({
      id: model['slug'] as string,
      name: typeof model['display_name'] === 'string' ? model['display_name'] : model['slug'] as string,
      ...(typeof model['description'] === 'string' ? { description: model['description'] } : {}),
      efforts: effortsOf(model),
    })),
  ];
}

const cache = new Map<string, { at: number; read: boolean; choices: HarnessModelChoice[] }>();
const reading = new Map<string, Promise<void>>();
const FRESH_MS = 5 * 60_000;
/** How long an unreadable list stands before the harness is asked again. */
const RETRY_MS = 60_000;
const DEFAULT_ONLY: HarnessModelChoice[] = [{ id: '', name: HARNESS_DEFAULT, efforts: [] }];

/** The choices for `harness` as last read, never waiting on the harness: a missing or stale list is read in the
 *  background (at most one read per harness at a time) and appears in a later snapshot. A list read is kept five
 *  minutes; an unreadable one (a missing, slow or failing CLI) one minute. `env` is the Chat's launch environment. */
export function harnessModelChoices(harness: string, env: NodeJS.ProcessEnv = process.env): HarnessModelChoice[] {
  const known = cache.get(harness);
  const fresh = known && Date.now() - known.at < (known.read ? FRESH_MS : RETRY_MS);
  if (!fresh && !reading.has(harness)) {
    reading.set(harness, readChoices(harness, env)
      .then(choices => { cache.set(harness, { at: Date.now(), read: true, choices }); })
      .catch(() => { cache.set(harness, { at: Date.now(), read: false, choices: known?.choices ?? DEFAULT_ONLY }); })
      .finally(() => { reading.delete(harness); }));
  }
  return known?.choices ?? DEFAULT_ONLY;
}

async function readChoices(harness: string, env: NodeJS.ProcessEnv): Promise<HarnessModelChoice[]> {
  if (harness === 'claude-code') {
    // A shell on Windows finds an npm `claude.cmd` as well as `claude.exe`; the command line is fixed.
    const options = { env, encoding: 'utf8' as const, timeout: 10_000, windowsHide: true };
    const help = await new Promise<string>((resolve, reject) => {
      const done = (error: Error | null, stdout: string) => (error ? reject(error) : resolve(stdout));
      if (process.platform === 'win32') exec('claude --help', options, done);
      else execFile('claude', ['--help'], options, done);
    });
    const choices = claudeChoicesFromHelp(help);
    if (choices.length > 1 || choices[0]!.efforts.length) return choices;
    throw new Error('claude --help named no models or efforts');
  }
  if (harness === 'codex') {
    const home = env['CODEX_HOME'] || join(homedir(), '.codex');
    return codexChoicesFromCache(JSON.parse(await readFile(join(home, 'models_cache.json'), 'utf8')));
  }
  return DEFAULT_ONLY;
}
