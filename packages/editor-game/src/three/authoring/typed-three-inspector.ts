/**
 * Typed inspector fields for the three common three.js objects a scene author
 * edits by hand — a LIGHT, a mesh's MATERIAL, a CAMERA, or positional AUDIO — as pure functions
 * over the LIVE object.
 *
 * This is deliberately NOT a descriptor store, a schema, or a scene-document
 * type. It is a lens: given a live `Object3D` (and, for a mesh, its material),
 * it names the handful of high-value typed properties that object ACTUALLY has
 * right now, reads their current values, and applies an edit back onto the live
 * object. The R3F source authoring adapter wraps these into `PropertyDescriptor`
 * rows and routes the write through its EXISTING source-writeback path (the same
 * `writeProp` a Transform edit or a `material.color` edit already uses) — the
 * three root's source stays the single truth (§Roots), and nothing here invents
 * a second one.
 *
 * Honest absence is the whole point: `typedThreeFields` returns ONLY the fields
 * the given object exposes. A `MeshStandardMaterial` yields `roughness`/
 * `metalness`; a `MeshBasicMaterial` yields neither (it has no such property),
 * so those rows never appear. A `THREE.PointLight` yields `distance`/`decay`
 * but not `angle`/`penumbra` (those are spotlight-only). No selected object of
 * the wrong kind ever shows a row it cannot honor.
 *
 * The property NAMES are the three.js / react-three-fiber intrinsic prop names
 * verbatim (`intensity`, `roughness`, `fov`, …), so a written attribute reads
 * as idiomatic R3F source (`<pointLight intensity={5} />`) and the value the
 * inspector shows is the one the JSX prop would set.
 */

import type { PropertyDescriptor } from '@vgai/project/adapter';
import * as THREE from 'three';

/** The section a typed field renders under (a titled `PropertyDescriptor.group`). */
export type TypedThreeGroup = 'Light' | 'Material' | 'Camera' | 'Audio';

/**
 * One typed inspector field: its three.js prop name (also the source attribute
 * name and the inspector path suffix), its widget type, the section it groups
 * under, and WHICH source tag owns its attribute — the object's own JSX element
 * (`self`) or its material's child element (`material`).
 */
export interface TypedThreeField {
  readonly prop: string;
  readonly label: string;
  readonly type: Extract<
    PropertyDescriptor['type'],
    'number' | 'color' | 'boolean' | 'enum' | 'asset'
  >;
  readonly options?: readonly string[];
  readonly group: TypedThreeGroup;
  readonly target: 'self' | 'material';
  /** Full inspector path — `${group-prefix}.${prop}`, e.g. `light.intensity`. */
  readonly path: string;
  /**
   * For an `asset` slot only: how the texture's bytes must be INTERPRETED.
   * A slot the shader reads as COLOUR (`map`, `emissiveMap`) is authored in
   * sRGB and must be decoded; a slot it reads as DATA (`normalMap`,
   * `roughnessMap`, `metalnessMap`, `aoMap`) carries raw numbers and must not
   * be. Getting this wrong is not subtle — a decoded normal map bends light in
   * the wrong direction — and three.js cannot infer it from the file, which is
   * why the slot declares it here rather than the loader guessing.
   */
  readonly colorSpace?: 'srgb' | 'linear';
}

/** Path prefix per group, so `get`/`set` can dispatch on the path alone. */
const PREFIX: Record<TypedThreeGroup, string> = {
  Light: 'light',
  Material: 'material',
  Camera: 'camera',
  Audio: 'audio',
};

function field(
  group: TypedThreeGroup,
  target: TypedThreeField['target'],
  prop: string,
  label: string,
  type: TypedThreeField['type'],
  path = `${PREFIX[group]}.${prop}`,
  options?: readonly string[],
): TypedThreeField {
  return { prop, label, type, group, target, path, ...(options ? { options } : {}) };
}

/** An `asset` slot on a material — a texture map, with the colour space its
 *  shader input demands (see {@link TypedThreeField.colorSpace}). */
function mapField(prop: string, label: string, colorSpace: 'srgb' | 'linear'): TypedThreeField {
  return {
    prop,
    label,
    type: 'asset',
    group: 'Material',
    target: 'material',
    path: `${PREFIX.Material}.${prop}`,
    colorSpace,
  };
}

/**
 * The texture slots this lens offers, in the order a material author reaches
 * for them. Each row appears only when the CONCRETE material class carries
 * that property — a `MeshBasicMaterial` has `map` and `aoMap` but no
 * `normalMap`/`roughnessMap`/`metalnessMap`/`emissiveMap`, so those four never
 * render for one. Honest absence, exactly as the scalar rows above.
 */
const MATERIAL_MAP_SLOTS: readonly TypedThreeField[] = [
  mapField('map', 'Base Color Map', 'srgb'),
  mapField('normalMap', 'Normal Map', 'linear'),
  mapField('roughnessMap', 'Roughness Map', 'linear'),
  mapField('metalnessMap', 'Metalness Map', 'linear'),
  mapField('emissiveMap', 'Emissive Map', 'srgb'),
  mapField('aoMap', 'Ambient Occlusion Map', 'linear'),
];

/** `#rrggbb` view of a three color property, or undefined when absent. */
function readColor(value: unknown): string | undefined {
  const color = value as THREE.Color | undefined;
  return color && (color as { isColor?: boolean }).isColor ? `#${color.getHexString()}` : undefined;
}

// ------------------------------------------------------------------ textures

/**
 * `userData` key carrying the project path an assigned texture came FROM.
 *
 * A `THREE.Texture` does not remember its origin in any form the inspector can
 * show: `image.src` is an absolute URL the browser resolved, and a texture that
 * arrived inside a `.glb` has no URL at all. Stamping the path we were handed
 * is what lets the slot read back the same string the picker offered.
 */
const ASSET_PATH_KEY = 'vgaiAssetPath';

/** Textures THIS module loaded. Only these are disposed on reassign/clear —
 *  a texture that came from a GLB or the game's own code may be shared by
 *  other materials, and disposing it would blank them too. */
const ownedTextures = new WeakSet<THREE.Texture>();

/** One loader for the session — three's own loader manager caches per URL. */
const textureLoader = new THREE.TextureLoader();

/** How an assigned texture reads back in the inspector: the project path it
 *  was assigned from, else whatever identity the texture already carried. */
function readTextureRef(value: unknown): string {
  const texture = value as THREE.Texture | null | undefined;
  if (!texture || !(texture as { isTexture?: boolean }).isTexture) return '';
  const stamped = (texture.userData as Record<string, unknown> | undefined)?.[ASSET_PATH_KEY];
  if (typeof stamped === 'string' && stamped) return stamped;
  if (texture.name) return texture.name;
  const src = (texture.image as { src?: string } | undefined)?.src;
  return typeof src === 'string' ? src : '';
}

/** The served URL for a project asset path. Public-root-relative paths are
 *  what the asset seams speak (`textures/brick.png`); anything already
 *  absolute or inline is passed through untouched. */
function assetUrlFor(path: string): string {
  return /^(?:[a-z]+:|\/)/i.test(path) ? path : `/${path}`;
}

/**
 * Assign (or clear) a texture slot on the LIVE material.
 *
 * `TextureLoader.load` hands back the `Texture` object synchronously and fills
 * its image in later, setting `needsUpdate` itself — so the assignment is a
 * plain property write here and the viewport picks the pixels up on the frame
 * they arrive. Returns the path to persist, `''` for a cleared slot, or `null`
 * when there is no material to assign to.
 */
function applyAssetField(
  material: THREE.Material | null,
  field: TypedThreeField,
  value: unknown,
): string | null {
  if (!material) return null;
  const owner = material as unknown as Record<string, unknown>;
  const previous = owner[field.prop] as THREE.Texture | null | undefined;
  const path = value === null || value === undefined ? '' : String(value);
  if (previous && ownedTextures.has(previous) && readTextureRef(previous) !== path) {
    previous.dispose();
  }
  if (!path) {
    owner[field.prop] = null;
    material.needsUpdate = true;
    return '';
  }
  const texture = textureLoader.load(assetUrlFor(path));
  texture.colorSpace = field.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.userData[ASSET_PATH_KEY] = path;
  texture.name = path;
  ownedTextures.add(texture);
  owner[field.prop] = texture;
  // Adding or removing a map changes which shader three compiles for this
  // material, so the program must be rebuilt — a bare property write is not
  // enough for texture slots the way it is for a scalar.
  material.needsUpdate = true;
  return path;
}

// ---------------------------------------------------------------- descriptors

/** Typed fields a `THREE.Light` exposes — common to every light, then the
 *  point/spot falloff and the spot cone, each guarded by the concrete subtype. */
export function lightTypedFields(light: THREE.Light): readonly TypedThreeField[] {
  const l = light as THREE.Light & {
    isDirectionalLight?: boolean;
    isPointLight?: boolean;
    isSpotLight?: boolean;
  };
  const fields: TypedThreeField[] = [
    field('Light', 'self', 'color', 'Color', 'color'),
    field('Light', 'self', 'intensity', 'Intensity', 'number'),
  ];
  if (l.isPointLight || l.isSpotLight) {
    fields.push(
      field('Light', 'self', 'distance', 'Distance', 'number'),
      field('Light', 'self', 'decay', 'Decay', 'number'),
    );
  }
  if (l.isSpotLight) {
    fields.push(
      field('Light', 'self', 'angle', 'Angle', 'number'),
      field('Light', 'self', 'penumbra', 'Penumbra', 'number'),
    );
  }
  return fields;
}

/** Shadow casting is an Object3D flag rather than a Light member in three.js,
 * so it remains a separate lens from {@link lightTypedFields}. Only the three
 * light classes whose render path can honor it expose the row. */
export function lightShadowTypedField(object: THREE.Object3D): TypedThreeField | undefined {
  const light = object as THREE.Light & {
    isDirectionalLight?: boolean;
    isPointLight?: boolean;
    isSpotLight?: boolean;
  };
  return light.isDirectionalLight || light.isPointLight || light.isSpotLight
    ? field('Light', 'self', 'castShadow', 'Cast Shadow', 'boolean', 'shadow.cast')
    : undefined;
}

/** Typed fields a material exposes — each guarded by whether the concrete
 *  material class actually carries that property (a `MeshBasicMaterial` has no
 *  `roughness`/`metalness`/`emissive`, so none appear). */
export function materialTypedFields(material: THREE.Material): readonly TypedThreeField[] {
  const m = material as THREE.Material & {
    color?: THREE.Color;
    roughness?: number;
    metalness?: number;
    emissive?: THREE.Color;
    wireframe?: boolean;
  };
  const fields: TypedThreeField[] = [];
  if ((m.color as { isColor?: boolean } | undefined)?.isColor)
    fields.push(field('Material', 'material', 'color', 'Color', 'color'));
  if (typeof m.roughness === 'number')
    fields.push(field('Material', 'material', 'roughness', 'Roughness', 'number'));
  if (typeof m.metalness === 'number')
    fields.push(field('Material', 'material', 'metalness', 'Metalness', 'number'));
  if ((m.emissive as { isColor?: boolean } | undefined)?.isColor)
    fields.push(field('Material', 'material', 'emissive', 'Emissive', 'color'));
  // `opacity`/`transparent` live on the base `Material` — every material has them.
  fields.push(
    field('Material', 'material', 'opacity', 'Opacity', 'number'),
    field('Material', 'material', 'transparent', 'Transparent', 'boolean'),
  );
  if (typeof m.wireframe === 'boolean')
    fields.push(field('Material', 'material', 'wireframe', 'Wireframe', 'boolean'));
  // Texture slots last: they are the tallest rows, and reading the scalars
  // first is the order every material inspector uses.
  const owner = material as unknown as Record<string, unknown>;
  for (const slot of MATERIAL_MAP_SLOTS) if (slot.prop in owner) fields.push(slot);
  return fields;
}

/** Typed fields a camera exposes — the perspective lens, or the orthographic
 *  zoom + frustum, keyed off the concrete camera subtype. */
export function cameraTypedFields(camera: THREE.Camera): readonly TypedThreeField[] {
  const c = camera as THREE.Camera & {
    isPerspectiveCamera?: boolean;
    isOrthographicCamera?: boolean;
  };
  if (c.isPerspectiveCamera) {
    return [
      field('Camera', 'self', 'fov', 'FOV', 'number'),
      field('Camera', 'self', 'near', 'Near', 'number'),
      field('Camera', 'self', 'far', 'Far', 'number'),
      field('Camera', 'self', 'zoom', 'Zoom', 'number'),
    ];
  }
  if (c.isOrthographicCamera) {
    return [
      field('Camera', 'self', 'zoom', 'Zoom', 'number'),
      field('Camera', 'self', 'near', 'Near', 'number'),
      field('Camera', 'self', 'far', 'Far', 'number'),
      field('Camera', 'self', 'left', 'Left', 'number'),
      field('Camera', 'self', 'right', 'Right', 'number'),
      field('Camera', 'self', 'top', 'Top', 'number'),
      field('Camera', 'self', 'bottom', 'Bottom', 'number'),
    ];
  }
  return [];
}

/** Structural rather than `instanceof`: ingested worlds can carry a different
 * three constructor while still exposing the native PositionalAudio contract. */
export function isPositionalAudioObject(object: THREE.Object3D): object is THREE.PositionalAudio {
  const candidate = object as THREE.Object3D & Partial<THREE.PositionalAudio>;
  return (
    typeof candidate.getRefDistance === 'function' &&
    typeof candidate.setRefDistance === 'function' &&
    !!candidate.panner
  );
}

/**
 * Native positional-audio fields, expressed with the source props their R3F
 * owner actually accepts. Drei's `<PositionalAudio>` names reference distance
 * `distance`; the native `<positionalAudio>` intrinsic reaches the PannerNode
 * through R3F's ordinary dash-piercing syntax.
 */
export function audioTypedFields(sourceTag = 'PositionalAudio'): readonly TypedThreeField[] {
  const refProp = sourceTag === 'PositionalAudio' ? 'distance' : 'panner-refDistance';
  return [
    field('Audio', 'self', refProp, 'Reference Distance', 'number', 'audio.refDistance'),
    field(
      'Audio',
      'self',
      'panner-distanceModel',
      'Distance Model',
      'enum',
      'audio.distanceModel',
      ['inverse', 'linear', 'exponential'],
    ),
    field('Audio', 'self', 'panner-rolloffFactor', 'Rolloff', 'number', 'audio.rolloffFactor'),
    field('Audio', 'self', 'panner-maxDistance', 'Maximum Distance', 'number', 'audio.maxDistance'),
    field('Audio', 'self', 'panner-coneInnerAngle', 'Inner Cone', 'number', 'audio.coneInnerAngle'),
    field('Audio', 'self', 'panner-coneOuterAngle', 'Outer Cone', 'number', 'audio.coneOuterAngle'),
    field('Audio', 'self', 'panner-coneOuterGain', 'Outside Gain', 'number', 'audio.coneOuterGain'),
  ];
}

/**
 * Every typed field the given object exposes right now: its light fields when it
 * is a light, its camera fields when it is a camera, and its material's fields
 * when a material is supplied. An object that is none of these yields `[]`.
 */
export function typedThreeFields(
  object: THREE.Object3D,
  material: THREE.Material | null,
  sourceTag?: string,
): readonly TypedThreeField[] {
  const o = object as THREE.Object3D & { isLight?: boolean; isCamera?: boolean };
  const fields: TypedThreeField[] = [];
  if (o.isLight) fields.push(...lightTypedFields(object as unknown as THREE.Light));
  if (o.isCamera) fields.push(...cameraTypedFields(object as THREE.Camera));
  if (isPositionalAudioObject(object)) fields.push(...audioTypedFields(sourceTag));
  if (material) fields.push(...materialTypedFields(material));
  return fields;
}

/** The typed field a path names for this object, or undefined when the object
 *  has no such field (honest absence — a stale/foreign path reads as nothing). */
export function typedFieldForPath(
  object: THREE.Object3D,
  material: THREE.Material | null,
  path: string,
  sourceTag?: string,
): TypedThreeField | undefined {
  const shadow = lightShadowTypedField(object);
  return (
    typedThreeFields(object, material, sourceTag).find((f) => f.path === path) ??
    (shadow?.path === path ? shadow : undefined)
  );
}

// --------------------------------------------------------------- read / apply

/** The property owner a field targets: the object itself, or its material. */
function ownerOf(
  object: THREE.Object3D,
  material: THREE.Material | null,
  field: TypedThreeField,
): Record<string, unknown> | null {
  return (field.target === 'material' ? material : object) as Record<string, unknown> | null;
}

/** The inspector value for a typed field, read from the LIVE object. Color
 *  fields read as `#rrggbb`; number/boolean fields read their raw value. */
export function readTypedField(
  object: THREE.Object3D,
  material: THREE.Material | null,
  field: TypedThreeField,
): unknown {
  if (field.group === 'Audio' && isPositionalAudioObject(object)) {
    const panner = object.panner;
    switch (field.path) {
      case 'audio.refDistance':
        return object.getRefDistance();
      case 'audio.distanceModel':
        return object.getDistanceModel();
      case 'audio.rolloffFactor':
        return object.getRolloffFactor();
      case 'audio.maxDistance':
        return object.getMaxDistance();
      case 'audio.coneInnerAngle':
        return panner.coneInnerAngle;
      case 'audio.coneOuterAngle':
        return panner.coneOuterAngle;
      case 'audio.coneOuterGain':
        return panner.coneOuterGain;
    }
  }
  const owner = ownerOf(object, material, field);
  if (!owner) return undefined;
  const raw = owner[field.prop];
  if (field.type === 'color') return readColor(raw);
  if (field.type === 'asset') return readTextureRef(raw);
  return raw;
}

function applyAudioField(
  object: THREE.PositionalAudio,
  field: TypedThreeField,
  value: unknown,
): string | number | null {
  if (field.path === 'audio.distanceModel') {
    const model = String(value);
    if (model !== 'inverse' && model !== 'linear' && model !== 'exponential') return null;
    object.setDistanceModel(model);
    return model;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  switch (field.path) {
    case 'audio.refDistance':
      object.setRefDistance(Math.max(0.01, num));
      return Math.max(0.01, num);
    case 'audio.rolloffFactor':
      object.setRolloffFactor(Math.max(0, num));
      return Math.max(0, num);
    case 'audio.maxDistance':
      object.setMaxDistance(Math.max(object.getRefDistance() + 0.01, num));
      return Math.max(object.getRefDistance() + 0.01, num);
    case 'audio.coneInnerAngle': {
      const inner = Math.max(0, Math.min(object.panner.coneOuterAngle, num));
      object.setDirectionalCone(inner, object.panner.coneOuterAngle, object.panner.coneOuterGain);
      return inner;
    }
    case 'audio.coneOuterAngle': {
      const outer = Math.max(object.panner.coneInnerAngle, Math.min(360, num));
      object.setDirectionalCone(object.panner.coneInnerAngle, outer, object.panner.coneOuterGain);
      return outer;
    }
    case 'audio.coneOuterGain': {
      const gain = Math.max(0, Math.min(1, num));
      object.setDirectionalCone(object.panner.coneInnerAngle, object.panner.coneOuterAngle, gain);
      return gain;
    }
    default:
      return null;
  }
}

/**
 * Apply a typed edit onto the LIVE object (optimistic preview) and return the
 * value to persist to source — a `#rrggbb` string for a color, the number for a
 * number, the boolean for a boolean, the project asset path (or `''` for a
 * cleared slot) for an `asset` — or `null` when the edit cannot be applied
 * (no owner, or a non-finite number). The caller serializes and writes it back
 * through the source-write backend; nothing here touches source.
 *
 * An `asset` value is NOT a JSX-attribute literal — a texture reaches R3F
 * source through a loader hook, not a string prop — so the lane that owns
 * source persistence refuses that half by name rather than writing a string
 * where a `THREE.Texture` belongs. The live half above is real either way.
 */
export function applyTypedField(
  object: THREE.Object3D,
  material: THREE.Material | null,
  field: TypedThreeField,
  value: unknown,
): string | number | boolean | null {
  if (field.group === 'Audio' && isPositionalAudioObject(object)) {
    return applyAudioField(object, field, value);
  }
  if (field.type === 'asset') return applyAssetField(material, field, value);
  const owner = ownerOf(object, material, field);
  if (!owner) return null;
  if (field.type === 'color') {
    const hex = String(value);
    const color = owner[field.prop] as THREE.Color | undefined;
    color?.set(hex);
    return hex;
  }
  if (field.type === 'boolean') {
    const bool = Boolean(value);
    owner[field.prop] = bool;
    markDirty(object, material, field);
    return bool;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  owner[field.prop] = num;
  markDirty(object, material, field);
  return num;
}

/** Re-derive state that three.js does not recompute on a bare property write:
 *  a camera's projection matrix, and a material's `needsUpdate` for flags that
 *  change how it compiles (`transparent`/`wireframe`). */
function markDirty(
  object: THREE.Object3D,
  material: THREE.Material | null,
  field: TypedThreeField,
): void {
  if (field.group === 'Camera') {
    const cam = object as THREE.Camera & { updateProjectionMatrix?: () => void };
    cam.updateProjectionMatrix?.();
  }
  if (
    field.target === 'material' &&
    material &&
    (field.prop === 'transparent' || field.prop === 'wireframe')
  ) {
    material.needsUpdate = true;
  }
}
