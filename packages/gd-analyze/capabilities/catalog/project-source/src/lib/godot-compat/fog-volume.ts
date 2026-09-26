import { Object3D, Vector3 } from 'three';
import type { GodotFogMaterial } from './fog-material';
import { registerGodotObjectIdentity } from './object';

export const GodotFogVolumeShape = {
  ELLIPSOID: 0,
  CONE: 1,
  CYLINDER: 2,
  BOX: 3,
  WORLD: 4,
  MAX: 5,
} as const;

export type GodotFogVolumeShapeValue = Exclude<typeof GodotFogVolumeShape[keyof typeof GodotFogVolumeShape], 5>;

function sizeVector(value: Vector3): Vector3 {
  if (![value.x, value.y, value.z].every((component) => Number.isFinite(component) && component >= 0)) {
    throw new RangeError('FogVolume.size requires finite nonnegative components.');
  }
  return value.clone();
}

export class GodotFogVolume extends Object3D {
  private shapeValue: GodotFogVolumeShapeValue = GodotFogVolumeShape.BOX;
  private readonly volumeSize = new Vector3(2, 2, 2);
  private materialValue: GodotFogMaterial | null = null;

  constructor() {
    super();
    registerGodotObjectIdentity(this, 'FogVolume');
  }

  set_shape(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value >= GodotFogVolumeShape.MAX) {
      throw new RangeError('FogVolume.shape requires a valid shape enum.');
    }
    this.shapeValue = value as GodotFogVolumeShapeValue;
  }
  get_shape(): GodotFogVolumeShapeValue { return this.shapeValue; }
  set_size(value: Vector3): void { this.volumeSize.copy(sizeVector(value)); }
  get_size(): Vector3 { return this.volumeSize.clone(); }
  set_material(value: GodotFogMaterial | null): void { this.materialValue = value; }
  get_material(): GodotFogMaterial | null { return this.materialValue; }

  contains_local_point(point: Vector3): boolean {
    if (this.shapeValue === GodotFogVolumeShape.WORLD) return true;
    const half = this.volumeSize.clone().multiplyScalar(0.5);
    if (this.shapeValue === GodotFogVolumeShape.BOX) {
      return Math.abs(point.x) <= half.x && Math.abs(point.y) <= half.y && Math.abs(point.z) <= half.z;
    }
    if (this.shapeValue === GodotFogVolumeShape.ELLIPSOID) {
      if (half.x === 0 || half.y === 0 || half.z === 0) return false;
      const normalized = new Vector3(point.x / half.x, point.y / half.y, point.z / half.z);
      return normalized.lengthSq() <= 1;
    }
    if (this.shapeValue === GodotFogVolumeShape.CYLINDER) {
      if (half.x === 0 || half.z === 0) return false;
      const radial = point.x * point.x / (half.x * half.x) + point.z * point.z / (half.z * half.z);
      return radial <= 1 && Math.abs(point.y) <= half.y;
    }
    if (half.x === 0 || half.y === 0 || half.z === 0 || point.y < -half.y || point.y > half.y) return false;
    const heightRatio = (half.y - point.y) / (this.volumeSize.y || 1);
    const radiusX = half.x * heightRatio;
    const radiusZ = half.z * heightRatio;
    if (radiusX <= 0 || radiusZ <= 0) return point.x === 0 && point.z === 0;
    return point.x * point.x / (radiusX * radiusX) + point.z * point.z / (radiusZ * radiusZ) <= 1;
  }

  density_at_local_point(point: Vector3): number {
    if (!this.contains_local_point(point)) return 0;
    return this.materialValue?.get_density() ?? 1;
  }
}

export const createGodotFogVolume = (): GodotFogVolume => new GodotFogVolume();
