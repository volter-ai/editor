/**
 * Real gltf-transform optimization operations for the Asset Budget window
 * (W4a M3) — bytes in, bytes out, no storage/UI concerns here (headless,
 * unit-tested against generated fixtures).
 *
 *   - `compressModelMeshopt` — reorder + quantize + EXT_meshopt_compression
 *     via gltf-transform's `meshopt()` transform (encoder: `meshoptimizer`).
 *   - `compressModelDraco`   — KHR_draco_mesh_compression via `draco()`
 *     (encoder: `draco3d`). Capability-probed; unavailable throws the probe's
 *     honest reason instead of pretending.
 *   - `compressTexturesKtx2` — KHR_texture_basisu via Binomial's own basis
 *     encoder (vendored wasm, `basis-encoder.ts`). Textures become KTX2;
 *     geometry is untouched.
 *   - `generateLodLevels`    — the W2b "Generate levels" completion: clone a
 *     named node's subtree, `weldPrimitive` + `simplifyPrimitive`
 *     (MeshoptSimplifier) each mesh, and add `<node><suffix>` siblings the
 *     `mesh.lod` schema block can reference by name (entity-factory resolves
 *     LOD levels via getObjectByName inside the SAME glTF). Additive: the
 *     base geometry is untouched, so removing the lod rows restores the
 *     original appearance exactly.
 *
 * Never fabricate success (anti-shim): an op whose codec did not load throws
 * that codec's own reason rather than returning the input unchanged.
 */

import type { Document, Mesh, Node, Texture } from '@gltf-transform/core';
import { KHRTextureBasisu } from '@gltf-transform/extensions';
import {
  draco,
  getGLPrimitiveCount,
  getTextureColorSpace,
  listTextureSlots,
  meshopt,
  prune,
  simplifyPrimitive,
  weldPrimitive,
} from '@gltf-transform/functions';
import {
  type BasisEncoderArtifacts,
  type BasisEncoderModule,
  getBasisEncoder,
} from './basis-encoder';
import { getGltfIO, getMeshoptSimplifier } from './gltf-io';

export interface OptimizeOutcome {
  readonly bytes: Uint8Array;
  readonly beforeBytes: number;
  readonly afterBytes: number;
}

async function readGlb(bytes: Uint8Array): Promise<Document> {
  const { io } = await getGltfIO();
  return io.readBinary(new Uint8Array(bytes));
}

async function writeGlb(document: Document, beforeBytes: number): Promise<OptimizeOutcome> {
  const { io } = await getGltfIO();
  const out = await io.writeBinary(document);
  return { bytes: out, beforeBytes, afterBytes: out.byteLength };
}

/** Meshopt-compress a GLB (EXT_meshopt_compression + quantization). */
export async function compressModelMeshopt(bytes: Uint8Array): Promise<OptimizeOutcome> {
  const { capabilities } = await getGltfIO();
  if (!capabilities.meshoptEncoder.available) {
    throw new Error(capabilities.meshoptEncoder.reason);
  }
  const meshoptModule = await import('meshoptimizer');
  await meshoptModule.MeshoptEncoder.ready;
  const document = await readGlb(bytes);
  await document.transform(meshopt({ encoder: meshoptModule.MeshoptEncoder }));
  return writeGlb(document, bytes.byteLength);
}

/** Draco-compress a GLB (KHR_draco_mesh_compression). */
export async function compressModelDraco(bytes: Uint8Array): Promise<OptimizeOutcome> {
  const { capabilities } = await getGltfIO();
  if (!capabilities.dracoEncoder.available) {
    throw new Error(capabilities.dracoEncoder.reason);
  }
  const document = await readGlb(bytes);
  await document.transform(draco());
  return writeGlb(document, bytes.byteLength);
}

// --- KHR_texture_basisu (KTX2) texture compression ---------------------------

/**
 * Which Basis mode a texture is encoded in.
 *
 * `auto` is the only mode with an opinion, and it is the standard one: ETC1S
 * for ALBEDO-CLASS (sRGB) textures — base color, emissive — because its
 * ~0.3-1 bpp is where the file-size win lives, and UASTC for NON-COLOR data —
 * normal, metallic-roughness, occlusion — because ETC1S's block artifacts
 * corrupt data that is read as vectors and coefficients rather than looked at.
 */
export type Ktx2Mode = 'auto' | 'etc1s' | 'uastc';

export interface Ktx2Options {
  /** Default `auto` — see {@link Ktx2Mode}. */
  readonly mode?: Ktx2Mode;
  /** Encoder artifacts, when the caller already has the bytes (headless
   *  tests). Omitted in the editor, which fetches the vendored copies. */
  readonly artifacts?: BasisEncoderArtifacts;
}

/** Per-texture record of what actually happened — the honest report the UI's
 *  before/after diff is built from. */
export interface Ktx2TextureOutcome {
  readonly name: string;
  /** The glTF slots this texture fills (`baseColorTexture`, …), or `[]`. */
  readonly slots: readonly string[];
  readonly mode: Exclude<Ktx2Mode, 'auto'>;
  readonly beforeBytes: number;
  readonly afterBytes: number;
}

export interface Ktx2CompressionOutcome extends OptimizeOutcome {
  readonly textures: readonly Ktx2TextureOutcome[];
}

/** Basis's own default quality level (`basisu -q 128`). ETC1S REQUIRES one —
 *  left unset, `basisu_frontend::init()` fails outright. */
const ETC1S_QUALITY = 128;

/** The source formats Basis decodes itself, so nothing here needs an image
 *  decoder. Anything else is skipped by name rather than guessed at. */
const DECODABLE_MIME_TYPES = new Set(['image/png', 'image/jpeg']);

function ktx2ModeFor(texture: Texture, requested: Ktx2Mode): 'etc1s' | 'uastc' {
  if (requested !== 'auto') return requested;
  return getTextureColorSpace(texture) === 'srgb' ? 'etc1s' : 'uastc';
}

/**
 * Encode ONE texture's image bytes as KTX2.
 *
 * The output buffer is caller-owned and sized from the texture's real pixel
 * dimensions, not from its compressed byte length: a well-compressed PNG can
 * be a tiny fraction of its raster, and UASTC's fixed 8 bpp plus a full mip
 * chain is not. Uncompressed RGBA (4 bpp) plus the mip tail plus a container
 * allowance is a ceiling no Basis payload for the same image reaches.
 */
function encodeTextureToKtx2(
  basis: BasisEncoderModule,
  texture: Texture,
  mode: 'etc1s' | 'uastc',
): Uint8Array {
  const image = texture.getImage();
  const size = texture.getSize();
  const label = texture.getName() || '(unnamed)';
  if (!image || !size) {
    throw new Error(`Texture "${label}" (${texture.getMimeType()}) has no readable image.`);
  }
  const srgb = getTextureColorSpace(texture) === 'srgb';
  const encoder = new basis.BasisEncoder();
  try {
    encoder.setCreateKTX2File(true);
    // Zstd-supercompress the UASTC payload; ETC1S carries its own BasisLZ.
    encoder.setKTX2UASTCSupercompression(true);
    encoder.setKTX2AndBasisSRGBTransferFunc(srgb);
    encoder.setDebug(false);
    // The encoder narrates every slice to stdout unless told otherwise.
    encoder.setStatusOutput(false);
    encoder.setComputeStats(false);
    encoder.setPerceptual(mode === 'etc1s');
    encoder.setMipGen(true);
    encoder.setMipSRGB(srgb);
    encoder.setUASTC(mode === 'uastc');
    encoder.setQualityLevel(ETC1S_QUALITY);
    const imageType =
      texture.getMimeType() === 'image/png'
        ? basis.ldr_image_type.cPNGImage.value
        : basis.ldr_image_type.cJPGImage.value;
    if (!encoder.setSliceSourceImage(0, image, 0, 0, imageType)) {
      throw new Error(`Basis could not read texture "${label}" (${texture.getMimeType()}).`);
    }
    const [width, height] = size;
    const scratch = new Uint8Array(Math.ceil(width * height * 4 * 1.5) + 64 * 1024);
    const written = encoder.encode(scratch);
    if (written <= 0) {
      throw new Error(`The Basis encoder produced no output for texture "${label}".`);
    }
    return scratch.slice(0, written);
  } finally {
    encoder.delete();
  }
}

/**
 * Re-encode every PNG/JPEG texture in a GLB as KTX2 (`KHR_texture_basisu`).
 *
 * Geometry is untouched — this is the texture-side sibling of the mesh codecs
 * above, and the two compose. Throws, naming the file's actual contents, when
 * there is nothing to compress; a partial success (some textures in a format
 * Basis cannot read) is reported per texture rather than hidden.
 *
 * Size is NOT guaranteed to fall: UASTC is a fixed 8 bpp, so a model whose
 * textures are all normal maps can grow. That is why the outcome carries the
 * real before/after — the Asset Budget shows the diff and only writes after
 * the user confirms it (see `optimize-apply.ts`).
 */
export async function compressTexturesKtx2(
  bytes: Uint8Array,
  options: Ktx2Options = {},
): Promise<Ktx2CompressionOutcome> {
  const document = await readGlb(bytes);
  const root = document.getRoot();
  const candidates = root
    .listTextures()
    .filter((texture) => DECODABLE_MIME_TYPES.has(texture.getMimeType()));
  if (candidates.length === 0) {
    const found = root.listTextures().map((texture) => texture.getMimeType());
    throw new Error(
      found.length === 0
        ? 'This model has no textures to compress — KTX2 compresses images, not geometry (use meshopt or Draco).'
        : `None of this model's ${found.length} texture(s) is a PNG or JPEG that Basis can read (found: ${[...new Set(found)].join(', ')}).`,
    );
  }

  const basis = await getBasisEncoder(options.artifacts);
  const requested = options.mode ?? 'auto';
  const textures: Ktx2TextureOutcome[] = [];

  for (const texture of candidates) {
    const beforeBytes = texture.getImage()?.byteLength ?? 0;
    const mode = ktx2ModeFor(texture, requested);
    const ktx2 = encodeTextureToKtx2(basis, texture, mode);
    textures.push({
      name: texture.getName(),
      slots: listTextureSlots(texture),
      mode,
      beforeBytes,
      afterBytes: ktx2.byteLength,
    });
    texture.setImage(ktx2).setMimeType('image/ktx2');
  }

  document.createExtension(KHRTextureBasisu).setRequired(true);
  const outcome = await writeGlb(document, bytes.byteLength);
  return { ...outcome, textures };
}

// --- simplify() → LOD levels (completes the W2b stub) ------------------------

export interface LodLevelSpec {
  /** Appended to the base node name (`Crate` → `Crate_LOD1`). */
  readonly suffix: string;
  /** Target ratio of vertices to KEEP (0–1). */
  readonly ratio: number;
  /** Simplification error limit (fraction of mesh radius). */
  readonly error: number;
  /** Distance written into the `mesh.lod` row for this level. */
  readonly distance: number;
}

/** Two-level default ladder — coarse but useful, editable per-row afterwards
 *  through the existing W2b distance inputs. */
export const DEFAULT_LOD_LEVELS: readonly LodLevelSpec[] = [
  { suffix: '_LOD1', ratio: 0.5, error: 0.001, distance: 25 },
  { suffix: '_LOD2', ratio: 0.15, error: 0.01, distance: 50 },
];

export interface GeneratedLodLevel {
  readonly node: string;
  readonly ratio: number;
  readonly distance: number;
  /** REAL post-simplification GL-primitive count (measured, not target). */
  readonly triangles: number;
}

export interface LodGenerationOutcome extends OptimizeOutcome {
  readonly baseNode: string;
  readonly baseTriangles: number;
  readonly levels: readonly GeneratedLodLevel[];
}

function subtreeHasSkin(node: Node): boolean {
  if (node.getSkin()) return true;
  return node.listChildren().some(subtreeHasSkin);
}

function subtreeMeshes(node: Node): { node: Node; mesh: Mesh }[] {
  const owner = node.getMesh();
  return [...(owner ? [{ node, mesh: owner }] : []), ...node.listChildren().flatMap(subtreeMeshes)];
}

function subtreeTriangles(node: Node): number {
  return subtreeMeshes(node).reduce(
    (sum, { mesh }) =>
      sum + mesh.listPrimitives().reduce((s, prim) => s + getGLPrimitiveCount(prim), 0),
    0,
  );
}

/**
 * Manually copy a node subtree (gltf-transform forbids `Node.clone()` —
 * parent invariants): new nodes with the same TRS, every name suffixed so
 * level names stay unique and `getObjectByName` stays deterministic, and an
 * OWN `mesh.clone()` per mesh-bearing node so simplification never touches
 * the base geometry.
 */
function copySubtree(document: Document, source: Node, suffix: string): Node {
  const copy = document
    .createNode(source.getName() ? `${source.getName()}${suffix}` : '')
    .setTranslation(source.getTranslation())
    .setRotation(source.getRotation())
    .setScale(source.getScale());
  const mesh = source.getMesh();
  if (mesh) {
    // Mesh.clone() SHARES primitive references (proven by test — simplifying
    // a "cloned" prim mutated the base). Build an own mesh with cloned
    // primitives; accessors are still shared until simplification replaces
    // them on the copy only.
    const ownMesh = document.createMesh(mesh.getName() ? `${mesh.getName()}${suffix}` : '');
    for (const prim of mesh.listPrimitives()) ownMesh.addPrimitive(prim.clone());
    copy.setMesh(ownMesh);
  }
  for (const child of source.listChildren()) copy.addChild(copySubtree(document, child, suffix));
  return copy;
}

/**
 * Generate simplified LOD sibling nodes for `baseNodeName` inside the GLB.
 * Throws (loudly, with the reason) for: missing/unnamed node, skinned
 * subtrees (atomic-subtree rule — same constraint the W2b rows enforce), and
 * name collisions from an earlier generation run.
 */
export async function generateLodLevels(
  bytes: Uint8Array,
  baseNodeName: string,
  levels: readonly LodLevelSpec[] = DEFAULT_LOD_LEVELS,
): Promise<LodGenerationOutcome> {
  const simplifier = await getMeshoptSimplifier();
  const document = await readGlb(bytes);
  const root = document.getRoot();
  const baseNode = root.listNodes().find((node) => node.getName() === baseNodeName);
  if (!baseNode) throw new Error(`Node "${baseNodeName}" was not found in the model.`);
  if (subtreeHasSkin(baseNode)) {
    throw new Error(
      `Node "${baseNodeName}" is (or contains) a skinned mesh — LOD generation cannot lift a skinned subtree (atomic-subtree rule).`,
    );
  }
  if (subtreeMeshes(baseNode).length === 0) {
    throw new Error(`Node "${baseNodeName}" has no mesh to simplify.`);
  }
  const taken = new Set(root.listNodes().map((node) => node.getName()));
  for (const level of levels) {
    if (taken.has(`${baseNodeName}${level.suffix}`)) {
      throw new Error(
        `Node "${baseNodeName}${level.suffix}" already exists — LOD levels appear to be generated already. Remove them first to regenerate.`,
      );
    }
  }

  const baseTriangles = subtreeTriangles(baseNode);
  const parents = baseNode
    .listParents()
    .filter((parent) => parent.propertyType === 'Node' || parent.propertyType === 'Scene');
  const generated: GeneratedLodLevel[] = [];
  for (const level of levels) {
    const clone = copySubtree(document, baseNode, level.suffix);
    for (const { mesh } of subtreeMeshes(clone)) {
      // The copy owns its meshes (copySubtree) — weld + simplify in place.
      for (const prim of mesh.listPrimitives()) {
        weldPrimitive(prim);
        simplifyPrimitive(prim, { simplifier, ratio: level.ratio, error: level.error });
      }
    }
    for (const parent of parents) {
      (parent as Node).addChild(clone);
    }
    generated.push({
      node: `${baseNodeName}${level.suffix}`,
      ratio: level.ratio,
      distance: level.distance,
      triangles: subtreeTriangles(clone),
    });
  }
  // Drop any accessors orphaned by simplification's accessor replacement.
  await document.transform(prune());
  const outcome = await writeGlb(document, bytes.byteLength);
  return { ...outcome, baseNode: baseNodeName, baseTriangles, levels: generated };
}
