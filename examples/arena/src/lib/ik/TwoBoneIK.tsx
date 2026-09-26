/**
 * Declarative Two Bone IK constraint for a react-three-fiber world.
 *
 * The component is an ordinary named Group in the hierarchy. Its string props
 * address real bones and ordinary target/pole Object3Ds under the component's
 * parent; source stays TSX, while the copied solver owns only mechanical pose
 * refinement. Give animation/procedural pose work a lower (usually negative)
 * frame priority so this solve deterministically runs after it. Keep this
 * priority non-positive: positive R3F priorities take over the render loop.
 */
import { type ThreeElements, useFrame } from '@react-three/fiber';
import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { TwoBoneIKConstraint } from './ik-chain';

export type TwoBoneIKProps = Omit<ThreeElements['group'], 'children'> & {
  readonly root: string;
  readonly mid: string;
  readonly tip: string;
  readonly target: string;
  readonly pole?: string;
  readonly enabled?: boolean;
  readonly weight?: number;
  readonly iterations?: number;
  readonly order?: number;
  /** R3F frame priority. Defaults to 0, after animation passes using a negative priority. */
  readonly priority?: number;
  /** Runtime gate for conditional contacts such as a holstered weapon. */
  readonly active?: () => boolean;
  readonly onActiveChange?: (active: boolean) => void;
};

export function TwoBoneIK({
  name = 'Two Bone IK',
  root,
  mid,
  tip,
  target,
  pole,
  enabled = true,
  weight = 1,
  iterations = 10,
  order = 0,
  priority = 0,
  active,
  onActiveChange,
  ...groupProps
}: TwoBoneIKProps) {
  const control = useRef<THREE.Group>(null);
  const solver = useRef<TwoBoneIKConstraint | null>(null);
  const targetWorld = useRef(new THREE.Vector3());
  const activeRef = useRef(active);
  const onActiveChangeRef = useRef(onActiveChange);
  activeRef.current = active;
  onActiveChangeRef.current = onActiveChange;

  useLayoutEffect(() => {
    if (priority > 0) {
      throw new Error(
        `Two Bone IK '${name}' frame priority must be zero or negative; positive R3F priorities take over rendering`,
      );
    }
    const markObject = control.current;
    const owner = markObject?.parent;
    if (!markObject || !owner) return;
    const targetObject = owner.getObjectByName(target);
    if (!targetObject) {
      throw new Error(`Two Bone IK '${name}' cannot find target '${target}' under its owner`);
    }
    const poleObject = pole ? owner.getObjectByName(pole) : null;
    if (pole && !poleObject) {
      throw new Error(`Two Bone IK '${name}' cannot find pole '${pole}' under its owner`);
    }

    const next = new TwoBoneIKConstraint();
    next.node = owner;
    next.markObject = markObject;
    next.boneNames = [root, mid, tip];
    next.targetBoneName = `${[root, tip, name].join('_').replace(/\W+/g, '') || 'TwoBoneIK'}Target`;
    next.constraintId = `${root}:${mid}:${tip}:${name}`;
    next.label = name;
    next.enabled = enabled;
    next.weight = weight;
    next.iterations = iterations;
    next.order = order;
    next.targetObject = targetObject;
    next.poleObject = poleObject ?? null;
    next.getWorldTarget = () => {
      const isActive = enabled && (activeRef.current?.() ?? true);
      onActiveChangeRef.current?.(isActive);
      return isActive ? targetObject.getWorldPosition(targetWorld.current) : null;
    };
    next.init();
    solver.current = next;
    return () => {
      next.dispose();
      solver.current = null;
    };
  }, [enabled, iterations, mid, name, order, pole, priority, root, target, tip, weight]);

  useFrame(() => solver.current?.update(), Math.min(priority, 0));

  return <group {...groupProps} ref={control} name={name} />;
}
