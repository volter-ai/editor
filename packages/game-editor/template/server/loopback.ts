/**
 * Loopback Colyseus server harness for headless multiplayer tests — a
 * near-verbatim copy of the engine repo's own
 * `packages/editor/test/helpers/colyseus-loopback.ts`, shipped INTO every
 * scaffolded project so a multiplayer game can prove itself headlessly:
 * a test under `tests/logic/` seats two peers and drives them. Driving a
 * second peer against the
 * RUNNING game is a different job, and its door is `vgai eval`.
 *
 * Starts the REAL `startColyseus` bootstrap (`./colyseus-setup.js`) with the
 * shipped room registry (`./rooms.js` — `ArenaRoom` + `GameRoom`) on an
 * OS-assigned ephemeral port, in-process. No mocks: this is the exact same
 * `Server` / `WebSocketTransport` a real `npm run server` would boot, just on
 * `port: 0` so concurrent test runs never collide on `2567`.
 *
 * Usage:
 * ```ts
 * const server = await startLoopbackColyseus();
 * try {
 *   const client = new Client(server.url);
 *   const room = await client.joinOrCreate('game_room', {}, undefined, undefined, {
 *     allowDebugCommands: true,
 *   });
 *   // ...
 * } finally {
 *   server.stop();
 * }
 * ```
 */

import { startColyseus } from './colyseus-setup.js';
import { rooms } from './rooms.js';

export interface LoopbackColyseus {
  /** `ws://127.0.0.1:<port>` — the ephemeral port the server actually bound. */
  url: string;
  /** Tear down the server (closes the underlying HTTP/WS server). */
  stop: () => void;
}

/**
 * `@colyseus/core`'s matchmaker setup unconditionally `import("@pm2/io")`s and
 * registers metrics, which makes `@pm2/io` probe `process.send` and start
 * speaking the PM2 agent protocol (`axm:*` messages) over it. Under vitest's
 * forked worker pool, `process.send` is real (the runner's own parent<->child
 * channel), so those messages get relayed to the parent and crash its
 * deserializer — nothing to do with this test's own logic. Patch `process.send`
 * to drop only `axm:*` payloads for the harness's lifetime; everything else
 * (vitest's own protocol) passes through untouched.
 */
function suppressPm2IoIpcNoise(): () => void {
  const original = process.send?.bind(process);
  if (!original) return () => {};
  const patched = (message: unknown, ...rest: unknown[]): boolean => {
    const type = (message as { type?: unknown } | null)?.type;
    if (typeof type === 'string' && type.startsWith('axm:')) return true;
    return (original as (...a: unknown[]) => boolean)(message, ...rest);
  };
  process.send = patched as NonNullable<typeof process.send>;
  return () => {
    process.send = original;
  };
}

/** Boot the real Colyseus server on an ephemeral loopback port. */
export async function startLoopbackColyseus(): Promise<LoopbackColyseus> {
  const restorePm2IoIpc = suppressPm2IoIpcNoise();
  const handle = await startColyseus({ rooms, port: 0 });
  return {
    url: `ws://127.0.0.1:${handle.port}`,
    stop: () => {
      handle.stop();
      restorePm2IoIpc();
    },
  };
}
