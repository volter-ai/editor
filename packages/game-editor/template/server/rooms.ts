/**
 * Room registry — defines all available Colyseus rooms, passed to
 * `startColyseus({ rooms, ... })` (colyseus-setup.ts) to call server.define()
 * for each.
 */

import { ArenaRoom } from './rooms/arena-room.js';
import { GameRoom } from './rooms/game-room.js';

export const rooms = [
  { name: 'game_room', handler: GameRoom, matchBy: ['volterPlaytest'] },
  { name: 'arena_room', handler: ArenaRoom, matchBy: ['volterPlaytest'] },
];
