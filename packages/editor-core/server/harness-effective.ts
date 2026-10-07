/**
 * THE MODEL AND REASONING EFFORT A CHAT WILL ACTUALLY RUN WITH, READ FROM THE HARNESS'S OWN CONFIGURATION.
 *
 * A chat that picks nothing still runs a definite model at a definite effort: the one the harness's own settings
 * name. The Chat shows that, never "default model". Precedence follows each harness:
 *
 * - Claude Code: the chat's `--model`/`--effort`, then `ANTHROPIC_MODEL`/`CLAUDE_CODE_EFFORT_LEVEL`, then the
 *   project's `.claude/settings.local.json`, `.claude/settings.json` and `~/.claude/settings.json`. An effort set for
 *   one model (`modelSettings[<model>].effortLevel`) beats the general `effortLevel`. An alias (`opus`) resolves to
 *   the newest full ID Claude Code has itself recorded for it (`~/.claude.json`), and the runtime's own report of
 *   its model (`observed`) replaces any of this once a turn starts.
 * - Codex: the chat's `-c model=`/`model_reasoning_effort=`, then `$CODEX_HOME/config.toml` (its `profile` first),
 *   then the account's first listed model in `models_cache.json` and that model's `default_reasoning_level`.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ChatSelection } from './frontend-controls';

export interface EffectiveChat {
  /** The model ID or alias the harness will run; '' only when nothing names one. */
  model: string;
  /** How the Chat names it ("Claude Opus 5.5", "GPT-6.1-Sol"). */
  modelName: string;
  /** The reasoning effort; '' when the model takes none or nothing names one. */
  effort: string;
}

function json(path: string): Record<string, unknown> | null {
  try { const value = JSON.parse(readFileSync(path, 'utf8')); return value && typeof value === 'object' ? value as Record<string, unknown> : null; } catch { return null; }
}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : '';

/** "claude-opus-5-5" → "Claude Opus 5.5"; an alias "opus" → "Claude Opus". Anything else stays as given. */
export function claudeModelName(model: string): string {
  // Version parts are one or two digits; an eight-digit date suffix (claude-sonnet-4-5-20250929) is not part of it.
  const match = /^claude-([a-z]+)((?:-\d{1,2})*)(?:-\d{8})?(\[1m\])?$/.exec(model);
  if (match) return `Claude ${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)}${match[2] ? ' ' + match[2].slice(1).replace(/-/g, '.') : ''}${match[3] ? ' (1M)' : ''}`;
  const alias = /^([a-z]+)(\[1m\])?$/.exec(model);
  if (alias) return `Claude ${alias[1]![0]!.toUpperCase()}${alias[1]!.slice(1)}${alias[2] ? ' (1M)' : ''}`;
  return model;
}

/** The newest `claude-<alias>-N-N` ID among those Claude Code has recorded, or '' when it has recorded none. */
export function resolveClaudeAlias(alias: string, recorded: readonly string[]): string {
  const version = (id: string) => (/^claude-[a-z]+-((?:\d+-?)+)/.exec(id)?.[1] ?? '').split('-').filter(Boolean).map(Number);
  const newer = (a: number[], b: number[]) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0); return false; };
  let best = '';
  for (const id of recorded) if (id.startsWith(`claude-${alias}-`) && !/\d{8}$/.test(id) && (!best || newer(version(id), version(best)))) best = id;
  return best;
}

/** Every full model ID found under `modelSettings`, `lastModelUsage` and `model` keys in Claude Code's records. */
function recordedClaudeModels(...records: (Record<string, unknown> | null)[]): string[] {
  const found = new Set<string>();
  const walk = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 6) return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if ((key === 'modelSettings' || key === 'lastModelUsage') && child && typeof child === 'object') for (const id of Object.keys(child)) if (id.startsWith('claude-')) found.add(id);
      if (key === 'model' && typeof child === 'string' && child.startsWith('claude-')) found.add(child);
      walk(child, depth + 1);
    }
  };
  for (const record of records) walk(record, 0);
  return [...found];
}

export function effectiveClaude(selection: ChatSelection, projectRoot: string, env: NodeJS.ProcessEnv, observed: string | null, home = homedir()): EffectiveChat {
  const layers = [json(join(projectRoot, '.claude', 'settings.local.json')), json(join(projectRoot, '.claude', 'settings.json')), json(join(home, '.claude', 'settings.json'))];
  const first = (pick: (layer: Record<string, unknown>) => unknown) => { for (const layer of layers) { const value = layer ? text(pick(layer)) : ''; if (value) return value; } return ''; };
  const configured = text(selection.model) || text(env['ANTHROPIC_MODEL']) || first(layer => layer['model']);
  let model = text(observed) || configured;
  // An alias, with Claude Code's context suffix kept: `opus[1m]` resolves as `opus` and stays 1M.
  const alias = /^([a-z]+)(\[1m\])?$/.exec(model);
  if (alias) {
    const resolved = resolveClaudeAlias(alias[1]!, recordedClaudeModels(...layers, json(join(home, '.claude.json'))));
    if (resolved) model = resolved + (alias[2] ?? '');
  }
  const perModel = (id: string) => first(layer => ((layer['modelSettings'] as Record<string, { effortLevel?: unknown }> | undefined)?.[id])?.effortLevel);
  const effort = text(selection.effort) || text(env['CLAUDE_CODE_EFFORT_LEVEL']) || (model ? perModel(model) || perModel(model.replace(/\[1m\]$/, '')) : '') || first(layer => layer['effortLevel']);
  return { model, modelName: model ? claudeModelName(model) : '', effort };
}

/** Top-level `key = "value"` pairs of a TOML file, and those of each `[profiles.<name>]` table. */
export function codexConfig(toml: string): { top: Record<string, string>; profiles: Record<string, Record<string, string>> } {
  const top: Record<string, string> = {};
  const profiles: Record<string, Record<string, string>> = {};
  let table: Record<string, string> | null = top;
  for (const line of toml.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) { const profile = /^profiles\.("?)([^"]+)\1$/.exec(header[1]!.trim()); table = profile ? (profiles[profile[2]!] ??= {}) : null; continue; }
    const pair = /^\s*([A-Za-z0-9_]+)\s*=\s*"([^"]*)"/.exec(line);
    if (pair && table) table[pair[1]!] = pair[2]!;
  }
  return { top, profiles };
}

export function effectiveCodex(selection: ChatSelection, env: NodeJS.ProcessEnv, observed: string | null, home = homedir()): EffectiveChat {
  const codexHome = env['CODEX_HOME'] || join(home, '.codex');
  let config: ReturnType<typeof codexConfig> = { top: {}, profiles: {} };
  try { config = codexConfig(readFileSync(join(codexHome, 'config.toml'), 'utf8')); } catch { /* no config */ }
  const profile = config.top['profile'] ? config.profiles[config.top['profile']] ?? {} : {};
  const listed = ((json(join(codexHome, 'models_cache.json'))?.['models'] as Record<string, unknown>[] | undefined) ?? [])
    .filter(m => m && typeof m['slug'] === 'string' && m['visibility'] === 'list')
    .sort((a, b) => (Number(a['priority']) || 0) - (Number(b['priority']) || 0));
  const model = text(observed) || text(selection.model) || text(profile['model']) || text(config.top['model']) || text(listed[0]?.['slug']);
  const entry = listed.find(m => m['slug'] === model);
  const effort = text(selection.effort) || text(profile['model_reasoning_effort']) || text(config.top['model_reasoning_effort']) || text(entry?.['default_reasoning_level']);
  return { model, modelName: text(entry?.['display_name']) || model, effort };
}

/** What a chat of `selection.harness` runs; `observed` is the model its runtime reported, when one is running. */
export function effectiveChat(selection: ChatSelection, projectRoot: string, env: NodeJS.ProcessEnv, observed: string | null = null): EffectiveChat | null {
  if (selection.harness === 'claude-code') return effectiveClaude(selection, projectRoot, env, observed);
  if (selection.harness === 'codex') return effectiveCodex(selection, env, observed);
  return null;
}
