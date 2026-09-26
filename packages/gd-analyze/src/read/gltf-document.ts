/**
 * read/gltf-document.ts — the glTF 2.0 JSON, validated onto the subset Godot's importer reads.
 *
 * ## Ground truth
 *
 * The glTF 2.0 specification (Khronos, `glTF/specification/2.0/README.md`) plus the schema files
 * it normatively references. Every property this file reads is cited to its spec section in the
 * declaration below; nothing is inferred from what a fixture happened to contain.
 *
 * ## Enumerate and refuse, never skip
 *
 * The rule `binary-format.ts` states for Godot's binary variants applies here for the same reason:
 * a construct that is present and unread is a scene tree that is quietly wrong. glTF makes this
 * sharper than most formats because it has an EXTENSION mechanism — `extensionsUsed` is a list of
 * things the document says change its meaning — so "I read the core properties" is not a claim
 * that the file was understood.
 *
 * So: every `extensionsUsed` entry must be in {@link HANDLED_EXTENSIONS} or the document is
 * REFUSED BY NAME, and the handled list is short and each entry says what it does to the SCENE
 * TREE (which is all this reader produces). Same for accessor component types, primitive modes,
 * sampler interpolations and animation target paths — an id outside the modelled set names itself
 * in the error.
 *
 * ## What is deliberately not read
 *
 * Vertex data. This reader answers "what node tree does Godot build?", and no vertex, index, UV or
 * bone-weight buffer changes that tree — the mesh's SURFACE COUNT does (it is the primitive count)
 * and its material identity does, and both are in the JSON. Reading 12 MB of vertex buffers to
 * report a node tree would be work with no reader. Accessor DATA is decoded for exactly two
 * things, animation sampler inputs and outputs, because Godot's importer decides a track's
 * existence by comparing its keys against the node's rest pose (`animation/remove_immutable_tracks`
 * — see `gltf-godot-scene.ts`) and a clip's length by its greatest key time.
 *
 * Images. Pixel bytes are unread (they do not change the node tree). File-path `images[i].uri`
 * values ARE collected — see {@link externalImageUrisFromGlb} — because the port copies the
 * `.glb` as opaque bytes and three's `GLTFLoader` then fetches each URI against the model's
 * served directory. Leaving those URIs uncollected shipped Kenney models untextured:
 * `starter-kit-fps` / `starter-kit-city-builder` every `models/*.glb` names
 * `"uri":"Textures/colormap.png"`, the file lives at `models/Textures/colormap.png` in the
 * Godot source, and the port 404'd it. Artifact planning unions the resolved paths into
 * `requiredAssets`; `syncRequiredAssets` copies them.
 */
import { GltfParseError, readGlbContainer } from './glb-container';

/**
 * A Godot `Transform3D`: a 3×3 `Basis` plus an origin. Stored as the basis's three COLUMNS, which
 * is what GDScript's `Basis.x`/`.y`/`.z` return and therefore what the ground-truth dump records.
 * (Godot stores a Basis internally as rows; the column accessors are the public surface, and the
 * two conventions are transposes of each other — a distinction `grid-map.ts` records getting wrong
 * being an easy and silent error.)
 */
export interface Transform3D {
  readonly basisX: readonly [number, number, number];
  readonly basisY: readonly [number, number, number];
  readonly basisZ: readonly [number, number, number];
  readonly origin: readonly [number, number, number];
}

export const IDENTITY_TRANSFORM: Transform3D = {
  basisX: [1, 0, 0],
  basisY: [0, 1, 0],
  basisZ: [0, 0, 1],
  origin: [0, 0, 0],
};

/**
 * SINGLE PRECISION, deliberately. Godot's `real_t` is `float` in a standard build — the pinned
 * dump's own header says `"precision": "single"` — so every basis component the engine holds went
 * through 32-bit rounding. Computing the same expression in JavaScript's doubles and rounding at
 * the end is NOT the same number: `player.glb`'s `r-forearm` rest basis differs in the 6th decimal
 * (`-0.859541` vs `-0.859542`) between the two, which a node-for-node dump comparison catches. So
 * every arithmetic step below is `Math.fround`ed, in the engine's own operation order.
 */
const f = Math.fround;

/**
 * glTF 2.0 §3.5.2 node transform: `matrix`, or the `translation`/`rotation`/`scale` triple
 * composed as `T * R * S`. `rotation` is `[x, y, z, w]`.
 *
 * The rotation half is Godot's `Basis::set_quaternion` (basis.cpp) verbatim, including its
 * `s = 2 / length_squared` — it does NOT assume a unit quaternion, and glTF quaternions are only
 * approximately unit.
 */
export function basisFromQuaternion(
  rotation: readonly [number, number, number, number],
  scale: readonly [number, number, number],
): Transform3D {
  const [x, y, z, w] = rotation;
  const d = f(f(f(x * x) + f(y * y)) + f(f(z * z) + f(w * w)));
  const s = f(2 / d);
  const xs = f(x * s);
  const ys = f(y * s);
  const zs = f(z * s);
  const wx = f(w * xs);
  const wy = f(w * ys);
  const wz = f(w * zs);
  const xx = f(x * xs);
  const xy = f(x * ys);
  const xz = f(x * zs);
  const yy = f(y * ys);
  const yz = f(y * zs);
  const zz = f(z * zs);
  // `Basis::set` takes ROWS; the columns below are its transpose, which is what `Basis.x/.y/.z`
  // return and what the ground-truth dump records.
  const col = (a: number, b: number, c: number, k: number): [number, number, number] => [
    f(a * k),
    f(b * k),
    f(c * k),
  ];
  return {
    basisX: col(f(1 - f(yy + zz)), f(xy + wz), f(xz - wy), scale[0]),
    basisY: col(f(xy - wz), f(1 - f(xx + zz)), f(yz + wx), scale[1]),
    basisZ: col(f(xz + wy), f(yz - wx), f(1 - f(xx + yy)), scale[2]),
    origin: [0, 0, 0],
  };
}

/**
 * The node transform Godot ends up holding — which is NOT `T * R * S` computed once.
 *
 * `_parse_nodes` (gltf_document.cpp:583) applies the three properties as three SETTER calls, in
 * document order, and each setter recomposes the whole basis from what the previous one left:
 * `GLTFNode::set_rotation` is `basis.set_quaternion_scale(q, basis.get_scale())`, and
 * `GLTFNode::set_scale` is `basis = basis.orthonormalized() * Basis::from_scale(s)`
 * (gltf_node.cpp:170) — so a node that declares `scale` sends its rotation through a Gram-Schmidt
 * RE-ORTHONORMALIZATION that a node without `scale` never takes.
 *
 * That recompose is lossy in single precision, and the loss is visible: `player.glb`'s
 * `l-forearm` (which declares `scale`) has a rest basis component the engine holds as `-0.951571`
 * and a one-shot composition produces as `-0.951570`. Which of the two a bone gets therefore
 * depends on whether its glTF node happens to carry a `scale` key — which is why the presence
 * flags are parameters here rather than the values being defaulted before the call.
 */
export function nodeTransform(
  translation: readonly [number, number, number],
  rotation: readonly [number, number, number, number],
  scale: readonly [number, number, number],
  hasRotation: boolean,
  hasScale: boolean,
): Transform3D {
  let basis = IDENTITY_TRANSFORM;
  if (hasRotation) basis = basisFromQuaternion(rotation, basisScale(basis));
  if (hasScale) basis = basisWithScale(basis, scale);
  return { ...basis, origin: [translation[0], translation[1], translation[2]] };
}

/** `GLTFNode::set_scale` (gltf_node.cpp:170): `basis.orthonormalized() * Basis::from_scale(s)`. */
function basisWithScale(t: Transform3D, scale: readonly [number, number, number]): Transform3D {
  const [cx, cy, cz] = orthonormalizedColumns(t);
  const scaled = (v: Vec3, k: number): [number, number, number] => [
    f(v[0] * k),
    f(v[1] * k),
    f(v[2] * k),
  ];
  return {
    basisX: scaled(cx, scale[0]),
    basisY: scaled(cy, scale[1]),
    basisZ: scaled(cz, scale[2]),
    origin: [0, 0, 0],
  };
}

type Vec3 = readonly [number, number, number];

function dot(a: Vec3, b: Vec3): number {
  return f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));
}

function normalize(v: Vec3): Vec3 {
  const length = f(Math.sqrt(dot(v, v)));
  return length === 0 ? v : [f(v[0] / length), f(v[1] / length), f(v[2] / length)];
}

function sub(a: Vec3, b: Vec3, k: number): Vec3 {
  return [f(a[0] - f(b[0] * k)), f(a[1] - f(b[1] * k)), f(a[2] - f(b[2] * k))];
}

/** `Basis::get_scale` — the COLUMN lengths, signed by the determinant. */
export function basisScale(t: Transform3D): Vec3 {
  const det =
    t.basisX[0] * (t.basisY[1] * t.basisZ[2] - t.basisZ[1] * t.basisY[2]) -
    t.basisY[0] * (t.basisX[1] * t.basisZ[2] - t.basisZ[1] * t.basisX[2]) +
    t.basisZ[0] * (t.basisX[1] * t.basisY[2] - t.basisY[1] * t.basisX[2]);
  const sign = det < 0 ? -1 : 1;
  const length = (v: Vec3): number => f(Math.sqrt(dot(v, v)));
  return [
    f(sign * length(t.basisX as Vec3)),
    f(sign * length(t.basisY as Vec3)),
    f(sign * length(t.basisZ as Vec3)),
  ];
}

/**
 * `Basis::get_rotation_quaternion` — orthonormalize (Gram-Schmidt over the columns), flip if the
 * determinant is negative, then `get_quaternion`.
 *
 * This ROUND TRIP is not an identity, and that is the point: Godot's importer compares an
 * animation key against the rotation it extracts from the node's rest BASIS, not against the glTF
 * quaternion it built that basis from. Near a 180° rotation the two differ enormously —
 * `player.glb`'s `HEAD` bone has glTF rotation `[-1, ~0, -7.5e-8, ~0]`, and the extracted
 * quaternion is its negation, so a track whose every key equals the authored value is nonetheless
 * NOT immutable in the engine's eyes and survives. Comparing against the raw glTF quaternion drops
 * two of `player.glb`'s tracks that the engine keeps.
 */
/** `Basis::orthonormalize` — Gram-Schmidt over the columns, every step in float32. */
function orthonormalizedColumns(t: Transform3D): [Vec3, Vec3, Vec3] {
  const cx = normalize(t.basisX as Vec3);
  const cy = normalize(sub(t.basisY as Vec3, cx, dot(cx, t.basisY as Vec3)));
  const cz = normalize(
    sub(sub(t.basisZ as Vec3, cx, dot(cx, t.basisZ as Vec3)), cy, dot(cy, t.basisZ as Vec3)),
  );
  return [cx, cy, cz];
}

export function basisRotationQuaternion(t: Transform3D): readonly [number, number, number, number] {
  let [cx, cy, cz] = orthonormalizedColumns(t);
  const det =
    cx[0] * (cy[1] * cz[2] - cz[1] * cy[2]) -
    cy[0] * (cx[1] * cz[2] - cz[1] * cx[2]) +
    cz[0] * (cx[1] * cy[2] - cy[1] * cx[2]);
  if (det < 0) {
    cx = [-cx[0], -cx[1], -cx[2]];
    cy = [-cy[0], -cy[1], -cy[2]];
    cz = [-cz[0], -cz[1], -cz[2]];
  }
  // `rows[i][j]` is column `j`'s component `i`.
  const rows: readonly Vec3[] = [
    [cx[0], cy[0], cz[0]],
    [cx[1], cy[1], cz[1]],
    [cx[2], cy[2], cz[2]],
  ];
  const at = (i: number, j: number): number => (rows[i] as Vec3)[j] as number;
  const trace = f(f(at(0, 0) + at(1, 1)) + at(2, 2));
  const temp: [number, number, number, number] = [0, 0, 0, 0];
  if (trace > 0) {
    let s = f(Math.sqrt(f(trace + 1)));
    temp[3] = f(s * 0.5);
    s = f(0.5 / s);
    temp[0] = f(f(at(2, 1) - at(1, 2)) * s);
    temp[1] = f(f(at(0, 2) - at(2, 0)) * s);
    temp[2] = f(f(at(1, 0) - at(0, 1)) * s);
  } else {
    const i = at(0, 0) < at(1, 1) ? (at(1, 1) < at(2, 2) ? 2 : 1) : at(0, 0) < at(2, 2) ? 2 : 0;
    const j = (i + 1) % 3;
    const k = (i + 2) % 3;
    let s = f(Math.sqrt(f(f(at(i, i) - at(j, j)) - at(k, k) + 1)));
    temp[i] = f(s * 0.5);
    s = f(0.5 / s);
    temp[j] = f(f(at(j, i) + at(i, j)) * s);
    temp[k] = f(f(at(k, i) + at(i, k)) * s);
    temp[3] = f(f(at(k, j) - at(j, k)) * s);
  }
  return temp;
}

/** glTF 2.0 §3.5.2 `matrix`: 16 floats in COLUMN-MAJOR order, so columns 0..2 are the basis. */
export function transformFromMatrix(m: readonly number[]): Transform3D {
  return {
    basisX: [m[0] as number, m[1] as number, m[2] as number],
    basisY: [m[4] as number, m[5] as number, m[6] as number],
    basisZ: [m[8] as number, m[9] as number, m[10] as number],
    origin: [m[12] as number, m[13] as number, m[14] as number],
  };
}

/**
 * The extensions this reader claims to understand — meaning it has decided what each one does to
 * the NODE TREE, not that it implements the extension's rendering.
 *
 * `KHR_texture_transform` (Khronos ratified) scales/offsets UVs inside a material. It changes what
 * a surface looks like and changes nothing about names, classes, hierarchy, skeletons or
 * animations, so a document using it produces the same tree either way. `character.glb` in the
 * `starter-kit-3d-platformer` fixture declares it.
 *
 * Anything else — `KHR_lights_punctual` would add nodes, `KHR_draco_mesh_compression` would change
 * accessor decoding, `KHR_materials_emissive_strength` would change a material's class in Godot —
 * refuses by name. Adding an entry here means having MEASURED what it does against the oracle.
 */
export const HANDLED_EXTENSIONS: readonly string[] = [
  // Rendering/material extensions do not alter the importer node tree. The native GLTFLoader
  // consumes their payload; this reader only owns names, classes, hierarchy and animation paths.
  'KHR_texture_transform',
  'KHR_materials_unlit',
  'KHR_materials_emissive_strength',
  'KHR_materials_clearcoat',
  'KHR_materials_ior',
  'KHR_materials_iridescence',
  'KHR_materials_sheen',
  'KHR_materials_specular',
  'KHR_materials_transmission',
  'KHR_materials_volume',
  'KHR_materials_anisotropy',
  'KHR_materials_dispersion',
  'KHR_mesh_quantization',
  'EXT_texture_webp',
  'EXT_texture_avif',
  // Unlike the entries above, punctual lights do add imported nodes and are decoded below.
  'KHR_lights_punctual',
];

export interface GltfNode {
  readonly index: number;
  readonly name: string;
  readonly children: readonly number[];
  readonly transform: Transform3D;
  /** glTF 2.0 §3.5.2 `translation`/`rotation`/`scale`, kept undecomposed for track comparison. */
  readonly translation: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
  readonly scale: readonly [number, number, number];
  readonly mesh: number | undefined;
  readonly skin: number | undefined;
  readonly camera: number | undefined;
  readonly punctualLight: number | undefined;
}

export interface GltfCamera {
  readonly type: 'perspective' | 'orthographic';
}

export interface GltfPunctualLight {
  readonly type: 'directional' | 'point' | 'spot';
}

export interface GltfPrimitive {
  readonly material: number | undefined;
}

export interface GltfMesh {
  readonly name: string;
  readonly primitives: readonly GltfPrimitive[];
}

export interface GltfMaterial {
  /** Importer-facing fallback name; empty when the source leaves `name` absent. */
  readonly name: string;
  /** Exact optional source name, retained for native-loader material identity. */
  readonly sourceName?: string;
  /** Exact optional glTF alpha mode, retained for renderer-pipeline planning. */
  readonly alphaMode?: string;
}

export interface GltfSkin {
  readonly name: string;
  readonly joints: readonly number[];
  readonly skeleton: number | undefined;
}

/** One `animation.channel` resolved against its sampler: §3.6.2 + §3.6.3. */
export interface GltfAnimationChannel {
  readonly node: number;
  readonly path: 'translation' | 'rotation' | 'scale';
  /** Sampler `input` accessor decoded — keyframe times in seconds. */
  readonly times: readonly number[];
  /** Sampler `output` accessor decoded — vec3 for translation/scale, vec4 for rotation. */
  readonly values: readonly (readonly number[])[];
}

export interface GltfAnimation {
  readonly name: string;
  readonly channels: readonly GltfAnimationChannel[];
}

export interface GltfDocument {
  readonly sceneName: string | undefined;
  readonly sceneRootNodes: readonly number[];
  readonly nodes: readonly GltfNode[];
  readonly meshes: readonly GltfMesh[];
  readonly materials: readonly GltfMaterial[];
  readonly skins: readonly GltfSkin[];
  readonly animations: readonly GltfAnimation[];
  readonly cameras: readonly GltfCamera[];
  readonly punctualLights: readonly GltfPunctualLight[];
  /** `node index -> parent index`, built the way glTF states it: from each node's `children`. */
  readonly parents: readonly number[];
  /**
   * File-path `images[].uri` values (not `data:` URIs, not `bufferView` embeddings). The shipping
   * half of this document: three's loader fetches each against the model's served directory.
   */
  readonly externalImageUris: readonly string[];
}

/**
 * glTF 2.0 §5.19 `images[i].uri` values that name a FILE beside the document.
 *
 * Skipped, because they are not a file the port can copy:
 *  - missing `uri` — the image lives in the BIN chunk (`bufferView` + `mimeType`);
 *  - `data:` URI — pixels are already inside the JSON;
 *  - a URI with a scheme (`http:`, `blob:`, …) — not a project file.
 *
 * The remaining strings are relative paths (`Textures/colormap.png`). The emitted
 * `src/world.tsx` hands three `gltfLoader.parseAsync(buf, '/models/')` (`world3d.ts`
 * `urlBaseOf`); `LoaderUtils.resolveURL` concatenates that base with the URI, so the
 * served file is `/models/Textures/colormap.png`.
 */
export function externalImageUrisOfGltfJson(json: unknown): string[] {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return [];
  const images = (json as Record<string, unknown>)['images'];
  if (!Array.isArray(images)) return [];
  const out: string[] = [];
  for (const entry of images) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const uri = (entry as Record<string, unknown>)['uri'];
    if (typeof uri !== 'string' || uri.length === 0) continue;
    if (uri.startsWith('data:')) continue;
    if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(uri)) continue;
    out.push(uri);
  }
  return out;
}

/** JSON-chunk `images[].uri` file paths from a `.glb` container. */
export function externalImageUrisFromGlb(bytes: Uint8Array, at: string): string[] {
  return externalImageUrisOfGltfJson(readGlbContainer(bytes, at).json);
}

type Json = Record<string, unknown>;

function obj(value: unknown, at: string, what: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GltfParseError(`${at}: ${what} is not a JSON object`);
  }
  return value as Json;
}

function arr(value: unknown, at: string, what: string): unknown[] {
  if (!Array.isArray(value)) throw new GltfParseError(`${at}: ${what} is not a JSON array`);
  return value;
}

function optArr(value: unknown, at: string, what: string): unknown[] {
  return value === undefined ? [] : arr(value, at, what);
}

function num(value: unknown, at: string, what: string): number {
  if (typeof value !== 'number') throw new GltfParseError(`${at}: ${what} is not a number`);
  return value;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function numbers(value: unknown, count: number, at: string, what: string): number[] {
  const items = arr(value, at, what);
  if (items.length !== count) {
    throw new GltfParseError(`${at}: ${what} has ${items.length} entries, the spec says ${count}`);
  }
  return items.map((item) => num(item, at, what));
}

/**
 * glTF 2.0 §3.6.2.2, accessor component types. Only `FLOAT` is decoded: the normalized-integer
 * encodings are legal for animation output and would need their own de-normalization rule per
 * type, so a document using one refuses by name rather than being read as raw integers.
 */
const COMPONENT_TYPE_NAMES: Readonly<Record<number, string>> = {
  5120: 'BYTE',
  5121: 'UNSIGNED_BYTE',
  5122: 'SHORT',
  5123: 'UNSIGNED_SHORT',
  5125: 'UNSIGNED_INT',
  5126: 'FLOAT',
};

const TYPE_COMPONENT_COUNTS: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

/**
 * Decode one accessor to a flat `number[]` of components.
 *
 * §3.6.1: an accessor reads `count` elements of `type`/`componentType` from a `bufferView`,
 * starting at `byteOffset` within it, striding by the view's `byteStride` (or tightly packed when
 * absent). `sparse` (§3.6.2.3) substitutes a scattered subset of elements and is applied after
 * the base read; silently reading only the base would produce plausible wrong keys.
 */
function decodeAccessor(
  json: Json,
  binary: Uint8Array,
  index: number,
  at: string,
  externalBuffer = false,
): { readonly components: number; readonly values: number[] } {
  const accessors = optArr(json['accessors'], at, 'accessors');
  const accessor = obj(accessors[index], at, `accessors[${index}]`);
  const componentType = num(accessor['componentType'], at, `accessors[${index}].componentType`);
  if (componentType !== 5126) {
    const name = COMPONENT_TYPE_NAMES[componentType] ?? `unknown(${componentType})`;
    throw new GltfParseError(
      `${at}: accessors[${index}] has componentType ${name}; this reader decodes FLOAT only`,
    );
  }
  const type = str(accessor['type'], '');
  const components = TYPE_COMPONENT_COUNTS[type];
  if (components === undefined) {
    throw new GltfParseError(
      `${at}: accessors[${index}] has type "${type}", which glTF 2.0 does not define`,
    );
  }
  const count = num(accessor['count'], at, `accessors[${index}].count`);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new GltfParseError(`${at}: accessors[${index}].count must be a non-negative integer`);
  }
  const views = optArr(json['bufferViews'], at, 'bufferViews');
  const buffers = optArr(json['buffers'], at, 'buffers');
  const bufferJson = obj(buffers[0], at, 'buffers[0]');
  if (typeof bufferJson['uri'] === 'string' && !externalBuffer) {
    throw new GltfParseError(
      `${at}: buffers[0] declares a "uri"; this reader reads the .glb BIN chunk only, not external or data-uri buffers`,
    );
  }
  const dv = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const viewOf = (viewIndex: number, what: string): Json => {
    const view = obj(views[viewIndex], at, `bufferViews[${viewIndex}]`);
    const buffer = num(view['buffer'], at, `bufferViews[${viewIndex}].buffer`);
    if (buffer !== 0) {
      throw new GltfParseError(`${at}: ${what} reads buffer ${buffer}; only buffers[0] is loaded`);
    }
    if (view['extensions'] !== undefined) {
      const extensions = obj(view['extensions'], at, `bufferViews[${viewIndex}].extensions`);
      if (Object.keys(extensions).length > 0) {
        throw new GltfParseError(
          `${at}: ${what} reads compressed bufferView ${viewIndex} (${Object.keys(extensions).join(', ')}); animation accessor decompression is not modelled`,
        );
      }
    }
    return view;
  };
  const viewIndex = accessor['bufferView'];
  const values = new Array<number>(count * components).fill(0);
  if (typeof viewIndex === 'number') {
    const view = viewOf(viewIndex, `accessors[${index}]`);
    const viewOffset = typeof view['byteOffset'] === 'number' ? view['byteOffset'] : 0;
    const accessorOffset = typeof accessor['byteOffset'] === 'number' ? accessor['byteOffset'] : 0;
    const elementSize = components * 4;
    const stride = typeof view['byteStride'] === 'number' ? view['byteStride'] : elementSize;
    const base = viewOffset + accessorOffset;
    for (let i = 0; i < count; i++) {
      const start = base + i * stride;
      if (start + elementSize > binary.byteLength) {
        throw new GltfParseError(
          `${at}: accessors[${index}] element ${i} reads past the buffer (${binary.byteLength} bytes)`,
        );
      }
      for (let c = 0; c < components; c++) values[i * components + c] = dv.getFloat32(start + c * 4, true);
    }
  }

  // §3.6.2.3 sparse accessors replace selected base elements. Animation exporters commonly use
  // this for tracks whose rest pose supplies almost every key; reading only the base silently
  // changes immutable-track detection, so indices and replacement values are applied exactly.
  if (accessor['sparse'] !== undefined) {
    const sparse = obj(accessor['sparse'], at, `accessors[${index}].sparse`);
    const sparseCount = num(sparse['count'], at, `accessors[${index}].sparse.count`);
    if (!Number.isSafeInteger(sparseCount) || sparseCount < 0 || sparseCount > count) {
      throw new GltfParseError(`${at}: accessors[${index}].sparse.count is outside [0, ${count}]`);
    }
    const indices = obj(sparse['indices'], at, `accessors[${index}].sparse.indices`);
    const indicesViewIndex = num(indices['bufferView'], at, `accessors[${index}].sparse.indices.bufferView`);
    const indicesView = viewOf(indicesViewIndex, `accessors[${index}].sparse.indices`);
    const indicesType = num(indices['componentType'], at, `accessors[${index}].sparse.indices.componentType`);
    const indexBytes = indicesType === 5121 ? 1 : indicesType === 5123 ? 2 : indicesType === 5125 ? 4 : 0;
    if (indexBytes === 0) {
      throw new GltfParseError(`${at}: accessors[${index}].sparse indices use invalid componentType ${indicesType}`);
    }
    const indicesBase =
      (typeof indicesView['byteOffset'] === 'number' ? indicesView['byteOffset'] : 0) +
      (typeof indices['byteOffset'] === 'number' ? indices['byteOffset'] : 0);
    const replacements = obj(sparse['values'], at, `accessors[${index}].sparse.values`);
    const replacementsViewIndex = num(replacements['bufferView'], at, `accessors[${index}].sparse.values.bufferView`);
    const replacementsView = viewOf(replacementsViewIndex, `accessors[${index}].sparse.values`);
    const replacementsBase =
      (typeof replacementsView['byteOffset'] === 'number' ? replacementsView['byteOffset'] : 0) +
      (typeof replacements['byteOffset'] === 'number' ? replacements['byteOffset'] : 0);
    for (let sparseIndex = 0; sparseIndex < sparseCount; sparseIndex++) {
      const indexOffset = indicesBase + sparseIndex * indexBytes;
      const target =
        indicesType === 5121
          ? dv.getUint8(indexOffset)
          : indicesType === 5123
            ? dv.getUint16(indexOffset, true)
            : dv.getUint32(indexOffset, true);
      if (target >= count) {
        throw new GltfParseError(`${at}: accessors[${index}].sparse index ${target} exceeds count ${count}`);
      }
      const source = replacementsBase + sparseIndex * components * 4;
      if (source + components * 4 > binary.byteLength) {
        throw new GltfParseError(`${at}: accessors[${index}].sparse values read past the buffer`);
      }
      for (let component = 0; component < components; component++) {
        values[target * components + component] = dv.getFloat32(source + component * 4, true);
      }
    }
  }
  return { components, values };
}

/**
 * Parse a `.glb`'s JSON chunk into {@link GltfDocument}.
 *
 * `at` is the `res://` path, used verbatim in every refusal so a report names the file.
 */
export function readGltfDocument(
  json: unknown,
  binary: Uint8Array,
  at: string,
  externalBuffer = false,
): GltfDocument {
  const root = obj(json, at, 'the JSON chunk');

  const asset = obj(root['asset'], at, 'asset');
  const version = str(asset['version'], '');
  if (!version.startsWith('2.')) {
    throw new GltfParseError(`${at}: asset.version is "${version}"; this reader implements 2.x`);
  }

  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    for (const used of optArr(root[key], at, key)) {
      const name = str(used, '');
      if (!HANDLED_EXTENSIONS.includes(name)) {
        throw new GltfParseError(
          `${at}: ${key} names "${name}", an extension this reader has not measured against the Godot oracle`,
        );
      }
    }
  }

  // §3.5.1 nodes.
  const nodesJson = optArr(root['nodes'], at, 'nodes');
  const nodes: GltfNode[] = nodesJson.map((entry, index) => {
    const node = obj(entry, at, `nodes[${index}]`);
    for (const unread of ['weights']) {
      if (node[unread] !== undefined) {
        throw new GltfParseError(
          `${at}: nodes[${index}] declares "${unread}", which changes the imported tree and this reader does not model`,
        );
      }
    }
    let punctualLight: number | undefined;
    if (node['extensions'] !== undefined) {
      const extensions = obj(node['extensions'], at, `nodes[${index}].extensions`);
      for (const [name, payload] of Object.entries(extensions)) {
        if (name !== 'KHR_lights_punctual') {
          throw new GltfParseError(
            `${at}: nodes[${index}] uses extension "${name}", whose node payload this reader does not model`,
          );
        }
        const light = obj(payload, at, `nodes[${index}].extensions.KHR_lights_punctual`);
        punctualLight = num(
          light['light'],
          at,
          `nodes[${index}].extensions.KHR_lights_punctual.light`,
        );
      }
    }
    const children = optArr(node['children'], at, `nodes[${index}].children`).map((c) =>
      num(c, at, `nodes[${index}].children`),
    );
    const hasMatrix = node['matrix'] !== undefined;
    const hasTrs =
      node['translation'] !== undefined ||
      node['rotation'] !== undefined ||
      node['scale'] !== undefined;
    if (hasMatrix && hasTrs) {
      throw new GltfParseError(
        `${at}: nodes[${index}] declares both "matrix" and TRS properties, which §3.5.2 forbids`,
      );
    }
    const translation = (
      node['translation'] === undefined
        ? [0, 0, 0]
        : numbers(node['translation'], 3, at, `nodes[${index}].translation`)
    ) as [number, number, number];
    const rotation = (
      node['rotation'] === undefined
        ? [0, 0, 0, 1]
        : numbers(node['rotation'], 4, at, `nodes[${index}].rotation`)
    ) as [number, number, number, number];
    const scale = (
      node['scale'] === undefined
        ? [1, 1, 1]
        : numbers(node['scale'], 3, at, `nodes[${index}].scale`)
    ) as [number, number, number];
    return {
      index,
      name: str(node['name'], ''),
      children,
      transform: hasMatrix
        ? transformFromMatrix(numbers(node['matrix'], 16, at, `nodes[${index}].matrix`))
        : nodeTransform(
            translation,
            rotation,
            scale,
            node['rotation'] !== undefined,
            node['scale'] !== undefined,
          ),
      translation,
      rotation,
      scale,
      mesh: typeof node['mesh'] === 'number' ? node['mesh'] : undefined,
      skin: typeof node['skin'] === 'number' ? node['skin'] : undefined,
      camera: typeof node['camera'] === 'number' ? node['camera'] : undefined,
      punctualLight,
    };
  });

  const parents = nodes.map(() => -1);
  for (const node of nodes) {
    for (const child of node.children) {
      if (child < 0 || child >= nodes.length) {
        throw new GltfParseError(
          `${at}: nodes[${node.index}].children names node ${child}, which does not exist`,
        );
      }
      parents[child] = node.index;
    }
  }

  // §5.19 scene / §3.4 scenes.
  const scenesJson = optArr(root['scenes'], at, 'scenes');
  const sceneIndex = typeof root['scene'] === 'number' ? root['scene'] : 0;
  let sceneName: string | undefined;
  let sceneRootNodes: readonly number[] = [];
  if (scenesJson.length > 0) {
    const scene = obj(scenesJson[sceneIndex], at, `scenes[${sceneIndex}]`);
    const named = scene['name'];
    sceneName = typeof named === 'string' ? named : undefined;
    sceneRootNodes = optArr(scene['nodes'], at, `scenes[${sceneIndex}].nodes`).map((n) =>
      num(n, at, `scenes[${sceneIndex}].nodes`),
    );
  }

  // §5.19 images — file-path URIs only. Pixel data (BIN / data:) does not change the tree;
  // the URIs are the shipping fact `requiredAssets` was missing.
  const externalImageUris = externalImageUrisOfGltfJson(root);

  // §3.10 cameras. The importer class (Camera3D/Camera) is the tree fact consumed downstream;
  // projection values stay in the original model and are applied by the native GLTFLoader.
  const cameras: GltfCamera[] = optArr(root['cameras'], at, 'cameras').map((entry, index) => {
    const camera = obj(entry, at, `cameras[${index}]`);
    const type = str(camera['type'], '');
    if (type !== 'perspective' && type !== 'orthographic') {
      throw new GltfParseError(`${at}: cameras[${index}] has unknown type "${type}"`);
    }
    obj(camera[type], at, `cameras[${index}].${type}`);
    return { type };
  });

  const rootExtensions =
    root['extensions'] === undefined ? {} : obj(root['extensions'], at, 'extensions');
  const punctual = rootExtensions['KHR_lights_punctual'];
  const punctualLights: GltfPunctualLight[] =
    punctual === undefined
      ? []
      : arr(
          obj(punctual, at, 'extensions.KHR_lights_punctual')['lights'],
          at,
          'extensions.KHR_lights_punctual.lights',
        ).map((entry, index) => {
          const light = obj(entry, at, `extensions.KHR_lights_punctual.lights[${index}]`);
          const type = str(light['type'], '');
          if (type !== 'directional' && type !== 'point' && type !== 'spot') {
            throw new GltfParseError(
              `${at}: extensions.KHR_lights_punctual.lights[${index}] has unknown type "${type}"`,
            );
          }
          return { type };
        });

  for (const node of nodes) {
    if (node.camera !== undefined && cameras[node.camera] === undefined) {
      throw new GltfParseError(`${at}: nodes[${node.index}] names camera ${node.camera}, which does not exist`);
    }
    if (node.punctualLight !== undefined && punctualLights[node.punctualLight] === undefined) {
      throw new GltfParseError(
        `${at}: nodes[${node.index}] names punctual light ${node.punctualLight}, which does not exist`,
      );
    }
    const authoredKinds = [node.mesh, node.camera, node.punctualLight].filter(
      (value) => value !== undefined,
    );
    if (authoredKinds.length > 1) {
      throw new GltfParseError(
        `${at}: nodes[${node.index}] combines mesh/camera/light payloads; Godot's split-node import shape is not modelled`,
      );
    }
  }

  // §3.7 meshes.
  const meshes: GltfMesh[] = optArr(root['meshes'], at, 'meshes').map((entry, index) => {
    const mesh = obj(entry, at, `meshes[${index}]`);
    if (mesh['weights'] !== undefined) {
      throw new GltfParseError(
        `${at}: meshes[${index}] declares morph-target "weights", not modelled`,
      );
    }
    const primitives = arr(mesh['primitives'], at, `meshes[${index}].primitives`).map((p, pi) => {
      const primitive = obj(p, at, `meshes[${index}].primitives[${pi}]`);
      if (primitive['targets'] !== undefined) {
        throw new GltfParseError(
          `${at}: meshes[${index}].primitives[${pi}] declares morph "targets"; Godot imports those as blend shapes and adds blend-shape animation tracks, which this reader does not model`,
        );
      }
      const mode =
        primitive['mode'] === undefined ? 4 : num(primitive['mode'], at, 'primitives.mode');
      if (!Number.isInteger(mode) || mode < 0 || mode > 6) {
        throw new GltfParseError(
          `${at}: meshes[${index}].primitives[${pi}] has mode ${mode}; glTF defines only 0 through 6`,
        );
      }
      return {
        material: typeof primitive['material'] === 'number' ? primitive['material'] : undefined,
      };
    });
    return { name: str(mesh['name'], ''), primitives };
  });

  // §3.9 materials. The importer transform consumes the fallback name; source name/alpha mode are
  // retained because native-loader material overrides and transparent rendering planning address
  // the same parsed document downstream. Other PBR properties do not shape this data product.
  const materials: GltfMaterial[] = optArr(root['materials'], at, 'materials').map(
    (entry, index) => {
      const material = obj(entry, at, `materials[${index}]`);
      const extensions = material['extensions'];
      if (extensions !== undefined) {
        const extensionMap = obj(extensions, at, `materials[${index}].extensions`);
        for (const name of Object.keys(extensionMap)) {
          if (!HANDLED_EXTENSIONS.includes(name)) {
            throw new GltfParseError(
              `${at}: materials[${index}] uses extension "${name}", not measured against the Godot oracle`,
            );
          }
        }
      }
      const sourceName = material['name'];
      const alphaMode = material['alphaMode'];
      return {
        name: str(sourceName, ''),
        ...(typeof sourceName === 'string' ? { sourceName } : {}),
        ...(typeof alphaMode === 'string' ? { alphaMode } : {}),
      };
    },
  );

  // §3.8 skins.
  const skins: GltfSkin[] = optArr(root['skins'], at, 'skins').map((entry, index) => {
    const skin = obj(entry, at, `skins[${index}]`);
    return {
      name: str(skin['name'], ''),
      joints: arr(skin['joints'], at, `skins[${index}].joints`).map((j) =>
        num(j, at, `skins[${index}].joints`),
      ),
      skeleton: typeof skin['skeleton'] === 'number' ? skin['skeleton'] : undefined,
    };
  });

  // §3.6 animations.
  const animations: GltfAnimation[] = optArr(root['animations'], at, 'animations').map(
    (entry, index) => {
      const animation = obj(entry, at, `animations[${index}]`);
      const samplers = arr(animation['samplers'], at, `animations[${index}].samplers`);
      const channels = arr(animation['channels'], at, `animations[${index}].channels`).flatMap(
        (c, ci): GltfAnimationChannel[] => {
          const channel = obj(c, at, `animations[${index}].channels[${ci}]`);
          const target = obj(channel['target'], at, `animations[${index}].channels[${ci}].target`);
          const path = str(target['path'], '');
          if (path === 'weights') {
            throw new GltfParseError(
              `${at}: animations[${index}].channels[${ci}] targets "weights" (morph targets), not modelled`,
            );
          }
          if (path !== 'translation' && path !== 'rotation' && path !== 'scale') {
            throw new GltfParseError(
              `${at}: animations[${index}].channels[${ci}] targets "${path}", which glTF 2.0 §3.6.2.1 does not define`,
            );
          }
          if (typeof target['node'] !== 'number') return []; // §3.6.2.1: a channel with no node is a no-op.
          const samplerIndex = num(
            channel['sampler'],
            at,
            `animations[${index}].channels[${ci}].sampler`,
          );
          const sampler = obj(
            samplers[samplerIndex],
            at,
            `animations[${index}].samplers[${samplerIndex}]`,
          );
          const interpolation = str(sampler['interpolation'], 'LINEAR');
          if (interpolation !== 'LINEAR' && interpolation !== 'STEP' && interpolation !== 'CUBICSPLINE') {
            throw new GltfParseError(
              `${at}: animations[${index}].samplers[${samplerIndex}] interpolates "${interpolation}"; glTF defines LINEAR, STEP and CUBICSPLINE`,
            );
          }
          const input = decodeAccessor(
            root,
            binary,
            num(sampler['input'], at, 'sampler.input'),
            at,
            externalBuffer,
          );
          const output = decodeAccessor(
            root,
            binary,
            num(sampler['output'], at, 'sampler.output'),
            at,
            externalBuffer,
          );
          const values: number[][] = [];
          for (let i = 0; i < output.values.length; i += output.components) {
            values.push(output.values.slice(i, i + output.components));
          }
          // A cubic spline stores three output elements per input key: in-tangent, value,
          // out-tangent. Godot imports the middle element as the key value; tangents affect the
          // curve between keys but not clip length, track identity, or immutable-track detection.
          const keyValues =
            interpolation === 'CUBICSPLINE'
              ? input.values.map((_, key) => values[key * 3 + 1] as number[])
              : values;
          if (keyValues.length !== input.values.length) {
            throw new GltfParseError(
              `${at}: animations[${index}].samplers[${samplerIndex}] has ${input.values.length} input keys but ${values.length} output elements for ${interpolation}`,
            );
          }
          return [{ node: target['node'], path, times: input.values, values: keyValues }];
        },
      );
      return { name: str(animation['name'], ''), channels };
    },
  );

  return {
    sceneName,
    sceneRootNodes,
    nodes,
    meshes,
    materials,
    skins,
    animations,
    cameras,
    punctualLights,
    parents,
    externalImageUris,
  };
}
