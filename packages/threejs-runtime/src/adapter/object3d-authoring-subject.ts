/**
 * Transient authoring identity for a native subject represented by an
 * Object3D proxy.
 *
 * Some ecosystem-native objects are not Object3Ds themselves: Rapier bodies
 * and joints are the first examples. A project library may already own a
 * viewport proxy for one of those objects. This mark lets the ordinary
 * Object3D authoring projection name and inspect that proxy without teaching
 * the editor shell the library's nouns or creating a persisted sidecar.
 *
 * The mark is observation only. Its values are read from the native owner at
 * the moment they are requested, and any authored change still belongs in the
 * owning TS/TSX or ecosystem artifact.
 */

import type { PropertyDescriptor } from '@volter/editor-project/adapter/authoring';
import type * as THREE from 'three';
import { deleteUserData, getUserData, setUserData } from '../ecs/user-data';

export interface Object3DAuthoringSubjectField extends PropertyDescriptor {
  /** Read the current value from the native subject. */
  readonly value: () => unknown;
}

export interface Object3DAuthoringSubjectMark {
  readonly label: string;
  readonly kind: string;
  readonly typeLabel?: string;
  readonly fields?: () => readonly Object3DAuthoringSubjectField[];
  /** Presentation-only selection feedback for proxies hidden by default. */
  readonly selectionChanged?: (selected: boolean) => void;
}

export function object3DAuthoringSubjectOf(
  object: THREE.Object3D | null | undefined,
): Object3DAuthoringSubjectMark | null {
  const mark = getUserData(object, 'authoringSubject');
  return mark && typeof mark.label === 'string' && typeof mark.kind === 'string' ? mark : null;
}

export function setObject3DAuthoringSubject(
  object: THREE.Object3D,
  mark: Object3DAuthoringSubjectMark,
): void {
  setUserData(object, 'authoringSubject', mark);
}

export function clearObject3DAuthoringSubject(object: THREE.Object3D): void {
  deleteUserData(object, 'authoringSubject');
}
