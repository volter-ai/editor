/** Declarative Aim and Rotation constraints for react-three-fiber worlds. */
import { type ThreeElements, useFrame } from '@react-three/fiber';
import { type MutableRefObject, useLayoutEffect, useRef } from 'react';
import type * as THREE from 'three';
import {
  AimConstraintController,
  type ConstraintActivity,
  RotationConstraintController,
} from './object-constraints';

type ObjectConstraintProps = Omit<ThreeElements['group'], 'children'> & {
  readonly source: string;
  readonly target: string;
  readonly enabled?: boolean;
  readonly weight?: number;
  readonly order?: number;
  /** Runs after animation without taking over R3F's render loop. */
  readonly priority?: number;
  readonly active?: ConstraintActivity;
};

export type AimConstraintProps = ObjectConstraintProps & {
  readonly aimAxis?: readonly [number, number, number];
  readonly upAxis?: readonly [number, number, number];
  readonly worldUp?: readonly [number, number, number];
};

export function AimConstraint({
  name = 'Aim',
  source,
  target,
  enabled = true,
  weight = 1,
  order = 0,
  priority = 0,
  active,
  aimAxis = [0, 0, -1],
  upAxis,
  worldUp = [0, 1, 0],
  ...groupProps
}: AimConstraintProps) {
  const control = useRef<THREE.Group>(null);
  const controller = useRef<AimConstraintController | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useLayoutEffect(() => {
    assertPriority(name, priority);
    const markObject = control.current;
    const owner = markObject?.parent;
    if (!markObject || !owner) return;
    const sourceObject = requireObject(owner, source, name, 'constrained object');
    const targetObject = requireObject(owner, target, name, 'target');
    const next = new AimConstraintController();
    configure(next, {
      markObject,
      name,
      source,
      target,
      sourceObject,
      targetObject,
      enabled,
      weight,
      order,
      activeRef,
    });
    next.aimAxis = aimAxis;
    next.upAxis = upAxis ?? null;
    next.worldUp = worldUp;
    next.init();
    controller.current = next;
    return () => {
      next.dispose();
      controller.current = null;
    };
  }, [aimAxis, enabled, name, order, priority, source, target, upAxis, weight, worldUp]);

  useFrame(() => controller.current?.update(), Math.min(priority, 0));
  return <group {...groupProps} ref={control} name={name} />;
}

export type RotationConstraintProps = ObjectConstraintProps & {
  readonly offset?: readonly [number, number, number];
};

export function RotationConstraint({
  name = 'Rotation',
  source,
  target,
  enabled = true,
  weight = 1,
  order = 0,
  priority = 0,
  active,
  offset = [0, 0, 0],
  ...groupProps
}: RotationConstraintProps) {
  const control = useRef<THREE.Group>(null);
  const controller = useRef<RotationConstraintController | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useLayoutEffect(() => {
    assertPriority(name, priority);
    const markObject = control.current;
    const owner = markObject?.parent;
    if (!markObject || !owner) return;
    const sourceObject = requireObject(owner, source, name, 'constrained object');
    const targetObject = requireObject(owner, target, name, 'target');
    const next = new RotationConstraintController();
    configure(next, {
      markObject,
      name,
      source,
      target,
      sourceObject,
      targetObject,
      enabled,
      weight,
      order,
      activeRef,
    });
    next.offset = offset;
    next.init();
    controller.current = next;
    return () => {
      next.dispose();
      controller.current = null;
    };
  }, [enabled, name, offset, order, priority, source, target, weight]);

  useFrame(() => controller.current?.update(), Math.min(priority, 0));
  return <group {...groupProps} ref={control} name={name} />;
}

type SupportedController = AimConstraintController | RotationConstraintController;

function configure(
  controller: SupportedController,
  options: {
    readonly markObject: THREE.Object3D;
    readonly name: string;
    readonly source: string;
    readonly target: string;
    readonly sourceObject: THREE.Object3D;
    readonly targetObject: THREE.Object3D;
    readonly enabled: boolean;
    readonly weight: number;
    readonly order: number;
    readonly activeRef: MutableRefObject<ConstraintActivity | undefined>;
  },
): void {
  controller.source = options.sourceObject;
  controller.target = options.targetObject;
  controller.markObject = options.markObject;
  controller.constraintId = `${controller.constructor.name}:${options.source}:${options.target}:${options.name}`;
  controller.label = options.name;
  controller.enabled = options.enabled;
  controller.weight = options.weight;
  controller.order = options.order;
  controller.active = () => options.activeRef.current?.() ?? true;
}

function requireObject(
  owner: THREE.Object3D,
  objectName: string,
  constraintName: string,
  role: string,
): THREE.Object3D {
  const object = owner.getObjectByName(objectName);
  if (!object)
    throw new Error(`${constraintName} cannot find ${role} '${objectName}' under its owner`);
  return object;
}

function assertPriority(name: string, priority: number): void {
  if (priority > 0) {
    throw new Error(
      `${name} frame priority must be zero or negative; positive R3F priorities take over rendering`,
    );
  }
}
