/**
 * Typed registry for `Object3D.userData` keys used by the engine and editor.
 *
 * Three.js lets any code stash arbitrary values on `object.userData`, and over
 * time the engine + editor accumulated ~20 stringly-typed keys that together
 * form a *parallel object model* — meaning carried entirely in undocumented
 * string literals. This module is the ONE documented place that lists every
 * such key, its value type, and what it means. All engine/editor-internal
 * `userData` access for these keys must go through {@link getUserData} /
 * {@link setUserData} / {@link hasUserData} / {@link deleteUserData} so the key
 * strings live in exactly one place and are type-checked at every call site.
 * Structural readers may use the narrow `object-marks` accessors instead;
 * this registry includes that module's canonical keys and value schema.
 *
 * NOTE: This covers engine/editor *internal* keys only. User game code in the
 * example template may stash its own ad-hoc keys; those are out of scope.
 *
 * ## Key reference
 *
 * Serialization / identity (load-bearing — editor identity):
 * - `entityId`            — the entity's stable string id. Presence also marks an
 *                           Object3D as a "real" entity (vs editor helper/env object).
 *
 * Runtime scene-query metadata (read by `scene-query.ts` and `scene-index.ts`):
 * - `tags`                — string[] tags for `queryByTag` and the live index.
 * - `attributes`          — per-object `Record<string, string|number|boolean>`
 *                           of game-defined attributes (P2 `observe`). Written
 *                           through `SceneIndex.setAttribute`, which emits an
 *                           `attributechanged` signal; JSON-simple values only,
 *                           so an attribute survives serialization unchanged.
 *
 * Runtime gameplay metadata:
 * - `forward`             — `[x,y,z]` model-space visual forward exported as
 *                           ordinary glTF extras for asset-facing validation.
 * - `navRole`             — `'walkable' | 'obstacle'` navmesh role; collected at runtime.
 * - `pivot`              — `[x,y,z]` local-space pivot for rotate/scale-around-pivot.
 * - `splineCurve`         — resolved THREE curve for a spline-following object.
 * - `_camera`             — THREE.Camera owned by a camera entity (collected on load).
 * - `_particleSystem`     — three.quarks ParticleSystem (scene-sync registration + census).
 * - `gaussianSplat`       — native Spark splat metadata used for renderer discovery,
 *                           inspector facts, bounds, and deterministic disposal.
 *
 * Animation (load-bearing — ED5 disposal contract):
 * - `_animMixer`          — THREE.AnimationMixer driving this subtree's clips.
 * - `_animClips`          — Map<string, AnimationClip> discovered on the GLTF (E5 —
 *                           lets game code build its own XState-driven
 *                           binding via `bindXStateAnimation` over the SAME
 *                           mixer; see xstate-animation-binding.ts).
 * - `_availableClips`     — string[] of clip names discovered on the GLTF
 *                           (inspector dropdown; same names as `_animClips`' keys).
 * - `_animationRuntime`   — format-neutral live native mixer/action inspection.
 * - `_xstateAnimation`    — compatibility handle for the optional XState→Three
 *                           bridge; animation UI never discovers through it.
 *
 * Disposal contract:
 * - `__sharedGeometry`    — `true` when a mesh's geometry is shared/cached and MUST
 *                           NOT be disposed by per-object cleanup (P0.2 contract).
 *
 * Editor shading overrides (editor-only, see `scene-sync.ts`):
 * - `__shadeOrig`         — original material(s) stashed before a shading override.
 * - `__shadeUnlit`        — generated unlit material(s) for the unlit view mode.
 *
 * Unmodified-game ingestion (editor-only, see `editor/src/ingest/`):
 * - `__ingest`            — `true` on every Object3D minted by ingestion; routes
 *                           edits to live mutation.
 * - `__ingestNextId`      — monotonic id counter stashed on the captured Scene
 *                           root so re-reflects keep minting unique ids.
 *
 * Editor scene-graph tagging (editor-only):
 * - `engineInternal`      — `true` on engine-owned infrastructure in the game scene
 *                           (particle BatchedRenderer, debug-draw + its subtree).
 *                           The editor's play-mode hierarchy skips these so they
 *                           don't show up as selectable "entities".
 * - `authoringRoot`       — explicit opt-in for a runtime descendant to become
 *                           its own authoring object instead of a part of the
 *                           nearest ancestor owner.
 * - `authoringInstance`   — source OID of the custom-component callsite that
 *                           rendered this existing Object3D. Used to group
 *                           implementation parts without adding wrappers.
 * - `authoringLabel`      — authored literal name (or component tag fallback)
 *                           for that source-backed component instance.
 * - `authoringComponent`  — exact source component identity for portable-CSF
 *                           association; unlike the label, never user-facing copy.
 * - `authoringDocument`   — generic reference to the project-tool document
 *                           that owns this scene instance's authored asset.
 * - `authoringHierarchyId`, `authoringHierarchyParentId`,
 *   `authoringHierarchyOrder` — source-owned semantic identity, parent identity,
 *                           and sibling ordinal shared across native surfaces.
 * - `editorHelper`        — `true` for editor-only helper objects (gizmos, wireframes).
 *
 * Hierarchy-presentation convention (written by GAME code, read by the editor —
 * see `../adapter/hierarchy-marks.ts`, which is the ONLY place these two are
 * read/written from; the `vgai` prefix marks them as the HOST's namespace on a
 * node a game owns, unlike every other key above, which the engine/editor also
 * write):
 * - `vgaiComponentRoot`   — display name of the component instance this subtree
 *                           IS. The node renders as one collapsed, expandable
 *                           row named for it.
 * - `vgaiBuiltInternal`   — `true` on the ROOT of a subtree runtime code
 *                           CONSTRUCTED rather than authored (skeleton bones,
 *                           particle renderers). Subtree-scoped: everything
 *                           below a marked node is built-internal too.
 * - `vgaiBodyOwner`       — the rigid body that OWNS this node's pose, written
 *                           by the code that attaches the body (see
 *                           `../adapter/body-marks.ts`, the only reader/writer).
 *                           A transform edit on such a node must be applied to
 *                           the BODY, or the next physics step writes the node
 *                           straight back.
 * - `editorHelperType`    — which kind of helper (lights/particles/pivot/navmesh/...).
 * - `editorIcon`          — `true` for editor billboard icon sprites.
 * - `skeletonVisible`     — per-entity editor preference for its bone overlay.
 * - `skeletonEnabled`     — resolved visibility preference on a skeleton helper.
 * - `envObject`           — `true` for environment objects (ambient light, etc.).
 * - `reflectionProbe`     — live project-owned reflection probe projected from
 *                           JSX props for renderer/editor integration.
 * - `triggerVolume`       — plain `{ radius }` a GAME writes on the node that IS
 *                           a trigger volume, so the editor can draw its ring
 *                           (see `../adapter/trigger-volume.ts`).
 * - `constraints`         — live project-owned spatial constraints projected
 *                           into the shared Inspector and viewport.
 * - `authoringSubject`    — transient identity/inspection for an ecosystem-native
 *                           subject represented by an Object3D proxy.
 * - `splineControlPoint`  — index of a spline control-point drag handle.
 * - `vcDirIdx`            — view-cube face direction index (0=+X,1=-X,2=+Y,...).
 */

import type * as THREE from 'three';
import type { ParticleSystem } from 'three.quarks';
import type { ConstraintMark } from '../adapter/constraint';
import type { Object3DAuthoringSubjectMark } from '../adapter/object3d-authoring-subject';
import type { RapierEditableBody } from '../adapter/rapier-physics-adapter';
import type { ReflectionProbeMark } from '../adapter/reflection-probe';
import type { TriggerVolumeMark } from '../adapter/trigger-volume';
import type { AnimationRuntimeInspection } from '../animation/runtime-inspection';
import type { XStateAnimationBinding } from '../animation/xstate-animation-binding';
import { ObjectMarkKeys, type ObjectMarkSchema } from './object-marks';

export type { EditorHelperType } from './object-marks';

/**
 * Maps each canonical accessor name to its value type. This is the single
 * source of truth for what every known `userData` key holds.
 */
export interface UserDataSchema extends ObjectMarkSchema {
  entityId: string;
  forward: [number, number, number];
  tags: string[];
  attributes: Record<string, string | number | boolean>;
  navRole: 'walkable' | 'obstacle';
  pivot: [number, number, number];
  splineCurve: THREE.Curve<THREE.Vector3>;
  splineControlPoint: number;
  _camera: THREE.Camera;
  _particleSystem: ParticleSystem;
  gaussianSplat: { src: string; numSplats: number };
  _animMixer: THREE.AnimationMixer;
  _animClips: Map<string, THREE.AnimationClip>;
  _availableClips: string[];
  _animationRuntime: AnimationRuntimeInspection;
  _xstateAnimation: XStateAnimationBinding;
  __sharedGeometry: boolean;
  __shadeOrig: THREE.Material | THREE.Material[];
  __shadeUnlit: THREE.Material[];
  __ingest: boolean;
  __ingestNextId: number;
  authoringRoot: boolean;
  authoringInstance: string;
  authoringLabel: string;
  vgaiBodyOwner: RapierEditableBody;
  authoringComponent: string;
  authoringDocument: {
    readonly kind: 'project-tool';
    readonly name: string;
    readonly title: string;
  };
  /** Project-owned identity used to join authored hierarchy rows across adapter roots. */
  authoringHierarchyId: string;
  /** Project-owned parent identity when the authored parent can live on another surface. */
  authoringHierarchyParentId: string;
  /** Source-owned sibling ordinal used when hierarchy rows cross native roots. */
  authoringHierarchyOrder: number;
  editorIcon: boolean;
  envObject: boolean;
  constraints: readonly ConstraintMark[];
  authoringSubject: Object3DAuthoringSubjectMark;
  reflectionProbe: ReflectionProbeMark;
  triggerVolume: TriggerVolumeMark;
  vcDirIdx: number;
}

/** Any key in the typed registry. */
export type UserDataKey = keyof UserDataSchema;

/**
 * Canonical name → literal `userData` string key. The accessor names match the
 * raw string keys 1:1 (this is the documented set referenced by the AC), so the
 * literal strings are owned here or by the included structural mark registry.
 */
export const UserDataKeys = {
  ...ObjectMarkKeys,
  entityId: 'entityId',
  forward: 'forward',
  tags: 'tags',
  attributes: 'attributes',
  navRole: 'navRole',
  pivot: 'pivot',
  splineCurve: 'splineCurve',
  splineControlPoint: 'splineControlPoint',
  _camera: '_camera',
  _particleSystem: '_particleSystem',
  gaussianSplat: 'gaussianSplat',
  _animMixer: '_animMixer',
  _animClips: '_animClips',
  _availableClips: '_availableClips',
  _animationRuntime: '_animationRuntime',
  _xstateAnimation: '_xstateAnimation',
  __sharedGeometry: '__sharedGeometry',
  __shadeOrig: '__shadeOrig',
  __shadeUnlit: '__shadeUnlit',
  __ingest: '__ingest',
  __ingestNextId: '__ingestNextId',
  authoringRoot: 'authoringRoot',
  authoringInstance: 'authoringInstance',
  authoringLabel: 'authoringLabel',
  vgaiBodyOwner: 'vgaiBodyOwner',
  authoringComponent: 'authoringComponent',
  authoringDocument: 'authoringDocument',
  authoringHierarchyId: 'authoringHierarchyId',
  authoringHierarchyParentId: 'authoringHierarchyParentId',
  authoringHierarchyOrder: 'authoringHierarchyOrder',
  editorIcon: 'editorIcon',
  envObject: 'envObject',
  constraints: 'constraints',
  authoringSubject: 'authoringSubject',
  reflectionProbe: 'reflectionProbe',
  triggerVolume: 'triggerVolume',
  vcDirIdx: 'vcDirIdx',
} as const satisfies Record<UserDataKey, string>;

/**
 * Read a typed `userData` value. Returns `undefined` when the key is unset or
 * when `obj` is nullish (so call sites can pass an optionally-resolved object).
 */
export function getUserData<K extends UserDataKey>(
  obj: THREE.Object3D | null | undefined,
  key: K,
): UserDataSchema[K] | undefined {
  return obj ? (obj.userData[UserDataKeys[key]] as UserDataSchema[K] | undefined) : undefined;
}

/** Write a typed `userData` value. */
export function setUserData<K extends UserDataKey>(
  obj: THREE.Object3D,
  key: K,
  value: UserDataSchema[K],
): void {
  obj.userData[UserDataKeys[key]] = value;
}

/** True when `key` is set (not `undefined`) on the object's `userData`. */
export function hasUserData(obj: THREE.Object3D | null | undefined, key: UserDataKey): boolean {
  return obj ? obj.userData[UserDataKeys[key]] !== undefined : false;
}

/** Remove a `userData` key. */
export function deleteUserData(obj: THREE.Object3D, key: UserDataKey): void {
  delete obj.userData[UserDataKeys[key]];
}
