/**
 * `gd-analyze evidence <class>`: run one compat module's cases in the official Godot 4.7 binary
 * and in Node, compare them, and on full agreement write the binding rows and the semantic claims
 * that make those rows usable (`src/translate/code/authority/godot-4.7/<class>.json`).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SemanticClaimRecord } from '../godot-frontend/semantic-claims';
import { godotSourceAuthority } from '../godot-frontend/source-authority';
import type { GodotCodeClaimLiveness } from '../translate/code/authority';
import {
  compatModuleFile,
  GODOT_4_7_EVIDENCE_DIR,
  type GodotEvidenceFile,
} from '../translate/code/authority/godot-4.7-evidence';
import {
  type GodotBindingEntry,
  type GodotOfficialSymbolIdentity,
  godotOfficialSymbolKey,
} from '../translate/code/bindings';
import type { GodotEvidenceCase, GodotEvidenceCaseFile, GodotEvidenceComparator } from './case';

/** The official Godot 4.7-stable macOS executable this lane's native evidence is taken from. */
export const GODOT_4_7_OFFICIAL_EXECUTABLE_SHA256 =
  '445c6f95030e2ca767dd921be1e91bd99e50c3703f91d22a22cd31216c93a80f' as const;

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const CASES_DIR = path.join(PACKAGE_ROOT, 'evidence/godot-4.7');
const OUTPUT_MARKER = 'GD_ANALYZE_EVIDENCE ';

type Encoded =
  | { readonly t: 'bool'; readonly v: boolean }
  | { readonly t: 'int'; readonly v: string }
  | { readonly t: 'float'; readonly v: string }
  | { readonly t: 'Vector3'; readonly x: string; readonly y: string; readonly z: string }
  | { readonly t: 'unsupported'; readonly type: string };

type Row = readonly [id: string, value: Encoded];

interface CompatExport {
  readonly exportName: string;
  readonly godotMember: string;
  readonly sourceFile: string;
  readonly sourceLine: number;
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** IEEE-754 binary64 bytes, little-endian, as hex: the same bytes Godot's `to_byte_array()` gives. */
function floatBits(value: number): string {
  return Buffer.from(new Float64Array([value]).buffer).toString('hex');
}

function bitsFloat(hex: string): number {
  return new Float64Array(new Uint8Array(Buffer.from(hex, 'hex')).buffer)[0] as number;
}

function encodeTarget(value: unknown): Encoded {
  if (typeof value === 'boolean') return { t: 'bool', v: value };
  if (typeof value === 'number') return { t: 'float', v: floatBits(value) };
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value).sort().join(',');
    const record = value as Readonly<Record<string, unknown>>;
    if (
      keys === 'x,y,z' &&
      typeof record['x'] === 'number' &&
      typeof record['y'] === 'number' &&
      typeof record['z'] === 'number'
    ) {
      return {
        t: 'Vector3',
        x: floatBits(record['x']),
        y: floatBits(record['y']),
        z: floatBits(record['z']),
      };
    }
  }
  return { t: 'unsupported', type: typeof value };
}

const PROBE_HEADER = `extends SceneTree

func _bits(value: float) -> String:
\treturn PackedFloat64Array([value]).to_byte_array().hex_encode()

func _enc(value: Variant) -> Dictionary:
\tmatch typeof(value):
\t\tTYPE_BOOL:
\t\t\treturn {"t": "bool", "v": value}
\t\tTYPE_INT:
\t\t\treturn {"t": "int", "v": str(value)}
\t\tTYPE_FLOAT:
\t\t\treturn {"t": "float", "v": _bits(value)}
\t\tTYPE_VECTOR3:
\t\t\treturn {"t": "Vector3", "x": _bits(value.x), "y": _bits(value.y), "z": _bits(value.z)}
\treturn {"t": "unsupported", "type": type_string(typeof(value))}
`;

/**
 * Each case is its own function. The GDScript compiler pools a function's constants in a
 * `HashMap<Variant, int>` (`modules/gdscript/gdscript_byte_codegen.h:107`) whose key equality
 * merges `-0.0` into an earlier `0.0`; one folded constant per function keeps each value intact.
 */
function probeSource(cases: readonly GodotEvidenceCase[]): string {
  const functions = cases.map((entry, index) => {
    if (/[\n\r]/.test(entry.gdscript)) throw new Error(`${entry.id}: GDScript must be one line`);
    return `\nfunc _case_${String(index)}() -> Variant:\n\treturn ${entry.gdscript}\n`;
  });
  const rows = cases.map(
    (entry, index) =>
      `\trows.append([${JSON.stringify(entry.id)}, _enc(_case_${String(index)}())])\n`,
  );
  return `${PROBE_HEADER}${functions.join('')}\nfunc _init() -> void:\n\tvar rows: Array = []\n${rows.join('')}\tprint(${JSON.stringify(OUTPUT_MARKER)} + JSON.stringify(rows))\n\tquit()\n`;
}

const PROJECT_SOURCE = `config_version=5

[application]
config/name="gd-analyze evidence"
config/features=PackedStringArray("4.7")
`;

function officialBuildIdentity(officialBinary: string): string {
  const result = spawnSync(officialBinary, ['--headless', '--version'], { encoding: 'utf8' });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`official Godot --version failed: ${result.error?.message ?? result.stderr}`);
  }
  return `Godot ${result.stdout.trim()}`;
}

function runNative(officialBinary: string, cases: readonly GodotEvidenceCase[]): Row[] {
  const temp = mkdtempSync(path.join(tmpdir(), 'gd-analyze-evidence-'));
  try {
    writeFileSync(path.join(temp, 'project.godot'), PROJECT_SOURCE);
    writeFileSync(path.join(temp, 'probe.gd'), probeSource(cases));
    const result = spawnSync(
      officialBinary,
      ['--headless', '--path', temp, '--script', 'res://probe.gd'],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    );
    if (result.error !== undefined) {
      throw new Error(`could not run the official Godot binary: ${result.error.message}`);
    }
    const line = result.stdout.split('\n').find((entry) => entry.startsWith(OUTPUT_MARKER));
    if (result.status !== 0 || line === undefined) {
      throw new Error(
        `official Godot probe exited ${String(result.status)} without its result.\n${result.stdout}\n${result.stderr}`.trim(),
      );
    }
    const rows = JSON.parse(line.slice(OUTPUT_MARKER.length)) as Row[];
    if (rows.length !== cases.length) {
      throw new Error(`official Godot probe returned ${String(rows.length)} of ${String(cases.length)} cases`);
    }
    return rows;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function runTarget(cases: readonly GodotEvidenceCase[]): Row[] {
  return cases.map((entry) => [entry.id, encodeTarget(entry.target())]);
}

function float32OrderedBits(value: number): number {
  const bits = new Int32Array(new Float32Array([value]).buffer)[0] as number;
  return bits < 0 ? -2147483648 - bits : bits;
}

function floatsAgree(nativeHex: string, targetHex: string, comparator: GodotEvidenceComparator): boolean {
  const native = bitsFloat(nativeHex);
  const target = bitsFloat(targetHex);
  if (Number.isNaN(native) || Number.isNaN(target)) {
    return Number.isNaN(native) && Number.isNaN(target);
  }
  if (comparator === 'exact') return nativeHex === targetHex;
  if (Math.fround(native) !== native || Math.fround(target) !== target) return false;
  return Math.abs(float32OrderedBits(native) - float32OrderedBits(target)) <= 1;
}

function valuesAgree(native: Encoded, target: Encoded, comparator: GodotEvidenceComparator): boolean {
  if (native.t === 'unsupported' || target.t === 'unsupported' || native.t !== target.t) return false;
  switch (native.t) {
    case 'bool':
    case 'int':
      return native.v === (target as typeof native).v;
    case 'float':
      return floatsAgree(native.v, (target as typeof native).v, comparator);
    case 'Vector3': {
      const other = target as typeof native;
      return (
        floatsAgree(native.x, other.x, comparator) &&
        floatsAgree(native.y, other.y, comparator) &&
        floatsAgree(native.z, other.z, comparator)
      );
    }
    default:
      return native satisfies never;
  }
}

function readable(value: Encoded): string {
  switch (value.t) {
    case 'float':
      return `float ${String(bitsFloat(value.v))} [${value.v}]`;
    case 'Vector3':
      return `Vector3(${String(bitsFloat(value.x))}, ${String(bitsFloat(value.y))}, ${String(bitsFloat(value.z))}) [${value.x} ${value.y} ${value.z}]`;
    default:
      return JSON.stringify(value);
  }
}

/** Every export of a compat module with its `@godot` member and `@source` citation. */
function compatExports(moduleSource: string): CompatExport[] {
  const found: CompatExport[] = [];
  const pattern = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export\s+(?:function|const)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of moduleSource.matchAll(pattern)) {
    const doc = match[1] as string;
    const exportName = match[2] as string;
    const godot = /@godot\s+(\S+)/.exec(doc)?.[1];
    const source = /@source\s+(\S+):(\d+)/.exec(doc);
    if (godot === undefined || source === null) {
      throw new Error(`compat export ${exportName} lacks @godot or @source`);
    }
    found.push({
      exportName,
      godotMember: godot,
      sourceFile: source[1] as string,
      sourceLine: Number(source[2]),
    });
  }
  const exported = [...moduleSource.matchAll(/^export\s+(?:function|const)\s+([A-Za-z_$][\w$]*)/gm)];
  if (exported.length !== found.length) {
    throw new Error('every compat export needs a doc comment carrying @godot and @source');
  }
  return found;
}

function apiMethodHash(apiDumpFile: string, owner: string, member: string): number {
  const api = JSON.parse(readFileSync(apiDumpFile, 'utf8')) as {
    builtin_classes: { name: string; methods?: { name: string; hash: number }[] }[];
  };
  const hash = api.builtin_classes
    .find((entry) => entry.name === owner)
    ?.methods?.find((entry) => entry.name === member)?.hash;
  if (hash === undefined) throw new Error(`API dump has no builtin method ${owner}.${member}`);
  return hash;
}

function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2').toLowerCase();
}

export async function runEvidence(classArgument: string, officialBinary: string): Promise<number> {
  const className = kebab(classArgument);
  const caseFile = path.join(CASES_DIR, `${className}.cases.ts`);
  const loaded = (await import(pathToFileURL(caseFile).href)) as { default?: GodotEvidenceCaseFile };
  const evidence = loaded.default;
  if (evidence === undefined) throw new Error(`${caseFile} has no default GodotEvidenceCaseFile`);

  const source = godotSourceAuthority(4);
  const apiDumpFile = path.join(PACKAGE_ROOT, 'vendor/extension-api', source.apiDumpFile);
  if (sha256(readFileSync(apiDumpFile)) !== source.apiDumpSha256) {
    throw new Error(`${source.apiDumpFile} does not match the pinned API dump`);
  }
  const executableSha256 = sha256(readFileSync(officialBinary));
  if (executableSha256 !== GODOT_4_7_OFFICIAL_EXECUTABLE_SHA256) {
    throw new Error(
      `refusing ${officialBinary}: sha256 ${executableSha256} is not the official Godot 4.7-stable executable`,
    );
  }

  const moduleFile = compatModuleFile(evidence.compatModule);
  const moduleBytes = readFileSync(moduleFile);
  const moduleSource = moduleBytes.toString('utf8');
  if (!new RegExp(`@godot-class\\s+${evidence.godotClass}\\b`).test(moduleSource)) {
    throw new Error(`${evidence.compatModule} does not declare @godot-class ${evidence.godotClass}`);
  }
  const exports = compatExports(moduleSource);
  const exportByMember = new Map(exports.map((entry) => [entry.godotMember, entry]));
  const covered = new Set<string>();
  for (const entry of evidence.cases) {
    const godotMember = `${entry.symbol.owner}.${entry.symbol.member}`;
    if (!exportByMember.has(godotMember)) {
      throw new Error(`${entry.id}: no compat export carries @godot ${godotMember}`);
    }
    covered.add(godotMember);
  }
  const uncovered = exports.filter((entry) => !covered.has(entry.godotMember));
  if (uncovered.length > 0) {
    throw new Error(`exports without evidence cases: ${uncovered.map((entry) => entry.exportName).join(', ')}`);
  }
  if (new Set(evidence.cases.map((entry) => entry.id)).size !== evidence.cases.length) {
    throw new Error('evidence case ids are not unique');
  }

  const buildIdentity = officialBuildIdentity(officialBinary);
  const nativeRows = runNative(officialBinary, evidence.cases);
  const targetRows = runTarget(evidence.cases);

  const mismatches: string[] = [];
  evidence.cases.forEach((entry, index) => {
    const native = nativeRows[index];
    const target = targetRows[index];
    if (native === undefined || target === undefined || native[0] !== entry.id) {
      mismatches.push(`${entry.id}: native row order differs`);
      return;
    }
    if (!valuesAgree(native[1], target[1], entry.comparator)) {
      mismatches.push(
        `${entry.id} (${entry.comparator})\n    gdscript: ${entry.gdscript}\n    native:   ${readable(native[1])}\n    target:   ${readable(target[1])}`,
      );
    }
  });
  const bySymbol = new Map<string, number[]>();
  evidence.cases.forEach((entry, index) => {
    const key = `${entry.symbol.kind}\0${entry.symbol.owner}\0${entry.symbol.member}`;
    bySymbol.set(key, [...(bySymbol.get(key) ?? []), index]);
  });
  process.stdout.write(
    `gd-analyze evidence ${evidence.godotClass}: ${String(evidence.cases.length)} cases over ${String(bySymbol.size)} symbols, ${buildIdentity}\n`,
  );
  if (mismatches.length > 0) {
    process.stdout.write(
      `${String(mismatches.length)} of ${String(evidence.cases.length)} cases disagree; nothing written.\n  ${mismatches.join('\n  ')}\n`,
    );
    return 1;
  }

  const implementationSha256 = sha256(moduleBytes);
  const reproductionCommand = [
    'npx',
    'tsx',
    'packages/gd-analyze/src/cli.ts',
    'evidence',
    classArgument,
    '--official-binary',
    officialBinary,
  ];
  const bindings: GodotBindingEntry[] = [];
  const claims: SemanticClaimRecord[] = [];
  const liveness: GodotCodeClaimLiveness[] = [];
  const unbound: string[] = [];
  for (const indexes of bySymbol.values()) {
    const first = evidence.cases[indexes[0] as number] as GodotEvidenceCase;
    const { kind, owner, member } = first.symbol;
    const compat = exportByMember.get(`${owner}.${member}`) as CompatExport;
    if (kind !== 'builtin-member' && kind !== 'builtin-constructor') {
      unbound.push(`${owner}.${member}`);
      continue;
    }
    const symbol: GodotOfficialSymbolIdentity = {
      sourceRevision: source.revision,
      kind,
      owner,
      member,
      signature:
        kind === 'builtin-member' ? `hash:${String(apiMethodHash(apiDumpFile, owner, member))}` : 'unhashed',
    };
    const claimId = `godot-4.7-binding-${owner}.${member}`;
    const symbolCases = indexes.map((index) => evidence.cases[index] as GodotEvidenceCase);
    const comparators = [...new Set(symbolCases.map((entry) => entry.comparator))].sort();
    const inputSha256 = sha256(
      JSON.stringify(
        symbolCases.map((entry) => ({
          id: entry.id,
          symbol: entry.symbol,
          gdscript: entry.gdscript,
          comparator: entry.comparator,
        })),
      ),
    );
    const nativeOutputSha256 = sha256(JSON.stringify(indexes.map((index) => nativeRows[index])));
    const targetOutputSha256 = sha256(JSON.stringify(indexes.map((index) => targetRows[index])));
    bindings.push({
      source: symbol,
      target: {
        kind: 'compat-binding',
        capabilityId: 'godot-compat',
        module: evidence.compatModule,
        exportName: compat.exportName,
        localName: `${owner}_${compat.exportName}`,
        use:
          kind === 'builtin-member'
            ? { kind: 'call', sourceReceiver: 'first-argument' }
            : { kind: 'call', sourceReceiver: 'absent' },
        evidenceClaimId: claimId,
      },
    });
    claims.push({
      registryVersion: 1,
      claimId,
      layer: 'binding',
      canonicalIdentity: godotOfficialSymbolKey(symbol),
      godot: {
        sourceRevision: source.revision,
        apiDumpSha256: source.apiDumpSha256,
        sourceFile: compat.sourceFile,
        sourceSymbol: `${owner}.${member}`,
        sourceLine: compat.sourceLine,
      },
      native: {
        executableSha256,
        buildIdentity,
        inputSha256,
        callsite: `res://probe.gd _init() ${symbolCases.map((entry) => entry.id).join(' ')}`,
        observedOutputSha256: nativeOutputSha256,
      },
      target: {
        implementationSha256,
        callsite: `${evidence.compatModule}.ts ${compat.exportName}`,
        observedOutputSha256: targetOutputSha256,
      },
      comparison: {
        comparator: `typed float64-bit JSON: ${comparators.join(', ')}`,
        tolerance: comparators.includes('float32-ulp') ? '1 float32 ulp' : 'exact',
        resultSha256: sha256(
          JSON.stringify({ native: nativeOutputSha256, target: targetOutputSha256, comparators, equal: true }),
        ),
      },
      reproductionCommand,
    });
    liveness.push({
      claimId,
      sourceRevision: source.revision,
      apiDumpSha256: source.apiDumpSha256,
      executableSha256,
      inputSha256,
      implementationSha256,
    });
  }
  const output: GodotEvidenceFile = { bindings, claims, liveness };
  const outputFile = path.join(GODOT_4_7_EVIDENCE_DIR, `${className}.json`);
  writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(
    `all ${String(evidence.cases.length)} cases agree; wrote ${String(bindings.length)} bindings and claims to ${path.relative(MONOREPO_ROOT, outputFile)}\n` +
      (unbound.length > 0
        ? `agreed but not bound (no lowering binding path): ${unbound.join(', ')}\n`
        : ''),
  );
  return 0;
}
