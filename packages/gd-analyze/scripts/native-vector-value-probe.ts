/**
 * Reproduce Godot 4.7's shipped Vector2 and Vector3 value protocol against copied compat.
 *
 * Every published row is executed in the exact official binary and through godot-compat. The
 * generator refuses structural drift or any numeric delta above float32 tolerance, then records
 * the official result together with the executable, source, probe, and implementation identities.
 *
 *   npx tsx packages/gd-analyze/scripts/native-vector-value-probe.ts /path/to/Godot
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  angle,
  distanceTo,
  length,
  lengthSquared,
  limitLength,
  normalized,
  rotated,
  VECTOR2_ZERO,
  vec2,
} from '../../editor/catalog/project-source/src/lib/godot-compat/vector2';
import {
  cross3,
  dot3,
  isZeroApprox3,
  length3,
  lerp3,
  limitLength3,
  normalized3,
  rotated3,
  VECTOR3_FORWARD,
  VECTOR3_ONE,
  VECTOR3_UP,
  VECTOR3_ZERO,
  vec3,
} from '../../editor/catalog/project-source/src/lib/godot-compat/variant-3d';

const SOURCE_REVISION = '5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88';
const OFFICIAL_EXECUTABLE_SHA256 =
  '445c6f95030e2ca767dd921be1e91bd99e50c3703f91d22a22cd31216c93a80f';
const OUTPUT_MARKER = 'vgai.godot-vector-value-probe:';
const FLOAT_TOLERANCE = 0.000001;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(PACKAGE_DIR, '../..');
const EVIDENCE_PATH = join(PACKAGE_DIR, 'vendor/compat-evidence/godot-4.7-vector2-vector3.json');
const IMPLEMENTATION_PATHS = [
  'packages/editor/catalog/project-source/src/lib/godot-compat/variant.ts',
  'packages/editor/catalog/project-source/src/lib/godot-compat/variant-3d.ts',
] as const;

const MEMBERS = [
  'Vector2.ZERO',
  'Vector2.angle',
  'Vector2.distance_to',
  'Vector2.length',
  'Vector2.length_squared',
  'Vector2.limit_length',
  'Vector2.normalized',
  'Vector2.rotated',
  'Vector2.x',
  'Vector2.y',
  'Vector3.FORWARD',
  'Vector3.ONE',
  'Vector3.UP',
  'Vector3.ZERO',
  'Vector3.cross',
  'Vector3.dot',
  'Vector3.is_zero_approx',
  'Vector3.length',
  'Vector3.lerp',
  'Vector3.limit_length',
  'Vector3.normalized',
  'Vector3.rotated',
  'Vector3.x',
  'Vector3.y',
  'Vector3.z',
] as const;

type Encoded = number | boolean | Encoded[];
type MemberResults = Readonly<Record<string, Encoded>>;

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function vector2(value: { readonly x: number; readonly y: number }): Encoded {
  return [value.x, value.y];
}

function vector3(value: { readonly x: number; readonly y: number; readonly z: number }): Encoded {
  return [value.x, value.y, value.z];
}

function compatResults(): MemberResults {
  const v2 = vec2(3, 4);
  const v3 = vec3(2, 3, 6);
  const v2x = vec2(1, 2);
  const v2xBefore = v2x.x;
  v2x.x = 7;
  const v2y = vec2(1, 2);
  const v2yBefore = v2y.y;
  v2y.y = 8;
  const property3 = vec3(1, 2, 3);
  return {
    'Vector2.ZERO': vector2(VECTOR2_ZERO),
    'Vector2.angle': angle(vec2(1, 1)),
    'Vector2.distance_to': distanceTo(vec2(1, 2), vec2(4, 6)),
    'Vector2.length': length(v2),
    'Vector2.length_squared': lengthSquared(v2),
    'Vector2.limit_length': [
      vector2(limitLength(v2, 2)),
      vector2(limitLength(vec2(1, 1), 2)),
      vector2(limitLength(VECTOR2_ZERO, 2)),
    ],
    'Vector2.normalized': [vector2(normalized(v2)), vector2(normalized(VECTOR2_ZERO))],
    'Vector2.rotated': vector2(rotated(vec2(1, 2), Math.PI / 3)),
    'Vector2.x': [v2xBefore, vector2(v2x)],
    'Vector2.y': [v2yBefore, vector2(v2y)],
    'Vector3.FORWARD': vector3(VECTOR3_FORWARD),
    'Vector3.ONE': vector3(VECTOR3_ONE),
    'Vector3.UP': vector3(VECTOR3_UP),
    'Vector3.ZERO': vector3(VECTOR3_ZERO),
    'Vector3.cross': vector3(cross3(vec3(1, 2, 3), vec3(4, -1, 2))),
    'Vector3.dot': dot3(vec3(1, 2, 3), vec3(4, -1, 2)),
    'Vector3.is_zero_approx': [
      isZeroApprox3(vec3(0.000001, -0.000001, 0)),
      isZeroApprox3(vec3(0.0001, 0, 0)),
    ],
    'Vector3.length': length3(v3),
    'Vector3.lerp': vector3(lerp3(vec3(1, 2, 3), vec3(5, 10, -1), 1.25)),
    'Vector3.limit_length': [
      vector3(limitLength3(v3, 3.5)),
      vector3(limitLength3(vec3(1, 1, 1), 3.5)),
      vector3(limitLength3(VECTOR3_ZERO, 3.5)),
    ],
    'Vector3.normalized': [vector3(normalized3(v3)), vector3(normalized3(VECTOR3_ZERO))],
    'Vector3.rotated': vector3(rotated3(vec3(1, 2, 3), VECTOR3_UP, Math.PI / 3)),
    'Vector3.x': [property3.x, vector3(vec3(7, property3.y, property3.z))],
    'Vector3.y': [property3.y, vector3(vec3(property3.x, 8, property3.z))],
    'Vector3.z': [property3.z, vector3(vec3(property3.x, property3.y, 9))],
  };
}

function nativeScript(): string {
  return `extends SceneTree

func _v2(value: Vector2) -> Array:
\treturn [value.x, value.y]

func _v3(value: Vector3) -> Array:
\treturn [value.x, value.y, value.z]

func _init() -> void:
\tvar out: Dictionary = {}
\tvar v2 := Vector2(3, 4)
\tvar v3 := Vector3(2, 3, 6)
\tvar v2x := Vector2(1, 2)
\tvar v2x_before := v2x.x
\tv2x.x = 7
\tvar v2y := Vector2(1, 2)
\tvar v2y_before := v2y.y
\tv2y.y = 8
\tvar property3 := Vector3(1, 2, 3)
\tout["Vector2.ZERO"] = _v2(Vector2.ZERO)
\tout["Vector2.angle"] = Vector2(1, 1).angle()
\tout["Vector2.distance_to"] = Vector2(1, 2).distance_to(Vector2(4, 6))
\tout["Vector2.length"] = v2.length()
\tout["Vector2.length_squared"] = v2.length_squared()
\tout["Vector2.limit_length"] = [_v2(v2.limit_length(2)), _v2(Vector2(1, 1).limit_length(2)), _v2(Vector2.ZERO.limit_length(2))]
\tout["Vector2.normalized"] = [_v2(v2.normalized()), _v2(Vector2.ZERO.normalized())]
\tout["Vector2.rotated"] = _v2(Vector2(1, 2).rotated(PI / 3.0))
\tout["Vector2.x"] = [v2x_before, _v2(v2x)]
\tout["Vector2.y"] = [v2y_before, _v2(v2y)]
\tout["Vector3.FORWARD"] = _v3(Vector3.FORWARD)
\tout["Vector3.ONE"] = _v3(Vector3.ONE)
\tout["Vector3.UP"] = _v3(Vector3.UP)
\tout["Vector3.ZERO"] = _v3(Vector3.ZERO)
\tout["Vector3.cross"] = _v3(Vector3(1, 2, 3).cross(Vector3(4, -1, 2)))
\tout["Vector3.dot"] = Vector3(1, 2, 3).dot(Vector3(4, -1, 2))
\tout["Vector3.is_zero_approx"] = [Vector3(0.000001, -0.000001, 0).is_zero_approx(), Vector3(0.0001, 0, 0).is_zero_approx()]
\tout["Vector3.length"] = v3.length()
\tout["Vector3.lerp"] = _v3(Vector3(1, 2, 3).lerp(Vector3(5, 10, -1), 1.25))
\tout["Vector3.limit_length"] = [_v3(v3.limit_length(3.5)), _v3(Vector3(1, 1, 1).limit_length(3.5)), _v3(Vector3.ZERO.limit_length(3.5))]
\tout["Vector3.normalized"] = [_v3(v3.normalized()), _v3(Vector3.ZERO.normalized())]
\tout["Vector3.rotated"] = _v3(Vector3(1, 2, 3).rotated(Vector3.UP, PI / 3.0))
\tout["Vector3.x"] = [property3.x, _v3(Vector3(7, property3.y, property3.z))]
\tout["Vector3.y"] = [property3.y, _v3(Vector3(property3.x, 8, property3.z))]
\tout["Vector3.z"] = [property3.z, _v3(Vector3(property3.x, property3.y, 9))]
\tprint(${JSON.stringify(OUTPUT_MARKER)} + JSON.stringify(out))
\tquit()
`;
}

function runNative(binary: string, source: string): MemberResults {
  const root = mkdtempSync(join(tmpdir(), 'vgai-godot-vector-value-proof-'));
  try {
    writeFileSync(join(root, 'project.godot'), '[application]\nconfig/name="Vector value proof"\n');
    writeFileSync(join(root, 'probe.gd'), source);
    const child = spawnSync(binary, ['--headless', '--path', root, '--script', 'res://probe.gd'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = child.stdout ?? '';
    const stderr = child.stderr ?? '';
    if (child.status !== 0) {
      throw new Error(`official Godot exited ${child.status}:\n${stdout}${stderr}`);
    }
    const line = stdout.split(/\r?\n/u).find((candidate) => candidate.startsWith(OUTPUT_MARKER));
    if (line === undefined) {
      throw new Error(`official Godot emitted no ${OUTPUT_MARKER} row:\n${stdout}${stderr}`);
    }
    return JSON.parse(line.slice(OUTPUT_MARKER.length)) as MemberResults;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

interface DeltaState {
  maxAbsDelta: number;
  numericLeaves: number;
}

function compare(official: Encoded, compat: Encoded, path: string, state: DeltaState): void {
  if (typeof official === 'number' && typeof compat === 'number') {
    const delta = Math.abs(official - compat);
    state.numericLeaves += 1;
    state.maxAbsDelta = Math.max(state.maxAbsDelta, delta);
    if (!(delta <= FLOAT_TOLERANCE)) {
      throw new Error(`${path}: numeric delta ${delta} exceeds ${FLOAT_TOLERANCE}`);
    }
    return;
  }
  if (Array.isArray(official) && Array.isArray(compat)) {
    if (official.length !== compat.length) {
      throw new Error(`${path}: array length ${official.length} != ${compat.length}`);
    }
    official.forEach((value, index) => {
      compare(value, compat[index] as Encoded, `${path}[${index}]`, state);
    });
    return;
  }
  if (official !== compat) {
    throw new Error(
      `${path}: official=${JSON.stringify(official)} compat=${JSON.stringify(compat)}`,
    );
  }
}

function sorted(value: MemberResults): MemberResults {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function main(): void {
  const binary = process.argv[2];
  if (binary === undefined) {
    throw new Error('native-vector-value-probe needs the exact official Godot binary');
  }
  const executableSha256 = sha256(readFileSync(binary));
  if (executableSha256 !== OFFICIAL_EXECUTABLE_SHA256) {
    throw new Error(
      `official executable mismatch: expected ${OFFICIAL_EXECUTABLE_SHA256}, got ${executableSha256}`,
    );
  }
  const source = nativeScript();
  const official = sorted(runNative(binary, source));
  const compat = sorted(compatResults());
  const expected = [...MEMBERS].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(Object.keys(official)) !== JSON.stringify(expected)) {
    throw new Error(`native vector inventory mismatch: expected ${expected.length} exact rows`);
  }
  if (JSON.stringify(Object.keys(compat)) !== JSON.stringify(expected)) {
    throw new Error(`compat vector inventory mismatch: expected ${expected.length} exact rows`);
  }
  const delta: DeltaState = { maxAbsDelta: 0, numericLeaves: 0 };
  for (const member of expected) {
    compare(official[member] as Encoded, compat[member] as Encoded, member, delta);
  }
  const evidence = {
    protocol: 'vgai.godot-vector-value-evidence',
    protocolVersion: 1,
    authority: {
      sourceRevision: SOURCE_REVISION,
      executableSha256,
      nativeProbeSourceSha256: sha256(source),
      implementationSha256: Object.fromEntries(
        IMPLEMENTATION_PATHS.map((path) => [path, sha256(readFileSync(join(REPO_ROOT, path)))]),
      ),
    },
    verdict: 'match-within-float32-tolerance',
    memberCount: expected.length,
    numericLeaves: delta.numericLeaves,
    maxAbsDelta: delta.maxAbsDelta,
    tolerance: FLOAT_TOLERANCE,
    members: official,
  };
  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(
    `Vector value native differential: PASS — ${evidence.memberCount} exact rows, ` +
      `${evidence.numericLeaves} numeric leaves, max delta ${evidence.maxAbsDelta}\n`,
  );
}

main();
