/**
 * Exact Godot 4.7 differential for the shipped 34-row AABB compat battery.
 *
 * This evidence generator runs the same value/property/method/operator matrix through the exact
 * official engine and the copied compat implementation, refuses any mismatch, then records the
 * official rows with executable/source/implementation hashes.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  aabb,
  aabbAbs,
  aabbCenter,
  aabbEncloses,
  aabbEnd,
  aabbEndpoint,
  aabbExpand,
  aabbGrow,
  aabbHasPoint,
  aabbHasSurface,
  aabbHasVolume,
  aabbIntersection,
  aabbIntersects,
  aabbIsEqualApprox,
  aabbIsFinite,
  aabbLongestAxis,
  aabbLongestAxisIndex,
  aabbLongestAxisSize,
  aabbMerge,
  aabbShortestAxis,
  aabbShortestAxisIndex,
  aabbShortestAxisSize,
  aabbSupport,
  aabbVolume,
  aabbWithEnd,
  aabbWithPosition,
  aabbWithSize,
  copyAabb,
  type GodotAabb,
} from '../../editor/catalog/project-source/src/lib/godot-compat/aabb';
import {
  aabbIntersectsPlane,
  aabbIntersectsRay,
  aabbIntersectsSegment,
} from '../../editor/catalog/project-source/src/lib/godot-compat/aabb-intersections';
import {
  aabbEquals,
  aabbIn,
  aabbIsZero,
  aabbTransformInverse,
} from '../../editor/catalog/project-source/src/lib/godot-compat/aabb-operators';

const SOURCE_REVISION = '5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88';
const OFFICIAL_EXECUTABLE_SHA256 =
  '445c6f95030e2ca767dd921be1e91bd99e50c3703f91d22a22cd31216c93a80f';
const OUTPUT_MARKER = 'vgai.godot-aabb-probe:';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(PACKAGE_DIR, '../..');
const EVIDENCE_PATH = join(PACKAGE_DIR, 'vendor/compat-evidence/godot-4.7-aabb.json');
const IMPLEMENTATION_PATHS = [
  'packages/editor/catalog/project-source/src/lib/godot-compat/aabb.ts',
  'packages/editor/catalog/project-source/src/lib/godot-compat/aabb-intersections.ts',
  'packages/editor/catalog/project-source/src/lib/godot-compat/aabb-operators.ts',
] as const;

type Encoded = string | boolean | null | Encoded[] | { readonly [key: string]: Encoded };
type Results = Readonly<Record<string, Encoded>>;

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function number(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Number.POSITIVE_INFINITY) return 'Infinity';
  if (value === Number.NEGATIVE_INFINITY) return '-Infinity';
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

function vector(value: { readonly x: number; readonly y: number; readonly z: number }): Encoded {
  return [number(value.x), number(value.y), number(value.z)];
}

function nullableVector(
  value: { readonly x: number; readonly y: number; readonly z: number } | null,
): Encoded {
  return value === null ? null : vector(value);
}

function box(value: GodotAabb): Encoded {
  return { position: vector(value.position), size: vector(value.size) };
}

function compatResults(): Results {
  const base = aabb({ x: 1, y: 2, z: 3 }, { x: 4, y: 6, z: 2 });
  const other = aabb({ x: 3, y: 4, z: 2 }, { x: 4, y: 3, z: 4 });
  const transformed = aabbTransformInverse(base, {
    basis: [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
    origin: { x: 1, y: 2, z: 3 },
  });
  const positionWrite = aabbWithPosition(base, { x: 8, y: 9, z: 10 });
  const sizeWrite = aabbWithSize(base, { x: 7, y: 8, z: 9 });
  const endWrite = aabbWithEnd(base, { x: 10, y: 11, z: 12 });
  const same = copyAabb(base);
  const different = aabb({ x: 1, y: 2, z: 3 }, { x: 4, y: 6, z: 3 });
  return {
    'AABB.abs': box(aabbAbs(aabb({ x: 5, y: 5, z: 5 }, { x: -2, y: -4, z: -6 }))),
    'AABB.encloses': [
      aabbEncloses(base, aabb({ x: 2, y: 3, z: 3.5 }, { x: 1, y: 1, z: 1 })),
      aabbEncloses(base, other),
    ],
    'AABB.end': [vector(aabbEnd(base)), box(endWrite)],
    'AABB.expand': box(aabbExpand(base, { x: -1, y: 10, z: 4 })),
    'AABB.get_center': vector(aabbCenter(base)),
    'AABB.get_endpoint': Array.from({ length: 8 }, (_, index) => vector(aabbEndpoint(base, index))),
    'AABB.get_longest_axis': vector(aabbLongestAxis(base)),
    'AABB.get_longest_axis_index': String(aabbLongestAxisIndex(base)),
    'AABB.get_longest_axis_size': number(aabbLongestAxisSize(base)),
    'AABB.get_shortest_axis': vector(aabbShortestAxis(base)),
    'AABB.get_shortest_axis_index': String(aabbShortestAxisIndex(base)),
    'AABB.get_shortest_axis_size': number(aabbShortestAxisSize(base)),
    'AABB.get_support': vector(aabbSupport(base, { x: 1, y: -1, z: 0 })),
    'AABB.get_volume': number(aabbVolume(base)),
    'AABB.grow': box(aabbGrow(base, 1.5)),
    'AABB.has_point': [
      aabbHasPoint(base, { x: 2, y: 3, z: 4 }),
      aabbHasPoint(base, { x: 8, y: 3, z: 4 }),
    ],
    'AABB.has_surface': [aabbHasSurface(base), aabbHasSurface(aabb())],
    'AABB.has_volume': [
      aabbHasVolume(base),
      aabbHasVolume(aabb({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 })),
    ],
    'AABB.intersection': [
      box(aabbIntersection(base, other)),
      box(aabbIntersection(base, aabb({ x: 20, y: 20, z: 20 }, { x: 1, y: 1, z: 1 }))),
    ],
    'AABB.intersects': [
      aabbIntersects(base, other),
      aabbIntersects(base, aabb({ x: 5, y: 2, z: 3 }, { x: 1, y: 1, z: 1 })),
    ],
    'AABB.intersects_plane': [
      aabbIntersectsPlane(base, { normal: { x: 1, y: 0, z: 0 }, d: 3 }),
      aabbIntersectsPlane(base, { normal: { x: 1, y: 0, z: 0 }, d: 20 }),
    ],
    'AABB.intersects_ray': [
      nullableVector(aabbIntersectsRay(base, { x: -1, y: 3, z: 4 }, { x: 1, y: 0, z: 0 })),
      nullableVector(aabbIntersectsRay(base, { x: -1, y: 20, z: 4 }, { x: 1, y: 0, z: 0 })),
    ],
    'AABB.intersects_segment': [
      nullableVector(aabbIntersectsSegment(base, { x: -1, y: 3, z: 4 }, { x: 2, y: 3, z: 4 })),
      nullableVector(aabbIntersectsSegment(base, { x: -1, y: 20, z: 4 }, { x: 2, y: 20, z: 4 })),
    ],
    'AABB.is_equal_approx': [
      aabbIsEqualApprox(base, aabb({ x: 1.000001, y: 2, z: 3 }, { x: 4, y: 6, z: 2 })),
      aabbIsEqualApprox(base, different),
    ],
    'AABB.is_finite': [
      aabbIsFinite(base),
      aabbIsFinite(aabb({ x: Number.POSITIVE_INFINITY, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })),
    ],
    'AABB.merge': box(aabbMerge(base, other)),
    'AABB.new': [
      box(aabb()),
      box(aabb({ x: 1, y: 2, z: 3 }, { x: 4, y: 6, z: 2 })),
      box(copyAabb(base)),
    ],
    'AABB.operator !=': [!aabbEquals(base, same), !aabbEquals(base, different)],
    'AABB.operator *': box(transformed),
    'AABB.operator ==': [aabbEquals(base, same), aabbEquals(base, different)],
    'AABB.operator in': [aabbIn(base, [same]), aabbIn(base, [different])],
    'AABB.operator not': [aabbIsZero(aabb()), aabbIsZero(base)],
    'AABB.position': [vector(base.position), box(positionWrite)],
    'AABB.size': [vector(base.size), box(sizeWrite)],
  };
}

function nativeSource(): string {
  return `extends SceneTree

func _number(value: float) -> String:
\tif is_nan(value): return "NaN"
\tif is_inf(value): return "Infinity" if value > 0 else "-Infinity"
\treturn str(value)

func _vector(value: Vector3) -> Array:
\treturn [_number(value.x), _number(value.y), _number(value.z)]

func _box(value: AABB) -> Dictionary:
\treturn {"position": _vector(value.position), "size": _vector(value.size)}

func _init() -> void:
\tvar out: Dictionary = {}
\tvar base := AABB(Vector3(1, 2, 3), Vector3(4, 6, 2))
\tvar other := AABB(Vector3(3, 4, 2), Vector3(4, 3, 4))
\tvar negative := AABB(Vector3(5, 5, 5), Vector3(-2, -4, -6))
\tvar inner := AABB(Vector3(2, 3, 3.5), Vector3(1, 1, 1))
\tvar far := AABB(Vector3(20, 20, 20), Vector3(1, 1, 1))
\tvar same := AABB(base)
\tvar different := AABB(Vector3(1, 2, 3), Vector3(4, 6, 3))
\tvar position_write := base
\tposition_write.position = Vector3(8, 9, 10)
\tvar size_write := base
\tsize_write.size = Vector3(7, 8, 9)
\tvar end_write := base
\tend_write.end = Vector3(10, 11, 12)
\tout["AABB.abs"] = _box(negative.abs())
\tout["AABB.encloses"] = [base.encloses(inner), base.encloses(other)]
\tout["AABB.end"] = [_vector(base.end), _box(end_write)]
\tout["AABB.expand"] = _box(base.expand(Vector3(-1, 10, 4)))
\tout["AABB.get_center"] = _vector(base.get_center())
\tvar endpoints: Array = []
\tfor index in 8: endpoints.append(_vector(base.get_endpoint(index)))
\tout["AABB.get_endpoint"] = endpoints
\tout["AABB.get_longest_axis"] = _vector(base.get_longest_axis())
\tout["AABB.get_longest_axis_index"] = str(base.get_longest_axis_index())
\tout["AABB.get_longest_axis_size"] = _number(base.get_longest_axis_size())
\tout["AABB.get_shortest_axis"] = _vector(base.get_shortest_axis())
\tout["AABB.get_shortest_axis_index"] = str(base.get_shortest_axis_index())
\tout["AABB.get_shortest_axis_size"] = _number(base.get_shortest_axis_size())
\tout["AABB.get_support"] = _vector(base.get_support(Vector3(1, -1, 0)))
\tout["AABB.get_volume"] = _number(base.get_volume())
\tout["AABB.grow"] = _box(base.grow(1.5))
\tout["AABB.has_point"] = [base.has_point(Vector3(2, 3, 4)), base.has_point(Vector3(8, 3, 4))]
\tout["AABB.has_surface"] = [base.has_surface(), AABB().has_surface()]
\tout["AABB.has_volume"] = [base.has_volume(), AABB(Vector3.ZERO, Vector3(1, 0, 1)).has_volume()]
\tout["AABB.intersection"] = [_box(base.intersection(other)), _box(base.intersection(far))]
\tout["AABB.intersects"] = [base.intersects(other), base.intersects(AABB(Vector3(5, 2, 3), Vector3.ONE))]
\tout["AABB.intersects_plane"] = [base.intersects_plane(Plane(Vector3(1, 0, 0), 3)), base.intersects_plane(Plane(Vector3(1, 0, 0), 20))]
\tout["AABB.intersects_ray"] = [_vector(base.intersects_ray(Vector3(-1, 3, 4), Vector3(1, 0, 0))), base.intersects_ray(Vector3(-1, 20, 4), Vector3(1, 0, 0))]
\tout["AABB.intersects_segment"] = [_vector(base.intersects_segment(Vector3(-1, 3, 4), Vector3(2, 3, 4))), base.intersects_segment(Vector3(-1, 20, 4), Vector3(2, 20, 4))]
\tout["AABB.is_equal_approx"] = [base.is_equal_approx(AABB(Vector3(1.000001, 2, 3), Vector3(4, 6, 2))), base.is_equal_approx(different)]
\tout["AABB.is_finite"] = [base.is_finite(), AABB(Vector3(INF, 0, 0), Vector3.ONE).is_finite()]
\tout["AABB.merge"] = _box(base.merge(other))
\tout["AABB.new"] = [_box(AABB()), _box(AABB(Vector3(1, 2, 3), Vector3(4, 6, 2))), _box(AABB(base))]
\tout["AABB.operator !="] = [base != same, base != different]
\tout["AABB.operator *"] = _box(base * Transform3D(Basis(), Vector3(1, 2, 3)))
\tout["AABB.operator =="] = [base == same, base == different]
\tout["AABB.operator in"] = [base in [same], base in [different]]
\tout["AABB.operator not"] = [not AABB(), not base]
\tout["AABB.position"] = [_vector(base.position), _box(position_write)]
\tout["AABB.size"] = [_vector(base.size), _box(size_write)]
\tprint(${JSON.stringify(OUTPUT_MARKER)} + JSON.stringify(out))
\tquit()
`;
}

function sorted(results: Results): Results {
  return Object.fromEntries(
    Object.entries(results).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function runNative(binary: string, source: string): Results {
  const root = mkdtempSync(join(tmpdir(), 'vgai-godot-aabb-proof-'));
  try {
    writeFileSync(join(root, 'project.godot'), '[application]\nconfig/name="AABB proof"\n');
    writeFileSync(join(root, 'probe.gd'), source);
    const child = spawnSync(binary, ['--headless', '--path', root, '--script', 'res://probe.gd'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = `${child.stdout ?? ''}${child.stderr ?? ''}`;
    if (child.status !== 0) throw new Error(`official Godot exited ${child.status}:\n${output}`);
    const line = (child.stdout ?? '')
      .split(/\r?\n/u)
      .find((candidate) => candidate.startsWith(OUTPUT_MARKER));
    if (line === undefined) throw new Error(`official Godot emitted no result row:\n${output}`);
    return JSON.parse(line.slice(OUTPUT_MARKER.length)) as Results;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function main(): void {
  const binary = process.argv[2];
  if (binary === undefined)
    throw new Error('native-aabb-probe needs the exact official Godot binary');
  const executableSha256 = sha256(readFileSync(binary));
  if (executableSha256 !== OFFICIAL_EXECUTABLE_SHA256) {
    throw new Error(
      `official executable mismatch: expected ${OFFICIAL_EXECUTABLE_SHA256}, got ${executableSha256}`,
    );
  }
  const source = nativeSource();
  const official = sorted(runNative(binary, source));
  const compat = sorted(compatResults());
  if (JSON.stringify(official) !== JSON.stringify(compat)) {
    const member = [...new Set([...Object.keys(official), ...Object.keys(compat)])]
      .sort()
      .find((key) => JSON.stringify(official[key]) !== JSON.stringify(compat[key]));
    throw new Error(
      `AABB differential mismatch at ${member ?? '<unknown>'}: official=${JSON.stringify(member === undefined ? official : official[member])} compat=${JSON.stringify(member === undefined ? compat : compat[member])}`,
    );
  }
  const evidence = {
    protocol: 'vgai.godot-aabb-evidence',
    protocolVersion: 1,
    authority: {
      sourceRevision: SOURCE_REVISION,
      executableSha256,
      nativeProbeSourceSha256: sha256(source),
      implementationSha256: Object.fromEntries(
        IMPLEMENTATION_PATHS.map((path) => [path, sha256(readFileSync(join(REPO_ROOT, path)))]),
      ),
    },
    verdict: 'exact-match',
    memberCount: Object.keys(official).length,
    members: official,
  };
  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`AABB native differential: PASS — ${evidence.memberCount} exact members\n`);
}

main();
