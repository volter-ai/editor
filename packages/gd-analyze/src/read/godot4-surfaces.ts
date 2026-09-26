/**
 * read/godot4-surfaces.ts — a Godot **4** `ArrayMesh`'s `_surfaces` array → the SAME
 * {@link ArrayMeshSurface} the Godot 3 decoder in `array-mesh.ts` yields.
 *
 * ## Why this is a second decoder and not a key rename
 *
 * Godot 3 writes one numbered property per surface (`surfaces/0 = { "array_data": … }`) holding a
 * single INTERLEAVED vertex buffer. Godot 4 writes ONE `_surfaces` array of dictionaries, and the
 * bytes inside are laid out differently in every respect that matters:
 *
 *   - the vertex buffer is **two blocks, not interleaved** — every position first, then every
 *     normal/tangent — so a reader that walked one stride per vertex would read normals as
 *     positions;
 *   - UVs and colours live in a SEPARATE buffer (`attribute_data`), and bones/weights in a third
 *     (`skin_data`);
 *   - normals are octahedral in a `uint32` *always* (Godot 3 made that an opt-in format bit);
 *   - under `ARRAY_FLAG_COMPRESS_ATTRIBUTES` a position is four `uint16`s normalized into the
 *     surface's own `aabb`, and the fourth is not padding — it is the tangent frame's ANGLE, which
 *     combines with the normal slot's octahedral AXIS to rebuild both normal and tangent.
 *
 * So this file is what `scene-module-3d.ts` used to refuse by name ("a decoder that has to be
 * written rather than a key to alias"). It produces `ArrayMeshSurface`, which is the whole point:
 * every consumer downstream — the single/multi-surface emitters, the skinning gate, the surface
 * material lookup, the external-`.res` path — keeps working without learning that a second
 * serialization exists.
 *
 * ## Ground truth
 *
 * Every structure below cites `godotengine/godot` at tag **`4.7-stable`**, commit
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88` — the same pin
 * `vendor/extension-api/godot-4.7-extension_api.json` was generated from. Nothing here is inferred
 * from a hexdump.
 *
 *   - `servers/rendering/rendering_server_enums.h` — `ArrayType` (:127-140), `ArrayFormat`
 *     (:161-202) and `PrimitiveType` (:208-213).
 *   - `servers/rendering/rendering_server.cpp` —
 *     `RenderingServer::mesh_surface_make_offsets_from_format` (:1055) is the LAYOUT, and
 *     `RenderingServer::_get_array_from_surface` (:1404) is the DECODE. Both are transcribed
 *     statement for statement.
 *   - `servers/rendering/rendering_server.cpp:343` — `_get_tbn_from_axis_angle`, the compressed
 *     path's normal+tangent reconstruction.
 *   - `core/math/vector3.cpp:106,123` — `Vector3::octahedron_decode` and
 *     `Vector3::octahedron_tangent_decode`.
 *   - `core/math/basis.cpp:841` — `Basis::set_axis_angle`, which the TBN reconstruction rotates by.
 *   - `scene/resources/mesh.cpp:1587` — `ArrayMesh::_set_surfaces`, which is where the legal key
 *     set below comes from.
 *
 * ### The layout, cross-checked against the fixtures' own byte counts
 *
 * `mesh_surface_make_offsets_from_format` is not a formula anyone should trust unmeasured, so it
 * was checked against all four surfaces the vendored fixtures actually ship, whose buffer lengths
 * are facts on disk rather than a claim:
 *
 * | surface | flags | `vertex_data` | `attribute_data` |
 * | --- | --- | --- | --- |
 * | `meshes/brick.res` shadow | compressed, VERTEX\|INDEX | 24 × 8 = 192 B | — |
 * | `meshes/brick.res` main | compressed, +NORMAL\|TANGENT\|TEX_UV | 96 × (8+4) = 1152 B | 96 × 4 = 384 B |
 * | `meshes/dust.res` shadow | plain, VERTEX\|INDEX | 154 × 12 = 1848 B | — |
 * | `meshes/dust.res` main | plain, +NORMAL\|TANGENT\|TEX_UV | 942 × (12+8) = 18840 B | 942 × 8 = 7536 B |
 *
 * Every one matches the byte length on disk exactly. Note the compressed TANGENT contributes
 * **zero** bytes of its own (`elem_size = (COMPRESS) ? 0 : 4`) because it rides in the position's
 * fourth `uint16`, and that the compressed position element is `2 * sizeof(float)` = 8 bytes rather
 * than the 6 its three `uint16`s occupy — with NORMAL present the spare two bytes are the angle,
 * and without it they are genuinely unread.
 *
 * ## Enumerate and refuse, never skip
 *
 * The anti-shim rule applies with full force to geometry: a mesh decoded with the wrong stride
 * still renders, as a cloud of triangles nobody authored. So an array this decoder has not been
 * measured against — a custom channel, 2D vertices, 8-bone weights — REFUSES by name and by format
 * bit rather than being skipped, and an unrecognized surface key refuses against
 * `ArrayMesh::_set_surfaces`'s own list.
 */
import type { GodotValue } from './godot-value';
import { ArrayMeshDecodeError, ARRAY_MESH_PRIMITIVE, type ArrayMeshSurface } from './array-mesh';

// ------------------------------------------------------------------------------------------
// The enums — `servers/rendering/rendering_server_enums.h` at `4.7-stable`
// ------------------------------------------------------------------------------------------

/** `ArrayType`, :127-140. The INDEX of each array, which is also its format bit's shift. */
const ARRAY_VERTEX = 0;
const ARRAY_NORMAL = 1;
const ARRAY_TANGENT = 2;
const ARRAY_COLOR = 3;
const ARRAY_TEX_UV = 4;
const ARRAY_TEX_UV2 = 5;
// ARRAY_CUSTOM0..3 are 6-9. They have no constant here because nothing branches on them: a custom
// channel falls into `computeSurfaceLayout`'s `default`, which refuses by name from ARRAY_NAMES.
const ARRAY_BONES = 10;
const ARRAY_WEIGHTS = 11;
const ARRAY_INDEX = 12;
const ARRAY_MAX = 13;

/** For a refusal that names the array in Godot's own spelling rather than by number. */
const ARRAY_NAMES: readonly string[] = [
  'ARRAY_VERTEX',
  'ARRAY_NORMAL',
  'ARRAY_TANGENT',
  'ARRAY_COLOR',
  'ARRAY_TEX_UV',
  'ARRAY_TEX_UV2',
  'ARRAY_CUSTOM0',
  'ARRAY_CUSTOM1',
  'ARRAY_CUSTOM2',
  'ARRAY_CUSTOM3',
  'ARRAY_BONES',
  'ARRAY_WEIGHTS',
  'ARRAY_INDEX',
];

/**
 * `ArrayFormat`'s flag block, :185-202. These live above bit 31, so they are `bigint` throughout:
 * JavaScript's bitwise operators truncate to 32 bits, and `format & (1 << 35)` silently tests bit 3
 * instead — which would read every compressed mesh as uncompressed and every surface as the wrong
 * stride. The whole format is therefore handled as a `bigint`.
 */
const ARRAY_COMPRESS_FLAGS_BASE = 25n; // = (ARRAY_INDEX + 1 + 12)
const ARRAY_FLAG_USE_2D_VERTICES = 1n << (ARRAY_COMPRESS_FLAGS_BASE + 0n);
const ARRAY_FLAG_USE_DYNAMIC_UPDATE = 1n << (ARRAY_COMPRESS_FLAGS_BASE + 1n);
const ARRAY_FLAG_USE_8_BONE_WEIGHTS = 1n << (ARRAY_COMPRESS_FLAGS_BASE + 2n);
const ARRAY_FLAG_USES_EMPTY_VERTEX_ARRAY = 1n << (ARRAY_COMPRESS_FLAGS_BASE + 3n);
const ARRAY_FLAG_COMPRESS_ATTRIBUTES = 1n << (ARRAY_COMPRESS_FLAGS_BASE + 4n);
/** :196-202 — the format's own version, 8 bits at shift 35. `ARRAY_FLAG_FORMAT_VERSION_2` is
 *  `ARRAY_FLAG_FORMAT_CURRENT_VERSION` at this pin; version 1 is the pre-4.2 layout, which packed
 *  vertices differently and is refused rather than read with these strides. */
const ARRAY_FLAG_FORMAT_VERSION_SHIFT = ARRAY_COMPRESS_FLAGS_BASE + 10n; // 35
const ARRAY_FLAG_FORMAT_VERSION_MASK = 0xffn;
/**
 * The FIELD VALUE that spells Godot's `ARRAY_FLAG_FORMAT_VERSION_2`, which is off by one from the
 * name: the enum is `VERSION_1 = 0` and `VERSION_2 = 1ULL << SHIFT`, so the 8-bit field reads 0 for
 * version 1 and 1 for version 2. Naming the field value rather than reusing the shifted constant is
 * what keeps that visible — a describer that printed the raw field would call this file's own
 * fixtures "FORMAT_VERSION_1" while refusing anything that was not version 2.
 */
const FORMAT_VERSION_2_FIELD_VALUE = 1n;

/** Every bit `ArrayFormat` defines at this pin. Anything else means a format never measured. */
const KNOWN_FORMAT_BITS: bigint = (() => {
  let bits = 0n;
  for (let i = 0; i < ARRAY_MAX; i++) bits |= 1n << BigInt(i);
  // The four 3-bit custom-format fields, `ARRAY_FORMAT_CUSTOM_BASE = ARRAY_INDEX + 1` (:177-183).
  bits |= 0xfffn << 13n;
  bits |=
    ARRAY_FLAG_USE_2D_VERTICES |
    ARRAY_FLAG_USE_DYNAMIC_UPDATE |
    ARRAY_FLAG_USE_8_BONE_WEIGHTS |
    ARRAY_FLAG_USES_EMPTY_VERTEX_ARRAY |
    ARRAY_FLAG_COMPRESS_ATTRIBUTES;
  bits |= ARRAY_FLAG_FORMAT_VERSION_MASK << ARRAY_FLAG_FORMAT_VERSION_SHIFT;
  return bits;
})();

/**
 * A Godot 4 format word in Godot 4's OWN flag names.
 *
 * This exists because `describeArrayMeshFormat` reads the same bits under Godot 3.6's `ArrayFormat`,
 * and the two disagree about most of them — 3.6's bits 9-17 are its COMPRESS block, where 4.7 puts
 * `ARRAY_FORMAT_INDEX` (bit 12) and the custom-format fields. Describing a Godot 4 surface with the
 * Godot 3 names produced `VERTEX|NORMAL|TANGENT|TEX_UV|COMPRESS_COLOR|<unknown bits 0x20000000>`
 * for a surface that is really `VERTEX|NORMAL|TANGENT|TEX_UV|INDEX|COMPRESS_ATTRIBUTES` — an
 * emitted provenance note asserting the wrong thing about the bytes it came from.
 */
export function describeGodot4ArrayMeshFormat(format: number): string {
  const bits = BigInt(format);
  const names: string[] = [];
  for (let i = 0; i < ARRAY_MAX; i++) {
    if ((bits & (1n << BigInt(i))) !== 0n) names.push(`${ARRAY_NAMES[i] ?? `ARRAY_${i}`}`);
  }
  const flags: readonly (readonly [string, bigint])[] = [
    ['USE_2D_VERTICES', ARRAY_FLAG_USE_2D_VERTICES],
    ['USE_DYNAMIC_UPDATE', ARRAY_FLAG_USE_DYNAMIC_UPDATE],
    ['USE_8_BONE_WEIGHTS', ARRAY_FLAG_USE_8_BONE_WEIGHTS],
    ['USES_EMPTY_VERTEX_ARRAY', ARRAY_FLAG_USES_EMPTY_VERTEX_ARRAY],
    ['COMPRESS_ATTRIBUTES', ARRAY_FLAG_COMPRESS_ATTRIBUTES],
  ];
  for (const [name, mask] of flags) if ((bits & mask) !== 0n) names.push(name);
  const version = (bits >> ARRAY_FLAG_FORMAT_VERSION_SHIFT) & ARRAY_FLAG_FORMAT_VERSION_MASK;
  // `+ 1n` because the field value is one less than the version's NAME — see
  // {@link FORMAT_VERSION_2_FIELD_VALUE}.
  names.push(`FORMAT_VERSION_${version + 1n}`);
  const unknown = bits & ~KNOWN_FORMAT_BITS;
  if (unknown !== 0n) names.push(`<unknown bits 0x${unknown.toString(16)}>`);
  // The ARRAY_* names above already carry the `ARRAY_` prefix; the flags do not, and both read
  // better without it in a one-line note.
  return names.length === 0 ? '<none>' : names.map((n) => n.replace(/^ARRAY_/, '')).join('|');
}

/**
 * `PrimitiveType`, :208-213 — and the ONE renumbering in this file that would be silent if missed.
 *
 * Godot 4 dropped `PRIMITIVE_LINE_LOOP` and `PRIMITIVE_TRIANGLE_FAN`, so its `PRIMITIVE_TRIANGLES`
 * is **3** where Godot 3.6's is **4**. `ArrayMeshSurface.primitive` is documented as Godot's own
 * number and every consumer compares it against `ARRAY_MESH_PRIMITIVE` (the 3.6 spelling), so a
 * raw pass-through would make every Godot 4 triangle surface read as a 3.6 LINE_LOOP — refusing
 * with a message pointing at the wrong problem. The mapping is explicit, and a Godot 4 primitive
 * with no 3.6 counterpart refuses by name.
 */
const GODOT4_PRIMITIVE_TO_GODOT3: Readonly<Record<number, number>> = {
  0: ARRAY_MESH_PRIMITIVE.POINTS,
  1: ARRAY_MESH_PRIMITIVE.LINES,
  2: ARRAY_MESH_PRIMITIVE.LINE_STRIP,
  3: ARRAY_MESH_PRIMITIVE.TRIANGLES,
  4: ARRAY_MESH_PRIMITIVE.TRIANGLE_STRIP,
};

/** `ArrayMesh::_set_surfaces` (`scene/resources/mesh.cpp:1587-1662`) reads exactly these. */
const SURFACE_KEYS: ReadonlySet<string> = new Set([
  'format',
  'primitive',
  'vertex_data',
  'vertex_count',
  'attribute_data',
  'skin_data',
  'aabb',
  'uv_scale',
  'index_data',
  'index_count',
  'lods',
  'bone_aabbs',
  'blend_shapes',
  'material',
  'name',
  '2d',
]);

// ------------------------------------------------------------------------------------------
// Scalar math — each mirrors the engine function named above, in float32 throughout, because
// Godot's `real_t` is `float` in every shipped build and a double-precision normalization
// disagrees with the engine in the last bits.
// ------------------------------------------------------------------------------------------

const f = Math.fround;

/** `Vector3::octahedron_decode` (`core/math/vector3.cpp:106`). Note the sign test is `>= 0`, NOT
 *  Godot 3's `SGN` macro — at exactly zero the two disagree, so this is transcribed rather than
 *  shared with `array-mesh.ts`'s `octToNorm`. */
function octahedronDecode(ox: number, oy: number): [number, number, number] {
  const fx = f(f(ox * 2) - 1);
  const fy = f(f(oy * 2) - 1);
  let nx = fx;
  let ny = fy;
  const nz = f(f(1 - Math.abs(fx)) - Math.abs(fy));
  const t = Math.min(Math.max(f(-nz), 0), 1);
  nx = f(nx + (nx >= 0 ? -t : t));
  ny = f(ny + (ny >= 0 ? -t : t));
  // `Vector3::normalized`: a zero-length vector normalizes to zero rather than to NaN.
  const lengthSquared = f(f(f(nx * nx) + f(ny * ny)) + f(nz * nz));
  if (lengthSquared === 0) return [0, 0, 0];
  const length = f(Math.sqrt(lengthSquared));
  return [f(nx / length), f(ny / length), f(nz / length)];
}

/** `Vector3::octahedron_tangent_decode` (`core/math/vector3.cpp:123`). The `y` channel carries the
 *  binormal SIGN in its own high half before the octahedral decode sees it. */
function octahedronTangentDecode(
  ox: number,
  oy: number,
): { readonly xyz: [number, number, number]; readonly sign: number } {
  const shifted = f(f(oy * 2) - 1);
  const sign = shifted >= 0 ? 1 : -1;
  return { xyz: octahedronDecode(ox, Math.abs(shifted)), sign };
}

/**
 * `_get_tbn_from_axis_angle` (`servers/rendering/rendering_server.cpp:343`) — the compressed path's
 * normal AND tangent, rebuilt from one octahedral axis plus one scalar angle.
 *
 * `Basis(axis, angle)` is `Basis::set_axis_angle` (`core/math/basis.cpp:841`); the tangent is its
 * first ROW and the normal its third.
 */
function tbnFromAxisAngle(
  axis: readonly [number, number, number],
  packedAngle: number,
): { readonly normal: [number, number, number]; readonly tangent: [number, number, number, number] } {
  const binormalSign = packedAngle > 0.5 ? 1 : -1;
  const angle = f(Math.abs(packedAngle * 2 - 1) * Math.PI);

  const [x, y, z] = axis;
  const cosine = f(Math.cos(angle));
  const sine = f(Math.sin(angle));
  const t = f(1 - cosine);
  const xx = f(x * x);
  const zz = f(z * z);

  // rows[0] — the tangent.
  const r00 = f(xx + f(cosine * f(1 - xx)));
  const r01 = f(f(f(x * y) * t) - f(z * sine));
  const r02 = f(f(f(x * z) * t) + f(y * sine));
  // rows[2] — the normal.
  const r20 = f(f(f(x * z) * t) - f(y * sine));
  const r21 = f(f(f(y * z) * t) + f(x * sine));
  const r22 = f(zz + f(cosine * f(1 - zz)));

  return { normal: [r20, r21, r22], tangent: [r00, r01, r02, binormalSign] };
}

// ------------------------------------------------------------------------------------------
// Layout — `mesh_surface_make_offsets_from_format` (`rendering_server.cpp:1055`), transcribed
// ------------------------------------------------------------------------------------------

interface SurfaceLayout {
  /** Byte offset of each array's first element, indexed by `ARRAY_*`. */
  readonly offsets: readonly number[];
  /** Stride between consecutive vertices within the POSITION block of `vertex_data`. */
  readonly vertexElementSize: number;
  /** Stride within the NORMAL/TANGENT block, which begins after all the positions. */
  readonly normalElementSize: number;
  /** Stride within `attribute_data`. */
  readonly attributeElementSize: number;
  /** Stride within `skin_data`. */
  readonly skinElementSize: number;
  /** 2 or 4 — Godot widens indices at 65536 vertices. */
  readonly indexElementSize: number;
}

function computeSurfaceLayout(
  format: bigint,
  vertexCount: number,
  indexCount: number,
  at: string,
): SurfaceLayout {
  const has = (bit: number): boolean => (format & (1n << BigInt(bit))) !== 0n;
  const flag = (mask: bigint): boolean => (format & mask) !== 0n;
  const compressed = flag(ARRAY_FLAG_COMPRESS_ATTRIBUTES);

  const offsets = new Array<number>(ARRAY_MAX).fill(0);
  let vertexElementSize = 0;
  let normalElementSize = 0;
  let attributeElementSize = 0;
  let skinElementSize = 0;
  let indexElementSize = 0;

  // The engine's own loop switches which accumulator it is filling as it passes ARRAY_VERTEX,
  // ARRAY_NORMAL, ARRAY_COLOR and ARRAY_BONES — and it does so BEFORE testing the format bit, so
  // an absent COLOR still hands the attribute accumulator to ARRAY_TEX_UV behind it.
  type Accumulator = 'vertex' | 'normal' | 'attribute' | 'skin';
  let accumulator: Accumulator | undefined;
  const sizeOf = (which: Accumulator): number =>
    which === 'vertex'
      ? vertexElementSize
      : which === 'normal'
        ? normalElementSize
        : which === 'attribute'
          ? attributeElementSize
          : skinElementSize;
  const addTo = (which: Accumulator, amount: number): void => {
    if (which === 'vertex') vertexElementSize += amount;
    else if (which === 'normal') normalElementSize += amount;
    else if (which === 'attribute') attributeElementSize += amount;
    else skinElementSize += amount;
  };

  for (let i = 0; i < ARRAY_MAX; i++) {
    if (i === ARRAY_VERTEX) accumulator = 'vertex';
    else if (i === ARRAY_NORMAL) accumulator = 'normal';
    else if (i === ARRAY_COLOR) accumulator = 'attribute';
    else if (i === ARRAY_BONES) accumulator = 'skin';

    if (!has(i)) continue;

    let elementSize: number;
    switch (i) {
      case ARRAY_VERTEX:
        if (flag(ARRAY_FLAG_USE_2D_VERTICES)) {
          throw new ArrayMeshDecodeError(
            at,
            'a surface with `ARRAY_FLAG_USE_2D_VERTICES`. This lane translates 3D meshes; a 2D ' +
              'vertex stream is a different attribute layout that no measured fixture ships.',
          );
        }
        elementSize = (compressed ? 2 : 3) * 4;
        break;
      case ARRAY_NORMAL:
        elementSize = 4;
        break;
      case ARRAY_TANGENT:
        // Zero, deliberately: when compressed the tangent rides in the POSITION element's fourth
        // `uint16` as an angle, so it occupies no bytes of its own in the normal block.
        elementSize = compressed ? 0 : 4;
        break;
      case ARRAY_COLOR:
        elementSize = 4;
        break;
      case ARRAY_TEX_UV:
      case ARRAY_TEX_UV2:
        elementSize = compressed ? 4 : 8;
        break;
      case ARRAY_BONES:
      case ARRAY_WEIGHTS:
        elementSize = 2 * (flag(ARRAY_FLAG_USE_8_BONE_WEIGHTS) ? 8 : 4);
        break;
      case ARRAY_INDEX: {
        if (indexCount <= 0) {
          throw new ArrayMeshDecodeError(
            at,
            'a surface whose format declares `ARRAY_FORMAT_INDEX` but whose `index_count` is ' +
              'absent or zero. Godot prints `index_array_len==NO_INDEX_ARRAY` and reads nothing; ' +
              'this refuses rather than emitting an unindexed geometry the document never authored.',
          );
        }
        indexElementSize = vertexCount > 0 && vertexCount <= 1 << 16 ? 2 : 4;
        offsets[i] = indexElementSize;
        continue;
      }
      default:
        throw new ArrayMeshDecodeError(
          at,
          `a surface carrying \`${ARRAY_NAMES[i] ?? `array ${i}`}\`, which this decoder has not ` +
            'been measured against. Its element size shifts every array behind it in the same ' +
            'buffer, so reading the rest would silently misalign them.',
        );
    }

    if (accumulator === undefined) continue;
    // The normal/tangent block begins after EVERY position, not after one — this is the single
    // fact that makes the Godot 4 vertex buffer two blocks rather than one interleaved stream.
    const blockBase =
      i === ARRAY_NORMAL || i === ARRAY_TANGENT ? vertexElementSize * vertexCount : 0;
    offsets[i] = sizeOf(accumulator) + blockBase;
    addTo(accumulator, elementSize);
  }

  return {
    offsets,
    vertexElementSize,
    normalElementSize,
    attributeElementSize,
    skinElementSize,
    indexElementSize,
  };
}

// ------------------------------------------------------------------------------------------
// Reading the dictionary
// ------------------------------------------------------------------------------------------

function entryOf(value: GodotValue, key: string): GodotValue | undefined {
  return value.kind === 'dict' ? value.entries.find((e) => e.key === key)?.value : undefined;
}

function numberOf(value: GodotValue | undefined, key: string, at: string): number {
  if (value?.kind !== 'number') {
    throw new ArrayMeshDecodeError(at, `a \`${key}\` that is ${value?.kind ?? 'absent'}, not a number`);
  }
  return value.value;
}

/**
 * A `PackedByteArray` as bytes. The binary container decodes it to a base64 `string` argument and
 * the text grammar to a list of numeric ones, so both spellings are read here rather than forcing
 * one of the two readers to normalize into the other's shape.
 */
function bytesOf(value: GodotValue | undefined, key: string, at: string): Uint8Array | undefined {
  if (value === undefined) return undefined;
  if (value.kind !== 'ctor' || (value.name !== 'PackedByteArray' && value.name !== 'PoolByteArray')) {
    throw new ArrayMeshDecodeError(
      at,
      `a \`${key}\` that is ${value.kind === 'ctor' ? `a \`${value.name}\`` : value.kind}, not a ` +
        '`PackedByteArray`',
    );
  }
  const first = value.args[0];
  if (value.args.length === 1 && first?.kind === 'string') {
    return new Uint8Array(Buffer.from(first.value, 'base64'));
  }
  const bytes = new Uint8Array(value.args.length);
  for (const [i, arg] of value.args.entries()) {
    if (arg.kind !== 'number') {
      throw new ArrayMeshDecodeError(at, `a \`${key}\` whose element ${i} is not a number`);
    }
    bytes[i] = arg.value;
  }
  return bytes;
}

/** An `AABB(px, py, pz, sx, sy, sz)`. Required by the compressed position decode, which is why a
 *  malformed one refuses rather than defaulting: a wrong AABB scales every vertex wrongly. */
function aabbOf(value: GodotValue | undefined, at: string): readonly number[] {
  if (value?.kind !== 'ctor' || value.name !== 'AABB' || value.args.length !== 6) {
    throw new ArrayMeshDecodeError(
      at,
      'an `aabb` that is not an `AABB(px, py, pz, sx, sy, sz)`. `ArrayMesh::_set_surfaces` ' +
        'requires it, and a compressed position is meaningless without it.',
    );
  }
  return value.args.map((arg, i) => {
    if (arg.kind !== 'number') {
      throw new ArrayMeshDecodeError(at, `an \`aabb\` whose component ${i} is not a number`);
    }
    return arg.value;
  });
}

/** A `Vector4(x, y, z, w)` `uv_scale`, or all-zero when absent — which is what Godot's own
 *  `is_zero_approx()` guard treats as "UVs are not normalized". */
function uvScaleOf(value: GodotValue | undefined, at: string): readonly [number, number, number, number] {
  if (value === undefined) return [0, 0, 0, 0];
  if (value.kind !== 'ctor' || value.name !== 'Vector4' || value.args.length !== 4) {
    throw new ArrayMeshDecodeError(at, 'a `uv_scale` that is not a `Vector4(x, y, z, w)`');
  }
  const parts = value.args.map((arg, i) => {
    if (arg.kind !== 'number') {
      throw new ArrayMeshDecodeError(at, `a \`uv_scale\` whose component ${i} is not a number`);
    }
    return arg.value;
  });
  return [parts[0] as number, parts[1] as number, parts[2] as number, parts[3] as number];
}

/** Godot's `Vector4::is_zero_approx`, which gates the UV denormalization. `CMP_EPSILON` is
 *  `0.00001` (`core/math/math_defs.h`). */
function isZeroApprox(v: readonly [number, number, number, number]): boolean {
  return v.every((component) => Math.abs(component) < 0.00001);
}

/**
 * Every surface of a Godot 4 `ArrayMesh`, in `_surfaces` order.
 *
 * Returns an EMPTY list when the document carries no `_surfaces` at all, so a caller can use that
 * to choose between this decoder and the Godot 3 one without a second look at the properties.
 */
export function readGodot4Surfaces(
  properties: Readonly<Record<string, GodotValue>>,
  at: string,
): ArrayMeshSurface[] {
  const surfaces = properties['_surfaces'];
  if (surfaces === undefined) return [];
  if (surfaces.kind !== 'array') {
    throw new ArrayMeshDecodeError(
      at,
      `a \`_surfaces\` that is a ${surfaces.kind}, not an array. \`ArrayMesh::_set_surfaces\` ` +
        'takes an `Array` of per-surface dictionaries.',
    );
  }
  return surfaces.items.map((item, index) =>
    decodeGodot4Surface(item, index, `${at}#_surfaces/${index}`),
  );
}

/** One `_surfaces` dictionary, decoded. Throws {@link ArrayMeshDecodeError} rather than guessing. */
export function decodeGodot4Surface(
  value: GodotValue,
  index: number,
  at: string,
): ArrayMeshSurface {
  if (value.kind !== 'dict') {
    throw new ArrayMeshDecodeError(at, `a \`_surfaces\` entry that is a ${value.kind}, not a dictionary`);
  }
  for (const entry of value.entries) {
    if (!SURFACE_KEYS.has(entry.key)) {
      throw new ArrayMeshDecodeError(
        at,
        `an unrecognized surface key \`${entry.key}\`. \`ArrayMesh::_set_surfaces\` reads only ` +
          `${[...SURFACE_KEYS].join(', ')}; a key outside that set means this is not the format ` +
          'this reader was measured against.',
      );
    }
  }

  const rawFormat = numberOf(entryOf(value, 'format'), 'format', at);
  if (!Number.isSafeInteger(rawFormat) || rawFormat < 0) {
    throw new ArrayMeshDecodeError(at, `a \`format\` of ${rawFormat}, which is not a whole 64-bit flag word`);
  }
  const format = BigInt(rawFormat);

  const unknownBits = format & ~KNOWN_FORMAT_BITS;
  if (unknownBits !== 0n) {
    throw new ArrayMeshDecodeError(
      at,
      `format ${rawFormat} sets bits Godot 4.7's \`ArrayFormat\` does not define ` +
        `(0x${unknownBits.toString(16)})`,
    );
  }

  const version = (format >> ARRAY_FLAG_FORMAT_VERSION_SHIFT) & ARRAY_FLAG_FORMAT_VERSION_MASK;
  if (version !== FORMAT_VERSION_2_FIELD_VALUE) {
    throw new ArrayMeshDecodeError(
      at,
      `a surface at vertex-format VERSION ${version + 1n} rather than 2 ` +
        '(`ARRAY_FLAG_FORMAT_CURRENT_VERSION` at 4.7). Version 1 is the pre-4.2 packing, whose ' +
        'strides differ, so it is refused rather than read with these offsets.',
    );
  }
  if ((format & ARRAY_FLAG_USES_EMPTY_VERTEX_ARRAY) !== 0n) {
    throw new ArrayMeshDecodeError(
      at,
      'a surface with `ARRAY_FLAG_USES_EMPTY_VERTEX_ARRAY`, which carries no position stream at ' +
        'all. There is no geometry here to emit.',
    );
  }

  const rawPrimitive = numberOf(entryOf(value, 'primitive'), 'primitive', at);
  const primitive = GODOT4_PRIMITIVE_TO_GODOT3[rawPrimitive];
  if (primitive === undefined) {
    throw new ArrayMeshDecodeError(
      at,
      `a \`primitive\` of ${rawPrimitive}, which Godot 4.7's \`PrimitiveType\` does not define`,
    );
  }

  const vertexCount = numberOf(entryOf(value, 'vertex_count'), 'vertex_count', at);
  const indexCountValue = entryOf(value, 'index_count');
  const indexCount = indexCountValue === undefined ? 0 : numberOf(indexCountValue, 'index_count', at);

  const blendShapes = entryOf(value, 'blend_shapes');
  const blendShapeCount =
    blendShapes === undefined ? 0 : blendShapes.kind === 'array' ? blendShapes.items.length : 1;

  const layout = computeSurfaceLayout(format, vertexCount, indexCount, at);
  const aabb = aabbOf(entryOf(value, 'aabb'), at);
  const uvScale = uvScaleOf(entryOf(value, 'uv_scale'), at);
  const compressed = (format & ARRAY_FLAG_COMPRESS_ATTRIBUTES) !== 0n;
  const has = (bit: number): boolean => (format & (1n << BigInt(bit))) !== 0n;

  // `_get_array_from_surface` reads the index array strictly by the FORMAT BIT (its loop `continue`s
  // past any array whose bit is unset), so index keys on a surface whose format lacks
  // `ARRAY_FORMAT_INDEX` are a document disagreeing with itself. Refuse rather than read them:
  // `indexElementSize` is 0 for that format, and reading anyway would take the uint32 branch over
  // bytes the layout never described.
  if (!has(ARRAY_INDEX) && (indexCount > 0 || entryOf(value, 'index_data') !== undefined)) {
    throw new ArrayMeshDecodeError(
      at,
      'a surface carrying `index_data`/`index_count` whose `format` does not declare ' +
        '`ARRAY_FORMAT_INDEX`. Godot reads arrays by the format bit alone, so these keys are not ' +
        'the format this reader was measured against.',
    );
  }

  const vertexData = bytesOf(entryOf(value, 'vertex_data'), 'vertex_data', at);
  if (vertexData === undefined) {
    throw new ArrayMeshDecodeError(at, 'a surface with no `vertex_data`');
  }
  const attributeData = bytesOf(entryOf(value, 'attribute_data'), 'attribute_data', at);
  const skinData = bytesOf(entryOf(value, 'skin_data'), 'skin_data', at);
  const indexData = bytesOf(entryOf(value, 'index_data'), 'index_data', at);

  /** Every buffer length is checked against the layout BEFORE a byte is read. A short buffer read
   *  with the right stride yields plausible garbage at the tail, which is the failure this whole
   *  module's refusal discipline exists to prevent. */
  const requireLength = (
    buffer: Uint8Array | undefined,
    name: string,
    expected: number,
  ): void => {
    if (expected === 0) return;
    if (buffer === undefined) {
      throw new ArrayMeshDecodeError(
        at,
        `a surface whose format needs ${expected} bytes of \`${name}\`, which the document does ` +
          'not carry',
      );
    }
    if (buffer.length !== expected) {
      throw new ArrayMeshDecodeError(
        at,
        `a \`${name}\` of ${buffer.length} bytes where the format and vertex count require ` +
          `${expected}. The layout this decoder computed does not describe these bytes, so ` +
          'reading them would misalign every vertex.',
      );
    }
  };

  requireLength(
    vertexData,
    'vertex_data',
    (layout.vertexElementSize + layout.normalElementSize) * vertexCount,
  );
  requireLength(attributeData, 'attribute_data', layout.attributeElementSize * vertexCount);
  requireLength(skinData, 'skin_data', layout.skinElementSize * vertexCount);
  requireLength(indexData, 'index_data', layout.indexElementSize * indexCount);

  const vertexView = new DataView(vertexData.buffer, vertexData.byteOffset, vertexData.byteLength);
  const attributeView =
    attributeData === undefined
      ? undefined
      : new DataView(attributeData.buffer, attributeData.byteOffset, attributeData.byteLength);

  const positions = new Float32Array(vertexCount * 3);
  let normals: Float32Array | undefined;
  let tangents: Float32Array | undefined;

  // ---- ARRAY_VERTEX (and, when compressed, the normal/tangent pair that rides with it) ----
  if (compressed) {
    if (has(ARRAY_NORMAL)) {
      // `_get_array_from_surface`:1470-1489 — one octahedral AXIS from the normal slot plus one
      // ANGLE from the position's fourth `uint16` rebuild BOTH the normal and the tangent.
      normals = new Float32Array(vertexCount * 3);
      tangents = new Float32Array(vertexCount * 4);
      for (let j = 0; j < vertexCount; j++) {
        const n = vertexView.getUint32(j * layout.normalElementSize + (layout.offsets[ARRAY_NORMAL] as number), true);
        const axis = octahedronDecode(f((n & 0xffff) / 65535), f(((n >>> 16) & 0xffff) / 65535));

        const base = j * layout.vertexElementSize + (layout.offsets[ARRAY_VERTEX] as number);
        const px = f(vertexView.getUint16(base + 0, true) / 65535);
        const py = f(vertexView.getUint16(base + 2, true) / 65535);
        const pz = f(vertexView.getUint16(base + 4, true) / 65535);
        const angle = f(vertexView.getUint16(base + 6, true) / 65535);
        positions[j * 3 + 0] = f(f(px * (aabb[3] as number)) + (aabb[0] as number));
        positions[j * 3 + 1] = f(f(py * (aabb[4] as number)) + (aabb[1] as number));
        positions[j * 3 + 2] = f(f(pz * (aabb[5] as number)) + (aabb[2] as number));

        const tbn = tbnFromAxisAngle(axis, angle);
        normals[j * 3 + 0] = tbn.normal[0];
        normals[j * 3 + 1] = tbn.normal[1];
        normals[j * 3 + 2] = tbn.normal[2];
        tangents[j * 4 + 0] = tbn.tangent[0];
        tangents[j * 4 + 1] = tbn.tangent[1];
        tangents[j * 4 + 2] = tbn.tangent[2];
        tangents[j * 4 + 3] = tbn.tangent[3];
      }
    } else {
      // :1450-1457 — "We only have vertices to read, so just read them and skip everything else."
      for (let j = 0; j < vertexCount; j++) {
        const base = j * layout.vertexElementSize + (layout.offsets[ARRAY_VERTEX] as number);
        const px = f(vertexView.getUint16(base + 0, true) / 65535);
        const py = f(vertexView.getUint16(base + 2, true) / 65535);
        const pz = f(vertexView.getUint16(base + 4, true) / 65535);
        positions[j * 3 + 0] = f(f(px * (aabb[3] as number)) + (aabb[0] as number));
        positions[j * 3 + 1] = f(f(py * (aabb[4] as number)) + (aabb[1] as number));
        positions[j * 3 + 2] = f(f(pz * (aabb[5] as number)) + (aabb[2] as number));
      }
    }
  } else {
    for (let j = 0; j < vertexCount; j++) {
      const base = j * layout.vertexElementSize + (layout.offsets[ARRAY_VERTEX] as number);
      positions[j * 3 + 0] = vertexView.getFloat32(base + 0, true);
      positions[j * 3 + 1] = vertexView.getFloat32(base + 4, true);
      positions[j * 3 + 2] = vertexView.getFloat32(base + 8, true);
    }
    // ---- ARRAY_NORMAL / ARRAY_TANGENT, each its own octahedral `uint32` ----
    if (has(ARRAY_NORMAL)) {
      normals = new Float32Array(vertexCount * 3);
      for (let j = 0; j < vertexCount; j++) {
        const v = vertexView.getUint32(j * layout.normalElementSize + (layout.offsets[ARRAY_NORMAL] as number), true);
        const decoded = octahedronDecode(f((v & 0xffff) / 65535), f(((v >>> 16) & 0xffff) / 65535));
        normals[j * 3 + 0] = decoded[0];
        normals[j * 3 + 1] = decoded[1];
        normals[j * 3 + 2] = decoded[2];
      }
    }
    if (has(ARRAY_TANGENT)) {
      tangents = new Float32Array(vertexCount * 4);
      for (let j = 0; j < vertexCount; j++) {
        const v = vertexView.getUint32(j * layout.normalElementSize + (layout.offsets[ARRAY_TANGENT] as number), true);
        const decoded = octahedronTangentDecode(f((v & 0xffff) / 65535), f(((v >>> 16) & 0xffff) / 65535));
        tangents[j * 4 + 0] = decoded.xyz[0];
        tangents[j * 4 + 1] = decoded.xyz[1];
        tangents[j * 4 + 2] = decoded.xyz[2];
        tangents[j * 4 + 3] = decoded.sign;
      }
    }
  }

  // ---- The attribute buffer: colours and UVs ----
  let colors: Float32Array | undefined;
  let uvs: Float32Array | undefined;
  let uv2s: Float32Array | undefined;

  if (attributeView !== undefined) {
    if (has(ARRAY_COLOR)) {
      colors = new Float32Array(vertexCount * 4);
      for (let j = 0; j < vertexCount; j++) {
        const base = j * layout.attributeElementSize + (layout.offsets[ARRAY_COLOR] as number);
        for (let c = 0; c < 4; c++) {
          colors[j * 4 + c] = f(attributeView.getUint8(base + c) / 255);
        }
      }
    }
    const readUv = (array: number, scaleX: number, scaleY: number): Float32Array => {
      const out = new Float32Array(vertexCount * 2);
      const denormalize = compressed && !isZeroApprox(uvScale);
      for (let j = 0; j < vertexCount; j++) {
        const base = j * layout.attributeElementSize + (layout.offsets[array] as number);
        if (compressed) {
          let ux = f(attributeView.getUint16(base + 0, true) / 65535);
          let uy = f(attributeView.getUint16(base + 2, true) / 65535);
          if (denormalize) {
            ux = f(f(ux - 0.5) * scaleX);
            uy = f(f(uy - 0.5) * scaleY);
          }
          out[j * 2 + 0] = ux;
          out[j * 2 + 1] = uy;
        } else {
          out[j * 2 + 0] = attributeView.getFloat32(base + 0, true);
          out[j * 2 + 1] = attributeView.getFloat32(base + 4, true);
        }
      }
      return out;
    };
    // `uv_scale`'s xy belongs to TEX_UV and its zw to TEX_UV2 (:1561-1563, :1605-1607).
    if (has(ARRAY_TEX_UV)) uvs = readUv(ARRAY_TEX_UV, uvScale[0], uvScale[1]);
    if (has(ARRAY_TEX_UV2)) uv2s = readUv(ARRAY_TEX_UV2, uvScale[2], uvScale[3]);
  }

  // ---- The skin buffer ----
  let bones: Uint16Array | undefined;
  let weights: Float32Array | undefined;
  if (skinData !== undefined && (has(ARRAY_BONES) || has(ARRAY_WEIGHTS))) {
    if ((format & ARRAY_FLAG_USE_8_BONE_WEIGHTS) !== 0n) {
      throw new ArrayMeshDecodeError(
        at,
        'a surface with `ARRAY_FLAG_USE_8_BONE_WEIGHTS`. `ArrayMeshSurface` carries four bone ' +
          'influences per vertex, which is also what three\'s `skinIndex`/`skinWeight` take, so ' +
          'the other four would be dropped silently.',
      );
    }
    const skinView = new DataView(skinData.buffer, skinData.byteOffset, skinData.byteLength);
    if (has(ARRAY_BONES)) {
      bones = new Uint16Array(vertexCount * 4);
      for (let j = 0; j < vertexCount; j++) {
        const base = j * layout.skinElementSize + (layout.offsets[ARRAY_BONES] as number);
        for (let b = 0; b < 4; b++) bones[j * 4 + b] = skinView.getUint16(base + b * 2, true);
      }
    }
    if (has(ARRAY_WEIGHTS)) {
      // `ARRAY_WEIGHTS = 11, // RGBA16UNORM` (`rendering_server_enums.h:138`) — a normalized
      // `uint16`, not a half float.
      weights = new Float32Array(vertexCount * 4);
      for (let j = 0; j < vertexCount; j++) {
        const base = j * layout.skinElementSize + (layout.offsets[ARRAY_WEIGHTS] as number);
        for (let w = 0; w < 4; w++) {
          weights[j * 4 + w] = f(skinView.getUint16(base + w * 2, true) / 65535);
        }
      }
    }
  }

  // ---- Indices ----
  let indices: Uint32Array | undefined;
  if (indexData !== undefined && indexCount > 0) {
    const indexView = new DataView(indexData.buffer, indexData.byteOffset, indexData.byteLength);
    indices = new Uint32Array(indexCount);
    for (let j = 0; j < indexCount; j++) {
      indices[j] =
        layout.indexElementSize === 2 ? indexView.getUint16(j * 2, true) : indexView.getUint32(j * 4, true);
    }
  }

  const material = entryOf(value, 'material');

  return {
    index,
    serialization: 'godot4-surfaces',
    // The format is reported as Godot 4 wrote it. It is a 64-bit word, and `ArrayMeshSurface.format`
    // is a `number`; every value here is well inside `Number.MAX_SAFE_INTEGER`, and it is checked
    // above rather than assumed.
    format: rawFormat,
    primitive,
    vertexCount,
    indexCount,
    blendShapeCount,
    positions,
    ...(normals === undefined ? {} : { normals }),
    ...(tangents === undefined ? {} : { tangents }),
    ...(colors === undefined ? {} : { colors }),
    ...(uvs === undefined ? {} : { uvs }),
    ...(uv2s === undefined ? {} : { uv2s }),
    ...(bones === undefined ? {} : { bones }),
    ...(weights === undefined ? {} : { weights }),
    ...(indices === undefined ? {} : { indices }),
    ...(material === undefined ? {} : { materialRef: material }),
  };
}
