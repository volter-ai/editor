import { getObjectMark } from '@volter/editor-threejs/ecs/object-marks';
import type * as THREE from 'three';

/** Layer used for editor-only infrastructure (grid, gizmos, helpers, editor lights). */
export const EDITOR_LAYER = 31;

/**
 * Temporary mask layer used by the native Three selection effect. Unlike
 * {@link EDITOR_LAYER}, membership here does NOT make an object editor-owned:
 * OutlineEffect adds this bit to the selected game mesh while deriving its
 * mask. Editor cameras exclude the bit from their ordinary pass so the
 * effect's depth comparison can actually separate selected pixels.
 */
export const EDITOR_SELECTION_LAYER = 30;

/**
 * True when this object is the EDITOR'S OWN furniture rather than game content.
 *
 * There are two marking conventions in this codebase and neither one covers
 * everything: the viewport's constructor-time furniture (`GridHelper`, the
 * editor ambient/directional lights, the three.quarks `BatchedRenderer`, the
 * TransformControls helper, the pivot dummy, the snap indicators) is marked
 * ONLY with `layers.set(EDITOR_LAYER)`, while helpers added later
 * (skeleton/physics/crowd/component gizmos) are marked ONLY with
 * `userData.editorHelper`. A walk that checks one convention silently presents
 * the other half as game content.
 *
 * That is the SimCity ledger's S-1 hierarchy defect: `projectThreeScene`
 * checked only the userData flags, so when an ingest mount FAILED — leaving
 * `store.scene` pointed at the editor viewport scene instead of a captured game
 * scene — the hierarchy listed the editor's own grid, lights, BatchedRenderer,
 * gizmo helper, pivot dummy and two snap indicators under the game world's id.
 * A dead game was indistinguishable from a live one.
 *
 * This is the SAME predicate the engine's ingest walk already applies
 * (`@volter/editor-threejs-runtime/adapter/ingest/structural-ids`'s `isEditorOnly`, layer half) plus
 * the userData half `viewport-shading-boundary.ts` applies — stated once here
 * so the two halves can never drift apart again.
 */
export function isEditorOwnedObject(object: THREE.Object3D): boolean {
  return (
    // Read the public mask, which has existed for the full three.js range the
    // ingest devtools hook supports. `Layers.isEnabled()` is newer than r129:
    // calling it rejected an otherwise healthy Cuberun capture before the
    // hierarchy could mount.
    (object.layers.mask & (1 << EDITOR_LAYER)) !== 0 ||
    !!getObjectMark(object, 'editorHelper') ||
    !!getObjectMark(object, 'engineInternal')
  );
}

/** True when `object` is editor furniture itself or lives below an
 * editor-owned root. Helper conventions are not guaranteed to be repeated on
 * every descendant, so hit-testing a leaf must check its ancestry. */
export function isInEditorOwnedSubtree(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (isEditorOwnedObject(current)) return true;
    current = current.parent;
  }
  return false;
}
