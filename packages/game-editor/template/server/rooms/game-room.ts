/**
 * GameRoom — multiplayer arena with collectible orbs.
 *
 * Uses @colyseus/schema state sync (the idiomatic Colyseus pattern).
 * Server mutates Schema state directly; Colyseus encodes deltas and
 * syncs them to all clients automatically.
 *
 * Messages (client → server only):
 *   position  { x, y, z }   — client movement input
 *   __vgai:debugCommand { name, args, requestId } — a `locus: 'server'`
 *     debug command's client leg (the "Multiplayer locus" note,
 *     build plan Task 4.2); see
 *     `DEBUG_COMMANDS`/`onCreate` below.
 *
 * Everything else (players, orbs, scores) is synchronized via Schema
 * state: new joiners receive the full state automatically, and ongoing
 * changes are delta-encoded at the patch rate (~20 Hz).
 */

import { Room, type Client } from 'colyseus';
import { Schema, MapSchema, type } from '@colyseus/schema';

// --- Constants ---

const COLORS = [0xff6644, 0x44ff99, 0x4499ff, 0xffee44, 0xff44bb, 0x44ffee, 0xaa44ff, 0xff4488];
const NAMES  = ['Coral', 'Mint', 'Sky', 'Gold', 'Rose', 'Teal', 'Violet', 'Crimson'];
const ARENA_HALF = 7.5;
const SPAWN_RADIUS = 5;
const MAX_ORBS = 6;
const COLLECT_RADIUS_SQ = 1.0;
const ORB_RESPAWN_MS = 3_000;
const SIM_INTERVAL_MS = 50;
/** How much room a joining player gets from the nearest orb — twice the
 *  collect radius, so a spawn never sits on the edge of a pickup either. */
const SPAWN_CLEARANCE_SQ = COLLECT_RADIUS_SQ * 4;
/** Evenly spaced candidate angles `chooseSpawnPosition` scans. Enough that a
 *  clear angle always falls inside the widest gap the orbs can leave. */
const SPAWN_ANGLE_SAMPLES = 64;

// --- Schema definitions ---

class PlayerSchema extends Schema {
  @type('string') sessionId = '';
  @type('string') name = '';
  @type('uint32') color = 0;
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('float32') z = 0;
  @type('uint16') score = 0;
}

class OrbSchema extends Schema {
  @type('string') id = '';
  @type('float32') x = 0;
  @type('float32') z = 0;
}

class GameState extends Schema {
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type({ map: OrbSchema }) orbs = new MapSchema<OrbSchema>();
}

// --- Helpers ---

let nextOrbId = 0;

/**
 * The `locus: 'server'` debug-command table (Task 4.2) — one worked example,
 * `give-score`, demonstrating the same declared-fixture rule as client-side
 * debug commands: mutates the AUTHORITATIVE
 * (server) copy of state, never client prediction. Gated by
 * `allowDebugCommands` — see `onCreate` — so a production `npm run server`
 * boot never accepts these unless explicitly opted in.
 */
const DEBUG_COMMANDS: Record<string, (room: GameRoom, client: Client, args: unknown[]) => unknown> =
  {
    'give-score': (room, client, args) => {
      const amount = typeof args[0] === 'number' ? args[0] : 1;
      const player = room.state.players.get(client.sessionId);
      if (!player) throw new Error(`give-score: no player for session "${client.sessionId}"`);
      player.score += amount;
      return { score: player.score };
    },
  };

/**
 * Pick a spawn point on the spawn circle that is CLEAR of every orb.
 *
 * A raw random angle can drop a joining player straight onto a pickup, and
 * the very next simulation tick collects it: a free point nobody's rules
 * awarded, and — because the roll happens at join — a room whose score is
 * non-deterministic from tick zero. That is exactly what made
 * `tests/logic/room.test.ts` fail intermittently, and no assertion tolerance
 * would have fixed it, because the defect is here.
 *
 * The spawn stays random: `angleOffset` is a random angle, and this only
 * rejects the angles that land on a pickup. Scanning a fixed number of evenly
 * spaced candidates (rather than re-rolling until clear) makes the search
 * terminate in bounded time; if every candidate were blocked — impossible
 * with the current constants, but the code must not pretend otherwise — the
 * roomiest one wins.
 *
 * Pure, and exported, so the clearance is provable in `tests/logic/` without
 * booting a server.
 */
export function chooseSpawnPosition(
  orbs: Iterable<{ x: number; z: number }>,
  angleOffset: number = Math.random() * Math.PI * 2,
): { x: number; y: number; z: number } {
  const placed = [...orbs];
  let best = { x: SPAWN_RADIUS, y: 0, z: 0 };
  let bestClearanceSq = -1;
  for (let i = 0; i < SPAWN_ANGLE_SAMPLES; i++) {
    const angle = angleOffset + (i * Math.PI * 2) / SPAWN_ANGLE_SAMPLES;
    const candidate = {
      x: Math.cos(angle) * SPAWN_RADIUS,
      y: 0,
      z: Math.sin(angle) * SPAWN_RADIUS,
    };
    let clearanceSq = Number.POSITIVE_INFINITY;
    for (const orb of placed) {
      const dx = candidate.x - orb.x;
      const dz = candidate.z - orb.z;
      clearanceSq = Math.min(clearanceSq, dx * dx + dz * dz);
    }
    if (clearanceSq >= SPAWN_CLEARANCE_SQ) return candidate;
    if (clearanceSq > bestClearanceSq) {
      bestClearanceSq = clearanceSq;
      best = candidate;
    }
  }
  return best;
}

function randomOrbPosition(): { x: number; z: number } {
  return {
    x: (Math.random() - 0.5) * ARENA_HALF * 1.6,
    z: (Math.random() - 0.5) * ARENA_HALF * 1.6,
  };
}

// --- Room ---

export class GameRoom extends Room {
  state = new GameState();
  patchRate = 50;

  private colorIndex = 0;
  // Orb respawns are counted in simulation ticks, not `this.clock` timers, so
  // the room's timing is driven entirely by `setSimulationInterval` and is
  // reproducible from the tick count alone.
  private orbRespawnTicks: number[] = [];

  onCreate(options?: { allowDebugCommands?: boolean }) {
    // Off by default (FROZEN DECISION: env-var OR room-option) — the loopback harness/
    // the loopback harness (`../loopback.ts`) opt in via the room option; a
    // plain `npm run server` boot never accepts debug commands unless
    // VGAI_ALLOW_DEBUG_COMMANDS is set in its environment.
    const debugCommandsAllowed =
      options?.allowDebugCommands === true || Boolean(process.env['VGAI_ALLOW_DEBUG_COMMANDS']);

    // Handle client messages
    this.onMessage('position', (client, position: { x: number; y: number; z: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, position.x));
        player.y = position.y;
        player.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, position.z));
      }
    });

    this.onMessage(
      '__vgai:debugCommand',
      (client, message: { name: string; args?: unknown[]; requestId: string }) => {
        if (!debugCommandsAllowed) {
          client.send('__vgai:debugCommandResult', {
            requestId: message.requestId,
            ok: false,
            error: 'debug commands disabled',
          });
          return;
        }
        const handler = DEBUG_COMMANDS[message.name];
        if (!handler) {
          client.send('__vgai:debugCommandResult', {
            requestId: message.requestId,
            ok: false,
            error: `debug: no server command registered under "${message.name}"`,
          });
          return;
        }
        try {
          const result = handler(this, client, message.args ?? []);
          client.send('__vgai:debugCommandResult', {
            requestId: message.requestId,
            ok: true,
            result,
          });
        } catch (err) {
          client.send('__vgai:debugCommandResult', {
            requestId: message.requestId,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );

    // Spawn initial orbs
    for (let i = 0; i < MAX_ORBS; i++) {
      this.spawnOrb();
    }

    // Server game loop at 20 Hz — check orb collection, tick pending respawns
    this.setSimulationInterval(() => {
      for (let i = this.orbRespawnTicks.length - 1; i >= 0; i--) {
        if (--this.orbRespawnTicks[i]! <= 0) {
          this.orbRespawnTicks.splice(i, 1);
          this.spawnOrb();
        }
      }

      for (const [orbId, orb] of this.state.orbs) {
        for (const player of this.state.players.values()) {
          const dx = player.x - orb.x;
          const dz = player.z - orb.z;
          if (dx * dx + dz * dz < COLLECT_RADIUS_SQ) {
            player.score++;
            this.state.orbs.delete(orbId);
            this.orbRespawnTicks.push(Math.ceil(ORB_RESPAWN_MS / SIM_INTERVAL_MS));
            break; // one collection per orb per tick
          }
        }
      }
    }, SIM_INTERVAL_MS);
  }

  onJoin(client: Client, options?: { color?: number; name?: string }) {
    const idx = this.colorIndex % COLORS.length;
    const color = (options?.color != null) ? options.color : COLORS[idx]!;
    const name = options?.name ?? NAMES[idx]!;
    this.colorIndex++;

    const pos = chooseSpawnPosition(this.state.orbs.values());
    const player = new PlayerSchema();
    player.sessionId = client.sessionId;
    player.name = name;
    player.color = color;
    player.x = pos.x;
    player.y = pos.y;
    player.z = pos.z;
    player.score = 0;

    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client, _code?: number) {
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    // Room cleanup
  }

  private spawnOrb() {
    const id = `orb_${nextOrbId++}`;
    const pos = randomOrbPosition();
    const orb = new OrbSchema();
    orb.id = id;
    orb.x = pos.x;
    orb.z = pos.z;
    this.state.orbs.set(id, orb);
  }
}
