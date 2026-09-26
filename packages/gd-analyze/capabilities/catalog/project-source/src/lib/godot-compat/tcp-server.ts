/**
 * TCPServer's exact browser-export state.
 *
 * Browsers expose client WebSocket connections, but no raw TCP listener and no server-side
 * WebSocket upgrade socket.  Keep the RefCounted identity and the observable stopped state exact;
 * operations that would claim an actual listening socket refuse by name instead of fabricating a
 * connection queue.
 */

import { registerGodotObjectIdentity } from './object';
import type { GodotStreamPeerTCP } from './stream-peer-tcp';

export class GodotTCPServer {
  constructor() {
    registerGodotObjectIdentity(this, 'TCPServer');
  }

  listen(port: number, bindAddress = '*'): never {
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new RangeError('TCPServer.listen port must be an integer from 0 through 65535.');
    }
    if (typeof bindAddress !== 'string' || bindAddress.length === 0) {
      throw new TypeError('TCPServer.listen bind_address requires a non-empty String.');
    }
    throw new Error(
      'TCPServer.listen requires a raw server TCP socket; browsers expose no exact TCP listener.',
    );
  }

  is_connection_available(): boolean {
    return false;
  }

  take_connection(): GodotStreamPeerTCP | null {
    return null;
  }

  stop(): void {}

  is_listening(): boolean {
    return false;
  }

  get_local_port(): number {
    return 0;
  }
}

export function createGodotTCPServer(): GodotTCPServer {
  return new GodotTCPServer();
}
