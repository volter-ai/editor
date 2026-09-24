import type { ThreeElements } from '@react-three/fiber';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type * as THREE from 'three';

/**
 * The starter camera's authored orbit distance (|position − target| of the
 * scene's camera rig). Factor 1 of the fit below — at the shipped framing the
 * plane reproduces the exact decor the starter always had, by construction.
 */
const STARTER_VIEW_DISTANCE = 11.3;

/**
 * A lightweight contact shadow with no render-target or asset dependency.
 *
 * SCALE-HONEST like `SunShadowFit` (the WORK.md cm-scale defect, measured
 * 2026-08-29): the plane used to hardcode 4.8×3.2 m at y = 0.028 m, which
 * SLICES through any object under ~10 cm — a 96 mm mug scene wore the decor
 * plane through its middle. A starter must not encode a scale, so the
 * plane's size and hover height are now derived per frame from how far the
 * camera is from what it orbits, exactly the way the sun's shadow box reads
 * its extents from the view. Frame a mug from 26 cm and the plane is ~11 cm
 * wide floating 0.6 mm off the ground; the shipped meter-scale look is
 * unchanged (factor 1 at the authored camera). Authored `position`/`scale`
 * props are deliberately not honored — the fit overwrites them every frame
 * (the SunShadowFit contract); replace the component to author decor by hand.
 */
export function SoftGroundShadow({ name = 'Soft Ground Shadow', ...props }: ThreeElements['mesh']) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(({ camera, controls }) => {
    const m = mesh.current;
    if (!m) return;
    const target = (controls as { target?: THREE.Vector3 } | null)?.target;
    const factor = target ? camera.position.distanceTo(target) / STARTER_VIEW_DISTANCE : 1;
    m.scale.set(4.8 * factor, 3.2 * factor, 1);
    m.position.set(-0.55 * factor, 0.028 * factor, -0.48 * factor);
  });
  return (
    <mesh ref={mesh} name={name} rotation={[-Math.PI / 2, 0, -0.18]} {...props}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          varying vec2 vUv;
          void main() {
            vec2 delta = (vUv - 0.5) * 2.0;
            float falloff = 1.0 - smoothstep(0.05, 1.0, dot(delta, delta));
            gl_FragColor = vec4(0.19, 0.26, 0.29, falloff * falloff * 0.19);
          }
        `}
      />
    </mesh>
  );
}
