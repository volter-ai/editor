/**
 * Source-owned Aim and Rotation constraints over ordinary Three.js objects.
 *
 * These controllers do not introduce a rig graph or a persisted constraint
 * format. A game creates them from its own TS/TSX, calls `update()` after
 * animation, and keeps using the real Object3Ds. The live mark is only the
 * editor's observation seam for the shared constraint stack and viewport.
 */
import {
  type ConstraintMark,
  clearConstraintMark,
  setConstraintMark,
} from '@volter/threejs-runtime/adapter/constraint';
import * as THREE from 'three';

export type ConstraintActivity = () => boolean;

abstract class ObjectConstraintController {
  source!: THREE.Object3D;
  target!: THREE.Object3D;
  markObject: THREE.Object3D | null = null;
  constraintId = 'object-constraint';
  label = 'Constraint';
  enabled = true;
  weight = 1;
  order = 0;
  active: ConstraintActivity | null = null;

  protected status: 'ready' | 'disabled' | 'unresolved' | 'error' = 'unresolved';
  protected message: string | undefined;
  protected angularError: number | null = null;
  private mark: ConstraintMark | null = null;
  private markedObject: THREE.Object3D | null = null;

  protected abstract readonly type: 'aim' | 'rotation';
  protected abstract solve(weight: number): boolean;

  init(): void {
    this.dispose();
    if (!this.source) throw new Error(`${this.label} has no constrained object`);
    if (!this.target) throw new Error(`${this.label} has no target object`);
    const owner = this;
    this.mark = {
      get config() {
        return {
          id: owner.constraintId,
          type: owner.type,
          label: owner.label,
          enabled: owner.enabled,
          weight: THREE.MathUtils.clamp(owner.weight, 0, 1),
          order: owner.order,
        };
      },
      getSnapshot: () => ({
        status: this.status,
        ...(this.message ? { message: this.message } : {}),
        chain: [],
        constrained: this.source,
        target: this.target,
        pole: null,
        error:
          this.angularError === null
            ? null
            : { value: THREE.MathUtils.radToDeg(this.angularError), unit: 'degrees' as const },
      }),
    };
    this.markedObject = this.markObject ?? this.source;
    setConstraintMark(this.markedObject, this.mark);
    this.status = 'ready';
    this.message = undefined;
  }

  update(): void {
    const weight = THREE.MathUtils.clamp(this.weight, 0, 1);
    if (!this.enabled || weight === 0 || this.active?.() === false) {
      this.status = 'disabled';
      this.message = undefined;
      this.angularError = null;
      return;
    }
    try {
      if (this.solve(weight)) {
        this.status = 'ready';
        this.message = undefined;
      }
    } catch (error) {
      this.status = 'error';
      this.message = error instanceof Error ? error.message : String(error);
      this.angularError = null;
      throw error;
    }
  }

  dispose(): void {
    if (this.mark && this.markedObject) clearConstraintMark(this.markedObject, this.constraintId);
    this.mark = null;
    this.markedObject = null;
    this.angularError = null;
  }

  protected applyWorldQuaternion(desired: THREE.Quaternion, weight: number): void {
    this.source.updateWorldMatrix(true, false);
    const current = this.source.getWorldQuaternion(new THREE.Quaternion());
    const blended = current.slerp(desired, weight);
    if (!this.source.parent) {
      this.source.quaternion.copy(blended);
    } else {
      const parentInverse = this.source.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      this.source.quaternion.copy(parentInverse.multiply(blended));
    }
    this.source.updateWorldMatrix(false, true);
  }
}

/** Rotates one object's local aim axis toward an ordinary target Object3D. */
export class AimConstraintController extends ObjectConstraintController {
  protected readonly type = 'aim' as const;
  override label = 'Aim';
  /** The source object's local forward direction. */
  aimAxis: readonly [number, number, number] = [0, 0, -1];
  /** Optional local up direction. Omit it to preserve the current roll. */
  upAxis: readonly [number, number, number] | null = null;
  worldUp: readonly [number, number, number] = [0, 1, 0];

  protected solve(weight: number): boolean {
    this.source.updateWorldMatrix(true, false);
    this.target.updateWorldMatrix(true, false);
    const origin = this.source.getWorldPosition(new THREE.Vector3());
    const direction = this.target.getWorldPosition(new THREE.Vector3()).sub(origin);
    if (direction.lengthSq() < 1e-10) {
      this.status = 'unresolved';
      this.message = 'Aim target occupies the constrained object position';
      this.angularError = null;
      return false;
    }
    direction.normalize();
    const localAim = new THREE.Vector3(...this.aimAxis);
    if (localAim.lengthSq() < 1e-10) throw new Error('Aim axis must be non-zero');
    localAim.normalize();

    const currentWorld = this.source.getWorldQuaternion(new THREE.Quaternion());
    const currentAim = localAim.clone().applyQuaternion(currentWorld).normalize();
    let desired = new THREE.Quaternion()
      .setFromUnitVectors(currentAim, direction)
      .multiply(currentWorld);

    if (this.upAxis) {
      desired = aimWithUp(
        localAim,
        new THREE.Vector3(...this.upAxis),
        direction,
        new THREE.Vector3(...this.worldUp),
      );
    }
    this.applyWorldQuaternion(desired, weight);
    const solvedAim = localAim
      .applyQuaternion(this.source.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    this.angularError = solvedAim.angleTo(direction);
    return true;
  }
}

/** Copies a target's world rotation, plus an explicit local offset. */
export class RotationConstraintController extends ObjectConstraintController {
  protected readonly type = 'rotation' as const;
  override label = 'Rotation';
  /** XYZ Euler offset in radians, applied after the target world rotation. */
  offset: readonly [number, number, number] = [0, 0, 0];

  protected solve(weight: number): boolean {
    this.target.updateWorldMatrix(true, false);
    const desired = this.target
      .getWorldQuaternion(new THREE.Quaternion())
      .multiply(
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(this.offset[0], this.offset[1], this.offset[2], 'XYZ'),
        ),
      );
    this.applyWorldQuaternion(desired, weight);
    this.angularError = this.source.getWorldQuaternion(new THREE.Quaternion()).angleTo(desired);
    return true;
  }
}

function aimWithUp(
  localAim: THREE.Vector3,
  localUp: THREE.Vector3,
  worldAim: THREE.Vector3,
  worldUp: THREE.Vector3,
): THREE.Quaternion {
  if (localUp.lengthSq() < 1e-10) throw new Error('Aim up axis must be non-zero');
  if (worldUp.lengthSq() < 1e-10) throw new Error('World up axis must be non-zero');
  localUp.normalize();
  worldUp.normalize();

  const localX = localUp.clone().cross(localAim);
  if (localX.lengthSq() < 1e-10) throw new Error('Aim and up axes must not be parallel');
  localX.normalize();
  const localY = localAim.clone().cross(localX).normalize();

  const worldX = worldUp.clone().cross(worldAim);
  if (worldX.lengthSq() < 1e-10) {
    const fallback =
      Math.abs(worldAim.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    worldX.copy(fallback).cross(worldAim);
  }
  worldX.normalize();
  const worldY = worldAim.clone().cross(worldX).normalize();

  const localBasis = new THREE.Matrix4().makeBasis(localX, localY, localAim);
  const worldBasis = new THREE.Matrix4().makeBasis(worldX, worldY, worldAim);
  return new THREE.Quaternion().setFromRotationMatrix(worldBasis.multiply(localBasis.invert()));
}
