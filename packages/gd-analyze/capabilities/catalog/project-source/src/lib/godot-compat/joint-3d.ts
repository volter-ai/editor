/** Godot Joint3D nodes over Rapier native impulse joints. */
import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3, type Object3D } from 'three';

export type GodotJoint3D = Object3D & {
  readonly nativeJoint: RAPIER.ImpulseJoint;
  excludeNodesFromCollision: boolean;
  set_exclude_nodes_from_collision(value: boolean): void;
  get_exclude_nodes_from_collision(): boolean;
};

export type GodotHingeJoint3D = GodotJoint3D & {
  limitEnabled: boolean;
  limitLower: number;
  limitUpper: number;
};

export type GodotSliderJoint3D = GodotJoint3D & {
  linearLimitLower: number;
  linearLimitUpper: number;
};

export interface Joint3DBaseOptions {
  readonly world: RAPIER.World;
  readonly node: Object3D;
  readonly bodyA: RAPIER.RigidBody;
  readonly bodyB: RAPIER.RigidBody;
  readonly excludeNodesFromCollision?: boolean;
}

export interface HingeJoint3DOptions extends Joint3DBaseOptions {
  readonly limitEnabled?: boolean;
  readonly limitLower?: number;
  readonly limitUpper?: number;
  readonly motorEnabled?: boolean;
  readonly motorTargetVelocity?: number;
  readonly motorMaxImpulse?: number;
}

export interface SliderJoint3DOptions extends Joint3DBaseOptions {
  readonly linearLimitLower?: number;
  readonly linearLimitUpper?: number;
}

export interface Generic6DofJoint3DOptions extends Joint3DBaseOptions {
  readonly freeAxes: number;
  readonly hasLimitsOrMotors?: boolean;
}

interface JointOwner { readonly world: RAPIER.World; readonly joint: RAPIER.ImpulseJoint }
const JOINTS = new WeakMap<Object3D, JointOwner>();
const HINGES = new WeakMap<Object3D, GodotHingeJoint3D>();
const SLIDERS = new WeakMap<Object3D, GodotSliderJoint3D>();

function frame(options: Joint3DBaseOptions): {
  anchorA: Vector3;
  anchorB: Vector3;
  axisA: Vector3;
  axisB: Vector3;
  worldAxis: Vector3;
} {
  options.node.updateWorldMatrix(true, false);
  const jointPosition = new Vector3();
  const jointRotation = new Quaternion();
  const jointScale = new Vector3();
  options.node.matrixWorld.decompose(jointPosition, jointRotation, jointScale);
  if (![jointScale.x, jointScale.y, jointScale.z].every((one) => Math.abs(one - 1) <= 1e-7)) {
    throw new Error('Joint3D refuses scaled joint transforms');
  }
  const bodyFrame = (body: RAPIER.RigidBody): { position: Vector3; rotation: Quaternion } => {
    const p = body.translation();
    const r = body.rotation();
    return {
      position: new Vector3(p.x, p.y, p.z),
      rotation: new Quaternion(r.x, r.y, r.z, r.w),
    };
  };
  const a = bodyFrame(options.bodyA);
  const b = bodyFrame(options.bodyB);
  const local = (body: { position: Vector3; rotation: Quaternion }): Vector3 =>
    jointPosition.clone().sub(body.position).applyQuaternion(body.rotation.clone().invert());
  const worldAxis = new Vector3(1, 0, 0).applyQuaternion(jointRotation).normalize();
  return {
    anchorA: local(a),
    anchorB: local(b),
    axisA: worldAxis.clone().applyQuaternion(a.rotation.clone().invert()).normalize(),
    axisB: worldAxis.clone().applyQuaternion(b.rotation.clone().invert()).normalize(),
    worldAxis,
  };
}

/** Rapier 0.14's one-axis descriptors apply one local numeric axis to both bodies. */
function sharedAxis(f: ReturnType<typeof frame>, bodyB: RAPIER.RigidBody, member: string): Vector3 {
  const rotation = bodyB.rotation();
  const reconstructed = f.axisA.clone().applyQuaternion(
    new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
  );
  if (reconstructed.angleTo(f.worldAxis) > 1e-5) {
    throw new Error(
      `${member} refuses body frames whose native Rapier joint axis cannot represent both local axes`,
    );
  }
  return f.axisA;
}

function bind(options: Joint3DBaseOptions, joint: RAPIER.ImpulseJoint): GodotJoint3D {
  joint.setContactsEnabled(!(options.excludeNodesFromCollision ?? true));
  Object.defineProperty(options.node, 'nativeJoint', {
    configurable: true,
    enumerable: false,
    value: joint,
  });
  JOINTS.set(options.node, { world: options.world, joint });
  return options.node as GodotJoint3D;
}

function finite(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${member} requires a finite float.`);
  return value;
}

function attachBaseSurface(
  options: Joint3DBaseOptions,
  initialExcludeNodesFromCollision: boolean,
): GodotJoint3D {
  let excludeNodesFromCollision = initialExcludeNodesFromCollision;
  const surface = {
    get excludeNodesFromCollision() { return excludeNodesFromCollision; },
    set excludeNodesFromCollision(value: boolean) {
      const next = Boolean(value);
      if (next === excludeNodesFromCollision) return;
      excludeNodesFromCollision = next;
      const owner = JOINTS.get(options.node);
      if (owner === undefined || !owner.joint.isValid()) {
        throw new Error('Joint3D.exclude_nodes_from_collision requires a live native Rapier joint.');
      }
      owner.joint.setContactsEnabled(!next);
    },
    set_exclude_nodes_from_collision(value: boolean): void {
      surface.excludeNodesFromCollision = value;
    },
    get_exclude_nodes_from_collision(): boolean {
      return surface.excludeNodesFromCollision;
    },
  };
  Object.defineProperties(options.node, Object.getOwnPropertyDescriptors(surface));
  return options.node as GodotJoint3D;
}

function create(options: Joint3DBaseOptions, data: RAPIER.JointData): GodotJoint3D {
  removeNativeJoint3D(options.node);
  return bind(
    options,
    options.world.createImpulseJoint(data, options.bodyA, options.bodyB, true),
  );
}

function removeNativeJoint3D(node: Object3D): void {
  const owner = JOINTS.get(node);
  if (owner === undefined) return;
  if (owner.joint.isValid()) owner.world.removeImpulseJoint(owner.joint, true);
  JOINTS.delete(node);
  Reflect.deleteProperty(node, 'nativeJoint');
}

export function destroyJoint3D(node: Object3D): void {
  removeNativeJoint3D(node);
  HINGES.delete(node);
  SLIDERS.delete(node);
}

export function createPinJoint3D(options: Joint3DBaseOptions): GodotJoint3D {
  const f = frame(options);
  create(options, RAPIER.JointData.spherical(f.anchorA, f.anchorB));
  return attachBaseSurface(options, options.excludeNodesFromCollision ?? true);
}

export function createHingeJoint3D(options: HingeJoint3DOptions): GodotHingeJoint3D {
  let limitEnabled = options.limitEnabled ?? false;
  let limitLower = finite(options.limitLower ?? -Math.PI / 2, 'HingeJoint3D.limit_lower');
  let limitUpper = finite(options.limitUpper ?? Math.PI / 2, 'HingeJoint3D.limit_upper');
  if (options.motorEnabled === true) {
    throw new Error(
      'HingeJoint3D motor_enabled=true refuses because Rapier exposes no Godot motor_max_impulse limit',
    );
  }
  const rebuild = (): void => {
    const f = frame(options);
    const data = RAPIER.JointData.revolute(
      f.anchorA,
      f.anchorB,
      sharedAxis(f, options.bodyB, 'HingeJoint3D'),
    );
    if (limitEnabled) {
      data.limitsEnabled = true;
      data.limits = [limitLower, limitUpper];
    }
    const excludeNodesFromCollision = JOINTS.has(options.node)
      ? (options.node as GodotJoint3D).excludeNodesFromCollision
      : options.excludeNodesFromCollision ?? true;
    create({ ...options, excludeNodesFromCollision }, data);
  };
  rebuild();
  const base = attachBaseSurface(options, options.excludeNodesFromCollision ?? true);
  const surface = {
    get limitEnabled() { return limitEnabled; },
    set limitEnabled(value: boolean) {
      const next = Boolean(value);
      if (next === limitEnabled) return;
      limitEnabled = next;
      rebuild();
    },
    get limitLower() { return limitLower; },
    set limitLower(value: number) {
      const next = finite(value, 'HingeJoint3D.limit_lower');
      if (next === limitLower) return;
      limitLower = next;
      if (limitEnabled) {
        const joint = JOINTS.get(options.node)?.joint as RAPIER.RevoluteImpulseJoint | undefined;
        if (joint === undefined || !joint.isValid()) throw new Error('HingeJoint3D.limit_lower requires a live native Rapier joint.');
        joint.setLimits(limitLower, limitUpper);
      }
    },
    get limitUpper() { return limitUpper; },
    set limitUpper(value: number) {
      const next = finite(value, 'HingeJoint3D.limit_upper');
      if (next === limitUpper) return;
      limitUpper = next;
      if (limitEnabled) {
        const joint = JOINTS.get(options.node)?.joint as RAPIER.RevoluteImpulseJoint | undefined;
        if (joint === undefined || !joint.isValid()) throw new Error('HingeJoint3D.limit_upper requires a live native Rapier joint.');
        joint.setLimits(limitLower, limitUpper);
      }
    },
  };
  Object.defineProperties(base, Object.getOwnPropertyDescriptors(surface));
  const hinge = base as GodotHingeJoint3D;
  HINGES.set(options.node, hinge);
  return hinge;
}

export function createSliderJoint3D(options: SliderJoint3DOptions): GodotSliderJoint3D {
  let linearLimitLower = finite(options.linearLimitLower ?? -1, 'SliderJoint3D.linear_limit_lower');
  let linearLimitUpper = finite(options.linearLimitUpper ?? 1, 'SliderJoint3D.linear_limit_upper');
  const f = frame(options);
  const data = RAPIER.JointData.prismatic(
    f.anchorA,
    f.anchorB,
    sharedAxis(f, options.bodyB, 'SliderJoint3D'),
  );
  data.limitsEnabled = true;
  data.limits = [linearLimitLower, linearLimitUpper];
  create(options, data);
  const base = attachBaseSurface(options, options.excludeNodesFromCollision ?? true);
  const surface = {
    get linearLimitLower() { return linearLimitLower; },
    set linearLimitLower(value: number) {
      const next = finite(value, 'SliderJoint3D.linear_limit_lower');
      if (next === linearLimitLower) return;
      linearLimitLower = next;
      const joint = JOINTS.get(options.node)?.joint as RAPIER.PrismaticImpulseJoint | undefined;
      if (joint === undefined || !joint.isValid()) throw new Error('SliderJoint3D.linear_limit_lower requires a live native Rapier joint.');
      joint.setLimits(linearLimitLower, linearLimitUpper);
    },
    get linearLimitUpper() { return linearLimitUpper; },
    set linearLimitUpper(value: number) {
      const next = finite(value, 'SliderJoint3D.linear_limit_upper');
      if (next === linearLimitUpper) return;
      linearLimitUpper = next;
      const joint = JOINTS.get(options.node)?.joint as RAPIER.PrismaticImpulseJoint | undefined;
      if (joint === undefined || !joint.isValid()) throw new Error('SliderJoint3D.linear_limit_upper requires a live native Rapier joint.');
      joint.setLimits(linearLimitLower, linearLimitUpper);
    },
  };
  Object.defineProperties(base, Object.getOwnPropertyDescriptors(surface));
  const slider = base as GodotSliderJoint3D;
  SLIDERS.set(options.node, slider);
  return slider;
}

export function createConeTwistJoint3D(options: Joint3DBaseOptions & {
  readonly swingSpan?: number;
  readonly twistSpan?: number;
}): GodotJoint3D {
  if ((options.swingSpan ?? Math.PI / 4) < Math.PI || (options.twistSpan ?? Math.PI) < Math.PI) {
    throw new Error('ConeTwistJoint3D angular cone/twist limits have no Rapier spherical-joint counterpart');
  }
  return createPinJoint3D(options);
}

export function createGeneric6DofJoint3D(options: Generic6DofJoint3DOptions): GodotJoint3D {
  if (options.hasLimitsOrMotors === true) {
    throw new Error('Generic6DOFJoint3D per-axis limits, motors, and springs are not exposed by Rapier generic joints');
  }
  const f = frame(options);
  const rotationA = options.bodyA.rotation();
  const rotationB = options.bodyB.rotation();
  if (new Quaternion(rotationA.x, rotationA.y, rotationA.z, rotationA.w).angleTo(
    new Quaternion(rotationB.x, rotationB.y, rotationB.z, rotationB.w),
  ) > 1e-5) {
    throw new Error(
      'Generic6DOFJoint3D refuses rotated body frames because Rapier exposes one shared local joint frame',
    );
  }
  const allAxes = RAPIER.JointAxesMask.LinX
    | RAPIER.JointAxesMask.LinY
    | RAPIER.JointAxesMask.LinZ
    | RAPIER.JointAxesMask.AngX
    | RAPIER.JointAxesMask.AngY
    | RAPIER.JointAxesMask.AngZ;
  const lockedAxes = allAxes & ~options.freeAxes;
  create(
    options,
    RAPIER.JointData.generic(f.anchorA, f.anchorB, f.axisA, lockedAxes),
  );
  return attachBaseSurface(options, options.excludeNodesFromCollision ?? true);
}

function liveJoint(node: Object3D, member: string): GodotJoint3D {
  const owner = JOINTS.get(node);
  if (owner === undefined || !owner.joint.isValid()) {
    throw new Error(`${member} requires a live native Rapier Joint3D.`);
  }
  return node as GodotJoint3D;
}

function liveHinge(node: Object3D, member: string): GodotHingeJoint3D {
  liveJoint(node, member);
  const hinge = HINGES.get(node);
  if (hinge === undefined) throw new TypeError(`${member} requires HingeJoint3D.`);
  return hinge;
}

function liveSlider(node: Object3D, member: string): GodotSliderJoint3D {
  liveJoint(node, member);
  const slider = SLIDERS.get(node);
  if (slider === undefined) throw new TypeError(`${member} requires SliderJoint3D.`);
  return slider;
}

export function getJoint3DExcludeNodesFromCollision(node: Object3D): boolean {
  return liveJoint(node, 'Joint3D.get_exclude_nodes_from_collision').excludeNodesFromCollision;
}

export function setJoint3DExcludeNodesFromCollision(node: Object3D, value: boolean): void {
  liveJoint(node, 'Joint3D.set_exclude_nodes_from_collision').excludeNodesFromCollision = value;
}

export function getHingeJoint3DLimitEnabled(node: Object3D): boolean {
  return liveHinge(node, 'HingeJoint3D.get_flag').limitEnabled;
}

export function setHingeJoint3DLimitEnabled(node: Object3D, value: boolean): void {
  liveHinge(node, 'HingeJoint3D.set_flag').limitEnabled = value;
}

export function getHingeJoint3DLimitLower(node: Object3D): number {
  return liveHinge(node, 'HingeJoint3D.get_param').limitLower;
}

export function setHingeJoint3DLimitLower(node: Object3D, value: number): void {
  liveHinge(node, 'HingeJoint3D.set_param').limitLower = value;
}

export function getHingeJoint3DLimitUpper(node: Object3D): number {
  return liveHinge(node, 'HingeJoint3D.get_param').limitUpper;
}

export function setHingeJoint3DLimitUpper(node: Object3D, value: number): void {
  liveHinge(node, 'HingeJoint3D.set_param').limitUpper = value;
}

export function getSliderJoint3DLinearLimitLower(node: Object3D): number {
  return liveSlider(node, 'SliderJoint3D.get_param').linearLimitLower;
}

export function setSliderJoint3DLinearLimitLower(node: Object3D, value: number): void {
  liveSlider(node, 'SliderJoint3D.set_param').linearLimitLower = value;
}

export function getSliderJoint3DLinearLimitUpper(node: Object3D): number {
  return liveSlider(node, 'SliderJoint3D.get_param').linearLimitUpper;
}

export function setSliderJoint3DLinearLimitUpper(node: Object3D, value: number): void {
  liveSlider(node, 'SliderJoint3D.set_param').linearLimitUpper = value;
}

/**
 * Mechanical generic method routes stay deliberately uncredited: only the native Rapier-backed
 * enum values below are accepted, while Godot softness/bias/motor values remain loud.
 */
export function hingeJoint3DSetParam(node: Object3D, param: number, value: number): void {
  switch (param) {
    case 1: setHingeJoint3DLimitUpper(node, value); return;
    case 2: setHingeJoint3DLimitLower(node, value); return;
    default:
      throw new Error(`HingeJoint3D.set_param(${param}) has no exact native Rapier consumer.`);
  }
}

export function hingeJoint3DGetParam(node: Object3D, param: number): number {
  switch (param) {
    case 1: return getHingeJoint3DLimitUpper(node);
    case 2: return getHingeJoint3DLimitLower(node);
    default:
      throw new Error(`HingeJoint3D.get_param(${param}) has no exact native Rapier consumer.`);
  }
}

export function hingeJoint3DSetFlag(node: Object3D, flag: number, enabled: boolean): void {
  if (flag === 0) { setHingeJoint3DLimitEnabled(node, enabled); return; }
  if (flag === 1 && !enabled) return;
  throw new Error(`HingeJoint3D.set_flag(${flag}) has no exact native Rapier consumer.`);
}

export function hingeJoint3DGetFlag(node: Object3D, flag: number): boolean {
  if (flag === 0) return getHingeJoint3DLimitEnabled(node);
  if (flag === 1) return false;
  throw new RangeError(`HingeJoint3D.get_flag received unknown Flag ${flag}.`);
}

export function sliderJoint3DSetParam(node: Object3D, param: number, value: number): void {
  switch (param) {
    case 0: setSliderJoint3DLinearLimitUpper(node, value); return;
    case 1: setSliderJoint3DLinearLimitLower(node, value); return;
    default:
      throw new Error(`SliderJoint3D.set_param(${param}) has no exact native Rapier consumer.`);
  }
}

export function sliderJoint3DGetParam(node: Object3D, param: number): number {
  switch (param) {
    case 0: return getSliderJoint3DLinearLimitUpper(node);
    case 1: return getSliderJoint3DLinearLimitLower(node);
    default:
      throw new Error(`SliderJoint3D.get_param(${param}) has no exact native Rapier consumer.`);
  }
}
