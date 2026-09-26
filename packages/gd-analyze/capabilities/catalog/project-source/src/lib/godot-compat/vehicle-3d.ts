/** Godot VehicleBody3D/VehicleWheel3D over Rapier's native ray-cast vehicle controller. */
import RAPIER from '@dimforge/rapier3d-compat';
import { Matrix4, Quaternion, Vector3, type Object3D, type Vector3Like } from 'three';
import { godotCanCollideWith, type CollisionLayers } from './collision-layers';
import { vec3, type Vector3 as GodotVector3 } from './variant-3d';

export type GodotVehicleWheel3D = Object3D & {
  readonly index: number;
  useAsTraction: boolean;
  useAsSteering: boolean;
  radius: number;
  suspensionRestLength: number;
  suspensionTravel: number;
  suspensionStiffness: number;
  dampingCompression: number;
  dampingRelaxation: number;
  suspensionMaxForce: number;
  frictionSlip: number;
  setSuspensionRestLength(value: number): void;
  getSuspensionRestLength(): number;
  setFrictionSlip(value: number): void;
  getFrictionSlip(): number;
  engineForce: number;
  brake: number;
  steering: number;
  rollInfluence: number;
  setRollInfluence(value: number): void;
  getRollInfluence(): number;
  getRotation(): number;
  getRpm(): number;
  getSkidInfo(): number;
  isInContact(): boolean;
  getContactBody(): unknown;
  getContactPoint(): GodotVector3;
  getContactNormal(): GodotVector3;
};

export type GodotVehicleBody3D = Object3D & {
  readonly body: RAPIER.RigidBody;
  engineForce: number;
  brake: number;
  steering: number;
  addWheel(options: CreateVehicleWheel3DOptions): GodotVehicleWheel3D;
  getWheelCount(): number;
  getWheel(index: number): GodotVehicleWheel3D;
  getForwardSpeed(): number;
  update(delta: number): void;
  destroy(): void;
};

export interface CreateVehicleBody3DOptions {
  readonly node: Object3D;
  readonly body: RAPIER.RigidBody;
  readonly world: RAPIER.World;
  readonly layers: CollisionLayers;
  readonly collisionMask?: number;
  readonly engineForce?: number;
  readonly brake?: number;
  readonly steering?: number;
  readonly resolveCollider: (collider: RAPIER.Collider) => unknown;
}

export interface CreateVehicleWheel3DOptions {
  readonly node: Object3D;
  readonly connection?: Vector3Like;
  readonly direction?: Vector3Like;
  readonly axle?: Vector3Like;
  readonly useAsTraction?: boolean;
  readonly useAsSteering?: boolean;
  readonly radius?: number;
  readonly suspensionRestLength?: number;
  readonly suspensionTravel?: number;
  readonly suspensionStiffness?: number;
  readonly dampingCompression?: number;
  readonly dampingRelaxation?: number;
  readonly suspensionMaxForce?: number;
  readonly frictionSlip?: number;
  readonly engineForce?: number;
  readonly brake?: number;
  readonly steering?: number;
  readonly rollInfluence?: number;
}

function finite(value: number, name: string, minimum = -Infinity): number {
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`VehicleWheel3D ${name} must be finite and >= ${String(minimum)}`);
  }
  return value;
}

function requiredWheel<T>(value: T | null, index: number): T {
  if (value === null) throw new RangeError(`VehicleWheel3D index ${String(index)} is invalid`);
  return value;
}

/**
 * Godot scales the lateral constraint's fixed 0.2 contact damping before skid limiting.
 * Rapier exposes that exact seat as side-friction stiffness, while keeping its own resolver.
 */
function rollDampingScale(delta: number, rollInfluence: number): number {
  const damping = rollInfluence > 0 ? Math.min(0.2, delta / rollInfluence) : 0.2;
  return damping / 0.2;
}

export function createVehicleBody3D(options: CreateVehicleBody3DOptions): GodotVehicleBody3D {
  const controller = options.world.createVehicleController(options.body);
  controller.indexUpAxis = 1;
  controller.setIndexForwardAxis = 2;
  let engineForce = finite(options.engineForce ?? 0, 'engine_force');
  let brake = finite(options.brake ?? 0, 'brake');
  let steering = finite(options.steering ?? 0, 'steering');
  let destroyed = false;
  const wheels: GodotVehicleWheel3D[] = [];
  const wheelBasisRotations: Quaternion[] = [];
  const wheelBasisScales: Vector3[] = [];
  const wheelUpAxes: Vector3[] = [];
  const wheelRightAxes: Vector3[] = [];
  const wheelRpm: number[] = [];
  const wheelPreviousRotation: number[] = [];

  const wheel = (index: number): GodotVehicleWheel3D => {
    const found = wheels[index];
    if (found === undefined) throw new RangeError(`VehicleWheel3D index ${String(index)} is invalid`);
    return found;
  };

  const addWheel = (spec: CreateVehicleWheel3DOptions): GodotVehicleWheel3D => {
    if (destroyed) throw new Error('VehicleBody3D controller was destroyed');
    const connection = spec.connection ?? spec.node.position;
    const direction = spec.direction ?? { x: 0, y: -1, z: 0 };
    const axle = spec.axle ?? { x: -1, y: 0, z: 0 };
    const upAxis = new Vector3(-direction.x, -direction.y, -direction.z).normalize();
    const rightAxis = new Vector3(axle.x, axle.y, axle.z).normalize();
    if (upAxis.lengthSq() === 0 || rightAxis.lengthSq() === 0 || Math.abs(upAxis.dot(rightAxis)) > 1e-5) {
      throw new Error('VehicleWheel3D wheel_direction and wheel_axle must be nonzero perpendicular vectors');
    }
    const rest = finite(spec.suspensionRestLength ?? 0.15, 'wheel_rest_length');
    const radius = finite(spec.radius ?? 0.5, 'wheel_radius');
    controller.addWheel(connection, direction, axle, rest, radius);
    const index = controller.numWheels() - 1;
    const forwardAxis = new Vector3().crossVectors(upAxis, rightAxis).normalize();
    const basisMatrix = new Matrix4().makeBasis(rightAxis, upAxis, forwardAxis);
    const basisRotation = new Quaternion();
    const basisScale = new Vector3();
    basisMatrix.decompose(new Vector3(), basisRotation, basisScale);
    wheelBasisRotations[index] = basisRotation;
    wheelBasisScales[index] = basisScale;
    wheelUpAxes[index] = upAxis;
    wheelRightAxes[index] = rightAxis;
    wheelRpm[index] = 0;
    wheelPreviousRotation[index] = 0;
    controller.setWheelMaxSuspensionTravel(index, finite(spec.suspensionTravel ?? 0.2, 'suspension_travel'));
    controller.setWheelSuspensionStiffness(index, finite(spec.suspensionStiffness ?? 5.88, 'suspension_stiffness'));
    controller.setWheelSuspensionCompression(index, finite(spec.dampingCompression ?? 0.83, 'damping_compression'));
    controller.setWheelSuspensionRelaxation(index, finite(spec.dampingRelaxation ?? 0.88, 'damping_relaxation'));
    controller.setWheelMaxSuspensionForce(index, finite(spec.suspensionMaxForce ?? 6000, 'suspension_max_force'));
    controller.setWheelFrictionSlip(index, finite(spec.frictionSlip ?? 10.5, 'wheel_friction_slip'));
    let useAsTraction = spec.useAsTraction ?? false;
    let useAsSteering = spec.useAsSteering ?? false;
    let rollInfluence = finite(spec.rollInfluence ?? 0.1, 'wheel_roll_influence');
    controller.setWheelEngineForce(index, finite(spec.engineForce ?? (useAsTraction ? engineForce : 0), 'engine_force'));
    controller.setWheelBrake(index, finite(spec.brake ?? brake, 'brake'));
    controller.setWheelSteering(index, finite(spec.steering ?? (useAsSteering ? steering : 0), 'steering'));
    const result = spec.node as GodotVehicleWheel3D;
    Object.defineProperties(result, {
      index: { configurable: true, enumerable: false, value: index },
      useAsTraction: { configurable: true, get: () => useAsTraction, set: (value: boolean) => { useAsTraction = value; } },
      useAsSteering: { configurable: true, get: () => useAsSteering, set: (value: boolean) => { useAsSteering = value; } },
      radius: { configurable: true, get: () => requiredWheel(controller.wheelRadius(index), index), set: (value: number) => { controller.setWheelRadius(index, finite(value, 'wheel_radius')); } },
      suspensionRestLength: { configurable: true, get: () => requiredWheel(controller.wheelSuspensionRestLength(index), index), set: (value: number) => { controller.setWheelSuspensionRestLength(index, finite(value, 'wheel_rest_length')); } },
      suspensionTravel: { configurable: true, get: () => requiredWheel(controller.wheelMaxSuspensionTravel(index), index), set: (value: number) => { controller.setWheelMaxSuspensionTravel(index, finite(value, 'suspension_travel')); } },
      suspensionStiffness: { configurable: true, get: () => requiredWheel(controller.wheelSuspensionStiffness(index), index), set: (value: number) => { controller.setWheelSuspensionStiffness(index, finite(value, 'suspension_stiffness')); } },
      dampingCompression: { configurable: true, get: () => requiredWheel(controller.wheelSuspensionCompression(index), index), set: (value: number) => { controller.setWheelSuspensionCompression(index, finite(value, 'damping_compression')); } },
      dampingRelaxation: { configurable: true, get: () => requiredWheel(controller.wheelSuspensionRelaxation(index), index), set: (value: number) => { controller.setWheelSuspensionRelaxation(index, finite(value, 'damping_relaxation')); } },
      suspensionMaxForce: { configurable: true, get: () => requiredWheel(controller.wheelMaxSuspensionForce(index), index), set: (value: number) => { controller.setWheelMaxSuspensionForce(index, finite(value, 'suspension_max_force')); } },
      frictionSlip: { configurable: true, get: () => requiredWheel(controller.wheelFrictionSlip(index), index), set: (value: number) => { controller.setWheelFrictionSlip(index, finite(value, 'wheel_friction_slip')); } },
      engineForce: { configurable: true, get: () => requiredWheel(controller.wheelEngineForce(index), index), set: (value: number) => { controller.setWheelEngineForce(index, finite(value, 'engine_force')); } },
      brake: { configurable: true, get: () => requiredWheel(controller.wheelBrake(index), index), set: (value: number) => { controller.setWheelBrake(index, finite(value, 'brake')); } },
      steering: { configurable: true, get: () => requiredWheel(controller.wheelSteering(index), index), set: (value: number) => { controller.setWheelSteering(index, finite(value, 'steering')); } },
      rollInfluence: { configurable: true, get: () => rollInfluence, set: (value: number) => {
        rollInfluence = finite(value, 'wheel_roll_influence');
      } },
    });
    Object.assign(result, {
      setSuspensionRestLength(value: number): void { result.suspensionRestLength = value; },
      getSuspensionRestLength(): number { return result.suspensionRestLength; },
      setFrictionSlip(value: number): void { result.frictionSlip = value; },
      getFrictionSlip(): number { return result.frictionSlip; },
      setRollInfluence(value: number): void { result.rollInfluence = value; },
      getRollInfluence(): number { return result.rollInfluence; },
      getRotation(): number { return requiredWheel(controller.wheelRotation(index), index); },
      getRpm(): number { return wheelRpm[index] ?? 0; },
      getSkidInfo(): number {
        throw new Error('VehicleWheel3D.get_skidinfo is not exposed by Rapier 0.14');
      },
      isInContact(): boolean { return controller.wheelIsInContact(index); },
      getContactBody(): unknown {
        const collider = controller.wheelGroundObject(index);
        return collider === null ? null : options.resolveCollider(collider);
      },
      getContactPoint(): GodotVector3 {
        const point = requiredWheel(controller.wheelContactPoint(index), index);
        return vec3(point.x, point.y, point.z);
      },
      getContactNormal(): GodotVector3 {
        const normal = requiredWheel(controller.wheelContactNormal(index), index);
        return vec3(normal.x, normal.y, normal.z);
      },
    });
    wheels.push(result);
    return result;
  };

  const binding = options.node as GodotVehicleBody3D;
  Object.defineProperties(binding, {
    body: { configurable: true, enumerable: false, value: options.body },
    engineForce: { configurable: true, get: () => engineForce, set: (value: number) => {
      engineForce = finite(value, 'engine_force');
      for (const wheel of wheels) if (wheel.useAsTraction) wheel.engineForce = engineForce;
    } },
    brake: { configurable: true, get: () => brake, set: (value: number) => {
      brake = finite(value, 'brake');
      for (const wheel of wheels) wheel.brake = brake;
    } },
    steering: { configurable: true, get: () => steering, set: (value: number) => {
      steering = finite(value, 'steering');
      for (const wheel of wheels) if (wheel.useAsSteering) wheel.steering = steering;
    } },
  });
  return Object.assign(binding, {
    addWheel,
    getWheelCount(): number { return wheels.length; },
    getWheel: wheel,
    getForwardSpeed(): number { return controller.currentVehicleSpeed(); },
    update(delta: number): void {
      if (destroyed) return;
      if (!Number.isFinite(delta) || delta < 0) throw new Error('VehicleBody3D delta must be finite and >= 0');
      for (const one of wheels) {
        controller.setWheelSideFrictionStiffness(
          one.index,
          rollDampingScale(delta, one.rollInfluence),
        );
      }
      controller.updateVehicle(
        delta,
        undefined,
        undefined,
        (collider) => godotCanCollideWith(options.layers, collider, options.collisionMask ?? 1),
      );
      const bodyRotation = options.body.rotation();
      const chassisRotation = new Quaternion(
        bodyRotation.x,
        bodyRotation.y,
        bodyRotation.z,
        bodyRotation.w,
      );
      const chassisUp = new Vector3(0, 1, 0).applyQuaternion(chassisRotation);
      const chassisComValue = options.body.worldCom();
      const chassisCom = new Vector3(chassisComValue.x, chassisComValue.y, chassisComValue.z);
      for (const one of wheels) {
        const sideImpulseMagnitude = requiredWheel(controller.wheelSideImpulse(one.index), one.index);
        if (sideImpulseMagnitude !== 0 && one.rollInfluence !== 0.1) {
          const contactValue = requiredWheel(controller.wheelContactPoint(one.index), one.index);
          const normalValue = requiredWheel(controller.wheelContactNormal(one.index), one.index);
          const contact = new Vector3(contactValue.x, contactValue.y, contactValue.z);
          const normal = new Vector3(normalValue.x, normalValue.y, normalValue.z);
          const axle = (wheelRightAxes[one.index] as Vector3).clone().applyQuaternion(chassisRotation);
          const wheelUp = (wheelUpAxes[one.index] as Vector3).clone().applyQuaternion(chassisRotation);
          axle.applyQuaternion(new Quaternion().setFromAxisAngle(wheelUp, one.steering));
          axle.addScaledVector(normal, -axle.dot(normal));
          if (axle.lengthSq() > 1e-10) {
            axle.normalize();
            const impulse = axle.multiplyScalar(sideImpulseMagnitude);
            const height = chassisUp.dot(contact.clone().sub(chassisCom));
            const rapierPoint = contact.clone().addScaledVector(chassisUp, -height * (1 - 0.1));
            const godotPoint = contact.clone().addScaledVector(chassisUp, -height * (1 - one.rollInfluence));
            options.body.applyImpulseAtPoint(impulse.clone().negate(), rapierPoint, false);
            options.body.applyImpulseAtPoint(impulse, godotPoint, false);
          }
        }
        const connection = requiredWheel(controller.wheelChassisConnectionPointCs(one.index), one.index);
        const direction = requiredWheel(controller.wheelDirectionCs(one.index), one.index);
        const suspension = requiredWheel(controller.wheelSuspensionLength(one.index), one.index);
        one.position.set(
          connection.x + direction.x * suspension,
          connection.y + direction.y * suspension,
          connection.z + direction.z * suspension,
        );
        const rotation = one.getRotation();
        const previous = wheelPreviousRotation[one.index] ?? rotation;
        wheelRpm[one.index] = delta === 0 ? 0 : ((rotation - previous) / delta / (Math.PI * 2)) * 60;
        wheelPreviousRotation[one.index] = rotation;
        const basis = wheelBasisRotations[one.index] as Quaternion;
        const up = wheelUpAxes[one.index] as Vector3;
        const right = wheelRightAxes[one.index] as Vector3;
        const steeringRotation = new Quaternion().setFromAxisAngle(
          up,
          one.steering,
        );
        const rollRotation = new Quaternion().setFromAxisAngle(right, rotation);
        // VehicleWheel3D::FTIData composes steering(up) * rotation(right) *
        // Basis(right, up, up×right). The last basis can be reflected, so preserve its signed
        // decomposition scale instead of pretending the complete transform is one quaternion.
        one.quaternion.copy(steeringRotation).multiply(rollRotation).multiply(basis);
        one.scale.copy(wheelBasisScales[one.index] as Vector3);
      }
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      options.world.removeVehicleController(controller);
      wheels.length = 0;
      wheelBasisRotations.length = 0;
      wheelBasisScales.length = 0;
      wheelUpAxes.length = 0;
      wheelRightAxes.length = 0;
      wheelRpm.length = 0;
      wheelPreviousRotation.length = 0;
    },
  });
}
