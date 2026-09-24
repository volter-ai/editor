import { type ThreeElements, useFrame, useThree } from '@react-three/fiber';
import type { ReflectionProbeConfig } from '@volter/threejs-runtime/adapter/reflection-probe';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import { createReflectionProbeMark } from './probe-controller';
import {
  acquireReflectionProbeRegistry,
  type ReflectionProbeRegistryLease,
  type ReflectionProbeRuntime,
} from './reflection-probe-registry';

export interface ReflectionProbePublication {
  /** The prefiltered capture, assignable as an ordinary `envMap`; null until the first capture. */
  readonly envMap: THREE.Texture | null;
  /** The probe's `intensity`, to combine with the receiving material's own value. */
  readonly envMapIntensity: number;
}

/**
 * A captured local reflection, placed in the scene like a light or a camera.
 *
 * The capture is Three's own — a `CubeCamera` renders the scene from this node
 * and `PMREMGenerator` prefilters the result — and the result is PUBLISHED,
 * never applied. Children given as a function receive
 * `{ envMap, envMapIntensity }` and the author spreads them onto whatever
 * material should reflect, exactly as they would a texture from `useLoader`:
 *
 * ```tsx
 * <ReflectionProbe size={[10, 6, 10]}>
 *   {({ envMap, envMapIntensity }) => (
 *     <mesh>
 *       <sphereGeometry />
 *       <meshStandardMaterial envMap={envMap} envMapIntensity={envMapIntensity} />
 *     </mesh>
 *   )}
 * </ReflectionProbe>
 * ```
 *
 * Nothing is bound automatically: no material is walked, cloned, intercepted
 * or owned, so a material this probe was not handed to renders precisely as
 * three renders it, and `envMapIntensity` stays the author's own property.
 * Ordinary `ReactNode` children are allowed too — for a probe whose result is
 * consumed by the volume material below — and mean only "these objects are
 * inside the probe", never automatic binding.
 *
 * `blendDistance`, `priority`, `parallaxProjection` and `parallaxSize`
 * describe a per-FRAGMENT model that a native `envMap` cannot express (one
 * envMap is one environment for the whole draw). They are read only by the
 * explicitly created volume material — see `volume-reflection-material.ts` —
 * and are carried here because they are part of the probe's authored
 * description and the editor draws them.
 */
export type ReflectionProbeProps = Omit<ThreeElements['group'], 'children'> & {
  readonly name?: string;
  readonly children?: ReactNode | ((published: ReflectionProbePublication) => ReactNode);
  readonly shape?: 'box' | 'sphere';
  /** Full local-space influence-box dimensions. */
  readonly size?: [number, number, number];
  readonly radius?: number;
  readonly blendDistance?: number;
  readonly priority?: number;
  readonly intensity?: number;
  readonly parallaxProjection?: boolean;
  /** Full local-space projection-box dimensions. */
  readonly parallaxSize?: [number, number, number];
  readonly parallaxOffset?: [number, number, number];
  readonly captureOffset?: [number, number, number];
  readonly captureMode?: 'on-change' | 'manual' | 'realtime';
  readonly resolution?: 64 | 128 | 256 | 512 | 1024;
  readonly near?: number;
  readonly far?: number;
  readonly cullMask?: number;
  readonly captureShadows?: boolean;
};

export function ReflectionProbe({
  name = 'Reflection Probe',
  children,
  shape = 'box',
  size = [10, 6, 10],
  radius = 5,
  blendDistance = 1,
  priority = 0,
  intensity = 1,
  parallaxProjection = true,
  parallaxSize = [10, 6, 10],
  parallaxOffset = [0, 0, 0],
  captureOffset = [0, 0, 0],
  captureMode = 'on-change',
  resolution = 256,
  near = 0.1,
  far = 100,
  cullMask = 0xffffffff,
  captureShadows = true,
  ...groupProps
}: ReflectionProbeProps) {
  const group = useRef<THREE.Group>(null);
  const lease = useRef<ReflectionProbeRegistryLease | null>(null);
  const unregister = useRef<(() => void) | null>(null);
  const unobserve = useRef<(() => void) | null>(null);
  const renderer = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const [envMap, setEnvMap] = useState<THREE.Texture | null>(null);
  const mark = useRef(
    createReflectionProbeMark({
      shape,
      size,
      radius,
      blendDistance,
      priority,
      intensity,
      parallaxProjection,
      parallaxSize,
      parallaxOffset,
      captureOffset,
      captureMode,
      resolution,
      near,
      far,
      cullMask,
      captureShadows,
    }),
  );
  const config: ReflectionProbeConfig = {
    shape,
    size,
    radius,
    blendDistance,
    priority,
    intensity,
    parallaxProjection,
    parallaxSize,
    parallaxOffset,
    captureOffset,
    captureMode,
    resolution,
    near,
    far,
    cullMask,
    captureShadows,
  };

  useLayoutEffect(() => {
    mark.current.updateConfig(config);
  }, [
    shape,
    size,
    radius,
    blendDistance,
    priority,
    intensity,
    parallaxProjection,
    parallaxSize,
    parallaxOffset,
    captureOffset,
    captureMode,
    resolution,
    near,
    far,
    cullMask,
    captureShadows,
  ]);

  useLayoutEffect(() => {
    const object = group.current;
    if (!object) return;
    const acquired = acquireReflectionProbeRegistry(renderer, scene);
    lease.current = acquired;
    unregister.current = acquired.registry.registerProbe(object, mark.current);
    unobserve.current = acquired.registry.observe((probes: readonly ReflectionProbeRuntime[]) => {
      const self = probes.find((probe) => probe.node === object);
      const published = self?.ready ? self.texture : null;
      // Runs every update; React re-renders only when the published texture
      // actually changes identity, which is once per capture at most.
      setEnvMap((current) => (current === published ? current : published));
    });
    return () => {
      unobserve.current?.();
      unobserve.current = null;
      unregister.current?.();
      unregister.current = null;
      lease.current?.release();
      lease.current = null;
    };
  }, [renderer, scene]);

  useFrame((state) => lease.current?.registry.update(state.clock.elapsedTime));

  return (
    <group
      ref={group}
      name={name}
      {...groupProps}
      // The live mark is ordinary R3F data on the node this component owns,
      // merged over any userData the author passed in.
      userData={{ ...groupProps.userData, reflectionProbe: mark.current }}
    >
      {typeof children === 'function' ? children({ envMap, envMapIntensity: intensity }) : children}
    </group>
  );
}
