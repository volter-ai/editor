/**
 * Format-neutral live mark for source-owned spatial constraints.
 *
 * The project capability that performs a solve attaches one or more marks to
 * the Object3D that owns the constrained pose. The editor reads the marks to
 * render an ordinary constraint stack and transient viewport handles. This is
 * observation, not authored data: the owning TS/TSX and its ordinary target /
 * pole Object3Ds remain the only source of truth.
 */
import type * as THREE from 'three';
import { deleteUserData, getUserData, setUserData } from '../ecs/user-data';

export type ConstraintStatus = 'ready' | 'disabled' | 'unresolved' | 'error';

export interface ConstraintConfig {
  /** Stable only within this mounted owner. */
  readonly id: string;
  readonly type: 'two-bone-ik' | 'ccd-ik' | 'aim' | 'rotation' | (string & {});
  readonly label: string;
  readonly enabled: boolean;
  readonly weight: number;
  /** Evaluation order among constraints attached to this owner. */
  readonly order: number;
}

export interface ConstraintError {
  readonly value: number;
  readonly unit: 'metres' | 'degrees';
}

export interface ConstraintSnapshot {
  readonly status: ConstraintStatus;
  readonly message?: string;
  /** Root → effector, using the real bones from the live skeleton. */
  readonly chain: readonly THREE.Object3D[];
  /** The ordinary object whose transform the constraint affects. */
  readonly constrained: THREE.Object3D | null;
  readonly target: THREE.Object3D | null;
  readonly pole: THREE.Object3D | null;
  /** Residual after the latest solve, in the constraint's native unit. */
  readonly error: ConstraintError | null;
}

export interface ConstraintMark {
  readonly config: ConstraintConfig;
  getSnapshot(): ConstraintSnapshot;
}

export function constraintsOf(
  object: THREE.Object3D | null | undefined,
): readonly ConstraintMark[] {
  const candidate = getUserData(object, 'constraints');
  if (!Array.isArray(candidate)) return [];
  return candidate.filter(
    (entry): entry is ConstraintMark =>
      Boolean(entry) &&
      typeof entry === 'object' &&
      typeof (entry as Partial<ConstraintMark>).getSnapshot === 'function' &&
      Boolean((entry as Partial<ConstraintMark>).config),
  );
}

/** Add or replace one constraint mark without disturbing sibling constraints. */
export function setConstraintMark(object: THREE.Object3D, mark: ConstraintMark): void {
  const next = constraintsOf(object).filter((entry) => entry.config.id !== mark.config.id);
  setUserData(object, 'constraints', [...next, mark]);
}

/** Remove one mark, or the whole live projection when no id is supplied. */
export function clearConstraintMark(object: THREE.Object3D, id?: string): void {
  if (id === undefined) {
    deleteUserData(object, 'constraints');
    return;
  }
  const next = constraintsOf(object).filter((entry) => entry.config.id !== id);
  if (next.length === 0) deleteUserData(object, 'constraints');
  else setUserData(object, 'constraints', next);
}
