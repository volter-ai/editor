import type { ThreeElements } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';

interface DaylightShaderPair {
  readonly vertex: string;
  readonly fragment: string;
}

async function readShader(path: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error(`DaylightSky could not load ${path}: HTTP ${response.status}`);
  return response.text();
}

/** Procedural daylight sky supporting the starter scene. */
export function DaylightSky({ name = 'Daylight Sky', ...props }: ThreeElements['mesh']) {
  const [shaders, setShaders] = useState<DaylightShaderPair | null>(null);
  const uniforms = useMemo(
    () => ({
      uHorizonColor: { value: new THREE.Color('#badbe9') },
      uZenithColor: { value: new THREE.Color('#297aba') },
      uSunColor: { value: new THREE.Color('#fff0c2') },
    }),
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      readShader('/shaders/daylight-sky.vert.glsl', controller.signal),
      readShader('/shaders/daylight-sky.frag.glsl', controller.signal),
    ]).then(
      ([vertex, fragment]) => setShaders({ vertex, fragment }),
      (cause) => {
        // biome-ignore lint/suspicious/noConsole: failed project assets must surface in the editor console.
        if (!controller.signal.aborted) console.error(cause);
      },
    );
    return () => controller.abort();
  }, []);
  if (!shaders) return null;
  return (
    <mesh name={name} scale={150} {...props}>
      <sphereGeometry args={[1, 64, 32]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={shaders.vertex}
        fragmentShader={shaders.fragment}
      />
    </mesh>
  );
}
