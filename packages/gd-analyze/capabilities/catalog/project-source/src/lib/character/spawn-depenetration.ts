/**
 * Recover a newly placed kinematic character from authored overlap using the
 * native Rapier shape-query seam.
 *
 * This is deliberately a placement primitive, not a character controller. It
 * owns no body, collider, world, clock, or collision policy: the caller passes
 * the native objects and the same query predicate its movement sweep uses.
 */

export interface SpawnVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SpawnRotation {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface KinematicSpawnBody {
  setTranslation(translation: SpawnVector3, wakeUp: boolean): void;
  setNextKinematicTranslation(translation: SpawnVector3): void;
}

export interface KinematicSpawnWorld<Collider extends object = object> {
  intersectionsWithShape(
    shapePosition: SpawnVector3,
    shapeRotation: SpawnRotation,
    shape: object,
    callback: (collider: Collider) => boolean,
    filterFlags?: number,
    filterGroups?: number,
    filterExcludeCollider?: Collider,
    filterExcludeRigidBody?: object,
    filterPredicate?: (collider: Collider) => boolean,
  ): void;
  propagateModifiedBodyPositionsToColliders(): void;
  updateSceneQueries(): void;
}

export interface DepenetrateKinematicSpawnOptions<Collider extends object = object> {
  readonly world: KinematicSpawnWorld<Collider>;
  readonly body: KinematicSpawnBody;
  readonly shape: object;
  readonly shapeOffset?: SpawnVector3;
  readonly shapeRotation?: SpawnRotation;
  readonly excludeBody: object;
  readonly position: SpawnVector3;
  /** Direction in which authored spawn overlap is recovered. Defaults to +Y. */
  readonly direction?: SpawnVector3;
  /** Native query flags, such as Rapier's EXCLUDE_SENSORS. */
  readonly filterFlags?: number;
  readonly filterPredicate?: (collider: Collider) => boolean;
  /** Recovery increment in world units. Defaults to 0.01. */
  readonly step?: number;
  /** Maximum recovery distance before refusing the spawn. Defaults to 1. */
  readonly maxDistance?: number;
  /** Extra clear distance after the first non-overlapping pose. Defaults to one step. */
  readonly clearance?: number;
}

const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });
const IDENTITY = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
const UP = Object.freeze({ x: 0, y: 1, z: 0 });

function finiteVector(value: SpawnVector3, member: string): SpawnVector3 {
  if (![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new TypeError(`character: ${member} requires a finite vector.`);
  }
  return value;
}

function place<Collider extends object>(
  world: KinematicSpawnWorld<Collider>,
  body: KinematicSpawnBody,
  position: SpawnVector3,
): void {
  body.setTranslation(position, true);
  body.setNextKinematicTranslation(position);
  world.propagateModifiedBodyPositionsToColliders();
  world.updateSceneQueries();
}

/**
 * Place a native kinematic body, then advance it by bounded increments until
 * its own shape no longer overlaps any collider admitted by the caller's
 * native Rapier query filter.
 *
 * The returned value is a copy of the final world-space body position. The
 * body and query pipeline are already at that pose when this function returns.
 */
export function depenetrateKinematicSpawn<Collider extends object = object>(
  options: DepenetrateKinematicSpawnOptions<Collider>,
): SpawnVector3 {
  const step = options.step ?? 0.01;
  const maxDistance = options.maxDistance ?? 1;
  const clearance = options.clearance ?? step;
  if (!Number.isFinite(step) || step <= 0) throw new RangeError('character: spawn recovery step must be greater than zero.');
  if (!Number.isFinite(maxDistance) || maxDistance < 0) throw new RangeError('character: spawn recovery maxDistance must be nonnegative.');
  if (!Number.isFinite(clearance) || clearance < 0) throw new RangeError('character: spawn recovery clearance must be nonnegative.');

  const position = finiteVector(options.position, 'spawn position');
  const offset = finiteVector(options.shapeOffset ?? ZERO, 'spawn shape offset');
  const direction = finiteVector(options.direction ?? UP, 'spawn recovery direction');
  const directionLength = Math.hypot(direction.x, direction.y, direction.z);
  if (directionLength === 0) throw new RangeError('character: spawn recovery direction must be nonzero.');
  const unit = {
    x: direction.x / directionLength,
    y: direction.y / directionLength,
    z: direction.z / directionLength,
  };
  const rotation = options.shapeRotation ?? IDENTITY;
  if (![rotation.x, rotation.y, rotation.z, rotation.w].every(Number.isFinite)) {
    throw new TypeError('character: spawn shape rotation requires a finite quaternion.');
  }

  let current = { x: position.x, y: position.y, z: position.z };
  place(options.world, options.body, current);

  const overlaps = (): boolean => {
    let hit = false;
    options.world.intersectionsWithShape(
      { x: current.x + offset.x, y: current.y + offset.y, z: current.z + offset.z },
      rotation,
      options.shape,
      () => {
        hit = true;
        return false;
      },
      options.filterFlags,
      undefined,
      undefined,
      options.excludeBody,
      options.filterPredicate,
    );
    return hit;
  };

  let recovered = 0;
  while (overlaps()) {
    if (recovered + step > maxDistance) {
      throw new Error(
        `character: a kinematic body spawned inside colliding geometry and could not be ` +
          `recovered within ${maxDistance.toFixed(2)} world units.`,
      );
    }
    current = {
      x: current.x + unit.x * step,
      y: current.y + unit.y * step,
      z: current.z + unit.z * step,
    };
    recovered += step;
  }

  if (recovered > 0 && clearance > 0) {
    current = {
      x: current.x + unit.x * clearance,
      y: current.y + unit.y * clearance,
      z: current.z + unit.z * clearance,
    };
  }
  if (recovered > 0) place(options.world, options.body, current);
  return { x: current.x, y: current.y, z: current.z };
}
