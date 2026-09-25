/**
 * Colyseus server setup (`startColyseus`) — boots a Colyseus WebSocket server
 * on a separate port (default 2567). In dev mode, rooms are imported directly
 * (tsx handles TS transpilation). Console output is forwarded to the editor
 * via SSE.
 *
 * There is no auto-started Colyseus process — this is imported by the
 * standalone `npm run server` entry (server/main.ts) and by two
 * harnesses: the e2e showcase's `startColyseusServer`
 * (packages/editor/e2e/helpers/colyseus.ts, which esbuild-bundles this +
 * rooms.ts to run against a real scaffolded project) and the unit-test
 * in-process loopback server (packages/editor/test/helpers/colyseus-loopback.ts,
 * which imports this directly for headless multiplayer tests).
 */

import type { Server as HttpServer } from 'node:http';
// A LEAF module by design — the browser P2P host must reach the same check
// without dragging this file's server transport into its bundle. See
// `declared-room.ts`'s header for the build failure that proved it.

export interface ColyseusOptions {
  /** Room definitions: array of { name, handler }. */
  rooms: ReadonlyArray<{
    name: string;
    handler: unknown;
    matchBy?: readonly string[] | undefined;
  }>;
  /** Port to bind; 2567 when omitted, `0` for an OS-assigned one. */
  port?: number | undefined;
}

export interface ColyseusHandle {
  /** The actual bound port — resolves the OS-assigned port when `port: 0` was requested. */
  port: number;
  /** Stop the server. */
  stop: () => void;
}

/**
 * Start the Colyseus server. Returns a handle with the bound port + a stop function.
 */
export async function startColyseus(options: ColyseusOptions): Promise<ColyseusHandle> {
  const port = options.port ?? 2567;

  const { Server } = (await import('@colyseus/core')) as unknown as {
    Server: new (opts: {
      transport: unknown;
      gracefullyShutdown: boolean;
    }) => {
      define: (
        name: string,
        handler: unknown,
      ) => {
        filterBy: (fields: readonly string[]) => unknown;
      };
      listen: (port: number) => Promise<void>;
      gracefullyShutdown: (exit: boolean) => Promise<void>;
      transport: { server?: HttpServer };
    };
  };
  const { WebSocketTransport } = (await import('@colyseus/ws-transport')) as {
    WebSocketTransport: new () => unknown;
  };

  const server = new Server({
    transport: new WebSocketTransport(),
    gracefullyShutdown: false,
  });

  for (const room of options.rooms) {
    const definition = server.define(room.name, room.handler);
    if (room.matchBy?.length) definition.filterBy(room.matchBy);
  }

  // Colyseus only attaches its own `error` handler INSIDE the listening
  // callback, which never fires when the bind fails — so an EADDRINUSE left
  // `server.listen()`'s promise forever pending and the process alive but
  // serving nothing (measured: a raw stack trace, then a hang). Attach the
  // handler BEFORE listening so a bind failure REJECTS here, loudly and once.
  const preListenHttpServer: HttpServer | null = server.transport.server ?? null;
  let onBindError: ((err: Error) => void) | undefined;
  const bindFailed = new Promise<never>((_resolve, reject) => {
    onBindError = reject;
    preListenHttpServer?.once('error', reject);
  });
  try {
    await Promise.race([server.listen(port), bindFailed]);
  } finally {
    if (onBindError) preListenHttpServer?.off('error', onBindError);
  }

  const colyseusHttpServer: HttpServer | null = server.transport.server ?? null;

  // Resolve the actual bound port (differs from `port` when `0` was passed).
  const address = colyseusHttpServer?.address();
  const actualPort = address && typeof address === 'object' ? address.port : port;

  console.log(
    `\x1b[35mColyseus\x1b[0m server listening on \x1b[36mws://localhost:${actualPort}\x1b[0m`,
  );

  let shuttingDown = false;
  return {
    port: actualPort,
    stop: () => {
      if (shuttingDown) return;
      shuttingDown = true;
      colyseusHttpServer?.close();
    },
  };
}
