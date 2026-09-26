/**
 * read/array-mesh.ts — a Godot 3 `ArrayMesh` surface's `array_data` bytes → geometry arrays.
 *
 * A `.tscn`/`.tres` that authors geometry inline writes ONE dictionary per surface:
 *
 *     surfaces/0 = {
 *       "aabb": AABB( -1, -0.191052, -1, 2, 0.407182, 2.64929 ),
 *       "array_data": PoolByteArray( 0, 184, 29, 178, … ),
 *       "array_index_data": PoolByteArray( 0, 0, 2, 0, 1, 0, … ),
 *       "format": 98051, "index_count": 156, "primitive": 4, "vertex_count": 56
 *     }
 *
 * `array_data` is a raw INTERLEAVED VERTEX BUFFER — the exact bytes Godot uploads to the GPU —
 * and `format` is the bitfield that says what is in it and how each attribute is packed. Nothing
 * else in the document describes the layout, so without this module a game whose meshes are
 * inline (the official 3D platformer demo: 43 surfaces across 7 documents, and not one model
 * file) has geometry the lane can read the existence of and nothing more.
 *
 * ## This is a TRANSCRIPTION, not an interpretation
 *
 * Every rule below is Godot 3.6's own, from `servers/visual_server.h` (the `ArrayFormat` enum,
 * lines 235–279 at 3.6-stable) and `servers/visual_server.cpp`:
 * `VisualServer::_get_array_from_surface` (lines 1343–1830) is the engine's own reader for these
 * bytes and is what this file mirrors, statement for statement; `_mesh_find_format` (≈1080–1251)
 * is the writer's half of the same layout. Where the two spell an arithmetic differently — the
 * compressed NORMAL path multiplies by a float32 `1.f/127.f`, the compressed TANGENT path divides
 * by a double `127.0` — this file reproduces the difference rather than tidying it, because the
 * ground truth it is measured against is the engine's output, not a cleaner formula.
 *
 * ## What the format bits mean (Godot 3.6, `servers/visual_server.h`)
 *
 * Bits 0–8 say an array is PRESENT (`ARRAY_FORMAT_*`); bits 9–17 say it is COMPRESSED
 * (`ARRAY_COMPRESS_* = 1 << (arrayIndex + ARRAY_COMPRESS_BASE)`, `ARRAY_COMPRESS_BASE = 9`); bits
 * 18–22 are standalone flags. A compress bit is set for arrays the surface does not even carry —
 * Godot's importer passes one `ARRAY_COMPRESS_DEFAULT` mask wholesale — so a compress bit is only
 * meaningful ALONGSIDE its format bit. The platformer's three formats decompose as:
 *
 *   - 98051 = VERTEX|NORMAL|INDEX                    + compress{VERTEX,NORMAL,TANGENT,COLOR,
 *   - 98067 = VERTEX|NORMAL|TEX_UV|INDEX               TEX_UV,TEX_UV2,WEIGHTS}
 *   - 98243 = VERTEX|NORMAL|BONES|WEIGHTS|INDEX
 *
 * — and NONE of them sets `ARRAY_FLAG_USE_OCTAHEDRAL_COMPRESSION` (1 << 21), so their normals are
 * the three-signed-byte form, not the octahedral pair that Godot 3.4+ makes the import default.
 * Reading them as octahedral would produce plausible, wrong normals on every mesh in the game.
 *
 * ## The one thing the format bits do NOT record
 *
 * `rendering/misc/mesh_storage/split_stream` is a PROJECT SETTING, read live through `GLOBAL_GET`
 * by both the writer and the engine's own reader. When it is on, positions live in one contiguous
 * block followed by the attributes, instead of interleaved per vertex — a completely different
 * layout, at the SAME total byte length and under the SAME `format` value (measured: a synthetic
 * surface built both ways serializes to 168 bytes and format 98111 either way, with different
 * bytes). So it cannot be inferred and must be passed in. The default is `false`, which is what
 * the platformer uses; {@link DecodeArrayMeshOptions.splitStream} is how a project that sets it
 * says so.
 *
 * ## What it refuses
 *
 * The anti-shim rule applies with full force to geometry: a mesh decoded with the wrong stride
 * still renders, as a cloud of triangles nobody authored. So the decoder throws
 * {@link ArrayMeshDecodeError} — never returns partial arrays — on an unknown format bit, on the
 * 2D-vertex flag, on a dictionary shape `ArrayMesh::_set` would not accept, and above all when
 * `array_data.length` is not exactly `stride * vertex_count`. That last check is the layout
 * arithmetic proving itself against the document on every single surface.
 */
import type { GodotValue } from './godot-value';

/** A surface the decoder would not read, named and located. Never a warning, never partial. */
export class ArrayMeshDecodeError extends Error {
  constructor(
    readonly at: string,
    message: string,
  ) {
    super(`${at}: ${message}`);
    this.name = 'ArrayMeshDecodeError';
  }
}

/**
 * Godot 3.6's `VisualServer::ArrayType` — the slot each array occupies in the format bitfield and
 * in `surface_get_arrays()`'s return. `ARRAY_MAX` is 9.
 */
const ARRAY_VERTEX = 0;
const ARRAY_NORMAL = 1;
const ARRAY_TANGENT = 2;
const ARRAY_COLOR = 3;
const ARRAY_TEX_UV = 4;
const ARRAY_TEX_UV2 = 5;
const ARRAY_BONES = 6;
const ARRAY_WEIGHTS = 7;
const ARRAY_INDEX = 8;
const ARRAY_MAX = 9;
/** `ARRAY_COMPRESS_BASE = (ARRAY_INDEX + 1)` — the shift from an array's slot to its compress bit. */
const ARRAY_COMPRESS_BASE = ARRAY_INDEX + 1;

/**
 * Godot 3.6's `VisualServer::ArrayFormat`, verbatim (`servers/visual_server.h:251`).
 *
 * Exported because a REFUSAL has to be able to name the bit it tripped on, and because the
 * translate stage decides what it can carry by asking about these — never by re-deriving `1 << 6`
 * at the call site.
 */
export const ARRAY_MESH_FORMAT = {
  VERTEX: 1 << ARRAY_VERTEX,
  NORMAL: 1 << ARRAY_NORMAL,
  TANGENT: 1 << ARRAY_TANGENT,
  COLOR: 1 << ARRAY_COLOR,
  TEX_UV: 1 << ARRAY_TEX_UV,
  TEX_UV2: 1 << ARRAY_TEX_UV2,
  BONES: 1 << ARRAY_BONES,
  WEIGHTS: 1 << ARRAY_WEIGHTS,
  INDEX: 1 << ARRAY_INDEX,

  COMPRESS_VERTEX: 1 << (ARRAY_VERTEX + ARRAY_COMPRESS_BASE),
  COMPRESS_NORMAL: 1 << (ARRAY_NORMAL + ARRAY_COMPRESS_BASE),
  COMPRESS_TANGENT: 1 << (ARRAY_TANGENT + ARRAY_COMPRESS_BASE),
  COMPRESS_COLOR: 1 << (ARRAY_COLOR + ARRAY_COMPRESS_BASE),
  COMPRESS_TEX_UV: 1 << (ARRAY_TEX_UV + ARRAY_COMPRESS_BASE),
  COMPRESS_TEX_UV2: 1 << (ARRAY_TEX_UV2 + ARRAY_COMPRESS_BASE),
  COMPRESS_BONES: 1 << (ARRAY_BONES + ARRAY_COMPRESS_BASE),
  COMPRESS_WEIGHTS: 1 << (ARRAY_WEIGHTS + ARRAY_COMPRESS_BASE),
  COMPRESS_INDEX: 1 << (ARRAY_INDEX + ARRAY_COMPRESS_BASE),

  FLAG_USE_2D_VERTICES: 1 << 18,
  FLAG_USE_16_BIT_BONES: 1 << 19,
  FLAG_USE_DYNAMIC_UPDATE: 1 << 20,
  FLAG_USE_OCTAHEDRAL_COMPRESSION: 1 << 21,
  FLAG_USE_VERTEX_CACHE_OPTIMIZATION: 1 << 22,
} as const;

/** Every bit the 3.6 enum defines. Anything outside it is a format this reader has never seen. */
const KNOWN_FORMAT_BITS = Object.values(ARRAY_MESH_FORMAT).reduce((all, bit) => all | bit, 0);

/** For a refusal that says WHICH bits, in Godot's own spelling. */
export function describeArrayMeshFormat(format: number): string {
  const names = Object.entries(ARRAY_MESH_FORMAT)
    .filter(([, bit]) => (format & bit) !== 0)
    .map(([name]) => name);
  const unknown = format & ~KNOWN_FORMAT_BITS;
  if (unknown !== 0) names.push(`<unknown bits 0x${unknown.toString(16)}>`);
  return names.length === 0 ? '<none>' : names.join('|');
}

/** Godot 3.6's `VisualServer::PrimitiveType`. A `.tscn` writes the number. */
export const ARRAY_MESH_PRIMITIVE = {
  POINTS: 0,
  LINES: 1,
  LINE_STRIP: 2,
  LINE_LOOP: 3,
  TRIANGLES: 4,
  TRIANGLE_STRIP: 5,
  TRIANGLE_FAN: 6,
} as const;

export interface DecodeArrayMeshOptions {
  /**
   * The project's `rendering/misc/mesh_storage/split_stream`. NOT recorded in the surface — see
   * this module's header. Absent means Godot's own default, `false`.
   */
  readonly splitStream?: boolean | undefined;
}

/**
 * One decoded surface: the document's own numbers, in the shape a renderer takes them.
 *
 * Components per vertex follow Godot's arrays exactly — 3 for a position or a normal, 4 for a
 * tangent (xyz + binormal sign), 4 for a colour, 2 for a UV, 4 for bones and weights. An array
 * the surface does not carry is ABSENT, never zero-filled: a zeroed normal array is fabricated
 * first-party data, which is the one thing an adapter may not produce.
 */
export interface ArrayMeshSurface {
  /** `N` in `surfaces/N`. */
  readonly index: number;
  /**
   * WHICH serialization this surface was decoded out of — and therefore how its {@link format}
   * word is to be read, because the two engines assign DIFFERENT MEANINGS to the same bits (bit 12
   * is Godot 3's `COMPRESS_COLOR` and Godot 4's `ARRAY_FORMAT_INDEX`).
   *
   * This is carried rather than inferred because the consumer that needs it is the emitted
   * PROVENANCE comment, and a provenance comment that names the wrong format flags and cites the
   * wrong measurement is a false statement about where the numbers came from — the one thing a
   * decode note exists to prevent. {@link describeSurfaceFormat} is the dispatch.
   */
  readonly serialization: 'godot3-array-data' | 'godot4-surfaces';
  readonly format: number;
  /** Godot's own `PrimitiveType` number — see {@link ARRAY_MESH_PRIMITIVE}. */
  readonly primitive: number;
  readonly vertexCount: number;
  readonly indexCount: number;
  /** The `SubResource( n )` id the surface names as its material, when it names one. */
  readonly materialSubResourceId?: number;
  /**
   * The surface's material as the REFERENCE VALUE it was written as, for a serialization whose ids
   * are not numbers. Godot 4 addresses a sub-resource by an opaque quoted token
   * (`SubResource("StandardMaterial3D_x")`), so `materialSubResourceId` cannot express one and
   * `read/godot4-surfaces.ts` fills this instead. A consumer prefers this when present and falls
   * back to rebuilding `SubResource(materialSubResourceId)`; both resolve through the same
   * `resourceRefId` lookup, which already reads either spelling.
   */
  readonly materialRef?: GodotValue;
  /** How many blend shapes the surface carries. This decoder does not decode them, and a caller
   *  that cannot carry them refuses on a non-zero count rather than dropping them silently. */
  readonly blendShapeCount: number;
  readonly positions: Float32Array;
  readonly normals?: Float32Array;
  readonly tangents?: Float32Array;
  readonly colors?: Float32Array;
  readonly uvs?: Float32Array;
  readonly uv2s?: Float32Array;
  /** Bone INDICES, 4 per vertex. Godot widens to 16 bits when any index exceeds 255. */
  readonly bones?: Uint16Array;
  readonly weights?: Float32Array;
  readonly indices?: Uint32Array;
}

// ------------------------------------------------------------------------------------------
// Scalar decoding — each one mirrors the arithmetic `_get_array_from_surface` uses, including
// where it differs between attributes.
// ------------------------------------------------------------------------------------------

const SCRATCH = new DataView(new ArrayBuffer(4));

/**
 * IEEE half → float, transcribed from Godot's `Math::halfbits_to_floatbits`
 * (`core/math/math_funcs.h`): the bit pattern is rebuilt and read back as a float32, so a
 * subnormal, an infinity and a NaN each land exactly where the engine puts them rather than
 * where a `2 ** exponent` shortcut would.
 */
function halfToFloat(half: number): number {
  const exponent = half & 0x7c00;
  const sign = (half & 0x8000) << 16;
  let bits: number;
  if (exponent === 0) {
    let significand = half & 0x03ff;
    if (significand === 0) {
      bits = sign;
    } else {
      let shifted = 0;
      significand <<= 1;
      while ((significand & 0x0400) === 0) {
        significand <<= 1;
        shifted++;
      }
      bits = sign + ((127 - 15 - shifted) << 23) + ((significand & 0x03ff) << 13);
    }
  } else if (exponent === 0x7c00) {
    bits = sign + 0x7f800000 + ((half & 0x03ff) << 13);
  } else {
    bits = sign + (((half & 0x7fff) + 0x1c000) << 13);
  }
  SCRATCH.setUint32(0, bits >>> 0, true);
  return SCRATCH.getFloat32(0, true);
}

/** Godot's `SGN` macro: zero maps to zero, not to +1. */
function sgn(value: number): number {
  return value === 0 ? 0 : value < 0 ? -1 : 1;
}

/**
 * `VisualServer::oct_to_norm` (`servers/visual_server.cpp:380`), in float32 throughout — Godot's
 * `Vector3` is `real_t`, which is `float` in every shipped build, so a double-precision
 * normalization would disagree with the engine in the last bits.
 */
function octToNorm(x: number, y: number): [number, number, number] {
  const f = Math.fround;
  let rx = f(x);
  let ry = f(y);
  const rz = f(1 - f(Math.abs(rx) + Math.abs(ry)));
  const t = Math.max(f(-rz), 0);
  rx = f(rx + f(t * -sgn(rx)));
  ry = f(ry + f(t * -sgn(ry)));
  const lengthSquared = f(f(f(rx * rx) + f(ry * ry)) + f(rz * rz));
  if (lengthSquared === 0) return [0, 0, 0];
  const length = f(Math.sqrt(lengthSquared));
  return [f(rx / length), f(ry / length), f(rz / length)];
}

// ------------------------------------------------------------------------------------------
// Layout
// ------------------------------------------------------------------------------------------

interface SurfaceLayout {
  /** Byte offset of each array's first element, indexed by `ARRAY_*`. */
  readonly offsets: readonly number[];
  /** Per-array stride between consecutive vertices, indexed by `ARRAY_*`. */
  readonly strides: readonly number[];
  /** `positionsStride + attributesStride` — the bytes one vertex occupies in total. */
  readonly bytesPerVertex: number;
  /** 2 or 4, from `vertex_count` alone: Godot picks 32-bit indices at 65536 vertices. */
  readonly indexElementSize: number;
}

/**
 * The offsets and strides for one surface — `_get_array_from_surface`'s first loop
 * (`servers/visual_server.cpp:1353–1509`), transcribed.
 *
 * Two shapes worth naming because both look like padding bugs and neither is one. A compressed
 * 3D position is 3 halves = 6 bytes and Godot rounds the ELEMENT to 8 (`if (elem_size == 6)`),
 * writing `1.0` into the fourth slot — so the pad is a real `w` a reader must skip, not slack.
 * And under `split_stream` the attribute block starts after ALL the positions
 * (`attributes_base_offset = elem_size * vertexCount`) rather than after one.
 */
function computeSurfaceLayout(
  format: number,
  vertexCount: number,
  splitStream: boolean,
  at: string,
): SurfaceLayout {
  const offsets = new Array<number>(ARRAY_MAX).fill(0);
  let attributesBaseOffset = 0;
  let attributesStride = 0;
  let positionsStride = 0;
  let indexElementSize = 0;

  const octahedral = (format & ARRAY_MESH_FORMAT.FLAG_USE_OCTAHEDRAL_COMPRESSION) !== 0;

  for (let i = 0; i < ARRAY_MAX; i++) {
    if ((format & (1 << i)) === 0) continue;

    let elemSize = 0;
    switch (i) {
      case ARRAY_VERTEX: {
        elemSize = (format & ARRAY_MESH_FORMAT.FLAG_USE_2D_VERTICES) !== 0 ? 2 : 3;
        elemSize *= (format & ARRAY_MESH_FORMAT.COMPRESS_VERTEX) !== 0 ? 2 : 4;
        if (elemSize === 6) elemSize = 8;
        offsets[i] = 0;
        positionsStride = elemSize;
        attributesBaseOffset = splitStream ? elemSize * vertexCount : elemSize;
        continue;
      }
      case ARRAY_NORMAL: {
        if (octahedral) {
          // oct32 (two int16) unless a COMPRESSED TANGENT is also present, in which case normal
          // and tangent are each oct16 (two int8).
          const withTangent =
            (format & ARRAY_MESH_FORMAT.COMPRESS_NORMAL) !== 0 &&
            (format & ARRAY_MESH_FORMAT.TANGENT) !== 0 &&
            (format & ARRAY_MESH_FORMAT.COMPRESS_TANGENT) !== 0;
          elemSize = withTangent ? 2 : 4;
        } else {
          elemSize = (format & ARRAY_MESH_FORMAT.COMPRESS_NORMAL) !== 0 ? 4 : 12;
        }
        break;
      }
      case ARRAY_TANGENT: {
        if (octahedral) {
          const withNormal =
            (format & ARRAY_MESH_FORMAT.COMPRESS_TANGENT) !== 0 &&
            (format & ARRAY_MESH_FORMAT.NORMAL) !== 0 &&
            (format & ARRAY_MESH_FORMAT.COMPRESS_NORMAL) !== 0;
          elemSize = withNormal ? 2 : 4;
        } else {
          elemSize = (format & ARRAY_MESH_FORMAT.COMPRESS_TANGENT) !== 0 ? 4 : 16;
        }
        break;
      }
      case ARRAY_COLOR:
        elemSize = (format & ARRAY_MESH_FORMAT.COMPRESS_COLOR) !== 0 ? 4 : 16;
        break;
      case ARRAY_TEX_UV:
        elemSize = (format & ARRAY_MESH_FORMAT.COMPRESS_TEX_UV) !== 0 ? 4 : 8;
        break;
      case ARRAY_TEX_UV2:
        elemSize = (format & ARRAY_MESH_FORMAT.COMPRESS_TEX_UV2) !== 0 ? 4 : 8;
        break;
      case ARRAY_WEIGHTS:
        elemSize = (format & ARRAY_MESH_FORMAT.COMPRESS_WEIGHTS) !== 0 ? 8 : 16;
        break;
      case ARRAY_BONES:
        elemSize = (format & ARRAY_MESH_FORMAT.FLAG_USE_16_BIT_BONES) !== 0 ? 8 : 4;
        break;
      case ARRAY_INDEX:
        // Not part of the vertex buffer at all: `offsets[ARRAY_INDEX]` is the ELEMENT SIZE of the
        // separate index buffer, which is Godot's own overload of the slot.
        indexElementSize = vertexCount >= 1 << 16 ? 4 : 2;
        offsets[i] = indexElementSize;
        continue;
      default:
        throw new ArrayMeshDecodeError(at, `format bit ${i} is not an array Godot 3.6 defines`);
    }

    offsets[i] = attributesBaseOffset + attributesStride;
    attributesStride += elemSize;
  }

  const strides = new Array<number>(ARRAY_MAX).fill(0);
  if (splitStream) {
    strides[ARRAY_VERTEX] = positionsStride;
    for (let i = 1; i < ARRAY_MAX - 1; i++) strides[i] = attributesStride;
  } else {
    for (let i = 0; i < ARRAY_MAX - 1; i++) strides[i] = positionsStride + attributesStride;
  }

  return {
    offsets,
    strides,
    bytesPerVertex: positionsStride + attributesStride,
    indexElementSize,
  };
}

// ------------------------------------------------------------------------------------------
// The document side
// ------------------------------------------------------------------------------------------

/** The keys `ArrayMesh::_set` accepts inside a `surfaces/N` dictionary (`scene/resources/mesh.cpp`). */
const SURFACE_KEYS: ReadonlySet<string> = new Set([
  'aabb',
  'array_data',
  'array_index_data',
  'arrays',
  'blend_shape_data',
  'format',
  'index_count',
  'material',
  'name',
  'primitive',
  'skeleton_aabb',
  'vertex_count',
]);

function entryOf(value: GodotValue, key: string): GodotValue | undefined {
  if (value.kind !== 'dict') return undefined;
  return value.entries.find((entry) => entry.key === key)?.value;
}

function numberOf(value: GodotValue | undefined, key: string, at: string): number {
  if (value?.kind !== 'number') {
    throw new ArrayMeshDecodeError(at, `a surface with no numeric \`${key}\``);
  }
  return value.value;
}

/** `PoolByteArray( 0, 184, … )` → the bytes. Godot 3's text format writes them as decimals. */
function poolByteArrayOf(value: GodotValue | undefined, key: string, at: string): Uint8Array {
  if (value === undefined) return new Uint8Array(0);
  if (value.kind !== 'ctor' || value.name !== 'PoolByteArray') {
    throw new ArrayMeshDecodeError(
      at,
      `\`${key}\` is ${value.kind === 'ctor' ? `a \`${value.name}(…)\`` : `a ${value.kind}`}, not a PoolByteArray`,
    );
  }
  const bytes = new Uint8Array(value.args.length);
  for (let i = 0; i < value.args.length; i++) {
    const arg = value.args[i] as GodotValue;
    if (arg.kind !== 'number' || !Number.isInteger(arg.value) || arg.value < 0 || arg.value > 255) {
      throw new ArrayMeshDecodeError(at, `\`${key}\` element ${i} is not a byte`);
    }
    bytes[i] = arg.value;
  }
  return bytes;
}

/**
 * Every `surfaces/N` a mesh's properties declare, decoded, in surface order.
 *
 * `properties` is a `sub_resource type="ArrayMesh"`'s properties, or a `.tres` whose `[resource]`
 * IS the mesh (`stage/floor_mesh.tres`) — the two are the same dictionary under different
 * headers, which is why this takes properties rather than either document type.
 */
export function readArrayMeshSurfaces(
  properties: Readonly<Record<string, GodotValue>>,
  at: string,
  options: DecodeArrayMeshOptions = {},
): ArrayMeshSurface[] {
  const indices = Object.keys(properties)
    .filter((key) => /^surfaces\/\d+$/.test(key))
    .map((key) => Number(key.slice('surfaces/'.length)))
    .sort((a, b) => a - b);
  return indices.map((index) =>
    decodeArrayMeshSurface(
      properties[`surfaces/${index}`] as GodotValue,
      index,
      `${at}#surfaces/${index}`,
      options,
    ),
  );
}

/** One `surfaces/N` dictionary, decoded. Throws {@link ArrayMeshDecodeError} rather than guessing. */
export function decodeArrayMeshSurface(
  value: GodotValue,
  index: number,
  at: string,
  options: DecodeArrayMeshOptions = {},
): ArrayMeshSurface {
  if (value.kind !== 'dict') {
    throw new ArrayMeshDecodeError(at, `a \`surfaces/${index}\` that is a ${value.kind}, not a dictionary`);
  }
  for (const entry of value.entries) {
    if (!SURFACE_KEYS.has(entry.key)) {
      throw new ArrayMeshDecodeError(
        at,
        `an unrecognized surface key \`${entry.key}\`. Godot 3.6's \`ArrayMesh::_set\` accepts ` +
          `only ${[...SURFACE_KEYS].join(', ')}; a key outside that set means this is not the ` +
          'format this reader was measured against.',
      );
    }
  }
  if (entryOf(value, 'arrays') !== undefined) {
    throw new ArrayMeshDecodeError(
      at,
      'a surface in the Godot 2.x `arrays` form (typed arrays rather than an `array_data` byte ' +
        'buffer). Godot 3.6 still loads it; this reader was measured only against `array_data`.',
    );
  }

  const format = numberOf(entryOf(value, 'format'), 'format', at);
  const primitive = numberOf(entryOf(value, 'primitive'), 'primitive', at);
  const vertexCount = numberOf(entryOf(value, 'vertex_count'), 'vertex_count', at);
  const indexCountValue = entryOf(value, 'index_count');
  const indexCount = indexCountValue === undefined ? 0 : numberOf(indexCountValue, 'index_count', at);

  const unknownBits = format & ~KNOWN_FORMAT_BITS;
  if (unknownBits !== 0) {
    throw new ArrayMeshDecodeError(
      at,
      `format ${format} sets bits Godot 3.6's ArrayFormat does not define ` +
        `(0x${unknownBits.toString(16)}); read as ${describeArrayMeshFormat(format)}`,
    );
  }
  if ((format & ARRAY_MESH_FORMAT.VERTEX) === 0) {
    throw new ArrayMeshDecodeError(
      at,
      `format ${format} (${describeArrayMeshFormat(format)}) carries no ARRAY_FORMAT_VERTEX, ` +
        'which Godot marks mandatory',
    );
  }
  if ((format & ARRAY_MESH_FORMAT.FLAG_USE_2D_VERTICES) !== 0) {
    throw new ArrayMeshDecodeError(
      at,
      'ARRAY_FLAG_USE_2D_VERTICES: a 2D vertex buffer. This decoder produces 3-component ' +
        'positions and has never been measured against a 2D surface.',
    );
  }
  if (!Number.isInteger(vertexCount) || vertexCount < 0) {
    throw new ArrayMeshDecodeError(at, `a \`vertex_count\` of ${vertexCount}`);
  }

  const splitStream = options.splitStream ?? false;
  const layout = computeSurfaceLayout(format, vertexCount, splitStream, at);
  const data = poolByteArrayOf(entryOf(value, 'array_data'), 'array_data', at);

  const expected = layout.bytesPerVertex * vertexCount;
  if (data.length !== expected) {
    throw new ArrayMeshDecodeError(
      at,
      `\`array_data\` is ${data.length} byte(s) but format ${format} ` +
        `(${describeArrayMeshFormat(format)}) over ${vertexCount} vertices needs exactly ` +
        `${expected} (${layout.bytesPerVertex} per vertex` +
        `${splitStream ? ', split-stream' : ''}). Either the layout was computed wrong or the ` +
        'document is not what its format claims; decoding it anyway would produce geometry ' +
        'nobody authored.',
    );
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const octahedral = (format & ARRAY_MESH_FORMAT.FLAG_USE_OCTAHEDRAL_COMPRESSION) !== 0;
  const at32 = (array: number, vertex: number, byte = 0): number =>
    (layout.offsets[array] as number) + vertex * (layout.strides[array] as number) + byte;

  // --- positions ------------------------------------------------------------------------
  const positions = new Float32Array(vertexCount * 3);
  const compressedVertex = (format & ARRAY_MESH_FORMAT.COMPRESS_VERTEX) !== 0;
  for (let v = 0; v < vertexCount; v++) {
    for (let c = 0; c < 3; c++) {
      positions[v * 3 + c] = compressedVertex
        ? halfToFloat(view.getUint16(at32(ARRAY_VERTEX, v, c * 2), true))
        : view.getFloat32(at32(ARRAY_VERTEX, v, c * 4), true);
    }
  }

  const surface: {
    -readonly [K in keyof ArrayMeshSurface]: ArrayMeshSurface[K];
  } = {
    index,
    serialization: 'godot3-array-data',
    format,
    primitive,
    vertexCount,
    indexCount,
    blendShapeCount: blendShapeCountOf(entryOf(value, 'blend_shape_data')),
    positions,
  };

  const material = entryOf(value, 'material');
  if (
    material?.kind === 'ctor' &&
    (material.name === 'SubResource' || material.name === 'ExtResource')
  ) {
    // A binary Godot 3 `.mesh` commonly keeps its material as a standalone `.material`
    // ExtResource. Carry the reference exactly as written; rebuilding a numeric SubResource here
    // silently turns that authored colour into the renderer's default white.
    surface.materialRef = material;
    if (material.name === 'SubResource') {
      const id = material.args[0];
      if (id?.kind === 'number') surface.materialSubResourceId = id.value;
    }
  }

  // --- normals --------------------------------------------------------------------------
  if ((format & ARRAY_MESH_FORMAT.NORMAL) !== 0) {
    const normals = new Float32Array(vertexCount * 3);
    const compressed = (format & ARRAY_MESH_FORMAT.COMPRESS_NORMAL) !== 0;
    const octPair = octahedral && compressed && (format & ARRAY_MESH_FORMAT.TANGENT) !== 0 &&
      (format & ARRAY_MESH_FORMAT.COMPRESS_TANGENT) !== 0;
    // Godot's own float32 constant, applied as a MULTIPLY — the tangent path below divides by a
    // double instead, and the two do not always agree in the last bit.
    const multiplier = Math.fround(1 / 127);
    for (let v = 0; v < vertexCount; v++) {
      let decoded: [number, number, number];
      if (octahedral) {
        decoded = octPair
          ? octToNorm(
              Math.fround(view.getInt8(at32(ARRAY_NORMAL, v, 0)) / 127),
              Math.fround(view.getInt8(at32(ARRAY_NORMAL, v, 1)) / 127),
            )
          : octToNorm(
              Math.fround(view.getInt16(at32(ARRAY_NORMAL, v, 0), true) / 32767),
              Math.fround(view.getInt16(at32(ARRAY_NORMAL, v, 2), true) / 32767),
            );
      } else if (compressed) {
        decoded = [
          Math.fround(view.getInt8(at32(ARRAY_NORMAL, v, 0)) * multiplier),
          Math.fround(view.getInt8(at32(ARRAY_NORMAL, v, 1)) * multiplier),
          Math.fround(view.getInt8(at32(ARRAY_NORMAL, v, 2)) * multiplier),
        ];
      } else {
        decoded = [
          view.getFloat32(at32(ARRAY_NORMAL, v, 0), true),
          view.getFloat32(at32(ARRAY_NORMAL, v, 4), true),
          view.getFloat32(at32(ARRAY_NORMAL, v, 8), true),
        ];
      }
      normals[v * 3] = decoded[0];
      normals[v * 3 + 1] = decoded[1];
      normals[v * 3 + 2] = decoded[2];
    }
    surface.normals = normals;
  }

  // --- tangents -------------------------------------------------------------------------
  if ((format & ARRAY_MESH_FORMAT.TANGENT) !== 0) {
    const tangents = new Float32Array(vertexCount * 4);
    const compressed = (format & ARRAY_MESH_FORMAT.COMPRESS_TANGENT) !== 0;
    const octPair = octahedral && compressed && (format & ARRAY_MESH_FORMAT.NORMAL) !== 0 &&
      (format & ARRAY_MESH_FORMAT.COMPRESS_NORMAL) !== 0;
    for (let v = 0; v < vertexCount; v++) {
      if (octahedral) {
        const x = octPair
          ? Math.fround(view.getInt8(at32(ARRAY_TANGENT, v, 0)) / 127)
          : Math.fround(view.getInt16(at32(ARRAY_TANGENT, v, 0), true) / 32767);
        const y = octPair
          ? Math.fround(view.getInt8(at32(ARRAY_TANGENT, v, 1)) / 127)
          : Math.fround(view.getInt16(at32(ARRAY_TANGENT, v, 2), true) / 32767);
        // `oct_to_tangent`: y carries the binormal SIGN in its own sign bit, and the magnitude
        // is remapped from [0,1] to [-1,1] before the octahedral decode.
        const decoded = octToNorm(x, Math.fround(Math.fround(Math.abs(y) * 2) - 1));
        tangents[v * 4] = decoded[0];
        tangents[v * 4 + 1] = decoded[1];
        tangents[v * 4 + 2] = decoded[2];
        tangents[v * 4 + 3] = sgn(y);
      } else if (compressed) {
        for (let c = 0; c < 4; c++) {
          tangents[v * 4 + c] = view.getInt8(at32(ARRAY_TANGENT, v, c)) / 127;
        }
      } else {
        for (let c = 0; c < 4; c++) {
          tangents[v * 4 + c] = view.getFloat32(at32(ARRAY_TANGENT, v, c * 4), true);
        }
      }
    }
    surface.tangents = tangents;
  }

  // --- colours --------------------------------------------------------------------------
  if ((format & ARRAY_MESH_FORMAT.COLOR) !== 0) {
    const colors = new Float32Array(vertexCount * 4);
    const compressed = (format & ARRAY_MESH_FORMAT.COMPRESS_COLOR) !== 0;
    for (let v = 0; v < vertexCount; v++) {
      for (let c = 0; c < 4; c++) {
        colors[v * 4 + c] = compressed
          ? view.getUint8(at32(ARRAY_COLOR, v, c)) / 255
          : view.getFloat32(at32(ARRAY_COLOR, v, c * 4), true);
      }
    }
    surface.colors = colors;
  }

  // --- UVs ------------------------------------------------------------------------------
  const decodeUvs = (arrayIndex: number, compressed: boolean): Float32Array => {
    const uvs = new Float32Array(vertexCount * 2);
    for (let v = 0; v < vertexCount; v++) {
      for (let c = 0; c < 2; c++) {
        uvs[v * 2 + c] = compressed
          ? halfToFloat(view.getUint16(at32(arrayIndex, v, c * 2), true))
          : view.getFloat32(at32(arrayIndex, v, c * 4), true);
      }
    }
    return uvs;
  };
  if ((format & ARRAY_MESH_FORMAT.TEX_UV) !== 0) {
    surface.uvs = decodeUvs(ARRAY_TEX_UV, (format & ARRAY_MESH_FORMAT.COMPRESS_TEX_UV) !== 0);
  }
  if ((format & ARRAY_MESH_FORMAT.TEX_UV2) !== 0) {
    surface.uv2s = decodeUvs(ARRAY_TEX_UV2, (format & ARRAY_MESH_FORMAT.COMPRESS_TEX_UV2) !== 0);
  }

  // --- skinning -------------------------------------------------------------------------
  if ((format & ARRAY_MESH_FORMAT.BONES) !== 0) {
    const bones = new Uint16Array(vertexCount * 4);
    const wide = (format & ARRAY_MESH_FORMAT.FLAG_USE_16_BIT_BONES) !== 0;
    for (let v = 0; v < vertexCount; v++) {
      for (let c = 0; c < 4; c++) {
        bones[v * 4 + c] = wide
          ? view.getUint16(at32(ARRAY_BONES, v, c * 2), true)
          : view.getUint8(at32(ARRAY_BONES, v, c));
      }
    }
    surface.bones = bones;
  }
  if ((format & ARRAY_MESH_FORMAT.WEIGHTS) !== 0) {
    const weights = new Float32Array(vertexCount * 4);
    const compressed = (format & ARRAY_MESH_FORMAT.COMPRESS_WEIGHTS) !== 0;
    for (let v = 0; v < vertexCount; v++) {
      for (let c = 0; c < 4; c++) {
        weights[v * 4 + c] = compressed
          ? view.getUint16(at32(ARRAY_WEIGHTS, v, c * 2), true) / 65535
          : view.getFloat32(at32(ARRAY_WEIGHTS, v, c * 4), true);
      }
    }
    surface.weights = weights;
  }

  // --- indices --------------------------------------------------------------------------
  if ((format & ARRAY_MESH_FORMAT.INDEX) !== 0 && indexCount > 0) {
    const indexBytes = poolByteArrayOf(
      entryOf(value, 'array_index_data'),
      'array_index_data',
      at,
    );
    const expectedIndexBytes = layout.indexElementSize * indexCount;
    if (indexBytes.length !== expectedIndexBytes) {
      throw new ArrayMeshDecodeError(
        at,
        `\`array_index_data\` is ${indexBytes.length} byte(s) but ${indexCount} indices at ` +
          `${layout.indexElementSize} byte(s) each need ${expectedIndexBytes}`,
      );
    }
    const indexView = new DataView(
      indexBytes.buffer,
      indexBytes.byteOffset,
      indexBytes.byteLength,
    );
    const indices = new Uint32Array(indexCount);
    for (let i = 0; i < indexCount; i++) {
      indices[i] =
        layout.indexElementSize === 2
          ? indexView.getUint16(i * 2, true)
          : indexView.getUint32(i * 4, true);
    }
    surface.indices = indices;
  }

  return surface;
}

function blendShapeCountOf(value: GodotValue | undefined): number {
  if (value === undefined) return 0;
  if (value.kind === 'array') return value.items.length;
  // A single `PoolByteArray(…)` is one blend shape; Godot writes an array of them.
  return 1;
}
