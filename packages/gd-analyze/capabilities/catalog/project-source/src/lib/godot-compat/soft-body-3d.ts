import { Matrix4, Object3D, Vector3 } from 'three';
import { registerGodotObjectIdentity } from './object';

export const GodotSoftBodyDisableMode = {
  REMOVE: 0,
  KEEP_ACTIVE: 1,
} as const;

export interface GodotSoftBodyPinnedPoint {
  readonly pointIndex: number;
  readonly attachmentPath: string;
}

export interface GodotSoftBodyRuntimeCarrier {
  configure(owner: GodotSoftBody3D): void;
  setPointPinned(pointIndex: number, pinned: boolean, attachmentPath: string): void;
  getPointTransform(pointIndex: number): Matrix4 | null;
  getPointPosition?(pointIndex: number): Vector3 | null;
  reset?(): void;
}

function finite(member: string, value: number, minimum = -Infinity, maximum = Infinity): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${member} requires a finite value in [${minimum}, ${maximum}].`);
  }
  return value;
}

function natural(member: string, value: number, minimum = 0): number {
  if (!Number.isInteger(value) || value < minimum) throw new RangeError(`${member} requires an integer >= ${minimum}.`);
  return value;
}

function mask(member: string, value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError(`${member} requires unsigned 32-bit mask.`);
  return value >>> 0;
}

function setMaskBit(current: number, layer: number, enabled: boolean): number {
  if (!Number.isInteger(layer) || layer < 1 || layer > 32) throw new RangeError('SoftBody3D layer number requires [1, 32].');
  const bit = 2 ** (layer - 1);
  return enabled ? (current | bit) >>> 0 : (current & ~bit) >>> 0;
}

function getMaskBit(current: number, layer: number): boolean {
  if (!Number.isInteger(layer) || layer < 1 || layer > 32) throw new RangeError('SoftBody3D layer number requires [1, 32].');
  return (current & 2 ** (layer - 1)) !== 0;
}

export class GodotSoftBody3D extends Object3D {
  private meshValue: unknown = null;
  private skinValue: unknown = null;
  private collisionLayerValue = 1;
  private collisionMaskValue = 1;
  private disableModeValue: number = GodotSoftBodyDisableMode.REMOVE;
  private rayPickableValue = true;
  private simulationPrecisionValue = 5;
  private totalMassValue = 1;
  private linearStiffnessValue = 0.5;
  private pressureCoefficientValue = 0;
  private dampingCoefficientValue = 0.01;
  private dragCoefficientValue = 0;
  private poseMatchingCoefficientValue = 0;
  private readonly pinnedPoints = new Map<number, string>();
  private runtime: GodotSoftBodyRuntimeCarrier | null = null;

  constructor() {
    super();
    registerGodotObjectIdentity(this, 'SoftBody3D');
  }

  bind_runtime(value: GodotSoftBodyRuntimeCarrier | null): void {
    this.runtime = value;
    if (value === null) return;
    value.configure(this);
    for (const [pointIndex, attachmentPath] of this.pinnedPoints) value.setPointPinned(pointIndex, true, attachmentPath);
  }
  get_runtime(): GodotSoftBodyRuntimeCarrier | null { return this.runtime; }
  set_mesh(value: unknown): void { this.meshValue = value; this.reconfigure(); }
  get_mesh(): unknown { return this.meshValue; }
  set_skin(value: unknown): void { this.skinValue = value; this.reconfigure(); }
  get_skin(): unknown { return this.skinValue; }
  set_collision_layer(value: number): void { this.collisionLayerValue = mask('SoftBody3D.collision_layer', value); this.reconfigure(); }
  get_collision_layer(): number { return this.collisionLayerValue; }
  set_collision_layer_value(layer: number, enabled: boolean): void { this.collisionLayerValue = setMaskBit(this.collisionLayerValue, layer, enabled); this.reconfigure(); }
  get_collision_layer_value(layer: number): boolean { return getMaskBit(this.collisionLayerValue, layer); }
  set_collision_mask(value: number): void { this.collisionMaskValue = mask('SoftBody3D.collision_mask', value); this.reconfigure(); }
  get_collision_mask(): number { return this.collisionMaskValue; }
  set_collision_mask_value(layer: number, enabled: boolean): void { this.collisionMaskValue = setMaskBit(this.collisionMaskValue, layer, enabled); this.reconfigure(); }
  get_collision_mask_value(layer: number): boolean { return getMaskBit(this.collisionMaskValue, layer); }
  set_disable_mode(value: number): void {
    if (value !== 0 && value !== 1) throw new RangeError('SoftBody3D.disable_mode requires REMOVE or KEEP_ACTIVE.');
    this.disableModeValue = value; this.reconfigure();
  }
  get_disable_mode(): number { return this.disableModeValue; }
  set_ray_pickable(value: boolean): void { this.rayPickableValue = value; this.reconfigure(); }
  is_ray_pickable(): boolean { return this.rayPickableValue; }
  set_simulation_precision(value: number): void { this.simulationPrecisionValue = natural('SoftBody3D.simulation_precision', value, 1); this.reconfigure(); }
  get_simulation_precision(): number { return this.simulationPrecisionValue; }
  set_total_mass(value: number): void { this.totalMassValue = finite('SoftBody3D.total_mass', value, 0.001); this.reconfigure(); }
  get_total_mass(): number { return this.totalMassValue; }
  set_linear_stiffness(value: number): void { this.linearStiffnessValue = finite('SoftBody3D.linear_stiffness', value, 0, 1); this.reconfigure(); }
  get_linear_stiffness(): number { return this.linearStiffnessValue; }
  set_pressure_coefficient(value: number): void { this.pressureCoefficientValue = finite('SoftBody3D.pressure_coefficient', value, 0); this.reconfigure(); }
  get_pressure_coefficient(): number { return this.pressureCoefficientValue; }
  set_damping_coefficient(value: number): void { this.dampingCoefficientValue = finite('SoftBody3D.damping_coefficient', value, 0, 1); this.reconfigure(); }
  get_damping_coefficient(): number { return this.dampingCoefficientValue; }
  set_drag_coefficient(value: number): void { this.dragCoefficientValue = finite('SoftBody3D.drag_coefficient', value, 0); this.reconfigure(); }
  get_drag_coefficient(): number { return this.dragCoefficientValue; }
  set_pose_matching_coefficient(value: number): void { this.poseMatchingCoefficientValue = finite('SoftBody3D.pose_matching_coefficient', value, 0, 1); this.reconfigure(); }
  get_pose_matching_coefficient(): number { return this.poseMatchingCoefficientValue; }

  set_point_pinned(pointIndex: number, pinned: boolean, attachmentPath = ''): void {
    const point = natural('SoftBody3D point index', pointIndex);
    if (typeof attachmentPath !== 'string') throw new TypeError('SoftBody3D attachment path requires NodePath.');
    if (pinned) this.pinnedPoints.set(point, attachmentPath);
    else this.pinnedPoints.delete(point);
    this.runtime?.setPointPinned(point, pinned, attachmentPath);
  }
  is_point_pinned(pointIndex: number): boolean { return this.pinnedPoints.has(natural('SoftBody3D point index', pointIndex)); }
  get_pinned_point_attachment_path(pointIndex: number): string { return this.pinnedPoints.get(natural('SoftBody3D point index', pointIndex)) ?? ''; }
  get_pinned_points(): number[] { return [...this.pinnedPoints.keys()].sort((a, b) => a - b); }
  clear_pinned_points(): void {
    for (const point of this.pinnedPoints.keys()) this.runtime?.setPointPinned(point, false, '');
    this.pinnedPoints.clear();
  }
  get_point_transform(pointIndex: number): Matrix4 {
    const point = natural('SoftBody3D point index', pointIndex);
    return this.runtime?.getPointTransform(point)?.clone() ?? new Matrix4();
  }
  get_point_position(pointIndex: number): Vector3 {
    const point = natural('SoftBody3D point index', pointIndex);
    const direct = this.runtime?.getPointPosition?.(point);
    if (direct !== null && direct !== undefined) return direct.clone();
    return new Vector3().setFromMatrixPosition(this.get_point_transform(point));
  }
  reset_physics_simulation_state(): void { this.runtime?.reset?.(); }

  private reconfigure(): void { this.runtime?.configure(this); }
}

export const createGodotSoftBody3D = (): GodotSoftBody3D => new GodotSoftBody3D();
