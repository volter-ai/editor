// SPDX-License-Identifier: MIT
// Copyright 2026 Volter AI, Inc.

/**
 * A FIRST PLAY SCRIPT, from `cyclotron add-play`. Play runs `<model>.play.ts` on a detached
 * copy of the `.blend` beside it, so this one drives that model: the arrow keys or WASD move
 * its first object across the ground, Space jumps, and the camera follows. It logs each jump
 * (`cyclotron play-log`), offers the Game panel's Autoplay one behaviour (`wander`), and
 * publishes its state to `game-state.ts`, which the React UI in `src/ui/game.tsx` draws.
 * Positions under `root` are Blender's metres, Z up. Make it your game.
 */
import * as THREE from 'three';
import type { ModelPlayContext, ModelPlayGame } from '@volter/play/play-script';
import { publishGameState } from './game-state';

const SPEED = 4;
const JUMP = 5;
const GRAVITY = 9.81;

export default function firstPlay(play: ModelPlayContext): ModelPlayGame {
  // The first object with a mesh in it: the starter Cube, or whatever this model holds.
  const first = play.root.children.find((object) => {
    let mesh = false;
    object.traverse((child) => { mesh ||= (child as THREE.Mesh).isMesh === true; });
    return mesh;
  });
  const player = first ? play.find(first.name) : null;
  if (!player) throw new Error('This model has no mesh object for its play script to move.');
  const ground = player.position.z;
  let height = 0;
  let rise = 0;
  let jumps = 0;
  let jumpHeld = false;
  const eye = new THREE.Vector3();
  const target = new THREE.Vector3();
  // Play lights the model with its own lamps; the starter cube has none, so it gets a sky light.
  let lit = false;
  play.root.traverse((object) => { lit ||= (object as THREE.Light).isLight === true; });
  const sky = lit ? null : new THREE.HemisphereLight('#ffffff', '#4d5a66', 2.5);
  if (sky) play.root.add(sky);

  // The bot holds keys exactly as a person would; the Game panel's Autoplay switches it on.
  play.autoplay({
    wander: ({ tick }) => {
      const side = [['ArrowUp'], ['ArrowRight'], ['ArrowDown'], ['ArrowLeft']][Math.floor(tick / 60) % 4]!;
      return { keys: tick % 60 === 0 ? [...side, 'Space'] : side, state: 'walking a square, jumping at each corner' };
    },
  });

  return {
    update(dt) {
      const held = (...codes: string[]) => codes.some((code) => play.keys.has(code));
      player.position.x += ((held('ArrowRight', 'KeyD') ? 1 : 0) - (held('ArrowLeft', 'KeyA') ? 1 : 0)) * SPEED * dt;
      player.position.y += ((held('ArrowUp', 'KeyW') ? 1 : 0) - (held('ArrowDown', 'KeyS') ? 1 : 0)) * SPEED * dt;
      if (held('Space') && !jumpHeld && height === 0) {
        rise = JUMP;
        jumps += 1;
        play.log('jump', { jumps, x: player.position.x, y: player.position.y });
      }
      jumpHeld = held('Space');
      rise -= GRAVITY * dt;
      height = Math.max(0, height + rise * dt);
      if (height === 0) rise = 0;
      player.position.z = ground + height;
      // Chase from behind and above. `root` turns Blender's Z up into the stage's Y up.
      play.root.localToWorld(eye.set(player.position.x, player.position.y - 6, ground + 3));
      play.root.localToWorld(target.copy(player.position));
      play.camera.position.copy(eye);
      play.camera.up.set(0, 1, 0);
      play.camera.lookAt(target);
      publishGameState({ x: player.position.x, y: player.position.y, height, jumps });
    },
    dispose() {
      sky?.removeFromParent();
    },
  };
}
