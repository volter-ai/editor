export const GODOT_GLTF_OBJECT_MODEL_TYPE_UNKNOWN = 0;
export const GODOT_GLTF_OBJECT_MODEL_TYPE_BOOL = 1;
export const GODOT_GLTF_OBJECT_MODEL_TYPE_FLOAT = 2;
export const GODOT_GLTF_OBJECT_MODEL_TYPE_FLOAT_ARRAY = 3;
export const GODOT_GLTF_OBJECT_MODEL_TYPE_FLOAT2 = 4;
export const GODOT_GLTF_OBJECT_MODEL_TYPE_FLOAT3 = 5;
export const GODOT_GLTF_OBJECT_MODEL_TYPE_FLOAT4 = 6;
export const GODOT_GLTF_OBJECT_MODEL_TYPE_FLOAT2X2 = 7;
export const GODOT_GLTF_OBJECT_MODEL_TYPE_FLOAT3X3 = 8;
export const GODOT_GLTF_OBJECT_MODEL_TYPE_FLOAT4X4 = 9;
export const GODOT_GLTF_OBJECT_MODEL_TYPE_INT = 10;

export class GodotGLTFObjectModelProperty {
  private gltfToGodotExpression: unknown = null;
  private godotToGLTFExpression: unknown = null;
  private nodePaths: unknown[] = [];
  private objectModelType = GODOT_GLTF_OBJECT_MODEL_TYPE_UNKNOWN;
  private jsonPointers: string[] = [];
  private variantType = 0;

  append_node_path(nodePath: unknown): void { this.nodePaths.push(nodePath); }
  append_path_to_property(nodePath: string, propertyName: string): void { this.nodePaths.push(`${nodePath}:${propertyName}`); }
  get_accessor_type(): string {
    return ['SCALAR', 'SCALAR', 'SCALAR', 'SCALAR', 'VEC2', 'VEC3', 'VEC4', 'MAT2', 'MAT3', 'MAT4', 'SCALAR'][this.objectModelType] ?? '';
  }
  get_gltf_to_godot_expression(): unknown { return this.gltfToGodotExpression; }
  set_gltf_to_godot_expression(expression: unknown): void { this.gltfToGodotExpression = expression; }
  get_godot_to_gltf_expression(): unknown { return this.godotToGLTFExpression; }
  set_godot_to_gltf_expression(expression: unknown): void { this.godotToGLTFExpression = expression; }
  get_node_paths(): unknown[] { return this.nodePaths; }
  has_node_paths(): boolean { return this.nodePaths.length > 0; }
  set_node_paths(paths: unknown[]): void { this.nodePaths = paths; }
  get_object_model_type(): number { return this.objectModelType; }
  set_object_model_type(type: number): void { this.objectModelType = type; }
  get_json_pointers(): string[] { return this.jsonPointers; }
  has_json_pointers(): boolean { return this.jsonPointers.length > 0; }
  set_json_pointers(pointers: string[]): void { this.jsonPointers = pointers; }
  get_variant_type(): number { return this.variantType; }
  set_variant_type(type: number): void { this.variantType = type; }
  set_types(variantType: number, objectModelType: number): void { this.variantType = variantType; this.objectModelType = objectModelType; }
}

export class GodotGLTFPhysicsBody {
  private bodyType = 'static';
  private mass = 1;
  private linearVelocity = { x: 0, y: 0, z: 0 };
  private angularVelocity = { x: 0, y: 0, z: 0 };
  private centerOfMass = { x: 0, y: 0, z: 0 };
  private inertiaDiagonal = { x: 0, y: 0, z: 0 };
  private inertiaOrientation = { x: 0, y: 0, z: 0, w: 1 };
  private inertiaTensor: unknown = null;

  static from_node(bodyNode: Readonly<Record<string, unknown>>): GodotGLTFPhysicsBody {
    return GodotGLTFPhysicsBody.from_dictionary(bodyNode);
  }
  to_node(): Readonly<Record<string, unknown>> { return this.to_dictionary(); }
  static from_dictionary(dictionary: Readonly<Record<string, unknown>>): GodotGLTFPhysicsBody {
    const body = new GodotGLTFPhysicsBody();
    if (typeof dictionary['body_type'] === 'string') body.set_body_type(dictionary['body_type']);
    if (typeof dictionary['mass'] === 'number') body.set_mass(dictionary['mass']);
    if (dictionary['linear_velocity'] !== undefined) body.set_linear_velocity(dictionary['linear_velocity']);
    if (dictionary['angular_velocity'] !== undefined) body.set_angular_velocity(dictionary['angular_velocity']);
    if (dictionary['center_of_mass'] !== undefined) body.set_center_of_mass(dictionary['center_of_mass']);
    if (dictionary['inertia_diagonal'] !== undefined) body.set_inertia_diagonal(dictionary['inertia_diagonal']);
    if (dictionary['inertia_orientation'] !== undefined) body.set_inertia_orientation(dictionary['inertia_orientation']);
    if (dictionary['inertia_tensor'] !== undefined) body.set_inertia_tensor(dictionary['inertia_tensor']);
    return body;
  }
  to_dictionary(): Readonly<Record<string, unknown>> {
    return { body_type: this.bodyType, mass: this.mass, linear_velocity: this.linearVelocity, angular_velocity: this.angularVelocity, center_of_mass: this.centerOfMass, inertia_diagonal: this.inertiaDiagonal, inertia_orientation: this.inertiaOrientation, inertia_tensor: this.inertiaTensor };
  }
  get_body_type(): string { return this.bodyType; }
  set_body_type(value: string): void { this.bodyType = value; }
  get_mass(): number { return this.mass; }
  set_mass(value: number): void { this.mass = value; }
  get_linear_velocity(): unknown { return this.linearVelocity; }
  set_linear_velocity(value: unknown): void { this.linearVelocity = value as typeof this.linearVelocity; }
  get_angular_velocity(): unknown { return this.angularVelocity; }
  set_angular_velocity(value: unknown): void { this.angularVelocity = value as typeof this.angularVelocity; }
  get_center_of_mass(): unknown { return this.centerOfMass; }
  set_center_of_mass(value: unknown): void { this.centerOfMass = value as typeof this.centerOfMass; }
  get_inertia_diagonal(): unknown { return this.inertiaDiagonal; }
  set_inertia_diagonal(value: unknown): void { this.inertiaDiagonal = value as typeof this.inertiaDiagonal; }
  get_inertia_orientation(): unknown { return this.inertiaOrientation; }
  set_inertia_orientation(value: unknown): void { this.inertiaOrientation = value as typeof this.inertiaOrientation; }
  get_inertia_tensor(): unknown { return this.inertiaTensor; }
  set_inertia_tensor(value: unknown): void { this.inertiaTensor = value; }
}

export class GodotGLTFPhysicsShape {
  private shapeType = 'box';
  private size = { x: 1, y: 1, z: 1 };
  private radius = 0.5;
  private height = 1;
  private trigger = false;
  private meshIndex = -1;
  private importerMesh: unknown = null;

  static from_node(shapeNode: Readonly<Record<string, unknown>>): GodotGLTFPhysicsShape { return GodotGLTFPhysicsShape.from_dictionary(shapeNode); }
  to_node(cacheShapes = false): Readonly<Record<string, unknown>> { return { ...this.to_dictionary(), cache_shapes: cacheShapes }; }
  static from_resource(shapeResource: Readonly<Record<string, unknown>>): GodotGLTFPhysicsShape { return GodotGLTFPhysicsShape.from_dictionary(shapeResource); }
  to_resource(cacheShapes = false): Readonly<Record<string, unknown>> { return { ...this.to_dictionary(), cache_shapes: cacheShapes }; }
  static from_dictionary(dictionary: Readonly<Record<string, unknown>>): GodotGLTFPhysicsShape {
    const shape = new GodotGLTFPhysicsShape();
    if (typeof dictionary['shape_type'] === 'string') shape.set_shape_type(dictionary['shape_type']);
    if (dictionary['size'] !== undefined) shape.set_size(dictionary['size']);
    if (typeof dictionary['radius'] === 'number') shape.set_radius(dictionary['radius']);
    if (typeof dictionary['height'] === 'number') shape.set_height(dictionary['height']);
    if (typeof dictionary['is_trigger'] === 'boolean') shape.set_is_trigger(dictionary['is_trigger']);
    if (typeof dictionary['mesh_index'] === 'number') shape.set_mesh_index(dictionary['mesh_index']);
    if (dictionary['importer_mesh'] !== undefined) shape.set_importer_mesh(dictionary['importer_mesh']);
    return shape;
  }
  to_dictionary(): Readonly<Record<string, unknown>> { return { shape_type: this.shapeType, size: this.size, radius: this.radius, height: this.height, is_trigger: this.trigger, mesh_index: this.meshIndex, importer_mesh: this.importerMesh }; }
  get_shape_type(): string { return this.shapeType; }
  set_shape_type(value: string): void { this.shapeType = value; }
  get_size(): unknown { return this.size; }
  set_size(value: unknown): void { this.size = value as typeof this.size; }
  get_radius(): number { return this.radius; }
  set_radius(value: number): void { this.radius = value; }
  get_height(): number { return this.height; }
  set_height(value: number): void { this.height = value; }
  get_is_trigger(): boolean { return this.trigger; }
  set_is_trigger(value: boolean): void { this.trigger = value; }
  get_mesh_index(): number { return this.meshIndex; }
  set_mesh_index(value: number): void { this.meshIndex = value; }
  get_importer_mesh(): unknown { return this.importerMesh; }
  set_importer_mesh(value: unknown): void { this.importerMesh = value; }
}

export class GodotGLTFSkeleton {
  private joints: number[] = [];
  private roots: number[] = [];
  private godotSkeleton: unknown = null;
  private uniqueNames: string[] = [];
  private godotBoneNode = new Map<number, unknown>();
  private boneAttachments: unknown[] = [];
  get_joints(): number[] { return this.joints; }
  set_joints(value: number[]): void { this.joints = value; }
  get_roots(): number[] { return this.roots; }
  set_roots(value: number[]): void { this.roots = value; }
  get_godot_skeleton(): unknown { return this.godotSkeleton; }
  set_godot_skeleton(value: unknown): void { this.godotSkeleton = value; }
  get_unique_names(): string[] { return this.uniqueNames; }
  set_unique_names(value: string[]): void { this.uniqueNames = value; }
  get_godot_bone_node(): ReadonlyMap<number, unknown> { return this.godotBoneNode; }
  set_godot_bone_node(value: Map<number, unknown>): void { this.godotBoneNode = value; }
  get_bone_attachment_count(): number { return this.boneAttachments.length; }
  get_bone_attachment(index: number): unknown { return this.boneAttachments[index] ?? null; }
  add_bone_attachment(value: unknown): void { this.boneAttachments.push(value); }
}

export class GodotGLTFSkin {
  private skinRoot = -1;
  private jointsOriginal: number[] = [];
  private inverseBinds: unknown[] = [];
  private joints: number[] = [];
  private nonJoints: number[] = [];
  private roots: number[] = [];
  private skeleton = -1;
  private jointIndexToBoneIndex = new Map<number, number>();
  private jointIndexToName = new Map<number, string>();
  private godotSkin: unknown = null;
  get_skin_root(): number { return this.skinRoot; } set_skin_root(value: number): void { this.skinRoot = value; }
  get_joints_original(): number[] { return this.jointsOriginal; } set_joints_original(value: number[]): void { this.jointsOriginal = value; }
  get_inverse_binds(): unknown[] { return this.inverseBinds; } set_inverse_binds(value: unknown[]): void { this.inverseBinds = value; }
  get_joints(): number[] { return this.joints; } set_joints(value: number[]): void { this.joints = value; }
  get_non_joints(): number[] { return this.nonJoints; } set_non_joints(value: number[]): void { this.nonJoints = value; }
  get_roots(): number[] { return this.roots; } set_roots(value: number[]): void { this.roots = value; }
  get_skeleton(): number { return this.skeleton; } set_skeleton(value: number): void { this.skeleton = value; }
  get_joint_i_to_bone_i(): Map<number, number> { return this.jointIndexToBoneIndex; } set_joint_i_to_bone_i(value: Map<number, number>): void { this.jointIndexToBoneIndex = value; }
  get_joint_i_to_name(): Map<number, string> { return this.jointIndexToName; } set_joint_i_to_name(value: Map<number, string>): void { this.jointIndexToName = value; }
  get_godot_skin(): unknown { return this.godotSkin; } set_godot_skin(value: unknown): void { this.godotSkin = value; }
}

export const createGodotGLTFObjectModelProperty = (): GodotGLTFObjectModelProperty => new GodotGLTFObjectModelProperty();
export const createGodotGLTFPhysicsBody = (): GodotGLTFPhysicsBody => new GodotGLTFPhysicsBody();
export const createGodotGLTFPhysicsShape = (): GodotGLTFPhysicsShape => new GodotGLTFPhysicsShape();
export const createGodotGLTFSkeleton = (): GodotGLTFSkeleton => new GodotGLTFSkeleton();
export const createGodotGLTFSkin = (): GodotGLTFSkin => new GodotGLTFSkin();
