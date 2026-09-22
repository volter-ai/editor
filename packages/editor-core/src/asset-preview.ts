import type { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import type {
  AssetPreviewCameraChoice,
  AssetPreviewPose,
  AssetPreviewShotSetDefinition,
  AssetPreviewShotWarning,
  LabeledShotSetCapture,
  ShotSetPoseMorph,
  ShotSetPoseRotation,
  ShotSetPoseStep,
  ShotSetPoseTranslation,
  ShotSetShot,
} from '@volter/editor-sdk';
import { EDITOR_LAYER, isEditorOwnedObject } from '@volter/editor-threejs/viewport/editor-layers';
import { markHostRenderer } from '@volter/editor-threejs/viewport/renderer-ownership';
import { isBuiltInternal } from '@volter/editor-threejs/adapter/hierarchy-marks';
import { loadSplat } from '@volter/editor-threejs/asset-loaders';
import { hasUserData } from '@volter/editor-threejs/ecs/user-data';
import { gltfLoader } from '@volter/editor-threejs/loader';
import * as THREE from 'three';
import { forwardYawRadians, parseForwardVector } from './asset-compare-core';
import {
  ASSET_PREVIEW_PADDING,
  boneZoomCenter,
  createOrthographicShotCamera,
  createProjectedSpan,
  expandProjectedSpan,
  fitBoneZoomFrame,
  fitOrthographicFrame,
  fitProjectedSpanFrame,
  type OrthographicFrame,
  type OrthographicViewBasis,
  orthographicShotFrameWindow,
  type ProjectedSpan,
  projectedSpanCenter,
  resetProjectedSpan,
  type ShotFrameWindow,
  spanOverlapsShotFrame,
  turntableViewBasis,
  unionOrthographicFrames,
} from './asset-preview-framing';
import { drawBitmapLabel, measureBitmapLabel } from './bitmap-label';
import {
  applyStudioEnvironment,
  disposeStudioEnvironment,
  STUDIO_AMBIENT_WITH_ENVIRONMENT,
} from './three-viewport/studio-environment';

export const ASSET_PREVIEW_VIEWS = ['front', 'right', 'top', 'perspective'] as const;
export type AssetPreviewView = (typeof ASSET_PREVIEW_VIEWS)[number];
export type AssetPreviewBackground = 'neutral' | 'transparent';

/**
 * Where an ENTITY capture is staged.
 *
 * `'lab'` — the neutral Asset Lab stage {@link captureObjectAssetPreview}
 * renders: an isolated, yaw-normalized snapshot under fixed studio lighting,
 * identical whatever the entity's surroundings are. It is the default
 * everywhere.
 *
 * `'scene'` — {@link captureSceneStageAssetPreview}: the entity photographed
 * WHERE IT STANDS, in the live scene, under the scene's own lighting, with
 * the editor's own furniture excluded. Entity captures only — a model loaded
 * from an asset path does not stand anywhere.
 */
export type AssetPreviewStage = 'lab' | 'scene';

export interface AssetPreviewOptions {
  width?: number;
  height?: number;
  background?: AssetPreviewBackground;
  /** ONE view from a chosen angle instead of the fixed four — see the SDK's
   *  {@link AssetPreviewCameraChoice} for the angle conventions. */
  camera?: AssetPreviewCameraChoice;
  /** Sample a named clip at a time on the capture's disposable snapshot
   *  before framing — see the SDK's {@link AssetPreviewPose}. */
  pose?: AssetPreviewPose;
}

export interface AssetPreviewImage {
  /** One of the four fixed views, or `below` — the underside tile the lab
   *  stage adds to its sheet (a cap's gills, a barrel's floor). */
  view: AssetPreviewView | 'below';
  base64: string;
  mimeType: 'image/png';
}

/**
 * How the captured subject was oriented relative to its AUTHORED coordinates.
 *
 * `faceFrontSubject` yaw-normalizes a subject so the fixed front camera
 * photographs its declared front. For a rig persisting `forward = [0,0,-1]`
 * that is a PI yaw — correct photography whose projection maps authored +X to
 * screen-LEFT in the front view. Applied silently, that read as "the front
 * view mirrors world X" and cost a cold-round agent its geometry reasoning
 * (round #4, 2026-08-30), so the yaw is now REPORTED here and stamped onto
 * the sheet's own pixels ({@link renderFourViewCapture}'s axis markers) —
 * never inferred, never silent.
 */
export interface AssetPreviewOrientation {
  /** The subject's declared forward, `[0,0,1]` when it declares none. */
  forward: [number, number, number];
  /** Yaw applied to face the front camera; 0 means authored axes = world axes. */
  yawDegrees: number;
}

export interface AssetPreviewCapture {
  width: number;
  height: number;
  orientation: AssetPreviewOrientation;
  views: AssetPreviewImage[];
  contactSheet: {
    width: number;
    height: number;
    base64: string;
    mimeType: 'image/png';
  };
}

export interface AssetPreviewFraming {
  center: THREE.Vector3;
  size: THREE.Vector3;
  radius: number;
}

/**
 * The shot-set contract is declared ONCE, in `@volter/editor-sdk`
 * (`packages/editor-sdk/src/types.ts`), because it crosses the editor relay:
 * a capability tool authors a set, the CLI carries it over, and THIS module is
 * the generic capture engine that renders it. Importing rather than
 * re-declaring is what makes `parseShotSetDefinition`'s return annotation
 * below a real drift check against the wire type — see the SDK block's own
 * comment for the contract and for what a pose step's `radians` is measured
 * from.
 */
export type {
  AssetPreviewShotSetDefinition,
  AssetPreviewShotWarning,
  LabeledShotSetCapture,
  ShotSetPoseMorph,
  ShotSetPoseRotation,
  ShotSetPoseStep,
  ShotSetPoseTranslation,
  ShotSetShot,
} from '@volter/editor-sdk';

/** Definitions cross the editor relay as untyped JSON from project-registered
 *  tools; capped so one capture stays within the relay's request budget. */
const MAX_SHOT_SET_SHOTS = 24;

function isPoseRotation(value: unknown): value is ShotSetPoseRotation {
  const record = value as Partial<ShotSetPoseRotation> | null;
  return (
    typeof record === 'object' &&
    record !== null &&
    typeof record.bone === 'string' &&
    record.bone.length > 0 &&
    (record.axis === 'x' || record.axis === 'y' || record.axis === 'z') &&
    typeof record.radians === 'number' &&
    Number.isFinite(record.radians)
  );
}

function isPoseMorph(value: unknown): value is ShotSetPoseMorph {
  const record = value as Partial<ShotSetPoseMorph> | null;
  return (
    typeof record === 'object' &&
    record !== null &&
    typeof record.morph === 'string' &&
    record.morph.length > 0 &&
    typeof record.influence === 'number' &&
    Number.isFinite(record.influence)
  );
}

function isPoseTranslation(value: unknown): value is ShotSetPoseTranslation {
  const record = value as Partial<ShotSetPoseTranslation> | null;
  return (
    typeof record === 'object' &&
    record !== null &&
    typeof record.bone === 'string' &&
    record.bone.length > 0 &&
    (record.axis === 'x' || record.axis === 'y' || record.axis === 'z') &&
    typeof record.meters === 'number' &&
    Number.isFinite(record.meters)
  );
}

function isPoseStep(value: unknown): value is ShotSetPoseStep {
  return isPoseRotation(value) || isPoseMorph(value) || isPoseTranslation(value);
}

function isShotSetShot(value: unknown, poseNames: ReadonlySet<string>): value is ShotSetShot {
  const record = value as Partial<ShotSetShot & { yaw: number; bones: unknown[] }> | null;
  if (typeof record !== 'object' || record === null) return false;
  if (typeof record.label !== 'string' || !/^[a-z0-9][a-z0-9-]*$/i.test(record.label)) {
    return false;
  }
  if (
    record.pose !== undefined &&
    (typeof record.pose !== 'string' || !poseNames.has(record.pose))
  ) {
    return false;
  }
  if (record.view === 'turntable') {
    return typeof record.yaw === 'number' && Number.isFinite(record.yaw);
  }
  if (record.view === 'bone-zoom') {
    const zoom = record as Partial<Extract<ShotSetShot, { view: 'bone-zoom' }>>;
    if (zoom.yaw !== undefined && (typeof zoom.yaw !== 'number' || !Number.isFinite(zoom.yaw))) {
      return false;
    }
    return (
      Array.isArray(zoom.bones) &&
      zoom.bones.length > 0 &&
      zoom.bones.every((bone) => typeof bone === 'string' && bone.length > 0) &&
      typeof zoom.spanFraction === 'number' &&
      Number.isFinite(zoom.spanFraction) &&
      zoom.spanFraction > 0 &&
      zoom.spanFraction <= 2
    );
  }
  return false;
}

/**
 * Validate an untrusted shot-set definition at the relay boundary. Throws a
 * teaching error naming the defect — a malformed project contribution must
 * fail with a reason, not a deep three.js stack.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one bounded, flat validator keeps every field's teaching error at the relay boundary.
export function parseShotSetDefinition(value: unknown): AssetPreviewShotSetDefinition {
  const fail = (reason: string): never => {
    throw new Error(`Asset preview shot-set definition is invalid: ${reason}`);
  };
  const record = value as Partial<AssetPreviewShotSetDefinition> | null;
  if (typeof record !== 'object' || record === null) fail('expected an object.');
  const definition = record as Partial<AssetPreviewShotSetDefinition>;
  if (typeof definition.name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/i.test(definition.name)) {
    fail('`name` must be a short alphanumeric/dash identifier.');
  }
  if (
    definition.requiredBones !== undefined &&
    (!Array.isArray(definition.requiredBones) ||
      definition.requiredBones.some((bone) => typeof bone !== 'string' || bone.length === 0))
  ) {
    fail('`requiredBones` must be an array of non-empty bone names.');
  }
  if (
    definition.rigRequirementHint !== undefined &&
    typeof definition.rigRequirementHint !== 'string'
  ) {
    fail('`rigRequirementHint` must be a string.');
  }
  const poses = definition.poses ?? {};
  if (typeof poses !== 'object' || poses === null || Array.isArray(poses)) {
    fail('`poses` must be an object of named pose-step lists.');
  }
  for (const [poseName, steps] of Object.entries(poses)) {
    if (!Array.isArray(steps) || !steps.every(isPoseStep)) {
      fail(
        `pose ${JSON.stringify(poseName)} must be an array of {bone, axis, radians} ` +
          'and/or {morph, influence}.',
      );
    }
  }
  const poseNames = new Set(Object.keys(poses));
  if (
    !Array.isArray(definition.shots) ||
    definition.shots.length === 0 ||
    definition.shots.length > MAX_SHOT_SET_SHOTS
  ) {
    fail(`\`shots\` must list 1-${MAX_SHOT_SET_SHOTS} shots.`);
  }
  const shots = definition.shots as unknown[];
  const labels = new Set<string>();
  for (const shot of shots) {
    if (!isShotSetShot(shot, poseNames)) {
      fail(
        'every shot needs a label plus either {view:"turntable", yaw} or ' +
          '{view:"bone-zoom", bones, spanFraction, yaw?}, with every `yaw` a finite ' +
          'number of radians and `pose` naming a declared pose.',
      );
    }
    const { label } = shot as ShotSetShot;
    if (labels.has(label)) fail(`duplicate shot label ${JSON.stringify(label)}.`);
    labels.add(label);
  }
  return definition as AssetPreviewShotSetDefinition;
}

export const SOURCE_REVIEW_SHOT_LABELS = [
  'front',
  'back',
  'left',
  'right',
  'quarter-left',
  'quarter-right',
] as const;
export type SourceReviewShotLabel = (typeof SOURCE_REVIEW_SHOT_LABELS)[number];

export interface SourceReviewShotSetCapture {
  width: number;
  height: number;
  shots: Array<{ label: SourceReviewShotLabel; base64: string; mimeType: 'image/png' }>;
  contactSheet: {
    width: number;
    height: number;
    base64: string;
    mimeType: 'image/png';
  };
}

type MorphableObject = THREE.Object3D & {
  morphTargetDictionary?: Record<string, number>;
  morphTargetInfluences?: number[];
};

const DEFAULT_SIZE = 512;
const MIN_SIZE = 64;
// Four views plus the 2x2 sheet cross the editor relay as base64 JSON. At
// 1024px even incompressible RGBA data remains below its 50 MB request limit.
const MAX_SIZE = 1024;
const NEUTRAL_COLOR = 0x20242a;
const MODEL_FETCH_TIMEOUT_MS = 25_000;
const MAX_MODEL_BYTES = 64 * 1024 * 1024;

export function checkedDimension(value: number | undefined): number {
  const resolved = value ?? DEFAULT_SIZE;
  if (!Number.isInteger(resolved) || resolved < MIN_SIZE || resolved > MAX_SIZE) {
    throw new Error(`Asset preview dimensions must be integers from ${MIN_SIZE} to ${MAX_SIZE}.`);
  }
  return resolved;
}

export function pngBase64(canvas: HTMLCanvasElement): string {
  const dataUrl = canvas.toDataURL('image/png');
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/**
 * The node a preview must snapshot for `object`: itself, unless a SkinnedMesh
 * under it binds to bones OUTSIDE it — then the nearest ancestor that owns
 * both the mesh and every bone, the skeleton root the refusal in
 * `resolveExternalBones` names. A skinned mesh sits BESIDE its Armature in
 * three's own glTF layout (`Scene > [SkinnedMesh, Armature > bones]`), so a
 * click on a character lands on the mesh, and the mesh alone cannot be drawn
 * without the bones that pose it: every Humanoid exhibit's Inspector preview
 * was the red refusal listing all 68 bones (runhuman pass 143; traced live —
 * selecting the rig root renders a clean bind pose). A bone whose chain never
 * meets `object`'s stays external, so the honest refusal still fires there.
 */
export function assetPreviewSubject(object: THREE.Object3D): THREE.Object3D {
  const inside = new Set<THREE.Object3D>();
  object.traverse((node) => inside.add(node));
  let subject: THREE.Object3D = object;
  object.traverse((node) => {
    const skinned = node as THREE.SkinnedMesh;
    if (!(skinned as { isSkinnedMesh?: boolean }).isSkinnedMesh || !skinned.skeleton) return;
    for (const bone of skinned.skeleton.bones) {
      if (!bone || inside.has(bone)) continue;
      // Climb from the bone until an ancestor of the current subject is met.
      const subjectChain = new Set<THREE.Object3D>();
      for (let a: THREE.Object3D | null = subject; a; a = a.parent) subjectChain.add(a);
      let common: THREE.Object3D | null = null;
      for (let a: THREE.Object3D | null = bone; a; a = a.parent) {
        if (subjectChain.has(a)) {
          common = a;
          break;
        }
      }
      if (common && common !== subject) {
        subject = common;
        subject.traverse((n) => inside.add(n));
      }
    }
  });
  return subject;
}

/**
 * Build a render-only snapshot of an authored subtree. The source remains the
 * live Object3D truth: it is never reparented, hidden, normalized, or edited.
 * Skinned, morphed, and instanced render semantics are preserved while the
 * snapshot shares immutable geometry/material resources.
 */
export function createAssetPreviewSnapshot(source: THREE.Object3D): THREE.Object3D {
  // A skinned mesh can point at bones that are not in the selected subtree —
  // in practice because the model was duplicated with `Object3D.clone()`
  // instead of `SkeletonUtils.clone()`, which copies the bone nodes but leaves
  // every clone's `skeleton` referencing the ORIGINAL bones. Where the subtree
  // owns a same-named bone for each of them (it does for exactly that mount),
  // the snapshot binds to its own copies — the pose those copies carry is the
  // one the mount intended. Anything left unresolved is refused BY NAME below,
  // because binding to a bone that is not there would be an invented pose.
  const sourceNodes = new Set<THREE.Object3D>();
  source.traverse((object) => {
    sourceNodes.add(object);
  });
  const boneSubstitutes = resolveExternalBones(source, sourceNodes);
  const snapshot = cloneRenderableHierarchy(source, boneSubstitutes);

  // Preserve the selected root's authored world-space presentation even when
  // it lives below transformed parents. Descendant local transforms are kept.
  // Keep the exact composed matrix. Decomposing a rotated, non-uniformly
  // scaled ancestor chain into TRS would discard shear and change geometry.
  const exactWorldMatrix = objectWorldMatrix(source);
  snapshot.matrix.copy(exactWorldMatrix);
  snapshot.matrix.decompose(snapshot.position, snapshot.quaternion, snapshot.scale);
  snapshot.matrixAutoUpdate = false;
  snapshot.matrixWorld.copy(exactWorldMatrix);
  snapshot.matrixWorldAutoUpdate = source.matrixWorldAutoUpdate;
  // Isolation intentionally reveals a selected root that is hidden in the
  // scene; descendant visibility remains authored and the source is untouched.
  snapshot.visible = true;

  // Editor-only helpers are presentation siblings/children, never asset data.
  const helpers: THREE.Object3D[] = [];
  snapshot.traverse((object) => {
    if (object !== snapshot && object.userData['editorHelper']) helpers.push(object);
  });
  for (const helper of helpers) helper.parent?.remove(helper);

  return snapshot;
}

function objectWorldMatrix(object: THREE.Object3D): THREE.Matrix4 {
  const chain: THREE.Object3D[] = [];
  let current: THREE.Object3D | null = object;
  while (current) {
    chain.push(current);
    current = current.parent;
  }
  const manualBoundary = chain.findIndex((node) => !node.matrixWorldAutoUpdate);
  const world =
    manualBoundary >= 0 ? chain[manualBoundary]!.matrixWorld.clone() : new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const firstLocal = manualBoundary >= 0 ? manualBoundary - 1 : chain.length - 1;
  for (let index = firstLocal; index >= 0; index--) {
    const node = chain[index]!;
    if (node.matrixAutoUpdate) local.compose(node.position, node.quaternion, node.scale);
    else local.copy(node.matrix);
    world.multiply(local);
  }
  return world;
}

/**
 * For every bone a skinned mesh in `source` references from OUTSIDE `source`,
 * the same-named bone inside it — or a thrown refusal naming what could not be
 * resolved. An empty map means the subtree's skeletons are already complete.
 *
 * The unresolvable case is real (a bone with no name, or one whose owner truly
 * lives above the selection), and it stays an error: the alternative is a
 * picture of a mesh bound to bones the caller never selected. What changed is
 * that the error now says WHICH mesh and WHICH bones, because "Select the
 * complete skeleton root" with nothing named is a dead end — there is no way
 * to act on it from the terminal that produced it.
 */
function resolveExternalBones(
  source: THREE.Object3D,
  sourceNodes: ReadonlySet<THREE.Object3D>,
): Map<THREE.Bone, THREE.Bone> {
  const substitutes = new Map<THREE.Bone, THREE.Bone>();
  const unresolved = new Map<string, { mesh: string; bone: string; sameNamed: number }>();
  let bonesByName: Map<string, THREE.Bone[]> | null = null;
  const nameIndex = (): Map<string, THREE.Bone[]> => {
    if (bonesByName) return bonesByName;
    const index = new Map<string, THREE.Bone[]>();
    for (const node of sourceNodes) {
      const bone = node as THREE.Bone;
      if (!bone.isBone || bone.name === '') continue;
      const bucket = index.get(bone.name);
      if (bucket) bucket.push(bone);
      else index.set(bone.name, [bone]);
    }
    bonesByName = index;
    return index;
  };

  source.traverse((object) => {
    const skinned = object as THREE.SkinnedMesh;
    if (!skinned.isSkinnedMesh) return;
    const meshName = skinned.name || skinned.uuid;
    for (const bone of skinned.skeleton.bones) {
      if (bone && sourceNodes.has(bone)) continue;
      // Substitution is a per-BONE fact, so an answer found for one mesh holds
      // for every other mesh referencing the same bone object — and they do:
      // GLTFLoader gives every primitive of one skin a SkinnedMesh bound to the
      // SAME Skeleton, which is the ordinary body+outfit character. Reading
      // this as "already handled, nothing to do here" and falling through to
      // the unresolved ledger refused exactly those models, with a sentence
      // ("owns no bone of the same name") that the first mesh had just
      // disproved.
      if (bone && substitutes.has(bone)) continue;
      const candidates = bone ? (nameIndex().get(bone.name) ?? []) : [];
      if (candidates.length === 1) {
        substitutes.set(bone as THREE.Bone, candidates[0] as THREE.Bone);
        continue;
      }
      const boneName = bone?.name || '(unnamed bone)';
      unresolved.set(`${meshName} -> ${boneName}`, {
        mesh: meshName,
        bone: boneName,
        sameNamed: candidates.length,
      });
    }
  });

  if (unresolved.size > 0) {
    // Two refusals, and they are NOT the same fact: nothing of that name to
    // bind to, versus several and no way to tell which was meant. Reporting
    // one as the other is how an un-actionable error survives a fix that was
    // supposed to remove it.
    const detail = [...unresolved.values()]
      .map(({ mesh, bone, sameNamed }) =>
        sameNamed > 1
          ? `${mesh} -> ${bone} (${sameNamed} bones inside the selection share that name — ` +
            'which one is meant is ambiguous)'
          : `${mesh} -> ${bone} (no bone of that name inside the selection)`,
      )
      .join('; ');
    throw new Error(
      'Asset preview selection references bones outside its hierarchy that it cannot bind to: ' +
        `${detail}. Select the complete skeleton root — the node that owns both the skinned ` +
        'mesh and its bones.',
    );
  }
  return substitutes;
}

/**
 * Clone a complete authored hierarchy without copying editor-only helpers or
 * arbitrary userData. Object3D.clone JSON-serializes userData, which is unsafe
 * for live AnimationMixer references, while SkeletonUtils.clone first invokes
 * that same recursive clone. This direct render clone keeps Three.js object
 * semantics and remaps complete internal skeletons after building the tree.
 *
 * `boneSubstitutes` redirects a bone reference that points outside the source
 * subtree to the same-named bone inside it before the remap (see
 * {@link resolveExternalBones}); an empty map is the ordinary case.
 */
function cloneRenderableHierarchy(
  source: THREE.Object3D,
  boneSubstitutes: ReadonlyMap<THREE.Bone, THREE.Bone> = new Map(),
): THREE.Object3D {
  const cloneBySource = new Map<THREE.Object3D, THREE.Object3D>();
  const skinnedPairs: Array<[THREE.SkinnedMesh, THREE.SkinnedMesh]> = [];

  const cloneNode = (object: THREE.Object3D): THREE.Object3D => {
    const clone = createRenderClone(object);
    cloneBySource.set(object, clone);
    copyObjectPresentation(object, clone);
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) {
      skinnedPairs.push([object as THREE.SkinnedMesh, clone as THREE.SkinnedMesh]);
    }
    const sourceLod = object as THREE.LOD;
    if (sourceLod.isLOD) {
      const cloneLod = clone as THREE.LOD;
      // A deterministic still preview freezes auto-updating LODs to one level.
      // Manually controlled LODs retain their exact authored visibility, which
      // may intentionally contain zero or several visible levels.
      const visibleLevels = sourceLod.levels.filter((level) => level.object.visible);
      const activeSourceLevel = visibleLevels.length === 1 ? visibleLevels[0] : sourceLod.levels[0];
      cloneLod.autoUpdate = false;
      const levelObjects = new Set(sourceLod.levels.map((level) => level.object));
      for (const level of sourceLod.levels) {
        if (isEditorPresentation(level.object)) continue;
        const levelClone = cloneNode(level.object);
        levelClone.visible = sourceLod.autoUpdate
          ? level === activeSourceLevel
          : level.object.visible;
        cloneLod.addLevel(levelClone, level.distance, level.hysteresis);
      }
      for (const child of object.children) {
        if (!levelObjects.has(child) && !isEditorPresentation(child)) clone.add(cloneNode(child));
      }
    } else {
      for (const child of object.children) {
        if (!isEditorPresentation(child)) clone.add(cloneNode(child));
      }
    }
    return clone;
  };

  const root = cloneNode(source);
  for (const [original, clone] of skinnedPairs) {
    const skeleton = original.skeleton.clone();
    skeleton.bones = original.skeleton.bones.map((bone) => {
      const mapped = cloneBySource.get(boneSubstitutes.get(bone) ?? bone);
      if (!(mapped as THREE.Bone | undefined)?.isBone) {
        throw new Error(`Asset preview could not map skeleton bone: ${bone.name || bone.uuid}`);
      }
      return mapped as THREE.Bone;
    });
    clone.skeleton = skeleton;
    clone.bindMode = original.bindMode;
    clone.bindMatrix.copy(original.bindMatrix);
    clone.bindMatrixInverse.copy(original.bindMatrixInverse);
  }
  return root;
}

function createRenderClone(object: THREE.Object3D): THREE.Object3D {
  const skinned = object as THREE.SkinnedMesh;
  if (skinned.isSkinnedMesh) return new THREE.SkinnedMesh(skinned.geometry, skinned.material);
  const instanced = object as THREE.InstancedMesh;
  if (instanced.isInstancedMesh) {
    const clone = new THREE.InstancedMesh(instanced.geometry, instanced.material, instanced.count);
    clone.instanceMatrix.copy(instanced.instanceMatrix);
    clone.instanceColor = instanced.instanceColor
      ? (instanced.instanceColor.clone() as THREE.InstancedBufferAttribute)
      : null;
    clone.morphTexture = instanced.morphTexture;
    return clone;
  }
  const mesh = object as THREE.Mesh;
  if (mesh.isMesh) return new THREE.Mesh(mesh.geometry, mesh.material);
  const line = object as THREE.Line;
  if ((object as THREE.LineSegments).isLineSegments) {
    return new THREE.LineSegments(line.geometry, line.material);
  }
  if ((object as THREE.LineLoop).isLineLoop)
    return new THREE.LineLoop(line.geometry, line.material);
  if (line.isLine) return new THREE.Line(line.geometry, line.material);
  const points = object as THREE.Points;
  if (points.isPoints) return new THREE.Points(points.geometry, points.material);
  const sprite = object as THREE.Sprite;
  if (sprite.isSprite) return new THREE.Sprite(sprite.material);
  if ((object as THREE.LOD).isLOD) return new THREE.LOD();
  if ((object as THREE.Bone).isBone) return new THREE.Bone();
  if ((object as THREE.Group).isGroup) return new THREE.Group();
  return new THREE.Object3D();
}

function copyObjectPresentation(source: THREE.Object3D, clone: THREE.Object3D): void {
  clone.name = source.name;
  clone.up.copy(source.up);
  clone.position.copy(source.position);
  clone.quaternion.copy(source.quaternion);
  clone.scale.copy(source.scale);
  clone.matrix.copy(source.matrix);
  clone.matrixWorld.copy(source.matrixWorld);
  clone.matrixAutoUpdate = source.matrixAutoUpdate;
  clone.matrixWorldAutoUpdate = source.matrixWorldAutoUpdate;
  clone.visible = source.visible;
  clone.castShadow = source.castShadow;
  clone.receiveShadow = source.receiveShadow;
  // Separate preview renderers must not populate boundingSphere on geometry
  // shared read-only with the live source. The deterministic cameras already
  // frame the snapshot, so clone-only culling is unnecessary.
  clone.frustumCulled = false;
  clone.renderOrder = source.renderOrder;
  // Asset Editor is a presentation scene with layer-0 cameras. Normalize only
  // the clone so authored custom-layer content is visible without changing the
  // live entity's layer assignment.
  clone.layers.set(0);
  clone.animations = [...source.animations];

  const sourceMorph = source as MorphableObject;
  const cloneMorph = clone as MorphableObject;
  if (sourceMorph.morphTargetInfluences) {
    if (sourceMorph.morphTargetDictionary) {
      cloneMorph.morphTargetDictionary = { ...sourceMorph.morphTargetDictionary };
    }
    cloneMorph.morphTargetInfluences = [...sourceMorph.morphTargetInfluences];
  }
  const sourceSprite = source as THREE.Sprite;
  if (sourceSprite.isSprite) (clone as THREE.Sprite).center.copy(sourceSprite.center);
}

function isEditorPresentation(object: THREE.Object3D): boolean {
  const editorLayerMask = 1 << EDITOR_LAYER;
  return Boolean(
    object.userData['editorHelper'] ||
      object.userData['editorIcon'] ||
      (object.layers.mask & editorLayerMask) !== 0,
  );
}

export function disposeAssetPreviewSnapshot(root: THREE.Object3D): void {
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((object) => {
    const skinned = object as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) skeletons.add(skinned.skeleton);
    const instanced = object as THREE.InstancedMesh;
    if (instanced.isInstancedMesh) {
      // Matrix/color buffers belong to the clone; its morph texture is shared.
      // Preserve that texture for the source owner's eventual disposal too.
      const morphTexture = instanced.morphTexture;
      instanced.morphTexture = null;
      instanced.dispose();
      instanced.morphTexture = morphTexture;
    }
  });
  for (const skeleton of skeletons) skeleton.dispose();
}

export interface NativeObjectPreviewSource {
  readonly root: THREE.Object3D;
  readonly animations?: readonly THREE.AnimationClip[];
  dispose(): void;
}

export interface OwnedObjectPreviewSnapshot {
  readonly root: THREE.Object3D;
  dispose(): void;
}

/**
 * Acquires a project-owned native source and a graph-isolated viewer snapshot
 * as one ordered lifetime. Render resources remain shared read-only.
 * Snapshot-owned skeleton textures are released before the source releases
 * its geometry, materials, textures, and rigs.
 */
export function createOwnedObjectPreviewSnapshot(
  factory: () => NativeObjectPreviewSource,
): OwnedObjectPreviewSnapshot {
  const source = factory();
  let snapshot: THREE.Object3D;
  try {
    snapshot = createAssetPreviewSnapshot(source.root);
    snapshot.animations = [...(source.animations ?? source.root.animations)];
  } catch (error) {
    try {
      source.dispose();
    } catch (disposeError) {
      throw new AggregateError(
        [error, disposeError],
        'Object3D preview snapshot creation and source cleanup both failed.',
      );
    }
    throw error;
  }
  let disposed = false;
  return {
    root: snapshot,
    dispose() {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      try {
        disposeAssetPreviewSnapshot(snapshot);
      } catch (error) {
        errors.push(error);
      }
      try {
        source.dispose();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, 'Object3D preview snapshot cleanup failed.');
      }
    },
  };
}

export function measureAssetPreview(
  object: THREE.Object3D,
  view: AssetPreviewView = 'front',
): AssetPreviewFraming {
  resolveWorldMatricesLikeRenderer(object);
  const box = readOnlyRenderableBounds(object, view);
  if (box.isEmpty()) throw new Error('Asset preview source has no renderable bounds.');
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  return {
    center,
    size,
    radius: Math.max(size.length() / 2, 0.001),
  };
}

/**
 * Bring a subtree's world matrices to exactly the state the RENDERER will
 * compute for it, then measure from that.
 *
 * This is not interchangeable with `updateWorldMatrix`, and the difference
 * is measurable rather than stylistic: `SkinnedMesh` OVERRIDES
 * `updateMatrixWorld` to refresh `bindMatrixInverse` from its current world
 * matrix (attached bind mode), and `getVertexPosition` — how this module
 * reads skinned geometry — runs the vertex through
 * `bindMatrixInverse * boneWorld * boneInverse * bindMatrix`. Measure after
 * `updateWorldMatrix` alone and `bindMatrixInverse` is still the value from
 * before the subject was re-parented (for example under
 * {@link faceFrontSubject}'s yaw pivot), so the mesh's own transform gets
 * applied TWICE to every skinned vertex while the render applies it once.
 *
 * A yaw pivot of PI (our generated rigs persist `forward = [0,0,-1]`)
 * therefore mirrored the measured bounds in Z: the size stayed right and the
 * CENTRE flipped sign, which is invisible when the camera looks down Z
 * (front/back) and pushes the subject bodily out of frame when it looks
 * down X (left/right). That is the whole of the "long body runs off the
 * frame edge at yaw +/-PI/2" defect.
 *
 * `updateMatrixWorld(force)` is used deliberately in preference to
 * `updateWorldMatrix`: it honours `matrixWorldAutoUpdate` exactly as the
 * renderer's own `scene.updateMatrixWorld()` does, so a snapshot that pins
 * an exact composed matrix is measured the way it is drawn.
 */
function resolveWorldMatricesLikeRenderer(object: THREE.Object3D): void {
  object.parent?.updateWorldMatrix(true, false);
  object.updateMatrixWorld(true);
}

/** Read exact renderable vertices without populating shared geometry bounds. */
function readOnlyRenderableBounds(root: THREE.Object3D, view: AssetPreviewView): THREE.Box3 {
  const box = new THREE.Box3();
  forEachRenderableVertex(root, assetViewBasis(view), view === 'perspective', (point) =>
    box.expandByPoint(point),
  );
  return box;
}

/**
 * The subject's ORIENTED extent along each supplied camera basis, from one
 * walk of the same rendered vertices {@link readOnlyRenderableBounds} reads.
 * This is what frames a turntable shot: an axis-aligned box is only a proxy
 * for what a yawed camera sees, and for a long subject held in a bent pose
 * it is a poor one.
 *
 * Sprites are billboards with no single true basis; their corners are
 * expanded against the FIRST basis, which is an approximation this engine
 * can afford (a rigged creature preview has no sprites) and never an
 * under-estimate for the other bases by more than the sprite's own size.
 */
function measureProjectedSpans(
  root: THREE.Object3D,
  bases: readonly OrthographicViewBasis[],
): ProjectedSpan[] {
  const spans = bases.map(() => createProjectedSpan());
  if (bases.length === 0) return spans;
  resolveWorldMatricesLikeRenderer(root);
  forEachRenderableVertex(root, bases[0]!, false, (point) => {
    for (let index = 0; index < bases.length; index++) {
      expandProjectedSpan(spans[index]!, point, bases[index]!);
    }
  });
  return spans;
}

/**
 * How many of the staged subject's rendered PRIMITIVES could appear in each
 * shot's frame, from ONE walk of the same vertices every other measurement
 * here reads (the one-walk-many-bases shape {@link measureProjectedSpans}
 * uses).
 *
 * This is the empty-frame guard's measurement. It is deliberately geometric
 * rather than a pixel read of the rendered image: the capture already knows
 * exactly which triangles it will draw and exactly which frustum each shot
 * renders, so this is arithmetic — no readback, no threshold on a background
 * colour, and it behaves identically for a transparent background and for a
 * subject the same colour as the clear colour.
 *
 * The unit is a primitive rather than a vertex on purpose — see
 * {@link spanOverlapsShotFrame}: a tight crop can sit entirely INSIDE one
 * large face, containing no vertex while rendering solid geometry, and a
 * guard that called that "empty" would be exactly the warning nobody
 * believes.
 */
function measureShotFrameCoverage(
  subject: THREE.Object3D,
  frames: readonly { basis: OrthographicViewBasis; window: ShotFrameWindow }[],
): { framed: number[]; total: number } {
  const framed = frames.map(() => 0);
  let total = 0;
  if (frames.length === 0) return { framed, total };
  resolveWorldMatricesLikeRenderer(subject);
  const spans = frames.map(() => createProjectedSpan());
  let open = -1;
  const closePrimitive = (): void => {
    if (open < 0) return;
    total++;
    for (let index = 0; index < frames.length; index++) {
      if (spanOverlapsShotFrame(spans[index]!, frames[index]!.window)) framed[index]!++;
      resetProjectedSpan(spans[index]!);
    }
  };
  forEachRenderableVertex(subject, frames[0]!.basis, false, (point, primitive) => {
    if (primitive !== open) {
      closePrimitive();
      open = primitive;
    }
    for (let index = 0; index < frames.length; index++) {
      expandProjectedSpan(spans[index]!, point, frames[index]!.basis);
    }
  });
  closePrimitive();
  return { framed, total };
}

/**
 * Walk every vertex this subtree actually renders — skinned and morphed
 * through `getVertexPosition`, per-instance for `InstancedMesh`, and the
 * billboard quad's world-space corners for a `Sprite` — without populating
 * bounding volumes on geometry shared read-only with the live source.
 *
 * `emit` also receives the index of the PRIMITIVE the vertex belongs to
 * (triangle, line segment, sprite quad, splat box), which is constant across
 * that primitive's vertices and strictly increasing across the walk. Callers
 * that only need points ignore it; the empty-frame guard needs primitives,
 * because a frame that contains no VERTEX may still be filled by one large
 * face (see {@link spanOverlapsShotFrame}).
 */
function forEachRenderableVertex(
  root: THREE.Object3D,
  basis: { right: THREE.Vector3; up: THREE.Vector3 },
  perspective: boolean,
  emit: (point: THREE.Vector3, primitive: number) => void,
): void {
  const splatBounds = new THREE.Box3();
  const splatCorner = new THREE.Vector3();
  const vertex = new THREE.Vector3();
  const instanceMatrix = new THREE.Matrix4();
  let primitive = 0;
  const visit = (object: THREE.Object3D): void => {
    if (!object.visible) return;
    // A live scene subject (`captureSceneStageAssetPreview`) carries its game's
    // implementation as real children — a world-space particle renderer at
    // identity, a pooled batch — and framing on those puts the subject in a
    // corner of its own portrait. Subtree-scoped, same rule as the selection
    // cage (`content-bounds.ts`); a loaded model file carries no marks, so the
    // asset lanes are unaffected. The ROOT is always measured: a caller who
    // named it meant it.
    if (object !== root && isBuiltInternal(object)) return;
    if (hasUserData(object, 'gaussianSplat')) {
      splatBounds.copy((object as SplatMesh).getBoundingBox()).applyMatrix4(object.matrixWorld);
      const splatPrimitive = primitive++;
      for (const x of [splatBounds.min.x, splatBounds.max.x]) {
        for (const y of [splatBounds.min.y, splatBounds.max.y]) {
          for (const z of [splatBounds.min.z, splatBounds.max.z]) {
            emit(splatCorner.set(x, y, z), splatPrimitive);
          }
        }
      }
    }
    const lod = object as THREE.LOD;
    if (lod.isLOD && lod.levels.length > 0) {
      const levelObjects = new Set(lod.levels.map((level) => level.object));
      for (const level of lod.levels) visit(level.object);
      for (const child of object.children) {
        if (!levelObjects.has(child)) visit(child);
      }
      return;
    }
    const sprite = object as THREE.Sprite;
    if (sprite.isSprite) {
      if (sprite.material.visible) {
        if (perspective && !sprite.material.sizeAttenuation) {
          throw new Error(
            'Asset preview cannot deterministically frame a perspective Sprite with sizeAttenuation disabled.',
          );
        }
        const anchor = new THREE.Vector3().setFromMatrixPosition(sprite.matrixWorld);
        const scale = new THREE.Vector3().setFromMatrixScale(sprite.matrixWorld);
        const cosine = Math.cos(sprite.material.rotation);
        const sine = Math.sin(sprite.material.rotation);
        const spritePrimitive = primitive++;
        for (const x of [-sprite.center.x, 1 - sprite.center.x]) {
          for (const y of [-sprite.center.y, 1 - sprite.center.y]) {
            const scaledX = x * Math.abs(scale.x);
            const scaledY = y * Math.abs(scale.y);
            const rotatedX = cosine * scaledX - sine * scaledY;
            const rotatedY = sine * scaledX + cosine * scaledY;
            emit(
              anchor
                .clone()
                .addScaledVector(basis.right, rotatedX)
                .addScaledVector(basis.up, rotatedY),
              spritePrimitive,
            );
          }
        }
      }
    }
    // Sprite's internal unit quad is shader-billboarded above; treating that
    // private geometry as an ordinary world-space mesh would double-count it.
    const geometry = sprite.isSprite
      ? undefined
      : (object as THREE.Mesh | THREE.Line | THREE.Points).geometry;
    if (geometry) {
      const position = geometry.getAttribute('position');
      if (position) {
        const renderedIndices = collectRenderedVertexIndices(object, geometry, position.count);
        const stride = renderPrimitiveStride(object, renderedIndices.length);
        const primitiveCount = Math.ceil(renderedIndices.length / stride);
        const instanced = object as THREE.InstancedMesh;
        if (instanced.isInstancedMesh) {
          const morphProbe = new THREE.Mesh(instanced.geometry, instanced.material);
          for (let instance = 0; instance < instanced.count; instance++) {
            instanced.getMatrixAt(instance, instanceMatrix);
            if (instanced.morphTexture) instanced.getMorphAt(instance, morphProbe);
            renderedIndices.forEach((index, order) => {
              morphProbe.getVertexPosition(index, vertex);
              vertex.applyMatrix4(instanceMatrix).applyMatrix4(instanced.matrixWorld);
              emit(vertex, primitive + Math.floor(order / stride));
            });
            primitive += primitiveCount;
          }
        } else {
          const mesh = object as THREE.Mesh;
          renderedIndices.forEach((index, order) => {
            if (mesh.isMesh) mesh.getVertexPosition(index, vertex);
            else getNonMeshVertexPosition(object as MorphableObject, geometry, index, vertex);
            vertex.applyMatrix4(object.matrixWorld);
            emit(vertex, primitive + Math.floor(order / stride));
          });
          primitive += primitiveCount;
        }
      }
    }
    for (const child of object.children) visit(child);
  };
  visit(root);
}

function collectRenderedVertexIndices(
  object: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  positionCount: number,
): number[] {
  const material = (object as THREE.Mesh | THREE.Line | THREE.Points).material;
  if (!material) return [];
  const elementCount = geometry.index?.count ?? positionCount;
  const drawStart = Math.max(0, geometry.drawRange.start);
  const drawEnd = Math.min(
    elementCount,
    Number.isFinite(geometry.drawRange.count) ? drawStart + geometry.drawRange.count : elementCount,
  );
  const ranges: Array<[number, number]> = [];
  if (Array.isArray(material)) {
    for (const group of geometry.groups) {
      const materialIndex = group.materialIndex ?? 0;
      if (!material[materialIndex]?.visible) continue;
      const start = Math.max(drawStart, group.start);
      const end = Math.min(drawEnd, group.start + group.count);
      if (end > start) ranges.push([start, end]);
    }
  } else if (material.visible && drawEnd > drawStart) {
    ranges.push([drawStart, drawEnd]);
  }
  const indices: number[] = [];
  for (const [start, end] of ranges) {
    const count = assembledElementCount(object, end - start);
    for (let element = start; element < start + count; element++) {
      indices.push(geometry.index ? geometry.index.getX(element) : element);
    }
  }
  return indices;
}

/** How many consecutive emitted vertices form ONE drawn primitive, matching
 *  the assembly {@link assembledElementCount} already trims the index list
 *  to. A line STRIP is one connected run rather than N segments — grouping it
 *  coarsely can only make the empty-frame guard quieter, never louder, which
 *  is the safe direction for every approximation here. */
function renderPrimitiveStride(object: THREE.Object3D, emittedCount: number): number {
  if ((object as THREE.Mesh).isMesh) return 3;
  if ((object as THREE.LineSegments).isLineSegments) return 2;
  if ((object as THREE.Line).isLine) return Math.max(emittedCount, 1);
  return 1;
}

function assembledElementCount(object: THREE.Object3D, count: number): number {
  if ((object as THREE.Mesh).isMesh) return count - (count % 3);
  if ((object as THREE.LineSegments).isLineSegments) return count - (count % 2);
  if ((object as THREE.Line).isLine) return count >= 2 ? count : 0;
  return count;
}

function getNonMeshVertexPosition(
  object: MorphableObject,
  geometry: THREE.BufferGeometry,
  index: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  const position = geometry.getAttribute('position');
  target.fromBufferAttribute(position, index);
  const morphPositions = geometry.morphAttributes['position'];
  const influences = object.morphTargetInfluences;
  if (!morphPositions || !influences) return target;
  const base = target.clone();
  const delta = new THREE.Vector3();
  const sample = new THREE.Vector3();
  for (let morphIndex = 0; morphIndex < morphPositions.length; morphIndex++) {
    const influence = influences[morphIndex] ?? 0;
    if (influence === 0) continue;
    sample.fromBufferAttribute(morphPositions[morphIndex]!, index);
    if (!geometry.morphTargetsRelative) sample.sub(base);
    delta.addScaledVector(sample, influence);
  }
  return target.add(delta);
}

function orthographicCamera(
  view: Exclude<AssetPreviewView, 'perspective'>,
  framing: AssetPreviewFraming,
  aspect: number,
): THREE.OrthographicCamera {
  const { center, size, radius } = framing;
  let horizontal = size.x;
  let vertical = size.y;
  const basis = assetViewBasis(view);
  const { direction, up } = basis;

  if (view === 'right') {
    horizontal = size.z;
  } else {
    if (view === 'top') {
      horizontal = size.x;
      vertical = size.z;
    }
  }

  const frame = fitOrthographicFrame(horizontal / 2, vertical / 2, aspect);
  return createOrthographicShotCamera(
    center,
    { direction, right: basis.right, up },
    frame,
    radius * 3 + 1,
    radius * 10 + 10,
  );
}

function perspectiveCamera(
  framing: AssetPreviewFraming,
  aspect: number,
  requestedDirection?: THREE.Vector3,
  requestedDistance?: number,
): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(35, aspect, 0.01, framing.radius * 20 + 20);
  const halfVerticalFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const halfHorizontalFov = Math.atan(Math.tan(halfVerticalFov) * aspect);
  const defaultBasis = assetViewBasis('perspective');
  const viewDirection = requestedDirection?.clone().normalize() ?? defaultBasis.direction;
  const provisionalUp =
    Math.abs(viewDirection.y) > 0.999 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const right = requestedDirection
    ? provisionalUp.clone().cross(viewDirection).normalize()
    : defaultBasis.right;
  const up = requestedDirection ? viewDirection.clone().cross(right).normalize() : defaultBasis.up;
  const half = framing.size.clone().multiplyScalar(0.5);
  let distance = 0;
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        const offset = new THREE.Vector3(x * half.x, y * half.y, z * half.z);
        const towardCamera = offset.dot(viewDirection);
        distance = Math.max(
          distance,
          towardCamera +
            (Math.abs(offset.dot(right)) * ASSET_PREVIEW_PADDING) / Math.tan(halfHorizontalFov),
          towardCamera +
            (Math.abs(offset.dot(up)) * ASSET_PREVIEW_PADDING) / Math.tan(halfVerticalFov),
        );
      }
    }
  }
  camera.position
    .copy(framing.center)
    .addScaledVector(viewDirection, Math.max(requestedDistance ?? distance, 0.01));
  camera.lookAt(framing.center);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function assetViewBasis(view: AssetPreviewView): {
  direction: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
} {
  const direction =
    view === 'front'
      ? new THREE.Vector3(0, 0, 1)
      : view === 'right'
        ? new THREE.Vector3(1, 0, 0)
        : view === 'top'
          ? new THREE.Vector3(0, 1, 0)
          : new THREE.Vector3(1, 0.72, 1).normalize();
  const provisionalUp = view === 'top' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const right = provisionalUp.clone().cross(direction).normalize();
  const up = direction.clone().cross(right).normalize();
  return { direction, right, up };
}

export function createAssetPreviewCamera(
  view: AssetPreviewView,
  framing: AssetPreviewFraming,
  aspect: number,
): THREE.Camera {
  return view === 'perspective'
    ? perspectiveCamera(framing, aspect)
    : orthographicCamera(view, framing, aspect);
}

/** Aspect-aware perspective framing for interactive preview surfaces. Unlike
 * the fixed capture views, these may request a project-defined camera angle. */
export function createPerspectiveAssetPreviewCamera(
  framing: AssetPreviewFraming,
  aspect: number,
  direction?: THREE.Vector3,
): THREE.PerspectiveCamera {
  return perspectiveCamera(framing, aspect, direction);
}

/**
 * The turntable cameras for one staged subject, framed from what each yaw
 * ACTUALLY sees.
 *
 * Every yaw of a subject is measured separately (an oriented projection of
 * the rendered vertices onto that yaw's screen axes), each shot is centred
 * on its own projection, and the SCALE is the union across the set's yaws —
 * see {@link unionOrthographicFrames} for why the union rather than a
 * per-shot exact fit. The depth budget still comes from the subject's own
 * bounding radius, which no yaw can exceed.
 *
 * The predecessor derived every yaw from one world-axis-aligned box, which
 * both over-framed a bent, elongated subject and — because it centred every
 * yaw on that box's centre — placed the subject wrong the moment the
 * measured box and the drawn subject disagreed.
 */
function turntableCameras(
  subject: THREE.Object3D,
  framing: AssetPreviewFraming,
  yaws: readonly number[],
  aspect: number,
): Map<number, THREE.OrthographicCamera> {
  const bases = yaws.map(turntableViewBasis);
  const spans = measureProjectedSpans(subject, bases);
  const frame = unionOrthographicFrames(
    spans.map((span): OrthographicFrame => fitProjectedSpanFrame(span, aspect)),
  );
  const cameras = new Map<number, THREE.OrthographicCamera>();
  yaws.forEach((yaw, index) => {
    cameras.set(
      yaw,
      createOrthographicShotCamera(
        projectedSpanCenter(spans[index]!, bases[index]!),
        bases[index]!,
        frame,
        framing.radius * 3 + 1,
        framing.radius * 10 + 10,
      ),
    );
  });
  return cameras;
}

/** Six source-review views aligned to the asset's declared semantic forward
 * rather than mislabeled world axes. This is bounding-box framing only: it
 * does not require or modify a skeleton. */
export function captureSourceReviewShotSetAssetPreview(
  source: THREE.Object3D,
  forward: readonly [number, number, number],
  options: AssetPreviewOptions = {},
): SourceReviewShotSetCapture {
  const width = checkedDimension(options.width);
  const height = checkedDimension(options.height);
  const background = options.background ?? 'neutral';
  const snapshot = createAssetPreviewSnapshot(source);
  let renderer: THREE.WebGLRenderer | null = null;

  try {
    const framing = measureAssetPreview(snapshot, 'perspective');
    const scene = createPreviewScene(snapshot, framing);
    const activeRenderer = markHostRenderer(
      new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      }),
    );
    renderer = activeRenderer;
    activeRenderer.setPixelRatio(1);
    activeRenderer.outputColorSpace = THREE.SRGBColorSpace;
    activeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    activeRenderer.toneMappingExposure = 1;
    activeRenderer.setClearColor(NEUTRAL_COLOR, background === 'transparent' ? 0 : 1);
    activeRenderer.setSize(width, height, false);
    applyStudioEnvironment(scene, activeRenderer);

    const baseYaw = Math.atan2(forward[0], forward[2]);
    const aspect = width / height;
    const perspectiveDirection = (yaw: number) =>
      new THREE.Vector3(Math.sin(yaw), 0.72, Math.cos(yaw)).normalize();
    const orthographicYaws = [
      baseYaw,
      baseYaw + Math.PI,
      baseYaw - Math.PI / 2,
      baseYaw + Math.PI / 2,
    ];
    const turntable = turntableCameras(snapshot, framing, orthographicYaws, aspect);
    const shotCameras: Array<{ label: SourceReviewShotLabel; camera: THREE.Camera }> = [
      { label: 'front', camera: turntable.get(orthographicYaws[0]!)! },
      { label: 'back', camera: turntable.get(orthographicYaws[1]!)! },
      { label: 'left', camera: turntable.get(orthographicYaws[2]!)! },
      { label: 'right', camera: turntable.get(orthographicYaws[3]!)! },
      {
        label: 'quarter-left',
        camera: createPerspectiveAssetPreviewCamera(
          framing,
          aspect,
          perspectiveDirection(baseYaw - Math.PI / 4),
        ),
      },
      {
        label: 'quarter-right',
        camera: createPerspectiveAssetPreviewCamera(
          framing,
          aspect,
          perspectiveDirection(baseYaw + Math.PI / 4),
        ),
      },
    ];

    const shots: SourceReviewShotSetCapture['shots'] = [];
    const columns = 2;
    const rows = 3;
    const sheetCanvas = document.createElement('canvas');
    sheetCanvas.width = width * columns;
    sheetCanvas.height = height * rows;
    const sheetContext = sheetCanvas.getContext('2d');
    if (!sheetContext) throw new Error('Unable to create the source-review contact sheet.');

    shotCameras.forEach(({ label, camera }, index) => {
      activeRenderer.render(scene, camera);
      shots.push({ label, base64: pngBase64(activeRenderer.domElement), mimeType: 'image/png' });
      const x = (index % columns) * width;
      const y = Math.floor(index / columns) * height;
      sheetContext.drawImage(activeRenderer.domElement, x, y, width, height);
      const displayLabel =
        label === 'quarter-left'
          ? '3/4-L'
          : label === 'quarter-right'
            ? '3/4-R'
            : label.toUpperCase();
      drawBitmapLabel(sheetContext, displayLabel, x, y, width, height);
    });

    return {
      width,
      height,
      shots,
      contactSheet: {
        width: width * columns,
        height: height * rows,
        base64: pngBase64(sheetCanvas),
        mimeType: 'image/png',
      },
    };
  } finally {
    if (renderer) disposeStudioEnvironment(renderer);
    renderer?.dispose();
    renderer?.forceContextLoss();
    disposeAssetPreviewSnapshot(snapshot);
  }
}

/**
 * A tight orthographic close-up that frames every given world-space anchor
 * point (plus a margin proportional to the WHOLE MODEL's own bounding
 * radius — never a fixed reference-human height, so a goblin's crop stays
 * goblin-scaled). A single anchor (head, one shoulder) yields a fixed-size
 * crop around that point; two anchors that are naturally far apart in a
 * T-pose rig (both hands, both feet) still get a camera wide/tall enough to
 * hold both — the historical fixed-height-zoom defect the line-up harness's
 * own `zoom=head` fix (B5.1) already had to correct once, generalized here
 * to "the crop must actually contain what it claims to frame" for every
 * region, not just proportional scaling.
 *
 * The crop is taken from the shot's own `yaw` (the turntable convention;
 * omitted means 0, the front camera this used to be hardcoded to). An angle
 * is not decoration on a long subject: a junction whose axis runs down the
 * body's length — a tail root, a hip chain, a sail seen edge-on — has the
 * body itself standing between the front camera and the anchor, so the crop
 * frames the right point and photographs the wrong thing.
 */
function boneZoomCamera(
  anchors: readonly THREE.Vector3[],
  basis: OrthographicViewBasis,
  overallRadius: number,
  spanFraction: number,
  aspect: number,
): THREE.OrthographicCamera {
  const center = boneZoomCenter(anchors);
  const frame = fitBoneZoomFrame(anchors, center, basis, overallRadius, spanFraction, aspect);
  const distance = overallRadius * 3 + 1;
  return createOrthographicShotCamera(
    center,
    basis,
    frame,
    distance,
    distance + overallRadius * 4 + 1,
  );
}

/** Locate every bone a shot-set definition requires on the loaded GLB's OWN
 *  skeleton (never a body-engine assumption). Throws loudly, naming exactly
 *  which joints are missing, when the model has no rig at all or is missing
 *  a required joint — no silent fallback to a generic bounding-box zoom for
 *  a set that promised skeleton-anchored framing. */
function findRequiredSkeletonBones(
  root: THREE.Object3D,
  definition: AssetPreviewShotSetDefinition,
): Map<string, THREE.Bone> {
  const bonesByName = new Map<string, THREE.Bone>();
  root.traverse((object) => {
    const bone = object as THREE.Bone;
    if (bone.isBone && object.name) bonesByName.set(object.name, bone);
  });
  const required = definition.requiredBones ?? [];
  const missing = required.filter((name) => !bonesByName.has(name));
  const hint = definition.rigRequirementHint ? ` (${definition.rigRequirementHint})` : '';
  if (required.length > 0 && bonesByName.size === 0) {
    throw new Error(
      `Asset preview '--shots ${definition.name}' requires a rigged GLB${hint}, but this ` +
        `model has no skeleton at all. Required joints: ${required.join(', ')}.`,
    );
  }
  if (missing.length > 0) {
    throw new Error(
      `Asset preview '--shots ${definition.name}' requires joints this GLB's skeleton does ` +
        `not have${hint}. Missing joint(s): ${missing.join(', ')}.`,
    );
  }
  return bonesByName;
}

/**
 * Apply one of the definition's named poses to a snapshot in place — bone
 * rotations on the skeleton, morph influences on whatever meshes declare
 * them.
 *
 * BOTH halves degrade rather than throw, for the same reason: a pose may
 * touch a joint or a morph beyond the definition's `requiredBones` (a rig can
 * legitimately lack a separate upper-leg joint, or carry no face morphs at
 * all) without failing the zoom-anchor requirement. A missing step costs that
 * shot some realism; it is not a broken definition.
 */
function applyShotSetPose(
  root: THREE.Object3D,
  bonesByName: Map<string, THREE.Bone>,
  steps: readonly ShotSetPoseStep[],
): void {
  const morphs = steps.filter(isPoseMorph);
  for (const step of steps) {
    if (isPoseRotation(step)) {
      const bone = bonesByName.get(step.bone);
      if (!bone) continue;
      if (step.axis === 'x') bone.rotateX(step.radians);
      else if (step.axis === 'y') bone.rotateY(step.radians);
      else bone.rotateZ(step.radians);
    } else if (isPoseTranslation(step)) {
      // The translation channel: same delta semantics as the rotation, along
      // the bone's own local axis — how a pose states a crouch, a jump apex,
      // or a gait's hip dip, which no set of rotations can.
      const bone = bonesByName.get(step.bone);
      if (!bone) continue;
      if (step.axis === 'x') bone.translateX(step.meters);
      else if (step.axis === 'y') bone.translateY(step.meters);
      else bone.translateZ(step.meters);
    }
  }
  if (morphs.length === 0) return;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const dictionary = mesh.morphTargetDictionary;
    const influences = mesh.morphTargetInfluences;
    if (!dictionary || !influences) return;
    for (const { morph, influence } of morphs) {
      const index = dictionary[morph];
      if (index === undefined) continue;
      influences[index] = influence;
    }
  });
}

/** First valid `userData.forward` in the tree (our baked rigs persist it on
 *  the rig root, which sits below the GLTF scene root), else glTF's +Z.
 *  Shared with the compare mode (`asset-compare.ts` re-exports it). */
export function readModelForward(root: THREE.Object3D): [number, number, number] {
  let found: [number, number, number] | null = null;
  root.traverse((object) => {
    if (found) return;
    found = parseForwardVector(object.userData['forward']);
  });
  return found ?? [0, 0, 1];
}

/**
 * Face-the-camera normalization (the compare path's forward detection,
 * applied to the labeled shot sets): wrap a snapshot in a pivot yawed so the
 * model's own forward faces +Z — the direction every 'front' camera looks
 * from. Models without forward extras keep the glTF +Z convention (yaw 0, an
 * exact no-op), so arbitrary GLBs render exactly as before; our generated
 * humanoids persist `userData.forward = [0,0,-1]` and previously had their
 * BACK photographed by every front-labeled shot.
 *
 * `forward` must be read from the SOURCE object (the compare path does the
 * same): render snapshots deliberately copy presentation state only, so the
 * forward extras never survive onto the snapshot itself.
 */
function faceFrontSubject(
  snapshot: THREE.Object3D,
  forward: readonly [number, number, number],
): THREE.Group {
  const subject = new THREE.Group();
  subject.rotation.y = forwardYawRadians(forward);
  subject.add(snapshot);
  // Not `updateWorldMatrix`: a SkinnedMesh only refreshes its
  // `bindMatrixInverse` from `updateMatrixWorld`, and measuring before that
  // refresh applies the pivot twice to every skinned vertex — see
  // {@link resolveWorldMatricesLikeRenderer}.
  subject.updateMatrixWorld(true);
  return subject;
}

/** One rendered staging of the subject — the rest snapshot, or a named
 *  pose's disposable snapshot — with everything a shot needs from it. */
interface StagedShotSubject {
  subject: THREE.Object3D;
  scene: THREE.Scene;
  framing: AssetPreviewFraming;
}

/**
 * The Asset Lab's studio stage: the subject, a hemisphere ambient, a key and a
 * fill. The IBL that completes it is applied SEPARATELY
 * ({@link applyStudioEnvironment}), because a PMREM bake needs a live
 * renderer and every caller here builds its scene before its renderer.
 *
 * The hemisphere is scaled down by {@link STUDIO_AMBIENT_WITH_ENVIRONMENT}:
 * with an environment map in the scene it is the second, cruder ambient term,
 * and at its historical 1.8 the two together flattened the subject. Key and
 * fill are untouched — they still own the form.
 */
function createPreviewScene(snapshot: THREE.Object3D, framing: AssetPreviewFraming): THREE.Scene {
  const scene = new THREE.Scene();
  scene.add(snapshot);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x354052, 1.8 * STUDIO_AMBIENT_WITH_ENVIRONMENT));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position
    .copy(framing.center)
    .addScaledVector(new THREE.Vector3(1, 1.5, 1), framing.radius * 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd7ff, 0.8);
  fill.position
    .copy(framing.center)
    .addScaledVector(new THREE.Vector3(-1, 0.5, -0.7), framing.radius * 2);
  scene.add(fill);
  // An UNDER fill, weak and warm, so a shot from below (`--elevation -60`:
  // gills under a cap, a barrel's closed bottom) reads as a surface instead
  // of a black disc. Measured on the blind modeling bench (round 10): an
  // agent spent three looks and a probe deciding whether an unlit underside
  // was closed. Tops are unchanged — this light sees only downward faces.
  const under = new THREE.DirectionalLight(0xfff1dc, 0.45);
  under.position
    .copy(framing.center)
    .addScaledVector(new THREE.Vector3(0.3, -1, 0.4), framing.radius * 2);
  scene.add(under);
  return scene;
}

// Captures are synchronous, so one offscreen context can serve them in turn.
// Keep its studio bake between captures, like the model-thumbnail renderer.
let objectCaptureRenderer: THREE.WebGLRenderer | null = null;

function disposeObjectCaptureRenderer(): void {
  const renderer = objectCaptureRenderer;
  objectCaptureRenderer = null;
  if (!renderer) return;
  disposeStudioEnvironment(renderer);
  renderer.dispose();
  renderer.forceContextLoss();
}

function getObjectCaptureRenderer(): THREE.WebGLRenderer {
  if (objectCaptureRenderer?.getContext().isContextLost()) disposeObjectCaptureRenderer();
  if (!objectCaptureRenderer) {
    const renderer = markHostRenderer(
      new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }),
    );
    objectCaptureRenderer = renderer;
    renderer.domElement.addEventListener('webglcontextlost', () => {
      if (objectCaptureRenderer === renderer) disposeObjectCaptureRenderer();
    });
  }
  return objectCaptureRenderer;
}

if (import.meta.hot) import.meta.hot.dispose(disposeObjectCaptureRenderer);

export function captureObjectAssetPreview(
  source: THREE.Object3D,
  options: AssetPreviewOptions = {},
): AssetPreviewCapture {
  let containsSplat = false;
  source.traverse((object) => {
    if (hasUserData(object, 'gaussianSplat')) containsSplat = true;
  });
  if (containsSplat) {
    throw new Error(
      'Gaussian-splat capture requires the async project-asset capture path so Spark can sort each view.',
    );
  }
  const width = checkedDimension(options.width);
  const height = checkedDimension(options.height);
  const background = options.background ?? 'neutral';
  const snapshot = createAssetPreviewSnapshot(source);

  try {
    // Yaw-normalize the subject so the fixed 'front' camera photographs the
    // model's actual front (see {@link faceFrontSubject}) — the framing
    // measurements run on the normalized subject so every view stays tight.
    // The yaw is reported and stamped onto the sheet, never applied silently
    // (see {@link AssetPreviewOrientation}).
    const forward = readModelForward(source);
    // Pose BEFORE facing/framing, on the disposable snapshot only: the
    // measured bounds and every camera must fit the posed body, and the
    // source is never mutated.
    if (options.pose) applyClipPose(snapshot, options.pose);
    const subject = faceFrontSubject(snapshot, forward);
    const orientation = assetPreviewOrientation(forward);
    const framing = measureAssetPreview(subject, 'perspective');
    const scene = createPreviewScene(subject, framing);
    const activeRenderer = getObjectCaptureRenderer();
    activeRenderer.setPixelRatio(1);
    activeRenderer.outputColorSpace = THREE.SRGBColorSpace;
    activeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    activeRenderer.toneMappingExposure = 1;
    activeRenderer.setClearColor(NEUTRAL_COLOR, background === 'transparent' ? 0 : 1);
    applyStudioEnvironment(scene, activeRenderer);
    if (options.camera) {
      return renderFreeCameraCapture(
        activeRenderer,
        scene,
        perspectiveCamera(
          framing,
          width / height,
          freeCameraDirection(options.camera),
          options.camera.distance,
        ),
        width,
        height,
        options.camera,
        orientation,
      );
    }
    const cameras = new Map<AssetPreviewView, THREE.Camera>();
    for (const view of ASSET_PREVIEW_VIEWS) {
      cameras.set(
        view,
        createAssetPreviewCamera(view, measureAssetPreview(subject, view), width / height),
      );
    }
    // The underside, from 30° round and 60° below — the frame the look used
    // to take as a separate second capture and write as `below.png`.
    const below = perspectiveCamera(
      framing,
      width / height,
      freeCameraDirection({ azimuthDegrees: 30, elevationDegrees: -60 }),
    );
    return renderFourViewCapture(activeRenderer, scene, cameras, width, height, orientation, below);
  } finally {
    disposeAssetPreviewSnapshot(snapshot);
  }
}

/**
 * The standalone per-view PNG gets the SAME authored-axis marker the contact
 * sheet cell gets — an agent measuring from `front.png` alone must meet the
 * same stamped truth (see {@link AssetPreviewOrientation}). Views without a
 * marker (perspective) pass the renderer's canvas through untouched.
 */
function stampAuthoredAxisMarker(
  rendered: HTMLCanvasElement,
  view: AssetPreviewView,
  orientation: AssetPreviewOrientation,
): HTMLCanvasElement {
  const marker = authoredAxisMarker(view, orientation.yawDegrees);
  if (!marker) return rendered;
  const canvas = document.createElement('canvas');
  canvas.width = rendered.width;
  canvas.height = rendered.height;
  const context = canvas.getContext('2d');
  if (!context) return rendered;
  context.drawImage(rendered, 0, 0);
  const box = measureBitmapLabel(marker.text, rendered.width, rendered.height);
  const markerX = marker.edge === 'left' ? 0 : rendered.width - box.width;
  drawBitmapLabel(
    context,
    marker.text,
    markerX,
    rendered.height - box.height,
    rendered.width,
    rendered.height,
  );
  return canvas;
}

/** The reported orientation for a subject with this declared forward. */
function assetPreviewOrientation(
  forward: readonly [number, number, number],
): AssetPreviewOrientation {
  const yaw = forwardYawRadians(forward);
  return {
    forward: [forward[0], forward[1], forward[2]],
    yawDegrees: Math.round(THREE.MathUtils.radToDeg(yaw)),
  };
}

/**
 * Sample a named clip at a time onto a capture snapshot. The mixer binds by
 * node name against the snapshot's own clones and is deliberately never
 * stopped — `AnimationAction.stop` restores the pre-pose state, and the
 * snapshot is disposed after the capture anyway.
 */
function applyClipPose(snapshot: THREE.Object3D, pose: AssetPreviewPose): void {
  if (!Number.isFinite(pose.timeSeconds) || pose.timeSeconds < 0) {
    throw new Error(
      `Asset preview pose time must be a finite number of seconds >= 0, got ${pose.timeSeconds}.`,
    );
  }
  const clips = snapshot.animations ?? [];
  const clip = clips.find((candidate) => candidate.name === pose.clip);
  if (!clip) {
    const available = clips.map((candidate) => `'${candidate.name}'`).join(', ');
    throw new Error(
      `Asset preview pose clip '${pose.clip}' not found on the subject. ` +
        (available
          ? `Its clips are: ${available}.`
          : 'The subject carries no animation clips at all — clips live on the model root ' +
            '(GLB animations, or a builder module\u2019s `root.animations`).'),
    );
  }
  const mixer = new THREE.AnimationMixer(snapshot);
  mixer.clipAction(clip).play();
  mixer.update(pose.timeSeconds);
  snapshot.updateMatrixWorld(true);
}

/**
 * The free capture camera's direction in NORMALIZED space (the subject
 * already faces +Z after {@link faceFrontSubject}, so authored-front azimuth
 * 0 is world +Z here): the same heading convention as the turntable's yaw,
 * with elevation raising the camera above level.
 */
function freeCameraDirection(camera: AssetPreviewCameraChoice): THREE.Vector3 {
  const azimuth = THREE.MathUtils.degToRad(camera.azimuthDegrees);
  const elevation = THREE.MathUtils.degToRad(camera.elevationDegrees);
  return new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  ).normalize();
}

/**
 * The single-view sibling of {@link renderFourViewCapture} for a chosen
 * camera: one perspective view, labeled with the angles that took it so the
 * evidence names its own viewpoint.
 */
function renderFreeCameraCapture(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
  choice: AssetPreviewCameraChoice,
  orientation: AssetPreviewOrientation,
): AssetPreviewCapture {
  renderer.setSize(width, height, false);
  renderer.render(scene, camera);
  const view: AssetPreviewImage = {
    view: 'perspective',
    base64: pngBase64(renderer.domElement),
    mimeType: 'image/png',
  };
  const sheetCanvas = document.createElement('canvas');
  sheetCanvas.width = width;
  sheetCanvas.height = height;
  const sheetContext = sheetCanvas.getContext('2d');
  if (!sheetContext) throw new Error('Unable to create the asset preview contact sheet.');
  sheetContext.drawImage(renderer.domElement, 0, 0, width, height);
  const label =
    `AZ ${Math.round(choice.azimuthDegrees)} EL ${Math.round(choice.elevationDegrees)}` +
    (choice.distance === undefined ? '' : ` D ${Math.round(choice.distance)}`);
  drawBitmapLabel(sheetContext, label, 0, 0, width, height);
  return {
    width,
    height,
    orientation,
    views: [view],
    contactSheet: {
      width,
      height,
      base64: pngBase64(sheetCanvas),
      mimeType: 'image/png' as const,
    },
  };
}

/**
 * The axis marker for one orthographic view: which AUTHORED axis points
 * screen-right after the subject's face-front yaw, spelled as `+X>` (that
 * axis points right) or `<+X` (it points left). `null` for the perspective
 * view, and for the rare non-cardinal yaw — where the marker instead names
 * the yaw itself so nothing is silently askew.
 */
function authoredAxisMarker(
  view: AssetPreviewView,
  yawDegrees: number,
): { text: string; edge: 'left' | 'right' } | null {
  if (view === 'perspective') return null;
  const yaw = THREE.MathUtils.degToRad(yawDegrees);
  const screenRight = assetViewBasis(view).right.applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
  const axes: Array<[string, THREE.Vector3]> = [
    ['X', new THREE.Vector3(1, 0, 0)],
    ['Y', new THREE.Vector3(0, 1, 0)],
    ['Z', new THREE.Vector3(0, 0, 1)],
  ];
  for (const [name, axis] of axes) {
    const dot = screenRight.dot(axis);
    if (dot > 0.99) return { text: `+${name}>`, edge: 'right' };
    if (dot < -0.99) return { text: `<+${name}`, edge: 'left' };
  }
  return { text: `YAW ${yawDegrees}`, edge: 'left' };
}

/**
 * Render the four fixed views and assemble the labeled 2x2 contact sheet.
 *
 * Extracted verbatim from {@link captureObjectAssetPreview}'s own loop (its
 * only caller until the scene stage below): the two stages differ in WHAT
 * they photograph — an isolated snapshot on a studio stage versus the entity
 * standing in the live scene — never in how the sheet is assembled, so a
 * caller comparing a lab and a scene capture is comparing subjects rather
 * than two independently-drifting sheet builders.
 */
function renderFourViewCapture(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  cameras: Map<AssetPreviewView, THREE.Camera>,
  width: number,
  height: number,
  orientation: AssetPreviewOrientation,
  /** A fifth camera, the UNDERSIDE, drawn as the sheet's fifth tile (3 × 2).
   *  Every blind modeling session read the sheet and then `below.png` as a
   *  second image, ten seconds of generation per look; one sheet that carries
   *  the underside is one read (2026-09-06). */
  below?: THREE.Camera,
): AssetPreviewCapture {
  const views: AssetPreviewImage[] = [];
  const tiles: (AssetPreviewView | 'below')[] = below
    ? [...ASSET_PREVIEW_VIEWS, 'below']
    : [...ASSET_PREVIEW_VIEWS];
  const columns = below ? 3 : 2;
  const sheetWidth = width * columns;
  const sheetHeight = height * 2;
  const sheetCanvas = document.createElement('canvas');
  sheetCanvas.width = sheetWidth;
  sheetCanvas.height = sheetHeight;
  const sheetContext = sheetCanvas.getContext('2d');
  if (!sheetContext) throw new Error('Unable to create the asset preview contact sheet.');
  if (renderer.getClearAlpha() > 0) {
    // A 3 × 2 sheet has one empty cell; paint it the stage colour so it
    // reads as margin, not as a white sixth frame.
    sheetContext.fillStyle = `#${new THREE.Color(NEUTRAL_COLOR).getHexString()}`;
    sheetContext.fillRect(0, 0, sheetWidth, sheetHeight);
  }
  renderer.setSize(width, height, false);
  tiles.forEach((view, index) => {
    const camera = view === 'below' ? below : cameras.get(view);
    if (!camera) return;
    renderer.render(scene, camera);
    views.push({
      view,
      base64:
        view === 'below'
          ? pngBase64(renderer.domElement)
          : pngBase64(stampAuthoredAxisMarker(renderer.domElement, view, orientation)),
      mimeType: 'image/png',
    });
    const column = index % columns;
    const rowFromTop = Math.floor(index / columns);
    const x = column * width;
    const y = rowFromTop * height;
    sheetContext.drawImage(renderer.domElement, x, y, width, height);
    const label = view === 'perspective' ? '3/4' : view.toUpperCase();
    drawBitmapLabel(sheetContext, label, x, y, width, height);
    if (view === 'below') return;
    // Stamp each orthographic cell with its authored-axis marker (`+X>` /
    // `<+X`): the sheet is evidence, and after a face-front yaw the authored
    // axes no longer match the screen's — a fact that must live in the same
    // pixels an agent measures from (see {@link AssetPreviewOrientation}).
    const marker = authoredAxisMarker(view, orientation.yawDegrees);
    if (marker) {
      const box = measureBitmapLabel(marker.text, width, height);
      const markerX = marker.edge === 'left' ? x : x + width - box.width;
      drawBitmapLabel(sheetContext, marker.text, markerX, y + height - box.height, width, height);
    }
  });
  const contactSheet = {
    width: sheetWidth,
    height: sheetHeight,
    base64: pngBase64(sheetCanvas),
    mimeType: 'image/png' as const,
  };
  return { width, height, orientation, views, contactSheet };
}

/**
 * The `stage: 'scene'` half of entity capture: the entity photographed WHERE
 * IT STANDS in the live editor scene, under that scene's own lighting — the
 * counterpart to {@link captureObjectAssetPreview}'s neutral Asset Lab stage
 * (`'lab'`, which remains the default on every surface).
 *
 * The subject is deliberately NOT cloned, reparented or yaw-normalized the
 * way the lab stage's snapshot is: an entity in its authored context is the
 * whole product here, so the four fixed cameras are framed on its world
 * bounds with the same fit math the lab stage uses ({@link
 * measureAssetPreview} + {@link createAssetPreviewCamera}).
 *
 * Editor furniture is excluded by BOTH marking conventions, because neither
 * one covers everything (`editor-layers.ts`'s `isEditorOwnedObject` states
 * why): the cameras drop `EDITOR_LAYER`, and every editor-owned object in the
 * scene is hidden for the duration.
 *
 * That hiding is the ONLY live state this function touches, and it is the one
 * thing here that is not obviously self-restoring: it is undone in `finally`,
 * so a capture that throws mid-render still hands the human back their grid
 * and gizmos. The renderer is this function's own (created and destroyed
 * here, exactly as every other capture in this module does) — the editor's
 * viewport renderer and camera are never borrowed, so there is nothing of
 * theirs to put back.
 *
 * The scene's own `background`/`environment` render as authored;
 * `background: 'transparent'` clears only the alpha beneath them.
 */
export function captureSceneStageAssetPreview(
  source: THREE.Object3D,
  scene: THREE.Scene,
  options: AssetPreviewOptions = {},
): AssetPreviewCapture {
  let containsSplat = false;
  source.traverse((object) => {
    if (hasUserData(object, 'gaussianSplat')) containsSplat = true;
  });
  if (containsSplat) {
    throw new Error(
      'Gaussian-splat capture requires the async project-asset capture path so Spark can sort each view.',
    );
  }
  const width = checkedDimension(options.width);
  const height = checkedDimension(options.height);
  const background = options.background ?? 'neutral';

  const hidden: THREE.Object3D[] = [];
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    // Hidden BEFORE the framing measurement: an editor helper parented under
    // the subject must not enlarge the frame it is excluded from.
    scene.traverse((object) => {
      if (object.visible && isEditorOwnedObject(object)) {
        object.visible = false;
        hidden.push(object);
      }
    });

    const cameras = new Map<AssetPreviewView, THREE.Camera>();
    for (const view of ASSET_PREVIEW_VIEWS) {
      const camera = createAssetPreviewCamera(
        view,
        measureAssetPreview(source, view),
        width / height,
      );
      // Authored content may live on any custom layer; only the editor's own
      // is dropped.
      camera.layers.enableAll();
      camera.layers.disable(EDITOR_LAYER);
      cameras.set(view, camera);
    }

    const activeRenderer = markHostRenderer(
      new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      }),
    );
    renderer = activeRenderer;
    activeRenderer.setPixelRatio(1);
    activeRenderer.outputColorSpace = THREE.SRGBColorSpace;
    activeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    activeRenderer.toneMappingExposure = 1;
    activeRenderer.setClearColor(NEUTRAL_COLOR, background === 'transparent' ? 0 : 1);
    // The scene stage never yaw-normalizes (the entity's authored context IS
    // the subject), so authored axes are world axes: yaw 0, markers included.
    return renderFourViewCapture(
      activeRenderer,
      scene,
      cameras,
      width,
      height,
      assetPreviewOrientation([0, 0, 1]),
    );
  } finally {
    for (const object of hidden) object.visible = true;
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
}

/** One shot, staged and framed but not yet rendered. */
export interface PlannedShot {
  label: string;
  camera: THREE.Camera;
  scene: THREE.Scene;
  /** Present when this shot's frame contains no renderable geometry. The
   *  capture still renders it — see {@link AssetPreviewShotWarning}. */
  warning?: AssetPreviewShotWarning;
}

/** Everything {@link captureShotSetAssetPreview} needs before it touches a
 *  GPU, plus the snapshots that staging allocated. */
export interface ShotSetCapturePlan {
  shots: PlannedShot[];
  warnings: AssetPreviewShotWarning[];
  dispose(): void;
}

/** The empty-frame warning's text, which is the whole product of the guard:
 *  every surface that reports one (the capture result, the CLI, the contact
 *  sheet's mark) points back at this string, so it names the shot, its
 *  anchors, its pose AND the likeliest cause. */
function emptyFrameWarning(
  shot: ShotSetShot,
  definitionName: string,
  totalPrimitives: number,
): AssetPreviewShotWarning {
  const posed = shot.pose === undefined ? '' : ` under pose '${shot.pose}'`;
  const aimed =
    shot.view === 'bone-zoom'
      ? `bone-zoom on ${shot.bones.join(', ')} at yaw ${(shot.yaw ?? 0).toFixed(3)}`
      : `turntable at yaw ${shot.yaw.toFixed(3)}`;
  const cause =
    shot.view === 'bone-zoom'
      ? 'Zoom anchors are read from the REST skeleton for every shot, so a pose that MOVES ' +
        'the anchor leaves the crop behind where the joint used to be: re-aim the shot ' +
        '(another joint or yaw), widen its spanFraction, or drop it.'
      : 'Check the shot yaw and the pose it renders under.';
  return {
    label: shot.label,
    reason: 'empty-frame',
    ...(shot.view === 'bone-zoom' ? { bones: [...shot.bones] } : {}),
    ...(shot.pose === undefined ? {} : { pose: shot.pose }),
    message:
      `Asset preview '--shots ${definitionName}' shot ${JSON.stringify(shot.label)} (${aimed}` +
      `${posed}) framed NONE of the subject's ${totalPrimitives} rendered faces: the image is ` +
      `background only and proves nothing about the asset. ${cause}`,
  };
}

/**
 * Stage and frame a labeled shot set against the MODEL'S OWN skeleton and
 * bounds (no assumed proportions), WITHOUT rendering: turntable angles and
 * tight bone-anchored zooms, per the project-supplied definition. Shots that
 * name a pose are staged on a disposable POSED snapshot (per named pose) so
 * the rest-pose shots and the loaded source model are never affected. Zoom
 * `spanFraction`s size each crop relative to the whole model's own bounding
 * radius — a short "goblin" rig gets a goblin-scaled crop, never a fixed
 * reference-human height.
 *
 * Split out of {@link captureShotSetAssetPreview} so that everything the
 * capture DECIDES — which snapshot, which camera, and whether a shot frames
 * any geometry at all — is reachable without a WebGL context, for the same
 * reason `asset-preview-framing.ts` exists. The caller owns `dispose()`.
 */
export function planShotSetCapture(
  source: THREE.Object3D,
  definition: AssetPreviewShotSetDefinition,
  aspect: number,
): ShotSetCapturePlan {
  const snapshots: THREE.Object3D[] = [];
  const dispose = (): void => {
    for (const staged of snapshots) disposeAssetPreviewSnapshot(staged);
    snapshots.length = 0;
  };
  try {
    const snapshot = createAssetPreviewSnapshot(source);
    snapshots.push(snapshot);
    const bonesByName = findRequiredSkeletonBones(snapshot, definition);
    // Yaw-normalize the subject to face the front camera (the compare
    // path's forward detection — see {@link faceFrontSubject}): turntable
    // labels AND the +Z-fixed zoom crops are only true to the model's
    // facing once its forward actually points at them. Bone anchors are
    // read AFTER the wrap, so the zoom framing follows the rotation.
    const forward = readModelForward(source);
    const subject = faceFrontSubject(snapshot, forward);
    const framing = measureAssetPreview(subject, 'perspective');
    const scene = createPreviewScene(subject, framing);

    // Each named pose used by a shot renders its own disposable snapshot
    // (same isolation pattern as the primary snapshot) so applying the
    // definition's joint rotations has zero side effects on the rest-pose
    // shots and the loaded source model is never mutated.
    const restStage: StagedShotSubject = { subject, scene, framing };
    const poseStages = new Map<string, StagedShotSubject>();
    for (const shot of definition.shots) {
      if (shot.pose === undefined || poseStages.has(shot.pose)) continue;
      const steps = definition.poses?.[shot.pose] ?? [];
      const poseSnapshot = createAssetPreviewSnapshot(source);
      snapshots.push(poseSnapshot);
      const poseBones = findRequiredSkeletonBones(poseSnapshot, definition);
      applyShotSetPose(poseSnapshot, poseBones, steps);
      poseSnapshot.updateMatrixWorld(true);
      const poseSubject = faceFrontSubject(poseSnapshot, forward);
      const poseFraming = measureAssetPreview(poseSubject, 'perspective');
      poseStages.set(shot.pose, {
        subject: poseSubject,
        scene: createPreviewScene(poseSubject, poseFraming),
        framing: poseFraming,
      });
    }
    const stageFor = (pose: string | undefined): StagedShotSubject =>
      pose === undefined ? restStage : poseStages.get(pose)!;

    const anchor = (name: string): THREE.Vector3 =>
      new THREE.Vector3().setFromMatrixPosition(bonesByName.get(name)!.matrixWorld);

    // Every turntable shot of one staged subject is framed together: each
    // yaw from its OWN projected bounds, at a scale shared across that
    // subject's yaws, so a long body in a bent pose is neither clipped at
    // yaw +/-PI/2 nor silently rescaled between frames.
    const turntableByStage = new Map<string | undefined, Map<number, THREE.OrthographicCamera>>();
    for (const pose of new Set(
      definition.shots
        .filter((shot) => shot.view === 'turntable')
        .map((shot) => shot.pose ?? undefined),
    )) {
      const staged = stageFor(pose);
      const yaws = [
        ...new Set(
          definition.shots
            .filter((shot) => shot.view === 'turntable' && (shot.pose ?? undefined) === pose)
            .map((shot) => (shot as Extract<ShotSetShot, { view: 'turntable' }>).yaw),
        ),
      ];
      turntableByStage.set(pose, turntableCameras(staged.subject, staged.framing, yaws, aspect));
    }

    const shotCameras = definition.shots.map(
      (
        shot,
      ): {
        label: string;
        camera: THREE.OrthographicCamera;
        scene: THREE.Scene;
        stage: StagedShotSubject;
        basis: OrthographicViewBasis;
      } => {
        const staged = stageFor(shot.pose);
        if (shot.view === 'turntable') {
          return {
            label: shot.label,
            camera: turntableByStage.get(shot.pose ?? undefined)!.get(shot.yaw)!,
            scene: staged.scene,
            stage: staged,
            basis: turntableViewBasis(shot.yaw),
          };
        }
        // Bone-zoom anchors are read from the REST snapshot's bones, for
        // every shot including posed ones — and for an EXPRESSION STRIP
        // (several poses framed on the same head) that is the point, not a
        // limitation: one anchor set means one camera, so the frames differ
        // only by the face. A pose that MOVED its own anchor would want the
        // pose snapshot's bone map instead; no definition does that today,
        // and a strip never should.
        //
        // A zoom on multiple bones (both hands, both feet) sizes the crop to
        // actually contain every anchor, not just apply a fixed fraction of
        // the model's radius — see {@link boneZoomCamera}'s doc comment.
        const missingAnchor = shot.bones.find((bone) => !bonesByName.has(bone));
        if (missingAnchor !== undefined) {
          throw new Error(
            `Asset preview '--shots ${definition.name}' shot ` +
              `${JSON.stringify(shot.label)} zooms on a joint this GLB's skeleton does not ` +
              `have: ${missingAnchor}. List it in the definition's requiredBones or fix the rig.`,
          );
        }
        const basis = turntableViewBasis(shot.yaw ?? 0);
        return {
          label: shot.label,
          camera: boneZoomCamera(
            shot.bones.map(anchor),
            basis,
            framing.radius,
            shot.spanFraction,
            aspect,
          ),
          scene: staged.scene,
          stage: staged,
          basis,
        };
      },
    );

    // The empty-frame guard. One vertex walk per STAGED SUBJECT covers every
    // shot taken of it (the same one-walk-many-bases shape
    // `measureProjectedSpans` uses), so the guard costs a constant number of
    // traversals rather than one per shot.
    const warnings: AssetPreviewShotWarning[] = [];
    const warningByIndex = new Map<number, AssetPreviewShotWarning>();
    const indicesByStage = new Map<StagedShotSubject, number[]>();
    shotCameras.forEach(({ stage }, index) => {
      const existing = indicesByStage.get(stage);
      if (existing) existing.push(index);
      else indicesByStage.set(stage, [index]);
    });
    for (const [stage, indices] of indicesByStage) {
      const { framed, total } = measureShotFrameCoverage(
        stage.subject,
        indices.map((index) => {
          const planned = shotCameras[index]!;
          return {
            basis: planned.basis,
            window: orthographicShotFrameWindow(planned.camera, planned.basis),
          };
        }),
      );
      indices.forEach((shotIndex, slot) => {
        if (framed[slot] !== 0) return;
        const warning = emptyFrameWarning(definition.shots[shotIndex]!, definition.name, total);
        warningByIndex.set(shotIndex, warning);
        warnings.push(warning);
      });
    }

    return {
      shots: shotCameras.map(({ label, camera, scene: shotScene }, index) => {
        const warning = warningByIndex.get(index);
        return {
          label,
          camera,
          scene: shotScene,
          ...(warning ? { warning } : {}),
        };
      }),
      warnings,
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

/**
 * Render a labeled shot set — {@link planShotSetCapture}'s staging and
 * framing, rasterized, labeled and packed into a contact sheet.
 *
 * A shot the plan warned about is rendered like any other (an empty frame
 * mid-iteration must not kill a 20-shot render) and MARKED: its contact-sheet
 * label is drawn in warning red and suffixed. The contact sheet is the
 * artifact a reviewer actually looks at, and it outlives the terminal that
 * printed the warning — an unmarked background tile on it reads as coverage,
 * which is the whole harm this guard exists to stop.
 */
export function captureShotSetAssetPreview(
  source: THREE.Object3D,
  definition: AssetPreviewShotSetDefinition,
  options: AssetPreviewOptions = {},
): LabeledShotSetCapture {
  const width = checkedDimension(options.width);
  const height = checkedDimension(options.height);
  const background = options.background ?? 'neutral';
  const plan = planShotSetCapture(source, definition, width / height);
  let renderer: THREE.WebGLRenderer | null = null;

  try {
    const activeRenderer = markHostRenderer(
      new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      }),
    );
    renderer = activeRenderer;
    activeRenderer.setPixelRatio(1);
    activeRenderer.outputColorSpace = THREE.SRGBColorSpace;
    activeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    activeRenderer.toneMappingExposure = 1;
    activeRenderer.setClearColor(NEUTRAL_COLOR, background === 'transparent' ? 0 : 1);
    activeRenderer.setSize(width, height, false);
    // A pose gets its own staged scene, so every scene in the plan is lit —
    // once, off the renderer's single cached bake.
    for (const planned of plan.shots) applyStudioEnvironment(planned.scene, activeRenderer);

    const shots: LabeledShotSetCapture['shots'] = [];
    const columns = 2;
    const rows = Math.ceil(plan.shots.length / columns);
    const sheetWidth = width * columns;
    const sheetHeight = height * rows;
    const sheetCanvas = document.createElement('canvas');
    sheetCanvas.width = sheetWidth;
    sheetCanvas.height = sheetHeight;
    const sheetContext = sheetCanvas.getContext('2d');
    if (!sheetContext) throw new Error('Unable to create the asset preview contact sheet.');

    plan.shots.forEach(({ label, camera, scene: shotScene, warning }, index) => {
      activeRenderer.render(shotScene, camera);
      shots.push({ label, base64: pngBase64(activeRenderer.domElement), mimeType: 'image/png' });
      const column = index % columns;
      const rowFromTop = Math.floor(index / columns);
      const x = column * width;
      const y = rowFromTop * height;
      sheetContext.drawImage(activeRenderer.domElement, x, y, width, height);
      drawBitmapLabel(
        sheetContext,
        warning ? `${label.toUpperCase()} - EMPTY` : label.toUpperCase(),
        x,
        y,
        width,
        height,
        warning ? 'warning' : 'normal',
      );
    });

    const contactSheet = {
      width: sheetWidth,
      height: sheetHeight,
      base64: pngBase64(sheetCanvas),
      mimeType: 'image/png' as const,
    };
    return { width, height, shots, warnings: plan.warnings, contactSheet };
  } finally {
    if (renderer) disposeStudioEnvironment(renderer);
    renderer?.dispose();
    renderer?.forceContextLoss();
    plan.dispose();
  }
}

function projectModelUrl(rawAssetPath: string): URL {
  // Accept the common mistake of passing the on-disk path (which still has
  // the `public/` folder that the dev server strips) and normalize it to
  // the served web path before validating, so `public/foo.glb` and
  // `/public/foo.glb` both resolve like `/foo.glb`.
  const assetPath = rawAssetPath.replace(/^\/?public(\/|$)/, '/');
  if (
    !assetPath.startsWith('/') ||
    assetPath.startsWith('//') ||
    assetPath.includes('\\') ||
    assetPath.includes('?') ||
    assetPath.includes('#')
  ) {
    throw new Error(
      'Model asset paths must be the served web path (project-root absolute, with public/ ' +
        'stripped): e.g. /models/generated/hero.glb',
    );
  }
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(assetPath);
  } catch {
    throw new Error('Asset Editor model path contains invalid URL encoding.');
  }
  if (decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Asset Editor model paths cannot traverse outside the project root.');
  }
  const projectOrigin = globalThis.location?.origin ?? 'http://localhost';
  const url = new URL(assetPath, projectOrigin);
  if (url.origin !== projectOrigin || !url.pathname.toLowerCase().match(/\.(?:glb|gltf|spz)$/)) {
    throw new Error(
      'Asset Editor loads bounded, same-origin project .glb, .gltf, or .spz files only.',
    );
  }
  return url;
}

async function boundedModelBytes(
  url: URL,
  signal: AbortSignal,
  maxBytes = MAX_MODEL_BYTES,
): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Unable to load project model (${response.status} ${response.statusText}).`);
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(
      `Asset Editor project models must be ${MAX_MODEL_BYTES / 1024 / 1024} MiB or less.`,
    );
  }
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maxBytes) {
      throw new Error(
        `Asset Editor project models must be ${MAX_MODEL_BYTES / 1024 / 1024} MiB or less.`,
      );
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(
          `Asset Editor project models must be ${MAX_MODEL_BYTES / 1024 / 1024} MiB or less.`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

function parseGltfData(
  data: ArrayBuffer | string,
  sourceUrl: URL,
  signal: AbortSignal,
): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return false;
      settled = true;
      signal.removeEventListener('abort', abort);
      callback();
      return true;
    };
    const abort = () => finish(() => reject(signal.reason));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    gltfLoader.parse(
      data,
      new URL('.', sourceUrl).href,
      (gltf) => {
        // GLTFLoader keeps clips on the GLTF result rather than its scene.
        // Asset Editor's model contract is Object3D-shaped, so preserve those
        // clips instead of silently degrading animated assets into static ones.
        gltf.scene.animations = [...gltf.animations];
        if (!finish(() => resolve(gltf.scene))) {
          disposeProjectAssetModel(gltf.scene);
        }
      },
      (error) => finish(() => reject(error)),
    );
  });
}

type ExternalGltfResource = { uri?: unknown; mimeType?: unknown };

function projectDependencyUrl(uri: string, sourceUrl: URL): URL {
  if (uri.includes('\\') || uri.includes('?') || uri.includes('#')) {
    throw new Error('Asset Editor .gltf dependencies must be plain same-origin project paths.');
  }
  const url = new URL(uri, sourceUrl);
  if (url.origin !== sourceUrl.origin) {
    throw new Error('Asset Editor .gltf dependencies must stay on the project origin.');
  }
  return url;
}

function dependencyMimeType(resource: ExternalGltfResource, url: URL): string {
  if (typeof resource.mimeType === 'string') return resource.mimeType;
  const extension = url.pathname.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  return 'application/octet-stream';
}

async function inlineExternalGltfResources(
  bytes: ArrayBuffer,
  sourceUrl: URL,
  signal: AbortSignal,
): Promise<string> {
  let document: Record<string, unknown>;
  try {
    document = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    throw new Error('Asset Editor could not parse the project .gltf JSON document.');
  }
  const resources = [
    ...(Array.isArray(document['buffers']) ? (document['buffers'] as ExternalGltfResource[]) : []),
    ...(Array.isArray(document['images']) ? (document['images'] as ExternalGltfResource[]) : []),
  ];
  let totalBytes = bytes.byteLength;
  for (const resource of resources) {
    if (typeof resource.uri !== 'string' || resource.uri.startsWith('data:')) continue;
    const dependencyUrl = projectDependencyUrl(resource.uri, sourceUrl);
    const dependency = await boundedModelBytes(dependencyUrl, signal, MAX_MODEL_BYTES - totalBytes);
    totalBytes += dependency.byteLength;
    const dependencyBytes = new Uint8Array(dependency);
    let binary = '';
    for (let offset = 0; offset < dependencyBytes.length; offset += 32_768) {
      binary += String.fromCharCode(...dependencyBytes.subarray(offset, offset + 32_768));
    }
    resource.uri = `data:${dependencyMimeType(resource, dependencyUrl)};base64,${btoa(binary)}`;
  }
  return JSON.stringify(document);
}

/**
 * Parse a base64 GLB that travelled IN the relay command, rather than one
 * fetched from the project origin.
 *
 * EXTRACTED VERBATIM from `asset-compare.ts`'s private `parseRefGlb` (the
 * compare mode has shipped reference GLBs over the wire this way since B8.4);
 * `label` is the one addition, so each caller keeps its own error wording
 * while there is a single decoder. The bound is the SAME 64 MiB the fetched
 * path enforces (`MAX_MODEL_BYTES`) — bytes that arrive over the relay are no
 * cheaper to rasterize than bytes fetched over HTTP.
 */
export function parseGlbBytesModel(base64: string, label: string): Promise<THREE.Object3D> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const binary = atob(base64);
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  } catch {
    throw new Error(`${label} is not valid base64.`);
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_MODEL_BYTES) {
    throw new Error(`${label} must be non-empty and at most ${MAX_MODEL_BYTES / 1024 / 1024} MiB.`);
  }
  return new Promise((resolve, reject) => {
    gltfLoader.parse(
      bytes.buffer,
      '',
      (gltf) => {
        // Same contract as parseGltfData: GLTFLoader keeps clips on the GLTF
        // result, and the module lane's pose/clip params need them on the root.
        gltf.scene.animations = [...gltf.animations];
        resolve(gltf.scene);
      },
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

/**
 * The Asset Lab's four-view capture of a model that exists only as BYTES — no
 * project path, no live entity. This is the rasterization half of the
 * "module path" look (`project.bake.preview`): a Node host builds a project
 * module's `Object3D`, exports it to an in-memory GLB, and hands those bytes
 * here, because Node has no GPU and the editor session does.
 *
 * Deliberately the `'lab'` stage and nothing else — bytes stand nowhere, so
 * there is no scene to stage them in.
 */
export async function captureGlbBytesAssetPreview(
  glbBase64: string,
  options: AssetPreviewOptions = {},
): Promise<AssetPreviewCapture> {
  const model = await parseGlbBytesModel(glbBase64, 'Asset preview GLB bytes');
  try {
    return captureObjectAssetPreview(model, options);
  } finally {
    disposeProjectAssetModel(model);
  }
}

/**
 * The same bytes, photographed as a LABELED SHOT SET instead of the four
 * views — what `vgai screenshot <module> --orbit <n>` renders. A shot set
 * stages the subject itself, exactly the way the asset-path lane's
 * {@link captureShotSetModelPreview} does, so bytes are no less valid a
 * subject here than a project GLB is.
 */
export async function captureShotSetGlbBytesPreview(
  glbBase64: string,
  definition: AssetPreviewShotSetDefinition,
  options: AssetPreviewOptions = {},
): Promise<LabeledShotSetCapture> {
  const model = await parseGlbBytesModel(glbBase64, 'Asset preview GLB bytes');
  try {
    return captureShotSetAssetPreview(model, definition, options);
  } finally {
    disposeProjectAssetModel(model);
  }
}

/** A loaded project model plus, for a self-contained GLB, the exact container
 *  bytes that were parsed. GLB is the one form a writer can amend in place, so
 *  it is the only one that carries them; every other form answers `null`. */
export interface ProjectAssetModelSource {
  readonly root: THREE.Object3D;
  readonly sourceBytes: Uint8Array | null;
}

export async function loadProjectAssetModelSource(
  assetPath: string,
  externalSignal?: AbortSignal,
): Promise<ProjectAssetModelSource> {
  const url = projectModelUrl(assetPath);
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = globalThis.setTimeout(
    () =>
      controller.abort(new Error('Asset Editor project model load timed out after 25 seconds.')),
    MODEL_FETCH_TIMEOUT_MS,
  );
  try {
    const bytes = await boundedModelBytes(url, controller.signal);
    controller.signal.throwIfAborted();
    if (url.pathname.toLowerCase().endsWith('.spz')) {
      return { root: await loadSplat(assetPath, new Uint8Array(bytes)), sourceBytes: null };
    }
    if (url.pathname.toLowerCase().endsWith('.glb')) {
      // Copy BEFORE parsing. Compressed-primitive extensions hand their views
      // to workers, and a transferred buffer would leave the surgical GLB
      // animation writer holding a detached view of its own source.
      const sourceBytes = new Uint8Array(bytes.slice(0));
      return { root: await parseGltfData(bytes, url, controller.signal), sourceBytes };
    }
    const json = await inlineExternalGltfResources(bytes, url, controller.signal);
    return { root: await parseGltfData(json, url, controller.signal), sourceBytes: null };
  } finally {
    globalThis.clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}

export async function loadProjectAssetModel(
  assetPath: string,
  externalSignal?: AbortSignal,
): Promise<THREE.Object3D> {
  return (await loadProjectAssetModelSource(assetPath, externalSignal)).root;
}

/** Release a model returned by {@link loadProjectAssetModel}. */
export function disposeProjectAssetModel(root: THREE.Object3D): void {
  if (hasUserData(root, 'gaussianSplat')) (root as SplatMesh).dispose();
  disposeAssetPreviewSnapshot(root);
  root.traverse((object) => {
    const instanced = object as THREE.InstancedMesh;
    if (instanced.isInstancedMesh) instanced.morphTexture?.dispose();
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    if (!mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

export async function captureModelAssetPreview(
  assetPath: string,
  options: AssetPreviewOptions = {},
): Promise<AssetPreviewCapture> {
  const model = await loadProjectAssetModel(assetPath);
  try {
    if (hasUserData(model, 'gaussianSplat'))
      return await captureSplatAssetPreview(model as SplatMesh, options);
    return captureObjectAssetPreview(model, options);
  } finally {
    disposeProjectAssetModel(model);
  }
}

export async function captureSourceReviewShotSetModelPreview(
  assetPath: string,
  forward: readonly [number, number, number],
  options: AssetPreviewOptions = {},
): Promise<SourceReviewShotSetCapture> {
  const model = await loadProjectAssetModel(assetPath);
  try {
    return captureSourceReviewShotSetAssetPreview(model, forward, options);
  } finally {
    disposeProjectAssetModel(model);
  }
}

async function captureSplatAssetPreview(
  model: SplatMesh,
  options: AssetPreviewOptions,
): Promise<AssetPreviewCapture> {
  const width = checkedDimension(options.width);
  const height = checkedDimension(options.height);
  const background = options.background ?? 'neutral';
  const framing = measureAssetPreview(model, 'perspective');
  const scene = createPreviewScene(model, framing);
  const renderer = markHostRenderer(
    new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      preserveDrawingBuffer: true,
    }),
  );
  let spark: SparkRenderer | null = null;

  try {
    const sparkModule = await import('@sparkjsdev/spark');
    spark = new sparkModule.SparkRenderer({ renderer, autoUpdate: false, enableLod: false });
    scene.add(spark);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.setClearColor(NEUTRAL_COLOR, background === 'transparent' ? 0 : 1);
    renderer.setSize(width, height, false);
    applyStudioEnvironment(scene, renderer);

    const views: AssetPreviewImage[] = [];
    const sheetCanvas = document.createElement('canvas');
    sheetCanvas.width = width * 2;
    sheetCanvas.height = height * 2;
    const sheetContext = sheetCanvas.getContext('2d');
    if (!sheetContext) throw new Error('Unable to create the asset preview contact sheet.');

    for (const [index, view] of ASSET_PREVIEW_VIEWS.entries()) {
      const camera = createAssetPreviewCamera(
        view,
        measureAssetPreview(model, view),
        width / height,
      );
      await spark.update({ scene, camera });
      renderer.render(scene, camera);
      views.push({ view, base64: pngBase64(renderer.domElement), mimeType: 'image/png' });
      const x = (index % 2) * width;
      const y = Math.floor(index / 2) * height;
      sheetContext.drawImage(renderer.domElement, x, y, width, height);
      drawBitmapLabel(
        sheetContext,
        view === 'perspective' ? '3/4' : view.toUpperCase(),
        x,
        y,
        width,
        height,
      );
    }

    return {
      width,
      height,
      // Splat capture never yaw-normalizes its subject: world axes hold.
      orientation: assetPreviewOrientation([0, 0, 1]),
      views,
      contactSheet: {
        width: width * 2,
        height: height * 2,
        base64: pngBase64(sheetCanvas),
        mimeType: 'image/png',
      },
    };
  } finally {
    spark?.removeFromParent();
    model.removeFromParent();
    spark?.dispose();
    disposeStudioEnvironment(renderer);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/** The `--shots <set>` asset-path entry point — loads the project GLB the
 *  same bounded/validated way {@link captureModelAssetPreview} does, then
 *  renders the definition's labeled shot set against ITS OWN skeleton
 *  (see {@link captureShotSetAssetPreview}). */
export async function captureShotSetModelPreview(
  assetPath: string,
  definition: AssetPreviewShotSetDefinition,
  options: AssetPreviewOptions = {},
): Promise<LabeledShotSetCapture> {
  const model = await loadProjectAssetModel(assetPath);
  try {
    return captureShotSetAssetPreview(model, definition, options);
  } finally {
    disposeProjectAssetModel(model);
  }
}
