import { EDITOR_LAYER } from '@volter/editor-threejs/viewport/editor-layers';
import { getObjectMark, setObjectMark } from '@volter/editor-threejs/ecs/object-marks';
import * as THREE from 'three';

const SKELETON_HELPER_TYPE = 'skeletons';
const SKELETON_PARENT_COLOR = new THREE.Color(0x00e5ff);
const SKELETON_CHILD_COLOR = new THREE.Color(0xffb000);

export function styleEditorSkeletonHelper(helper: THREE.SkeletonHelper): void {
  const colors = helper.geometry.getAttribute('color');
  // SkeletonHelper emits two vertices per bone link. Three's stock pure
  // blue/green endpoints disappear against vgai's dark viewport, especially
  // in captures. Keep the native helper geometry, but use editor-contrast
  // colors so the inspection affordance is actually visible.
  for (let i = 0; i < colors.count; i += 2) {
    colors.setXYZ(i, SKELETON_PARENT_COLOR.r, SKELETON_PARENT_COLOR.g, SKELETON_PARENT_COLOR.b);
    if (i + 1 < colors.count) {
      colors.setXYZ(i + 1, SKELETON_CHILD_COLOR.r, SKELETON_CHILD_COLOR.g, SKELETON_CHILD_COLOR.b);
    }
  }
  colors.needsUpdate = true;
  helper.renderOrder = 999;
  const material = helper.material as THREE.LineBasicMaterial;
  material.depthTest = false;
  material.depthWrite = false;
  material.toneMapped = false;
  setObjectMark(helper, 'editorHelper', true);
  setObjectMark(helper, 'editorHelperType', SKELETON_HELPER_TYPE);
  helper.traverse((child) => child.layers.set(EDITOR_LAYER));
}

export function ensureSkeletonHelper(root: THREE.Object3D): THREE.SkeletonHelper | null {
  let existing: THREE.SkeletonHelper | null = null;
  let hasSkinnedMesh = false;
  root.traverse((object) => {
    if (getObjectMark(object, 'editorHelperType') === SKELETON_HELPER_TYPE) {
      existing = object as THREE.SkeletonHelper;
    }
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) hasSkinnedMesh = true;
  });
  if (existing || !hasSkinnedMesh) return existing;

  const helper = new THREE.SkeletonHelper(root);
  if (helper.bones.length === 0) {
    helper.dispose();
    return null;
  }
  styleEditorSkeletonHelper(helper);

  // SkeletonHelper normally expects to be a scene-root sibling. Keeping it
  // under the entity makes lifecycle cleanup automatic, so use entity-local
  // coordinates instead of applying the entity world transform twice.
  helper.matrix = new THREE.Matrix4();
  helper.matrixAutoUpdate = false;
  helper.name = 'EditorSkeletonHelper';
  helper.visible = Boolean(getObjectMark(root, 'skeletonVisible'));
  setObjectMark(helper, 'skeletonEnabled', helper.visible);
  root.add(helper);
  root.updateMatrixWorld(true);
  return helper;
}
