/**
 * export-cycle-probe/compare-models.ts — deep-compare two GodotProject models.
 *
 * Identity is semantic. `projectDir` always differs. Script `bytes`/`lineCount` follow the
 * pretty-printer, and AST `line` fields follow comment-stripping — those are named
 * writer-normalization, not losses. Everything else is a finding.
 */
import type { GodotProject } from '../../src/read/godot-types';

export interface ModelDiff {
  readonly path: string;
  readonly original: unknown;
  readonly cycled: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripAstLines(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripAstLines);
  if (!isPlainObject(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'line') continue;
    next[key] = stripAstLines(child);
  }
  return next;
}

function mapToObject(map: ReadonlyMap<unknown, unknown>): Record<string, unknown> {
  const entries = [...map.entries()].map(([key, value]) => [
    typeof key === 'string' ? key : JSON.stringify(key),
    normalize(value),
  ]);
  entries.sort(([a], [b]) => (a as string).localeCompare(b as string));
  return Object.fromEntries(entries);
}

function normalize(value: unknown): unknown {
  if (value instanceof Map) return mapToObject(value);
  if (Array.isArray(value)) return value.map(normalize);
  if (!isPlainObject(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    next[key] = normalize(child);
  }
  return next;
}

function normalizeProject(project: GodotProject): unknown {
  const { projectDir: _projectDir, scripts, ...rest } = project;
  return normalize({
    ...rest,
    scripts: scripts.map((script) => ({
      resPath: script.resPath,
      globalClass: script.globalClass,
      attachments: script.attachments,
      autoloadName: script.autoloadName,
      parsed: script.parsed,
      parseError: script.parseError,
      ast: script.ast === undefined ? undefined : stripAstLines(script.ast),
    })),
  });
}

function pushDiff(into: ModelDiff[], path: string, original: unknown, cycled: unknown): void {
  into.push({ path, original, cycled });
}

function diffValue(path: string, left: unknown, right: unknown, into: ModelDiff[]): void {
  if (Object.is(left, right)) return;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      pushDiff(into, path, left, right);
      return;
    }
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i++) {
      diffValue(`${path}[${i}]`, left[i], right[i], into);
    }
    return;
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) {
      pushDiff(into, path, left, right);
      return;
    }
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of [...keys].sort()) {
      const child = path.length === 0 ? key : `${path}.${key}`;
      if (!(key in left)) {
        pushDiff(into, child, undefined, right[key]);
        continue;
      }
      if (!(key in right)) {
        pushDiff(into, child, left[key], undefined);
        continue;
      }
      diffValue(child, left[key], right[key], into);
    }
    return;
  }
  pushDiff(into, path, left, right);
}

export function compareGodotProjects(original: GodotProject, cycled: GodotProject): ModelDiff[] {
  const diffs: ModelDiff[] = [];
  diffValue('', normalizeProject(original), normalizeProject(cycled), diffs);
  return diffs;
}

export type LedgerReason = 'model-gap' | 'emitter-gap' | 'writer-normalization';

export interface ClassifiedDiff {
  readonly diff: ModelDiff;
  readonly reason: LedgerReason;
  readonly id: string;
}

/** Scene-import params now live on `ImportSidecar.sceneParams` and the cycle emits them.
 *  A remaining glb-family diff is unexpected: name it, do not swallow it. */
export function classifyCycleDiffs(diffs: readonly ModelDiff[]): {
  readonly ledger: ClassifiedDiff[];
  readonly unexpected: ModelDiff[];
} {
  return { ledger: [], unexpected: [...diffs] };
}

export function summarizeDiffs(diffs: readonly ModelDiff[], limit = 40): string {
  if (diffs.length === 0) return '0 diffs';
  const head = diffs
    .slice(0, limit)
    .map(
      (diff) => `  ${diff.path}: ${JSON.stringify(diff.original)} → ${JSON.stringify(diff.cycled)}`,
    )
    .join('\n');
  const more = diffs.length > limit ? `\n  … ${diffs.length - limit} more` : '';
  return `${diffs.length} diff(s)\n${head}${more}`;
}
