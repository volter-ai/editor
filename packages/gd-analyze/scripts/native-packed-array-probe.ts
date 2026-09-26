/**
 * Reproduce the complete Godot 4.7 Packed*Array protocol against the shipped compat backend.
 *
 * This is evidence generation, not a fixture test. It executes one generated GDScript program in
 * the exact official binary, executes the same member matrix through godot-compat, refuses any
 * result disagreement, and writes the reviewed evidence consumed by the completion checklist.
 *
 *   npx tsx packages/gd-analyze/scripts/native-packed-array-probe.ts /path/to/Godot
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { Zstd } from '@hpcc-js/wasm-zstd';
import { deflate, gzip, inflate, ungzip } from 'pako';
import {
  fastLzCompress,
  fastLzDecompress,
} from '../../editor/catalog/project-source/src/lib/codecs/fastlz';
import {
  godotPackedFloat,
  godotPackedInt,
  type PackedArrayValue,
  packedArrayAppend,
  packedArrayAppendArray,
  packedArrayBsearch,
  packedArrayClear,
  packedArrayConcat,
  packedArrayCount,
  packedArrayDuplicate,
  packedArrayEquals,
  packedArrayErase,
  packedArrayFill,
  packedArrayFind,
  packedArrayGet,
  packedArrayHas,
  packedArrayIn,
  packedArrayInsert,
  packedArrayIsEmpty,
  packedArrayRemoveAt,
  packedArrayResize,
  packedArrayReverse,
  packedArrayRfind,
  packedArraySet,
  packedArraySize,
  packedArraySlice,
  packedArraySort,
  packedArrayTransformInverse,
  packedByteArray,
  packedColorArray,
  packedFloat32Array,
  packedFloat64Array,
  packedInt32Array,
  packedInt64Array,
  packedStringArray,
  packedVector2Array,
  packedVector3Array,
  packedVector4Array,
} from '../../editor/catalog/project-source/src/lib/godot-compat/packed-array';
import type { GodotPackedArrayCodecs } from '../../editor/catalog/project-source/src/lib/godot-compat/packed-array-binary';
import { packedArrayToByteArray } from '../../editor/catalog/project-source/src/lib/godot-compat/packed-array-binary';
import { godotPackedByteArrayCall } from '../../editor/catalog/project-source/src/lib/godot-compat/packed-array-call';

const SOURCE_REVISION = '5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88';
const OFFICIAL_EXECUTABLE_SHA256 =
  '445c6f95030e2ca767dd921be1e91bd99e50c3703f91d22a22cd31216c93a80f';
const OUTPUT_MARKER = 'vgai.godot-packed-array-probe:';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(PACKAGE_DIR, '../..');
const EVIDENCE_PATH = join(PACKAGE_DIR, 'vendor/compat-evidence/godot-4.7-packed-array.json');
const IMPLEMENTATION_PATHS = [
  'packages/editor/catalog/project-source/src/lib/codecs/fastlz.ts',
  'packages/editor/catalog/project-source/src/lib/godot-compat/packed-array.ts',
  'packages/editor/catalog/project-source/src/lib/godot-compat/packed-array-binary.ts',
  'packages/editor/catalog/project-source/src/lib/godot-compat/packed-array-call.ts',
  'packages/editor/catalog/project-source/src/lib/godot-compat/godot-variant-marshals.ts',
  'packages/editor/catalog/project-source/src/lib/godot-runtime/packed-array-codecs.ts',
] as const;

type Encoded = string | boolean | Encoded[] | { readonly [key: string]: Encoded };
type MemberResults = Readonly<Record<string, Encoded>>;

interface Family {
  readonly className: string;
  readonly nativeValues: readonly string[];
  readonly nativeExtra: string;
  readonly make: (values?: Iterable<unknown>) => PackedArrayValue<unknown>;
  readonly values: readonly unknown[];
  readonly extra: unknown;
}

const FAMILIES: readonly Family[] = [
  {
    className: 'PackedByteArray',
    nativeValues: ['2', '1', '3'],
    nativeExtra: '4',
    make: packedByteArray,
    values: [2, 1, 3],
    extra: 4,
  },
  {
    className: 'PackedInt32Array',
    nativeValues: ['-2', '1', '3'],
    nativeExtra: '4',
    make: packedInt32Array,
    values: [-2, 1, 3],
    extra: 4,
  },
  {
    className: 'PackedInt64Array',
    nativeValues: ['-2', '1', '9223372036854775807'],
    nativeExtra: '4',
    make: packedInt64Array,
    values: [-2n, 1n, 9223372036854775807n],
    extra: 4n,
  },
  {
    className: 'PackedFloat32Array',
    nativeValues: ['2.5', '1.25', '3.75'],
    nativeExtra: '4.5',
    make: packedFloat32Array,
    values: [2.5, 1.25, 3.75],
    extra: 4.5,
  },
  {
    className: 'PackedFloat64Array',
    nativeValues: ['2.5', '1.25', '3.75'],
    nativeExtra: '4.5',
    make: packedFloat64Array,
    values: [2.5, 1.25, 3.75],
    extra: 4.5,
  },
  {
    className: 'PackedStringArray',
    nativeValues: ['"b"', '"a"', '"c"'],
    nativeExtra: '"d"',
    make: packedStringArray,
    values: ['b', 'a', 'c'],
    extra: 'd',
  },
  {
    className: 'PackedVector2Array',
    nativeValues: ['Vector2(2, 1)', 'Vector2(1, 4)', 'Vector2(3, 0)'],
    nativeExtra: 'Vector2(4, 2)',
    make: packedVector2Array,
    values: [
      { x: 2, y: 1 },
      { x: 1, y: 4 },
      { x: 3, y: 0 },
    ],
    extra: { x: 4, y: 2 },
  },
  {
    className: 'PackedVector3Array',
    nativeValues: ['Vector3(2, 1, 0)', 'Vector3(1, 4, 2)', 'Vector3(3, 0, 1)'],
    nativeExtra: 'Vector3(4, 2, 3)',
    make: packedVector3Array,
    values: [
      { x: 2, y: 1, z: 0 },
      { x: 1, y: 4, z: 2 },
      { x: 3, y: 0, z: 1 },
    ],
    extra: { x: 4, y: 2, z: 3 },
  },
  {
    className: 'PackedVector4Array',
    nativeValues: ['Vector4(2, 1, 0, 3)', 'Vector4(1, 4, 2, 0)', 'Vector4(3, 0, 1, 2)'],
    nativeExtra: 'Vector4(4, 2, 3, 1)',
    make: packedVector4Array,
    values: [
      { x: 2, y: 1, z: 0, w: 3 },
      { x: 1, y: 4, z: 2, w: 0 },
      { x: 3, y: 0, z: 1, w: 2 },
    ],
    extra: { x: 4, y: 2, z: 3, w: 1 },
  },
  {
    className: 'PackedColorArray',
    nativeValues: ['Color(1, 0, 0, 1)', 'Color(0, 1, 0, 1)', 'Color(0, 0, 1, 1)'],
    nativeExtra: 'Color(1, 1, 0, 1)',
    make: packedColorArray,
    values: [
      { r: 1, g: 0, b: 0, a: 1 },
      { r: 0, g: 1, b: 0, a: 1 },
      { r: 0, g: 0, b: 1, a: 1 },
    ],
    extra: { r: 1, g: 1, b: 0, a: 1 },
  },
];

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function encodeFloat(value: unknown): string {
  const number = Number(value);
  return Number.isInteger(number) ? `${number}.0` : String(number);
}

function encode(value: unknown): Encoded {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(15)));
  }
  if (Array.isArray(value)) return value.map(encode);
  if (value instanceof Map) {
    return Object.fromEntries([...value].map(([key, item]) => [String(key), encode(item)]));
  }
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    if ('r' in row)
      return [
        encodeFloat(row['r']),
        encodeFloat(row['g']),
        encodeFloat(row['b']),
        encodeFloat(row['a']),
      ];
    if ('w' in row)
      return [
        encodeFloat(row['x']),
        encodeFloat(row['y']),
        encodeFloat(row['z']),
        encodeFloat(row['w']),
      ];
    if ('z' in row) return [encodeFloat(row['x']), encodeFloat(row['y']), encodeFloat(row['z'])];
    if ('x' in row) return [encodeFloat(row['x']), encodeFloat(row['y'])];
  }
  throw new TypeError(`packed-array probe cannot encode ${String(value)}`);
}

function encodeElement(value: unknown, family: Family): Encoded {
  if (
    (family.className === 'PackedFloat32Array' || family.className === 'PackedFloat64Array') &&
    typeof value === 'number'
  ) {
    return encodeFloat(value);
  }
  return encode(value);
}

function encodePacked(value: readonly unknown[], family: Family): Encoded {
  return value.map((element) => encodeElement(element, family));
}

function compatResults(family: Family): MemberResults {
  const member = (name: string): string => `${family.className}.${name}`;
  const initial = (): PackedArrayValue<unknown> => family.make(family.values);
  const same = family.make(family.values);
  const different = family.make([...family.values.slice(0, -1), family.extra]);
  const append = initial();
  packedArrayAppendArray(append, append);
  const removed = initial();
  packedArrayRemoveAt(removed, 1);
  const resized = initial();
  const growResult = packedArrayResize(resized, 5);
  const grown = encodePacked(resized, family);
  const shrinkResult = packedArrayResize(resized, 2);
  const cleared = initial();
  packedArrayClear(cleared);
  const reversed = initial();
  packedArrayReverse(reversed);
  const sortedArray = initial();
  packedArraySort(sortedArray);
  const original = initial();
  const duplicate = packedArrayDuplicate(original);
  packedArrayRemoveAt(duplicate, 0);
  const right = family.make([family.extra]);
  const concatenated = packedArrayConcat(original, right);
  packedArrayRemoveAt(concatenated, 0);
  const set = initial();
  packedArraySet(set, 1, family.extra);
  const pushed = initial();
  const pushResult = packedArrayAppend(pushed, family.extra);
  const appended = initial();
  const appendResult = packedArrayAppend(appended, family.extra);
  const inserted = initial();
  const insertResult = packedArrayInsert(inserted, 1, family.extra);
  const filled = initial();
  packedArrayFill(filled, family.extra);
  const searchable = family.make([family.extra, ...family.values, family.extra]);
  const erased = initial();
  const eraseResult = packedArrayErase(erased, family.values[1]);
  const sortedSearch = initial();
  packedArraySort(sortedSearch);
  const coercion = (() => {
    if (family.className !== 'PackedInt32Array' && family.className !== 'PackedInt64Array') {
      return undefined;
    }
    const integer =
      family.className === 'PackedInt32Array'
        ? godotPackedInt(0x8000_0000)
        : godotPackedInt(0x8000_0000_0000_0000n);
    const float =
      family.className === 'PackedInt32Array'
        ? godotPackedFloat(0x8000_0000)
        : godotPackedFloat(0x8000_0000_0000_0000);
    const setInt = family.make([0]);
    const setFloat = family.make([0]);
    packedArraySet(setInt, 0, integer);
    packedArraySet(setFloat, 0, float);
    const appendInt = family.make();
    const appendFloat = family.make();
    packedArrayAppend(appendInt, integer);
    packedArrayAppend(appendFloat, float);
    return {
      set: [encodePacked(setInt, family), encodePacked(setFloat, family)] as const,
      append: [encodePacked(appendInt, family), encodePacked(appendFloat, family)] as const,
      construct: [
        encodePacked(family.make([integer]), family),
        encodePacked(family.make([float]), family),
      ] as const,
    };
  })();
  return {
    [member('get')]: encodeElement(packedArrayGet(initial(), 1), family),
    [member('set')]:
      coercion === undefined
        ? encodePacked(set, family)
        : [encodePacked(set, family), ...coercion.set],
    [member('size')]: encode(packedArraySize(initial())),
    [member('is_empty')]: [packedArrayIsEmpty(initial()), packedArrayIsEmpty(family.make())],
    [member('push_back')]: [pushResult, encodePacked(pushed, family)],
    [member('append')]: [appendResult, encodePacked(appended, family), ...(coercion?.append ?? [])],
    [member('append_array')]: encodePacked(append, family),
    [member('remove_at')]: encodePacked(removed, family),
    [member('insert')]: [encode(insertResult), encodePacked(inserted, family)],
    [member('fill')]: encodePacked(filled, family),
    [member('resize')]: [
      encode(growResult),
      grown,
      encode(shrinkResult),
      encodePacked(resized, family),
    ],
    [member('clear')]: encodePacked(cleared, family),
    [member('has')]: [
      packedArrayHas(initial(), family.values[1]),
      packedArrayHas(initial(), family.extra),
    ],
    [member('reverse')]: encodePacked(reversed, family),
    [member('slice')]: encodePacked(packedArraySlice(initial(), 1, -1), family),
    [member('sort')]: encodePacked(sortedArray, family),
    [member('bsearch')]: [
      packedArrayBsearch(sortedSearch, sortedSearch[1], true),
      packedArrayBsearch(sortedSearch, sortedSearch[1], false),
    ].map(encode),
    [member('duplicate')]: [encodePacked(original, family), encodePacked(duplicate, family)],
    [member('find')]: encode(packedArrayFind(searchable, family.extra)),
    [member('rfind')]: encode(packedArrayRfind(searchable, family.extra)),
    [member('count')]: encode(packedArrayCount(searchable, family.extra)),
    [member('erase')]: [eraseResult, encodePacked(erased, family)],
    [member('new')]: [
      encodePacked(family.make(), family),
      encodePacked(family.make(original), family),
      ...(coercion?.construct ?? []),
    ],
    [member('operator ==')]: [
      packedArrayEquals(original, same),
      packedArrayEquals(original, different),
    ],
    [member('operator !=')]: [
      !packedArrayEquals(original, same),
      !packedArrayEquals(original, different),
    ],
    [member('operator +')]: [
      encodePacked(concatenated, family),
      encodePacked(original, family),
      encodePacked(right, family),
    ],
    [member('operator in')]: [
      packedArrayIn(original, [same]),
      packedArrayIn(original, [different]),
    ],
    [member('operator not')]: [packedArrayIsEmpty(family.make()), packedArrayIsEmpty(original)],
    ...(family.className === 'PackedByteArray'
      ? {}
      : {
          [member('to_byte_array')]: packedArrayToByteArray(original)
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join(''),
        }),
    ...(family.className === 'PackedVector2Array'
      ? {
          [member('operator *')]: encodePacked(
            packedArrayTransformInverse(original as never, {
              x: { x: 0, y: 1 },
              y: { x: -1, y: 0 },
              origin: { x: 2, y: 3 },
            }) as PackedArrayValue<unknown>,
            family,
          ),
        }
      : family.className === 'PackedVector3Array'
        ? {
            [member('operator *')]: encodePacked(
              packedArrayTransformInverse(original as never, {
                basis: [
                  { x: 0, y: 1, z: 0 },
                  { x: -1, y: 0, z: 0 },
                  { x: 0, y: 0, z: 1 },
                ],
                origin: { x: 2, y: 3, z: 4 },
              }) as PackedArrayValue<unknown>,
              family,
            ),
          }
        : {}),
  };
}

function nativeFamilyBlock(family: Family, index: number): string {
  const ctor = (values: readonly string[] = family.nativeValues): string =>
    `${family.className}([${values.join(', ')}])`;
  const key = (member: string): string => JSON.stringify(`${family.className}.${member}`);
  const coercion =
    family.className === 'PackedInt32Array' || family.className === 'PackedInt64Array';
  const edgeInteger = family.className === 'PackedInt32Array' ? '2147483648' : 'edge_int_64';
  const edgeFloat =
    family.className === 'PackedInt32Array' ? '2147483648.0' : '9223372036854775808.0';
  const coercionSetup = !coercion
    ? ''
    : `${family.className === 'PackedInt64Array' ? `\n\tvar edge_int_64: int = 9223372036854775807\n\tedge_int_64 += 1` : ''}
\tvar edge_set_int_${index} := ${ctor(['0'])}
\tedge_set_int_${index}.set(0, ${edgeInteger})
\tvar edge_set_float_${index} := ${ctor(['0'])}
\tedge_set_float_${index}.set(0, ${edgeFloat})
\tvar edge_append_int_${index} := ${family.className}()
\tedge_append_int_${index}.append(${edgeInteger})
\tvar edge_append_float_${index} := ${family.className}()
\tedge_append_float_${index}.append(${edgeFloat})`;
  const setEvidence = coercion
    ? `[_encode(set_${index}), _encode(edge_set_int_${index}), _encode(edge_set_float_${index})]`
    : `_encode(set_${index})`;
  const appendEvidence = coercion
    ? `[append_result_${index}, _encode(appended_${index}), _encode(edge_append_int_${index}), _encode(edge_append_float_${index})]`
    : `[append_result_${index}, _encode(appended_${index})]`;
  const constructorEvidence = coercion
    ? `[_encode(${family.className}()), _encode(${family.className}(original_${index})), _encode(${family.className}([${edgeInteger}])), _encode(${family.className}([${edgeFloat}]))]`
    : `[_encode(${family.className}()), _encode(${family.className}(original_${index}))]`;
  return `
\tvar initial_${index} := ${ctor()}
\tvar same_${index} := ${ctor()}
\tvar different_${index} := ${ctor([...family.nativeValues.slice(0, -1), family.nativeExtra])}
\tvar append_${index} := ${ctor()}
\tappend_${index}.append_array(append_${index})
\tvar removed_${index} := ${ctor()}
\tremoved_${index}.remove_at(1)
\tvar resized_${index} := ${ctor()}
\tvar grow_${index}: int = resized_${index}.resize(5)
\tvar grown_${index}: Variant = _encode(resized_${index})
\tvar shrink_${index}: int = resized_${index}.resize(2)
\tvar cleared_${index} := ${ctor()}
\tcleared_${index}.clear()
\tvar reversed_${index} := ${ctor()}
\treversed_${index}.reverse()
\tvar sorted_${index} := ${ctor()}
\tsorted_${index}.sort()
\tvar original_${index} := ${ctor()}
\tvar duplicate_${index}: ${family.className} = original_${index}.duplicate()
\tduplicate_${index}.remove_at(0)
\tvar right_${index} := ${ctor([family.nativeExtra])}
\tvar concatenated_${index}: ${family.className} = original_${index} + right_${index}
\tconcatenated_${index}.remove_at(0)
\tvar set_${index} := ${ctor()}
\tset_${index}.set(1, ${family.nativeExtra})
\tvar pushed_${index} := ${ctor()}
\tvar push_result_${index}: bool = pushed_${index}.push_back(${family.nativeExtra})
\tvar appended_${index} := ${ctor()}
\tvar append_result_${index}: bool = appended_${index}.append(${family.nativeExtra})
\tvar inserted_${index} := ${ctor()}
\tvar insert_result_${index}: int = inserted_${index}.insert(1, ${family.nativeExtra})
\tvar filled_${index} := ${ctor()}
\tfilled_${index}.fill(${family.nativeExtra})
\tvar searchable_${index} := ${ctor([family.nativeExtra, ...family.nativeValues, family.nativeExtra])}
\tvar erased_${index} := ${ctor()}
\tvar erase_result_${index}: bool = erased_${index}.erase(${family.nativeValues[1]})
\tvar sorted_search_${index} := ${ctor()}
\tsorted_search_${index}.sort()
${coercionSetup}
\tout[${key('get')}] = _encode(initial_${index}.get(1))
\tout[${key('set')}] = ${setEvidence}
\tout[${key('size')}] = _encode(initial_${index}.size())
\tout[${key('is_empty')}] = [initial_${index}.is_empty(), ${family.className}().is_empty()]
\tout[${key('push_back')}] = [push_result_${index}, _encode(pushed_${index})]
\tout[${key('append')}] = ${appendEvidence}
\tout[${key('append_array')}] = _encode(append_${index})
\tout[${key('remove_at')}] = _encode(removed_${index})
\tout[${key('insert')}] = [_encode(insert_result_${index}), _encode(inserted_${index})]
\tout[${key('fill')}] = _encode(filled_${index})
\tout[${key('resize')}] = [_encode(grow_${index}), grown_${index}, _encode(shrink_${index}), _encode(resized_${index})]
\tout[${key('clear')}] = _encode(cleared_${index})
\tout[${key('has')}] = [initial_${index}.has(${family.nativeValues[1]}), initial_${index}.has(${family.nativeExtra})]
\tout[${key('reverse')}] = _encode(reversed_${index})
\tout[${key('slice')}] = _encode(initial_${index}.slice(1, -1))
\tout[${key('sort')}] = _encode(sorted_${index})
\tout[${key('bsearch')}] = [_encode(sorted_search_${index}.bsearch(sorted_search_${index}[1], true)), _encode(sorted_search_${index}.bsearch(sorted_search_${index}[1], false))]
\tout[${key('duplicate')}] = [_encode(original_${index}), _encode(duplicate_${index})]
\tout[${key('find')}] = _encode(searchable_${index}.find(${family.nativeExtra}))
\tout[${key('rfind')}] = _encode(searchable_${index}.rfind(${family.nativeExtra}))
\tout[${key('count')}] = _encode(searchable_${index}.count(${family.nativeExtra}))
\tout[${key('erase')}] = [erase_result_${index}, _encode(erased_${index})]
\tout[${key('new')}] = ${constructorEvidence}
\tout[${key('operator ==')}] = [original_${index} == same_${index}, original_${index} == different_${index}]
\tout[${key('operator !=')}] = [original_${index} != same_${index}, original_${index} != different_${index}]
\tout[${key('operator +')}] = [_encode(concatenated_${index}), _encode(original_${index}), _encode(right_${index})]
\tout[${key('operator in')}] = [original_${index} in [same_${index}], original_${index} in [different_${index}]]
\tout[${key('operator not')}] = [not ${family.className}(), not original_${index}]
${family.className === 'PackedByteArray' ? '' : `\tout[${key('to_byte_array')}] = original_${index}.to_byte_array().hex_encode()\n`}
${
  family.className === 'PackedVector2Array'
    ? `\tout[${key('operator *')}] = _encode(original_${index} * Transform2D(Vector2(0, 1), Vector2(-1, 0), Vector2(2, 3)))\n`
    : family.className === 'PackedVector3Array'
      ? `\tout[${key('operator *')}] = _encode(original_${index} * Transform3D(Basis(Vector3(0, 1, 0), Vector3(-1, 0, 0), Vector3(0, 0, 1)), Vector3(2, 3, 4)))\n`
      : ''
}
`;
}

const BYTE_FAMILY = FAMILIES[0] as Family;
const byteResult = (value: PackedArrayValue<unknown>): Encoded => encodePacked(value, BYTE_FAMILY);

async function loadProbeCodecs(): Promise<GodotPackedArrayCodecs> {
  const zstd = await Zstd.load();
  return {
    compress(mode, source) {
      if (mode === 0) {
        return fastLzCompress(source);
      }
      if (mode === 1) return deflate(source);
      if (mode === 2) return zstd.compress(source);
      if (mode === 3) return gzip(source);
      return null;
    },
    decompress(mode, source, expectedSize, maxOutputSize) {
      let result: Uint8Array;
      if (mode === 0) {
        const capacity = expectedSize < 16 ? 16 : expectedSize;
        const decoded = fastLzDecompress(source, capacity);
        if (decoded === null) return null;
        result = decoded;
      } else if (mode === 1) result = inflate(source);
      else if (mode === 2) result = zstd.decompress(source);
      else if (mode === 3) result = ungzip(source);
      else if (mode === 4) result = brotliDecompressSync(source);
      else return null;
      if (expectedSize >= 0 && result.length !== expectedSize) return null;
      if (maxOutputSize !== undefined && result.length > maxOutputSize) return null;
      return result;
    },
  };
}

function compatByteExtraResults(
  codecs: GodotPackedArrayCodecs,
  brotliBytes: Uint8Array,
): MemberResults {
  const key = (name: string): string => `PackedByteArray.${name}`;
  const call = <T>(
    name: string,
    value: PackedArrayValue<number>,
    args: readonly unknown[] = [],
  ): T => godotPackedByteArrayCall<T>(name, value, args, codecs);
  const payload = packedByteArray(Array.from({ length: 40 }, (_, index) => index % 7));
  const compressed = [0, 1, 2, 3].map((mode) =>
    call<PackedArrayValue<number>>('compress', payload, [mode]),
  );
  const primitive: Record<string, Encoded> = {};
  for (const [suffix, bits, signed] of [
    ['u8', 8, false],
    ['s8', 8, true],
    ['u16', 16, false],
    ['s16', 16, true],
    ['u32', 32, false],
    ['s32', 32, true],
    ['u64', 64, false],
    ['s64', 64, true],
  ] as const) {
    const target = packedByteArray(new Array(8).fill(0));
    const input = bits === 64 ? 0x1234_5678_9abc_def0n : signed ? -123 : 0xabc;
    call(`encode_${suffix}`, target, [0, input]);
    primitive[key(`encode_${suffix}`)] = byteResult(target);
    primitive[key(`decode_${suffix}`)] = encode(call(`decode_${suffix}`, target, [0]));
  }
  for (const [suffix, input] of [
    ['half', 1.5],
    ['float', 1.25],
    ['double', Math.PI],
  ] as const) {
    const target = packedByteArray(new Array(8).fill(0));
    call(`encode_${suffix}`, target, [0, input]);
    primitive[key(`encode_${suffix}`)] = byteResult(target);
    primitive[key(`decode_${suffix}`)] = encode(call(`decode_${suffix}`, target, [0]));
  }
  const variant = packedByteArray(new Array(256).fill(0));
  const variantValue = new Map<unknown, unknown>([
    ['name', 'packed'],
    ['values', [1, 2.5, true]],
  ]);
  const encodedLength = call<number>('encode_var', variant, [0, variantValue, false]);
  const encodedVariant = packedByteArray(variant.slice(0, encodedLength));
  const swaps: Record<string, Encoded> = {};
  for (const width of [2, 4, 8] as const) {
    const target = packedByteArray(Array.from({ length: 16 }, (_, index) => index));
    call(`bswap${width * 8}`, target, [0, 2]);
    swaps[key(`bswap${width * 8}`)] = byteResult(target);
  }
  const rawArrays = {
    to_int32_array: packedArrayToByteArray(packedInt32Array([-2, 7])),
    to_int64_array: packedArrayToByteArray(packedInt64Array([-2n, 7n])),
    to_float32_array: packedArrayToByteArray(packedFloat32Array([1.25, -2.5])),
    to_float64_array: packedArrayToByteArray(packedFloat64Array([1.25, -2.5])),
    to_vector2_array: packedArrayToByteArray(packedVector2Array([{ x: 1, y: 2 }])),
    to_vector3_array: packedArrayToByteArray(packedVector3Array([{ x: 1, y: 2, z: 3 }])),
    to_vector4_array: packedArrayToByteArray(packedVector4Array([{ x: 1, y: 2, z: 3, w: 4 }])),
    to_color_array: packedArrayToByteArray(packedColorArray([{ r: 1, g: 0.5, b: 0.25, a: 1 }])),
  } as const;
  return {
    [key('get_string_from_ascii')]: call('get_string_from_ascii', packedByteArray([65, 66, 67])),
    [key('get_string_from_utf8')]: call(
      'get_string_from_utf8',
      packedByteArray([0x41, 0xc3, 0xa9]),
    ),
    [key('get_string_from_utf16')]: call(
      'get_string_from_utf16',
      packedByteArray([0x41, 0, 0xe9, 0]),
    ),
    [key('get_string_from_utf32')]: call(
      'get_string_from_utf32',
      packedByteArray([0x41, 0, 0, 0, 0xe9, 0, 0, 0]),
    ),
    [key('get_string_from_wchar')]: call(
      'get_string_from_wchar',
      packedByteArray([0x41, 0, 0, 0, 0xe9, 0, 0, 0]),
    ),
    [key('get_string_from_multibyte_char')]: call(
      'get_string_from_multibyte_char',
      packedByteArray([0x41, 0xc3, 0xa9]),
      ['utf-8'],
    ),
    [key('hex_encode')]: call('hex_encode', packedByteArray([0, 15, 16, 255])),
    [key('compress')]: compressed.map(byteResult),
    [key('decompress')]: compressed.map((item, mode) =>
      byteResult(call('decompress', item, [40, mode])),
    ),
    [key('decompress_dynamic')]: [
      byteResult(call('decompress_dynamic', compressed[1] as PackedArrayValue<number>, [100, 1])),
      byteResult(call('decompress_dynamic', compressed[3] as PackedArrayValue<number>, [100, 3])),
      byteResult(call('decompress_dynamic', packedByteArray(brotliBytes), [100, 4])),
    ],
    ...primitive,
    [key('has_encoded_var')]: call('has_encoded_var', encodedVariant, [0, false]),
    [key('decode_var')]: encode(call('decode_var', encodedVariant, [0, false])),
    [key('decode_var_size')]: encode(call('decode_var_size', encodedVariant, [0, false])),
    [key('encode_var')]: [encode(encodedLength), byteResult(encodedVariant)],
    ...Object.fromEntries(
      Object.entries(rawArrays).map(([name, raw]) => [key(name), encode(call(name, raw))]),
    ),
    ...swaps,
  };
}

function nativeByteExtraBlock(brotliBytes: Uint8Array): string {
  const key = (member: string): string => JSON.stringify(`PackedByteArray.${member}`);
  const primitives = [
    ['u8', '0xabc'],
    ['s8', '-123'],
    ['u16', '0xabc'],
    ['s16', '-123'],
    ['u32', '0xabc'],
    ['s32', '-123'],
    ['u64', '0x123456789abcdef0'],
    ['s64', '0x123456789abcdef0'],
    ['half', '1.5'],
    ['float', '1.25'],
    ['double', 'PI'],
  ] as const;
  const primitiveBlocks = primitives
    .map(
      ([suffix, input], index) => `
\tvar primitive_${index} := PackedByteArray()
\tprimitive_${index}.resize(8)
\tprimitive_${index}.encode_${suffix}(0, ${input})
\tout[${key(`encode_${suffix}`)}] = _encode(primitive_${index})
\tout[${key(`decode_${suffix}`)}] = _encode(primitive_${index}.decode_${suffix}(0))`,
    )
    .join('');
  const conversions = [
    ['to_int32_array', 'PackedInt32Array([-2, 7]).to_byte_array()'],
    ['to_int64_array', 'PackedInt64Array([-2, 7]).to_byte_array()'],
    ['to_float32_array', 'PackedFloat32Array([1.25, -2.5]).to_byte_array()'],
    ['to_float64_array', 'PackedFloat64Array([1.25, -2.5]).to_byte_array()'],
    ['to_vector2_array', 'PackedVector2Array([Vector2(1, 2)]).to_byte_array()'],
    ['to_vector3_array', 'PackedVector3Array([Vector3(1, 2, 3)]).to_byte_array()'],
    ['to_vector4_array', 'PackedVector4Array([Vector4(1, 2, 3, 4)]).to_byte_array()'],
    ['to_color_array', 'PackedColorArray([Color(1, 0.5, 0.25, 1)]).to_byte_array()'],
  ] as const;
  return `
\tout[${key('get_string_from_ascii')}] = PackedByteArray([65, 66, 67]).get_string_from_ascii()
\tout[${key('get_string_from_utf8')}] = PackedByteArray([0x41, 0xc3, 0xa9]).get_string_from_utf8()
\tout[${key('get_string_from_utf16')}] = PackedByteArray([0x41, 0, 0xe9, 0]).get_string_from_utf16()
\tout[${key('get_string_from_utf32')}] = PackedByteArray([0x41, 0, 0, 0, 0xe9, 0, 0, 0]).get_string_from_utf32()
\tout[${key('get_string_from_wchar')}] = PackedByteArray([0x41, 0, 0, 0, 0xe9, 0, 0, 0]).get_string_from_wchar()
\tout[${key('get_string_from_multibyte_char')}] = PackedByteArray([0x41, 0xc3, 0xa9]).get_string_from_multibyte_char("utf-8")
\tout[${key('hex_encode')}] = PackedByteArray([0, 15, 16, 255]).hex_encode()
\tvar payload := PackedByteArray()
\tfor i in range(40): payload.append(i % 7)
\tvar compressed: Array[PackedByteArray] = []
\tfor mode in range(4): compressed.append(payload.compress(mode))
\tout[${key('compress')}] = _encode(compressed)
\tvar decompressed: Array = []
\tfor mode in range(4): decompressed.append(_encode(compressed[mode].decompress(40, mode)))
\tout[${key('decompress')}] = decompressed
\tout[${key('decompress_dynamic')}] = [_encode(compressed[1].decompress_dynamic(100, 1)), _encode(compressed[3].decompress_dynamic(100, 3)), _encode(PackedByteArray([${[...brotliBytes].join(',')}]).decompress_dynamic(100, 4))]
${primitiveBlocks}
\tvar encoded_variant := PackedByteArray()
\tencoded_variant.resize(256)
\tvar encoded_length := encoded_variant.encode_var(0, {"name": "packed", "values": [1, 2.5, true]}, false)
\tencoded_variant.resize(encoded_length)
\tout[${key('has_encoded_var')}] = encoded_variant.has_encoded_var(0, false)
\tout[${key('decode_var')}] = _encode(encoded_variant.decode_var(0, false))
\tout[${key('decode_var_size')}] = _encode(encoded_variant.decode_var_size(0, false))
\tout[${key('encode_var')}] = [_encode(encoded_length), _encode(encoded_variant)]
${conversions.map(([name, source]) => `\tout[${key(name)}] = _encode((${source}).${name}())`).join('\n')}
\tvar swap16 := PackedByteArray(range(16)); swap16.bswap16(0, 2); out[${key('bswap16')}] = _encode(swap16)
\tvar swap32 := PackedByteArray(range(16)); swap32.bswap32(0, 2); out[${key('bswap32')}] = _encode(swap32)
\tvar swap64 := PackedByteArray(range(16)); swap64.bswap64(0, 2); out[${key('bswap64')}] = _encode(swap64)
`;
}

function nativeScript(brotliBytes: Uint8Array): string {
  return `extends SceneTree

func _encode(value: Variant) -> Variant:
\tmatch typeof(value):
\t\tTYPE_NIL:
\t\t\treturn "null"
\t\tTYPE_BOOL, TYPE_STRING:
\t\t\treturn value
\t\tTYPE_INT, TYPE_FLOAT:
\t\t\treturn str(value)
\t\tTYPE_VECTOR2:
\t\t\treturn [str(value.x), str(value.y)]
\t\tTYPE_VECTOR3:
\t\t\treturn [str(value.x), str(value.y), str(value.z)]
\t\tTYPE_VECTOR4:
\t\t\treturn [str(value.x), str(value.y), str(value.z), str(value.w)]
\t\tTYPE_COLOR:
\t\t\treturn [str(value.r), str(value.g), str(value.b), str(value.a)]
\t\tTYPE_ARRAY:
\t\t\tvar encoded_array: Array = []
\t\t\tfor item in value:
\t\t\t\tencoded_array.append(_encode(item))
\t\t\treturn encoded_array
\t\tTYPE_DICTIONARY:
\t\t\tvar encoded_dictionary: Dictionary = {}
\t\t\tfor key in value:
\t\t\t\tencoded_dictionary[str(key)] = _encode(value[key])
\t\t\treturn encoded_dictionary
\t\tTYPE_PACKED_BYTE_ARRAY, TYPE_PACKED_INT32_ARRAY, TYPE_PACKED_INT64_ARRAY, TYPE_PACKED_FLOAT32_ARRAY, TYPE_PACKED_FLOAT64_ARRAY, TYPE_PACKED_STRING_ARRAY, TYPE_PACKED_VECTOR2_ARRAY, TYPE_PACKED_VECTOR3_ARRAY, TYPE_PACKED_VECTOR4_ARRAY, TYPE_PACKED_COLOR_ARRAY:
\t\t\tvar encoded: Array = []
\t\t\tfor item in value:
\t\t\t\tencoded.append(_encode(item))
\t\t\treturn encoded
\tpush_error("packed-array probe cannot encode type %s" % typeof(value))
\tquit(3)
\treturn null

func _init() -> void:
\tvar out: Dictionary = {}
${FAMILIES.map(nativeFamilyBlock).join('')}
${nativeByteExtraBlock(brotliBytes)}
\tprint(${JSON.stringify(OUTPUT_MARKER)} + JSON.stringify(out))
\tquit()
`;
}

function runNative(binary: string, source: string): MemberResults {
  const root = mkdtempSync(join(tmpdir(), 'vgai-godot-packed-array-proof-'));
  try {
    writeFileSync(join(root, 'project.godot'), '[application]\nconfig/name="Packed array proof"\n');
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

function sorted(value: MemberResults): MemberResults {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function main(): Promise<void> {
  const binary = process.argv[2];
  if (binary === undefined)
    throw new Error('native-packed-array-probe needs an official Godot binary');
  const executableSha256 = sha256(readFileSync(binary));
  if (executableSha256 !== OFFICIAL_EXECUTABLE_SHA256) {
    throw new Error(
      `official executable mismatch: expected ${OFFICIAL_EXECUTABLE_SHA256}, got ${executableSha256}`,
    );
  }
  const codecs = await loadProbeCodecs();
  const payload = Uint8Array.from({ length: 40 }, (_, index) => index % 7);
  const brotliBytes = brotliCompressSync(payload);
  const source = nativeScript(brotliBytes);
  const official = sorted(runNative(binary, source));
  const compat = sorted(
    Object.assign(
      {},
      ...FAMILIES.map(compatResults),
      compatByteExtraResults(codecs, brotliBytes),
    ) as MemberResults,
  );
  if (JSON.stringify(official) !== JSON.stringify(compat)) {
    const keys = [...new Set([...Object.keys(official), ...Object.keys(compat)])].sort();
    const mismatch = keys.find(
      (key) => JSON.stringify(official[key]) !== JSON.stringify(compat[key]),
    );
    throw new Error(
      `packed-array differential mismatch at ${mismatch ?? '<unknown>'}: official=${JSON.stringify(mismatch === undefined ? official : official[mismatch])} compat=${JSON.stringify(mismatch === undefined ? compat : compat[mismatch])}`,
    );
  }
  const evidence = {
    protocol: 'vgai.godot-packed-array-evidence',
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
  process.stdout.write(
    `packed-array native differential: PASS — ${evidence.memberCount} exact members, evidence ${EVIDENCE_PATH}\n`,
  );
}

void main();
