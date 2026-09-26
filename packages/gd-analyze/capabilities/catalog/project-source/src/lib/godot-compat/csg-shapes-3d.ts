import { Color, Object3D, Vector2 } from 'three';
import { registerGodotObjectIdentity } from './object';

export const GodotCSGOperation = {
  UNION: 0,
  INTERSECTION: 1,
  SUBTRACTION: 2,
} as const;

export const GodotCSGPolygonMode = {
  DEPTH: 0,
  SPIN: 1,
  PATH: 2,
} as const;

export const GodotCSGPathRotation = {
  POLYGON: 0,
  PATH: 1,
  PATH_FOLLOW: 2,
} as const;

export const GodotCSGPathIntervalType = {
  DISTANCE: 0,
  SUBDIVIDE: 1,
} as const;

export interface GodotCSGMeshResult {
  readonly mesh: unknown;
  readonly materialCount: number;
  readonly faceCount: number;
}

export interface GodotCSGRuntimeCarrier {
  rebuild(owner: GodotCSGShape3D): GodotCSGMeshResult | null;
  configureCollision(owner: GodotCSGShape3D): void;
  clear?(owner: GodotCSGShape3D): void;
}

function finite(member: string, value: number, minimum = -Infinity, maximum = Infinity): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${member} requires a finite value in [${minimum}, ${maximum}].`);
  }
  return value;
}

function integer(member: string, value: number, minimum = 0): number {
  if (!Number.isInteger(value) || value < minimum) throw new RangeError(`${member} requires an integer >= ${minimum}.`);
  return value;
}

function enumeration(member: string, value: number, values: readonly number[]): number {
  if (!values.includes(value)) throw new RangeError(`${member} received an unsupported enum value.`);
  return value;
}

function color(member: string, value: Color): Color {
  if (!(value instanceof Color) || !Number.isFinite(value.r) || !Number.isFinite(value.g) || !Number.isFinite(value.b)) {
    throw new TypeError(`${member} requires Color.`);
  }
  return value.clone();
}

function vector2(member: string, value: Vector2, minimum = -Infinity): Vector2 {
  if (!(value instanceof Vector2) || !Number.isFinite(value.x) || !Number.isFinite(value.y) || value.x < minimum || value.y < minimum) {
    throw new TypeError(`${member} requires a finite Vector2 with components >= ${minimum}.`);
  }
  return value.clone();
}

export class GodotCSGShape3D extends Object3D {
  private operationValue: number = GodotCSGOperation.UNION;
  private calculateTangentsValue = true;
  private useCollisionValue = false;
  private collisionLayerValue = 1;
  private collisionMaskValue = 1;
  private collisionPriorityValue = 1;
  private collisionMaterialValue: unknown = null;
  private dirtyValue = true;
  private lastResult: GodotCSGMeshResult | null = null;
  private runtime: GodotCSGRuntimeCarrier | null = null;

  constructor(godotClass = 'CSGShape3D') {
    super();
    registerGodotObjectIdentity(this, godotClass);
  }

  bind_runtime(value: GodotCSGRuntimeCarrier | null): void {
    this.runtime?.clear?.(this);
    this.runtime = value;
    this.mark_dirty();
    this.reconfigureCollision();
  }
  get_runtime(): GodotCSGRuntimeCarrier | null { return this.runtime; }
  set_operation(value: number): void { this.operationValue = enumeration('CSGShape3D.operation', value, [0, 1, 2]); this.mark_dirty(); }
  get_operation(): number { return this.operationValue; }
  set_calculate_tangents(value: boolean): void { this.calculateTangentsValue = value; this.mark_dirty(); }
  is_calculating_tangents(): boolean { return this.calculateTangentsValue; }
  set_use_collision(value: boolean): void { this.useCollisionValue = value; this.reconfigureCollision(); }
  is_using_collision(): boolean { return this.useCollisionValue; }
  set_collision_layer(value: number): void { this.collisionLayerValue = this.mask('CSGShape3D.collision_layer', value); this.reconfigureCollision(); }
  get_collision_layer(): number { return this.collisionLayerValue; }
  set_collision_layer_value(layer: number, enabled: boolean): void { this.collisionLayerValue = this.maskBit(this.collisionLayerValue, layer, enabled); this.reconfigureCollision(); }
  get_collision_layer_value(layer: number): boolean { return this.hasMaskBit(this.collisionLayerValue, layer); }
  set_collision_mask(value: number): void { this.collisionMaskValue = this.mask('CSGShape3D.collision_mask', value); this.reconfigureCollision(); }
  get_collision_mask(): number { return this.collisionMaskValue; }
  set_collision_mask_value(layer: number, enabled: boolean): void { this.collisionMaskValue = this.maskBit(this.collisionMaskValue, layer, enabled); this.reconfigureCollision(); }
  get_collision_mask_value(layer: number): boolean { return this.hasMaskBit(this.collisionMaskValue, layer); }
  set_collision_priority(value: number): void { this.collisionPriorityValue = finite('CSGShape3D.collision_priority', value, 0); this.reconfigureCollision(); }
  get_collision_priority(): number { return this.collisionPriorityValue; }
  set_collision_material(value: unknown): void { this.collisionMaterialValue = value; this.reconfigureCollision(); }
  get_collision_material(): unknown { return this.collisionMaterialValue; }
  is_root_shape(): boolean { return !(this.parent instanceof GodotCSGShape3D); }
  get_meshes(): unknown[] { return this.lastResult === null ? [] : [this.lastResult.mesh]; }
  get_mesh_result(): GodotCSGMeshResult | null { return this.lastResult; }
  is_dirty(): boolean { return this.dirtyValue; }
  update_shape(): GodotCSGMeshResult | null {
    if (!this.dirtyValue) return this.lastResult;
    this.lastResult = this.runtime?.rebuild(this) ?? null;
    this.dirtyValue = false;
    return this.lastResult;
  }
  mark_dirty(): void {
    this.dirtyValue = true;
    this.lastResult = null;
    const parent = this.parent;
    if (parent instanceof GodotCSGShape3D) parent.mark_dirty();
  }

  private reconfigureCollision(): void { this.runtime?.configureCollision(this); }
  private mask(member: string, value: number): number {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError(`${member} requires unsigned 32-bit mask.`);
    return value >>> 0;
  }
  private maskBit(current: number, layer: number, enabled: boolean): number {
    if (!Number.isInteger(layer) || layer < 1 || layer > 32) throw new RangeError('CSGShape3D layer number requires [1, 32].');
    const bit = 2 ** (layer - 1);
    return enabled ? (current | bit) >>> 0 : (current & ~bit) >>> 0;
  }
  private hasMaskBit(current: number, layer: number): boolean {
    if (!Number.isInteger(layer) || layer < 1 || layer > 32) throw new RangeError('CSGShape3D layer number requires [1, 32].');
    return (current & 2 ** (layer - 1)) !== 0;
  }
}

export class GodotCSGCombiner3D extends GodotCSGShape3D {
  constructor() { super('CSGCombiner3D'); }
}

export class GodotCSGPrimitive3D extends GodotCSGShape3D {
  private materialValue: unknown = null;
  private flipFacesValue = false;
  private smoothFacesValue = true;

  constructor(godotClass: string) { super(godotClass); }
  set_material(value: unknown): void { this.materialValue = value; this.mark_dirty(); }
  get_material(): unknown { return this.materialValue; }
  set_flip_faces(value: boolean): void { this.flipFacesValue = value; this.mark_dirty(); }
  get_flip_faces(): boolean { return this.flipFacesValue; }
  set_smooth_faces(value: boolean): void { this.smoothFacesValue = value; this.mark_dirty(); }
  get_smooth_faces(): boolean { return this.smoothFacesValue; }
}

export class GodotCSGBox3D extends GodotCSGPrimitive3D {
  private sizeValue = new Vector2(2, 2);
  private depthValue = 2;
  constructor() { super('CSGBox3D'); }
  set_size(value: { x: number; y: number; z: number }): void {
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z) || value.x <= 0 || value.y <= 0 || value.z <= 0) {
      throw new RangeError('CSGBox3D.size requires positive finite Vector3.');
    }
    this.sizeValue.set(value.x, value.y); this.depthValue = value.z; this.mark_dirty();
  }
  get_size(): { x: number; y: number; z: number } { return { x: this.sizeValue.x, y: this.sizeValue.y, z: this.depthValue }; }
  set_width(value: number): void { this.sizeValue.x = finite('CSGBox3D.width', value, Number.EPSILON); this.mark_dirty(); }
  get_width(): number { return this.sizeValue.x; }
  set_height(value: number): void { this.sizeValue.y = finite('CSGBox3D.height', value, Number.EPSILON); this.mark_dirty(); }
  get_height(): number { return this.sizeValue.y; }
  set_depth(value: number): void { this.depthValue = finite('CSGBox3D.depth', value, Number.EPSILON); this.mark_dirty(); }
  get_depth(): number { return this.depthValue; }
}

export class GodotCSGSphere3D extends GodotCSGPrimitive3D {
  private radiusValue = 1;
  private radialSegmentsValue = 12;
  private ringsValue = 6;
  constructor() { super('CSGSphere3D'); }
  set_radius(value: number): void { this.radiusValue = finite('CSGSphere3D.radius', value, Number.EPSILON); this.mark_dirty(); }
  get_radius(): number { return this.radiusValue; }
  set_radial_segments(value: number): void { this.radialSegmentsValue = integer('CSGSphere3D.radial_segments', value, 4); this.mark_dirty(); }
  get_radial_segments(): number { return this.radialSegmentsValue; }
  set_rings(value: number): void { this.ringsValue = integer('CSGSphere3D.rings', value, 2); this.mark_dirty(); }
  get_rings(): number { return this.ringsValue; }
}

export class GodotCSGCylinder3D extends GodotCSGPrimitive3D {
  private radiusValue = 1;
  private heightValue = 2;
  private sidesValue = 8;
  private coneValue = false;
  constructor() { super('CSGCylinder3D'); }
  set_radius(value: number): void { this.radiusValue = finite('CSGCylinder3D.radius', value, Number.EPSILON); this.mark_dirty(); }
  get_radius(): number { return this.radiusValue; }
  set_height(value: number): void { this.heightValue = finite('CSGCylinder3D.height', value, Number.EPSILON); this.mark_dirty(); }
  get_height(): number { return this.heightValue; }
  set_sides(value: number): void { this.sidesValue = integer('CSGCylinder3D.sides', value, 3); this.mark_dirty(); }
  get_sides(): number { return this.sidesValue; }
  set_cone(value: boolean): void { this.coneValue = value; this.mark_dirty(); }
  is_cone(): boolean { return this.coneValue; }
}

export class GodotCSGTorus3D extends GodotCSGPrimitive3D {
  private innerRadiusValue = 0.5;
  private outerRadiusValue = 1;
  private sidesValue = 6;
  private ringSidesValue = 8;
  constructor() { super('CSGTorus3D'); }
  set_inner_radius(value: number): void { this.innerRadiusValue = finite('CSGTorus3D.inner_radius', value, 0); this.assertRadii(); this.mark_dirty(); }
  get_inner_radius(): number { return this.innerRadiusValue; }
  set_outer_radius(value: number): void { this.outerRadiusValue = finite('CSGTorus3D.outer_radius', value, Number.EPSILON); this.assertRadii(); this.mark_dirty(); }
  get_outer_radius(): number { return this.outerRadiusValue; }
  set_sides(value: number): void { this.sidesValue = integer('CSGTorus3D.sides', value, 3); this.mark_dirty(); }
  get_sides(): number { return this.sidesValue; }
  set_ring_sides(value: number): void { this.ringSidesValue = integer('CSGTorus3D.ring_sides', value, 3); this.mark_dirty(); }
  get_ring_sides(): number { return this.ringSidesValue; }
  private assertRadii(): void {
    if (this.innerRadiusValue >= this.outerRadiusValue) throw new RangeError('CSGTorus3D.inner_radius must be smaller than outer_radius.');
  }
}

export class GodotCSGMesh3D extends GodotCSGPrimitive3D {
  private meshValue: unknown = null;
  constructor() { super('CSGMesh3D'); }
  set_mesh(value: unknown): void { this.meshValue = value; this.mark_dirty(); }
  get_mesh(): unknown { return this.meshValue; }
}

export class GodotCSGPolygon3D extends GodotCSGPrimitive3D {
  private polygonValue: Vector2[] = [];
  private modeValue: number = GodotCSGPolygonMode.DEPTH;
  private depthValue = 1;
  private spinDegreesValue = 360;
  private spinSidesValue = 8;
  private pathNodeValue = '';
  private pathIntervalTypeValue: number = GodotCSGPathIntervalType.DISTANCE;
  private pathIntervalValue = 1;
  private pathSimplifyAngleValue = 0;
  private pathRotationValue: number = GodotCSGPathRotation.PATH;
  private pathLocalValue = false;
  private pathContinuousUValue = true;
  private pathUDistanceValue = 1;
  private joinValue = false;
  private polygonSmoothFacesValue = false;
  private polygonMaterialValue: unknown = null;
  private colorValue = new Color(1, 1, 1);

  constructor() { super('CSGPolygon3D'); }
  set_polygon(value: readonly Vector2[]): void {
    if (!Array.isArray(value) || value.length < 3) throw new RangeError('CSGPolygon3D.polygon requires at least three points.');
    this.polygonValue = value.map((point) => vector2('CSGPolygon3D.polygon point', point)); this.mark_dirty();
  }
  get_polygon(): Vector2[] { return this.polygonValue.map((point) => point.clone()); }
  set_mode(value: number): void { this.modeValue = enumeration('CSGPolygon3D.mode', value, [0, 1, 2]); this.mark_dirty(); }
  get_mode(): number { return this.modeValue; }
  set_depth(value: number): void { this.depthValue = finite('CSGPolygon3D.depth', value, Number.EPSILON); this.mark_dirty(); }
  get_depth(): number { return this.depthValue; }
  set_spin_degrees(value: number): void { this.spinDegreesValue = finite('CSGPolygon3D.spin_degrees', value, 0, 360); this.mark_dirty(); }
  get_spin_degrees(): number { return this.spinDegreesValue; }
  set_spin_sides(value: number): void { this.spinSidesValue = integer('CSGPolygon3D.spin_sides', value, 3); this.mark_dirty(); }
  get_spin_sides(): number { return this.spinSidesValue; }
  set_path_node(value: string): void { if (typeof value !== 'string') throw new TypeError('CSGPolygon3D.path_node requires NodePath.'); this.pathNodeValue = value; this.mark_dirty(); }
  get_path_node(): string { return this.pathNodeValue; }
  set_path_interval_type(value: number): void { this.pathIntervalTypeValue = enumeration('CSGPolygon3D.path_interval_type', value, [0, 1]); this.mark_dirty(); }
  get_path_interval_type(): number { return this.pathIntervalTypeValue; }
  set_path_interval(value: number): void { this.pathIntervalValue = finite('CSGPolygon3D.path_interval', value, Number.EPSILON); this.mark_dirty(); }
  get_path_interval(): number { return this.pathIntervalValue; }
  set_path_simplify_angle(value: number): void { this.pathSimplifyAngleValue = finite('CSGPolygon3D.path_simplify_angle', value, 0, 180); this.mark_dirty(); }
  get_path_simplify_angle(): number { return this.pathSimplifyAngleValue; }
  set_path_rotation(value: number): void { this.pathRotationValue = enumeration('CSGPolygon3D.path_rotation', value, [0, 1, 2]); this.mark_dirty(); }
  get_path_rotation(): number { return this.pathRotationValue; }
  set_path_local(value: boolean): void { this.pathLocalValue = value; this.mark_dirty(); }
  is_path_local(): boolean { return this.pathLocalValue; }
  set_path_continuous_u(value: boolean): void { this.pathContinuousUValue = value; this.mark_dirty(); }
  is_path_continuous_u(): boolean { return this.pathContinuousUValue; }
  set_path_u_distance(value: number): void { this.pathUDistanceValue = finite('CSGPolygon3D.path_u_distance', value, Number.EPSILON); this.mark_dirty(); }
  get_path_u_distance(): number { return this.pathUDistanceValue; }
  set_joined(value: boolean): void { this.joinValue = value; this.mark_dirty(); }
  is_joined(): boolean { return this.joinValue; }
  override set_smooth_faces(value: boolean): void { this.polygonSmoothFacesValue = value; super.set_smooth_faces(value); }
  override get_smooth_faces(): boolean { return this.polygonSmoothFacesValue; }
  override set_material(value: unknown): void { this.polygonMaterialValue = value; super.set_material(value); }
  override get_material(): unknown { return this.polygonMaterialValue; }
  set_color(value: Color): void { this.colorValue = color('CSGPolygon3D.color', value); this.mark_dirty(); }
  get_color(): Color { return this.colorValue.clone(); }
}

export const createGodotCSGCombiner3D = (): GodotCSGCombiner3D => new GodotCSGCombiner3D();
export const createGodotCSGBox3D = (): GodotCSGBox3D => new GodotCSGBox3D();
export const createGodotCSGSphere3D = (): GodotCSGSphere3D => new GodotCSGSphere3D();
export const createGodotCSGCylinder3D = (): GodotCSGCylinder3D => new GodotCSGCylinder3D();
export const createGodotCSGTorus3D = (): GodotCSGTorus3D => new GodotCSGTorus3D();
export const createGodotCSGMesh3D = (): GodotCSGMesh3D => new GodotCSGMesh3D();
export const createGodotCSGPolygon3D = (): GodotCSGPolygon3D => new GodotCSGPolygon3D();
