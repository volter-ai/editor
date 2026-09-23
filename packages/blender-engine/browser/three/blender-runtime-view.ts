/** Disposable Three.js presentation of an authoritative Python Blender session.
 * No modeling operations or source builds run here. Stable datablock addresses
 * retain objects/resources; changed meshes replace only their draw geometry.
 */
import * as THREE from 'three';
import { z } from 'zod';
import { bytesFromBase64 } from './blender-base64';
import { ArmatureOverlay, armatureSchema } from './blender-runtime-armature';
import { UNKNOWN_GEOMETRY, UNKNOWN_IMAGE } from './blender-runtime-frame';
import {
  drawArraysFromColumns,
  graphAttributeName,
  drawRuntimeGeometry,
  geometryFromDrawArrays,
} from './blender-runtime-geometry';
import {
  aimLight,
  buildLight,
  fitShadow,
  lightingReady,
  lightSchema,
  ViewportLighting,
  WorldBackground,
  worldSchema,
} from './blender-runtime-lighting';
import { fitModelDirectionalShadow, visibleShadowReceivers } from './blender-runtime-shadows';
import { volumeMesh, volumeSchema } from './blender-runtime-volume';
import { applyPhysicalMaterial, applyWorldExtinction, physicalMaterialSchema } from './blender-physical-material';
import { prepareGraphGeometry, setMaterialGraph } from './blender-graph-material';
import { type CompiledGraph, compileMaterialGraph, graphSeeThrough, materialGraphSchema } from './blender-node-graph';
import {worldMedium, WorldVolumePass} from './blender-world-volume';
import { BlenderTextureSamplers } from './blender-texture-samplers';
import { WeightOverlay, weightsSchema } from './blender-runtime-weights';

const scalar = z.number().finite();
const point = z.tuple([scalar, scalar, scalar]);
const edge = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);
const attributeFields = { name: z.string(), domain: z.enum(['POINT', 'EDGE', 'FACE', 'CORNER']) };
const attributeSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...attributeFields,
      type: z.literal('FLOAT2'),
      data: z.array(z.tuple([scalar, scalar])),
    })
    .strict(),
  z.object({ ...attributeFields, type: z.literal('FLOAT_VECTOR'), data: z.array(point) }).strict(),
  z
    .object({
      ...attributeFields,
      type: z.literal('FLOAT_COLOR'),
      data: z.array(z.tuple([scalar, scalar, scalar, scalar])),
    })
    .strict(),
  z
    .object({
      ...attributeFields,
      type: z.literal('BYTE_COLOR'),
      data: z.array(z.tuple([scalar, scalar, scalar, scalar])),
    })
    .strict(),
  z
    .object({
      ...attributeFields,
      type: z.literal('QUATERNION'),
      data: z.array(z.tuple([scalar, scalar, scalar, scalar])),
    })
    .strict(),
  z
    .object({
      ...attributeFields,
      type: z.literal('FLOAT4'),
      data: z.array(z.tuple([scalar, scalar, scalar, scalar])),
    })
    .strict(),
  z
    .object({
      ...attributeFields,
      type: z.literal('FLOAT4X4'),
      data: z.array(z.array(scalar).length(16)),
    })
    .strict(),
  z
    .object({
      ...attributeFields,
      type: z.literal('INT16_2D'),
      data: z.array(z.tuple([z.number().int(), z.number().int()])),
    })
    .strict(),
  z
    .object({
      ...attributeFields,
      type: z.literal('INT32_2D'),
      data: z.array(z.tuple([z.number().int(), z.number().int()])),
    })
    .strict(),
  z.object({ ...attributeFields, type: z.literal('FLOAT'), data: z.array(scalar) }).strict(),
  z
    .object({ ...attributeFields, type: z.literal('INT'), data: z.array(z.number().int()) })
    .strict(),
  z
    .object({ ...attributeFields, type: z.literal('INT8'), data: z.array(z.number().int()) })
    .strict(),
  z.object({ ...attributeFields, type: z.literal('BOOLEAN'), data: z.array(z.boolean()) }).strict(),
  z.object({ ...attributeFields, type: z.literal('STRING'), data: z.array(z.string()) }).strict(),
]);
const drawArraysSchema = z
  .object({
    positions: z.instanceof(Float32Array),
    normals: z.instanceof(Float32Array).nullable(),
    uv: z.instanceof(Float32Array).nullable(),
    uvLayers: z.array(z.object({name: z.string(), data: z.instanceof(Float32Array)}).strict()).optional(),
    attributeLayers: z.array(z.object({name: z.string(), data: z.instanceof(Float32Array)}).strict()).optional(),
    orco: z.instanceof(Float32Array).nullable().optional(),
    indices: z.instanceof(Uint32Array),
    groups: z.array(
      z
        .object({
          start: z.number().int().nonnegative(),
          count: z.number().int().nonnegative(),
          materialIndex: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    hash: z.string(),
  })
  .strict();
const meshJsonSchema = z
  .object({
    v: z.array(point),
    f: z.array(z.array(z.number().int().nonnegative())),
    e: z.array(edge).optional(),
    edge_order: z.array(edge).optional(),
    m: z.array(z.number().int().nonnegative()).optional(),
    s: z.array(z.boolean()).optional(),
    sharp: z.array(edge).optional(),
    seams: z.array(edge).optional(),
    creases: z.array(z.tuple([scalar, scalar, scalar])).optional(),
    attributes: z.array(attributeSchema).optional(),
    active_uv: z.string().nullable().optional(),
    render_uv: z.string().nullable().optional(),
  })
  .strict();
/** A mesh the presenter already holds: the worker sends the reference rather
 *  than the columns when the store's revision has not moved since the last
 *  frame it sent (`blender-runtime-frame.ts`). A Blender session names no
 *  store -- its revision is the datablock's, accumulated from
 *  `depsgraph_update_post` -- so `store` is optional here. */
const unchangedMeshSchema = z
  .object({
    store: z.number().int().optional(),
    revision: z.number().int(),
    unchanged: z.literal(true),
  })
  .strict();

/**
 * BLENDER'S OWN ARRAYS, as the columns the draw reads.
 *
 * This is the shape the export door emits -- `session.py`'s `foreach_get`
 * reader today, the C++ door later -- and `drawArraysFromColumns` is what
 * draws it, so the presenter takes the columns rather than a drawn mesh. The
 * buffers arrive transferred from the worker (`session-frame.mts` reads them
 * out of the module filesystem), which is why every one is a typed array and
 * none is an array of numbers.
 */
const columnsSchema = z
  .object({
    co: z.instanceof(Float64Array),
    cornerNormal: z.instanceof(Float32Array).optional(),
    orco: z.instanceof(Float32Array).optional(),
    faceStart: z.instanceof(Uint32Array),
    corner: z.instanceof(Uint32Array),
    cornerEdge: z.instanceof(Int32Array),
    edge: z.instanceof(Uint32Array),
    edgeSharp: z.instanceof(Uint8Array),
    edgeSeam: z.instanceof(Uint8Array),
    edgeCrease: z.instanceof(Float32Array),
    material: z.instanceof(Uint32Array),
    smooth: z.instanceof(Uint8Array),
    vertSelect: z.instanceof(Uint8Array),
    vertHide: z.instanceof(Uint8Array),
    edgeSelect: z.instanceof(Uint8Array),
    edgeHide: z.instanceof(Uint8Array),
    faceSelect: z.instanceof(Uint8Array),
    faceHide: z.instanceof(Uint8Array),
  })
  .strict();
const columnAttributeSchema = z
  .object({
    name: z.string(),
    domain: z.enum(['POINT', 'EDGE', 'FACE', 'CORNER']),
    type: z.string(),
    data: z.custom<ArrayBufferView>((value) => ArrayBuffer.isView(value)),
  })
  .strict();
const exportedMeshSchema = z
  .object({
    columns: columnsSchema,
    attributes: z.array(columnAttributeSchema),
    activeUv: z.string().nullable(),
    renderUv: z.string().nullable(),
    counts: z
      .object({
        verts: z.number().int().nonnegative(),
        edges: z.number().int().nonnegative(),
        faces: z.number().int().nonnegative(),
        corners: z.number().int().nonnegative(),
      })
      .strict(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
/** A mesh arrives drawn (the worker's buffers, keyed by the store's content
 *  hash), as the boundary JSON the node lane still sends, or as the reference
 *  above when nothing about it changed. */
const meshSchema = z.union([
  drawArraysSchema,
  exportedMeshSchema,
  meshJsonSchema,
  unchangedMeshSchema,
]);
/** Texture decodes still in flight. A RENDER MUST NOT START BEFORE THEY LAND:
 *  `createImageBitmap` is asynchronous, so a frame drawn in the same turn the
 *  material arrived would use an empty texture and look exactly like the
 *  untextured render this whole path exists to stop. (A RASTER needs no wait:
 *  a `DataTexture` holds its bytes the moment it is built.) */
const pendingTextures = new Set<Promise<void>>();

export async function texturesReady(): Promise<void> {
  while (pendingTextures.size > 0) await Promise.all([...pendingTextures]);
}

/** A PNG's bytes as a three texture, decoded by the browser's own decoder. */
function loadPngTexture(png: Uint8Array): { texture: THREE.Texture; ready: Promise<void> } {
  const blob = new Blob([png as BlobPart], { type: 'image/png' });
  const texture = new THREE.Texture();
  let disposed = false;
  texture.addEventListener('dispose', () => {
    disposed = true;
    texture.image?.close?.();
  });
  // DECODED BOTTOM ROW FIRST, because that is the row Blender's v=0 is. A PNG
  // stores its rows top-down -- this one is a FILE-backed image's own bytes,
  // sent as they sit on disk -- while a UV's v=0 in Blender samples the
  // image's BOTTOM row. A bitmap decoded in the PNG's own order therefore drew
  // every textured surface upside down: measured on `20-rigged-courier`, the
  // courier's painted face came back with the brows below the eyes and the
  // mouth under the hat.
  //
  // The flip has to be asked for HERE and cannot be asked for on the texture:
  // `Texture.flipY` (and `premultiplyAlpha`) are `UNPACK_FLIP_Y_WEBGL` state,
  // which WebGL ignores for an ImageBitmap source -- three says so itself at
  // `three/src/textures/Texture.js:274` (0.180.0), "this property has no
  // effect when using `ImageBitmap`. You need to configure the flip on bitmap
  // creation instead."
  const decoding = createImageBitmap(blob, { imageOrientation: 'flipY' })
    .then((bitmap) => {
      if (disposed) {
        bitmap.close();
        return;
      }
      texture.image = bitmap;
      texture.needsUpdate = true;
    })
    .finally(() => {
      pendingTextures.delete(decoding);
    });
  pendingTextures.add(decoding);
  // Keep a rejection handled even if a document closes before its first
  // render. The owner's ready promise still reports that same failure.
  void decoding.catch(() => {});
  return { texture, ready: decoding };
}

/** A RASTER as a three texture, uploaded with no decode and no flip.
 *
 * The bytes are Blender's own buffer in Blender's own row order -- v=0 first
 * -- and GL's texture origin is bottom-left, so unflipped data puts v=0 where
 * Blender puts it. That is the same place the PNG path has to FLIP to reach,
 * because a PNG stores its rows the other way up. */
function rasterTexture(
  rgba: Uint8Array,
  width: number,
  height: number,
  colorspace: 'sRGB' | 'data',
): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    rgba,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.flipY = false;
  // Blender's own colour space for the picture: an sRGB image is linearised
  // by the sampler, a Non-Color one (a roughness map, a baked remap) is data.
  texture.colorSpace = colorspace === 'data' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A UDIM IMAGE AS A GRAPH SAMPLES IT: every tile a layer of one array texture
 * (each at its layer's origin, the layer as large as the largest tile), and
 * the tile map `blender_tile_lookup` reads -- row 0 each tile's layer (-1 for
 * none), row 1 its offset and scale within the layer, Blender's
 * `GPU_image_tiled` layout.
 */
function udimTextures(
  name: string,
  frame: NonNullable<z.infer<typeof rasterImageSchema>['tiles']>,
  colorspace: 'sRGB' | 'data',
): {tiles: THREE.DataArrayTexture; map: THREE.DataTexture; frame: typeof frame} {
  if (frame.length === 0) throw new Error(`Runtime image ${name} is tiled with no tiles`);
  const width = Math.max(...frame.map(t => t.width));
  const height = Math.max(...frame.map(t => t.height));
  const layers = new Uint8Array(width * height * 4 * frame.length);
  const count = Math.max(...frame.map(t => t.number - 1001)) + 1;
  const map = new Float32Array(count * 2 * 4);
  for (let i = 0; i < count; i++) map[i * 4] = -1;
  frame.forEach((tile, layer) => {
    const rgba = tile.rgba ?? (tile.rgbaBase64 ? bytesFromBase64(tile.rgbaBase64) : undefined);
    if (!rgba) throw new Error(`Runtime image ${name} tile ${tile.number} carries no raster`);
    for (let row = 0; row < tile.height; row++)
      layers.set(rgba.subarray(row * tile.width * 4, (row + 1) * tile.width * 4),
        ((layer * height + row) * width) * 4);
    const index = tile.number - 1001;
    map[index * 4] = layer;
    map.set([0, 0, tile.width / width, tile.height / height], (count + index) * 4);
  });
  const tiles = new THREE.DataArrayTexture(layers, width, height, frame.length);
  tiles.colorSpace = colorspace === 'data' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tiles.magFilter = THREE.LinearFilter;
  tiles.minFilter = THREE.LinearMipmapLinearFilter;
  tiles.generateMipmaps = true;
  tiles.needsUpdate = true;
  const mapTexture = new THREE.DataTexture(map, count, 2, THREE.RGBAFormat, THREE.FloatType);
  mapTexture.magFilter = mapTexture.minFilter = THREE.NearestFilter;
  mapTexture.needsUpdate = true;
  return {tiles, map: mapTexture, frame};
}

/** One image the frame carries in full, in the only two shapes it comes in.
 *
 * A RASTER states its size, because a `DataTexture` cannot be built without
 * one; a FILE's own PNG does not, because the decoder reads it off the bitmap
 * and asking Blender would have decoded the file just to answer
 * (`_image_values.frame_image`). Both carry the REVISION those bytes are. The
 * `*Base64` spellings are the same bytes on a channel with no transfer list
 * (`dispatch.mts`, `runtime_present`). */
const rasterImageSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    rgba: z.instanceof(Uint8Array).optional(),
    rgbaBase64: z.string().optional(),
    /** Blender's `colorspace_settings.name`, reduced to the two the sampler
     *  tells apart. Absent means sRGB. */
    colorspace: z.enum(['sRGB', 'data']).optional(),
    /** A UDIM image's tiles, by tile number (the door's `write_image`). */
    tiles: z.array(z.object({
      number: z.number().int().min(1001),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      rgba: z.instanceof(Uint8Array).optional(),
      rgbaBase64: z.string().optional(),
    }).strict()).optional(),
  })
  .strict();
const pngImageSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    png: z.instanceof(Uint8Array).optional(),
    pngBase64: z.string().optional(),
  })
  .strict();
const frameImageSchema = z.union([rasterImageSchema, pngImageSchema]);

const textureReferenceSchema = z
  .object({
    image: z.object({ name: z.string(), revision: z.number().int().nonnegative() }).strict(),
    /** CLIP is transparent black outside the image, applied in the shader. */
    extension: z.enum(['REPEAT', 'EXTEND', 'MIRROR', 'CLIP']).default('REPEAT'),
    uv: z.string(),
    /** A constant the texture is multiplied by -- Blender's MULTIPLY mix at
     *  full factor, which is what `map * color` already is. */
    tint: z.tuple([scalar, scalar, scalar]).optional(),
  })
  .strict();
const materialSchema = z
  .object({
    name: z.string(),
    color: z.tuple([scalar, scalar, scalar, scalar]),
    roughness: scalar,
    metallic: scalar,
    transmission: scalar,
    ior: scalar,
    physical: physicalMaterialSchema.optional(),
    normal_texture: textureReferenceSchema.optional(),
    normal_strength: scalar.default(1),
    normal_space: z.enum(['TANGENT', 'OBJECT']).default('TANGENT'),
    normal_directx: z.boolean().default(false),
    /** A Base Color image, NAMED. Its bytes travel in the frame's `images`
     *  map, once per `(name, revision)`. */
    texture: textureReferenceSchema.optional(),
    /** A Roughness image, the same way; `roughness` is then the multiplier
     *  (the session sends 1). A linear Map Range on the way arrives already
     *  baked into the picture. */
    roughness_texture: textureReferenceSchema.optional(),
    /** Blender's emission: an Emission surface, or Principled Emission
     *  Color and Strength -- three's `emissive` and `emissiveIntensity`. */
    emission: z
      .object({ color: z.tuple([scalar, scalar, scalar]), strength: scalar })
      .strict()
      .optional(),
    /** The node graph driving a Principled BSDF's or Emission's linked
     *  inputs (`session.py`'s `material_graph`), compiled by
     *  `blender-node-graph.ts`. The constants above still apply to every
     *  input the graph does not carry. */
    graph: materialGraphSchema.optional(),
  })
  .strict();
/** THE FRAME CONTRACT, and the reason it is exported: the C++ export door
 *  (`bpy_web_export.cc`) emits this shape and its gate parses every frame it
 *  produces through THIS schema rather than a transcription of it. Strict in
 *  both directions -- an unrecognized key is rejected and a missing column is
 *  rejected -- so a door/presenter mismatch is a loud failure at the door's
 *  own gate instead of a quiet one on the page. A mismatch is fixed in the
 *  door, never by loosening this. */
export const frameSchema = z
  .object({
    session: z.string(),
    revision: z.number().int().nonnegative(),
    volumes: z.record(z.string(), volumeSchema).default({}),
    lights: z.record(z.string(), lightSchema).default({}),
    world: worldSchema.nullable().default(null),
    meshes: z.record(z.string(), meshSchema),
    materials: z.record(z.string(), materialSchema),
    images: z.record(z.string(), frameImageSchema).default({}),
    objects: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          type: z.enum([
            'MESH',
            'CURVE',
            'SURFACE',
            'FONT',
            'META',
            'ARMATURE',
            'LATTICE',
            'VOLUME',
            'EMPTY',
            'CAMERA',
            'LIGHT',
            'SPEAKER',
            'GREASEPENCIL',
            'POINTCLOUD',
            'LIGHT_PROBE',
          ]),
          mesh: z.string().nullable(),
          volume: z.string().nullable().optional(),
          light: z.string().nullable().optional(),
          materials: z.array(z.string().nullable()),
          matrix: z.array(z.tuple([scalar, scalar, scalar, scalar])).length(4),
          visible: z.boolean(),
          render_visible: z.boolean().default(true),
          selected: z.boolean(),
          parent: z.string().nullable(),
          /** A manual texture space (`[location, size]`), which Generated
           *  coordinates map through; absent means Blender's automatic one,
           *  the evaluated bounds (`blender-graph-material.ts`'s orco). */
          texspace: z.tuple([z.tuple([scalar, scalar, scalar]), z.tuple([scalar, scalar, scalar])]).optional(),
          default_color: z.string().optional(),
        })
        .strict(),
    ),
    active: z.string().nullable(),
    mode: z.string(),
    /** The scene's cameras, so a render can be framed through the one the
     *  scene names (`session.py`'s `draw_camera`). */
    cameras: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
    /** Capabilities the export could not reach, named. Never a refusal: the
     *  mesh or material falls back to what it would have had. */
    warnings: z.array(z.string()).default([]),
    /** The mesh ids this frame carries columns or a reference for. */
    updated: z.array(z.string()).default([]),
    /** `scene.frame_current`. */
    frame: z.number().int().default(0),
    /**
     * THE INSPECTION OVERLAYS (WORK.md §Blender in the tab is Blender,
     * "Inspection parity", I4), keyed by armature OBJECT name. What Blender's
     * own overlay engine READS, never what it draws: per bone a pose matrix, a
     * length, a parent and its flags, plus the armature's display type and
     * `show_in_front`. `blender-runtime-armature.ts` is the drawing.
     */
    armatures: z.record(z.string(), armatureSchema).default({}),
    /** The active object's active vertex group, per vertex
     *  (`blender-runtime-weights.ts`); null when nothing is painted. */
    weights: weightsSchema.nullable().default(null),
  })
  .strict();
type Frame = z.infer<typeof frameSchema>;
/** One render's two poses, in Blender's own (Z-up) frame. */
export interface PhotographRecord {
  /** `scene.camera.matrix_world`, as `session.py::_photograph` sent it. */
  sent: { position: number[]; target: number[]; up: number[] };
  /** The camera the photograph was taken through, carried back through the
   *  model root's world matrix. Equal to `sent`, exactly, or the Blender ->
   *  document conversion is wrong. */
  photographed: { position: number[]; target: number[]; up: number[] };
  /** The render this was taken for: what was asked, not what came out. */
  render: { width: number; height: number; fov: number; orthographic: boolean };
}

export class BlenderRuntimeView {
  readonly root = new THREE.Group();
  private readonly objects = new Map<string, THREE.Object3D>();
  private readonly meshes = new Map<
    string,
    { signature: string; geometry: THREE.BufferGeometry }
  >();
  private readonly volumes = new Map<
    string,
    { signature: string; mesh: ReturnType<typeof volumeMesh> }
  >();
  private readonly materials = new Map<string, THREE.MeshPhysicalMaterial>();
  private readonly lights = new Map<string, THREE.Light>();
  private readonly lighting = new ViewportLighting();
  private readonly world = new WorldBackground();
  /**
   * THE INSPECTION OVERLAYS (I4). They are NOT children of {@link root}, and
   * that is the whole design: an overlay is EDITOR FURNITURE, so its
   * visibility belongs to the viewport's Helpers menu rather than to this
   * presenter, and the door for that is the host's own — a document hands
   * each group to its stage's `setHelper(kind, object)`
   * (`@vgai/editor-sdk/host`, `EditorHostStage`), which marks it
   * `editorHelper`, keeps it out of the hierarchy and the raycast, and turns
   * it on and off with the kind's checkbox. `blender-runtime.document.tsx`
   * is where they are handed over.
   *
   * They therefore carry the Blender → document permutation THEMSELVES
   * ({@link overlayRoots}), because a helper is a scene-root object and does
   * not inherit this root's matrix.
   */
  private readonly armatureOverlay = new ArmatureOverlay();
  private readonly weightOverlay = new WeightOverlay();
  /** The two groups the stage is handed: the Helpers menu owns THEIR
   *  `visible`, and the inner group is what a RENDER stands down (an overlay
   *  is modeling chrome and never appears in a photograph — the same
   *  distinction `applyVisibility` draws for the scene's own objects). */
  private readonly armatureRoot = new THREE.Group();
  private readonly weightRoot = new THREE.Group();
  private rendered = false;
  private readonly fallback = new THREE.MeshPhysicalMaterial({ color: 0xb9bec6, roughness: 0.72 });
  /** Base Color images, by image name -- ONE texture per image however many
   *  materials read it, and the cache OWNS it: a material points at one and
   *  never disposes it. Held with the size and revision the resident bytes
   *  are, because a repaint at the same size is an upload into this texture
   *  while a resize is a new one every material has to be re-pointed at. */
  private readonly textures = new Map<
    string,
    {
      texture: THREE.Texture;
      width: number;
      height: number;
      revision: number;
      png?: Uint8Array;
      ready?: Promise<void>;
      /** A UDIM image's tiles as a graph samples them (`udimTextures`). */
      udim?: {tiles: THREE.DataArrayTexture; map: THREE.DataTexture; frame: NonNullable<z.infer<typeof rasterImageSchema>['tiles']>};
    }
  >();
  /** Which image each material's `map` is currently pointing at. */
  private readonly textureNames = new Map<string, string>();
  /** Which runtime image each material's roughness map is, by material id. */
  private readonly roughnessTextureNames = new Map<string, string>();
  private readonly textureSamplers = new BlenderTextureSamplers();
  /** Each material's graph image samplers, by sampler key. */
  private readonly graphSamplers = new Map<string, Set<string>>();
  /** Compiled graphs by their JSON: a frame re-sends every material. */
  private readonly graphs = new Map<string, CompiledGraph>();

  private compiledGraph(graph: z.infer<typeof materialGraphSchema>): CompiledGraph {
    const text = JSON.stringify(graph);
    let compiled = this.graphs.get(text);
    if (!compiled) {
      compiled = compileMaterialGraph(graph);
      if (this.graphs.size > 256) this.graphs.clear();
      this.graphs.set(text, compiled);
    }
    return compiled;
  }
  private frame: Frame | null = null;
  private readonly retiredSessions = new Set<string>();
  private geometryBuilds = 0;
  /** WHAT THE SESSION SUBMITTED, as the description the worker sent with the
   *  frame (`@volter/blender-engine/browser/protocol.ts`): the same JSON with every
   *  column replaced by `{dtype, length, sha256}`. Kept per mesh id, and
   *  MERGED ACROSS FRAMES, because a present ships columns only for the meshes
   *  whose revision moved and a bare reference for the rest -- so the last
   *  frame alone describes almost nothing, while what is DISPLAYED is the
   *  accumulation. The map follows exactly the rule `this.meshes` follows: a
   *  description is replaced when its columns are re-sent and dropped when the
   *  frame stops naming it. */
  private readonly submittedMeshes = new Map<string, unknown>();
  private submitted: Record<string, unknown> | null = null;
  private submittedSession: string | null = null;
  /** EVERY PHOTOGRAPH THIS TAB TOOK FOR A RENDER: the pose the session sent in
   *  Blender's frame, and the pose the photograph was actually taken from,
   *  back in that same frame (`blender-runtime-host.ts`). Python asserts the
   *  two are equal on every render; this is the record a HARNESS grades, and
   *  it is written before that assertion can throw, so a conversion defect
   *  leaves both poses behind instead of only an exception. */
  private readonly photographs: PhotographRecord[] = [];
  /** WHO WANTS TO KNOW THE MODEL MOVED. The Properties sections read the
   *  engine through the RNA door, and a frame is the one signal in the tab
   *  that says the answers are stale — every mutation presents
   *  (`session.py::dispatch`), so a present is "re-read what you are
   *  showing". Fired after the frame is applied, so a listener that reads
   *  the graph sees the new one. */
  private readonly frameListeners = new Set<() => void>();

  /** Subscribe to frames. Returns the unsubscribe. */
  subscribeFrames(listener: () => void): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  /** The Blender datablock NAME of a presented object, or null when this
   *  object is not one of the engine's (an editor helper, a light three.js
   *  parents under one). It is a lookup by IDENTITY, never by `object.name`:
   *  the frame's own table is what makes an answer here an answer about the
   *  engine rather than about a string that happens to match. */
  blenderObjectName(object: THREE.Object3D): string | null {
    for (const [id, held] of this.objects)
      if (held === object) return this.frame?.objects.find((o) => o.id === id)?.name ?? null;
    return null;
  }

  /**
   * BLENDER'S OWN SELECTION, AS THIS FRAME CARRIES IT — the per-object
   * `selected` flag and the scene's `active`, by Blender datablock NAME.
   *
   * The session exports both on every present, which is what makes the FRAME
   * the state rather than a copy of it: an agent's `select_set` through the
   * script door, an operator that activates what it just created, and a
   * person's click in this editor all land in one place and come back the
   * same way. Nothing in the tab holds a selection of its own —
   * `blender-outliner-authoring.ts` reads this on every frame and overwrites
   * the cache its panels render from.
   *
   * THE ACTIVE OBJECT IS REPORTED SEPARATELY because Blender's own state
   * allows an active object that is not selected, and the Properties editor
   * follows the ACTIVE one while the outline follows the selected set.
   */
  blenderSelection(): { readonly selected: readonly string[]; readonly active: string | null } {
    const frame = this.frame;
    if (frame === null) return { selected: [], active: null };
    return {
      selected: frame.objects.filter((object) => object.selected).map((object) => object.name),
      active: frame.active,
    };
  }

  /**
   * BLENDER'S MODE, PUBLISHED ON THE DOCUMENT'S OWN CONTEXT.
   *
   * `vgai.stage.mode` (U6's context key, `editor-host-door.ts`'s `stage()`) had
   * no reporter at all: Edit Mesh went with the mesh kit and the Model document
   * had no mode strip, so every `when` clause that reads it was answering
   * `null`. The engine HAS a mode — `bpy.context.mode`, and `Object.mode` on the
   * active object, which is what the Outliner's own pose rows key on
   * (`tree_element_pose.cc`: the channels exist only in pose mode) — and the
   * TREE door reports both. So the document publishes it here, on the context it
   * already publishes (`publishContext(view)`), rather than through a second
   * door: `blender-outliner-model.ts` sets it on every read, and the host's
   * `stage()` asks the ACTIVE document's context for it.
   */
  private mode: string | null = null;

  setStageMode(mode: string | null): void {
    this.mode = mode;
  }

  stageMode(): string | null {
    return this.mode;
  }

  /** The inverse: the presented object for a Blender datablock NAME, or null
   *  when this tab is not showing one (a camera, an excluded collection's
   *  member, an object type the presenter draws nothing for). The OUTLINER
   *  needs it — its rows come from the engine by name, and every one that our
   *  viewport can select has to find its way back to a three object through
   *  the frame's own table, never through `object.name`. */
  objectForBlenderName(name: string): THREE.Object3D | null {
    const entry = this.frame?.objects.find((o) => o.name === name);
    return entry === undefined ? null : (this.objects.get(entry.id) ?? null);
  }

  /**
   * Put `next` where `previous` stood — same parent, same id in the object
   * table, same place among its siblings' children.
   *
   * THE ONE CALLER IS THE SKIN (`blender-runtime-skin.ts`): a mesh that turns
   * out to be deformed by an armature has to become a `THREE.SkinnedMesh`, and
   * three has no way to promote a `Mesh` in place. It goes through this method
   * rather than the map directly because the table's KEY is the frame's object
   * id and only this class knows it — a swap that missed the table would be
   * replaced again by the next frame's reuse check, every frame, forever.
   *
   * A `SkinnedMesh` still answers `isMesh`, so the next frame's check
   * (`isMesh === (obj.mesh !== null)`) keeps it and merely re-points its
   * geometry and materials, which is exactly right.
   */
  replacePresentedObject(previous: THREE.Object3D, next: THREE.Object3D): void {
    for (const [id, object] of this.objects)
      if (object === previous) {
        const parent = previous.parent;
        const children = [...previous.children];
        previous.removeFromParent();
        for (const child of children) next.add(child);
        parent?.add(next);
        this.objects.set(id, next);
        return;
      }
  }

  constructor() {
    this.root.name = 'Model';
    // BLENDER IS Z-UP, THREE IS Y-UP: (x, y, z) -> (x, z, -y). Written as the
    // matrix rather than `rotation.x = -Math.PI / 2`, because that Euler is a
    // FLOAT quarter turn -- `Math.cos(-Math.PI / 2)` is 6.12e-17, not 0 -- and
    // this matrix is the one a render inverts to answer with the pose it
    // photographed from (`blender-runtime-host.ts`). An exact signed axis
    // permutation inverts exactly, so that round trip is checkable with no
    // tolerance; the float quarter turn is not, and it also leaves every model
    // rotated by 89.999999999999996 degrees for nothing.
    this.root.matrixAutoUpdate = false;
    this.root.matrix.set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
    this.root.updateMatrixWorld(true);
    // The overlays sit beside the model, not under it (see the fields), so
    // each carries the same permutation. `matrix.copy` rather than a second
    // literal: one spelling of the permutation, and it stays one.
    for (const [group, overlay] of [
      [this.armatureRoot, this.armatureOverlay.group],
      [this.weightRoot, this.weightOverlay.group],
    ] as const) {
      group.matrixAutoUpdate = false;
      group.matrix.copy(this.root.matrix);
      group.add(overlay);
      group.updateMatrixWorld(true);
    }
    this.armatureRoot.name = 'BlenderBones';
    this.weightRoot.name = 'BlenderWeights';
  }

  /**
   * THE OVERLAY GROUPS, for the document to hand to its stage.
   *
   * `kind` is the `HelperVisibility` member whose checkbox owns it: `skeletons`
   * is the Helpers menu's existing Skeletons row, which is Blender's viewport
   * overlay "Bones" checkbox (`View3DOverlay.show_bones`,
   * `rna_space.cc:5125-5129`; `space_view3d.py:7161`) under this editor's own
   * noun; `weights` is a member this unit added, because nothing in the set
   * stood for a vertex-group weight display.
   */
  /**
   * BLENDER'S SOLID-MODE STUDIO, for the document to hand to its stage as
   * `dressing.viewLocked`.
   *
   * It is NOT under the model root, and that is the whole point: Blender's
   * four solid lights are stated in VIEW space and turn with the camera, so
   * the group belongs to the camera the stage draws with, not to the model's
   * own frame. The stage owns that parenting and its teardown; this side only
   * builds the lights and stands them down for a render
   * (`blender-runtime-lighting.ts`).
   */
  studioLights(): THREE.Object3D {
    return this.lighting.group;
  }

  overlayGroups(): readonly { kind: string; object: THREE.Object3D }[] {
    return [
      { kind: 'skeletons', object: this.armatureRoot },
      { kind: 'weights', object: this.weightRoot },
    ];
  }

  /**
   * Light the model the way a RENDER is lit — by the scene's own lights —
   * rather than the way modeling is, by the studio key. `bpy.ops.render.render()`
   * turns this on around its one capture and off again, which is the same
   * distinction Blender draws between its solid viewport and a render.
   */
  async setRendered(rendered: boolean, camera?: THREE.Camera): Promise<void> {
    const extinction = (rendered ? worldMedium(this.frame?.world)?.extinction : null) ?? new THREE.Vector3();
    for (const material of [...this.materials.values(), this.fallback]) applyWorldExtinction(material, extinction);
    // An area light cannot be DRAWN until its lookup tables are uploaded, and a
    // render is one photograph with no second chance at it.
    // A sky is derived off the main thread now, so a render waits for it the
    // same way it waits for area-light tables and image decodes: one
    // photograph, no second chance at it.
    this.rendered = rendered;
    this.lighting.setRendered(rendered);
    // The scene's world is what a render sees past the geometry AND its
    // ambient light; modeling keeps the document's own backdrop and fill.
    if (rendered) this.world.apply(this.root, this.frame?.world ?? null, camera);
    else this.world.clear();
    this.applyVisibility();
    this.applyShadows(rendered, camera);
    // AFTER the applies, because they are what REGISTERS the work. Awaiting
    // first made every one of these a no-op on the first render: `apply` had
    // not started the sky yet, so `worldReady()` saw nothing pending and the
    // photograph went out with an empty sky texture. Measured -- a sky the page
    // had never derived returned a render in 0.08s, which is not fast, it is
    // wrong. One photograph, no second chance at it.
    if (rendered) {
      await lightingReady();
      await Promise.all([...this.textures.values()].map((held) => held.ready));
      await this.world.ready();
    }
  }

  /**
   * Who is drawn, which is a different question in each state.
   *
   * MODELING reads the viewport's visibility and lights nothing the scene
   * owns; a RENDER reads `hide_render` — the flag the Cycles path's own
   * snapshot skipped objects by — and lights exactly the scene's lights.
   */
  /**
   * Shadows, for a render only.
   *
   * The renderer's shadow map is already on (`StageHost`); what is
   * missing is anything opting into it, because MODELING wants none — a
   * shadow across the model is in the way while it is being built, and the
   * viewport has never cast one. So the meshes opt in for the photograph and
   * back out afterwards, and every shadow camera is fitted to the model,
   * whose size no default could know.
   */
  private applyShadows(rendered: boolean, camera?: THREE.Camera): void {
    this.root.updateMatrixWorld(true);
    const boxes: THREE.Box3[] = [];
    for (const object of this.objects.values()) {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) continue;
      mesh.castShadow = rendered;
      mesh.receiveShadow = rendered;
      if (rendered && mesh.visible) {
        const bounds = new THREE.Box3().setFromObject(mesh);
        if (!bounds.isEmpty()) boxes.push(bounds);
      }
    }
    if (!rendered || !boxes.length) return;
    const box = boxes.reduce((all, bounds) => all.union(bounds), new THREE.Box3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const frustum = camera
      ? new THREE.Frustum().setFromProjectionMatrix(
          new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
        )
      : null;
    const receivers = frustum
      ? boxes.flatMap((bounds) => visibleShadowReceivers(bounds, frustum))
      : [];
    for (const light of this.lights.values()) {
      if ((light as THREE.DirectionalLight).isDirectionalLight && camera)
        fitModelDirectionalShadow(light as THREE.DirectionalLight, receivers, boxes);
      else fitShadow(light, sphere.center, sphere.radius);
    }
  }

  /**
   * Draw the frame's overlays, and answer with whatever they could not honour.
   *
   * The armature drawing takes the armature object's matrix from the FRAME
   * rather than from the presented object: a presented object is reparented
   * and premultiplied by its parent's inverse (`applyFrame`), while a pose
   * matrix is in the armature's own object space, so the frame's own absolute
   * matrix is the one that composes.
   */
  private applyOverlays(next: Frame): readonly string[] {
    // THE FRAME'S OWN MATRIX, never the presented object's `matrixWorld`: an
    // object is reparented here and premultiplied by its parent's inverse, and
    // its world matrix also carries the model root's permutation, which both
    // overlay groups carry themselves. Blender's absolute matrix is what
    // composes with a pose matrix and with these groups.
    const blenderMatrix = (name: string): THREE.Matrix4 | null => {
      const entry = next.objects.find((obj) => obj.name === name);
      return entry === undefined
        ? null
        : new THREE.Matrix4().set(...(entry.matrix.flat() as Parameters<THREE.Matrix4['set']>));
    };
    const warnings = [...this.armatureOverlay.apply(next.armatures, blenderMatrix)];
    const painted = next.weights
      ? (this.objects.get(
          next.objects.find((obj) => obj.name === next.weights?.object)?.id ?? '',
        ) as THREE.Mesh | undefined)
      : undefined;
    const weightWarning = this.weightOverlay.apply(
      next.weights,
      painted ?? null,
      next.weights ? blenderMatrix(next.weights.object) : null,
    );
    if (weightWarning !== null) warnings.push(weightWarning);
    return warnings;
  }

  private applyVisibility(): void {
    for (const obj of this.frame?.objects ?? []) {
      const object = this.objects.get(obj.id);
      if (object) object.visible = this.rendered ? obj.render_visible : obj.visible;
      if (!obj.light) continue;
      const light = this.lights.get(obj.light);
      if (light) light.visible = this.rendered && obj.render_visible;
    }
    // AN OVERLAY IS MODELING CHROME AND IS NEVER PHOTOGRAPHED. The same
    // distinction the loop above draws between what the viewport shows and
    // what a render shows: bones and weight colours are drawn while the model
    // is being looked at and stand down for the one capture. It is the INNER
    // group that yields, never the group the Helpers menu owns — the two facts
    // are separate and must not overwrite each other.
    this.armatureOverlay.group.visible = !this.rendered;
    this.weightOverlay.group.visible = !this.rendered;
  }

  applyFrame(input: unknown) {
    // WHAT THIS PRESENTER HELD BEFORE THIS FRAME, read before anything is
    // applied, and carried back to the session in the present's answer.
    //
    // THE PRESENTER IS THE AUTHORITY ON WHAT IT HOLDS -- the session only has a
    // RECORD of what it sent, and the two come apart without either side
    // failing: the worker and its Python session are the host's
    // (`blender-runtime-host.ts` keeps one `BlenderRuntime` for the tab) while
    // this view belongs to the Model DOCUMENT, so closing and reopening that
    // document builds a new view holding nothing while the session's tables
    // still say every mesh and picture crossed. The next frame then ships
    // references to bytes that are gone, and the session learns it only from a
    // refusal it may be unable to satisfy. Reporting the holding is what lets
    // the session correct its own tables BEFORE it decides what to ship.
    const held =
      this.frame === null ? null : { session: this.frame.session, revision: this.frame.revision };
    const next = frameSchema.parse(input);
    if (this.retiredSessions.has(next.session))
      throw new Error(
        'The runtime session was replaced; its delayed frame cannot overwrite the active model',
      );
    if (this.frame?.session === next.session && next.revision < this.frame.revision)
      throw new Error('The runtime frame is older than the displayed model');
    const ids = new Set(next.objects.map((obj) => obj.id));
    if (ids.size !== next.objects.length) throw new Error('Runtime object IDs must be unique');
    const byId = new Map(next.objects.map((obj) => [obj.id, obj]));
    for (const obj of next.objects) {
      if (obj.mesh !== null && !next.meshes[obj.mesh])
        throw new Error(`Missing runtime mesh ${obj.mesh}`);
      if (obj.volume && (!next.volumes[obj.volume] || obj.mesh !== null))
        throw new Error(`Invalid runtime volume ${obj.volume}`);
      if (obj.light && (!next.lights[obj.light] || obj.mesh !== null))
        throw new Error(`Invalid runtime light ${obj.light}`);
      for (const mat of obj.materials)
        if (mat !== null && !next.materials[mat])
          throw new Error(`Missing runtime material ${mat}`);
      const ancestors = new Set([obj.id]);
      let parent = obj.parent;
      while (parent !== null) {
        if (ancestors.has(parent)) throw new Error('Runtime parent cycle');
        ancestors.add(parent);
        const ancestor = byId.get(parent);
        if (!ancestor) throw new Error(`Missing runtime parent ${parent}`);
        parent = ancestor.parent;
      }
    }
    // Prepare all changed geometry before replacing any displayed resource.
    const prepared = new Map<string, { signature: string; geometry: THREE.BufferGeometry }>();
    const preparedVolumes = new Map<
      string,
      { signature: string; mesh: ReturnType<typeof volumeMesh> }
    >();
    try {
      for (const [id, data] of Object.entries(next.volumes)) {
        const signature = JSON.stringify(data);
        if (this.frame?.session === next.session && this.volumes.get(id)?.signature === signature)
          continue;
        preparedVolumes.set(id, { signature, mesh: volumeMesh(data) });
      }
      for (const [id, data] of Object.entries(next.meshes)) {
        if ('unchanged' in data) {
          // A REFERENCE, not geometry: the worker says this store has not been
          // written since the frame it last sent, so the resident
          // BufferGeometry stands. If it is not resident the worker's record
          // is ahead of this presenter — a page reloaded under a still-running
          // session — and saying so by name is what makes it re-send the frame
          // in full (`dispatch.mts`, `runtime_present`).
          if (this.frame?.session === next.session && this.meshes.has(id)) continue;
          throw new Error(
            `${UNKNOWN_GEOMETRY}: the presenter does not hold runtime mesh ${id} (store ${data.store}, revision ${data.revision})`,
          );
        }
        const drawn = 'hash' in data;
        const exported = 'columns' in data;
        // A COLUMN FRAME'S SIGNATURE IS ITS REVISION, not a hash of its
        // buffers: the revision is what the session accumulated from
        // `depsgraph_update_post`, and hashing megabytes to re-derive a fact
        // the engine already stated is the cost the revision exists to avoid.
        const signature = exported
          ? `revision:${data.revision}`
          : drawn
            ? data.hash
            : JSON.stringify(data);
        if (this.frame?.session === next.session && this.meshes.get(id)?.signature === signature)
          continue;
        prepared.set(id, {
          signature,
          geometry: exported
            ? geometryFromDrawArrays(
                drawArraysFromColumns(
                  {
                    ...data.columns,
                    attributes: data.attributes as never,
                    activeUv: data.activeUv,
                    renderUv: data.renderUv,
                  },
                  signature,
                ),
              )
            : drawn
              ? geometryFromDrawArrays(data)
              : drawRuntimeGeometry(data),
        });
      }
    } catch (error) {
      for (const value of prepared.values()) value.geometry.dispose();
      for (const { mesh } of preparedVolumes.values()) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      throw error;
    }
    if (this.frame?.session !== next.session) {
      if (this.frame) this.retiredSessions.add(this.frame.session);
      this.clear();
    }
    for (const [id, value] of preparedVolumes) {
      const old = this.volumes.get(id)?.mesh;
      if (old) {
        old.removeFromParent();
        old.geometry.dispose();
        old.material.dispose();
      }
      this.volumes.set(id, value);
    }
    for (const [id, value] of prepared) {
      this.meshes.get(id)?.geometry.dispose();
      this.meshes.set(id, value);
      this.geometryBuilds++;
    }
    // THE PICTURES THE FRAME BROUGHT, before any material can ask for one. An
    // entry is here only because this session has not sent these bytes at this
    // revision yet (`runtime_session._stage_images`); everything else the
    // materials name is already resident, which is the whole point of the
    // revision.
    for (const [name, data] of Object.entries(next.images)) {
      const held = this.textures.get(name);
      if ('width' in data) {
        const rgba = data.rgba ?? (data.rgbaBase64 ? bytesFromBase64(data.rgbaBase64) : undefined);
        if (!rgba) throw new Error(`Runtime image ${name} carries no raster`);
        const udim = data.tiles ? udimTextures(name, data.tiles, data.colorspace ?? 'sRGB') : undefined;
        if (held?.udim) {
          held.udim.tiles.dispose();
          held.udim.map.dispose();
          delete held.udim;
        }
        // A REPAINT AT THE SAME SIZE IS AN UPLOAD, not a new texture: the
        // bytes go into the resident image and three re-uploads it, so every
        // material pointing at it keeps pointing at it. Native does exactly
        // this with the imbuf.
        if (held && held.width === data.width && held.height === data.height) {
          const image = held.texture.image as { data?: Uint8Array };
          if (image.data) {
            image.data.set(rgba);
            held.texture.needsUpdate = true;
            held.revision = data.revision;
            if (udim) held.udim = udim;
            continue;
          }
        }
        held?.texture.dispose();
        this.textures.set(name, {
          texture: rasterTexture(rgba, data.width, data.height, data.colorspace ?? 'sRGB'),
          width: data.width,
          height: data.height,
          revision: data.revision,
          ...(udim ? {udim} : {}),
        });
        continue;
      }
      // A FILE'S OWN PNG, decoded once here. Its size is the bitmap's, so the
      // cache records none: the next raster for this name, whatever its size,
      // is a rebuild rather than an upload into a texture whose dimensions
      // this side never learned.
      const png = data.png ?? (data.pngBase64 ? bytesFromBase64(data.pngBase64) : undefined);
      if (!png) throw new Error(`Runtime image ${name} carries no bytes`);
      held?.texture.dispose();
      held?.udim?.tiles.dispose();
      held?.udim?.map.dispose();
      const { texture, ready } = loadPngTexture(png);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.textures.set(name, {
        texture,
        ready,
        width: 0,
        height: 0,
        revision: data.revision,
        png: png.slice(),
      });
    }
    for (const [id, data] of Object.entries(next.materials)) {
      const material = this.materials.get(id) ?? new THREE.MeshPhysicalMaterial();
      material.name = data.name;
      // A LINKED BASE COLOUR REPLACES THE SOCKET'S VALUE, it does not multiply
      // it. Python's `_reduce` fills `color` from the Base Color socket's
      // default even when the socket is LINKED (the socket keeps its last
      // constant, and native never draws it), while three multiplies `map` by
      // `material.color` -- so carrying that constant alongside a map tinted
      // every textured surface by a leftover. Measured on `20-rigged-courier`:
      // the painted face's skin photographed (107,59,41) against native's
      // (154,108,77) at the same pixel, from a texture whose own skin is
      // (168,118,84) on both sides.
      //
      // With a map, the only legitimate multiplier is the `tint` a MULTIPLY mix
      // carries; without one it is white. Only a material with NO map draws the
      // constant.
      const tint = data.texture?.tint;
      if (data.texture !== undefined) {
        material.color.setRGB(
          tint?.[0] ?? 1,
          tint?.[1] ?? 1,
          tint?.[2] ?? 1,
          THREE.LinearSRGBColorSpace,
        );
      } else {
        material.color.setRGB(
          data.color[0],
          data.color[1],
          data.color[2],
          THREE.LinearSRGBColorSpace,
        );
      }
      // Alpha is the socket's own fourth channel either way: the reduction
      // carries no alpha on a texture, and Blender's Alpha is a separate
      // Principled socket.
      material.opacity = data.color[3];
      // A graph-driven Alpha, or a Transparent BSDF in a shader mix, is per
      // pixel; the constant cannot say whether the surface is see-through, so
      // such a graph is.
      const transparent = material.opacity < 1 || (data.graph !== undefined && graphSeeThrough(data.graph));
      if (material.transparent !== transparent) {
        material.transparent = transparent;
        material.needsUpdate = true;
      }
      material.roughness = data.roughness;
      material.metalness = data.metallic;
      material.transmission = data.transmission;
      material.ior = data.ior;
      applyPhysicalMaterial(material, data.physical, {
        map: data.texture?.extension === 'CLIP',
        roughness: data.roughness_texture?.extension === 'CLIP',
        normal: data.normal_texture?.extension === 'CLIP',
      });
      const normalName = data.normal_texture?.image.name;
      if (normalName === undefined) {
        if (material.normalMap) {
          this.textureSamplers.delete(`${id}:normal`);
          material.normalMap = null;
          material.needsUpdate = true;
        }
      } else {
        const held = this.textures.get(normalName);
        if (!held) throw new Error(`${UNKNOWN_IMAGE}: missing normal image ${normalName}`);
        const normalMap = this.textureSamplers.get(`${id}:normal`, held.texture, data.normal_texture!.extension, held.ready, data.normal_texture!.uv);
        if (material.normalMap !== normalMap) {
          material.normalMap = normalMap;
          material.needsUpdate = true;
        }
        const normalType = data.normal_space === 'OBJECT' ? THREE.ObjectSpaceNormalMap : THREE.TangentSpaceNormalMap;
        if (material.normalMapType !== normalType) {
          material.normalMapType = normalType;
          material.needsUpdate = true;
        }
        material.normalScale.set(data.normal_strength, data.normal_strength * (data.normal_directx ? -1 : 1));
      }
      if (data.emission) {
        material.emissive.setRGB(
          data.emission.color[0],
          data.emission.color[1],
          data.emission.color[2],
          THREE.LinearSRGBColorSpace,
        );
        material.emissiveIntensity = data.emission.strength;
      } else {
        material.emissive.setRGB(0, 0, 0);
        material.emissiveIntensity = 1;
      }
      // THE ROUGHNESS MAP, the same picture cache and the same wrap rule as
      // the Base Color map below; three reads its green channel, and the
      // session bakes a grey raster.
      const roughnessWanted = data.roughness_texture?.image.name ?? null;
      if (roughnessWanted === null) {
        if (this.roughnessTextureNames.has(id)) {
          this.textureSamplers.delete(`${id}:roughness`);
          material.roughnessMap = null;
          this.roughnessTextureNames.delete(id);
          material.needsUpdate = true;
        }
      } else {
        const heldRoughness = this.textures.get(roughnessWanted);
        if (!heldRoughness)
          throw new Error(
            `${UNKNOWN_IMAGE}: the presenter does not hold runtime image ${roughnessWanted} ` +
              `(revision ${data.roughness_texture!.image.revision})`,
          );
        const roughnessMap = this.textureSamplers.get(`${id}:roughness`, heldRoughness.texture,
          data.roughness_texture!.extension, heldRoughness.ready, data.roughness_texture!.uv);
        if (material.roughnessMap !== roughnessMap) {
          material.roughnessMap = roughnessMap;
          this.roughnessTextureNames.set(id, roughnessWanted);
          material.needsUpdate = true;
        }
      }
      // THE AUTHORED TEXTURE. Without it a Base Color link rendered as the
      // socket's default and the image never reached a pixel -- measured as a
      // byte-identical render with and without one. Blender's Base Color is an
      // sRGB-encoded image, so the texture says so and three linearises it.
      const wanted = data.texture?.image.name ?? null;
      if (wanted === null) {
        if (this.textureNames.has(id)) {
          this.textureSamplers.delete(`${id}:color`);
          material.map = null;
          this.textureNames.delete(id);
          material.needsUpdate = true;
        }
      } else {
        // The picture belongs to the CACHE, put there by the `images` loop
        // above from an entry this frame carried. Not holding it is a refusal
        // by name, which the session answers by staging every image again
        // (`runtime_session.present`); the case it exists for is a page that
        // reloaded while its Python session kept running.
        const held = this.textures.get(wanted);
        if (!held)
          throw new Error(
            `${UNKNOWN_IMAGE}: the presenter does not hold runtime image ${wanted} ` +
              `(revision ${data.texture!.image.revision})`,
          );
        const map = this.textureSamplers.get(`${id}:color`, held.texture, data.texture!.extension, held.ready, data.texture!.uv);
        // RE-POINTED WHENEVER THE TEXTURE OBJECT CHANGED, which is how a
        // RESIZED image reaches a material: the cache disposes the old texture
        // and builds a new one. A repaint at the same size keeps this exact
        // object and uploads into it, so there is nothing to do here.
        if (material.map !== map) {
          material.map = map;
          this.textureNames.set(id, wanted);
          material.needsUpdate = true;
        }
      }
      // THE NODE GRAPH, when the session shipped one: compiled once per
      // distinct graph, its images through the same cache and per-input
      // sampler ownership as the maps above.
      const graph = data.graph ? this.compiledGraph(data.graph) : null;
      const graphSamplers = new Set<string>();
      setMaterialGraph(material, graph, (image) => {
        const held = this.textures.get(image.name);
        if (!held)
          throw new Error(
            `${UNKNOWN_IMAGE}: the presenter does not hold runtime image ${image.name} ` +
              `(revision ${image.revision})`,
          );
        if (image.tiled) {
          if (!held.udim) throw new Error(`${UNKNOWN_IMAGE}: runtime image ${image.name} arrived without its UDIM tiles`);
          return held.udim;
        }
        const key = `${id}:graph:${image.node}`;
        graphSamplers.add(key);
        const texture = this.textureSamplers.get(key, held.texture, image.extension, held.ready);
        const filter = image.closest ? THREE.NearestFilter : THREE.LinearFilter;
        const minFilter = image.closest ? THREE.NearestFilter
          : image.mipmap ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
        if (texture.magFilter !== filter || texture.minFilter !== minFilter) {
          texture.magFilter = filter;
          texture.minFilter = minFilter;
          texture.needsUpdate = true;
        }
        return texture;
      });
      for (const key of this.graphSamplers.get(id) ?? []) if (!graphSamplers.has(key)) this.textureSamplers.delete(key);
      this.graphSamplers.set(id, graphSamplers);
      this.materials.set(id, material);
    }
    for (const obj of next.objects) {
      let object = this.objects.get(obj.id);
      const volume = obj.volume ? this.volumes.get(obj.volume)!.mesh : null;
      if (
        !object ||
        (volume
          ? object !== volume
          : Boolean((object as THREE.Mesh).isMesh) !== (obj.mesh !== null))
      ) {
        object?.removeFromParent();
        object =
          volume ??
          (obj.mesh !== null
            ? new THREE.Mesh(this.meshes.get(obj.mesh)!.geometry, this.fallback)
            : new THREE.Object3D());
        this.objects.set(obj.id, object);
      }
      object.name = obj.name;
      object.matrixAutoUpdate = false;
      object.matrix.set(...(obj.matrix.flat() as Parameters<THREE.Matrix4['set']>));
      if (obj.parent) {
        const parent = new THREE.Matrix4().set(
          ...(byId.get(obj.parent)!.matrix.flat() as Parameters<THREE.Matrix4['set']>),
        );
        object.matrix.premultiply(parent.invert());
      }
      object.matrix.decompose(object.position, object.quaternion, object.scale);
      if (obj.texspace) object.userData['blenderTexspace'] = obj.texspace;
      else delete object.userData['blenderTexspace'];
      if (obj.default_color !== undefined) object.userData['blenderDefaultColor'] = obj.default_color;
      else delete object.userData['blenderDefaultColor'];
      if (obj.mesh !== null) {
        const mesh = object as THREE.Mesh;
        mesh.geometry = this.meshes.get(obj.mesh)!.geometry;
        mesh.material = obj.materials.length
          ? obj.materials.map((id) => (id === null ? this.fallback : this.materials.get(id)!))
          : this.fallback;
        prepareGraphGeometry(mesh);
      }
      if (obj.light) {
        // The light hangs on its object's own node, so the object's matrix
        // aims it: a Blender light emits down its local -Z, exactly like a
        // camera, and `aimLight` puts the three.js target on that axis.
        const previous = this.lights.get(obj.light) ?? null;
        const light = buildLight(next.lights[obj.light]!, previous);
        if (previous && previous !== light) {
          previous.removeFromParent();
          previous.dispose();
        }
        if (light.parent !== object) object.add(light);
        aimLight(light, object);
        this.lights.set(obj.light, light);
      }
    }
    for (const obj of next.objects) {
      const object = this.objects.get(obj.id)!;
      const parent = obj.parent === null ? this.root : this.objects.get(obj.parent)!;
      if (object.parent !== parent) parent.add(object);
    }
    for (const [id, object] of this.objects)
      if (!ids.has(id)) {
        object.removeFromParent();
        this.objects.delete(id);
      }
    for (const [id, value] of this.volumes)
      if (!next.volumes[id]) {
        value.mesh.geometry.dispose();
        value.mesh.material.dispose();
        this.volumes.delete(id);
      }
    for (const [id, value] of this.meshes)
      if (!next.meshes[id]) {
        value.geometry.dispose();
        this.meshes.delete(id);
      }
    for (const [id, material] of this.materials)
      if (!next.materials[id]) {
        for (const slot of ['normal', 'roughness', 'color']) this.textureSamplers.delete(`${id}:${slot}`);
        for (const key of this.graphSamplers.get(id) ?? []) this.textureSamplers.delete(key);
        this.graphSamplers.delete(id);
        material.dispose();
        this.materials.delete(id);
      }
    for (const [id, light] of this.lights)
      if (!next.lights[id]) {
        light.removeFromParent();
        light.dispose();
        this.lights.delete(id);
      }
    this.root.updateMatrixWorld(true);
    // Keep the frame's identity and object table, not its geometry payloads:
    // a presented mesh is already resident as its BufferGeometry, and the
    // nested number arrays it arrived as cost ~15x their JSON (the blower's
    // last frame held 850 MB of main-thread heap this way, measured
    // 2026-09-13). Reuse checks compare the per-mesh signatures kept above.
    this.frame = { ...next, meshes: {}, volumes: {} };
    // THE OVERLAYS, after the graph stands: the weight drawing is laid over
    // the presented mesh's own geometry and the bones over the armature
    // OBJECT's Blender matrix, so both need this frame's objects in place.
    const overlayWarnings = this.applyOverlays(next);
    if (overlayWarnings.length)
      this.frame = { ...this.frame, warnings: [...this.frame.warnings, ...overlayWarnings] };
    // Visibility is read off the frame, so it is applied once the frame stands.
    this.applyVisibility();
    // The model moved: whoever is READING the engine (the Properties sections
    // through the RNA door) re-reads now, with the new graph already standing.
    for (const listener of [...this.frameListeners]) listener();
    return { ...this.inspect(), held };
  }

  inspect() {
    return {
      session: this.frame?.session,
      revision: this.frame?.revision,
      active: this.frame?.active,
      mode: this.frame?.mode,
      geometryBuilds: this.geometryBuilds,
      objects: [...this.objects].map(([id, object]) => ({
        id,
        name: object.name,
        uuid: object.uuid,
        geometry: (object as THREE.Mesh).geometry?.uuid,
        visible: object.visible,
      })),
    };
  }

  snapshot() {
    return this.frame;
  }

  /**
   * A revision-owned render presenter, never a clone of the mounted scene.
   * Copy the resident draw arrays and image bytes synchronously, then rebuild
   * through the same frame contract. No live objects, callbacks, textures or
   * disposable geometry cross this boundary; delta-only frames are sufficient.
   * The caller owns this snapshot and must dispose it on every outcome.
   */
  captureSnapshot() {
    const source = this.frame;
    if (!source) throw new Error('Blender capture requires a presented frame');
    // Inspection overlays are not render content. In particular weight-paint
    // overlays reference source vertices, which the evaluated draw no longer
    // needs and a render snapshot deliberately does not copy.
    const frame: Frame = structuredClone({ ...source, images: {}, armatures: {}, weights: null });
    for (const [id, { signature, geometry }] of this.meshes) {
      const attribute = (name: string): Float32Array<ArrayBuffer> | null => {
        const value = geometry.getAttribute(name);
        if (!value) return null;
        if (!(value instanceof THREE.BufferAttribute))
          throw new Error(`Blender capture cannot copy interleaved ${name}`);
        return new Float32Array(value.array);
      };
      const positions = attribute('position');
      if (!positions) throw new Error(`Blender capture mesh ${id} has no positions`);
      const index = geometry.getIndex();
      frame.meshes[id] = {
        hash: signature,
        positions,
        normals: attribute('normal'),
        uv: attribute('uv'),
        uvLayers: Object.entries(geometry.userData['blenderUvChannels'] as Record<string, number> ?? {}).map(([name, channel]) => {
          const data = attribute(`uv${channel}`);
          if (!data) throw new Error(`Blender capture mesh ${id} is missing UV layer ${name}`);
          return {name, data};
        }),
        orco: geometry.userData['blenderOrcoFromDoor'] ? attribute('blenderOrco') : null,
        attributeLayers: (geometry.userData['blenderAttributes'] as string[] | undefined ?? []).map(name => {
          const data = attribute(graphAttributeName(name));
          if (!data) throw new Error(`Blender capture mesh ${id} is missing attribute ${name}`);
          return {name, data};
        }),
        indices: index
          ? new Uint32Array(index.array)
          : Uint32Array.from({ length: positions.length / 3 }, (_, i) => i),
        groups: geometry.groups.map((group) => ({
          start: group.start,
          count: group.count,
          materialIndex: group.materialIndex ?? 0,
        })),
      };
    }
    for (const [id, { signature }] of this.volumes)
      frame.volumes[id] = volumeSchema.parse(JSON.parse(signature));
    const images = new Set(
      Object.values(frame.materials).flatMap((material) =>
        [
          material.texture?.image.name,
          material.roughness_texture?.image.name,
          material.normal_texture?.image.name,
          // The images a material's node graph samples.
          ...Object.values(material.graph?.nodes ?? {}).map(
            (node) => (node.props['image'] as { name?: string } | null | undefined)?.name,
          ),
        ].filter((name): name is string => name !== undefined),
      ),
    );
    for (const name of images) {
      const held = this.textures.get(name);
      if (!held) throw new Error(`Blender capture image ${name} is not resident`);
      if (held.png) {
        frame.images[name] = { revision: held.revision, png: held.png.slice() };
      } else {
        const data = held.texture.image?.data;
        if (!(data instanceof Uint8Array))
          throw new Error(`Blender capture image ${name} has no resident raster`);
        frame.images[name] = {
          revision: held.revision,
          width: held.width,
          height: held.height,
          rgba: data.slice(),
          colorspace: held.texture.colorSpace === THREE.NoColorSpace ? 'data' : 'sRGB',
          ...(held.udim ? {tiles: held.udim.frame} : {}),
        };
      }
    }
    const effect = this.createWorldVolumePass();
    const detached = new BlenderRuntimeView();
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      effect?.dispose();
      detached.dispose();
      detached.root.removeFromParent();
    };
    try {
      detached.applyFrame(frame);
      this.root.updateWorldMatrix(true, false);
      detached.root.matrix.copy(this.root.matrixWorld);
      detached.root.updateMatrixWorld(true);
    } catch (error) {
      dispose();
      throw error;
    }
    return {
      effect,
      root: detached.root,
      session: source.session,
      revision: source.revision,
      prepare: (camera: THREE.Camera) => {
        if (disposed) throw new Error('Blender capture snapshot is disposed');
        return detached.setRendered(true, camera);
      },
      dispose,
    };
  }

  createWorldVolumePass(): WorldVolumePass | undefined {
    const medium = worldMedium(this.frame?.world);
    return medium ? new WorldVolumePass(medium) : undefined;
  }

  /** Keep the description that arrived with this frame. Called by the tab's
   *  Blender host right after `applyFrame`, so a refused frame records
   *  nothing: the record must describe what is DISPLAYED. */
  recordPresentation(description: unknown): void {
    if (typeof description !== 'object' || description === null) return;
    const next = description as Record<string, unknown>;
    const meshes = next['meshes'];
    if (typeof meshes !== 'object' || meshes === null) return;
    const session = typeof next['session'] === 'string' ? next['session'] : null;
    if (session !== this.submittedSession) {
      // A NEW SESSION IS A NEW MODEL. Both records go with the old one, the
      // same way the displayed objects do (`clear`).
      this.submittedMeshes.clear();
      this.photographs.length = 0;
      this.submittedSession = session;
    }
    const held = meshes as Record<string, unknown>;
    for (const [id, mesh] of Object.entries(held))
      if (typeof mesh === 'object' && mesh !== null && !('unchanged' in mesh))
        this.submittedMeshes.set(id, mesh);
    for (const id of [...this.submittedMeshes.keys()])
      if (!(id in held)) this.submittedMeshes.delete(id);
    this.submitted = { ...next, meshes: Object.fromEntries(this.submittedMeshes) };
  }

  /** Keep what a render photographed. One entry per render, in order. */
  recordPhotograph(record: PhotographRecord): void {
    this.photographs.push(record);
  }

  /** THE OBSERVATION DOOR onto both records, for whoever is grading this tab
   *  from outside (`packages/blender-engine/bench/battery/capture_live_model.mts`
   *  reads it through the editor's document REPL and writes the two files a
   *  replay compares). Nothing in the product reads it. */
  observations() {
    return { presentation: this.submitted, photographs: this.photographs };
  }

  private clear() {
    for (const light of this.lights.values()) {
      light.removeFromParent();
      light.dispose();
    }
    this.lights.clear();
    for (const object of this.objects.values()) object.removeFromParent();
    for (const value of this.meshes.values()) value.geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    for (const { mesh } of this.volumes.values()) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    // The pictures go with the session that sent them: the cache OWNS every
    // texture in it (a material only points at one), so this is the one place
    // they are disposed, beside the meshes for the same reason.
    for (const { texture, udim } of this.textures.values()) {
      texture.dispose();
      udim?.tiles.dispose();
      udim?.map.dispose();
    }
    this.textures.clear();
    this.textureNames.clear();
    this.roughnessTextureNames.clear();
    this.textureSamplers.clear();
    this.volumes.clear();
    this.objects.clear();
    this.meshes.clear();
    this.materials.clear();
  }

  dispose() {
    this.clear();
    this.fallback.dispose();
    this.lighting.dispose();
    this.world.dispose();
    this.armatureOverlay.dispose();
    this.weightOverlay.dispose();
    this.frame = null;
    this.retiredSessions.clear();
    this.submittedMeshes.clear();
    this.submitted = null;
    this.submittedSession = null;
    this.photographs.length = 0;
  }
}

/**
 * THE MODEL DOCUMENT'S ONE PRESENTATION, module-scoped because the Python
 * session outlives workspace switches and document remounts and its presented
 * graph must too (`blender-runtime.document.tsx` says so where it mounts it).
 *
 * It is exported so the TIMELINE can reach the same graph: binding a skeleton
 * is a change to the presented objects, and there is exactly one set of those.
 * A new Python session replaces its contents through `applyFrame`'s session
 * address, not by constructing a second view.
 */
export const blenderModelView = new BlenderRuntimeView();
