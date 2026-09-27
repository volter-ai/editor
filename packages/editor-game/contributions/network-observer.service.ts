/**
 * The page-level observer of a RUNNING game's Colyseus rooms (`@volter/editor-sdk/services`, a
 * `workspace.service` contribution): wraps the page's WebSocket and fetch once, before any game
 * joins a room, so the Network inspector reads a game that declares no networking adapter
 * (`src/services/game-network.ts`). Page-wide and idempotent; a game that joins nothing is not
 * affected.
 */
import { installGameNetwork } from '../src/services/game-network';

export const point = 'workspace.service';

export function start(): void {
  installGameNetwork();
}
