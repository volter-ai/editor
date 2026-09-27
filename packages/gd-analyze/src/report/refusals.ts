/**
 * `gd-analyze refusals` — every refusal the import plan holds, per kit and by family.
 *
 * A read-only observer: it runs the import's front half (`withBoundGodotProject`) and the
 * translation plan, and stops there; nothing is emitted, installed or built. Lowering records
 * every refusal a script holds (`LoweringContext.recover`), so the counts are the lane's real
 * denominator rather than one gap per file. A project the front half refuses (a Godot 3 project,
 * an analyze diagnostic) is reported with that refusal's lines.
 *
 * A family is a refusal message with its particulars masked: resource paths, numbers, and the
 * Godot names a message quotes (`Class.member`, `Class`). Each family keeps the names it masked,
 * counted, so "which bindings" stays one step away from "which kind of gap".
 */
import { readdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBoundGodotProject } from '../import-project';
import { planGodotTranslation } from '../translate/plan';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES_DIR = path.join(PACKAGE_DIR, 'test', 'fixtures');

type Stage = 'front' | 'code' | 'field' | 'scene';

interface Refusal {
  readonly stage: Stage;
  readonly at: string;
  readonly message: string;
}

interface Family {
  readonly stage: Stage;
  readonly shape: string;
  count: number;
  readonly subjects: Record<string, number>;
  readonly at: string[];
}

interface KitRefusals {
  readonly fixture: string;
  /** `failed`: the front half threw something other than a refusal it makes by design. */
  readonly outcome: 'planned' | 'refused' | 'front-refused' | 'failed';
  readonly refusals: readonly Refusal[];
  /** The pinned API dump's class names, when the front half got far enough to load it. */
  readonly classes?: readonly string[];
}

const FRONT_REFUSAL = /no exact official bound frontend is pinned/u;

/** A failure of the plan itself, not a refusal it reports: the report re-throws it. */
class PlanCrash extends Error {
  constructor(readonly original: unknown) {
    super('plan crashed', { cause: original });
  }
}

// A path runs to its extension, so a directory with a space (`GLB format/`) stays one path.
const PATH = /res:\/\/[^`'",:)\n]*?\.[A-Za-z0-9]+(?=[\s`'",:)]|$)|(?:res|uid):\/\/[^\s`'",:)]*/gu;
const QUALIFIED = /\b([A-Z][A-Za-z0-9]*)((?:\.[A-Za-z_][A-Za-z0-9_]*)+)(?:\(\))?/gu;
const WORD = /\b[A-Z][A-Za-z0-9]*\b/gu;
const NUMBER = /\b\d+(?:\.\d+)?\b/gu;

function parsedRuleIdentity(text: string): { readonly inputDatatypes?: readonly string[] } | undefined {
  try {
    return JSON.parse(text) as { inputDatatypes?: readonly string[] };
  } catch {
    return undefined;
  }
}

/**
 * The message with its particulars masked, and the Godot names it masked. `classes` is the pinned
 * API dump's engine and built-in class names: only those mask, so a file name (`Main.tscn`) or a
 * word (`TypeScript`) stays in the shape.
 */
export function refusalFamily(
  message: string,
  classes: ReadonlySet<string>,
): { readonly shape: string; readonly subjects: readonly string[] } {
  const subjects: string[] = [];
  // A code rule's identity is its semantic key and the datatypes it met; the key is the family,
  // the datatypes its subject.
  const rule = /^no code rule for (.+?); identity=(\{.*\})$/su.exec(message);
  const identity = rule === null ? undefined : parsedRuleIdentity(rule[2] as string);
  if (rule !== null && identity !== undefined) {
    const types = (identity.inputDatatypes ?? []).map((datatype) => datatype.split('|')[2] ?? datatype);
    return { shape: `no code rule for ${(rule[1] as string).replace(NUMBER, '<n>')}`, subjects: [`(${types.join(', ')})`] };
  }
  const shape = message
    .replace(/ hash:\d+/gu, '')
    .replace(/@GlobalScope\.[A-Za-z_][A-Za-z0-9_]*/gu, (name) => {
      subjects.push(name);
      return '<Class.member>';
    })
    .replace(PATH, '<path>')
    .replace(QUALIFIED, (name, owner: string) => {
      if (!classes.has(owner)) return name;
      subjects.push(name);
      return '<Class.member>';
    })
    .replace(WORD, (name) => {
      if (!classes.has(name)) return name;
      subjects.push(name);
      return '<Class>';
    })
    .replace(NUMBER, '<n>');
  return { shape, subjects };
}

function stageOf(at: string): Stage {
  if (/\.gd:\d+:\d+$/u.test(at)) return 'code';
  if (at.includes('#') && /\.[A-Za-z_][A-Za-z0-9_]*$/u.test(at)) return 'field';
  return 'scene';
}

function frontRefusals(error: unknown): Refusal[] {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const split = /^(\S+?:(?:\d+:\d+)?)\s+(.*)$/u.exec(line);
      return { stage: 'front', at: split?.[1] ?? '', message: split?.[2] ?? line };
    });
}

function readKit(fixture: string, exporter: string, official: string): KitRefusals {
  process.stdout.write(`refusals: ${fixture}\n`);
  try {
    return withBoundGodotProject(
      path.join(FIXTURES_DIR, fixture),
      { boundExporterBinary: exporter, officialBinary: official },
      (boundProject, toolchain): KitRefusals => {
        const dump = toolchain.frontend.apiDump.parsed;
        const classes = [...dump.classes.map((entry) => entry.name), ...(dump.builtinClasses ?? []).map((entry) => entry.name)];
        let plan: ReturnType<typeof planGodotTranslation>;
        try {
          plan = planGodotTranslation(boundProject, toolchain);
        } catch (error) {
          throw new PlanCrash(error);
        }
        if (plan.kind !== 'refused-translation') return { fixture, outcome: 'planned', refusals: [], classes };
        return {
          fixture,
          outcome: 'refused',
          refusals: plan.diagnostics.map((entry) => ({ stage: stageOf(entry.at), at: entry.at, message: entry.message })),
          classes,
        };
      },
    );
  } catch (error) {
    if (error instanceof PlanCrash) throw error.original;
    const message = error instanceof Error ? error.message : String(error);
    // The front half's one refusal by design today: a project no pinned frontend reads.
    if (FRONT_REFUSAL.test(message)) return { fixture, outcome: 'front-refused', refusals: frontRefusals(error) };
    process.stderr.write(`refusals: ${fixture} FAILED in the front half:\n${message}\n`);
    return { fixture, outcome: 'failed', refusals: [] };
  }
}

function families(refusals: readonly Refusal[], classes: ReadonlySet<string>): Family[] {
  const byKey = new Map<string, Family>();
  for (const refusal of refusals) {
    const { shape, subjects } = refusalFamily(refusal.message, classes);
    const key = `${refusal.stage}\0${shape}`;
    let family = byKey.get(key);
    if (family === undefined) {
      family = { stage: refusal.stage, shape, count: 0, subjects: {}, at: [] };
      byKey.set(key, family);
    }
    family.count += 1;
    family.at.push(refusal.at);
    for (const subject of subjects) family.subjects[subject] = (family.subjects[subject] ?? 0) + 1;
  }
  return [...byKey.values()].sort((left, right) => right.count - left.count || left.shape.localeCompare(right.shape));
}

function subjectsLine(subjects: Record<string, number>): string {
  const entries = Object.entries(subjects).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (entries.length === 0) return '';
  const shown = entries.slice(0, 8).map(([name, count]) => (count > 1 ? `${name} ×${String(count)}` : name));
  return `      ${shown.join(', ')}${entries.length > 8 ? `, … ${String(entries.length - 8)} more` : ''}\n`;
}

export function runRefusals(
  requested: readonly string[],
  exporter: string,
  official: string,
  out?: string,
): number {
  const fixtures =
    requested.length > 0
      ? requested
      : readdirSync(FIXTURES_DIR)
          .filter((name) => name.endsWith('.UPSTREAM.lock'))
          .map((name) => name.slice(0, -'.UPSTREAM.lock'.length))
          .sort();
  const kits = fixtures.map((fixture) => readKit(fixture, exporter, official));
  const classes = new Set(kits.flatMap((kit) => kit.classes ?? []));
  const report = {
    kits: kits.map(({ classes: _classes, ...kit }) => ({ ...kit, families: families(kit.refusals, classes) })),
    total: families(kits.flatMap((kit) => kit.refusals), classes),
  };
  for (const kit of report.kits) {
    process.stdout.write(`\n${kit.fixture}: ${kit.outcome}, ${String(kit.refusals.length)} refusals\n`);
    for (const family of kit.families) {
      process.stdout.write(`  ${String(family.count).padStart(4)}  [${family.stage}] ${family.shape}\n${subjectsLine(family.subjects)}`);
    }
  }
  process.stdout.write('\nall kits, by family:\n');
  for (const family of report.total) {
    const perKit = report.kits
      .map((kit) => [kit.fixture, kit.families.find((entry) => entry.stage === family.stage && entry.shape === family.shape)?.count ?? 0] as const)
      .filter(([, count]) => count > 0)
      .map(([fixture, count]) => `${fixture} ${String(count)}`)
      .join(', ');
    process.stdout.write(`  ${String(family.count).padStart(4)}  [${family.stage}] ${family.shape}\n        ${perKit}\n`);
  }
  if (out !== undefined) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  return kits.some((kit) => kit.outcome === 'failed') ? 1 : 0;
}
