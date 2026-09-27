import { useGLTF } from '@react-three/drei/core/Gltf';
import { type ThreeElements, useThree } from '@react-three/fiber';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ENEMY_MODEL_PATHS } from '../../prefabs/Enemy';
import { VANGUARD_PATH } from '../../prefabs/Player';
import { WEAPON_PATHS } from '../../prefabs/WeaponModel';

type Vec3 = [number, number, number];
const PALETTE = {
  floor: '#d9dad7',
  floorLine: '#b1b5b6',
  wall: '#69727b',
  wallLine: '#4f5962',
  wallLight: '#90979c',
  orange: '#ef8b21',
  orangeLine: '#bd6215',
};

export function ArenaRenderFinish() {
  const renderer = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  useEffect(() => {
    const previousToneMapping = renderer.toneMapping;
    const previousExposure = renderer.toneMappingExposure;
    const previousShadowType = renderer.shadowMap?.type;
    const previousShadowEnabled = renderer.shadowMap?.enabled;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    if (renderer.shadowMap) {
      // The sun/meshes have declared shadow config all along, but nothing
      // ever flipped the renderer's master switch — required now that the
      // player's own body ships as a shadow avatar (PlayerBodyAnimation).
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      // three does NOT recompile already-compiled materials when the shadow
      // master switch flips — programs built before this effect keep their
      // no-shadow variant silently. Force the recompile once.
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.needsUpdate = true;
      });
    }
    return () => {
      renderer.toneMapping = previousToneMapping;
      renderer.toneMappingExposure = previousExposure;
      if (renderer.shadowMap && previousShadowType !== undefined) {
        renderer.shadowMap.type = previousShadowType;
        renderer.shadowMap.enabled = previousShadowEnabled ?? false;
      }
    };
  }, [renderer, scene]);
  return null;
}

export function ArenaAtmosphere() {
  const scene = useThree((state) => state.scene);
  useEffect(() => {
    const previousBackground = scene.background;
    const previousFog = scene.fog;
    scene.background = new THREE.Color('#91bdd8');
    scene.fog = new THREE.Fog('#b7cbd3', 90, 175);
    return () => {
      scene.background = previousBackground;
      scene.fog = previousFog;
    };
  }, [scene]);
  return null;
}

function useConstructionMaterial(color: string, lineColor: string, tileSize: number) {
  return useMemo(() => {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.78,
      metalness: 0.02,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          'void main() {',
          `varying vec3 vConstructionPosition;
           varying vec3 vConstructionNormal;
           void main() {`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
           vConstructionNormal = objectNormal;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vConstructionPosition = position;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'void main() {',
          `varying vec3 vConstructionPosition;
           varying vec3 vConstructionNormal;
           void main() {`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
           vec3 constructionNormal = abs(normalize(vConstructionNormal));
           vec2 constructionUv = constructionNormal.x > constructionNormal.y && constructionNormal.x > constructionNormal.z
             ? vConstructionPosition.yz
             : (constructionNormal.y > constructionNormal.z ? vConstructionPosition.xz : vConstructionPosition.xy);
           vec2 constructionCell = abs(fract(constructionUv / ${tileSize.toFixed(4)} - 0.5) - 0.5) / fwidth(constructionUv / ${tileSize.toFixed(4)});
           float constructionLine = 1.0 - min(min(constructionCell.x, constructionCell.y), 1.0);
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${new THREE.Color(lineColor)
             .toArray()
             .map((value) => value.toFixed(5))
             .join(', ')}), constructionLine * 0.58);`,
        );
    };
    material.customProgramCacheKey = () => `construction-${color}-${lineColor}-${tileSize}`;
    return material;
  }, [color, lineColor, tileSize]);
}

type GridBlockProps = ThreeElements['mesh'] & {
  /** Override the auto cuboid with a top-aligned collider this many metres
   *  thick (for thin walkable slabs — see the note inside GridBlock). */
  colliderThickness?: number;
  size: Vec3;
  color?: string;
  lineColor?: string;
  tileSize?: number;
};

/**
 * A block of the arena — and, because every block here is something you stand
 * on or bump into, a static body. The cuboid collider is derived from this very
 * `boxGeometry`, so the shape you see and the shape you collide with cannot
 * drift apart: moving a block in the editor moves its collider with it.
 */
function GridBlock({
  size,
  color = PALETTE.wall,
  lineColor = PALETTE.wallLine,
  tileSize = 1,
  colliderThickness,
  ...meshProps
}: GridBlockProps) {
  const material = useConstructionMaterial(color, lineColor, tileSize);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <RigidBody type="fixed" colliders={colliderThickness === undefined ? 'cuboid' : false}>
      <mesh {...meshProps} castShadow receiveShadow>
        <boxGeometry args={size} />
        <primitive object={material} attach="material" />
        {/* A thin walkable slab keeps its authored VISUAL but takes a
            thicker, top-aligned collider: the character controller's ground
            probe reaches 0.47 m (offset + snapToGround), so a 0.30 m slab
            flickers ground contact and can be fallen through — the game's
            own thin-foothold diagnostic names this exact remedy. */}
        {colliderThickness !== undefined && (
          <CuboidCollider
            args={[size[0] / 2, colliderThickness / 2, size[2] / 2]}
            position={[0, size[1] / 2 - colliderThickness / 2, 0]}
          />
        )}
      </mesh>
    </RigidBody>
  );
}

export function SkyDome(props: ThreeElements['mesh']) {
  return (
    <mesh {...props}>
      <sphereGeometry args={[1, 64, 32]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        vertexShader={`
          varying vec3 vWorldPosition;
          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
          }
        `}
        fragmentShader={`
          varying vec3 vWorldPosition;
          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }
          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                       mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
          }
          float fbm(vec2 p) {
            float value = 0.0;
            float amplitude = 0.5;
            for (int i = 0; i < 5; i++) {
              value += noise(p) * amplitude;
              p = p * 2.03 + vec2(4.7, 8.2);
              amplitude *= 0.5;
            }
            return value;
          }
          void main() {
            vec3 direction = normalize(vWorldPosition - cameraPosition);
            float horizonMix = smoothstep(-0.08, 0.72, direction.y);
            vec3 horizon = vec3(0.68, 0.82, 0.91);
            vec3 zenith = vec3(0.22, 0.49, 0.72);
            vec3 color = mix(horizon, zenith, horizonMix);
            vec2 cloudUv = direction.xz / max(direction.y + 0.34, 0.2);
            float cloudNoise = fbm(cloudUv * 0.72 + vec2(7.4, 2.1));
            float cloudMask = smoothstep(0.59, 0.73, cloudNoise) * smoothstep(0.02, 0.22, direction.y);
            float cloudShade = fbm(cloudUv * 1.42 + vec2(2.6, 9.7));
            vec3 cloudColor = mix(vec3(0.72, 0.78, 0.81), vec3(0.98, 0.985, 0.98), cloudShade);
            color = mix(color, cloudColor, cloudMask * 0.88);
            vec3 sunDirection = normalize(vec3(-0.62, 0.42, -0.66));
            float sunDot = max(dot(direction, sunDirection), 0.0);
            color += vec3(1.0, 0.72, 0.35) * pow(sunDot, 18.0) * 0.10;
            color += vec3(1.0, 0.95, 0.79) * pow(sunDot, 1100.0) * 1.18;
            gl_FragColor = vec4(color, 1.0);
          }
        `}
      />
    </mesh>
  );
}

export function ArenaArchitecture(props: ThreeElements['group']) {
  return (
    <group {...props}>
      <GridBlock
        name="ArenaFloor"
        userData={{ navRole: 'walkable' }}
        position={[0, -0.5, 0]}
        size={[60, 1, 60]}
        color={PALETTE.floor}
        lineColor={PALETTE.floorLine}
        tileSize={2}
      />

      <GridBlock name="NorthWall" position={[0, 4, -29.5]} size={[60, 8, 1]} tileSize={2} />
      <GridBlock name="WestWall" position={[-29.5, 4, 0]} size={[1, 8, 60]} tileSize={2} />
      <GridBlock name="EastWall" position={[29.5, 4, 0]} size={[1, 8, 60]} tileSize={2} />
      <GridBlock name="SouthWestWall" position={[-20, 4, 29.5]} size={[20, 8, 1]} tileSize={2} />
      <GridBlock name="SouthEastWall" position={[20, 4, 29.5]} size={[20, 8, 1]} tileSize={2} />
      {/* The south wall has a 20 m gap in the art, and the arena's old movement
          code quietly fenced it with a ±28.3 clamp — an invisible wall nothing
          in the scene described. It is described here now: a collider with no
          mesh, authored where the rest of the level is authored. */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider name="SouthGateBarrier" args={[10, 4, 0.5]} position={[0, 4, 29.5]} />
      </RigidBody>

      <GridBlock
        name="NorthDeck"
        position={[0, 1.75, -19]}
        size={[24, 3.5, 11]}
        color={PALETTE.wallLight}
        lineColor={PALETTE.wallLine}
        tileSize={2}
      />
      <GridBlock
        name="NorthDeckTop"
        userData={{ navRole: 'walkable' }}
        position={[0, 3.55, -19]}
        size={[26, 0.35, 13]}
        color={PALETTE.floor}
        lineColor={PALETTE.floorLine}
        tileSize={2}
      />
      <GridBlock
        name="NorthRamp"
        userData={{ navRole: 'walkable' }}
        position={[0, 1.65, -8.1]}
        size={[10, 0.65, 12]}
        rotation={[0.255, 0, 0]}
        color={PALETTE.orange}
        lineColor={PALETTE.orangeLine}
        tileSize={2}
      />

      <GridBlock
        name="WestDeck"
        position={[-20, 1.35, -2]}
        size={[12, 2.7, 15]}
        color={PALETTE.wall}
        lineColor={PALETTE.wallLine}
        tileSize={2}
      />
      <GridBlock
        name="WestDeckTop"
        userData={{ navRole: 'walkable' }}
        position={[-20, 2.78, -2]}
        size={[13, 0.3, 16]}
        colliderThickness={0.5}
        color={PALETTE.floor}
        lineColor={PALETTE.floorLine}
        tileSize={2}
      />
      <GridBlock
        name="WestRamp"
        userData={{ navRole: 'walkable' }}
        position={[-12.9, 1.38, -2]}
        size={[10, 0.65, 8]}
        rotation={[0, 0, -0.25]}
        color={PALETTE.orange}
        lineColor={PALETTE.orangeLine}
        tileSize={2}
      />

      <GridBlock
        name="EastDeck"
        position={[20, 1.35, 1]}
        size={[12, 2.7, 15]}
        color={PALETTE.wall}
        lineColor={PALETTE.wallLine}
        tileSize={2}
      />
      <GridBlock
        name="EastDeckTop"
        userData={{ navRole: 'walkable' }}
        position={[20, 2.78, 1]}
        size={[13, 0.3, 16]}
        colliderThickness={0.5}
        color={PALETTE.floor}
        lineColor={PALETTE.floorLine}
        tileSize={2}
      />
      <GridBlock
        name="EastRamp"
        userData={{ navRole: 'walkable' }}
        position={[12.9, 1.38, 1]}
        size={[10, 0.65, 8]}
        rotation={[0, 0, 0.25]}
        color={PALETTE.orange}
        lineColor={PALETTE.orangeLine}
        tileSize={2}
      />

      <GridBlock
        name="CenterBridge"
        userData={{ navRole: 'walkable' }}
        position={[0, 3.4, 3]}
        size={[15, 0.7, 5]}
        color={PALETTE.wallLight}
        lineColor={PALETTE.wallLine}
        tileSize={1}
      />
      <GridBlock
        name="CenterBridgeAccent"
        position={[0, 2.85, 3]}
        size={[15.8, 0.42, 5.8]}
        color={PALETTE.orange}
        lineColor={PALETTE.orangeLine}
        tileSize={1}
      />

      {/* Round geometry gets a hull rather than the blocks' cuboid — a box
          around a tower would put an invisible corner where the wall curves. */}
      <RigidBody type="fixed" colliders="hull">
        <mesh name="OrangeTower" position={[0, 3, -24]} castShadow receiveShadow>
          <cylinderGeometry args={[3.25, 3.25, 6, 32]} />
          <meshStandardMaterial color={PALETTE.orange} roughness={0.7} />
        </mesh>
      </RigidBody>
      <RigidBody type="fixed" colliders="hull">
        <mesh name="EastOrangeBastion" position={[25, 1.65, -15]} castShadow receiveShadow>
          <cylinderGeometry args={[4.4, 4.4, 3.3, 32]} />
          <meshStandardMaterial color={PALETTE.orange} roughness={0.7} />
        </mesh>
      </RigidBody>
      <GridBlock
        name="EastBastionTop"
        position={[25, 3.5, -15]}
        size={[9.2, 0.4, 9.2]}
        color={PALETTE.wall}
        lineColor={PALETTE.wallLine}
        tileSize={1.5}
      />

      <GridBlock
        name="CoverA"
        position={[-8, 1, 11]}
        size={[5, 2, 2]}
        color={PALETTE.wallLight}
        lineColor={PALETTE.wallLine}
        tileSize={1}
      />
      <GridBlock
        name="CoverB"
        position={[8, 1, 11]}
        size={[5, 2, 2]}
        color={PALETTE.wallLight}
        lineColor={PALETTE.wallLine}
        tileSize={1}
      />
      <GridBlock
        name="CoverC"
        position={[-8, 1, -2]}
        size={[3, 2, 5]}
        color={PALETTE.wallLight}
        lineColor={PALETTE.wallLine}
        tileSize={1}
      />
      <GridBlock
        name="CoverD"
        position={[8, 1, -2]}
        size={[3, 2, 5]}
        color={PALETTE.wallLight}
        lineColor={PALETTE.wallLine}
        tileSize={1}
      />
    </group>
  );
}

export function Sun(props: ThreeElements['directionalLight']) {
  const light = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    // Fiber applies `shadow-camera-*` props but never refreshes the shadow
    // camera's projection (it only auto-updates the DEFAULT camera), so
    // without this the ortho box silently stays at three's ±5 m default and
    // the arena renders shadowless — the player's shadow avatar is the
    // feature that exposed it.
    light.current?.shadow.camera.updateProjectionMatrix();
  }, []);
  return (
    <directionalLight
      ref={light}
      intensity={3.15}
      color="#fff0d2"
      castShadow
      shadow-mapSize-width={2048}
      shadow-mapSize-height={2048}
      shadow-camera-left={-42}
      shadow-camera-right={42}
      shadow-camera-top={42}
      shadow-camera-bottom={-42}
      shadow-camera-near={1}
      shadow-camera-far={100}
      shadow-bias={-0.00018}
      {...props}
    />
  );
}

useGLTF.preload(VANGUARD_PATH);
for (const path of Object.values(ENEMY_MODEL_PATHS)) useGLTF.preload(path);
for (const path of Object.values(WEAPON_PATHS)) useGLTF.preload(path);
