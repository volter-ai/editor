/**
 * Format-neutral live trigger-volume mark.
 *
 * A project writes plain `userData.triggerVolume = { radius }` on the node that
 * IS the volume — in R3F that is an ordinary `userData` prop on the group, with
 * no engine import and no question asked about whether the game is being
 * authored. The mark exists so the editor can DRAW what such a node is: a
 * radius around a point decides where a hazard fires or a quest arrives, and
 * without a gizmo the hierarchy lists the node while the viewport shows nothing
 * there. This is a live adapter seam, never another document format — the
 * game's own hit test owns the semantics, and the editor reads the radius only
 * to draw it.
 */
import type * as THREE from 'three';
import { getUserData } from '../ecs/user-data';

export interface TriggerVolumeMark {
  /** Local-space radius of the volume, in world units. */
  readonly radius: number;
}

export function triggerVolumeOf(
  object: THREE.Object3D | null | undefined,
): TriggerVolumeMark | null {
  const candidate = getUserData(object, 'triggerVolume');
  if (!candidate || typeof candidate !== 'object') return null;
  const { radius } = candidate as Partial<TriggerVolumeMark>;
  return typeof radius === 'number' && Number.isFinite(radius) && radius > 0 ? { radius } : null;
}
