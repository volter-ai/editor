/**
 * ArenaRoom — multiplayer tag game with game phases and NPC bots.
 *
 * Server-authoritative: the server owns tag state, validates proximity,
 * runs the phase state machine, and makes NPC behavior decisions.
 * Clients send position input; server broadcasts everything via Schema sync.
 *
 * Phase flow:
 *   lobby → countdown (3s) → playing (60s) → scoreboard (5s) → countdown …
 *
 * Tag rules:
 *   - One player is "it" (taggerId). Server checks proximity each tick.
 *   - Tagged player becomes "it". 1.5s cooldown prevents instant re-tag.
 *   - Non-taggers accumulate score each tick.
 *
 * NPCs:
 *   - Configurable bot count (0–6), spawned on create, stored in the same players MapSchema.
 *   - Server picks behavior (idle/patrol/chase/flee) + target position.
 *   - Client handles smooth navmesh pathfinding.
 *
 * Also handles `__vgai:debugCommand` { name, args, requestId } — a
 * `locus: 'server'` debug command's client leg (the "Multiplayer locus"
 * note);
 * see `DEBUG_COMMANDS`/`onCreate` below.
 */

import { Room, type Client } from '@colyseus/core';
import { Schema, MapSchema, type } from '@colyseus/schema';

// --- Constants ---

const COLORS = [0xff6644, 0x44ff99, 0x4499ff, 0xffee44, 0xff44bb, 0x44ffee, 0xaa44ff, 0xff4488];
const NAMES = ['Coral', 'Mint', 'Sky', 'Gold', 'Rose', 'Teal', 'Violet', 'Crimson'];
const NPC_COLOR = 0x888888;
const MAX_NPCS = 6;
const SPAWN_RADIUS = 5;

const MIN_PLAYERS = 2; // humans + NPCs
const COUNTDOWN_SECS = 3;
const ROUND_SECS = 60;
const SCOREBOARD_SECS = 5;

const TAG_RADIUS_SQ = 2.25; // 1.5 meters squared
const TAG_COOLDOWN_SECS = 1.5;
const FLEE_RADIUS_SQ = 100; // 10 meters squared

const SIM_INTERVAL_MS = 50; // 20 Hz

// NPC patrol waypoint routes
const PATROL_ROUTES = [
  [
    { x: -12, z: -12 },
    { x: 12, z: -12 },
    { x: 12, z: 12 },
    { x: -12, z: 12 },
  ],
  [
    { x: -8, z: 0 },
    { x: 0, z: -8 },
    { x: 8, z: 0 },
    { x: 0, z: 8 },
  ],
];

// --- Schema definitions ---

export class ArenaPlayerSchema extends Schema {
  @type('string') sessionId = '';
  @type('string') name = '';
  @type('uint32') color = 0;
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('float32') z = 0;
  @type('float32') rotY = 0;
  @type('float32') speed = 0;
  @type('uint8') isGrounded = 1;
  @type('boolean') isNPC = false;
  @type('uint16') score = 0;
  @type('string') npcBehavior = 'idle';
}

export class ArenaState extends Schema {
  @type({ map: ArenaPlayerSchema }) players = new MapSchema<ArenaPlayerSchema>();
  @type('string') taggerId = '';
  @type('float32') tagCooldown = 0;
  @type('string') phase = 'lobby';
  @type('float32') phaseTimer = 0;
  @type('uint8') roundNumber = 0;
  @type('string') hostId = '';
}

// --- NPC brain (server-side only, not synced) ---

interface NPCBrain {
  behavior: 'idle' | 'patrol' | 'chase' | 'flee';
  waypointIndex: number;
  routeIndex: number;
  targetX: number;
  targetZ: number;
}

// --- Helpers ---

function randomSpawnPosition(): { x: number; y: number; z: number } {
  const angle = Math.random() * Math.PI * 2;
  return {
    x: Math.cos(angle) * SPAWN_RADIUS,
    y: 0,
    z: Math.sin(angle) * SPAWN_RADIUS,
  };
}

function randomTagger(state: ArenaState): string {
  const ids = [...state.players.keys()];
  if (ids.length === 0) return '';
  return ids[Math.floor(Math.random() * ids.length)]!;
}

/**
 * The `locus: 'server'` debug-command table (build plan
 * Task 4.2) — mirrors `GameRoom`'s `DEBUG_COMMANDS` (`../game-room.ts`), one
 * worked example per room. Mutates the AUTHORITATIVE (server) copy of state,
 * never client prediction. Gated by `allowDebugCommands` — see `onCreate`.
 */
const DEBUG_COMMANDS: Record<
  string,
  (room: ArenaRoom, client: Client, args: unknown[]) => unknown
> = {
  'give-score': (room, client, args) => {
    const amount = typeof args[0] === 'number' ? args[0] : 1;
    const player = room.state.players.get(client.sessionId);
    if (!player) throw new Error(`give-score: no player for session "${client.sessionId}"`);
    player.score += amount;
    return { score: player.score };
  },
};

// --- Room ---

export class ArenaRoom extends Room {
  state = new ArenaState();
  patchRate = 50;

  private colorIndex = 0;
  private npcBrains = new Map<string, NPCBrain>();

  onCreate(options?: { botCount?: number; allowDebugCommands?: boolean }) {
    // Spawn NPC bots (count from room creator, default 2, max 6)
    const npcCount = Math.max(0, Math.min(MAX_NPCS, options?.botCount ?? 2));
    this.spawnNPCs(npcCount);

    // Off by default (FROZEN DECISION: env-var OR room-option) — the loopback harness/
    // the loopback harness (`../loopback.ts`) opt in via the room option; a
    // plain `npm run server` boot never accepts debug commands unless
    // VGAI_ALLOW_DEBUG_COMMANDS is set in its environment.
    const debugCommandsAllowed =
      options?.allowDebugCommands === true || Boolean(process.env['VGAI_ALLOW_DEBUG_COMMANDS']);

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

    // Handle start_game from host
    this.onMessage('start_game', (client) => {
      if (client.sessionId !== this.state.hostId) return;
      if (this.state.phase !== 'lobby') return;
      this.state.phase = 'countdown';
      this.state.phaseTimer = COUNTDOWN_SECS;
    });

    // Handle client input messages
    this.onMessage('input', (client, data: {
      x: number; y: number; z: number;
      rotY: number; speed: number; isGrounded: number;
    }) => {
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.x = data.x;
        player.y = data.y;
        player.z = data.z;
        player.rotY = data.rotY;
        player.speed = data.speed;
        player.isGrounded = data.isGrounded;
      }
    });

    // Server simulation loop (20 Hz)
    const dt = SIM_INTERVAL_MS / 1000;
    this.setSimulationInterval(() => {
      this.updatePhase(dt);
      this.updateTag(dt);
      this.updateNPCs();
      this.moveNPCsTowardTargets(dt);
    }, SIM_INTERVAL_MS);
  }

  onJoin(client: Client, options?: { color?: number; name?: string }) {
    const idx = this.colorIndex % COLORS.length;
    const color = (options?.color != null) ? options.color : COLORS[idx]!;
    const name = options?.name ?? NAMES[idx]!;
    this.colorIndex++;

    const pos = randomSpawnPosition();
    const player = new ArenaPlayerSchema();
    player.sessionId = client.sessionId;
    player.name = name;
    player.color = color;
    player.x = pos.x;
    player.y = pos.y;
    player.z = pos.z;

    this.state.players.set(client.sessionId, player);

    // First human player becomes the host
    if (!this.state.hostId) {
      this.state.hostId = client.sessionId;
    }
  }

  onLeave(client: Client, _code?: number) {
    this.state.players.delete(client.sessionId);

    // If tagger left, reassign
    if (this.state.taggerId === client.sessionId && this.state.phase === 'playing') {
      this.state.taggerId = randomTagger(this.state);
      this.state.tagCooldown = TAG_COOLDOWN_SECS;
    }

    // If host left, reassign to next human player
    if (this.state.hostId === client.sessionId) {
      this.state.hostId = '';
      for (const [id, p] of this.state.players) {
        if (!p.isNPC) {
          this.state.hostId = id;
          break;
        }
      }
    }
  }

  onDispose() {
    // Room cleanup
  }

  // --- NPC spawning ---

  private spawnNPCs(count: number) {
    for (let i = 0; i < count; i++) {
      const npcId = `npc_${i}`;
      const npc = new ArenaPlayerSchema();
      npc.sessionId = npcId;
      npc.name = `Bot-${String.fromCharCode(65 + i)}`; // Bot-A, Bot-B, Bot-C, ...
      npc.color = NPC_COLOR;
      npc.isNPC = true;
      const pos = randomSpawnPosition();
      npc.x = pos.x;
      npc.y = pos.y;
      npc.z = pos.z;
      this.state.players.set(npcId, npc);

      const route = PATROL_ROUTES[i % PATROL_ROUTES.length]!;
      this.npcBrains.set(npcId, {
        behavior: 'idle',
        waypointIndex: 0,
        routeIndex: i % PATROL_ROUTES.length,
        targetX: route[0]!.x,
        targetZ: route[0]!.z,
      });
    }
  }

  // --- Phase state machine ---

  private updatePhase(dt: number) {
    switch (this.state.phase) {
      case 'lobby':
        // Wait for host to send 'start_game'
        break;

      case 'countdown':
        this.state.phaseTimer -= dt;
        if (this.state.phaseTimer <= 0) {
          this.state.phase = 'playing';
          this.state.phaseTimer = ROUND_SECS;
          this.state.roundNumber++;
          this.state.taggerId = randomTagger(this.state);
          this.state.tagCooldown = TAG_COOLDOWN_SECS;
          for (const player of this.state.players.values()) {
            player.score = 0;
            const pos = randomSpawnPosition();
            player.x = pos.x;
            player.y = pos.y;
            player.z = pos.z;
          }
        }
        break;

      case 'playing':
        this.state.phaseTimer -= dt;
        if (this.state.phaseTimer <= 0 || this.state.players.size < MIN_PLAYERS) {
          this.state.phase = 'scoreboard';
          this.state.phaseTimer = SCOREBOARD_SECS;
        }
        break;

      case 'scoreboard':
        this.state.phaseTimer -= dt;
        if (this.state.phaseTimer <= 0) {
          if (this.state.players.size >= MIN_PLAYERS) {
            this.state.phase = 'countdown';
            this.state.phaseTimer = COUNTDOWN_SECS;
          } else {
            this.state.phase = 'lobby';
            this.state.phaseTimer = 0;
          }
        }
        break;
    }
  }

  // --- Tag proximity check ---

  private updateTag(dt: number) {
    if (this.state.phase !== 'playing') return;

    if (this.state.tagCooldown > 0) this.state.tagCooldown -= dt;

    // Increment scores for non-taggers
    for (const player of this.state.players.values()) {
      if (player.sessionId !== this.state.taggerId) {
        player.score++;
      }
    }

    // Check tag proximity
    if (this.state.tagCooldown > 0) return;

    const tagger = this.state.players.get(this.state.taggerId);
    if (!tagger) return;

    for (const [id, player] of this.state.players) {
      if (id === this.state.taggerId) continue;
      const dx = tagger.x - player.x;
      const dz = tagger.z - player.z;
      if (dx * dx + dz * dz < TAG_RADIUS_SQ) {
        this.state.taggerId = id;
        this.state.tagCooldown = TAG_COOLDOWN_SECS;
        break;
      }
    }
  }

  // --- NPC behavior decisions ---

  private updateNPCs() {
    for (const [id, npc] of this.state.players) {
      if (!npc.isNPC) continue;
      const brain = this.npcBrains.get(id);
      if (!brain) continue;

      if (this.state.phase !== 'playing') {
        brain.behavior = 'idle';
        npc.npcBehavior = 'idle';
        npc.speed = 0;
        continue;
      }

      const isTagged = this.state.taggerId === id;

      if (isTagged) {
        // CHASE: find nearest non-tagger
        brain.behavior = 'chase';
        let nearestDistSq = Infinity;
        let nearest: ArenaPlayerSchema | null = null;
        for (const [pid, p] of this.state.players) {
          if (pid === id) continue;
          const dx = npc.x - p.x;
          const dz = npc.z - p.z;
          const dSq = dx * dx + dz * dz;
          if (dSq < nearestDistSq) {
            nearestDistSq = dSq;
            nearest = p;
          }
        }
        if (nearest) {
          brain.targetX = nearest.x;
          brain.targetZ = nearest.z;
        }
        npc.speed = 6.25;
      } else {
        const tagger = this.state.players.get(this.state.taggerId);
        if (tagger) {
          const dx = npc.x - tagger.x;
          const dz = npc.z - tagger.z;
          const dSq = dx * dx + dz * dz;

          if (dSq < FLEE_RADIUS_SQ) {
            // FLEE
            brain.behavior = 'flee';
            const dist = Math.sqrt(dSq) || 1;
            brain.targetX = Math.max(-18, Math.min(18, npc.x + (dx / dist) * 8));
            brain.targetZ = Math.max(-18, Math.min(18, npc.z + (dz / dist) * 8));
            npc.speed = 5.6;
          } else {
            // PATROL
            brain.behavior = 'patrol';
            const route = PATROL_ROUTES[brain.routeIndex]!;
            const wp = route[brain.waypointIndex]!;
            const dwx = npc.x - wp.x;
            const dwz = npc.z - wp.z;
            if (dwx * dwx + dwz * dwz < 4.0) {
              brain.waypointIndex = (brain.waypointIndex + 1) % route.length;
              const next = route[brain.waypointIndex]!;
              brain.targetX = next.x;
              brain.targetZ = next.z;
            } else {
              brain.targetX = wp.x;
              brain.targetZ = wp.z;
            }
            npc.speed = 3.1;
          }
        } else {
          brain.behavior = 'patrol';
          npc.speed = 3.1;
        }
      }

      npc.npcBehavior = brain.behavior;
    }
  }

  // --- Server-side NPC movement (straight-line toward target) ---

  private moveNPCsTowardTargets(dt: number) {
    for (const [id, npc] of this.state.players) {
      if (!npc.isNPC) continue;
      const brain = this.npcBrains.get(id);
      if (!brain || brain.behavior === 'idle') continue;

      const dx = brain.targetX - npc.x;
      const dz = brain.targetZ - npc.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 0.5) continue;

      const moveSpeed = brain.behavior === 'chase' ? 5.0
        : brain.behavior === 'flee' ? 4.5
        : 2.5;

      const step = Math.min(moveSpeed * dt, dist);
      npc.x += (dx / dist) * step;
      npc.z += (dz / dist) * step;
      npc.rotY = Math.atan2(-dx, -dz);
    }
  }
}
