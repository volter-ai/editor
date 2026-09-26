/**
 * `gd-analyze evidence <name>`: run one case file in the official Godot 4.7 binary and in Node,
 * compare them, and on full agreement write what the cases prove to
 * `src/translate/code/authority/godot-4.7/<name>.json`:
 *
 * - a compat case file (`vector3.cases.ts`) proves its compat module's exports, and yields their
 *   binding rows and the TS datatype rule for the class's own value type;
 * - a language case file (`gdscript.cases.ts`) proves the code rules it proposes, by running its
 *   GDScript natively and the same GDScript lowered by production code lowering in Node.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
  | { readonly t: 'Array' | PackedArrayType; readonly v: readonly Encoded[] }
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

/** Packed arrays, encoded element by element like an Array of their element type. */
const PACKED_ARRAY_TYPES = [
  'PackedStringArray',
  'PackedVector3Array',
  'PackedVector2Array',
  'PackedFloat32Array',
  'PackedInt32Array',
] as const;
type PackedArrayType = (typeof PACKED_ARRAY_TYPES)[number];
const isPackedArrayType = (type: string): type is PackedArrayType =>
  (PACKED_ARRAY_TYPES as readonly string[]).includes(type);

interface CompatExport {
  /**
   * A protocol entry point the composition site calls (`@godot Input (protocol)`), not a Godot
   * member: it is exercised by the cases' targets and has no binding.
   */
  readonly protocol: boolean;
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
    case 'PackedVector3Array':
      return Array.isArray(value) ? { t: type, v: value.map((entry: unknown): Encoded => encodeTarget(entry)) } : unsupported(value);
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
  if (isPackedArrayType(native.t) && native.t !== 'PackedStringArray') {
    const packed = native as { readonly t: PackedArrayType; readonly v: readonly Encoded[] };
    if (!Array.isArray(value) || value.length !== packed.v.length) return unsupported(value);
    return { t: packed.t, v: packed.v.map((entry, index) => encodeLike(entry, value[index])) };
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
  if (typeof value === 'string') return { t: 'String', v: value };
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
\t\tTYPE_PACKED_VECTOR3_ARRAY, TYPE_PACKED_VECTOR2_ARRAY, TYPE_PACKED_FLOAT32_ARRAY, TYPE_PACKED_INT32_ARRAY:
\t\t\tvar entries: Array = []
\t\t\tfor item in value:
\t\t\t\tentries.append(_enc(item))
\t\t\treturn {"t": type_string(typeof(value)), "v": entries}
\treturn {"t": "unsupported", "type": type_string(typeof(value))}
`;

/**
 * Each case is its own function. The GDScript compiler pools a function's constants in a
 * `HashMap<Variant, int>` (`modules/gdscript/gdscript_byte_codegen.h:107`) whose key equality
 * merges `-0.0` into an earlier `0.0`; one folded constant per function keeps each value intact.
 * A one-line case is returned; a several-line case is a function body that returns.
 */
/**
 * Node cases run on the first frame, when the SceneTree root is inside the tree. Each case gets a
 * fresh `holder` Node under the root and frees it once its result is encoded.
 */
function nodeProbeSource(cases: readonly GodotEvidenceCase[], helpers = ''): string {
  const functions = cases.map((entry, index) => {
    const body = entry.gdscript.split('\n');
    return `\nfunc _case_${String(index)}(holder: Node) -> Variant:\n${body.map((line) => `\t${line}`).join('\n')}\n`;
  });
  const rows = cases.map(
    (entry, index) =>
      `\tholder = Node.new()\n\troot.add_child(holder)\n\trows.append([${JSON.stringify(entry.id)}, _enc(await _case_${String(index)}(holder))])\n\tholder.free()\n`,
  );
  return `extends SceneTree\n\n${PROBE_ENCODER}${helpers}${functions.join('')}\nfunc _init() -> void:\n\tprocess_frame.connect(_run, CONNECT_ONE_SHOT)\n\n@warning_ignore("redundant_await")\nfunc _run() -> void:\n\tvar rows: Array = []\n\tvar holder: Node\n${rows.join('')}\tprint(${JSON.stringify(OUTPUT_MARKER)} + JSON.stringify(rows))\n\tquit()\n`;
}

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

function scriptResPath(evidence: GodotLanguageEvidenceFile, className: string): string {
  const script = evidence.scripts.find((entry) => entry.className === className);
  if (script === undefined) throw new Error(`no language script declares ${className}`);
  return `res://${script.file}`;
}

function languageProbeSource(evidence: GodotLanguageEvidenceFile): string {
  const rows = evidence.cases.map((entry, index) => {
    const resPath = scriptResPath(evidence, entry.className ?? evidence.className);
    if (entry.instance === undefined) {
      return `\trows.append([${JSON.stringify(entry.id)}, _enc(load(${JSON.stringify(resPath)}).${entry.call}(${entry.arguments?.gdscript ?? ''}))])\n`;
    }
    const steps = entry.instance.steps
      .map((step) =>
        step === '$ready'
          ? `\to${String(index)}.notification(Node.NOTIFICATION_READY)\n\tr${String(index)}.append(null)\n`
          : `\tr${String(index)}.append(o${String(index)}.${step}())\n`,
      )
      .join('');
    const construct =
      entry.instance.scene === undefined
        ? `load(${JSON.stringify(resPath)}).new()`
        : `load(${JSON.stringify(`res://${entry.instance.scene}`)}).instantiate()`;
    return `\tvar o${String(index)} = ${construct}\n\tvar r${String(index)}: Array = []\n${steps}\to${String(index)}.free()\n\trows.append([${JSON.stringify(entry.id)}, _enc(r${String(index)})])\n`;
  });
  return `extends SceneTree\n\n${PROBE_ENCODER}\nfunc _init() -> void:\n\tvar rows: Array = []\n${rows.join('')}\tprint(${JSON.stringify(OUTPUT_MARKER)} + JSON.stringify(rows))\n\tquit()\n`;
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
  extraArguments: readonly string[] = [],
): Row[] {
  writeFileSync(path.join(project, 'probe.gd'), probe);
  const result = spawnSync(
    officialBinary,
    ['--headless', ...extraArguments, '--path', project, '--script', 'res://probe.gd'],
    // A script error stops `_init` before `quit()`, and the binary would then wait forever.
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 180_000 },
  );
  rmSync(path.join(project, 'probe.gd'));
  if (result.error !== undefined) {
    throw new Error(`could not run the official Godot binary: ${result.error.message}`);
  }
  const line = result.stdout.split('\n').find((entry) => entry.startsWith(OUTPUT_MARKER));
  if (result.status !== 0 || line === undefined) {
    const lines = probe.split('\n');
    const cited = [...`${result.stdout}\n${result.stderr}`.matchAll(/res:\/\/probe\.gd:(\d+)/g)].map(
      (match) => `probe.gd:${match[1] as string}: ${lines[Number(match[1]) - 1] ?? ''}`,
    );
    throw new Error(
      `official Godot probe exited ${String(result.status)} without its result.\n${result.stdout}\n${result.stderr}\n${cited.join('\n')}`.trim(),
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

function float64OrderedBits(value: number): bigint {
  const bits = new BigInt64Array(new Float64Array([value]).buffer)[0] as bigint;
  return bits < 0n ? -9223372036854775808n - bits : bits;
}

/** The number of float64 values between two finite or infinite doubles. */
function float64UlpDistance(left: number, right: number): bigint {
  const distance = float64OrderedBits(left) - float64OrderedBits(right);
  return distance < 0n ? -distance : distance;
}

/** Every native/target float pair of two agreeing encoded values, in order. */
function floatPairs(native: Encoded, target: Encoded): (readonly [number, number])[] {
  if (native.t === 'float') return [[bitsFloat(native.v), bitsFloat((target as typeof native).v)]];
  if (native.t === 'Vector3') {
    const other = target as typeof native;
    return (['x', 'y', 'z'] as const).map((axis) => [bitsFloat(native[axis]), bitsFloat(other[axis])] as const);
  }
  if (native.t === 'Array' || isPackedArrayType(native.t)) {
    const packed = native as { readonly v: readonly Encoded[] };
    const other = target as typeof packed;
    return packed.v.flatMap((entry, index) => floatPairs(entry, other.v[index] as Encoded));
  }
  if (native.t === 'Dictionary') {
    const other = target as typeof native;
    return native.v.flatMap(([key, item], index) => {
      const pair = other.v[index] as readonly [Encoded, Encoded];
      return [...floatPairs(key, pair[0]), ...floatPairs(item, pair[1])];
    });
  }
  if (isStructured(native.t)) {
    const fields: Readonly<Record<string, string>> = STRUCTURED[native.t];
    const left = native as StructuredEncoded;
    const right = target as StructuredEncoded;
    return Object.entries(fields).flatMap(([field, fieldType]) =>
      fieldType === 'float'
        ? [[bitsFloat(left[field] as string), bitsFloat(right[field] as string)] as const]
        : fieldType === 'int'
          ? []
          : floatPairs(left[field] as Encoded, right[field] as Encoded),
    );
  }
  return [];
}

/**
 * The recorded tolerance of one claim's cases. A `platform-libm` claim records the largest float64
 * ulp distance it measured and over how many cases.
 */
function measuredTolerance(
  comparators: readonly string[],
  rows: readonly (readonly [Encoded, Encoded])[],
): string {
  if (comparators.includes('platform-libm')) {
    let largest = 0n;
    for (const [native, target] of rows) {
      for (const [left, right] of floatPairs(native, target)) {
        if (Number.isNaN(left) || Number.isNaN(right)) continue;
        const distance = float64UlpDistance(left, right);
        if (distance > largest) largest = distance;
      }
    }
    return `platform C library: within 1 float64 ulp; measured max ${String(largest)} ulp over ${String(rows.length)} cases`;
  }
  if (comparators.includes('rapier-geometry')) {
    let largest = 0;
    for (const [native, target] of rows) {
      for (const [left, right] of floatPairs(native, target)) {
        if (Number.isNaN(left) || Number.isNaN(right)) continue;
        largest = Math.max(largest, Math.abs(left - right));
      }
    }
    return `Rapier's query geometry: within 0.05; measured max ${String(largest)} over ${String(rows.length)} cases`;
  }
  if (comparators.includes('physics-trajectory')) {
    let largest = 0;
    for (const [native, target] of rows) {
      for (const [left, right] of floatPairs(native, target)) {
        if (Number.isNaN(left) || Number.isNaN(right)) continue;
        largest = Math.max(largest, Math.abs(left - right));
      }
    }
    return `rigid body in contact, Rapier's solver: within 0.1; measured max ${String(largest)} over ${String(rows.length)} cases`;
  }
  return comparators.includes('float32-ulp') ? '1 float32 ulp' : 'exact';
}

/** Comparators whose case carries a cited fact in place of a native run, compared exactly. */
const FACT_COMPARATORS: ReadonlySet<GodotEvidenceComparator> = new Set(['web-platform-fact', 'render-mapping']);

function floatsAgree(nativeHex: string, targetHex: string, comparator: GodotEvidenceComparator): boolean {
  const native = bitsFloat(nativeHex);
  const target = bitsFloat(targetHex);
  if (Number.isNaN(native) || Number.isNaN(target)) {
    return Number.isNaN(native) && Number.isNaN(target);
  }
  if (comparator === 'exact' || FACT_COMPARATORS.has(comparator)) return nativeHex === targetHex;
  if (comparator === 'platform-libm') return float64UlpDistance(native, target) <= 1n;
  if (Math.fround(native) !== native || Math.fround(target) !== target) return false;
  if (comparator === 'rapier-geometry') return Math.abs(native - target) <= 0.05;
  if (comparator === 'physics-trajectory') return Math.abs(native - target) <= 0.1;
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
    case 'PackedStringArray':
    case 'PackedVector3Array':
    case 'PackedVector2Array':
    case 'PackedFloat32Array':
    case 'PackedInt32Array': {
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
    case 'PackedVector3Array':
    case 'PackedVector2Array':
    case 'PackedFloat32Array':
    case 'PackedInt32Array':
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
      protocol: /@godot\s+\S+\s+\(protocol\)/.test(doc),
      exportName,
      godotMember: godot,
      sourceFile: source[1] as string,
      sourceLine: Number(source[2]),
    });
  }
  // A TypeScript overload set is one export: its signatures repeat the name.
  const exported = new Set([...moduleSource.matchAll(/^export\s+(?:function|const)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]));
  if (exported.size !== found.length) {
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

function apiClassMethodHash(apiDumpFile: string, owner: string, member: string): number {
  const api = JSON.parse(readFileSync(apiDumpFile, 'utf8')) as {
    classes: { name: string; methods?: { name: string; hash: number }[] }[];
  };
  const hash = api.classes
    .find((entry) => entry.name === owner)
    ?.methods?.find((entry) => entry.name === member)?.hash;
  if (hash === undefined) throw new Error(`API dump has no method ${owner}.${member} declared on ${owner}`);
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
  tolerance: string = comparators.includes('float32-ulp') ? '1 float32 ulp' : 'exact',
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
        tolerance,
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
    case 'builtin-static':
      return {
        ...base,
        kind: 'builtin-static',
        signature: `hash:${String(apiMethodHash(pins.apiDumpFile, symbol.owner, symbol.member))}`,
      };
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
    case 'native-member':
    case 'singleton-member':
    case 'native-static':
      return {
        ...base,
        kind: 'native-member',
        signature: `hash:${String(apiClassMethodHash(pins.apiDumpFile, symbol.owner, symbol.member))}`,
      };
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
    case 'native-member':
      return { kind: 'call', sourceReceiver: 'first-argument' };
    case 'builtin-constructor':
    case 'builtin-static':
    case 'builtin-operator':
    case 'utility-function':
    case 'singleton-member':
    case 'native-static':
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
  const exports = compatExports(moduleSource).filter((entry) => !entry.protocol);
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

  for (const entry of evidence.cases) {
    if (FACT_COMPARATORS.has(entry.comparator) !== (entry.fact !== undefined)) {
      throw new Error(`${entry.id}: a ${entry.comparator} case ${entry.fact === undefined ? 'needs' : 'takes no'} cited fact`);
    }
  }
  // A cited fact stands in for the native run of its case; every other case runs in the binary.
  const probed = evidence.cases.filter((entry) => entry.fact === undefined);
  const temp = mkdtempSync(path.join(tmpdir(), 'gd-analyze-evidence-'));
  let probedRows: Row[] = [];
  try {
    writeFileSync(path.join(temp, 'project.godot'), PROJECT_SOURCE);
    writeFileSync(path.join(temp, 'main.tscn'), MAIN_SCENE);
    if (probed.length > 0) {
      probedRows = runNativeProbe(
        officialBinary,
        temp,
        evidence.kind === 'node' ? nodeProbeSource(probed, evidence.probeHelpers) : compatProbeSource(probed),
        probed.length,
        evidence.kind === 'node' ? ['--fixed-fps', '60'] : [],
      );
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  const probedById = new Map(probedRows.map((row) => [row[0], row] as const));
  const nativeRows: Row[] = evidence.cases.map((entry) =>
    entry.fact === undefined
      ? (probedById.get(entry.id) as Row)
      : [entry.id, encodeTarget(entry.fact.value)],
  );
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
    ...(entry.fact === undefined ? {} : { fact: entry.fact }),
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
        // A lexical name: `@GlobalScope` contributes `GlobalScope`.
        localName: `${symbol.owner.replace(/[^$\w]/g, '')}_${compat.exportName}`,
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
        callsite: symbolCases.every((entry) => entry.fact !== undefined)
          ? `cited ${[...new Set(symbolCases.map((entry) => `${entry.fact?.source.file}:${String(entry.fact?.source.line)}`))].join(' ')}`
          : `res://probe.gd _init() ${symbolCases.map((entry) => entry.id).join(' ')}`,
        observed: sha256(JSON.stringify(indexes.map((index) => nativeRows[index]))),
      },
      {
        implementationSha256,
        callsite: `${evidence.compatModule}.ts ${compat.exportName}`,
        observed: sha256(JSON.stringify(indexes.map((index) => targetRows[index]))),
      },
      [...new Set(symbolCases.map((entry) => entry.comparator))].sort(),
      measuredTolerance(
        [...new Set(symbolCases.map((entry) => entry.comparator))],
        indexes.map((index) => [(nativeRows[index] as Row)[1], (targetRows[index] as Row)[1]] as const),
      ),
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
 * The production authority with this language file's proposed rules and datatype rules in place of
 * any it recorded before, each carrying a provisional in-memory claim so lowering can run the
 * proposal. The provisional claims are never written; what is written is measured below.
 */
function proposalAuthority(
  pins: Pins,
  evidence: GodotLanguageEvidenceFile,
  claimIdFor: (ruleId: string) => string,
): {
  readonly authority: GodotCodeTranslationAuthority;
  readonly rules: readonly GodotCodeRuleEntry[];
  readonly datatypes: readonly GodotDatatypeRuleEntry[];
} {
  const base = godotCodeTranslationAuthority(pins.source);
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
  const datatypes: GodotDatatypeRuleEntry[] = (evidence.datatypes ?? []).map((entry) => ({
    sourceRevision: pins.source.revision,
    sourceDatatype: entry.sourceDatatype,
    targetType: entry.targetType,
    evidenceClaimId: claimIdFor(entry.id),
  }));
  const proposedIds = new Set([
    ...rules.map((rule) => rule.evidenceClaimId),
    ...datatypes.map((entry) => entry.evidenceClaimId),
  ]);
  // This file's earlier rows are replaced, wherever they were loaded from.
  const earlier = new Set(
    base.claims
      .filter((claim) => claim.claimId.startsWith(claimIdFor('')))
      .map((claim) => claim.claimId),
  );
  const replaced = new Set([...proposedIds, ...earlier]);
  const provisional = [
    ...rules.map((rule) => [rule.evidenceClaimId, godotCodeRuleKey(rule.source)] as const),
    ...datatypes.map((entry) => [entry.evidenceClaimId, godotDatatypeRuleKey(entry)] as const),
  ].map(([claimId, identity]) =>
    claimRecord(
      pins,
      claimId,
      'translate-code',
      identity,
      { file: 'provisional', symbol: 'provisional', line: 1 },
      { inputSha256: PROVISIONAL_SHA256, callsite: 'provisional', observed: PROVISIONAL_SHA256 },
      { implementationSha256: PROVISIONAL_SHA256, callsite: 'provisional', observed: PROVISIONAL_SHA256 },
      ['exact'],
    ),
  );
  return {
    rules,
    datatypes,
    authority: {
      ...base,
      rules: {
        ...base.rules,
        entries: [
          ...base.rules.entries.filter((entry) => !replaced.has(entry.evidenceClaimId)),
          ...rules,
        ],
        datatypes: [
          ...base.rules.datatypes.filter((entry) => !replaced.has(entry.evidenceClaimId)),
          ...datatypes,
        ],
      },
      claims: [
        ...base.claims.filter((entry) => !replaced.has(entry.claimId)),
        ...provisional.map((entry) => entry.claim),
      ],
      liveness: [
        ...base.liveness.filter((entry) => !replaced.has(entry.claimId)),
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
  const ids = [...evidence.rules.map((rule) => rule.id), ...(evidence.datatypes ?? []).map((entry) => entry.id)];
  if (new Set(ids).size !== ids.length) throw new Error('language rule ids are not unique');
  if (new Set(evidence.cases.map((entry) => entry.id)).size !== evidence.cases.length) {
    throw new Error('language case ids are not unique');
  }
  const temp = mkdtempSync(path.join(tmpdir(), 'gd-analyze-language-evidence-'));
  try {
    const project = path.join(temp, 'project');
    mkdirSync(project);
    writeFileSync(path.join(project, 'project.godot'), PROJECT_SOURCE);
    writeFileSync(path.join(project, 'main.tscn'), MAIN_SCENE);
    for (const script of evidence.scripts) writeFileSync(path.join(project, script.file), script.source);
    for (const scene of evidence.scenes ?? []) writeFileSync(path.join(project, scene.file), scene.source);

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
    const proposedIds = [
      ...proposal.rules.map((rule) => rule.evidenceClaimId),
      ...proposal.datatypes.map((entry) => entry.evidenceClaimId),
    ];
    const unexercised = proposedIds.filter((id) => !used.has(id));
    if (unexercised.length > 0) {
      process.stdout.write(`proposed rules no case exercises; nothing written: ${unexercised.join(', ')}\n`);
      return 1;
    }
    const emitted = path.join(temp, 'target');
    mkdirSync(path.join(emitted, 'src', 'scripts'), { recursive: true });
    writeFileSync(path.join(emitted, 'package.json'), '{ "type": "module" }\n');
    symlinkSync(path.join(COMPAT_SOURCE_ROOT, 'lib'), path.join(emitted, 'src', 'lib'));
    const printed: string[] = [];
    const classes = new Map<string, Record<string, unknown>>();
    for (const script of evidence.scripts) {
      const sourceFile = lowered.plan.sourceFiles.find(
        (entry) => entry.sourcePath === script.file.replace(/\.gd$/, '.ts'),
      );
      if (sourceFile === undefined) throw new Error(`lowering emitted no ${script.file}`);
      const text = printTargetTsSourceFile(sourceFile);
      printed.push(`// ${sourceFile.sourcePath}\n${text}`);
      writeFileSync(path.join(emitted, 'src', 'scripts', sourceFile.sourcePath), text);
    }
    // Every compat module the lowered cases run is part of what the claims measured.
    const importedModules = [
      ...new Set(printed.flatMap((text) => [...text.matchAll(/from "\.\.\/(lib\/godot-compat\/[a-z0-9-]+)"/g)].map((m) => m[1] as string))),
    ];
    const unlisted = importedModules.filter((module) => !evidence.compatModules.includes(module));
    if (unlisted.length > 0) {
      throw new Error(`the lowered cases import compat modules the file does not list: ${unlisted.join(', ')}`);
    }
    for (const script of evidence.scripts) {
      const file = path.join(emitted, 'src', 'scripts', script.file.replace(/\.gd$/, '.ts'));
      const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      const cls = module[script.className] as Record<string, unknown> | undefined;
      if (cls === undefined) throw new Error(`lowered ${script.file} exports no ${script.className}`);
      classes.set(script.className, cls);
    }
    const targetValues: unknown[] = evidence.cases.map((entry) => {
      const cls = classes.get(entry.className ?? evidence.className) as Record<string, unknown>;
      if (entry.instance !== undefined) {
        const native = entry.instance.native?.();
        const instance = new (cls as unknown as new (native?: unknown) => Record<string, unknown>)(native);
        entry.instance.adopt?.(
          instance,
          native,
          classes as unknown as ReadonlyMap<string, new (native?: unknown) => object>,
        );
        return entry.instance.steps.map((step) => {
          const method = instance[step === '$ready' ? '_ready' : step];
          if (typeof method !== 'function') {
            if (step === '$ready') return null;
            throw new Error(`lowered instance has no ${step}\n${printed.join('\n')}`);
          }
          const result = (method as () => unknown).call(instance);
          return step === '$ready' ? null : result;
        });
      }
      const fn = cls[entry.call];
      if (typeof fn !== 'function') throw new Error(`lowered class has no ${entry.call}`);
      const args = entry.arguments?.target() ?? [];
      return (fn as (...values: unknown[]) => unknown).apply(cls, [...args]);
    });

    // Native: the same GDScript in the official binary, after Godot's own import, which registers
    // the scripts' global class names (`global_script_class_cache.cfg`) one script's types name.
    const imported = spawnSync(officialBinary, ['--headless', '--path', project, '--import'], {
      encoding: 'utf8',
      timeout: 180_000,
    });
    if (imported.error !== undefined || imported.status !== 0) {
      throw new Error(`official Godot --import failed: ${imported.error?.message ?? ''}\n${imported.stderr}`);
    }
    const nativeRows = runNativeProbe(
      officialBinary,
      project,
      languageProbeSource(evidence),
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
        shown:
          entry.instance === undefined
            ? `${entry.className ?? evidence.className}.${entry.call}(${entry.arguments?.gdscript ?? ''})`
            : `${entry.className ?? evidence.className}.new() ${entry.instance.steps.join(' ')}`,
      })),
      nativeRows,
      targetRows,
    );
    process.stdout.write(
      `gd-analyze evidence ${name}: ${String(evidence.cases.length)} cases over ${String(proposedIds.length)} proposed rules, ${pinned.buildIdentity}\n`,
    );
    if (disagreements.length > 0) {
      process.stdout.write(
        `${String(disagreements.length)} of ${String(evidence.cases.length)} cases disagree; nothing written.\n  ${disagreements.join('\n  ')}\n\nlowered:\n${printed.join('\n')}\n`,
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
        scripts: evidence.scripts,
        scenes: evidence.scenes ?? [],
        cases: evidence.cases.map((entry) => ({
          id: entry.id,
          className: entry.className ?? evidence.className,
          call: entry.call,
          arguments: entry.arguments?.gdscript ?? '',
          instance: entry.instance ?? null,
          comparator: entry.comparator,
        })),
        rules: evidence.rules,
        datatypes: evidence.datatypes ?? [],
      }),
    );
    const observedNative = sha256(JSON.stringify(nativeRows));
    const observedTarget = sha256(JSON.stringify(targetRows));
    const comparators = [...new Set(evidence.cases.map((entry) => entry.comparator))].sort();
    const claims: SemanticClaimRecord[] = [];
    const liveness: GodotCodeClaimLiveness[] = [];
    const recordClaim = (
      claimId: string,
      identity: string,
      source: { readonly file: string; readonly symbol: string; readonly line: number },
    ) => {
      const record = claimRecord(
        pinned,
        claimId,
        'translate-code',
        identity,
        source,
        { inputSha256, callsite: `${evidence.scripts.map((entry) => entry.file).join(' ')} every case`, observed: observedNative },
        { implementationSha256, callsite: 'lowered src/scripts/*', observed: observedTarget },
        comparators,
      );
      claims.push(record.claim);
      liveness.push(record.liveness);
    };
    proposal.rules.forEach((rule, index) => {
      recordClaim(rule.evidenceClaimId, godotCodeRuleKey(rule.source), (evidence.rules[index] as GodotLanguageEvidenceFile['rules'][number]).source);
    });
    proposal.datatypes.forEach((entry, index) => {
      recordClaim(entry.evidenceClaimId, godotDatatypeRuleKey(entry), ((evidence.datatypes ?? [])[index] as NonNullable<GodotLanguageEvidenceFile['datatypes']>[number]).source);
    });
    const written = writeEvidenceFile(name, {
      implementation,
      bindings: [],
      rules: proposal.rules,
      datatypes: proposal.datatypes,
      claims,
      liveness,
    });
    process.stdout.write(
      `all ${String(evidence.cases.length)} cases agree; wrote ${String(proposal.rules.length)} rules, ${String(proposal.datatypes.length)} datatype rules and their claims to ${written}\n\nlowered:\n${printed.join('\n')}\n`,
    );
    return 0;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** The case files `evidence --refresh` re-runs, in dependency order: compat modules first. */
export async function godotEvidenceCaseNames(): Promise<readonly string[]> {
  const names = readdirSync(CASES_DIR)
    .filter((file) => file.endsWith('.cases.ts'))
    .map((file) => file.slice(0, -'.cases.ts'.length))
    .sort();
  const kinds = await Promise.all(
    names.map(async (name) => {
      const loaded = (await import(pathToFileURL(path.join(CASES_DIR, `${name}.cases.ts`)).href)) as {
        default?: { readonly kind?: string };
      };
      return [name, loaded.default?.kind === 'language'] as const;
    }),
  );
  return [
    ...kinds.filter(([, language]) => !language).map(([name]) => name),
    ...kinds.filter(([, language]) => language).map(([name]) => name),
  ];
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
