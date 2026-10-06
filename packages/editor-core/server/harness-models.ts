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
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
  const effortLine = /--effort <[^>]+>[\s\S]*?\(([^)]*)\)/.exec(help)?.[1] ?? '';
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
  const all = [...new Set(listed.flatMap(effortsOf))];
  return [
    { id: '', name: HARNESS_DEFAULT, efforts: all },
    ...listed.map(model => ({
      id: model['slug'] as string,
      name: typeof model['display_name'] === 'string' ? model['display_name'] : model['slug'] as string,
      ...(typeof model['description'] === 'string' ? { description: model['description'] } : {}),
      efforts: effortsOf(model),
    })),
  ];
}

const cache = new Map<string, { at: number; choices: HarnessModelChoice[] }>();
const FRESH_MS = 5 * 60_000;

/** The choices for `harness`, read at most once every five minutes. `env` is the Chat's launch environment. */
export function harnessModelChoices(harness: string, env: NodeJS.ProcessEnv = process.env): HarnessModelChoice[] {
  const known = cache.get(harness);
  if (known && Date.now() - known.at < FRESH_MS) return known.choices;
  let choices: HarnessModelChoice[] = [{ id: '', name: HARNESS_DEFAULT, efforts: [] }];
  try {
    if (harness === 'claude-code') {
      // A shell on Windows finds an npm `claude.cmd` as well as `claude.exe`; the command line is fixed.
      const options = { env, encoding: 'utf8' as const, timeout: 10_000, windowsHide: true };
      const help = process.platform === 'win32'
        ? spawnSync('claude --help', { ...options, shell: true })
        : spawnSync('claude', ['--help'], options);
      if (help.status === 0 && help.stdout) choices = claudeChoicesFromHelp(help.stdout);
    } else if (harness === 'codex') {
      const home = env['CODEX_HOME'] || join(homedir(), '.codex');
      choices = codexChoicesFromCache(JSON.parse(readFileSync(join(home, 'models_cache.json'), 'utf8')));
    }
  } catch { /* the harness's list is unreadable: its default and an exact ID remain */ }
  cache.set(harness, { at: Date.now(), choices });
  return choices;
}
