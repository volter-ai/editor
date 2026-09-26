import { getUserData } from '@volter/editor-threejs/ecs/user-data';
import * as THREE from 'three';

export interface ModelInspection {
  nodes: number;
  meshes: number;
  primitives: number;
  vertices: number;
  triangles: number;
  materials: number;
  textures: number;
  bones: number;
  clips: number;
  morphTargets: number;
  memoryBytes: number;
  bounds: { x: number; y: number; z: number } | null;
  geometry: {
    readonly attributes: Array<{
      readonly name: string;
      readonly itemSize: number;
      readonly meshCount: number;
    }>;
    readonly uvChannels: readonly string[];
    readonly indexedMeshes: number;
    readonly nonIndexedMeshes: number;
    readonly instancedMeshes: number;
    readonly skinnedMeshes: number;
    readonly nonFiniteAttributeValues: number;
    readonly lodGroups: number;
    readonly lodLevels: number;
  };
  animationClips: Array<{
    readonly id: string;
    readonly name: string;
    readonly duration: number;
    readonly tracks: number;
    readonly keyframes: number;
    readonly targets: readonly string[];
    readonly rootMotion: boolean;
  }>;
  hierarchy: Array<{ id: string; name: string; type: string; depth: number }>;
  materialNames: string[];
  textureNames: string[];
  materialSlots: Array<{
    id: string;
    name: string;
    type: string;
    textureSlots: string[];
    usageCount: number;
    meshNames: string[];
    color: string | null;
    transparent: boolean;
  }>;
  textureBindings: Array<{
    materialId: string;
    materialName: string;
    slot: string;
    textureName: string;
    width: number | null;
    height: number | null;
    format: number;
    colorSpace: string;
  }>;
}

export interface ModelRigInspection {
  readonly kind: 'none' | 'rigid' | 'skinned';
  readonly skinnedMeshes: number;
  readonly skeletons: number;
  readonly uniqueBones: number;
  readonly weightedVertices: number;
  readonly nonNormalizedVertices: number;
  readonly zeroWeightVertices: number;
  readonly invalidJointIndices: number;
  readonly inverseBindMismatches: number;
  readonly externalBones: number;
  readonly nonFiniteAnimationValues: number;
  readonly unresolvedTrackTargets: string[];
  readonly rootBones: readonly string[];
  readonly bindModes: readonly string[];
  readonly valid: boolean;
}

export type ModelStructureKind = 'static' | 'animated' | 'rigged' | 'skinned';

/**
 * Classify the native graph without treating every animated object as a rig or
 * every non-skinned model as static. Rigid armatures are native Bone trees;
 * skinning is the separate mesh-deformation case.
 */
export function classifyModelStructure(
  inspection: Pick<ModelInspection, 'clips'>,
  rig: Pick<ModelRigInspection, 'uniqueBones' | 'skinnedMeshes'>,
): ModelStructureKind {
  if (rig.skinnedMeshes > 0) return 'skinned';
  if (rig.uniqueBones > 0) return 'rigged';
  if (inspection.clips > 0) return 'animated';
  return 'static';
}

export interface Object3DNodeInspection {
  readonly type: string;
  readonly visible: boolean;
  readonly children: number;
  readonly descendants: number;
  readonly renderOrder: number;
  readonly layers: number;
  readonly geometry: null | {
    readonly vertices: number;
    readonly triangles: number;
    readonly indexed: boolean;
    readonly attributes: readonly string[];
    readonly uvChannels: readonly string[];
    readonly morphTargets: number;
    readonly nonFiniteAttributeValues: number;
    readonly bounds: { x: number; y: number; z: number } | null;
  };
  readonly materials: Array<{
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly color: string | null;
    readonly textureSlots: readonly string[];
  }>;
  readonly skin: null | {
    readonly bones: number;
    readonly rootBones: readonly string[];
    readonly bindMode: string;
  };
  readonly bone: null | {
    readonly parent: string | null;
    readonly children: readonly string[];
  };
}

interface SkinWeightInspection {
  readonly weightedVertices: number;
  readonly nonNormalizedVertices: number;
  readonly zeroWeightVertices: number;
  readonly invalidJointIndices: number;
}

const textureKeys = [
  'map',
  'alphaMap',
  'aoMap',
  'bumpMap',
  'displacementMap',
  'emissiveMap',
  'envMap',
  'lightMap',
  'metalnessMap',
  'normalMap',
  'roughnessMap',
  'specularMap',
] as const;

/**
 * A material's base colour as hex, or `null` when it has none.
 *
 * `.isColor` rather than `instanceof THREE.Color`: these roots arrive from
 * `../authoring/source-object3d-authoring-adapter.ts` and the selection
 * inspector, so under the packaged runtime the material was constructed by the
 * PROJECT's own `three` module and its `Color` is not the shell's constructor.
 * `instanceof` there reports every authored colour as absent. Same rule and
 * same reason as `../authoring/three-scene-identity.ts`.
 */
function materialColorHex(material: THREE.Material): string | null {
  if (!('color' in material)) return null;
  const color = (material as THREE.Material & { color?: THREE.Color }).color;
  return color?.isColor === true ? `#${color.getHexString()}` : null;
}

function countNonFiniteAttributeValues(geometry: THREE.BufferGeometry): number {
  let count = 0;
  for (const attribute of Object.values(geometry.attributes)) {
    const values = attribute.array;
    for (let index = 0; index < values.length; index++) {
      if (!Number.isFinite(Number(values[index]))) count++;
    }
  }
  return count;
}

function attributeBounds(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
): THREE.Box3 | null {
  if (!attribute) return null;
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  for (let index = 0; index < attribute.count; index++) {
    point.set(attribute.getX(index), attribute.getY(index), attribute.getZ(index));
    if (Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)) {
      bounds.expandByPoint(point);
    }
  }
  return bounds.isEmpty() ? null : bounds;
}

/** Compute geometry bounds without writing BufferGeometry.boundingBox. */
function geometryBounds(geometry: THREE.BufferGeometry): THREE.Box3 | null {
  const bounds = attributeBounds(geometry.getAttribute('position'));
  if (!bounds) return null;
  for (const attribute of geometry.morphAttributes['position'] ?? []) {
    const morphBounds = attributeBounds(attribute);
    if (!morphBounds) continue;
    if (geometry.morphTargetsRelative) {
      bounds.expandByPoint(new THREE.Vector3().addVectors(bounds.min, morphBounds.min));
      bounds.expandByPoint(new THREE.Vector3().addVectors(bounds.max, morphBounds.max));
    } else {
      bounds.union(morphBounds);
    }
  }
  return bounds;
}

function localObjectMatrix(object: THREE.Object3D): THREE.Matrix4 {
  return object.matrixAutoUpdate
    ? new THREE.Matrix4().compose(object.position, object.quaternion, object.scale)
    : object.matrix.clone();
}

function expandDrawableBounds(
  result: THREE.Box3,
  object: THREE.Object3D,
  world: THREE.Matrix4,
): void {
  if (getUserData(object, 'editorHelper') || (object as THREE.SkeletonHelper).isSkeletonHelper)
    return;
  const drawable = object as THREE.Object3D & {
    isMesh?: boolean;
    isLine?: boolean;
    isPoints?: boolean;
    geometry?: THREE.BufferGeometry;
  };
  if ((!drawable.isMesh && !drawable.isLine && !drawable.isPoints) || !drawable.geometry) return;
  const localBounds = geometryBounds(drawable.geometry);
  if (!localBounds) return;
  const instanced = object as THREE.InstancedMesh;
  if (!instanced.isInstancedMesh) {
    result.union(localBounds.clone().applyMatrix4(world));
    return;
  }
  const instanceMatrix = new THREE.Matrix4();
  for (let index = 0; index < instanced.count; index++) {
    instanced.getMatrixAt(index, instanceMatrix);
    result.union(
      localBounds.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(world, instanceMatrix)),
    );
  }
}

/** Compute native graph bounds without updating Object3D matrices or geometry caches. */
function modelBounds(root: THREE.Object3D): THREE.Box3 | null {
  const result = new THREE.Box3();
  const ancestors: THREE.Object3D[] = [];
  for (let parent = root.parent; parent; parent = parent.parent) ancestors.push(parent);
  const rootParentWorld = new THREE.Matrix4();
  for (let index = ancestors.length - 1; index >= 0; index--) {
    rootParentWorld.multiply(localObjectMatrix(ancestors[index]!));
  }

  const visit = (object: THREE.Object3D, parentWorld: THREE.Matrix4) => {
    const world = new THREE.Matrix4().multiplyMatrices(parentWorld, localObjectMatrix(object));
    expandDrawableBounds(result, object, world);
    for (const child of object.children) visit(child, world);
  };

  visit(root, rootParentWorld);
  return result.isEmpty() ? null : result;
}

/** Exact, side-effect-free statistics used by the Asset Editor and import validation. */
export function inspectModel(root: THREE.Object3D): ModelInspection {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const materialSlots = new Map<THREE.Material, string[]>();
  const materialUsers = new Map<THREE.Material, Set<THREE.Object3D>>();
  const attributeUsage = new Map<string, { itemSize: number; meshes: number }>();
  const uvChannels = new Set<string>();
  const textureBindings: ModelInspection['textureBindings'] = [];
  const hierarchy: ModelInspection['hierarchy'] = [];
  let nodes = 0;
  let meshes = 0;
  let primitives = 0;
  let vertices = 0;
  let triangles = 0;
  let bones = 0;
  let morphTargets = 0;
  let memoryBytes = 0;
  let indexedMeshes = 0;
  let nonIndexedMeshes = 0;
  let instancedMeshes = 0;
  let skinnedMeshes = 0;
  let nonFiniteAttributeValues = 0;
  let lodGroups = 0;
  let lodLevels = 0;

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one traversal intentionally reconciles geometry, material, texture, animation, and hierarchy statistics.
  root.traverse((object) => {
    if (getUserData(object, 'editorHelper') || (object as THREE.SkeletonHelper).isSkeletonHelper)
      return;
    nodes++;
    let depth = 0;
    for (let parent = object.parent; parent && parent !== root.parent; parent = parent.parent)
      depth++;
    hierarchy.push({ id: object.uuid, name: object.name || object.type, type: object.type, depth });
    if ((object as THREE.Bone).isBone) bones++;
    if ((object as THREE.LOD).isLOD) {
      lodGroups++;
      lodLevels += (object as THREE.LOD).levels.length;
    }
    const renderable = object as THREE.Mesh;
    const drawable = object as THREE.Object3D & {
      isMesh?: boolean;
      isLine?: boolean;
      isPoints?: boolean;
    };
    if (!drawable.isMesh && !drawable.isLine && !drawable.isPoints) return;
    meshes++;
    if ((renderable as THREE.InstancedMesh).isInstancedMesh) instancedMeshes++;
    if ((renderable as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshes++;
    const geometry = renderable.geometry;
    if (geometry) {
      nonFiniteAttributeValues += countNonFiniteAttributeValues(geometry);
      const position = geometry.getAttribute('position');
      vertices += position?.count ?? 0;
      triangles += geometry.index
        ? Math.floor(geometry.index.count / 3)
        : Math.floor((position?.count ?? 0) / 3);
      primitives += Math.max(geometry.groups.length, 1);
      morphTargets += geometry.morphAttributes['position']?.length ?? 0;
      if (geometry.index) {
        indexedMeshes++;
        memoryBytes += geometry.index.array.byteLength;
      } else nonIndexedMeshes++;
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        memoryBytes += attribute.array.byteLength;
        const usage = attributeUsage.get(name) ?? { itemSize: attribute.itemSize, meshes: 0 };
        usage.meshes++;
        attributeUsage.set(name, usage);
        if (/^uv\d*$/.test(name)) uvChannels.add(name);
      }
    }
    const objectMaterials = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : [];
    for (const material of objectMaterials) {
      materials.add(material);
      const users = materialUsers.get(material) ?? new Set<THREE.Object3D>();
      users.add(object);
      materialUsers.set(material, users);
      const slots = materialSlots.get(material) ?? [];
      for (const key of textureKeys) {
        // Structural brand, not `instanceof`: these roots arrive from
        // `source-object3d-authoring-adapter.ts` and the selection inspector,
        // so under the packaged runtime the material was built by the
        // PROJECT's `three`. See `../authoring/three-scene-identity.ts`.
        const texture = (material as THREE.Material & Record<string, unknown>)[key] as
          | THREE.Texture
          | undefined;
        if (texture?.isTexture !== true) continue;
        textures.add(texture);
        if (!slots.includes(key)) slots.push(key);
        const image = texture.image as { width?: number; height?: number } | undefined;
        if (
          !textureBindings.some(
            (binding) => binding.materialId === material.uuid && binding.slot === key,
          )
        ) {
          textureBindings.push({
            materialId: material.uuid,
            materialName: material.name || material.type,
            slot: key,
            textureName: texture.name || texture.source.data?.src || 'Texture',
            width: image?.width ?? null,
            height: image?.height ?? null,
            format: texture.format,
            colorSpace: texture.colorSpace || 'none',
          });
        }
      }
      materialSlots.set(material, slots);
    }
  });
  for (const texture of textures) {
    const image = texture.image as { width?: number; height?: number } | undefined;
    memoryBytes += (image?.width ?? 0) * (image?.height ?? 0) * 4;
  }
  const box = modelBounds(root);
  const size = box?.getSize(new THREE.Vector3()) ?? null;
  return {
    nodes,
    meshes,
    primitives,
    vertices,
    triangles,
    materials: materials.size,
    textures: textures.size,
    bones,
    clips: root.animations.length,
    morphTargets,
    memoryBytes,
    bounds: size ? { x: size.x, y: size.y, z: size.z } : null,
    geometry: {
      attributes: [...attributeUsage.entries()]
        .map(([name, usage]) => ({ name, itemSize: usage.itemSize, meshCount: usage.meshes }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      uvChannels: [...uvChannels].sort(),
      indexedMeshes,
      nonIndexedMeshes,
      instancedMeshes,
      skinnedMeshes,
      nonFiniteAttributeValues,
      lodGroups,
      lodLevels,
    },
    animationClips: root.animations.map((clip, index) => {
      const targets = new Set<string>();
      let keyframes = 0;
      for (const track of clip.tracks) {
        keyframes += track.times.length;
        const parsed = THREE.PropertyBinding.parseTrackName(track.name);
        if (parsed.nodeName) targets.add(parsed.nodeName);
      }
      return {
        id: `${index}:${clip.uuid}`,
        name: clip.name || `Clip ${index + 1}`,
        duration: clip.duration,
        tracks: clip.tracks.length,
        keyframes,
        targets: [...targets].sort(),
        rootMotion: rootMotionTrailPoints(clip).length > 1,
      };
    }),
    hierarchy,
    materialNames: [...materials].map((material) => material.name || material.type),
    textureNames: [...textures].map(
      (texture) => texture.name || texture.source.data?.src || 'Texture',
    ),
    materialSlots: [...materials].map((material) => ({
      id: material.uuid,
      name: material.name || material.type,
      type: material.type,
      textureSlots: materialSlots.get(material) ?? [],
      usageCount: materialUsers.get(material)?.size ?? 0,
      meshNames: [...(materialUsers.get(material) ?? [])]
        .map((object) => object.name || object.type)
        .sort(),
      color: materialColorHex(material),
      transparent: material.transparent,
    })),
    textureBindings,
  };
}

function inspectSkinWeights(mesh: THREE.SkinnedMesh): SkinWeightInspection {
  const indices = mesh.geometry.getAttribute('skinIndex');
  const weights = mesh.geometry.getAttribute('skinWeight');
  if (!indices || !weights) {
    return {
      weightedVertices: 0,
      nonNormalizedVertices: 0,
      zeroWeightVertices: 0,
      invalidJointIndices: 0,
    };
  }
  const weightedVertices = Math.min(indices.count, weights.count);
  let nonNormalizedVertices = 0;
  let zeroWeightVertices = 0;
  let invalidJointIndices = 0;
  for (let vertex = 0; vertex < weightedVertices; vertex++) {
    const values = [
      weights.getX(vertex),
      weights.getY(vertex),
      weights.getZ(vertex),
      weights.getW(vertex),
    ];
    const joints = [
      indices.getX(vertex),
      indices.getY(vertex),
      indices.getZ(vertex),
      indices.getW(vertex),
    ];
    const total = values.reduce((sum, value) => sum + value, 0);
    if (total <= 1e-6) zeroWeightVertices++;
    else if (Math.abs(total - 1) > 1e-3) nonNormalizedVertices++;
    invalidJointIndices += values.filter(
      (value, slot) =>
        value > 1e-6 && (joints[slot]! < 0 || joints[slot]! >= mesh.skeleton.bones.length),
    ).length;
  }
  return {
    weightedVertices,
    nonNormalizedVertices,
    zeroWeightVertices,
    invalidJointIndices,
  };
}

function nonFiniteTrackValueCount(track: THREE.KeyframeTrack): number {
  let count = 0;
  for (const value of track.times) if (!Number.isFinite(value)) count++;
  for (const value of track.values) if (!Number.isFinite(value)) count++;
  return count;
}

function unresolvedTrackTarget(root: THREE.Object3D, track: THREE.KeyframeTrack): string | null {
  const nodeName = THREE.PropertyBinding.parseTrackName(track.name).nodeName;
  return nodeName && !THREE.PropertyBinding.findNode(root, nodeName) ? nodeName : null;
}

function animationIntegrity(root: THREE.Object3D): {
  readonly nonFiniteValues: number;
  readonly unresolvedTargets: Set<string>;
} {
  let nonFiniteValues = 0;
  const unresolvedTargets = new Set<string>();
  for (const clip of root.animations) {
    for (const track of clip.tracks) {
      nonFiniteValues += nonFiniteTrackValueCount(track);
      const unresolved = unresolvedTrackTarget(root, track);
      if (unresolved) unresolvedTargets.add(unresolved);
    }
  }
  return { nonFiniteValues, unresolvedTargets };
}

/** Read-only skin/clip integrity facts for the model Inspector. */
export function inspectModelRig(root: THREE.Object3D): ModelRigInspection {
  const sourceNodes = new Set<THREE.Object3D>();
  const skeletons = new Set<THREE.Skeleton>();
  const bones = new Set<THREE.Bone>();
  let skinnedMeshes = 0;
  let weightedVertices = 0;
  let nonNormalizedVertices = 0;
  let zeroWeightVertices = 0;
  let invalidJointIndices = 0;
  let inverseBindMismatches = 0;
  const externalBones = new Set<THREE.Bone>();
  const rootBones = new Set<string>();
  const bindModes = new Set<string>();
  root.traverse((object) => {
    sourceNodes.add(object);
    const bone = object as THREE.Bone;
    if (!bone.isBone) return;
    bones.add(bone);
  });
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    skinnedMeshes++;
    bindModes.add(mesh.bindMode);
    skeletons.add(mesh.skeleton);
    if (mesh.skeleton.bones.length !== mesh.skeleton.boneInverses.length) inverseBindMismatches++;
    for (const bone of mesh.skeleton.bones) {
      bones.add(bone);
      if (!sourceNodes.has(bone)) externalBones.add(bone);
    }
    const weights = inspectSkinWeights(mesh);
    weightedVertices += weights.weightedVertices;
    nonNormalizedVertices += weights.nonNormalizedVertices;
    zeroWeightVertices += weights.zeroWeightVertices;
    invalidJointIndices += weights.invalidJointIndices;
  });
  const animation = animationIntegrity(root);
  for (const bone of bones) {
    if (!(bone.parent as THREE.Bone | null)?.isBone || !bones.has(bone.parent as THREE.Bone)) {
      rootBones.add(bone.name || bone.uuid);
    }
  }
  const nonFiniteAnimationValues = animation.nonFiniteValues;
  const unresolvedTrackTargets = animation.unresolvedTargets;
  const valid =
    nonNormalizedVertices === 0 &&
    zeroWeightVertices === 0 &&
    invalidJointIndices === 0 &&
    inverseBindMismatches === 0 &&
    externalBones.size === 0 &&
    nonFiniteAnimationValues === 0 &&
    unresolvedTrackTargets.size === 0;
  return {
    kind: skinnedMeshes > 0 ? 'skinned' : bones.size > 0 ? 'rigid' : 'none',
    skinnedMeshes,
    skeletons: skeletons.size,
    uniqueBones: bones.size,
    weightedVertices,
    nonNormalizedVertices,
    zeroWeightVertices,
    invalidJointIndices,
    inverseBindMismatches,
    externalBones: externalBones.size,
    nonFiniteAnimationValues,
    unresolvedTrackTargets: [...unresolvedTrackTargets].sort(),
    rootBones: [...rootBones].sort(),
    bindModes: [...bindModes].sort(),
    valid,
  };
}

function inspectNodeGeometry(geometry: THREE.BufferGeometry | undefined) {
  if (!geometry) return null;
  const size = geometryBounds(geometry)?.getSize(new THREE.Vector3());
  const position = geometry.getAttribute('position');
  return {
    vertices: position?.count ?? 0,
    triangles: Math.floor((geometry.index?.count ?? position?.count ?? 0) / 3),
    indexed: geometry.index !== null,
    attributes: Object.keys(geometry.attributes).sort(),
    uvChannels: Object.keys(geometry.attributes)
      .filter((name) => /^uv\d*$/.test(name))
      .sort(),
    morphTargets: geometry.morphAttributes['position']?.length ?? 0,
    nonFiniteAttributeValues: countNonFiniteAttributeValues(geometry),
    bounds: size ? { x: size.x, y: size.y, z: size.z } : null,
  } satisfies NonNullable<Object3DNodeInspection['geometry']>;
}

function inspectNodeMaterials(mesh: THREE.Mesh): Object3DNodeInspection['materials'] {
  const objectMaterials = Array.isArray(mesh.material)
    ? mesh.material
    : mesh.material
      ? [mesh.material]
      : [];
  return objectMaterials.map((material) => ({
    id: material.uuid,
    name: material.name || material.type,
    type: material.type,
    color: materialColorHex(material),
    textureSlots: textureKeys.filter(
      (key) =>
        ((material as THREE.Material & Record<string, unknown>)[key] as THREE.Texture | undefined)
          ?.isTexture === true,
    ),
  }));
}

function inspectNodeSkin(object: THREE.Object3D): Object3DNodeInspection['skin'] {
  const mesh = object as THREE.SkinnedMesh;
  if (!mesh.isSkinnedMesh) return null;
  return {
    bones: mesh.skeleton.bones.length,
    rootBones: mesh.skeleton.bones
      .filter((bone) => !(bone.parent as THREE.Bone | null)?.isBone)
      .map((bone) => bone.name || bone.uuid),
    bindMode: mesh.bindMode,
  };
}

function inspectNodeBone(object: THREE.Object3D): Object3DNodeInspection['bone'] {
  const bone = object as THREE.Bone;
  if (!bone.isBone) return null;
  return {
    parent: (bone.parent as THREE.Bone | null)?.isBone
      ? bone.parent?.name || bone.parent?.uuid || null
      : null,
    children: bone.children
      .filter((child): child is THREE.Bone => (child as THREE.Bone).isBone)
      .map((child) => child.name || child.uuid),
  };
}

/** Inspect one selected native node without manufacturing an authored descriptor. */
export function inspectObject3DNode(object: THREE.Object3D): Object3DNodeInspection {
  let descendants = -1;
  object.traverse(() => descendants++);
  const mesh = object as THREE.Mesh;
  return {
    type: object.type,
    visible: object.visible,
    children: object.children.length,
    descendants,
    renderOrder: object.renderOrder,
    layers: object.layers.mask,
    geometry: inspectNodeGeometry(mesh.geometry),
    materials: inspectNodeMaterials(mesh),
    skin: inspectNodeSkin(object),
    bone: inspectNodeBone(object),
  };
}

export type ModelDiagnosticMode =
  | 'lit'
  | 'unlit'
  | 'wireframe'
  | 'normals'
  | 'uv'
  | 'vertex-colors'
  | 'bounds'
  | 'skeleton'
  | 'collision'
  | 'lod';

export type ModelCameraPreset =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'isometric';

/**
 * What the viewport's own view text calls the direction it is looking FROM —
 * Blender's "Front Orthographic" / "Top Orthographic", and "User" the moment
 * the view is orbited off an axis. DERIVED from the camera every frame, never
 * stored: Blender's label reverts to User on the first drag, and a remembered
 * preset would keep claiming an axis the view had already left.
 *
 * `null` means no axis — the caller says "User". `isometric` is deliberately
 * absent: it is a 3/4 direction, which Blender calls User too.
 *
 * `up` is the view's own up (the camera's Y in the world). An axis view keeps its name at any
 * quarter-turn of roll and loses it at any other, as Blender matches the view to an axis with
 * one of four `view_axis_roll` steps (`ED_view3d_quat_to_axis_view`).
 */
export function axisViewName(direction: THREE.Vector3, up?: THREE.Vector3): string | null {
  if (up && !isQuarterTurnUp(up)) return null;
  const unit = direction.clone().normalize();
  for (const preset of ['front', 'back', 'left', 'right', 'top', 'bottom'] as const) {
    // Half a degree: enough that a settled preset reads as its axis and any
    // deliberate orbit does not.
    if (cameraPresetDirection(preset).angleTo(unit) < 0.0087)
      return `${preset[0]?.toUpperCase()}${preset.slice(1)}`;
  }
  return null;
}

/** Whether a view's up lies along a world axis, within the half degree the direction has: for
 *  a view down an axis, a roll of a whole number of quarter turns. */
export function isQuarterTurnUp(up: THREE.Vector3): boolean {
  const unit = up.clone().normalize();
  return Math.max(Math.abs(unit.x), Math.abs(unit.y), Math.abs(unit.z)) > Math.cos(0.0087);
}

export function cameraPresetDirection(preset: ModelCameraPreset): THREE.Vector3 {
  const directions: Record<ModelCameraPreset, [number, number, number]> = {
    front: [0, 0, 1],
    back: [0, 0, -1],
    left: [-1, 0, 0],
    right: [1, 0, 0],
    top: [0, 1, 0],
    bottom: [0, -1, 0],
    isometric: [1, 0.72, 1],
  };
  return new THREE.Vector3(...directions[preset]).normalize();
}

export function supportedModelDiagnosticModes(root: THREE.Object3D): Array<{
  mode: ModelDiagnosticMode;
  available: boolean;
  reason?: string;
}> {
  let uv = false;
  let colors = false;
  let bones = false;
  let lod = false;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    uv ||= Boolean(mesh.geometry?.getAttribute('uv'));
    colors ||= Boolean(mesh.geometry?.getAttribute('color'));
    bones ||= Boolean((object as THREE.Bone).isBone || (mesh as THREE.SkinnedMesh).isSkinnedMesh);
    lod ||= (object as THREE.LOD).isLOD === true;
  });
  return [
    { mode: 'lit', available: true },
    { mode: 'unlit', available: true },
    { mode: 'wireframe', available: true },
    { mode: 'normals', available: true },
    { mode: 'uv', available: uv, ...(!uv ? { reason: 'No UV channel' } : {}) },
    {
      mode: 'vertex-colors',
      available: colors,
      ...(!colors ? { reason: 'No vertex colors' } : {}),
    },
    { mode: 'bounds', available: true },
    { mode: 'skeleton', available: bones, ...(!bones ? { reason: 'No skeleton' } : {}) },
    { mode: 'collision', available: false, reason: 'No collision metadata' },
    { mode: 'lod', available: lod, ...(!lod ? { reason: 'No LOD groups' } : {}) },
  ];
}

/** Extract an animation clip's authored root translation samples for diagnostics. */
export function rootMotionTrailPoints(clip: THREE.AnimationClip): THREE.Vector3[] {
  const positionTracks = clip.tracks.filter(
    // `ValueTypeName` is KeyframeTrack's own public discriminator, and the
    // clip may come from the PROJECT's `three` under the packaged runtime.
    (track): track is THREE.VectorKeyframeTrack =>
      track.ValueTypeName === 'vector' && track.name.toLowerCase().endsWith('.position'),
  );
  const track =
    positionTracks.find((candidate) => /(^|[./])(root|hips|armature)[./]/i.test(candidate.name)) ??
    positionTracks[0];
  if (!track || track.values.length < 6) return [];
  const points: THREE.Vector3[] = [];
  for (let offset = 0; offset + 2 < track.values.length; offset += 3) {
    points.push(
      new THREE.Vector3(
        track.values[offset]!,
        track.values[offset + 1]!,
        track.values[offset + 2]!,
      ),
    );
  }
  return points;
}

/** Resolve a hierarchy/material row to the preview objects it represents. */
export function modelSelectionObjects(
  root: THREE.Object3D,
  selection: { kind: 'node' | 'material'; id: string },
): THREE.Object3D[] {
  if (selection.kind === 'node') {
    const object = root.getObjectByProperty('uuid', selection.id);
    return object ? [object] : [];
  }
  const selected: THREE.Object3D[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    if (materials.some((material) => material.uuid === selection.id)) selected.push(mesh);
  });
  return selected;
}
