/** Godot MultiplayerAPI and MultiplayerPeer state over project-owned browser carriers. */

import { registerGodotObjectIdentity } from './object';
import { godotNodePathNew, type GodotNodePath } from './node-path';
import { GodotCallable } from './callable';
import { godotDictionary } from './variant';
import { createGodotPacketState, type GodotPacketState } from './packet-peer';
import { packedByteArray, packedInt32Array, type PackedByteArray, type PackedInt32Array } from './packed-array';
import { createSignal, type GodotConnection, type GodotSignal } from './signal';
import { createGodotWebSocketPeer, type GodotWebSocketPeer } from './websocket-peer';
import { assertGodotBrowserClientTlsOptions } from './crypto';

export const MULTIPLAYER_PEER_CONNECTION_DISCONNECTED = 0;
export const MULTIPLAYER_PEER_CONNECTION_CONNECTING = 1;
export const MULTIPLAYER_PEER_CONNECTION_CONNECTED = 2;
export const MULTIPLAYER_PEER_TARGET_PEER_BROADCAST = 0;
export const MULTIPLAYER_PEER_TARGET_PEER_SERVER = 1;
export const MULTIPLAYER_PEER_TRANSFER_MODE_UNRELIABLE = 0;
export const MULTIPLAYER_PEER_TRANSFER_MODE_UNRELIABLE_ORDERED = 1;
export const MULTIPLAYER_PEER_TRANSFER_MODE_RELIABLE = 2;
const SCENE_NETWORK_COMMAND_SYS = 7;
const SCENE_SYS_COMMAND_AUTH = 0;

export interface GodotMultiplayerPacketCarrier {
  readonly localPeerId: number;
  readonly server: boolean;
  readonly status: number;
  readonly pendingLocalPeerId?: boolean;
  peers(): readonly number[];
  poll(): number;
  send(packet: Uint8Array, targetPeer: number, transferMode: number, transferChannel: number): number;
  close(): void;
  bind?(peer: GodotMultiplayerPeer): () => void;
  disconnectPeer?(peer: number, force: boolean): void;
  readonly serverRelaySupported?: boolean;
}

function peerId(value: number, owner: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 0x7fffffff) {
    throw new RangeError(`${owner} requires a positive 31-bit peer ID.`);
  }
  return value;
}

function transferMode(value: number): number {
  if (value !== MULTIPLAYER_PEER_TRANSFER_MODE_UNRELIABLE &&
      value !== MULTIPLAYER_PEER_TRANSFER_MODE_UNRELIABLE_ORDERED &&
      value !== MULTIPLAYER_PEER_TRANSFER_MODE_RELIABLE) {
    throw new RangeError('MultiplayerPeer.transfer_mode requires UNRELIABLE, UNRELIABLE_ORDERED, or RELIABLE.');
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class GodotMultiplayerPeer {
  private readonly peerConnected = createSignal<readonly [number]>();
  private readonly peerDisconnected = createSignal<readonly [number]>();
  private readonly connectionSucceeded = createSignal<readonly []>();
  private readonly connectionFailed = createSignal<readonly []>();
  private readonly serverDisconnected = createSignal<readonly []>();
  private readonly packetReceived = createSignal<readonly [number, Uint8Array]>();
  readonly peer_connected: GodotSignal<readonly [number]> = this.peerConnected.signal;
  readonly peer_disconnected: GodotSignal<readonly [number]> = this.peerDisconnected.signal;
  readonly connection_succeeded: GodotSignal<readonly []> = this.connectionSucceeded.signal;
  readonly connection_failed: GodotSignal<readonly []> = this.connectionFailed.signal;
  readonly server_disconnected: GodotSignal<readonly []> = this.serverDisconnected.signal;
  readonly packet_received: GodotSignal<readonly [number, Uint8Array]> = this.packetReceived.signal;
  private targetPeer = MULTIPLAYER_PEER_TARGET_PEER_BROADCAST;
  private channel = 0;
  private mode = MULTIPLAYER_PEER_TRANSFER_MODE_RELIABLE;
  private refuseNewConnections = false;
  private carrier: GodotMultiplayerPacketCarrier | null = null;
  private releaseCarrier: (() => void) | null = null;
  private readonly packet: GodotPacketState;
  private readonly packetPeerIds: number[] = [];
  private readonly packetModes: number[] = [];
  private readonly packetChannels: number[] = [];
  private lastPacketPeer = 0;
  private lastPacketMode = MULTIPLAYER_PEER_TRANSFER_MODE_RELIABLE;
  private lastPacketChannel = 0;

  constructor(className = 'MultiplayerPeer', godotMajor: 3 | 4 = 4) {
    this.packet = createGodotPacketState({
      send: (bytes) => this.sendPacket(bytes),
      maxPacketSize: () => 16 * 1024 * 1024,
    }, godotMajor);
    registerGodotObjectIdentity(this, className);
  }

  attach_browser_carrier(carrier: GodotMultiplayerPacketCarrier): void {
    if (this.carrier !== null) throw new Error('MultiplayerPeer already owns a browser carrier.');
    if (carrier.pendingLocalPeerId !== true) peerId(carrier.localPeerId, 'MultiplayerPeer carrier.localPeerId');
    else if (carrier.localPeerId !== 0) throw new Error('A pending-assignment carrier must attach with local peer ID 0.');
    this.carrier = carrier;
    this.releaseCarrier = carrier.bind?.(this) ?? null;
  }

  put_packet(packet: Iterable<number>): number {
    return this.packet.put_packet(packet);
  }

  get_available_packet_count(): number { return this.packet.get_available_packet_count(); }
  get_packet(): PackedByteArray {
    const bytes = this.packet.get_packet();
    this.lastPacketPeer = this.packetPeerIds.shift() ?? 0;
    this.lastPacketMode = this.packetModes.shift() ?? MULTIPLAYER_PEER_TRANSFER_MODE_RELIABLE;
    this.lastPacketChannel = this.packetChannels.shift() ?? 0;
    return bytes;
  }
  get_packet_error(): number { return this.packet.get_packet_error(); }
  get_max_packet_size(): number { return this.packet.get_max_packet_size(); }
  put_var(value: unknown, fullObjects = false): number { return this.packet.put_var(value, fullObjects); }
  get_var(allowObjects = false): unknown {
    const value = this.packet.get_var(allowObjects);
    this.lastPacketPeer = this.packetPeerIds.shift() ?? 0;
    this.lastPacketMode = this.packetModes.shift() ?? MULTIPLAYER_PEER_TRANSFER_MODE_RELIABLE;
    this.lastPacketChannel = this.packetChannels.shift() ?? 0;
    return value;
  }
  get_packet_peer(): number { return this.lastPacketPeer; }
  get_packet_mode(): number { return this.lastPacketMode; }
  get_packet_channel(): number { return this.lastPacketChannel; }
  set_encode_buffer_max_size(bytes: number): void { this.packet.set_encode_buffer_max_size(bytes); }
  get_encode_buffer_max_size(): number { return this.packet.get_encode_buffer_max_size(); }
  set_allow_object_decoding(enabled: boolean): void { this.packet.set_allow_object_decoding(enabled); }
  is_object_decoding_allowed(): boolean { return this.packet.is_object_decoding_allowed(); }
  get encode_buffer_max_size(): number { return this.packet.encode_buffer_max_size; }
  set encode_buffer_max_size(bytes: number) { this.packet.encode_buffer_max_size = bytes; }
  get allow_object_decoding(): boolean { return this.packet.allow_object_decoding; }
  set allow_object_decoding(enabled: boolean) { this.packet.allow_object_decoding = enabled; }

  poll(): number { return this.requireCarrier('poll').poll(); }
  close(): void {
    this.releaseCarrier?.();
    this.releaseCarrier = null;
    this.reset_attached_carrier();
    this.carrier = null;
  }
  protected reset_attached_carrier(): void {
    this.carrier?.close();
    this.packet.clear();
    this.packetPeerIds.length = 0;
    this.packetModes.length = 0;
    this.packetChannels.length = 0;
  }
  close_connection(waitUsec = 100): void {
    if (!Number.isInteger(waitUsec) || waitUsec < 0) {
      throw new RangeError('NetworkedMultiplayerPeer.close_connection wait_usec requires a non-negative integer.');
    }
    this.close();
  }
  get_connection_status(): number {
    return this.carrier?.status ?? MULTIPLAYER_PEER_CONNECTION_DISCONNECTED;
  }
  get_unique_id(): number { return this.requireCarrier('get_unique_id').localPeerId; }
  is_server(): boolean { return this.requireCarrier('is_server').server; }
  get_peers(): PackedInt32Array { return packedInt32Array(this.requireCarrier('get_peers').peers()); }

  set_target_peer(id: number): void {
    if (!Number.isInteger(id) || id < -0x7fffffff || id > 0x7fffffff) {
      throw new RangeError('MultiplayerPeer.target_peer requires a signed 31-bit peer selector.');
    }
    this.targetPeer = id;
  }
  get_target_peer(): number { return this.targetPeer; }
  set_transfer_channel(channel: number): void {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
      throw new RangeError('MultiplayerPeer.transfer_channel requires 0..255.');
    }
    this.channel = channel;
  }
  get_transfer_channel(): number { return this.channel; }
  set_transfer_mode(mode: number): void { this.mode = transferMode(mode); }
  get_transfer_mode(): number { return this.mode; }
  set_refuse_new_connections(refuse: boolean): void {
    if (typeof refuse !== 'boolean') throw new TypeError('MultiplayerPeer.refuse_new_connections requires bool.');
    this.refuseNewConnections = refuse;
  }
  is_refusing_new_connections(): boolean { return this.refuseNewConnections; }
  is_server_relay_supported(): boolean { return this.carrier?.serverRelaySupported ?? false; }
  disconnect_peer(id: number, force = false): void {
    const target = peerId(id, 'MultiplayerPeer.disconnect_peer');
    if (typeof force !== 'boolean') throw new TypeError('MultiplayerPeer.disconnect_peer force requires bool.');
    const carrier = this.requireCarrier('disconnect_peer');
    if (carrier.disconnectPeer === undefined) {
      throw new Error('MultiplayerPeer.disconnect_peer is unavailable on the attached project carrier.');
    }
    carrier.disconnectPeer(target, force);
  }

  notify_peer_connected(id: number): void { this.peerConnected.emit(peerId(id, 'peer_connected')); }
  notify_peer_disconnected(id: number): void { this.peerDisconnected.emit(peerId(id, 'peer_disconnected')); }
  notify_connection_succeeded(): void { this.connectionSucceeded.emit(); }
  notify_connection_failed(): void { this.connectionFailed.emit(); }
  notify_server_disconnected(): void { this.serverDisconnected.emit(); }
  notify_packet(
    id: number,
    bytes: Uint8Array,
    mode = MULTIPLAYER_PEER_TRANSFER_MODE_RELIABLE,
    channel = 0,
  ): void {
    const source = peerId(id, 'MultiplayerPeer packet source');
    const copy = bytes.slice();
    const receivedMode = transferMode(mode);
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
      throw new RangeError('MultiplayerPeer received packet channel requires 0..255.');
    }
    this.packet.queue(copy);
    this.packetPeerIds.push(source);
    this.packetModes.push(receivedMode);
    this.packetChannels.push(channel);
    this.packetReceived.emit(source, copy);
  }

  private sendPacket(bytes: Uint8Array): number {
    const carrier = this.requireCarrier('put_packet');
    if (carrier.status !== MULTIPLAYER_PEER_CONNECTION_CONNECTED) return 2;
    return carrier.send(bytes, this.targetPeer, this.mode, this.channel);
  }

  private requireCarrier(member: string): GodotMultiplayerPacketCarrier {
    if (this.carrier === null) {
      throw new Error(`MultiplayerPeer.${member} requires an exact project-owned browser transport carrier.`);
    }
    return this.carrier;
  }
}

interface RpcMethodMetadata {
  readonly rpcMode: number;
  readonly callLocal: boolean;
  readonly transferMode: number;
  readonly channel: number;
}

interface MultiplayerConfiguration {
  readonly object: object;
  readonly configuration: unknown;
  readonly path: string;
  readonly methods: Map<string, RpcMethodMetadata>;
}

export class GodotMultiplayerAPI {
  private readonly connected = createSignal<readonly [number]>();
  private readonly disconnected = createSignal<readonly [number]>();
  private readonly connectedToServer = createSignal<readonly []>();
  private readonly connectionFailed = createSignal<readonly []>();
  private readonly serverDisconnected = createSignal<readonly []>();
  private readonly peerPacket = createSignal<readonly [number, Uint8Array]>();
  readonly peer_connected: GodotSignal<readonly [number]> = this.connected.signal;
  readonly peer_disconnected: GodotSignal<readonly [number]> = this.disconnected.signal;
  readonly connected_to_server: GodotSignal<readonly []> = this.connectedToServer.signal;
  readonly connection_failed: GodotSignal<readonly []> = this.connectionFailed.signal;
  readonly server_disconnected: GodotSignal<readonly []> = this.serverDisconnected.signal;
  readonly peer_packet: GodotSignal<readonly [number, Uint8Array]> = this.peerPacket.signal;
  readonly network_peer_connected: GodotSignal<readonly [number]> = this.connected.signal;
  readonly network_peer_disconnected: GodotSignal<readonly [number]> = this.disconnected.signal;
  readonly network_peer_packet: GodotSignal<readonly [number, Uint8Array]> = this.peerPacket.signal;
  private peer: GodotMultiplayerPeer | null = null;
  private peerConnections: GodotConnection[] = [];
  private rootPath: GodotNodePath = godotNodePathNew();
  private rootNode: object | null = null;
  private legacyAllowObjectDecoding = false;
  private refuseNetworkConnections = false;
  private remoteSenderId = 0;
  private readonly configurations = new Map<object, MultiplayerConfiguration>();

  constructor(className = 'MultiplayerAPI') {
    registerGodotObjectIdentity(this, className);
  }

  set_multiplayer_peer(peer: GodotMultiplayerPeer | null): void {
    if (peer !== null && !(peer instanceof GodotMultiplayerPeer)) {
      throw new TypeError('MultiplayerAPI.multiplayer_peer requires MultiplayerPeer or null.');
    }
    if (peer === this.peer) return;
    if (peer !== null && peer.get_connection_status() === MULTIPLAYER_PEER_CONNECTION_DISCONNECTED) {
      throw new Error('MultiplayerAPI.multiplayer_peer requires a connecting or connected MultiplayerPeer.');
    }
    for (const connection of this.peerConnections) connection.disconnect();
    this.peerConnections = [];
    if (this.peer !== null) this.clear();
    this.peer = peer;
    if (peer === null) return;
    this.peerConnections.push(
      peer.peer_connected.connect((id) => this.onTransportPeerConnected(id)),
      peer.peer_disconnected.connect((id) => this.onTransportPeerDisconnected(id)),
      peer.connection_succeeded.connect(() => this.onTransportConnectionSucceeded()),
      peer.connection_failed.connect(() => this.onTransportConnectionFailed()),
      peer.server_disconnected.connect(() => this.onTransportServerDisconnected()),
      peer.packet_received.connect((id, packet) => this.onTransportPacket(id, packet.slice())),
    );
  }
  get_multiplayer_peer(): GodotMultiplayerPeer | null { return this.peer; }
  get multiplayer_peer(): GodotMultiplayerPeer | null { return this.get_multiplayer_peer(); }
  set multiplayer_peer(peer: GodotMultiplayerPeer | null) { this.set_multiplayer_peer(peer); }
  has_multiplayer_peer(): boolean { return this.peer !== null; }
  get_unique_id(): number { return this.peer?.get_unique_id() ?? 0; }
  get_remote_sender_id(): number { return this.remoteSenderId; }
  is_server(): boolean { return this.peer?.is_server() ?? false; }
  get_peers(): PackedInt32Array { return this.peer?.get_peers() ?? packedInt32Array(); }
  poll(): number { return this.requirePeer('poll').poll(); }
  set_root_path(path: GodotNodePath | string): void { this.rootPath = godotNodePathNew(path); }
  get_root_path(): GodotNodePath { return godotNodePathNew(this.rootPath); }

  set_network_peer(peer: GodotMultiplayerPeer | null): void { this.set_multiplayer_peer(peer); }
  get_network_peer(): GodotMultiplayerPeer | null { return this.get_multiplayer_peer(); }
  get network_peer(): GodotMultiplayerPeer | null { return this.get_network_peer(); }
  set network_peer(peer: GodotMultiplayerPeer | null) { this.set_network_peer(peer); }
  has_network_peer(): boolean { return this.has_multiplayer_peer(); }
  get_network_unique_id(): number { return this.get_unique_id(); }
  get_network_connected_peers(): PackedInt32Array { return this.get_peers(); }
  is_network_server(): boolean { return this.is_server(); }
  get_rpc_sender_id(): number { return this.get_remote_sender_id(); }
  set_root_node(node: object | null): void {
    if (node !== null && typeof node !== 'object') throw new TypeError('MultiplayerAPI.root_node requires Node or null.');
    this.rootNode = node;
  }
  get_root_node(): object | null { return this.rootNode; }
  set_allow_object_decoding(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('MultiplayerAPI.allow_object_decoding requires bool.');
    this.legacyAllowObjectDecoding = enabled;
  }
  is_object_decoding_allowed(): boolean { return this.legacyAllowObjectDecoding; }
  set_refuse_new_network_connections(refuse: boolean): void {
    if (typeof refuse !== 'boolean') throw new TypeError('MultiplayerAPI.refuse_new_network_connections requires bool.');
    this.refuseNetworkConnections = refuse;
    this.peer?.set_refuse_new_connections(refuse);
  }
  is_refusing_new_network_connections(): boolean { return this.refuseNetworkConnections; }
  clear(): void { this.remoteSenderId = 0; }

  object_configuration_add(object: object, configuration: unknown): number {
    if ((typeof object !== 'object' && typeof object !== 'function') || object === null) return 31;
    const parsed = this.readConfiguration(object, configuration);
    this.configurations.set(object, parsed);
    return 0;
  }

  object_configuration_remove(object: object, configuration: unknown): number {
    const existing = this.configurations.get(object);
    if (existing === undefined || existing.configuration !== configuration) return 31;
    this.configurations.delete(object);
    return 0;
  }

  configure_rpc(
    object: object,
    method: string,
    config: number | Readonly<Record<string, unknown>> | ReadonlyMap<unknown, unknown> | null,
  ): void {
    const registered = this.configurations.get(object);
    if (registered === undefined) throw new Error('Node.rpc_config requires a registered node script identity.');
    if (typeof (object as Record<string, unknown>)[method] !== 'function') {
      throw new Error(`Node.rpc_config method ${method} is not callable on the registered script.`);
    }
    if (config === null) {
      registered.methods.delete(method);
      return;
    }
    if (typeof config === 'number') {
      if (!Number.isInteger(config) || config < 0 || config > 6) {
        throw new RangeError('Godot 3 Node.rpc_config mode requires RPCMode 0..6.');
      }
      if (config === 0) {
        registered.methods.delete(method);
        return;
      }
      const baseMode = config === 2 || config === 5 ? 2 : config === 3 || config === 6 ? 3 : 1;
      registered.methods.set(method, {
        rpcMode: baseMode,
        callLocal: config >= 4,
        transferMode: MULTIPLAYER_PEER_TRANSFER_MODE_RELIABLE,
        channel: 0,
      });
      return;
    }
    if (typeof config !== 'object' || config === null) {
      throw new TypeError('Godot 4 Node.rpc_config requires a configuration Dictionary.');
    }
    const field = (name: string): unknown =>
      typeof (config as { get?: unknown }).get === 'function'
        ? (config as ReadonlyMap<unknown, unknown>).get(name)
        : (config as Readonly<Record<string, unknown>>)[name];
    registered.methods.set(method, {
      rpcMode: this.integer(field('rpc_mode') ?? 0, `RPC ${method}.rpc_mode`),
      callLocal: Boolean(field('call_local') ?? false),
      transferMode: transferMode(this.integer(
        field('transfer_mode') ?? MULTIPLAYER_PEER_TRANSFER_MODE_UNRELIABLE,
        `RPC ${method}.transfer_mode`,
      )),
      channel: this.channel(field('channel') ?? 0, `RPC ${method}.channel`),
    });
  }

  get_rpc_config(object: object): ReadonlyMap<string, ReadonlyMap<string, unknown>> {
    const registered = this.configurations.get(object);
    if (registered === undefined) return godotDictionary();
    return godotDictionary([...registered.methods].map(([name, metadata]) => [
      name,
      godotDictionary([
        ['rpc_mode', metadata.rpcMode],
        ['call_local', metadata.callLocal],
        ['transfer_mode', metadata.transferMode],
        ['channel', metadata.channel],
      ]),
    ]));
  }

  rpc(peer: number, object: object, method: string, args: readonly unknown[] = []): number {
    if (!Number.isInteger(peer) || peer < -0x7fffffff || peer > 0x7fffffff) {
      throw new RangeError('MultiplayerAPI.rpc peer requires a signed 31-bit peer selector.');
    }
    const target = peer;
    const config = this.configurations.get(object);
    if (config === undefined) throw new Error('MultiplayerAPI.rpc receiver has no registered RPC configuration.');
    const metadata = config.methods.get(method);
    if (metadata === undefined) throw new Error(`MultiplayerAPI.rpc method ${method} has no RPC metadata.`);
    if (metadata.rpcMode === 0) throw new Error(`MultiplayerAPI.rpc method ${method} is disabled by its RPC configuration.`);
    const localPeer = this.get_unique_id();
    const remotePeers = [...this.get_peers()].filter((id) => {
      if (target === 0) return true;
      if (target > 0) return id === target;
      return id !== -target;
    });
    if (target > 0 && target !== localPeer && remotePeers.length === 0) {
      throw new Error(`MultiplayerAPI.rpc target peer ${target} is not connected.`);
    }
    if (remotePeers.length > 0) {
      throw new Error(
        `MultiplayerAPI.rpc remote delivery for ${config.path}:${method} requires an emitted project-owned RPC carrier; ` +
        'the browser transport packet format is not fabricated by godot-compat.',
      );
    }
    const includesLocal = target === 0 || target === localPeer || (target === 1 && this.is_server());
    const excludesLocal = target < 0 && -target === localPeer;
    if (includesLocal && !excludesLocal) {
      if (!metadata.callLocal) return 0;
      const callable = (object as Record<string, unknown>)[method];
      if (typeof callable !== 'function') throw new Error(`MultiplayerAPI.rpc target method ${method} is not callable.`);
      this.remoteSenderId = localPeer;
      try {
        callable.apply(object, args);
      } finally {
        this.remoteSenderId = 0;
      }
      return 0;
    }
    return 0;
  }

  rpcp(peer: number, object: object, method: string, args: readonly unknown[] = []): number {
    return this.rpc(peer, object, method, args);
  }

  send_bytes(bytes: Iterable<number>, id = 0, mode = MULTIPLAYER_PEER_TRANSFER_MODE_RELIABLE, channel = 0): number {
    const peer = this.requirePeer('send_bytes');
    peer.set_target_peer(id);
    peer.set_transfer_mode(mode);
    peer.set_transfer_channel(channel);
    return peer.put_packet(bytes);
  }

  notify_peer_connected(id: number): void { this.connected.emit(peerId(id, 'peer_connected')); }
  notify_peer_disconnected(id: number): void { this.disconnected.emit(peerId(id, 'peer_disconnected')); }
  notify_connected_to_server(): void { this.connectedToServer.emit(); }
  notify_connection_failed(): void { this.connectionFailed.emit(); }
  notify_server_disconnected(): void { this.serverDisconnected.emit(); }
  notify_peer_packet(id: number, packet: Uint8Array): void { this.peerPacket.emit(peerId(id, 'peer_packet'), packet.slice()); }

  protected onTransportPeerConnected(id: number): void { this.connected.emit(id); }
  protected onTransportPeerDisconnected(id: number): void { this.disconnected.emit(id); }
  protected onTransportConnectionSucceeded(): void { this.connectedToServer.emit(); }
  protected onTransportConnectionFailed(): void { this.connectionFailed.emit(); }
  protected onTransportServerDisconnected(): void { this.serverDisconnected.emit(); }
  protected onTransportPacket(id: number, packet: Uint8Array): void { this.peerPacket.emit(id, packet); }

  private readConfiguration(object: object, configuration: unknown): MultiplayerConfiguration {
    if (!isRecord(configuration)) {
      throw new TypeError('MultiplayerAPI object configuration must be an emitted RPC metadata object.');
    }
    const authoredPath = configuration['path'];
    const path = typeof authoredPath === 'string' ? authoredPath : '';
    const methods = new Map<string, RpcMethodMetadata>();
    const authoredMethods = configuration['methods'];
    if (authoredMethods !== undefined) {
      if (!isRecord(authoredMethods)) {
        throw new TypeError('MultiplayerAPI RPC metadata methods must be a dictionary.');
      }
      for (const [name, value] of Object.entries(authoredMethods)) {
        if (!isRecord(value)) throw new TypeError(`RPC metadata for ${name} must be a dictionary.`);
        methods.set(name, {
          rpcMode: this.integer(value['rpc_mode'] ?? 0, `RPC ${name}.rpc_mode`),
          callLocal: Boolean(value['call_local'] ?? false),
          transferMode: transferMode(this.integer(value['transfer_mode'] ?? MULTIPLAYER_PEER_TRANSFER_MODE_RELIABLE, `RPC ${name}.transfer_mode`)),
          channel: this.channel(value['channel'] ?? 0, `RPC ${name}.channel`),
        });
      }
    }
    return { object, configuration, path, methods };
  }

  private integer(value: unknown, owner: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new TypeError(`${owner} requires an integer.`);
    }
    return value;
  }
  private channel(value: unknown, owner: string): number {
    const result = this.integer(value, owner);
    if (result < 0 || result > 255) throw new RangeError(`${owner} requires 0..255.`);
    return result;
  }
  private requirePeer(member: string): GodotMultiplayerPeer {
    if (this.peer === null) throw new Error(`MultiplayerAPI.${member} requires multiplayer_peer.`);
    return this.peer;
  }
}

export class GodotSceneMultiplayer extends GodotMultiplayerAPI {
  private readonly authenticating = createSignal<readonly [number]>();
  private readonly authenticationFailed = createSignal<readonly [number]>();
  readonly peer_authenticating: GodotSignal<readonly [number]> = this.authenticating.signal;
  readonly peer_authentication_failed: GodotSignal<readonly [number]> = this.authenticationFailed.signal;
  private allowObjectDecoding = false;
  private refuseConnections = false;
  private serverRelay = true;
  private authTimeout = 3;
  private authCallback: GodotCallable | ((peer: number, data: PackedByteArray) => void) | null = null;
  private readonly pendingPeers = new Map<number, { local: boolean; remote: boolean; startedAt: number }>();
  private readonly admittedPeers = new Set<number>();
  private maxSyncPacketSize = 1350;
  private maxDeltaPacketSize = 65535;

  constructor() {
    super('SceneMultiplayer');
    this.set_multiplayer_peer(new GodotOfflineMultiplayerPeer());
  }

  override set_multiplayer_peer(peer: GodotMultiplayerPeer | null): void {
    if (peer === this.get_multiplayer_peer()) return;
    this.pendingPeers.clear();
    this.admittedPeers.clear();
    super.set_multiplayer_peer(peer);
  }
  clear(): void {
    this.pendingPeers.clear();
    this.admittedPeers.clear();
    super.clear();
  }
  disconnect_peer(id: number): void {
    const peer = this.get_multiplayer_peer();
    if (peer === null) throw new Error('SceneMultiplayer.disconnect_peer requires multiplayer_peer.');
    peer.disconnect_peer(id, false);
  }
  override get_peers(): PackedInt32Array { return packedInt32Array(this.admittedPeers); }
  override poll(): number {
    const result = super.poll();
    if (this.authTimeout === 0 || this.pendingPeers.size === 0) return result;
    const now = monotonicMilliseconds();
    for (const [id, pending] of [...this.pendingPeers]) {
      if (pending.startedAt + this.authTimeout * 1000 > now) continue;
      this.pendingPeers.delete(id);
      this.get_multiplayer_peer()?.disconnect_peer(id, false);
      this.authenticationFailed.emit(id);
    }
    return result;
  }
  get_authenticating_peers(): PackedInt32Array { return packedInt32Array(this.pendingPeers.keys()); }
  send_auth(id: number, data: Iterable<number>): number {
    const peer = this.get_multiplayer_peer();
    if (peer === null || peer.get_connection_status() !== MULTIPLAYER_PEER_CONNECTION_CONNECTED) return 3;
    const target = peerId(id, 'SceneMultiplayer.send_auth');
    const pending = this.pendingPeers.get(target);
    if (pending === undefined) return 31;
    const payload = Uint8Array.from(data);
    if (payload.byteLength === 0) return 31;
    if (pending.local || pending.remote) return 13;
    const packet = new Uint8Array(payload.byteLength + 2);
    packet[0] = SCENE_NETWORK_COMMAND_SYS;
    packet[1] = SCENE_SYS_COMMAND_AUTH;
    packet.set(payload, 2);
    return this.sendAuthenticationPacket(peer, target, packet);
  }
  complete_auth(id: number): number {
    const peer = this.get_multiplayer_peer();
    if (peer === null || peer.get_connection_status() !== MULTIPLAYER_PEER_CONNECTION_CONNECTED) return 3;
    const target = peerId(id, 'SceneMultiplayer.complete_auth');
    const pending = this.pendingPeers.get(target);
    if (pending === undefined) return 31;
    if (pending.local) return 13;
    pending.local = true;
    const result = this.sendAuthenticationPacket(
      peer,
      target,
      Uint8Array.of(SCENE_NETWORK_COMMAND_SYS, SCENE_SYS_COMMAND_AUTH),
    );
    if (pending.remote) {
      this.pendingPeers.delete(target);
      this.admitPeer(target);
    }
    return result;
  }
  set_auth_callback(callback: GodotCallable | ((peer: number, data: PackedByteArray) => void) | null): void {
    if (callback !== null && !(callback instanceof GodotCallable) && typeof callback !== 'function') {
      throw new TypeError('SceneMultiplayer.auth_callback requires Callable or null.');
    }
    this.authCallback = callback;
  }
  get_auth_callback(): GodotCallable | ((peer: number, data: PackedByteArray) => void) | null { return this.authCallback; }
  set_auth_timeout(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('SceneMultiplayer.auth_timeout requires non-negative seconds.');
    this.authTimeout = seconds;
  }
  get_auth_timeout(): number { return this.authTimeout; }
  set_allow_object_decoding(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('SceneMultiplayer.allow_object_decoding requires bool.');
    this.allowObjectDecoding = enabled;
  }
  is_object_decoding_allowed(): boolean { return this.allowObjectDecoding; }
  set_refuse_new_connections(refuse: boolean): void {
    if (typeof refuse !== 'boolean') throw new TypeError('SceneMultiplayer.refuse_new_connections requires bool.');
    this.refuseConnections = refuse;
    this.get_multiplayer_peer()?.set_refuse_new_connections(refuse);
  }
  is_refusing_new_connections(): boolean { return this.refuseConnections; }
  set_server_relay_enabled(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('SceneMultiplayer.server_relay requires bool.');
    this.serverRelay = enabled;
  }
  is_server_relay_enabled(): boolean { return this.serverRelay; }
  set_max_sync_packet_size(size: number): void { this.maxSyncPacketSize = this.packetSize(size, 'max_sync_packet_size'); }
  get_max_sync_packet_size(): number { return this.maxSyncPacketSize; }
  set_max_delta_packet_size(size: number): void { this.maxDeltaPacketSize = this.packetSize(size, 'max_delta_packet_size'); }
  get_max_delta_packet_size(): number { return this.maxDeltaPacketSize; }
  notify_peer_authenticating(id: number): void { this.authenticating.emit(peerId(id, 'peer_authenticating')); }
  notify_peer_authentication_failed(id: number): void {
    this.authenticationFailed.emit(peerId(id, 'peer_authentication_failed'));
  }
  protected override onTransportPeerConnected(id: number): void {
    const source = peerId(id, 'SceneMultiplayer transport peer');
    if (this.authCallback === null) {
      this.admitPeer(source);
      return;
    }
    this.pendingPeers.set(source, { local: false, remote: false, startedAt: monotonicMilliseconds() });
    this.authenticating.emit(source);
  }
  protected override onTransportPeerDisconnected(id: number): void {
    const source = peerId(id, 'SceneMultiplayer transport peer');
    if (this.pendingPeers.delete(source)) {
      this.authenticationFailed.emit(source);
      return;
    }
    if (!this.admittedPeers.delete(source)) return;
    super.onTransportPeerDisconnected(source);
  }
  protected override onTransportConnectionSucceeded(): void {
    // SceneMultiplayer emits connected_to_server only when peer 1 is admitted.
  }
  protected override onTransportConnectionFailed(): void {
    this.pendingPeers.clear();
    this.admittedPeers.clear();
    super.onTransportConnectionFailed();
  }
  protected override onTransportServerDisconnected(): void {
    this.pendingPeers.clear();
    this.admittedPeers.clear();
    super.onTransportServerDisconnected();
  }
  protected override onTransportPacket(id: number, packet: Uint8Array): void {
    const source = peerId(id, 'SceneMultiplayer packet source');
    const pending = this.pendingPeers.get(source);
    if (pending !== undefined) {
      if (
        packet.byteLength < 2 ||
        (packet[0]! & 7) !== SCENE_NETWORK_COMMAND_SYS ||
        packet[1] !== SCENE_SYS_COMMAND_AUTH
      ) {
        throw new Error(`SceneMultiplayer received a non-authentication packet from pending peer ${source}.`);
      }
      if (packet.byteLength > 2) {
        if (this.authCallback instanceof GodotCallable) {
          this.authCallback.call(source, packedByteArray(packet.subarray(2)));
        } else {
          this.authCallback?.(source, packedByteArray(packet.subarray(2)));
        }
        return;
      }
      pending.remote = true;
      if (pending.local) {
        this.pendingPeers.delete(source);
        this.admitPeer(source);
      }
      return;
    }
    if (
      packet.byteLength >= 2 &&
      (packet[0]! & 7) === SCENE_NETWORK_COMMAND_SYS &&
      packet[1] === SCENE_SYS_COMMAND_AUTH
    ) {
      if (packet.byteLength === 2) return;
      throw new Error(`SceneMultiplayer received authentication data from admitted peer ${source}.`);
    }
    super.onTransportPacket(source, packet);
  }
  private sendAuthenticationPacket(peer: GodotMultiplayerPeer, target: number, packet: Uint8Array): number {
    peer.set_target_peer(target);
    peer.set_transfer_channel(0);
    peer.set_transfer_mode(MULTIPLAYER_PEER_TRANSFER_MODE_RELIABLE);
    return peer.put_packet(packet);
  }
  private admitPeer(id: number): void {
    if (this.admittedPeers.has(id)) return;
    this.admittedPeers.add(id);
    if (id === MULTIPLAYER_PEER_TARGET_PEER_SERVER) this.notify_connected_to_server();
    this.notify_peer_connected(id);
  }
  private packetSize(value: number, owner: string): number {
    if (!Number.isInteger(value) || value < 1 || value > 16 * 1024 * 1024) {
      throw new RangeError(`SceneMultiplayer.${owner} requires 1..16777216 bytes.`);
    }
    return value;
  }
}

function monotonicMilliseconds(): number {
  return globalThis.performance?.now() ?? Date.now();
}

let defaultMultiplayerInterface = 'SceneMultiplayer';

export function setGodotDefaultMultiplayerInterface(name: string): void {
  if (name !== 'SceneMultiplayer') {
    throw new Error(`MultiplayerAPI default interface ${name} is not installed in this translated project.`);
  }
  defaultMultiplayerInterface = name;
}
export function getGodotDefaultMultiplayerInterface(): string { return defaultMultiplayerInterface; }
export function createGodotDefaultMultiplayerInterface(): GodotMultiplayerAPI {
  if (defaultMultiplayerInterface === 'SceneMultiplayer') return new GodotSceneMultiplayer();
  throw new Error(`MultiplayerAPI default interface ${defaultMultiplayerInterface} is unavailable.`);
}

export class GodotENetMultiplayerPeer extends GodotMultiplayerPeer {
  private bindIp = '*';
  constructor(className = 'ENetMultiplayerPeer', godotMajor: 3 | 4 = 4) {
    super(className, godotMajor);
  }
  create_client(..._arguments: readonly unknown[]): never { throw this.unavailable('create_client'); }
  create_server(..._arguments: readonly unknown[]): never { throw this.unavailable('create_server'); }
  get host(): null { return null; }
  create_mesh(..._arguments: readonly unknown[]): never { throw this.unavailable('create_mesh'); }
  add_mesh_peer(..._arguments: readonly unknown[]): never { throw this.unavailable('add_mesh_peer'); }
  set_bind_ip(ip: string): void {
    if (typeof ip !== 'string' || ip.length === 0) throw new TypeError('ENetMultiplayerPeer bind IP requires String.');
    this.bindIp = ip;
  }
  get_host(): null { void this.bindIp; return null; }
  get_peer(_id: number): never { throw this.unavailable('get_peer'); }
  private unavailable(member: string): Error {
    return new Error(
      `ENetMultiplayerPeer.${member} requires ENet UDP reliability, channels, and peer negotiation; ` +
      'browsers expose no exact ENet carrier.',
    );
  }
}

/** ENetConnection identity is retained, but browser clients have no UDP/DTLS socket authority. */
export class GodotENetConnection {
  constructor() { registerGodotObjectIdentity(this, 'ENetConnection'); }
  dtls_client_setup(..._arguments: readonly unknown[]): never {
    throw new Error(
      'ENetConnection.dtls_client_setup requires access to ENet UDP datagrams; browser WebRTC DTLS is private to RTCPeerConnection.',
    );
  }
  dtls_server_setup(..._arguments: readonly unknown[]): never {
    throw new Error(
      'ENetConnection.dtls_server_setup requires a server-side ENet UDP listener and DTLS certificate authority unavailable in browsers.',
    );
  }
}

export class GodotWebSocketMultiplayerPeer extends GodotMultiplayerPeer {
  private socket: GodotWebSocketPeer | null = null;
  constructor() { super('WebSocketMultiplayerPeer'); }
  create_client(url: string, tlsClientOptions: unknown = null): number {
    if (this.socket !== null) return 44;
    assertGodotBrowserClientTlsOptions(tlsClientOptions, 'WebSocketMultiplayerPeer.create_client');
    const socket = createGodotWebSocketPeer(4);
    const result = socket.connect_to_url(url, null);
    if (result !== 0) return result;
    this.socket = socket;
    this.attach_browser_carrier(new GodotBrowserWebSocketPacketCarrier(socket, {
      remotePeerId: 1,
      awaitServerPeerId: true,
    }));
    return 0;
  }
  create_server(..._arguments: readonly unknown[]): never {
    throw new Error('WebSocketMultiplayerPeer.create_server requires a server-side WebSocket upgrade carrier unavailable in browsers.');
  }
  close(): void {
    super.close();
    this.socket = null;
  }
  get_peer(peerId: number): GodotWebSocketPeer {
    if (peerId !== 1 || this.socket === null) {
      throw new Error(`WebSocketMultiplayerPeer has no connected peer ${String(peerId)}.`);
    }
    return this.socket;
  }
}

/** Godot 3 server identity; browsers cannot accept HTTP upgrade connections. */
export class GodotWebSocketServer extends GodotMultiplayerPeer {
  constructor() { super('WebSocketServer', 3); }

  listen(..._arguments: readonly unknown[]): never {
    throw new Error(
      'WebSocketServer.listen requires a server-side HTTP upgrade listener unavailable in browsers.',
    );
  }
}

/** Exact raw PacketPeer carrier over one client WebSocket and one known remote peer. */
export class GodotBrowserWebSocketPacketCarrier implements GodotMultiplayerPacketCarrier {
  readonly serverRelaySupported = false;
  readonly server: boolean;
  private readonly remotePeerId: number;
  private currentLocalPeerId: number;
  private awaitingServerPeerId: boolean;

  get localPeerId(): number { return this.currentLocalPeerId; }
  get pendingLocalPeerId(): boolean { return this.awaitingServerPeerId; }

  constructor(
    private readonly socket: GodotWebSocketPeer,
    options: {
      readonly localPeerId?: number;
      readonly remotePeerId: number;
      readonly server?: boolean;
      readonly awaitServerPeerId?: boolean;
    },
  ) {
    this.awaitingServerPeerId = options.awaitServerPeerId ?? false;
    this.currentLocalPeerId = this.awaitingServerPeerId
      ? 0
      : peerId(options.localPeerId ?? 0, 'WebSocket packet carrier localPeerId');
    this.remotePeerId = peerId(options.remotePeerId, 'WebSocket packet carrier remotePeerId');
    if (this.currentLocalPeerId === this.remotePeerId) throw new Error('WebSocket packet carrier peer IDs must be distinct.');
    this.server = options.server ?? false;
  }

  get status(): number {
    const state = this.socket.get_ready_state();
    return state === 1 && !this.awaitingServerPeerId ? MULTIPLAYER_PEER_CONNECTION_CONNECTED
      : state === 0 ? MULTIPLAYER_PEER_CONNECTION_CONNECTING
        : state === 1 ? MULTIPLAYER_PEER_CONNECTION_CONNECTING
        : MULTIPLAYER_PEER_CONNECTION_DISCONNECTED;
  }
  peers(): readonly number[] {
    return this.status === MULTIPLAYER_PEER_CONNECTION_CONNECTED ? [this.remotePeerId] : [];
  }
  poll(): number { this.socket.poll(); return 0; }
  send(packet: Uint8Array, targetPeer: number, mode: number, channel: number): number {
    if (mode !== MULTIPLAYER_PEER_TRANSFER_MODE_RELIABLE) {
      throw new Error('A browser WebSocket packet carrier supports only reliable ordered transfer.');
    }
    if (channel !== 0) throw new Error('A raw browser WebSocket packet carrier exposes no Godot transfer channels.');
    if (targetPeer < 0 && -targetPeer === this.remotePeerId) return 0;
    if (targetPeer === this.localPeerId) return 0;
    if (targetPeer !== 0 && targetPeer !== this.remotePeerId) return 2;
    return this.socket.put_packet(packet);
  }
  close(): void { this.socket.close(); }
  disconnectPeer(peer: number): void {
    if (peer !== this.remotePeerId) throw new Error(`WebSocket packet carrier has no peer ${peer}.`);
    this.socket.close(1000, 'Disconnected by MultiplayerPeer');
  }
  bind(peer: GodotMultiplayerPeer): () => void {
    const releases = [
      this.socket.on('open', () => {
        if (!this.awaitingServerPeerId) {
          peer.notify_peer_connected(this.remotePeerId);
          if (!this.server) peer.notify_connection_succeeded();
        }
      }),
      this.socket.on('close', () => {
        peer.notify_peer_disconnected(this.remotePeerId);
        if (!this.server) peer.notify_server_disconnected();
      }),
      this.socket.on('error', () => { if (!this.server) peer.notify_connection_failed(); }),
      this.socket.on('packet', () => {
        while (this.socket.get_available_packet_count() > 0) {
          const packet = Uint8Array.from(this.socket.get_packet());
          if (this.awaitingServerPeerId) {
            if (packet.byteLength !== 4) {
              this.socket.close(1002, 'Invalid Godot multiplayer peer ID');
              peer.notify_connection_failed();
              return;
            }
            const assigned = new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getInt32(0, true);
            if (assigned < 2) {
              this.socket.close(1002, 'Invalid Godot multiplayer peer ID');
              peer.notify_connection_failed();
              return;
            }
            this.currentLocalPeerId = peerId(assigned, 'WebSocket server-assigned peer ID');
            this.awaitingServerPeerId = false;
            peer.notify_peer_connected(this.remotePeerId);
            peer.notify_connection_succeeded();
            continue;
          }
          peer.notify_packet(this.remotePeerId, packet);
        }
      }),
    ];
    return () => { for (const release of releases) release(); };
  }
}

class OfflinePacketCarrier implements GodotMultiplayerPacketCarrier {
  readonly localPeerId = 1;
  readonly server = true;
  readonly status = MULTIPLAYER_PEER_CONNECTION_CONNECTED;
  peers(): readonly number[] { return []; }
  poll(): number { return 0; }
  send(_packet: Uint8Array, targetPeer: number): number {
    if (targetPeer !== MULTIPLAYER_PEER_TARGET_PEER_BROADCAST &&
        targetPeer !== MULTIPLAYER_PEER_TARGET_PEER_SERVER && targetPeer !== -1) {
      return 2;
    }
    return 0;
  }
  close(): void {}
}

export class GodotOfflineMultiplayerPeer extends GodotMultiplayerPeer {
  constructor() {
    super('OfflineMultiplayerPeer');
    this.attach_browser_carrier(new OfflinePacketCarrier());
  }
}

/** Godot 3 class identity; ENet remains unavailable for the same browser transport reason. */
export class GodotNetworkedMultiplayerENet extends GodotENetMultiplayerPeer {
  private legacyBindIp = '*';
  private channelCount = 3;
  private compressionMode = 0;
  private alwaysOrdered = false;
  private dtlsEnabled = false;
  private dtlsVerify = true;
  private dtlsHostname = '';
  private serverRelay = true;

  constructor() {
    super('NetworkedMultiplayerENet', 3);
  }
  set_bind_ip(value: string): void {
    if (typeof value !== 'string' || value.length === 0) throw new TypeError('NetworkedMultiplayerENet.bind_ip requires String.');
    this.legacyBindIp = value;
  }
  get_bind_ip(): string { return this.legacyBindIp; }
  set_server_relay_enabled(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('NetworkedMultiplayerENet.server_relay requires bool.');
    this.serverRelay = enabled;
  }
  is_server_relay_enabled(): boolean { return this.serverRelay; }
  set_channel_count(channels: number): void {
    if (!Number.isInteger(channels) || channels < 1 || channels > 255) {
      throw new RangeError('NetworkedMultiplayerENet.channel_count requires 1..255.');
    }
    this.channelCount = channels;
  }
  get_channel_count(): number { return this.channelCount; }
  set_compression_mode(mode: number): void {
    if (!Number.isInteger(mode) || mode < 0 || mode > 4) {
      throw new RangeError('NetworkedMultiplayerENet.compression_mode requires a CompressionMode value.');
    }
    this.compressionMode = mode;
  }
  get_compression_mode(): number { return this.compressionMode; }
  set_always_ordered(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('NetworkedMultiplayerENet.always_ordered requires bool.');
    this.alwaysOrdered = enabled;
  }
  is_always_ordered(): boolean { return this.alwaysOrdered; }
  set_dtls_enabled(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('NetworkedMultiplayerENet.use_dtls requires bool.');
    this.dtlsEnabled = enabled;
  }
  is_dtls_enabled(): boolean { return this.dtlsEnabled; }
  set_dtls_verify_enabled(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('NetworkedMultiplayerENet.dtls_verify requires bool.');
    this.dtlsVerify = enabled;
  }
  is_dtls_verify_enabled(): boolean { return this.dtlsVerify; }
  set_dtls_hostname(hostname: string): void { this.dtlsHostname = String(hostname); }
  get_dtls_hostname(): string { return this.dtlsHostname; }
  set_dtls_certificate(_certificate: unknown): never {
    throw new Error('NetworkedMultiplayerENet DTLS certificates require a native ENet/DTLS carrier.');
  }
  set_dtls_key(_key: unknown): never {
    throw new Error('NetworkedMultiplayerENet DTLS keys require a native ENet/DTLS carrier.');
  }
  set_peer_timeout(..._arguments: readonly unknown[]): never {
    throw new Error('NetworkedMultiplayerENet peer timeouts require a native ENet peer.');
  }
  get_peer_address(_id: number): never { throw new Error('NetworkedMultiplayerENet peer address requires a native ENet peer.'); }
  get_peer_port(_id: number): never { throw new Error('NetworkedMultiplayerENet peer port requires a native ENet peer.'); }
  get_last_packet_channel(): number { return this.get_packet_channel(); }
}

export function createGodotMultiplayerAPI(): GodotMultiplayerAPI { return new GodotMultiplayerAPI(); }
export function createGodotSceneMultiplayer(): GodotSceneMultiplayer { return new GodotSceneMultiplayer(); }
export function createGodotMultiplayerPeer(): GodotMultiplayerPeer { return new GodotMultiplayerPeer(); }
export function createGodotENetMultiplayerPeer(): GodotENetMultiplayerPeer { return new GodotENetMultiplayerPeer(); }
export function createGodotENetConnection(): GodotENetConnection { return new GodotENetConnection(); }
export function createGodotOfflineMultiplayerPeer(): GodotOfflineMultiplayerPeer { return new GodotOfflineMultiplayerPeer(); }
export function createGodotNetworkedMultiplayerENet(): GodotNetworkedMultiplayerENet {
  return new GodotNetworkedMultiplayerENet();
}
export function createGodotWebSocketMultiplayerPeer(): GodotWebSocketMultiplayerPeer {
  return new GodotWebSocketMultiplayerPeer();
}
export function createGodotWebSocketServer(): GodotWebSocketServer {
  return new GodotWebSocketServer();
}
export function attachGodotBrowserWebSocketPacketCarrier(
  peer: GodotMultiplayerPeer,
  socket: GodotWebSocketPeer,
  options: {
    readonly localPeerId?: number;
    readonly remotePeerId: number;
    readonly server?: boolean;
    readonly awaitServerPeerId?: boolean;
  },
): GodotBrowserWebSocketPacketCarrier {
  const carrier = new GodotBrowserWebSocketPacketCarrier(socket, options);
  peer.attach_browser_carrier(carrier);
  return carrier;
}

export function godotGenerateMultiplayerPeerUniqueId(): number {
  const words = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(words);
    const value = (words[0] ?? 0) & 0x7fffffff;
    if (value > 1) return value;
  }
}
