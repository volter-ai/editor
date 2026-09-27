/**
 * Every player in the game room, drawn from the room's replicated state, and this client's own
 * player moved by the game's movement actions (`src/input.ts`: WASD or the arrows, or a tester's
 * virtual hold). The server owns positions and scores
 * (`server/rooms/game-room.ts`): this component sends where it wants to be (`position`) and draws
 * what the state says, orbs included.
 *
 * It joins on its first FRAME, not on mount: the editor mounts the world in Edit to author it and
 * never advances its frames there, so a connection is made only where the world runs.
 */

import type { Room } from '@colyseus/sdk';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { actionPressed } from '../input';
import { joinGameRoom } from './game-room';

interface PlayerView {
  readonly id: string;
  readonly name: string;
  readonly color: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly score: number;
}

interface OrbView {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

/** Units per second a held key moves this client's player. */
const SPEED = 4;
/** How often this client tells the server where it is. */
const SEND_INTERVAL = 0.05;
const ARENA_HALF = 7.5;

interface StateShape {
  players: { forEach(fn: (player: Omit<PlayerView, 'id'> & { sessionId: string }, id: string) => void): void };
  orbs: { forEach(fn: (orb: OrbView, id: string) => void): void };
}

export function NetworkedPlayers({ name = 'Networked Players' }: { readonly name?: string }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [running, setRunning] = useState(false);
  const [players, setPlayers] = useState<readonly PlayerView[]>([]);
  const [orbs, setOrbs] = useState<readonly OrbView[]>([]);
  const own = useRef<{ x: number; z: number } | null>(null);
  const sinceSend = useRef(0);

  useEffect(() => {
    if (!running) return;
    let joined: Room | null = null;
    let left = false;
    joinGameRoom()
      .then((next) => {
        if (left) {
          void next.leave();
          return;
        }
        joined = next;
        setRoom(next);
        next.onStateChange((state: StateShape) => {
          const nextPlayers: PlayerView[] = [];
          // Schema fields are accessors, so each is read by name.
          state.players.forEach((player, id) =>
            nextPlayers.push({
              id,
              name: player.name,
              color: player.color,
              x: player.x,
              y: player.y,
              z: player.z,
              score: player.score,
            }),
          );
          const nextOrbs: OrbView[] = [];
          state.orbs.forEach((orb, id) => nextOrbs.push({ id, x: orb.x, z: orb.z }));
          setPlayers(nextPlayers);
          setOrbs(nextOrbs);
          const mine = nextPlayers.find((player) => player.id === next.sessionId);
          if (mine && !own.current) own.current = { x: mine.x, z: mine.z };
        });
      })
      .catch((error: unknown) => {
        console.warn(
          `Could not join the game room (${String(error)}). The room server is the \`server\` ` +
            'configuration: run `play + server`, or `npm run server` beside Play.',
        );
      });
    return () => {
      left = true;
      void joined?.leave();
    };
  }, [running]);

  useFrame((_, delta) => {
    if (!running) setRunning(true);
    const position = own.current;
    if (!room || !position) return;
    const dx = (actionPressed('right') ? 1 : 0) - (actionPressed('left') ? 1 : 0);
    const dz = (actionPressed('back') ? 1 : 0) - (actionPressed('forward') ? 1 : 0);
    if (dx !== 0 || dz !== 0) {
      const length = Math.hypot(dx, dz);
      position.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, position.x + (dx / length) * SPEED * delta));
      position.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, position.z + (dz / length) * SPEED * delta));
    }
    sinceSend.current += delta;
    if (sinceSend.current >= SEND_INTERVAL && (dx !== 0 || dz !== 0)) {
      sinceSend.current = 0;
      room.send('position', { x: position.x, y: 0, z: position.z });
    }
  });

  return (
    <group name={name}>
      {players.map((player) => (
        <mesh key={player.id} name={player.name || player.id} position={[player.x, 0.45, player.z]} castShadow>
          <sphereGeometry args={[0.45, 24, 16]} />
          <meshStandardMaterial color={player.color} />
        </mesh>
      ))}
      {orbs.map((orb) => (
        <mesh key={orb.id} name={`Orb ${orb.id}`} position={[orb.x, 0.35, orb.z]}>
          <icosahedronGeometry args={[0.22, 1]} />
          <meshStandardMaterial color="#ffe27a" emissive="#ffb400" emissiveIntensity={0.8} />
        </mesh>
      ))}
    </group>
  );
}
