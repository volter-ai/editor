import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createImageBitmapFromBlob, NodeImageData, NodeOffscreenCanvas } from '../bake/node-image';
import { disposeObject3D } from '../bake/object3d-lifecycle';

const polyfillKeys = [
  'self',
  'ProgressEvent',
  'createImageBitmap',
  'FileReader',
  'ImageData',
  'OffscreenCanvas',
] as const;

function arrayBufferToBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/**
 * The browser globals three's GLTF exporter and loader reach for, supplied
 * for Node. Returns the restore function; never overwrites a global that
 * already exists, so a real browser (or a jsdom-flavoured test) keeps its
 * own.
 *
 * `ImageData` + `OffscreenCanvas` + a real `createImageBitmap` are the
 * TEXTURE half, and they are what make a material MAP survive the bake:
 * `GLTFExporter.processImage` draws a `DataTexture` into
 * `getCanvas()` — which prefers `OffscreenCanvas` precisely when
 * `document` is undefined — via `new ImageData(...)`, then asks
 * `convertToBlob` for the PNG bytes it embeds; `GLTFLoader` reverses that
 * through `ImageBitmapLoader`, whose `createImageBitmap` used to be
 * stubbed here to an empty object, so every re-imported texture came back
 * with no pixels behind it. All three live in `node-image.ts`.
 */
export function installNodeThreePolyfills(): () => void {
  const target = globalThis as unknown as Record<string, unknown>;
  const previous = new Map(
    polyfillKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  if (!target['self']) target['self'] = globalThis;
  if (!target['ImageData']) target['ImageData'] = NodeImageData;
  if (!target['OffscreenCanvas']) target['OffscreenCanvas'] = NodeOffscreenCanvas;
  if (!target['ProgressEvent']) {
    target['ProgressEvent'] = class {
      readonly type: string;
      constructor(type: string, init: Record<string, unknown> = {}) {
        this.type = type;
        Object.assign(this, init);
      }
    };
  }
  if (!target['createImageBitmap']) target['createImageBitmap'] = createImageBitmapFromBlob;
  if (!target['FileReader']) {
    target['FileReader'] = class {
      result: string | ArrayBuffer | null = null;
      onloadend: (() => void) | null = null;
      readAsArrayBuffer(blob: Blob): void {
        void blob.arrayBuffer().then((value) => {
          this.result = value;
          this.onloadend?.();
        });
      }
      readAsDataURL(blob: Blob): void {
        void blob.arrayBuffer().then((value) => {
          this.result = `data:${blob.type || 'application/octet-stream'};base64,${arrayBufferToBase64(value)}`;
          this.onloadend?.();
        });
      }
    };
  }
  return () => {
    for (const key of polyfillKeys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
}

/**
 * Editor-only chrome a builder attached to its graph, flagged
 * `userData.isRigHelper` (e.g. a `SkeletonHelper`). It is detached for the
 * duration of the export and put back afterwards.
 *
 * Why it must go: the export runs with `onlyVisible: false` (a builder may
 * legitimately bake hidden geometry), so an invisible helper would otherwise
 * ship inside the game asset — and a `SkeletonHelper`'s vertex buffer is a
 * SNAPSHOT of world bone positions, so it also skews the bounds validation
 * below the moment a param moves the rig after the helper was built. Baked
 * output is the model; presentation chrome stays outside the baked root
 * (the parametric asset contract).
 */
function detachRigHelpers(root: THREE.Object3D): () => void {
  const detached: Array<{ object: THREE.Object3D; parent: THREE.Object3D }> = [];
  root.traverse((object) => {
    if (object.userData['isRigHelper'] === true && object.parent) {
      detached.push({ object, parent: object.parent });
    }
  });
  for (const { object, parent } of detached) parent.remove(object);
  return () => {
    for (const { object, parent } of detached) parent.add(object);
  };
}

/** The morph targets one mesh of a source graph carries, in export order. */
export interface MorphTargetSet {
  mesh: string;
  names: readonly string[];
}

/**
 * The morph targets a source graph will actually export — and the assertion
 * that it will.
 *
 * `GLTFExporter` reads morph targets off the MESH (`morphTargetInfluences`
 * for how many, `morphTargetDictionary` for their names), not off the
 * geometry, and it exports NOTHING when the mesh half is missing — the
 * classic silent loss, since `Mesh.updateMorphTargets()` only runs in the
 * constructor and in `GLTFLoader`. So a mesh whose geometry carries morph
 * attributes must carry the matching named influences, or this throws.
 */
export function collectMorphTargets(root: THREE.Object3D): readonly MorphTargetSet[] {
  const sets: MorphTargetSet[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const attributes = mesh.geometry.morphAttributes['position'] ?? [];
    if (attributes.length === 0) return;
    const influences = mesh.morphTargetInfluences ?? [];
    if (influences.length !== attributes.length) {
      throw new Error(
        `Mesh '${mesh.name}' geometry carries ${attributes.length} morph targets but the mesh ` +
          `carries ${influences.length} influences, so the export would drop them. Call ` +
          'updateMorphTargets() after authoring morph attributes (the Mesh constructor does it ' +
          'for geometry that already carries them).',
      );
    }
    const dictionary = mesh.morphTargetDictionary ?? {};
    const names = attributes.map((attribute, index) => {
      if (!attribute.name || dictionary[attribute.name] !== index) {
        throw new Error(
          `Mesh '${mesh.name}' morph target ${index} is unnamed or missing from its ` +
            'morphTargetDictionary, so the baked GLB would carry no target names.',
        );
      }
      return attribute.name;
    });
    sets.push({ mesh: mesh.name, names });
  });
  return sets;
}

export async function exportObject3DToGlb(
  root: THREE.Object3D,
  animations: readonly THREE.AnimationClip[],
): Promise<Uint8Array> {
  collectMorphTargets(root);
  const reattach = detachRigHelpers(root);
  try {
    const result = await new Promise<ArrayBuffer>((resolve, reject) => {
      new GLTFExporter().parse(
        root,
        (value) => {
          if (value instanceof ArrayBuffer) resolve(value);
          else reject(new Error('GLTFExporter returned JSON while binary output was requested.'));
        },
        reject,
        { binary: true, animations: [...animations], onlyVisible: false },
      );
    });
    return new Uint8Array(result);
  } finally {
    reattach();
  }
}

export interface GlbValidationOptions {
  requiredClips: readonly string[];
  requireSkinned?: boolean;
  forbidSkinned?: boolean;
  minimumAnimatedNodes?: number;
  expectedForward?: readonly [number, number, number];
  minimumHeight?: number;
  maximumHeight?: number;
  groundYRange?: readonly [number, number];
  /** Exact bone count the reimported scene must contain — proves the whole
   *  skeleton survived the export/reimport round trip. */
  expectedBoneCount?: number;
  /** Prove vertex colors survive the round trip: the named reimported mesh
   *  must carry a `color` attribute whose value at `index` matches the
   *  source-sampled `value` (RGB, within `tolerance`, default 2e-3). */
  vertexColorSample?: {
    mesh: string;
    index: number;
    value: readonly [number, number, number];
    tolerance?: number;
  };
  /** Every morph target the SOURCE authored, per mesh — each name must come
   *  back off the reimported GLB with data behind it. Derived from the source
   *  graph by `bakeObject3DSource`, exactly as `requiredClips` is. */
  requiredMorphTargets?: readonly MorphTargetSet[];
  /** UV sets the reimported GLB must still carry, in the mesh kit's channel
   *  vocabulary: `'uv'` is glTF `TEXCOORD_0`, `'uv2'` is `TEXCOORD_1` (which
   *  three loads back as its `uv1` attribute — it renamed the second set in
   *  r152). Presence somewhere in the scene, exactly like `requiredClips`;
   *  which meshes carry UVs is the source's business. Without this a
   *  dropped TEXCOORD is invisible until a texture renders untextured. */
  requiredUvChannels?: readonly ('uv' | 'uv2')[];
  /** Prove a material's TEXTURE MAP survives the round trip, the way
   *  `vertexColorSample` proves vertex colors do: find the material by NAME
   *  (`slotMaterialMesh` names each material after its slot), read the named
   *  map's decoded image, and compare the pixel at `pixel` against `value`
   *  (RGB 0–1, within `tolerance`, default one 8-bit step). A checker
   *  texture makes this a real correspondence check — sample a cell you know
   *  the color of. */
  materialMapSample?: {
    material: string;
    /** Which map (default `'map'`). */
    map?: 'map' | 'emissiveMap' | 'metalnessMap' | 'normalMap' | 'roughnessMap' | 'aoMap';
    /** `[x, y]` in image pixels from the top-left. */
    pixel: readonly [number, number];
    value: readonly [number, number, number];
    tolerance?: number;
  };
}

export interface GlbValidationResult {
  meshCount: number;
  skinnedMeshCount: number;
  boneCount: number;
  animatedNodeCount: number;
  clips: string[];
}

function assertFiniteValues(label: string, values: Iterable<number>): void {
  let index = 0;
  for (const value of values) {
    if (!Number.isFinite(value))
      throw new Error(`${label} contains a non-finite value at ${index}.`);
    index += 1;
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: exhaustive attribute/index validation is clearest as one bounded graph check.
function validateGeometry(object: THREE.Mesh): void {
  const geometry = object.geometry;
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    for (let vertex = 0; vertex < attribute.count; vertex += 1) {
      for (let component = 0; component < attribute.itemSize; component += 1) {
        const value = attribute.getComponent(vertex, component);
        if (!Number.isFinite(value)) {
          throw new Error(
            `Geometry '${object.name}' attribute '${name}' contains a non-finite value at ` +
              `vertex ${vertex}, component ${component}.`,
          );
        }
      }
    }
  }
  if (geometry.index) {
    const positionCount = geometry.getAttribute('position')?.count ?? 0;
    for (let index = 0; index < geometry.index.count; index += 1) {
      const value = geometry.index.getX(index);
      if (!Number.isInteger(value) || value < 0 || value >= positionCount) {
        throw new Error(`Geometry '${object.name}' contains invalid index ${value} at ${index}.`);
      }
    }
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: joint, inverse-bind, index, and weight invariants form one skin validity proof.
function validateSkin(mesh: THREE.SkinnedMesh): void {
  const { skeleton, geometry } = mesh;
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  if (!skinIndex || !skinWeight || skinIndex.itemSize < 4 || skinWeight.itemSize < 4) {
    throw new Error(
      `SkinnedMesh '${mesh.name}' is missing four-component skin indices or weights.`,
    );
  }
  if (
    skinIndex.count !== skinWeight.count ||
    skinIndex.count !== geometry.getAttribute('position')?.count
  ) {
    throw new Error(`SkinnedMesh '${mesh.name}' has mismatched vertex and skin attribute counts.`);
  }
  if (skeleton.bones.length === 0 || skeleton.boneInverses.length !== skeleton.bones.length) {
    throw new Error(`SkinnedMesh '${mesh.name}' has an incomplete skeleton or inverse bind set.`);
  }
  const uniqueBones = new Set(skeleton.bones);
  if (uniqueBones.size !== skeleton.bones.length || skeleton.bones.some((bone) => !bone?.isBone)) {
    throw new Error(`SkinnedMesh '${mesh.name}' contains missing or duplicate joints.`);
  }
  for (const [index, inverse] of skeleton.boneInverses.entries()) {
    assertFiniteValues(`SkinnedMesh '${mesh.name}' inverse bind ${index}`, inverse.elements);
  }
  for (let vertex = 0; vertex < skinIndex.count; vertex += 1) {
    let weightSum = 0;
    for (let component = 0; component < 4; component += 1) {
      const joint = skinIndex.getComponent(vertex, component);
      const weight = skinWeight.getComponent(vertex, component);
      if (!Number.isInteger(joint) || joint < 0 || joint >= skeleton.bones.length) {
        throw new Error(
          `SkinnedMesh '${mesh.name}' vertex ${vertex} references invalid joint ${joint}.`,
        );
      }
      if (!Number.isFinite(weight) || weight < 0) {
        throw new Error(
          `SkinnedMesh '${mesh.name}' vertex ${vertex} contains invalid skin weight ${weight}.`,
        );
      }
      weightSum += weight;
    }
    if (Math.abs(weightSum - 1) > 1e-3) {
      throw new Error(
        `SkinnedMesh '${mesh.name}' vertex ${vertex} skin weights sum to ${weightSum}.`,
      );
    }
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: time, value, quaternion, and continuity checks intentionally share clip context.
function validateClip(clip: THREE.AnimationClip): void {
  if (!Number.isFinite(clip.duration) || clip.duration <= 0) {
    throw new Error(`Animation clip '${clip.name}' has invalid duration ${clip.duration}.`);
  }
  if (clip.tracks.length === 0) throw new Error(`Animation clip '${clip.name}' has no tracks.`);
  for (const track of clip.tracks) {
    assertFiniteValues(`Animation track '${track.name}' times`, track.times);
    assertFiniteValues(`Animation track '${track.name}' values`, track.values);
    for (let index = 1; index < track.times.length; index += 1) {
      if (track.times[index]! < track.times[index - 1]!) {
        throw new Error(`Animation track '${track.name}' has decreasing key times.`);
      }
    }
    if (!(track instanceof THREE.QuaternionKeyframeTrack)) continue;
    let previous: THREE.Quaternion | undefined;
    for (let offset = 0; offset < track.values.length; offset += 4) {
      const value = new THREE.Quaternion(
        track.values[offset],
        track.values[offset + 1],
        track.values[offset + 2],
        track.values[offset + 3],
      );
      const length = value.length();
      if (!Number.isFinite(length) || Math.abs(length - 1) > 1e-3) {
        throw new Error(`Animation track '${track.name}' contains a non-normalized quaternion.`);
      }
      if (previous && previous.dot(value) < -1e-5) {
        throw new Error(`Animation track '${track.name}' changes quaternion hemisphere.`);
      }
      previous = value;
    }
  }
}

/** Assert the round-tripped scene still carries the source's vertex colors:
 *  find the named mesh, require a `color` attribute, and compare the sampled
 *  RGB against the source value. Garmented characters are vertex-colored, so
 *  a silent color drop would ship a monochrome body. */
function validateVertexColorSample(
  scene: THREE.Object3D,
  sample: NonNullable<GlbValidationOptions['vertexColorSample']>,
): void {
  let mesh: THREE.Mesh | undefined;
  scene.traverse((object) => {
    if (!mesh && (object as THREE.Mesh).isMesh && object.name === sample.mesh) {
      mesh = object as THREE.Mesh;
    }
  });
  if (!mesh) throw new Error(`Baked GLB round-trip lost mesh '${sample.mesh}'.`);
  const color = mesh.geometry.getAttribute('color');
  if (!color || color.itemSize < 3) {
    throw new Error(`Baked GLB mesh '${sample.mesh}' lost its vertex colors on round-trip.`);
  }
  if (sample.index < 0 || sample.index >= color.count) {
    throw new Error(
      `Vertex color sample index ${sample.index} is out of range for mesh '${sample.mesh}' ` +
        `(${color.count} vertices).`,
    );
  }
  const tolerance = sample.tolerance ?? 2e-3;
  const actual = [0, 1, 2].map((component) => color.getComponent(sample.index, component));
  for (const [component, expected] of sample.value.entries()) {
    if (Math.abs(actual[component]! - expected) > tolerance) {
      throw new Error(
        `Baked GLB mesh '${sample.mesh}' vertex color at ${sample.index} drifted on ` +
          `round-trip: got [${actual.join(', ')}], expected [${sample.value.join(', ')}].`,
      );
    }
  }
}

/** Channel vocabulary → three's attribute name → the glTF accessor it came
 *  from. Three renamed the second UV set to `uv1` in r152; the channel names
 *  stay the mesh kit's `uv`/`uv2`. */
const UV_CHANNELS = {
  uv: { attribute: 'uv', accessor: 'TEXCOORD_0' },
  uv2: { attribute: 'uv1', accessor: 'TEXCOORD_1' },
} as const;

/** Assert the reimported scene still carries each required UV set. A
 *  dropped TEXCOORD does not fail any other check here — the geometry is
 *  perfectly valid without it — and only shows up as an untextured render. */
function validateUvChannels(scene: THREE.Object3D, required: readonly ('uv' | 'uv2')[]): void {
  const present = new Set<string>();
  let meshCount = 0;
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshCount += 1;
    for (const name of Object.keys(mesh.geometry.attributes)) present.add(name);
  });
  for (const channel of required) {
    const { attribute, accessor } = UV_CHANNELS[channel];
    if (!present.has(attribute)) {
      throw new Error(
        `Baked GLB round-trip carries no '${attribute}' attribute (channel '${channel}', glTF ` +
          `${accessor}) on any of its ${meshCount} meshes — the UVs were dropped on export.`,
      );
    }
  }
}

/** Assert a named material's texture map survived the round trip with the
 *  right pixels behind it. Keyed by MATERIAL name rather than mesh name
 *  because a slot-grouped mesh exports as one glTF primitive per slot and
 *  comes back split into several meshes, while the material names — which
 *  ARE the slot names — survive intact. */
function validateMaterialMapSample(
  scene: THREE.Object3D,
  sample: NonNullable<GlbValidationOptions['materialMapSample']>,
): void {
  const key = sample.map ?? 'map';
  const names = new Set<string>();
  let material: THREE.Material | undefined;
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const candidate of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!candidate) continue;
      names.add(candidate.name);
      if (!material && candidate.name === sample.material) material = candidate;
    }
  });
  if (!material) {
    throw new Error(
      `Baked GLB round-trip lost material '${sample.material}' (kept: ` +
        `${[...names].join(', ') || 'none'}).`,
    );
  }
  const texture = (material as unknown as Record<string, THREE.Texture | null>)[key];
  if (!texture) {
    throw new Error(`Baked GLB material '${sample.material}' came back with no '${key}'.`);
  }
  const image = texture.image as { width?: number; height?: number; data?: ArrayLike<number> };
  if (!image?.data || !image.width || !image.height) {
    throw new Error(
      `Baked GLB material '${sample.material}' '${key}' came back with no readable pixels — the ` +
        'image was embedded but not decoded (installNodeThreePolyfills supplies the decoder).',
    );
  }
  const [x, y] = sample.pixel;
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    throw new Error(
      `Material map sample pixel [${x}, ${y}] is outside '${sample.material}' '${key}' ` +
        `(${image.width}×${image.height}).`,
    );
  }
  const tolerance = sample.tolerance ?? 4e-3;
  const offset = (y * image.width + x) * 4;
  const actual = [0, 1, 2].map((component) => (image.data?.[offset + component] ?? 0) / 255);
  for (const [component, expected] of sample.value.entries()) {
    if (Math.abs((actual[component] as number) - expected) > tolerance) {
      throw new Error(
        `Baked GLB material '${sample.material}' '${key}' pixel [${x}, ${y}] drifted on ` +
          `round-trip: got [${actual.join(', ')}], expected [${sample.value.join(', ')}].`,
      );
    }
  }
}

/** Assert every authored morph target survived the round trip, by NAME and
 *  with data behind it. A morph target is invisible in a render of the rest
 *  pose — nothing but this notices when a merge, an exporter quirk, or a
 *  missing `updateMorphTargets()` drops the face's blink on the way out. */
function validateMorphTargets(scene: THREE.Object3D, required: readonly MorphTargetSet[]): void {
  const byName = new Map<string, THREE.Mesh>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && !byName.has(mesh.name)) byName.set(mesh.name, mesh);
  });
  for (const set of required) {
    const mesh = byName.get(set.mesh);
    if (!mesh) throw new Error(`Baked GLB round-trip lost mesh '${set.mesh}'.`);
    const dictionary = mesh.morphTargetDictionary ?? {};
    const attributes = mesh.geometry.morphAttributes['position'] ?? [];
    const missing = set.names.filter((name) => dictionary[name] === undefined);
    if (missing.length > 0) {
      throw new Error(
        `Baked GLB mesh '${set.mesh}' lost morph targets on round-trip: ${missing.join(', ')} ` +
          `(kept: ${Object.keys(dictionary).join(', ') || 'none'}).`,
      );
    }
    for (const name of set.names) {
      const attribute = attributes[dictionary[name]!];
      if (!attribute || attribute.count === 0) {
        throw new Error(
          `Baked GLB mesh '${set.mesh}' morph target '${name}' came back with no vertex data.`,
        );
      }
    }
  }
}

function validateBoundsAndForward(scene: THREE.Object3D, options: GlbValidationOptions): void {
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene, true);
  if (bounds.isEmpty()) throw new Error('Baked GLB round-trip contained no renderable bounds.');
  assertFiniteValues('Baked GLB bounds', [
    bounds.min.x,
    bounds.min.y,
    bounds.min.z,
    bounds.max.x,
    bounds.max.y,
    bounds.max.z,
  ]);
  const height = bounds.max.y - bounds.min.y;
  if (options.minimumHeight !== undefined && height < options.minimumHeight) {
    throw new Error(`Baked GLB height ${height} is below ${options.minimumHeight}.`);
  }
  if (options.maximumHeight !== undefined && height > options.maximumHeight) {
    throw new Error(`Baked GLB height ${height} exceeds ${options.maximumHeight}.`);
  }
  if (
    options.groundYRange &&
    (bounds.min.y < options.groundYRange[0] || bounds.min.y > options.groundYRange[1])
  ) {
    throw new Error(
      `Baked GLB ground Y ${bounds.min.y} is outside ` +
        `[${options.groundYRange[0]}, ${options.groundYRange[1]}].`,
    );
  }
  if (options.expectedForward) {
    let declared: unknown;
    scene.traverse((object) => {
      if (declared === undefined && object.userData['forward'] !== undefined) {
        declared = object.userData['forward'];
      }
    });
    if (!Array.isArray(declared) || declared.length !== 3) {
      throw new Error('Baked GLB is missing a three-component forward declaration in extras.');
    }
    const actual = new THREE.Vector3(Number(declared[0]), Number(declared[1]), Number(declared[2]));
    const expected = new THREE.Vector3(...options.expectedForward);
    if (
      !Number.isFinite(actual.lengthSq()) ||
      actual.lengthSq() === 0 ||
      expected.lengthSq() === 0 ||
      actual.normalize().dot(expected.normalize()) < 1 - 1e-6
    ) {
      throw new Error(
        `Baked GLB forward declaration [${declared.join(', ')}] does not match ` +
          `[${options.expectedForward.join(', ')}].`,
      );
    }
  }
}

export async function validateExportedGlb(
  bytes: Uint8Array,
  options: GlbValidationOptions,
): Promise<GlbValidationResult> {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  const gltf = await new GLTFLoader().parseAsync(arrayBuffer, '');
  let meshCount = 0;
  let skinnedMeshCount = 0;
  let boneCount = 0;
  try {
    gltf.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) meshCount += 1;
      if ((object as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshCount += 1;
      if ((object as THREE.Bone).isBone) boneCount += 1;
      assertFiniteValues(`Object '${object.name}' transform`, [
        object.position.x,
        object.position.y,
        object.position.z,
        object.quaternion.x,
        object.quaternion.y,
        object.quaternion.z,
        object.quaternion.w,
        object.scale.x,
        object.scale.y,
        object.scale.z,
        ...object.matrix.elements,
      ]);
      const quaternionLength = object.quaternion.length();
      if (quaternionLength === 0 || Math.abs(quaternionLength - 1) > 1e-3) {
        throw new Error(`Object '${object.name}' has a non-normalized quaternion.`);
      }
      if (mesh.isMesh) validateGeometry(mesh);
      if ((object as THREE.SkinnedMesh).isSkinnedMesh) {
        validateSkin(object as THREE.SkinnedMesh);
      }
    });
    if (meshCount === 0) throw new Error('Baked GLB round-trip contained no meshes.');
    if (options.requireSkinned && skinnedMeshCount === 0) {
      throw new Error('Baked GLB round-trip contained no SkinnedMesh.');
    }
    if (options.forbidSkinned && skinnedMeshCount !== 0) {
      throw new Error('Rigid articulated output unexpectedly contains a SkinnedMesh.');
    }
    if (options.expectedBoneCount !== undefined && boneCount !== options.expectedBoneCount) {
      throw new Error(
        `Baked GLB round-trip carries ${boneCount} bones; the source rig has ` +
          `${options.expectedBoneCount}.`,
      );
    }
    if (options.vertexColorSample) validateVertexColorSample(gltf.scene, options.vertexColorSample);
    if (options.requiredUvChannels?.length) {
      validateUvChannels(gltf.scene, options.requiredUvChannels);
    }
    if (options.materialMapSample) validateMaterialMapSample(gltf.scene, options.materialMapSample);
    if (options.requiredMorphTargets?.length) {
      validateMorphTargets(gltf.scene, options.requiredMorphTargets);
    }
    const clips = gltf.animations.map((clip) => clip.name);
    for (const clip of gltf.animations) validateClip(clip);
    const clipSet = new Set(clips);
    const missing = options.requiredClips.filter((name) => !clipSet.has(name));
    if (missing.length > 0) throw new Error(`Baked GLB is missing clips: ${missing.join(', ')}`);
    const animatedNodes = new Set(
      gltf.animations.flatMap((clip) =>
        clip.tracks.map((track) => track.name.slice(0, track.name.lastIndexOf('.'))),
      ),
    );
    const animatedNodeCount = animatedNodes.size;
    if (animatedNodeCount < (options.minimumAnimatedNodes ?? 0)) {
      throw new Error(
        `Baked GLB animates ${animatedNodeCount} nodes; expected at least ${options.minimumAnimatedNodes}.`,
      );
    }
    validateBoundsAndForward(gltf.scene, options);
    return { meshCount, skinnedMeshCount, boneCount, animatedNodeCount, clips };
  } finally {
    disposeObject3D(gltf.scene);
  }
}
