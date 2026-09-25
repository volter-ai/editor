/**
 * `game` — the game-control half of `@volter/game-live`'s `{ editor, game, page }`.
 * A `GameClient` (`./game-client/`) bound to a `RelayTransport` on the resolved
 * session's port — the SAME session-wire relay (`POST /__editor/command`,
 * `bridge-call`/`bridge-screenshot`/`page-script`) every `EditorClient`
 * method already uses. Never forked: this module only WIRES `GameClient` up,
 * it does not reimplement any of its methods (`state`/`waitFor`/`events`/
 * `input.hold`/`input.tap`/`screenshot`/`command`/`page` — whatever
 * `GameClient` exposes is exposed here, unchanged).
 *
 * When the editor has MORE THAN ONE instance mounted (multiplayer authoring —
 * see the engine's play-mode `mountAdditionalInstance`), `game` alone REFUSES
 * to guess which one a call addresses. `game.instances()` / `game.instance(id)`
 * are the way past that: each returns a `GameClient` whose relay carries a
 * specific mount id (`RelayTransport({ instance })`), so one script can drive
 * several instances — two seats of a match, or one scene under two seeds —
 * without ambiguity.
 */

import { GameClient, RelayTransport } from './game-client/index.js';

/** A `GameClient` addressing ONE mounted instance, tagged with the mount `id`
 *  it drives. `id` is the whole point of the handle to a CALLER: it is what
 *  `tools.run(name, args, { instance: handle.id })` passes to scope a
 *  node-hosted tool to this seat — the two-seat
 *  multiplayer verification pattern. Without it the caller has a client it can
 *  drive but no id to hand a tool, so the seat-scoped path silently degrades to
 *  the sole-instance one. */
export type AddressedGameClient = GameClient & { readonly id: string };

/** `game` plus the instance-addressing surface (see this module's doc). The
 *  base `GameClient` methods are unchanged; a bare call still targets the sole
 *  instance and refuses when several are live. */
export interface LiveGame extends GameClient {
  /**
   * A handle addressing ONE mounted instance by its mount id — a `GameClient`
   * whose every relay call carries `instance: id`, and which exposes that `id`
   * back (`handle.id === id`). Synchronous: it builds a client, it does not
   * contact the editor. (Through the bare top-level `game` singleton it
   * resolves a session first and so returns a promise — the same proxy
   * limitation the singleton documents; the `connect()`/`volter-game-editor eval` form is
   * synchronous.)
   */
  instance(id: string): AddressedGameClient;
  /**
   * Handles for every instance currently mounted, in mount order — each tagged
   * with its own `id`. One round trip (`list-instances`) to enumerate, then one
   * addressed `GameClient` per id. `[]` when nothing is mounted (not playing) —
   * the honest answer.
   */
  instances(): Promise<AddressedGameClient[]>;
  /**
   * Play this many instances split-screen: a total `count` (default "Player N"
   * labels) or `names`, whose length is the count and whose first entry is the
   * primary. The Play bar's player count, as a verb; refused when not playing.
   * The new instances mount asynchronously: `instances()` lists them once they
   * have.
   */
  setInstances(countOrNames: number | readonly string[]): Promise<void>;
}

/**
 * Build a `GameClient` on `port`, optionally addressing one mounted instance.
 *
 * Fence values (`fenceTick`/`fenceSeq`/`fenceSimSeconds`/`fenceWallMs`) are
 * placeholders — tick 0, seq 0, sim-seconds 0, "now" — rather than a real
 * play-mode-start snapshot. A caller that owns its own browser can fence off
 * a FRESH play-mode boot, because it starts from a known instant. A
 * `connect()`ed live session has no such instant — it may attach to an
 * ALREADY-RUNNING game session — so there is no single "run start" to fence
 * from. Practical effect: `game.events.expect(...)` sees the WHOLE event
 * history since play mode started (not a per-call window); every other method
 * (`state`/`waitFor`/`input`/`command`/`screenshot`) is unaffected by the
 * fence. `pageErrors`/`consoleErrors` are always empty — relay mode has no
 * separate page handle to listen on.
 */
function gameClientFor(
  port: number,
  artifactsDir?: string,
  instance?: string,
  projectRoot?: string,
): GameClient {
  return new GameClient({
    transport: new RelayTransport(instance === undefined ? { port } : { port, instance }),
    pageErrors: [],
    consoleErrors: [],
    fenceTick: 0,
    fenceSeq: 0,
    fenceSimSeconds: 0,
    fenceWallMs: Date.now(),
    warmSession: false,
    artifactsDir,
    projectRoot,
  });
}

/** The unaddressed `game` client — targets the sole live instance and refuses
 *  when several are mounted. Kept as a named export for callers/tests that
 *  want just the base client. */
export function createGameClient(
  port: number,
  artifactsDir?: string,
  projectRoot?: string,
): GameClient {
  return gameClientFor(port, artifactsDir, undefined, projectRoot);
}

/** Query the editor's live instance ids over the session wire.
 *
 *  `list-instances` is a session-level command (`command-listener.ts`), NOT a
 *  `bridge-call` method: it answers "which instances exist", and the
 *  bridge-call path RESOLVES an instance (refusing when several are live), so
 *  routing this through it would hit the exact ambiguity it throws on. The
 *  response spreads `data` at the top level, so the ids arrive as
 *  `body.instances`. */
async function listInstanceIds(port: number): Promise<string[]> {
  const res = await fetch(`http://127.0.0.1:${port}/__editor/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'list-instances' }),
  });
  const body = (await res.json()) as { ok?: boolean; instances?: unknown; error?: string };
  if (!body.ok || !Array.isArray(body.instances)) {
    throw new Error(`@volter/game-live: list-instances failed — ${body.error ?? 'no instances in reply'}`);
  }
  return body.instances.map(String);
}

/** Ask the editor for this many split-screen instances (`set-instance-count`,
 *  a session-level command like `list-instances`). */
async function setInstanceCount(port: number, countOrNames: number | readonly string[]): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${port}/__editor/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      typeof countOrNames === 'number'
        ? { type: 'set-instance-count', count: countOrNames }
        : { type: 'set-instance-count', names: [...countOrNames] },
    ),
  });
  const body = (await res.json()) as { ok?: boolean; error?: string };
  if (!body.ok) {
    throw new Error(`@volter/game-live: set-instance-count failed — ${body.error ?? 'no reason given'}`);
  }
}

/** Build the `LiveGame` — the base `game` client plus its instance-addressing
 *  surface. */
export function createLiveGame(
  port: number,
  artifactsDir?: string,
  projectRoot?: string,
): LiveGame {
  const base = gameClientFor(port, artifactsDir, undefined, projectRoot);
  // Tag each addressed handle with the mount id it drives, so a caller can pass
  // `handle.id` to `tools.run(..., { instance })`. The id is already known here
  // (it is what parameterizes the relay); attaching it just hands it back.
  const instance = (id: string): AddressedGameClient =>
    Object.assign(gameClientFor(port, artifactsDir, id, projectRoot), { id });
  const instances = async (): Promise<AddressedGameClient[]> =>
    (await listInstanceIds(port)).map(instance);
  const setInstances = (countOrNames: number | readonly string[]): Promise<void> =>
    setInstanceCount(port, countOrNames);
  return Object.assign(base, { instance, instances, setInstances });
}
