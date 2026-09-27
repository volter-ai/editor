/**
 * Project-lifetime networking config for the editor authoring session.
 *
 * The engine ships the `NetworkingAdapter` seam and the editor's Network
 * inspector reads it; at RUNTIME a game produces one over a live room (the
 * `colyseus` capability). This is the EDIT-TIME half: with no game running, a
 * multiplayer project still has a DECLARED server. This installs a networking
 * adapter that answers the ONE edit-time question it honestly can —
 * `getServerConfig()`, read straight from the manifest (`server.room` and
 * `server.endpoint`, the latter absent = the scaffold default below) — plus
 * "not connected" stubs for the live members it cannot answer offline. It
 * never fabricates a connection.
 *
 * It also never fabricates a PLAYER IDENTITY, and that is the load-bearing part
 * of this file. An adapter is an INTERFACE the game implements, not a place the
 * editor imposes a way of doing things: WHO a player is — and whether a name is
 * even author-settable — is the game's own multiplayer to define. Many games
 * (the obby's Roblox-idiom `Player${joinCount}` server naming, for one) assign
 * names server-side and honour no client name at all. So this edit-time adapter
 * exposes NO `getPlayerIdentity`/`setPlayerIdentity`: the editor renders
 * identity UI only when a REAL runtime implementer provides those members
 * (consume-by-presence), and shows nothing otherwise — never a settable field
 * wired to a sidecar the game ignores.
 *
 * Unlike edit-mode AUDIO (always installed — every project has an audio graph),
 * this installs ONLY when the open project declares a `server`: networking
 * PRESENCE is meaningful in the editor (it gates the Network debugger tab and
 * the network utility), so a single-player project must keep `getActive
 * Networking()` null. The mounted game's adapter temporarily wins while Play is
 * active; on Stop, `getActiveNetworking()` falls back to this one.
 */

import { setEditModeNetworking } from '@volter/editor-sdk/kit/authoring/active-systems';
import { getCurrentProject } from '@volter/editor-sdk/kit/active-project';
import type {
  ConnectionState,
  NetPeer,
  NetServerConfig,
  NetworkingAdapter,
  ReplicationStats,
} from '@volter/editor-project/adapter';

/**
 * The endpoint a project gets when its manifest declares none — the SCAFFOLD
 * DEFAULT, stated in `server.endpoint`'s own schema description and spelled
 * here: the port `server/colyseus-setup.ts` listens on, against the host the
 * editor page is served from.
 *
 * This is a declaration read, not a guess: a project whose room lives anywhere
 * else says so in `server.endpoint` (ARCHITECTURE-CORE §The editor protocol,
 * "Zero inference" — the fix for a guessed fact is a declaration slot). The
 * host still comes from `location`, because "the machine this editor is served
 * from" is an environment fact the game cannot state.
 */

/** Read the declared server from the open project's manifest, or `null` when
 *  the project declares none (single-player). Defensive: an unreadable or
 *  malformed manifest is treated as "no server", never a throw. */
function readServerConfig(): NetServerConfig | null {
  // The declared `process` with a port is the edit-time server: its endpoint
  // is what the game will reach; the room is the game's own networking
  // adapter's to report once it runs (ARCHITECTURE-CORE §The project model).
  const declared = (getCurrentProject()?.config.configurations ?? []).find(
    (configuration) =>
      configuration.kind === 'process' && typeof configuration['port'] === 'number',
  );
  if (!declared) return null;
  const host = globalThis.location?.hostname || 'localhost';
  return { endpoint: `ws://${host}:${declared['port'] as number}` };
}

const NO_PEERS: NetPeer[] = [];
const DISCONNECTED_STATS: ReplicationStats = {
  entities: 0,
  msgsInPerSec: 0,
  msgsOutPerSec: 0,
};

/** Build the edit-time adapter over the declared server. The live members
 *  answer "not connected" honestly; `getServerConfig` reports the declared
 *  room. There are deliberately NO identity members — see the file header. */
function createEditModeNetworkingAdapter(serverConfig: NetServerConfig): NetworkingAdapter {
  return {
    // Live members: no connection at edit time — honest stubs, never fabricated.
    peers: () => NO_PEERS,
    networkId: () => null,
    authority: () => 'local',
    editable: () => true,
    getConnectionState: (): ConnectionState => 'disconnected',
    getRoomInfo: () => null,
    getReplicationStats: () => DISCONNECTED_STATS,
    // Edit-time state is static (nothing connects offline), so there is nothing
    // to notify — an honest no-op subscription rather than a live one.
    subscribe: () => () => {},
    // The one honest edit-time capability: the room the manifest declares.
    getServerConfig: () => serverConfig,
  };
}

/**
 * Install the edit-mode networking adapter for the open project, if it declares
 * a server. Returns a dispose that clears it. A single-player project (no
 * declared server) never installs one, so `getActiveNetworking()` stays null
 * and no networking UI appears. Synchronous: the only input is the
 * already-parsed manifest.
 */
export function installEditModeNetworking(): () => void {
  const serverConfig = readServerConfig();
  if (!serverConfig) return () => {};
  setEditModeNetworking(createEditModeNetworkingAdapter(serverConfig));
  return () => setEditModeNetworking(null);
}
