/**
 * Godot 4.7's three 2D joint nodes over Rapier's native impulse joints.
 *
 * Godot computes every anchor in world space when a Joint2D enters the tree,
 * then hands body-local anchors to PhysicsServer2D. The emitted scene supplies
 * the authored Pixi node and the two real Rapier bodies; this module owns that
 * conversion and creates Rapier's own joint objects directly.
 *
 * Source authority:
 * - scene/2d/physics/joints/joint_2d.cpp
 * - scene/2d/physics/joints/pin_joint_2d.cpp
 * - scene/2d/physics/joints/groove_joint_2d.cpp
 * - scene/2d/physics/joints/damped_spring_joint_2d.cpp
 * at the pinned Godot 4.7 source revision.
 */

import RAPIER from '@dimforge/rapier2d-compat';
import { Container, type Matrix } from 'pixi.js';
import { godotCanvasTransform2D } from './physics-2d';
import { bindGodotCanvasNode2DApi, registerCanvasNodeRelease } from './node';
import { registerGodotObjectIdentity } from './object';

interface Point2 {
  readonly x: number;
  readonly y: number;
}

export interface GodotJoint2DNode extends Container {
  readonly nativeJoint: RAPIER.ImpulseJoint;
  disable_collision: boolean;
  exclude_nodes_from_collision: boolean;
  angular_limit_enabled?: boolean;
  angular_limit_lower?: number;
  angular_limit_upper?: number;
  rest_length?: number;
  stiffness?: number;
  damping?: number;
  length?: number;
  initial_offset?: number;
  set_disable_collision(value: boolean): void;
  get_disable_collision(): boolean;
  set_exclude_nodes_from_collision(value: boolean): void;
  get_exclude_nodes_from_collision(): boolean;
  set_angular_limit_enabled?(value: boolean): void;
  is_angular_limit_enabled?(): boolean;
  set_angular_limit_lower?(value: number): void;
  get_angular_limit_lower?(): number;
  set_angular_limit_upper?(value: number): void;
  get_angular_limit_upper?(): number;
  set_rest_length?(value: number): void;
  get_rest_length?(): number;
  set_stiffness?(value: number): void;
  get_stiffness?(): number;
  set_damping?(value: number): void;
  get_damping?(): number;
  set_length?(value: number): void;
  get_length?(): number;
  set_initial_offset?(value: number): void;
  get_initial_offset?(): number;
}

interface JointOwnership {
  readonly world: RAPIER.World;
  joint: RAPIER.ImpulseJoint;
  readonly state: PinJointState | SpringJointState | GrooveJointState;
}

interface JointStateBase {
  readonly bodyA: RAPIER.RigidBody;
  readonly bodyB: RAPIER.RigidBody;
  excludeNodesFromCollision: boolean;
}

interface PinJointState extends JointStateBase {
  readonly kind: 'pin';
  readonly anchorA: Point2;
  readonly anchorB: Point2;
  angularLimitEnabled: boolean;
  angularLimitLower: number;
  angularLimitUpper: number;
}

interface SpringJointState extends JointStateBase {
  readonly kind: 'spring';
  readonly anchorA: Point2;
  readonly anchorB: Point2;
  readonly length: number;
  restLength: number;
  effectiveRestLength: number;
  stiffness: number;
  damping: number;
}

interface GrooveJointState extends JointStateBase {
  readonly kind: 'groove';
  anchorA: Point2;
  anchorB: Point2;
  axis: Point2;
  readonly baseAnchorB: Point2;
  readonly axisB: Point2;
  length: number;
  initialOffset: number;
}

const OWNERSHIP = new WeakMap<Container, JointOwnership>();
const JOINT_NODE_LIFECYCLES = new WeakSet<Container>();

interface Joint2DBaseOptions {
  readonly world: RAPIER.World;
  readonly node: Container;
  readonly presentationRoot: Container;
  readonly bodyA: RAPIER.RigidBody;
  readonly bodyB: RAPIER.RigidBody;
  /** Godot calls this `exclude_nodes_from_collision`; its default is true. */
  readonly excludeNodesFromCollision: boolean;
}

export interface PinJoint2DOptions extends Joint2DBaseOptions {
  readonly angularLimitEnabled: boolean;
  readonly angularLimitLower: number;
  readonly angularLimitUpper: number;
}

export interface DampedSpringJoint2DOptions extends Joint2DBaseOptions {
  readonly length: number;
  readonly restLength: number;
  readonly stiffness: number;
  readonly damping: number;
}

export interface GrooveJoint2DOptions extends Joint2DBaseOptions {
  readonly length: number;
  readonly initialOffset: number;
}

function worldPoint(transform: Matrix, x: number, y: number): Point2 {
  return transform.apply({ x, y });
}

function bodyLocalPoint(body: RAPIER.RigidBody, point: Point2): Point2 {
  const translation = body.translation();
  const angle = -body.rotation();
  const dx = point.x - translation.x;
  const dy = point.y - translation.y;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: cosine * dx - sine * dy,
    y: sine * dx + cosine * dy,
  };
}

function bindJointNode<T extends RAPIER.ImpulseJoint>(
  world: RAPIER.World,
  node: Container,
  joint: T,
  state: PinJointState | SpringJointState | GrooveJointState,
): GodotJoint2DNode {
  Object.defineProperty(node, 'nativeJoint', {
    configurable: true,
    enumerable: false,
    get: () => ownership(node, 'Joint2D.nativeJoint').joint,
  });
  OWNERSHIP.set(node, { world, joint, state });
  const retained = bindGodotCanvasNode2DApi(node) as unknown as GodotJoint2DNode;
  installJointNodeApi(retained, state);
  if (!JOINT_NODE_LIFECYCLES.has(retained)) {
    JOINT_NODE_LIFECYCLES.add(retained);
    registerCanvasNodeRelease(retained, () => {
      destroyJoint2D(retained);
      JOINT_NODE_LIFECYCLES.delete(retained);
    });
  }
  registerGodotObjectIdentity(
    retained,
    state.kind === 'pin' ? 'PinJoint2D' : state.kind === 'spring' ? 'DampedSpringJoint2D' : 'GrooveJoint2D',
  );
  return retained;
}

function jointProperty<T>(node: object, name: string, read: () => T, write: (value: T) => void): void {
  Object.defineProperty(node, name, { configurable: true, enumerable: true, get: read, set: write });
}

function installJointNodeApi(node: GodotJoint2DNode, state: PinJointState | SpringJointState | GrooveJointState): void {
  jointProperty(node, 'disable_collision', () => getJoint2DDisableCollision(node), (value) => setJoint2DDisableCollision(node, value));
  jointProperty(node, 'exclude_nodes_from_collision', () => getJoint2DDisableCollision(node), (value) => setJoint2DDisableCollision(node, value));
  Object.assign(node, {
    set_disable_collision: (value: boolean): void => setJoint2DDisableCollision(node, value),
    get_disable_collision: (): boolean => getJoint2DDisableCollision(node),
    set_exclude_nodes_from_collision: (value: boolean): void => setJoint2DDisableCollision(node, value),
    get_exclude_nodes_from_collision: (): boolean => getJoint2DDisableCollision(node),
  });
  if (state.kind === 'pin') {
    jointProperty(node, 'angular_limit_enabled', () => getPinJoint2DAngularLimitEnabled(node), (value) => setPinJoint2DAngularLimitEnabled(node, value));
    jointProperty(node, 'angular_limit_lower', () => getPinJoint2DAngularLimitLower(node), (value) => setPinJoint2DAngularLimitLower(node, value));
    jointProperty(node, 'angular_limit_upper', () => getPinJoint2DAngularLimitUpper(node), (value) => setPinJoint2DAngularLimitUpper(node, value));
    Object.assign(node, {
      set_angular_limit_enabled: (value: boolean): void => setPinJoint2DAngularLimitEnabled(node, value),
      is_angular_limit_enabled: (): boolean => getPinJoint2DAngularLimitEnabled(node),
      set_angular_limit_lower: (value: number): void => setPinJoint2DAngularLimitLower(node, value),
      get_angular_limit_lower: (): number => getPinJoint2DAngularLimitLower(node),
      set_angular_limit_upper: (value: number): void => setPinJoint2DAngularLimitUpper(node, value),
      get_angular_limit_upper: (): number => getPinJoint2DAngularLimitUpper(node),
    });
    return;
  }
  if (state.kind === 'groove') {
    jointProperty(node, 'length', () => getGrooveJoint2DLength(node), (value) => setGrooveJoint2DLength(node, value));
    jointProperty(node, 'initial_offset', () => getGrooveJoint2DInitialOffset(node), (value) => setGrooveJoint2DInitialOffset(node, value));
    Object.assign(node, {
      set_length: (value: number): void => setGrooveJoint2DLength(node, value),
      get_length: (): number => getGrooveJoint2DLength(node),
      set_initial_offset: (value: number): void => setGrooveJoint2DInitialOffset(node, value),
      get_initial_offset: (): number => getGrooveJoint2DInitialOffset(node),
    });
    return;
  }
  jointProperty(node, 'rest_length', () => getDampedSpringJoint2DRestLength(node), (value) => setDampedSpringJoint2DRestLength(node, value));
  jointProperty(node, 'stiffness', () => getDampedSpringJoint2DStiffness(node), (value) => setDampedSpringJoint2DStiffness(node, value));
  jointProperty(node, 'damping', () => getDampedSpringJoint2DDamping(node), (value) => setDampedSpringJoint2DDamping(node, value));
  Object.assign(node, {
    set_rest_length: (value: number): void => setDampedSpringJoint2DRestLength(node, value),
    get_rest_length: (): number => getDampedSpringJoint2DRestLength(node),
    set_stiffness: (value: number): void => setDampedSpringJoint2DStiffness(node, value),
    get_stiffness: (): number => getDampedSpringJoint2DStiffness(node),
    set_damping: (value: number): void => setDampedSpringJoint2DDamping(node, value),
    get_damping: (): number => getDampedSpringJoint2DDamping(node),
  });
}

function ownership(node: Container, member: string): JointOwnership {
  const owned = OWNERSHIP.get(node);
  if (owned === undefined || !owned.joint.isValid()) {
    throw new Error(`godot-compat: ${member} requires a live native Joint2D.`);
  }
  return owned;
}

function finite(value: number, member: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`godot-compat: ${member} requires a finite number.`);
  }
  return value;
}

/** Idempotent native teardown of the solver-owned constraint. */
export function destroyJoint2D(node: Container): void {
  const owned = OWNERSHIP.get(node);
  if (owned === undefined) return;
  if (owned.joint.isValid()) owned.world.removeImpulseJoint(owned.joint, true);
  OWNERSHIP.delete(node);
}

function configureCollision(joint: RAPIER.ImpulseJoint, exclude: boolean): void {
  joint.setContactsEnabled(!exclude);
}

/** Godot 3 `Joint2D.disable_collision` over Rapier's live joint contact gate. */
export function setJoint2DDisableCollision(node: GodotJoint2DNode, disabled: boolean): void {
  if (typeof disabled !== 'boolean') {
    throw new TypeError('godot-compat: Joint2D.disable_collision requires bool.');
  }
  const owned = ownership(node, 'Joint2D.disable_collision');
  owned.state.excludeNodesFromCollision = disabled;
  owned.joint.setContactsEnabled(!disabled);
}

/** Read Godot's inverse view of Rapier's live `contactsEnabled` flag. */
export function getJoint2DDisableCollision(node: GodotJoint2DNode): boolean {
  return !ownership(node, 'Joint2D.disable_collision').joint.contactsEnabled();
}

function createPinNative(world: RAPIER.World, state: PinJointState): RAPIER.RevoluteImpulseJoint {
  const data = RAPIER.JointData.revolute(
    state.anchorA,
    state.anchorB,
  );
  const joint = world.createImpulseJoint(data, state.bodyA, state.bodyB, true) as RAPIER.RevoluteImpulseJoint;
  if (state.angularLimitEnabled) {
    joint.setLimits(state.angularLimitLower, state.angularLimitUpper);
  }
  configureCollision(joint, state.excludeNodesFromCollision);
  return joint;
}

function createSpringNative(world: RAPIER.World, state: SpringJointState): RAPIER.SpringImpulseJoint {
  const data = RAPIER.JointData.spring(
    state.effectiveRestLength,
    state.stiffness,
    state.damping,
    state.anchorA,
    state.anchorB,
  );
  const joint = world.createImpulseJoint(data, state.bodyA, state.bodyB, true) as RAPIER.SpringImpulseJoint;
  configureCollision(joint, state.excludeNodesFromCollision);
  return joint;
}

function createGrooveNative(world: RAPIER.World, state: GrooveJointState): RAPIER.PrismaticImpulseJoint {
  const data = RAPIER.JointData.prismatic(state.anchorA, state.anchorB, state.axis);
  data.limitsEnabled = true;
  data.limits = [0, state.length];
  const joint = world.createImpulseJoint(data, state.bodyA, state.bodyB, true) as RAPIER.PrismaticImpulseJoint;
  configureCollision(joint, state.excludeNodesFromCollision);
  return joint;
}

function rebuild(node: GodotJoint2DNode): void {
  const owned = ownership(node, 'Joint2D runtime property');
  const previous = owned.joint;
  const replacement = owned.state.kind === 'pin'
    ? createPinNative(owned.world, owned.state)
    : owned.state.kind === 'spring'
      ? createSpringNative(owned.world, owned.state)
      : createGrooveNative(owned.world, owned.state);
  owned.world.removeImpulseJoint(previous, true);
  owned.joint = replacement;
}

export function createPinJoint2D(options: PinJoint2DOptions): GodotJoint2DNode {
  destroyJoint2D(options.node);
  const transform = godotCanvasTransform2D(options.node, options.presentationRoot);
  const anchor = worldPoint(transform, 0, 0);
  const state: PinJointState = {
    kind: 'pin',
    bodyA: options.bodyA,
    bodyB: options.bodyB,
    anchorA: bodyLocalPoint(options.bodyA, anchor),
    anchorB: bodyLocalPoint(options.bodyB, anchor),
    excludeNodesFromCollision: options.excludeNodesFromCollision,
    angularLimitEnabled: options.angularLimitEnabled,
    angularLimitLower: finite(options.angularLimitLower, 'PinJoint2D.angular_limit_lower'),
    angularLimitUpper: finite(options.angularLimitUpper, 'PinJoint2D.angular_limit_upper'),
  };
  return bindJointNode(options.world, options.node, createPinNative(options.world, state), state);
}

export function createDampedSpringJoint2D(options: DampedSpringJoint2DOptions): GodotJoint2DNode {
  destroyJoint2D(options.node);
  const length = finite(options.length, 'DampedSpringJoint2D.length');
  const restLength = finite(options.restLength, 'DampedSpringJoint2D.rest_length');
  const transform = godotCanvasTransform2D(options.node, options.presentationRoot);
  const worldAnchorA = worldPoint(transform, 0, 0);
  const worldAnchorB = worldPoint(transform, 0, length);
  const state: SpringJointState = {
    kind: 'spring',
    bodyA: options.bodyA,
    bodyB: options.bodyB,
    anchorA: bodyLocalPoint(options.bodyA, worldAnchorA),
    anchorB: bodyLocalPoint(options.bodyB, worldAnchorB),
    excludeNodesFromCollision: options.excludeNodesFromCollision,
    length,
    restLength,
    effectiveRestLength: restLength === 0
      ? Math.hypot(worldAnchorB.x - worldAnchorA.x, worldAnchorB.y - worldAnchorA.y)
      : restLength,
    stiffness: finite(options.stiffness, 'DampedSpringJoint2D.stiffness'),
    damping: finite(options.damping, 'DampedSpringJoint2D.damping'),
  };
  return bindJointNode(options.world, options.node, createSpringNative(options.world, state), state);
}

export function createGrooveJoint2D(options: GrooveJoint2DOptions): GodotJoint2DNode {
  destroyJoint2D(options.node);
  const length = finite(options.length, 'GrooveJoint2D.length');
  if (length < 0) throw new RangeError('godot-compat: GrooveJoint2D.length must be non-negative.');
  const initialOffset = finite(options.initialOffset, 'GrooveJoint2D.initial_offset');
  const transform = godotCanvasTransform2D(options.node, options.presentationRoot);
  const grooveStart = worldPoint(transform, 0, 0);
  const grooveEnd = worldPoint(transform, 0, Math.max(length, 1));
  const anchorA = bodyLocalPoint(options.bodyA, grooveStart);
  const axisEnd = bodyLocalPoint(options.bodyA, grooveEnd);
  const axisX = axisEnd.x - anchorA.x;
  const axisY = axisEnd.y - anchorA.y;
  const magnitude = Math.hypot(axisX, axisY);
  const baseAnchorB = bodyLocalPoint(options.bodyB, grooveStart);
  const axisEndB = bodyLocalPoint(options.bodyB, grooveEnd);
  const axisBX = axisEndB.x - baseAnchorB.x;
  const axisBY = axisEndB.y - baseAnchorB.y;
  const magnitudeB = Math.hypot(axisBX, axisBY);
  const axisB = magnitudeB === 0 ? { x: 0, y: 1 } : { x: axisBX / magnitudeB, y: axisBY / magnitudeB };
  const state: GrooveJointState = {
    kind: 'groove',
    bodyA: options.bodyA,
    bodyB: options.bodyB,
    anchorA,
    anchorB: { x: baseAnchorB.x + axisB.x * initialOffset, y: baseAnchorB.y + axisB.y * initialOffset },
    axis: magnitude === 0 ? { x: 0, y: 1 } : { x: axisX / magnitude, y: axisY / magnitude },
    baseAnchorB,
    axisB,
    length,
    initialOffset,
    excludeNodesFromCollision: options.excludeNodesFromCollision,
  };
  return bindJointNode(options.world, options.node, createGrooveNative(options.world, state), state);
}

function pinState(node: GodotJoint2DNode, member: string): PinJointState {
  const state = ownership(node, member).state;
  if (state.kind !== 'pin') throw new TypeError(`godot-compat: ${member} requires PinJoint2D.`);
  return state;
}

function springState(node: GodotJoint2DNode, member: string): SpringJointState {
  const state = ownership(node, member).state;
  if (state.kind !== 'spring') throw new TypeError(`godot-compat: ${member} requires DampedSpringJoint2D.`);
  return state;
}

function grooveState(node: GodotJoint2DNode, member: string): GrooveJointState {
  const state = ownership(node, member).state;
  if (state.kind !== 'groove') throw new TypeError(`godot-compat: ${member} requires GrooveJoint2D.`);
  return state;
}

export function getGrooveJoint2DLength(node: GodotJoint2DNode): number {
  return grooveState(node, 'GrooveJoint2D.length').length;
}

export function setGrooveJoint2DLength(node: GodotJoint2DNode, value: number): void {
  const state = grooveState(node, 'GrooveJoint2D.length');
  const next = finite(value, 'GrooveJoint2D.length');
  if (next < 0) throw new RangeError('godot-compat: GrooveJoint2D.length must be non-negative.');
  if (next === state.length) return;
  state.length = next;
  (ownership(node, 'GrooveJoint2D.length').joint as RAPIER.PrismaticImpulseJoint).setLimits(0, next);
}

export function getGrooveJoint2DInitialOffset(node: GodotJoint2DNode): number {
  return grooveState(node, 'GrooveJoint2D.initial_offset').initialOffset;
}

export function setGrooveJoint2DInitialOffset(node: GodotJoint2DNode, value: number): void {
  const state = grooveState(node, 'GrooveJoint2D.initial_offset');
  const next = finite(value, 'GrooveJoint2D.initial_offset');
  if (next === state.initialOffset) return;
  state.initialOffset = next;
  state.anchorB = {
    x: state.baseAnchorB.x + state.axisB.x * next,
    y: state.baseAnchorB.y + state.axisB.y * next,
  };
  rebuild(node);
}

export function getPinJoint2DAngularLimitEnabled(node: GodotJoint2DNode): boolean {
  return pinState(node, 'PinJoint2D.angular_limit_enabled').angularLimitEnabled;
}

export function setPinJoint2DAngularLimitEnabled(node: GodotJoint2DNode, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('godot-compat: PinJoint2D.angular_limit_enabled requires bool.');
  const state = pinState(node, 'PinJoint2D.angular_limit_enabled');
  if (state.angularLimitEnabled === enabled) return;
  state.angularLimitEnabled = enabled;
  rebuild(node);
}

export function getPinJoint2DAngularLimitLower(node: GodotJoint2DNode): number {
  return pinState(node, 'PinJoint2D.angular_limit_lower').angularLimitLower;
}

export function setPinJoint2DAngularLimitLower(node: GodotJoint2DNode, value: number): void {
  const state = pinState(node, 'PinJoint2D.angular_limit_lower');
  const next = finite(value, 'PinJoint2D.angular_limit_lower');
  if (state.angularLimitLower === next) return;
  state.angularLimitLower = next;
  if (state.angularLimitEnabled) {
    (ownership(node, 'PinJoint2D.angular_limit_lower').joint as RAPIER.RevoluteImpulseJoint)
      .setLimits(state.angularLimitLower, state.angularLimitUpper);
  }
}

export function getPinJoint2DAngularLimitUpper(node: GodotJoint2DNode): number {
  return pinState(node, 'PinJoint2D.angular_limit_upper').angularLimitUpper;
}

export function setPinJoint2DAngularLimitUpper(node: GodotJoint2DNode, value: number): void {
  const state = pinState(node, 'PinJoint2D.angular_limit_upper');
  const next = finite(value, 'PinJoint2D.angular_limit_upper');
  if (state.angularLimitUpper === next) return;
  state.angularLimitUpper = next;
  if (state.angularLimitEnabled) {
    (ownership(node, 'PinJoint2D.angular_limit_upper').joint as RAPIER.RevoluteImpulseJoint)
      .setLimits(state.angularLimitLower, state.angularLimitUpper);
  }
}

export function getDampedSpringJoint2DRestLength(node: GodotJoint2DNode): number {
  return springState(node, 'DampedSpringJoint2D.rest_length').restLength;
}

export function setDampedSpringJoint2DRestLength(node: GodotJoint2DNode, value: number): void {
  const state = springState(node, 'DampedSpringJoint2D.rest_length');
  state.restLength = finite(value, 'DampedSpringJoint2D.rest_length');
  // Godot's live setter maps zero to the authored length after configuration, while initial
  // configuration lets PhysicsServer derive the distance from the two anchors.
  state.effectiveRestLength = state.restLength === 0 ? state.length : state.restLength;
  rebuild(node);
}

export function getDampedSpringJoint2DStiffness(node: GodotJoint2DNode): number {
  return springState(node, 'DampedSpringJoint2D.stiffness').stiffness;
}

export function setDampedSpringJoint2DStiffness(node: GodotJoint2DNode, value: number): void {
  const state = springState(node, 'DampedSpringJoint2D.stiffness');
  state.stiffness = finite(value, 'DampedSpringJoint2D.stiffness');
  rebuild(node);
}

export function getDampedSpringJoint2DDamping(node: GodotJoint2DNode): number {
  return springState(node, 'DampedSpringJoint2D.damping').damping;
}

export function setDampedSpringJoint2DDamping(node: GodotJoint2DNode, value: number): void {
  const state = springState(node, 'DampedSpringJoint2D.damping');
  state.damping = finite(value, 'DampedSpringJoint2D.damping');
  rebuild(node);
}
