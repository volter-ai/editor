/**
 * The client half of this game's multiplayer: joining the room `server/main.ts` serves
 * (`server/rooms/game-room.ts`, run by the `server` configuration on port 2567). The game talks to
 * Colyseus directly — `room.send` its own messages, `room.state` its own schema — and the editor's
 * Network inspector reads the same room by observing it, so nothing here registers anything.
 */

import { Client, type Room } from '@colyseus/sdk';

/** Where the room server listens: the same host the game is served from. */
export const ROOM_SERVER = `ws://${location.hostname || 'localhost'}:2567`;

/** Join (or create) the game room, as a player called `name` when one is given. */
export function joinGameRoom(name?: string): Promise<Room> {
  return new Client(ROOM_SERVER).joinOrCreate('game_room', name ? { name } : {});
}
