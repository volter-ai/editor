/**
 * World-space bounds of the GAME OBJECT a reader selected — the one walk every
 * bounds consumer in the editor uses instead of `Box3.setFromObject`.
 *
 * ## Why `Box3.setFromObject` is the wrong instrument here
 *
 * `setFromObject` answers "what is the extent of this whole subtree", and a
 * live game's subtree contains machinery as well as content. The marks in
 * `@volter/editor-threejs/adapter/hierarchy-marks` already say which is which — a component
 * WRAPS its functionality and MARKS the implementation it attaches — and the
 * hierarchy panel and the drag rules already read them. Bounds is the third
 * consumer, and it is the one where getting it wrong is visible on screen.
 *
 * The measurement that forced this (2026-08-14, the translated platformer's
 * coins): a component root at `(12, 3, -5)` owning a 0.5 m coin mesh and, as a
 * real child, its three.quarks `BatchedRenderer` with
 * `matrixWorldAutoUpdate = false`. That renderer draws in WORLD space, so its
 * identity `matrixWorld` is deliberate and correct for rendering — but its
 * `VFXBatch` child carries the billboard template geometry, whose bounding box
 * is `(-0.5, -0.5, 0)…(0.5, 0.5, 0)` and, at identity, sits AT THE WORLD
 * ORIGIN. `setFromObject` unioned the two and returned
 * `(-0.5, -0.5, -5.05)…(12.25, 3.25, 0)`: a selection cage stretching from the
 * coin all the way back to the origin, on a coin that is 0.5 m across. The
 * batch contributes that box whether or not a single particle is alive, so the
 * cage was wrong from the first frame.
 *
 * That is the general shape, not a quarks quirk: ANY built-internal child whose
 * world transform its owner writes by hand (`matrixWorldAutoUpdate = false` is
 * the mechanism the marks' own header recommends) sits somewhere the subtree
 * walk has no reason to expect, and pooled machinery routinely carries stale or
 * template-sized geometry. Excluding implementation is the only rule that
 * survives all of them.
 *
 * ## What is NOT excluded
 *
 * Editor furniture is deliberately still measured. `isEditorOwnedObject`
 * matches `userData.engineInternal`, and the splat bounds proxy
 * (`@volter/editor-threejs-runtime/asset-loaders`, `__vgai_splat_bounds`) is engine-internal
 * geometry that exists PRECISELY so generic focus/selection bounds can frame a
 * Gaussian splat — a splat renders no `BufferGeometry` of its own. Excluding
 * editor-owned nodes here would silently un-frame every splat. Consumers that
 * want helpers out of their measurement (`_hasBoundableGeometry`, the asset
 * preview's staging) filter for that themselves, on top of this walk.
 *
 * The selected object ITSELF is always measured, even when it is marked. A
 * revealed internals row is selectable, and answering "where is it" with an
 * empty box would be a refusal dressed as a measurement.
 */

import { isBuiltInternal } from '@volter/editor-threejs/adapter/hierarchy-marks';
import * as THREE from 'three';

/**
 * Visit `object` and every descendant that is not implementation, top-down.
 *
 * Subtree-scoped, matching the mark's own contract: a marked node is skipped
 * WITH everything under it, so a rig or a pool costs one check rather than one
 * per bone. `object` itself is always visited — see the header.
 */
export function traverseContent(
  object: THREE.Object3D,
  visit: (node: THREE.Object3D) => void,
): void {
  visit(object);
  for (const child of object.children) {
    if (isBuiltInternal(child)) continue;
    traverseContent(child, visit);
  }
}

/** Scratch for one node's transformed geometry box — this module is synchronous
 *  and single-threaded, so one instance serves every call. */
const nodeBox = new THREE.Box3();

/**
 * Is this box a measurement at all?
 *
 * `Box3.isEmpty()` compares `max < min`, and EVERY comparison against `NaN` is
 * false — so a box with a non-finite corner reports itself as a real,
 * non-empty box, unions into every consumer, and turns the whole world's
 * extent into `NaN`.
 *
 * That is not hypothetical and it is not the game's fault: a live world holds
 * transforms that are not numbers yet. Measured on the racing-game mount
 * (2026-08-15) — two of its meshes sit at `quaternion = (NaN, NaN, NaN, NaN)`
 * while the game is PAUSED at frame zero, because a physics binding reads its
 * worker's buffers before the worker has ever answered. The editor mounts an
 * ingested game paused, so that is the exact state the first look measures.
 * One such node poisoned all 71 boxes: the framing refused (`isEmpty()` false,
 * fit distance `NaN`), the game-camera seed refused (`radius` `NaN`), and the
 * Scene tab opened on the editor's boot pose — inside canyon geometry, a
 * full-bleed rectangle of rock.
 *
 * The clip planes already made this decision for themselves
 * (`viewport-clip-planes.ts`: "a camera whose bounds could not be measured
 * must still draw"). Dropping the node HERE is the same decision made once, at
 * the measurement, so framing, clipping and the selection cage all get the
 * finite answer instead of each guarding separately.
 */
function isFiniteBox(box: THREE.Box3): boolean {
  return (
    Number.isFinite(box.min.x) &&
    Number.isFinite(box.min.y) &&
    Number.isFinite(box.min.z) &&
    Number.isFinite(box.max.x) &&
    Number.isFinite(box.max.y) &&
    Number.isFinite(box.max.z)
  );
}

/** Scratch for the per-instance walk below — same single-threaded argument. */
const instanceMatrix = new THREE.Matrix4();
const instanceBox = new THREE.Box3();

/**
 * Union an `InstancedMesh`'s OWN drawn units into `target`, in world space.
 *
 * **Why not the object-level `boundingBox` three's own rule prefers here:
 * `InstancedMesh.computeBoundingBox()` CACHES, and instanced content MOVES.**
 * `boundingBox` starts `null`, is filled on the first request, and is never
 * recomputed — three's docs say so outright ("You may need to recompute the
 * bounding box if an instance is transformed"). A trail system that rewrites
 * every instance matrix each frame (the racing-game's `Dust`/`Skid`) is
 * therefore measured forever at whatever pose the editor first happened to ask
 * about, and the per-frame selection cage — which exists to be glued to the
 * thing — is glued to where the content USED to be. Nothing invalidates that
 * cache, because nothing in the game's code knows the editor is looking.
 *
 * So the union is taken from the instance matrices as they stand, per call. The
 * per-instance finite filter is the same decision {@link isFiniteBox} makes one
 * level up and for the same reason: a live world holds transforms that are not
 * numbers yet, and one such unit would otherwise turn the node's whole box into
 * `NaN` — which `isEmpty()` cannot see.
 *
 * Cost is O(count) per call, which is exactly what `computeBoundingBox` costs;
 * the callers that pay it per frame are scoped to the selection.
 */
function expandByInstances(
  target: THREE.Box3,
  node: THREE.InstancedMesh,
  geometryBox: THREE.Box3,
): void {
  for (let index = 0; index < node.count; index++) {
    node.getMatrixAt(index, instanceMatrix);
    instanceBox.copy(geometryBox).applyMatrix4(instanceMatrix).applyMatrix4(node.matrixWorld);
    if (!isFiniteBox(instanceBox)) continue;
    target.union(instanceBox);
  }
}

/**
 * Union `node`'s OWN renderable extent into `target`, ignoring its children.
 *
 * The object-level `boundingBox` (SkinnedMesh / BatchedMesh, which account for
 * skinning and draw ranges) takes precedence over the shared geometry's, exactly
 * as three's own `Box3.expandByObject` decides it. We cannot call that method —
 * it walks children, which is the whole thing this module exists to control — so
 * the per-node half is spelled here, over three's public `boundingBox` /
 * `computeBoundingBox` API. Same shape as `model-thumbnail.ts`'s
 * `modelPreviewBounds`, which already needed a filtered walk for its own reason.
 *
 * `InstancedMesh` is the one node three's own rule gets wrong for a LIVE world;
 * see {@link expandByInstances}.
 */
function expandByNodeGeometry(target: THREE.Box3, node: THREE.Object3D): void {
  const geometry = (node as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
  if (!geometry) return;
  const local = localRenderableBox(node, geometry);
  if (!local) return;
  if ((node as THREE.InstancedMesh).isInstancedMesh) {
    expandByInstances(target, node as THREE.InstancedMesh, local);
    return;
  }
  nodeBox.copy(local).applyMatrix4(node.matrixWorld);
  if (!isFiniteBox(nodeBox)) return;
  target.union(nodeBox);
}

/** The box `node` draws in its OWN space, computing it on first ask exactly as
 *  three does. `null` when the geometry cannot produce one at all. */
function localRenderableBox(
  node: THREE.Object3D,
  geometry: THREE.BufferGeometry,
): THREE.Box3 | null {
  const renderable = node as THREE.Object3D & {
    boundingBox?: THREE.Box3 | null;
    computeBoundingBox?: () => void;
  };
  // An InstancedMesh's own `boundingBox` already has the instance matrices
  // baked in, so it is the GEOMETRY box that `expandByInstances` needs.
  //
  // A SkinnedMesh is measured by its GEOMETRY (bind-pose) box, and its
  // mesh-level cache is deliberately never touched. `computeBoundingBox()` on
  // a SkinnedMesh runs the CPU skinning path, and on the humanoid rigs it
  // yields bone-WORLD-contaminated "local" bounds (measured live on the
  // hosted editor: local box z≈7.8..8.2 for a body whose matrixWorld already
  // carries z=8). Three CACHES that box on the mesh, and `SkinnedMesh.raycast`
  // then uses it as an early-out gate against the LOCALIZED ray — so the one
  // framing/thumbnail pass that touched a character made it click-through
  // FOREVER: rays hit the floor behind while the body rendered right under
  // the cursor (the enemy-torso click that selected the jump pad ten units
  // behind it). The bind-pose box is the honest edit-mode answer here anyway
  // — edit mode shows the authored pose.
  if ((node as THREE.SkinnedMesh).isSkinnedMesh) {
    if (geometry.boundingBox === null) geometry.computeBoundingBox();
    return geometry.boundingBox;
  }
  if (renderable.boundingBox !== undefined && !(node as THREE.InstancedMesh).isInstancedMesh) {
    if (renderable.boundingBox === null) renderable.computeBoundingBox?.();
    return renderable.boundingBox ?? null;
  }
  if (geometry.boundingBox === null) geometry.computeBoundingBox();
  return geometry.boundingBox;
}

/**
 * Grow `target` to contain `object`'s content subtree, in world space.
 *
 * Drop-in for `Box3.expandByObject(object)`, minus implementation subtrees.
 * Like three's own, it refreshes each visited node's `matrixWorld` from its
 * parent as it descends and never touches ancestors — a caller that needs the
 * chain above `object` current calls `updateWorldMatrix(true, false)` first,
 * exactly as it does today.
 */
export function expandBoxByContent(target: THREE.Box3, object: THREE.Object3D): THREE.Box3 {
  traverseContent(object, (node) => {
    node.updateWorldMatrix(false, false);
    expandByNodeGeometry(target, node);
  });
  return target;
}

/** Scratch for the per-node collection below — same single-threaded argument. */
const collectBox = new THREE.Box3();

/**
 * One drawing node's world box, plus whether it is authored as a non-occluding
 * overlay. The 3D board's framing uses the overlay bit to leave a light-beam
 * cone (or a trigger / AoE) out of the default camera without judging size.
 */
export interface ContentNodeRecord {
  readonly box: THREE.Box3;
  /**
   * Every material on this mesh has `depthWrite === false`. That is the
   * authored "I am a volume, not a body" flag — measured on the lighthouse
   * beam (`transparent`, `opacity: 0.16`, `depthWrite: false`) and absent
   * from every body mesh of that prefab and of an opaque hull.
   */
  readonly overlay: boolean;
  /**
   * Every material on this mesh is `BackSide`. That is the authored
   * "I am the inside of an enclosure" flag a skybox carries, and a hull
   * or building does not.
   */
  readonly enclosure: boolean;
}

function nodeMaterials(node: THREE.Object3D): THREE.Material[] {
  const material = (node as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

/** True when every material on `node` is authored not to write depth. */
export function nodeIsOverlay(node: THREE.Object3D): boolean {
  const list = nodeMaterials(node);
  return list.length > 0 && list.every((entry) => entry.depthWrite === false);
}

/** True when every material on `node` is authored as an interior enclosure. */
export function nodeIsEnclosure(node: THREE.Object3D): boolean {
  const list = nodeMaterials(node);
  return list.length > 0 && list.every((entry) => entry.side === THREE.BackSide);
}

/**
 * The same walk as {@link expandBoxByContent}, reported one record PER NODE
 * instead of unioned.
 *
 * The union answers "how big is this world"; framing needs "where is this
 * world's content", and those are different questions the moment a world has a
 * backdrop — one skybox sphere or one far prop moves the union and moves
 * nothing else (`scene-framing.ts` has the measurement). Only nodes that
 * actually draw contribute a box, so groups, lights and cameras add nothing to
 * the distribution.
 */
export function collectContentNodeRecords(
  object: THREE.Object3D,
  out: ContentNodeRecord[] = [],
): ContentNodeRecord[] {
  traverseContent(object, (node) => {
    node.updateWorldMatrix(false, false);
    collectBox.makeEmpty();
    expandByNodeGeometry(collectBox, node);
    if (collectBox.isEmpty()) return;
    out.push({
      box: collectBox.clone(),
      overlay: nodeIsOverlay(node),
      enclosure: nodeIsEnclosure(node),
    });
  });
  return out;
}

/**
 * The same walk as {@link collectContentNodeRecords}, boxes only. Callers that
 * do not need the overlay bit keep this entry.
 */
export function collectContentNodeBoxes(
  object: THREE.Object3D,
  out: THREE.Box3[] = [],
): THREE.Box3[] {
  for (const record of collectContentNodeRecords(object)) out.push(record.box);
  return out;
}

/**
 * The world AABB of `object`'s content subtree.
 *
 * Drop-in for `new THREE.Box3().setFromObject(object)`. Pass `target` to reuse
 * a box across frames (the selection cage recomputes one per selected entity
 * per frame).
 */
export function contentWorldBounds(
  object: THREE.Object3D,
  target: THREE.Box3 = new THREE.Box3(),
): THREE.Box3 {
  target.makeEmpty();
  return expandBoxByContent(target, object);
}

/**
 * The Bounds diagnostic's twelve-edge box, drawn on {@link contentWorldBounds}
 * rather than `BoxHelper`'s own `setFromObject`.
 *
 * `THREE.BoxHelper` recomputes its box internally on every `update()`, so it
 * cannot be pointed at a filtered walk; `Box3Helper` is three's own class for
 * "draw THIS box", which is what we have. Same twelve edges, same colour.
 */
export class ContentBoundsHelper extends THREE.Box3Helper {
  /** The entity object this box is measured from. */
  readonly entityObject: THREE.Object3D;

  constructor(object: THREE.Object3D, color: THREE.ColorRepresentation) {
    super(new THREE.Box3(), color);
    this.entityObject = object;
    this.update();
  }

  /** Re-measure. Named to match `BoxHelper.update()`, which the viewport's
   *  per-frame refresh already calls on everything in its bounds map. */
  update(): void {
    contentWorldBounds(this.entityObject, this.box);
  }
}
