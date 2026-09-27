import type { ThreeElements } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import {
  ArenaArchitecture,
  ArenaAtmosphere,
  SkyDome,
  Sun,
} from '../components/environment/ArenaEnvironment';
import { Enemy } from '../prefabs/Enemy';
import { JumpPad } from '../prefabs/JumpPad';
import { Player } from '../prefabs/Player';
import { WeaponPickup } from '../prefabs/WeaponPickup';

/** The complete, replaceable first-person arena composition. */
export function ArenaScene({ name = 'Arena Scene', ...props }: ThreeElements['group']) {
  return (
    <group name={name} {...props}>
      <ArenaAtmosphere />
      <SkyDome name="Daylight Sky" scale={180} />
      <hemisphereLight name="SkyFill" args={['#edf8ff', '#90969a', 1.05]} />
      <Sun name="Sun" position={[-24, 32, 18]} />
      <directionalLight name="SkyBounce" position={[24, 16, -20]} intensity={0.5} color="#c7e5f7" />

      <Physics gravity={[0, -19.5, 0]}>
        <ArenaArchitecture name="UnrealStyleArena" />
        <JumpPad name="West Jump Pad" position={[-20, 0.16, 18]} />
        <JumpPad name="East Jump Pad" position={[20, 0.16, 18]} />
        <JumpPad name="Center Jump Pad" position={[0, 0.16, -2]} />
        <WeaponPickup name="Pistol Pickup" kind="pistol" position={[-9, 0.72, 17]} />
        <WeaponPickup name="Rifle Pickup" kind="rifle" position={[9, 0.72, 17]} />
        <WeaponPickup name="Grenade Launcher Pickup" kind="grenade" position={[0, 4.38, -19]} />
        <Enemy name="EnemyAlpha" variant="breacher" position={[0, 0, 8]} rotation={[0, 0, 0]} />
        <Enemy
          name="EnemyBravo"
          variant="breacher"
          position={[10, 0, -12]}
          rotation={[0, -0.2, 0]}
        />
        <Enemy
          name="EnemyCharlie"
          variant="overwatch"
          engageRange={26}
          fireInterval={1.4}
          speed={0.9}
          position={[-20, 2.95, -3]}
          rotation={[0, 0.7, 0]}
        />
        <Enemy
          name="EnemyDelta"
          variant="overwatch"
          engageRange={26}
          fireInterval={1.4}
          speed={0.9}
          position={[19, 2.95, 2]}
          rotation={[0, -0.8, 0]}
        />
        <Player name="PlayerRig" position={[0, 1.72, 24]} />
      </Physics>
    </group>
  );
}
