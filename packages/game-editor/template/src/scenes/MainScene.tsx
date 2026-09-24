import { OrbitControls } from '@react-three/drei/core/OrbitControls';
import { PerspectiveCamera } from '@react-three/drei/core/PerspectiveCamera';
import type { ThreeElements } from '@react-three/fiber';
import { useRef } from 'react';
import type * as THREE from 'three';
import { DaylightSky } from '../components/environment/DaylightSky';
import { Ground } from '../components/environment/Ground';
import { SceneAtmosphere } from '../components/environment/SceneAtmosphere';
import { SoftGroundShadow } from '../components/environment/SoftGroundShadow';
import { SunShadowFit } from '../components/environment/SunShadowFit';
import { HeroBox } from '../prefabs/HeroBox';

/**
 * The complete neutral starter composition. A scene arranges environment,
 * placeable prefabs, and the camera; it is not itself a Content prefab and
 * should not hide independently placeable entities inside one scenery owner.
 */
export function MainScene({ name = 'Main Scene', ...props }: ThreeElements['group']) {
  const sun = useRef<THREE.DirectionalLight>(null);
  return (
    <group name={name} {...props}>
      <SceneAtmosphere />
      <group name="Environment">
        <DaylightSky name="Daylight Sky" />
        <group name="Light Rig">
          <hemisphereLight name="Sky Fill" args={['#e9f8ff', '#87958f', 1.55]} />
          {/* The sun's position is its DIRECTION; `SunShadowFit` moves the node
              and sizes the shadow box from what the camera frames, so the box
              carries no hardcoded scale. Authored lateral extents and depth
              range would be overwritten and are deliberately absent — see that
              component's header for why ±12 units broke every game built at a
              scale other than this scene's. `shadow-bias` is a fraction of the
              fitted depth range, so it stays authored here. */}
          <directionalLight
            ref={sun}
            name="Sun"
            position={[10, 14, 7]}
            intensity={2.7}
            color="#fff4dc"
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-bias={-0.00015}
          />
          <SunShadowFit light={sun} />
          <directionalLight
            name="Cool Fill"
            position={[-7, 7, -9]}
            intensity={0.55}
            color="#b8dcff"
          />
        </group>
        <Ground name="Ground" />
        <SoftGroundShadow name="Soft Ground Shadow" />
      </group>

      <HeroBox name="Hero Box" position={[0, 1.3, 0]} rotation={[0, -0.28, 0]} color="#c8dce1" />
      <PerspectiveCamera
        makeDefault
        name="Camera"
        position={[7.35, 3.9, 8.15]}
        fov={41}
        near={0.1}
        far={220}
      />
      <OrbitControls
        makeDefault
        target={[0, 1.15, 0]}
        enablePan={false}
        minDistance={6.5}
        maxDistance={16}
        minPolarAngle={0.55}
        maxPolarAngle={1.38}
      />
    </group>
  );
}
