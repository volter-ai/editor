/**
 * Room registry — defines all available Colyseus rooms, passed to
 * `startColyseus({ rooms, ... })` (colyseus-setup.ts) to call server.define()
 * for each. Imported by the e2e showcase harness
 * (packages/editor/e2e/helpers/colyseus.ts) and the unit-test in-process
 * loopback server (packages/editor/test/helpers/colyseus-loopback.ts).
 */

import { ArenaRoom } from './rooms/arena-room.js';
import { GameRoom } from './rooms/game-room.js';

export const rooms = [
  { name: 'game_room', handler: GameRoom, matchBy: ['vgaiPlaytest'] },
  { name: 'arena_room', handler: ArenaRoom, matchBy: ['vgaiPlaytest'] },
];
