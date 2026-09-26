/**
 * `gd-analyze evidence <name>`: run one case file in the official Godot 4.7 binary and in Node,
 * compare them, and on full agreement write what the cases prove to
 * `src/translate/code/authority/godot-4.7/<name>.json`:
 *
 * - a compat case file (`vector3.cases.ts`) proves its compat module's exports, and yields their
 *   binding rows and the TS datatype rule for the class's own value type;
 * - a language case file (`language.cases.ts`) proves the code rules it proposes, by running its
 *   GDScript natively and the same GDScript lowered by production code lowering in Node.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { godotAnalysisAuthority } from '../analyze/authority-data';
import { bindGodotProject } from '../analyze/bound-project';
import {
  enterEvidenceMeasurement,
  packageImplementationDigest,
} from '../godot-frontend/implementation-liveness';
import { captureGodotBoundProgram } from '../godot-frontend/run-bound-program';
import type { SemanticClaimRecord } from '../godot-frontend/semantic-claims';
import { type GodotSourceAuthority, godotSourceAuthority } from '../godot-frontend/source-authority';
import { godotReadAuthority } from '../read/authority-data';
import { readGodotProjectSnapshot } from '../read/godot-project';
import { bindGodotResources } from '../read/resource-program';
import { captureGodotProjectSnapshot } from '../snapshot/project-snapshot';
import { captureGodotApiDumpSnapshot } from '../snapshot/toolchain-snapshot';
import type { GodotCodeClaimLiveness, GodotCodeTranslationAuthority } from '../translate/code/authority';
import {
  COMPAT_SOURCE_ROOT,
  compatModuleFile,
  GODOT_4_7_EVIDENCE_DIR,
  type GodotEvidenceFile,
  type GodotEvidenceImplementation,
  godotEvidenceImplementationDigest,
} from '../translate/code/authority/godot-4.7-evidence';
import {
  GODOT_CODE_IMPLEMENTATION_FILES,
  godotCodeTranslationAuthority,
} from '../translate/code/authority-data';
import {
  type GodotBindingEntry,
  type GodotOfficialSymbolIdentity,
  type GodotTargetBindingUse,
  godotOfficialSymbolKey,
} from '../translate/code/bindings';
import { lowerOfficialBoundProgram } from '../translate/code/lower-official-bound';
import {
  type GodotCodeRuleEntry,
  type GodotDatatypeRuleEntry,
  godotCodeRuleKey,
  godotDatatypeRuleKey,
} from '../translate/code/lowering-rules';
import { printTargetTsSourceFile } from '../translate/emit/target-ts-printer';
import type {
  GodotEvidenceCase,
  GodotEvidenceCaseFile,
  GodotEvidenceComparator,
  GodotEvidenceSymbol,
  GodotLanguageEvidenceFile,
} from './case';

/** The official Godot 4.7-stable macOS executable this lane's native evidence is taken from. */
export const GODOT_4_7_OFFICIAL_EXECUTABLE_SHA256 =
  '445c6f95030e2ca767dd921be1e91bd99e50c3703f91d22a22cd31216c93a80f' as const;

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const CASES_DIR = path.join(PACKAGE_ROOT, 'evidence/godot-4.7');
const OUTPUT_MARKER = 'GD_ANALYZE_EVIDENCE ';

/**
 * A typed value as JSON. Floats are their float64 bytes, ints their decimal text; a structured
 * built-in names its fields as Godot names its properties, each field itself encoded (a float or
 * int field as its bytes or text).
 */
type Encoded =
  | { readonly t: 'Nil' }
  | { readonly t: 'bool'; readonly v: boolean }
  | { readonly t: 'int'; readonly v: string }
  | { readonly t: 'float'; readonly v: string }
  | { readonly t: 'String' | 'StringName'; readonly v: string }
  | { readonly t: 'Vector3'; readonly x: string; readonly y: string; readonly z: string }
  | { readonly t: 'Array' | 'PackedStringArray'; readonly v: readonly Encoded[] }
  | { readonly t: 'Dictionary'; readonly v: readonly (readonly [Encoded, Encoded])[] }
  | StructuredEncoded
  | { readonly t: 'unsupported'; readonly type: string };

/**
 * Structured built-ins other than Vector3 (kept in its original flat form), with each property's
 * encoded type. Godot's property names are the compat record's field names.
 */
const STRUCTURED = {
  Vector2: { x: 'float', y: 'float' },
  Vector2i: { x: 'int', y: 'int' },
  Vector3i: { x: 'int', y: 'int', z: 'int' },
  Rect2: { position: 'Vector2', size: 'Vector2' },
  Transform2D: { x: 'Vector2', y: 'Vector2', origin: 'Vector2' },
  Plane: { normal: 'Vector3', d: 'float' },
  Basis: { x: 'Vector3', y: 'Vector3', z: 'Vector3' },
  Transform3D: { basis: 'Basis', origin: 'Vector3' },
  Color: { r: 'float', g: 'float', b: 'float', a: 'float' },
} as const;
type StructuredType = keyof typeof STRUCTURED;
interface StructuredEncoded {
  readonly t: StructuredType;
  readonly [field: string]: Encoded | string;
}

type Row = readonly [id: string, value: Encoded];

interface CompatExport {
  readonly exportName: string;
  readonly godotMember: string;
  readonly sourceFile: string;
  readonly sourceLine: number;
}

interface Comparable {
  readonly id: string;
  readonly comparator: GodotEvidenceComparator;
  readonly shown: string;
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

function isStructured(type: string): type is StructuredType {
  return Object.hasOwn(STRUCTURED, type);
}

function unsupported(value: unknown): Encoded {
  return { t: 'unsupported', type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value };
}

/**
 * Encode a target value as the Godot type the native side returned. The native row supplies only
 * the type the value must have; the value must be exactly that type's compat representation (an
 * int a safe integer, a record exactly its fields), or it encodes as unsupported and disagrees.
 */
function encodeAs(type: string, value: unknown): Encoded {
  switch (type) {
    case 'Nil':
      return value === null ? { t: 'Nil' } : unsupported(value);
    case 'bool':
    case 'float':
    case 'Vector3':
      return encodeTarget(value);
    case 'int':
      return typeof value === 'number' && Number.isSafeInteger(value)
        ? { t: 'int', v: String(value) }
        : unsupported(value);
    case 'String':
    case 'StringName':
      return typeof value === 'string' ? { t: type, v: value } : unsupported(value);
    case 'PackedStringArray':
      return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
        ? { t: type, v: value.map((entry: string): Encoded => ({ t: 'String', v: entry })) }
        : unsupported(value);
    default: {
      if (!isStructured(type) || typeof value !== 'object' || value === null || Array.isArray(value)) {
        return unsupported(value);
      }
      const fields: Readonly<Record<string, string>> = STRUCTURED[type];
      const record = value as Readonly<Record<string, unknown>>;
      if (Object.keys(record).sort().join(',') !== Object.keys(fields).sort().join(',')) {
        return unsupported(value);
      }
      const encoded: Record<string, Encoded | string> = { t: type };
      for (const [field, fieldType] of Object.entries(fields)) {
        const inner = encodeAs(fieldType, record[field]);
        if (inner.t === 'unsupported') return unsupported(value);
        encoded[field] = inner.t === 'float' || inner.t === 'int' ? inner.v : inner;
      }
      return encoded as unknown as StructuredEncoded;
    }
  }
}

/** Encode a target value by the native value's type, recursively through Arrays and Dictionaries. */
function encodeLike(native: Encoded, value: unknown): Encoded {
  if (native.t === 'Array') {
    if (!Array.isArray(value) || value.length !== native.v.length) return unsupported(value);
    return { t: 'Array', v: native.v.map((entry, index) => encodeLike(entry, value[index])) };
  }
  if (native.t === 'Dictionary') {
    if (!(value instanceof Map) || value.size !== native.v.length) return unsupported(value);
    const entries = [...(value as Map<unknown, unknown>).entries()];
    return {
      t: 'Dictionary',
      v: native.v.map(([key, item], index) => {
        const entry = entries[index] as [unknown, unknown];
        return [encodeLike(key, entry[0]), encodeLike(item, entry[1])] as const;
      }),
    };
  }
  return encodeAs(native.t, value);
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

const PROBE_ENCODER = `func _bits(value: float) -> String:
\treturn PackedFloat64Array([value]).to_byte_array().hex_encode()

func _enc(value: Variant) -> Dictionary:
\tmatch typeof(value):
\t\tTYPE_BOOL:
\t\t\treturn {"t": "bool", "v": value}
\t\tTYPE_INT:
\t\t\treturn {"t": "int", "v": str(value)}
\t\tTYPE_FLOAT:
\t\t\treturn {"t": "float", "v": _bits(value)}
\t\tTYPE_NIL:
\t\t\treturn {"t": "Nil"}
\t\tTYPE_STRING:
\t\t\treturn {"t": "String", "v": value}
\t\tTYPE_STRING_NAME:
\t\t\treturn {"t": "StringName", "v": String(value)}
\t\tTYPE_VECTOR2:
\t\t\treturn {"t": "Vector2", "x": _bits(value.x), "y": _bits(value.y)}
\t\tTYPE_VECTOR2I:
\t\t\treturn {"t": "Vector2i", "x": str(value.x), "y": str(value.y)}
\t\tTYPE_VECTOR3:
\t\t\treturn {"t": "Vector3", "x": _bits(value.x), "y": _bits(value.y), "z": _bits(value.z)}
\t\tTYPE_VECTOR3I:
\t\t\treturn {"t": "Vector3i", "x": str(value.x), "y": str(value.y), "z": str(value.z)}
\t\tTYPE_RECT2:
\t\t\treturn {"t": "Rect2", "position": _enc(value.position), "size": _enc(value.size)}
\t\tTYPE_TRANSFORM2D:
\t\t\treturn {"t": "Transform2D", "x": _enc(value.x), "y": _enc(value.y), "origin": _enc(value.origin)}
\t\tTYPE_PLANE:
\t\t\treturn {"t": "Plane", "normal": _enc(value.normal), "d": _bits(value.d)}
\t\tTYPE_BASIS:
\t\t\treturn {"t": "Basis", "x": _enc(value.x), "y": _enc(value.y), "z": _enc(value.z)}
\t\tTYPE_TRANSFORM3D:
\t\t\treturn {"t": "Transform3D", "basis": _enc(value.basis), "origin": _enc(value.origin)}
\t\tTYPE_COLOR:
\t\t\treturn {"t": "Color", "r": _bits(value.r), "g": _bits(value.g), "b": _bits(value.b), "a": _bits(value.a)}
\t\tTYPE_ARRAY:
\t\t\tvar items: Array = []
\t\t\tfor item in value:
\t\t\t\titems.append(_enc(item))
\t\t\treturn {"t": "Array", "v": items}
\t\tTYPE_DICTIONARY:
\t\t\tvar pairs: Array = []
\t\t\tfor key in value:
\t\t\t\tpairs.append([_enc(key), _enc(value[key])])
\t\t\treturn {"t": "Dictionary", "v": pairs}
\t\tTYPE_PACKED_STRING_ARRAY:
\t\t\tvar strings: Array = []
\t\t\tfor item in value:
\t\t\t\tstrings.append({"t": "String", "v": item})
\t\t\treturn {"t": "PackedStringArray", "v": strings}
\treturn {"t": "unsupported", "type": type_string(typeof(value))}
`;

/**
 * Each case is its own function. The GDScript compiler pools a function's constants in a
 * `HashMap<Variant, int>` (`modules/gdscript/gdscript_byte_codegen.h:107`) whose key equality
 * merges `-0.0` into an earlier `0.0`; one folded constant per function keeps each value intact.
 * A one-line case is returned; a several-line case is a function body that returns.
 */
function compatProbeSource(cases: readonly GodotEvidenceCase[]): string {
  const functions = cases.map((entry, index) => {
    const lines = entry.gdscript.split('\n');
    const body = lines.length === 1 ? [`return ${entry.gdscript}`] : lines;
    return `\nfunc _case_${String(index)}() -> Variant:\n${body.map((line) => `\t${line}`).join('\n')}\n`;
  });
  const rows = cases.map(
    (entry, index) =>
      `\trows.append([${JSON.stringify(entry.id)}, _enc(_case_${String(index)}())])\n`,
  );
  return `extends SceneTree\n\n${PROBE_ENCODER}${functions.join('')}\nfunc _init() -> void:\n\tvar rows: Array = []\n${rows.join('')}\tprint(${JSON.stringify(OUTPUT_MARKER)} + JSON.stringify(rows))\n\tquit()\n`;
}

function languageProbeSource(evidence: GodotLanguageEvidenceFile, resPath: string): string {
  const rows = evidence.cases.map(
    (entry) =>
      `\trows.append([${JSON.stringify(entry.id)}, _enc(cases.${entry.call}(${entry.arguments?.gdscript ?? ''}))])\n`,
  );
  return `extends SceneTree\n\n${PROBE_ENCODER}\nfunc _init() -> void:\n\tvar cases = load(${JSON.stringify(resPath)})\n\tvar rows: Array = []\n${rows.join('')}\tprint(${JSON.stringify(OUTPUT_MARKER)} + JSON.stringify(rows))\n\tquit()\n`;
}

const PROJECT_SOURCE = `config_version=5

[application]
config/name="gd-analyze evidence"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"
`;
const MAIN_SCENE = `[gd_scene format=3]\n\n[node name="Main" type="Node"]\n`;

function officialBuildIdentity(officialBinary: string): string {
  const result = spawnSync(officialBinary, ['--headless', '--version'], { encoding: 'utf8' });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`official Godot --version failed: ${result.error?.message ?? result.stderr}`);
  }
  return `Godot ${result.stdout.trim()}`;
}

function runNativeProbe(
  officialBinary: string,
  project: string,
  probe: string,
  expected: number,
): Row[] {
  writeFileSync(path.join(project, 'probe.gd'), probe);
  const result = spawnSync(
    officialBinary,
    ['--headless', '--path', project, '--script', 'res://probe.gd'],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  rmSync(path.join(project, 'probe.gd'));
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
  if (rows.length !== expected) {
    throw new Error(`official Godot probe returned ${String(rows.length)} of ${String(expected)} cases`);
  }
  return rows;
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
    case 'Nil':
      return true;
    case 'bool':
    case 'int':
    case 'String':
    case 'StringName':
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
    case 'Array':
    case 'PackedStringArray': {
      const other = target as typeof native;
      return (
        native.v.length === other.v.length &&
        native.v.every((entry, index) => valuesAgree(entry, other.v[index] as Encoded, comparator))
      );
    }
    case 'Dictionary': {
      const other = target as typeof native;
      return (
        native.v.length === other.v.length &&
        native.v.every(([key, item], index) => {
          const pair = other.v[index] as readonly [Encoded, Encoded];
          return valuesAgree(key, pair[0], comparator) && valuesAgree(item, pair[1], comparator);
        })
      );
    }
    default: {
      const fields: Readonly<Record<string, string>> = STRUCTURED[native.t];
      const left = native as StructuredEncoded;
      const right = target as StructuredEncoded;
      return Object.entries(fields).every(([field, fieldType]) => {
        const a = left[field];
        const b = right[field];
        if (fieldType === 'float') return floatsAgree(a as string, b as string, comparator);
        if (fieldType === 'int') return a === b;
        return valuesAgree(a as Encoded, b as Encoded, comparator);
      });
    }
  }
}

function readable(value: Encoded): string {
  switch (value.t) {
    case 'float':
      return `float ${String(bitsFloat(value.v))} [${value.v}]`;
    case 'Vector3':
      return `Vector3(${String(bitsFloat(value.x))}, ${String(bitsFloat(value.y))}, ${String(bitsFloat(value.z))}) [${value.x} ${value.y} ${value.z}]`;
    case 'Array':
    case 'PackedStringArray':
      return `${value.t}[${value.v.map(readable).join(', ')}]`;
    case 'Dictionary':
      return `{${value.v.map(([key, item]) => `${readable(key)}: ${readable(item)}`).join(', ')}}`;
    default: {
      if (!isStructured(value.t)) return JSON.stringify(value);
      const record = value as StructuredEncoded;
      const fields: Readonly<Record<string, string>> = STRUCTURED[value.t];
      return `${value.t}(${Object.entries(fields)
        .map(([field, fieldType]) => {
          const inner = record[field];
          if (fieldType === 'float') return `${field}=${String(bitsFloat(inner as string))}`;
          if (fieldType === 'int') return `${field}=${String(inner)}`;
          return `${field}=${readable(inner as Encoded)}`;
        })
        .join(', ')})`;
    }
  }
}

function mismatches(
  cases: readonly Comparable[],
  nativeRows: readonly Row[],
  targetRows: readonly Row[],
): string[] {
  const found: string[] = [];
  cases.forEach((entry, index) => {
    const native = nativeRows[index];
    const target = targetRows[index];
    if (native === undefined || target === undefined || native[0] !== entry.id) {
      found.push(`${entry.id}: native row order differs`);
      return;
    }
    if (!valuesAgree(native[1], target[1], entry.comparator)) {
      found.push(
        `${entry.id} (${entry.comparator})\n    ${entry.shown}\n    native:   ${readable(native[1])}\n    target:   ${readable(target[1])}`,
      );
    }
  });
  return found;
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

function apiUtilityHash(apiDumpFile: string, member: string): number {
  const api = JSON.parse(readFileSync(apiDumpFile, 'utf8')) as {
    utility_functions: { name: string; hash: number }[];
  };
  const hash = api.utility_functions.find((entry) => entry.name === member)?.hash;
  if (hash === undefined) throw new Error(`API dump has no utility function ${member}`);
  return hash;
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
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

interface Pins {
  readonly source: GodotSourceAuthority;
  readonly apiDumpFile: string;
  readonly executableSha256: string;
  readonly buildIdentity: string;
  readonly reproductionCommand: readonly string[];
}

function pins(name: string, officialBinary: string, exporterBinary?: string): Pins {
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
  return {
    source,
    apiDumpFile,
    executableSha256,
    buildIdentity: officialBuildIdentity(officialBinary),
    reproductionCommand: [
      'npx',
      'tsx',
      'packages/gd-analyze/src/cli.ts',
      'evidence',
      name,
      '--official-binary',
      officialBinary,
      ...(exporterBinary === undefined ? [] : ['--bound-exporter-binary', exporterBinary]),
    ],
  };
}

function claimRecord(
  pins: Pins,
  claimId: string,
  layer: SemanticClaimRecord['layer'],
  canonicalIdentity: string,
  godot: { readonly file: string; readonly symbol: string; readonly line: number },
  native: { readonly inputSha256: string; readonly callsite: string; readonly observed: string },
  target: { readonly implementationSha256: string; readonly callsite: string; readonly observed: string },
  comparators: readonly string[],
): { readonly claim: SemanticClaimRecord; readonly liveness: GodotCodeClaimLiveness } {
  return {
    claim: {
      registryVersion: 1,
      claimId,
      layer,
      canonicalIdentity,
      godot: {
        sourceRevision: pins.source.revision,
        apiDumpSha256: pins.source.apiDumpSha256,
        sourceFile: godot.file,
        sourceSymbol: godot.symbol,
        sourceLine: godot.line,
      },
      native: {
        executableSha256: pins.executableSha256,
        buildIdentity: pins.buildIdentity,
        inputSha256: native.inputSha256,
        callsite: native.callsite,
        observedOutputSha256: native.observed,
      },
      target: {
        implementationSha256: target.implementationSha256,
        callsite: target.callsite,
        observedOutputSha256: target.observed,
      },
      comparison: {
        comparator: `typed float64-bit JSON: ${comparators.join(', ')}`,
        tolerance: comparators.includes('float32-ulp') ? '1 float32 ulp' : 'exact',
        resultSha256: sha256(
          JSON.stringify({ native: native.observed, target: target.observed, comparators, equal: true }),
        ),
      },
      reproductionCommand: pins.reproductionCommand,
    },
    liveness: {
      claimId,
      sourceRevision: pins.source.revision,
      apiDumpSha256: pins.source.apiDumpSha256,
      executableSha256: pins.executableSha256,
      inputSha256: native.inputSha256,
      implementationSha256: target.implementationSha256,
    },
  };
}

function writeEvidenceFile(name: string, file: GodotEvidenceFile): string {
  const outputFile = path.join(GODOT_4_7_EVIDENCE_DIR, `${name}.json`);
  writeFileSync(outputFile, `${JSON.stringify(file, null, 2)}\n`);
  return path.relative(MONOREPO_ROOT, outputFile);
}

function loweringDigest(): string {
  return packageImplementationDigest(GODOT_CODE_IMPLEMENTATION_FILES);
}

/** The binding identity a compat case symbol is selected by, exactly as lowering spells it. */
function bindingSymbol(
  pins: Pins,
  symbol: GodotEvidenceSymbol,
): GodotOfficialSymbolIdentity {
  const base = { sourceRevision: pins.source.revision, owner: symbol.owner, member: symbol.member };
  switch (symbol.kind) {
    case 'builtin-member':
      return {
        ...base,
        kind: 'builtin-member',
        signature: `hash:${String(apiMethodHash(pins.apiDumpFile, symbol.owner, symbol.member))}`,
      };
    case 'builtin-constructor':
      return { ...base, kind: 'builtin-constructor', signature: 'unhashed' };
    case 'builtin-operator':
      return {
        ...base,
        kind: 'builtin-operator',
        signature: symbol.right === undefined ? 'unary' : `right:${symbol.right}`,
      };
    case 'builtin-constant':
      return { ...base, kind: 'builtin-constant', signature: 'constant' };
    case 'builtin-member-set':
      return { ...base, kind: 'builtin-member-set', signature: 'set' };
    case 'utility-function':
      return {
        ...base,
        kind: 'global',
        signature: `hash:${String(apiUtilityHash(pins.apiDumpFile, symbol.member))}`,
      };
    default:
      return symbol.kind satisfies never;
  }
}

function bindingUse(kind: GodotEvidenceSymbol['kind']): GodotTargetBindingUse {
  switch (kind) {
    case 'builtin-member':
    case 'builtin-member-set':
      return { kind: 'call', sourceReceiver: 'first-argument' };
    case 'builtin-constructor':
    case 'builtin-operator':
    case 'utility-function':
      return { kind: 'call', sourceReceiver: 'absent' };
    case 'builtin-constant':
      return { kind: 'value' };
    default:
      return kind satisfies never;
  }
}

async function runCompatEvidence(
  name: string,
  evidence: GodotEvidenceCaseFile,
  officialBinary: string,
): Promise<number> {
  const pinned = pins(name, officialBinary);
  const moduleBytes = readFileSync(compatModuleFile(evidence.compatModule));
  const moduleSource = moduleBytes.toString('utf8');
  if (!new RegExp(`@godot-class\\s+${evidence.godotClass}\\b`).test(moduleSource)) {
    throw new Error(`${evidence.compatModule} does not declare @godot-class ${evidence.godotClass}`);
  }
  if (
    evidence.typeExport !== undefined &&
    !new RegExp(`^export (?:interface|type) ${evidence.typeExport}\\b`, 'm').test(moduleSource)
  ) {
    throw new Error(`${evidence.compatModule} does not export the type ${evidence.typeExport}`);
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

  const temp = mkdtempSync(path.join(tmpdir(), 'gd-analyze-evidence-'));
  let nativeRows: Row[];
  try {
    writeFileSync(path.join(temp, 'project.godot'), PROJECT_SOURCE);
    writeFileSync(path.join(temp, 'main.tscn'), MAIN_SCENE);
    nativeRows = runNativeProbe(
      officialBinary,
      temp,
      compatProbeSource(evidence.cases),
      evidence.cases.length,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  const targetRows: Row[] = evidence.cases.map((entry, index) => {
    const native = nativeRows[index];
    const value = entry.target();
    return [entry.id, native === undefined ? encodeTarget(value) : encodeLike(native[1], value)];
  });
  const disagreements = mismatches(
    evidence.cases.map((entry) => ({
      id: entry.id,
      comparator: entry.comparator,
      shown: `gdscript: ${entry.gdscript.split('\n').join(' ; ')}`,
    })),
    nativeRows,
    targetRows,
  );
  const bySymbol = new Map<string, number[]>();
  evidence.cases.forEach((entry, index) => {
    const key = godotOfficialSymbolKey(bindingSymbol(pinned, entry.symbol));
    bySymbol.set(key, [...(bySymbol.get(key) ?? []), index]);
  });
  process.stdout.write(
    `gd-analyze evidence ${evidence.godotClass}: ${String(evidence.cases.length)} cases over ${String(bySymbol.size)} bound symbols, ${pinned.buildIdentity}\n`,
  );
  if (disagreements.length > 0) {
    process.stdout.write(
      `${String(disagreements.length)} of ${String(evidence.cases.length)} cases disagree; nothing written.\n  ${disagreements.join('\n  ')}\n`,
    );
    return 1;
  }

  const implementation: GodotEvidenceImplementation = {
    kind: 'compat-module',
    module: evidence.compatModule,
  };
  const implementationSha256 = godotEvidenceImplementationDigest(implementation, loweringDigest());
  const caseInput = (entry: GodotEvidenceCase) => ({
    id: entry.id,
    symbol: entry.symbol,
    gdscript: entry.gdscript,
    comparator: entry.comparator,
  });
  const bindings: GodotBindingEntry[] = [];
  const claims: SemanticClaimRecord[] = [];
  const liveness: GodotCodeClaimLiveness[] = [];
  for (const indexes of bySymbol.values()) {
    const symbolCases = indexes.map((index) => evidence.cases[index] as GodotEvidenceCase);
    const first = symbolCases[0] as GodotEvidenceCase;
    const symbol = bindingSymbol(pinned, first.symbol);
    const compat = exportByMember.get(`${first.symbol.owner}.${first.symbol.member}`) as CompatExport;
    const claimId = `godot-4.7-binding-${symbol.owner}.${symbol.member}${
      first.symbol.kind === 'builtin-operator' ? `.${symbol.signature}` : ''
    }${first.symbol.kind === 'builtin-member-set' ? '.set' : ''}`;
    bindings.push({
      source: symbol,
      target: {
        kind: 'compat-binding',
        capabilityId: 'godot-compat',
        module: evidence.compatModule,
        exportName: compat.exportName,
        localName: `${symbol.owner}_${compat.exportName}`,
        use: bindingUse(first.symbol.kind),
        evidenceClaimId: claimId,
      },
    });
    const record = claimRecord(
      pinned,
      claimId,
      'binding',
      godotOfficialSymbolKey(symbol),
      { file: compat.sourceFile, symbol: `${symbol.owner}.${symbol.member}`, line: compat.sourceLine },
      {
        inputSha256: sha256(JSON.stringify(symbolCases.map(caseInput))),
        callsite: `res://probe.gd _init() ${symbolCases.map((entry) => entry.id).join(' ')}`,
        observed: sha256(JSON.stringify(indexes.map((index) => nativeRows[index]))),
      },
      {
        implementationSha256,
        callsite: `${evidence.compatModule}.ts ${compat.exportName}`,
        observed: sha256(JSON.stringify(indexes.map((index) => targetRows[index]))),
      },
      [...new Set(symbolCases.map((entry) => entry.comparator))].sort(),
    );
    claims.push(record.claim);
    liveness.push(record.liveness);
  }
  const datatypes: GodotDatatypeRuleEntry[] = [];
  if (evidence.typeExport !== undefined) {
    if (evidence.typeSource === undefined) throw new Error('typeExport needs its typeSource');
    // Every value the module's exports produced is its type; the rule names that type.
    const claimId = `godot-4.7-datatype-${evidence.godotClass}`;
    const entry: GodotDatatypeRuleEntry = {
      sourceRevision: pinned.source.revision,
      sourceDatatype: `BUILTIN:${evidence.godotClass}`,
      targetType: { kind: 'type-reference', name: evidence.typeExport, arguments: [] },
      typeImport: { module: evidence.compatModule, exportName: evidence.typeExport },
      evidenceClaimId: claimId,
    };
    datatypes.push(entry);
    const record = claimRecord(
      pinned,
      claimId,
      'translate-code',
      godotDatatypeRuleKey(entry),
      evidence.typeSource ?? { file: 'unknown', symbol: evidence.godotClass, line: 0 },
      {
        inputSha256: sha256(JSON.stringify(evidence.cases.map(caseInput))),
        callsite: 'res://probe.gd _init() every case',
        observed: sha256(JSON.stringify(nativeRows)),
      },
      {
        implementationSha256,
        callsite: `${evidence.compatModule}.ts ${evidence.typeExport}`,
        observed: sha256(JSON.stringify(targetRows)),
      },
      [...new Set(evidence.cases.map((entry) => entry.comparator))].sort(),
    );
    claims.push(record.claim);
    liveness.push(record.liveness);
  }
  const written = writeEvidenceFile(name, {
    implementation,
    bindings,
    rules: [],
    datatypes,
    claims,
    liveness,
  });
  process.stdout.write(
    `all ${String(evidence.cases.length)} cases agree; wrote ${String(bindings.length)} bindings, ${String(datatypes.length)} datatype rules and their claims to ${written}\n`,
  );
  return 0;
}

const PROVISIONAL_SHA256 = '0'.repeat(64);

/**
 * The production authority with this language file's proposed rules in place of any it recorded
 * before, each carrying a provisional in-memory claim so lowering can run the proposal. The
 * provisional claims are never written; what is written is measured below.
 */
function proposalAuthority(
  pins: Pins,
  evidence: GodotLanguageEvidenceFile,
  claimIdFor: (ruleId: string) => string,
): { readonly authority: GodotCodeTranslationAuthority; readonly rules: readonly GodotCodeRuleEntry[] } {
  const base = godotCodeTranslationAuthority(pins.source);
  const proposed = new Set(evidence.rules.map((rule) => claimIdFor(rule.id)));
  const rules: GodotCodeRuleEntry[] = evidence.rules.map((rule) => ({
    source: {
      sourceRevision: pins.source.revision,
      nodeKind: rule.nodeKind,
      semanticKey: rule.semanticKey,
      inputDatatypes: rule.inputDatatypes,
      resultDatatype: rule.resultDatatype,
    },
    target: rule.target,
    evidenceClaimId: claimIdFor(rule.id),
  }));
  const provisional = rules.map((rule) =>
    claimRecord(
      pins,
      rule.evidenceClaimId,
      'translate-code',
      godotCodeRuleKey(rule.source),
      { file: 'provisional', symbol: 'provisional', line: 1 },
      { inputSha256: PROVISIONAL_SHA256, callsite: 'provisional', observed: PROVISIONAL_SHA256 },
      { implementationSha256: PROVISIONAL_SHA256, callsite: 'provisional', observed: PROVISIONAL_SHA256 },
      ['exact'],
    ),
  );
  return {
    rules,
    authority: {
      ...base,
      rules: {
        ...base.rules,
        entries: [
          ...base.rules.entries.filter((entry) => !proposed.has(entry.evidenceClaimId)),
          ...rules,
        ],
      },
      claims: [
        ...base.claims.filter((entry) => !proposed.has(entry.claimId)),
        ...provisional.map((entry) => entry.claim),
      ],
      liveness: [
        ...base.liveness.filter((entry) => !proposed.has(entry.claimId)),
        ...provisional.map((entry) => entry.liveness),
      ],
    },
  };
}

async function runLanguageEvidence(
  name: string,
  evidence: GodotLanguageEvidenceFile,
  officialBinary: string,
  exporterBinary: string,
): Promise<number> {
  // This run measures code lowering, whose other claims the same edit may have made stale;
  // like the refresh, it measures with recorded digests (see enterEvidenceMeasurement).
  enterEvidenceMeasurement();
  const pinned = pins(name, officialBinary, exporterBinary);
  const claimIdFor = (ruleId: string) => `godot-4.7-${name}-${ruleId}`;
  if (new Set(evidence.rules.map((rule) => rule.id)).size !== evidence.rules.length) {
    throw new Error('language rule ids are not unique');
  }
  const scriptName = `${kebab(evidence.className).replace(/-/g, '_')}.gd`;
  const resPath = `res://${scriptName}`;
  const temp = mkdtempSync(path.join(tmpdir(), 'gd-analyze-language-evidence-'));
  try {
    const project = path.join(temp, 'project');
    mkdirSync(project);
    writeFileSync(path.join(project, 'project.godot'), PROJECT_SOURCE);
    writeFileSync(path.join(project, 'main.tscn'), MAIN_SCENE);
    writeFileSync(path.join(project, scriptName), evidence.source);

    // Target: production code lowering over the official frontend's bound program.
    const snapshot = captureGodotProjectSnapshot(project);
    const readAuthority = godotReadAuthority(pinned.source);
    const apiDump = captureGodotApiDumpSnapshot(pinned.source);
    const bound = bindGodotProject(
      snapshot,
      captureGodotBoundProgram({ godotBinary: exporterBinary, projectDir: project }),
      bindGodotResources(readGodotProjectSnapshot(snapshot, readAuthority), readAuthority),
      godotAnalysisAuthority(pinned.source),
      pinned.source,
      apiDump,
      readGodotProjectSnapshot(snapshot, readAuthority),
    );
    const proposal = proposalAuthority(pinned, evidence, claimIdFor);
    const lowered = lowerOfficialBoundProgram(bound, proposal.authority, apiDump.parsed);
    if (lowered.kind === 'refused-code') {
      process.stdout.write(
        `production lowering refused the language cases; nothing written.\n  ${lowered.diagnostics
          .map((entry) => `${entry.sourcePath}:${String(entry.startLine)}:${String(entry.startColumn)} ${entry.message}`)
          .join('\n  ')}\n`,
      );
      return 1;
    }
    const used = new Set(lowered.plan.languageEvidenceClaimIds);
    const unexercised = proposal.rules.filter((rule) => !used.has(rule.evidenceClaimId));
    if (unexercised.length > 0) {
      process.stdout.write(
        `proposed rules no case exercises; nothing written: ${unexercised.map((rule) => rule.evidenceClaimId).join(', ')}\n`,
      );
      return 1;
    }
    const sourceFile = lowered.plan.sourceFiles.find(
      (entry) => entry.sourcePath === scriptName.replace(/\.gd$/, '.ts'),
    );
    if (sourceFile === undefined) throw new Error(`lowering emitted no ${scriptName}`);
    const printed = printTargetTsSourceFile(sourceFile);
    const emitted = path.join(temp, 'target');
    mkdirSync(path.join(emitted, 'src', 'scripts'), { recursive: true });
    writeFileSync(path.join(emitted, 'package.json'), '{ "type": "module" }\n');
    symlinkSync(path.join(COMPAT_SOURCE_ROOT, 'lib'), path.join(emitted, 'src', 'lib'));
    const emittedFile = path.join(emitted, 'src', 'scripts', sourceFile.sourcePath);
    writeFileSync(emittedFile, printed);
    const module = (await import(pathToFileURL(emittedFile).href)) as Record<string, unknown>;
    const cases = module[evidence.className] as Record<string, unknown> | undefined;
    if (cases === undefined) throw new Error(`lowered module exports no ${evidence.className}`);
    const targetValues = evidence.cases.map((entry) => {
      const fn = cases[entry.call];
      if (typeof fn !== 'function') throw new Error(`lowered ${evidence.className} has no ${entry.call}`);
      const args = entry.arguments?.target() ?? [];
      return (fn as (...values: unknown[]) => unknown).apply(cases, [...args]);
    });

    // Native: the same GDScript in the official binary.
    const nativeRows = runNativeProbe(
      officialBinary,
      project,
      languageProbeSource(evidence, resPath),
      evidence.cases.length,
    );
    const targetRows: Row[] = evidence.cases.map((entry, index) => {
      const native = nativeRows[index];
      const value = targetValues[index];
      return [entry.id, native === undefined ? encodeTarget(value) : encodeLike(native[1], value)];
    });
    const disagreements = mismatches(
      evidence.cases.map((entry) => ({
        id: entry.id,
        comparator: entry.comparator,
        shown: `${evidence.className}.${entry.call}()`,
      })),
      nativeRows,
      targetRows,
    );
    process.stdout.write(
      `gd-analyze evidence ${name}: ${String(evidence.cases.length)} cases over ${String(evidence.rules.length)} proposed rules, ${pinned.buildIdentity}\n`,
    );
    if (disagreements.length > 0) {
      process.stdout.write(
        `${String(disagreements.length)} of ${String(evidence.cases.length)} cases disagree; nothing written.\n  ${disagreements.join('\n  ')}\n\nlowered:\n${printed}\n`,
      );
      return 1;
    }

    const implementation: GodotEvidenceImplementation = {
      kind: 'code-lowering',
      compatModules: evidence.compatModules,
    };
    const implementationSha256 = godotEvidenceImplementationDigest(implementation, loweringDigest());
    const inputSha256 = sha256(
      JSON.stringify({
        source: evidence.source,
        cases: evidence.cases.map((entry) => ({
          id: entry.id,
          call: entry.call,
          arguments: entry.arguments?.gdscript ?? '',
          comparator: entry.comparator,
        })),
        rules: evidence.rules,
      }),
    );
    const observedNative = sha256(JSON.stringify(nativeRows));
    const observedTarget = sha256(JSON.stringify(targetRows));
    const comparators = [...new Set(evidence.cases.map((entry) => entry.comparator))].sort();
    const claims: SemanticClaimRecord[] = [];
    const liveness: GodotCodeClaimLiveness[] = [];
    for (const [index, rule] of proposal.rules.entries()) {
      const definition = evidence.rules[index] as GodotLanguageEvidenceFile['rules'][number];
      const record = claimRecord(
        pinned,
        rule.evidenceClaimId,
        'translate-code',
        godotCodeRuleKey(rule.source),
        definition.source,
        { inputSha256, callsite: `${resPath} every case`, observed: observedNative },
        {
          implementationSha256,
          callsite: `lowered src/scripts/${sourceFile.sourcePath}`,
          observed: observedTarget,
        },
        comparators,
      );
      claims.push(record.claim);
      liveness.push(record.liveness);
    }
    const written = writeEvidenceFile(name, {
      implementation,
      bindings: [],
      rules: proposal.rules,
      datatypes: [],
      claims,
      liveness,
    });
    process.stdout.write(
      `all ${String(evidence.cases.length)} cases agree; wrote ${String(proposal.rules.length)} rules and their claims to ${written}\n\nlowered:\n${printed}\n`,
    );
    return 0;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** The case files `evidence --refresh` re-runs, in dependency order: compat modules first. */
export function godotEvidenceCaseNames(): readonly string[] {
  return ['vector3', 'vector2', 'vector2i', 'vector3i', 'basis', 'transform-3d', 'transform-2d', 'color', 'plane', 'rect2', 'string', 'array', 'dictionary', 'packed-string-array', 'callable', 'global-scope', 'language'];
}

export async function runEvidence(
  nameArgument: string,
  officialBinary: string,
  exporterBinary: string | undefined,
): Promise<number> {
  const name = kebab(nameArgument);
  const caseFile = path.join(CASES_DIR, `${name}.cases.ts`);
  const loaded = (await import(pathToFileURL(caseFile).href)) as {
    default?: GodotEvidenceCaseFile | GodotLanguageEvidenceFile;
  };
  const evidence = loaded.default;
  if (evidence === undefined) throw new Error(`${caseFile} has no default case file`);
  if (evidence.kind === 'language') {
    if (exporterBinary === undefined) {
      throw new Error('language evidence lowers through the official frontend: pass --bound-exporter-binary');
    }
    return runLanguageEvidence(name, evidence, officialBinary, exporterBinary);
  }
  return runCompatEvidence(name, evidence, officialBinary);
}
