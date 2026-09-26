import { registerGodotObjectIdentity } from './object';
import { packedByteArray, type PackedByteArray } from './packed-array';

export const GodotENetCompressionMode = {
  NONE: 0,
  RANGE_CODER: 1,
  FASTLZ: 2,
  ZLIB: 3,
  ZSTD: 4,
} as const;

export const GodotENetEventType = {
  NONE: 0,
  CONNECT: 1,
  DISCONNECT: 2,
  RECEIVE: 3,
} as const;

export const GodotENetPeerState = {
  DISCONNECTED: 0,
  CONNECTING: 1,
  ACKNOWLEDGING_CONNECT: 2,
  CONNECTION_PENDING: 3,
  CONNECTION_SUCCEEDED: 4,
  CONNECTED: 5,
  DISCONNECT_LATER: 6,
  DISCONNECTING: 7,
  ACKNOWLEDGING_DISCONNECT: 8,
  ZOMBIE: 9,
} as const;

export interface GodotENetAddress {
  readonly host: string;
  readonly port: number;
}

export interface GodotENetCarrierEvent {
  readonly type: number;
  readonly peer: object | null;
  readonly channel: number;
  readonly data: number;
  readonly packet: Uint8Array | null;
}

export interface GodotENetTransportCarrier {
  createHost(address: GodotENetAddress | null, maxClients: number, maxChannels: number, inBandwidth: number, outBandwidth: number): object | null;
  connect(host: object, address: GodotENetAddress, channelCount: number, data: number): object | null;
  service(host: object, timeoutMs: number): GodotENetCarrierEvent | null;
  checkEvents?(host: object): GodotENetCarrierEvent | null;
  flush(host: object): void;
  broadcast(host: object, channel: number, packet: Uint8Array, flags: number): void;
  destroyHost(host: object): void;
  setBandwidthLimit?(host: object, inBandwidth: number, outBandwidth: number): void;
  setChannelLimit?(host: object, limit: number): void;
  setCompression?(host: object, mode: number): void;
  send(peer: object, channel: number, packet: Uint8Array, flags: number): number;
  ping(peer: object): void;
  pingInterval?(peer: object, interval: number): void;
  timeout?(peer: object, timeout: number, minimum: number, maximum: number): void;
  disconnect(peer: object, data: number, later: boolean, now: boolean): void;
  reset(peer: object): void;
  peerAddress(peer: object): GodotENetAddress;
  peerState(peer: object): number;
  peerRoundTripTime?(peer: object): number;
  peerStatistic?(peer: object, statistic: number): number;
  setPeerThrottle?(peer: object, interval: number, acceleration: number, deceleration: number): void;
  setPeerData?(peer: object, data: unknown): void;
  getPeerData?(peer: object): unknown;
}

function integer(member: string, value: number, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${member} requires an integer in [${minimum}, ${maximum}].`);
  }
  return value;
}

function port(member: string, value: number): number { return integer(member, value, 0, 65_535); }
function address(host: string, portValue: number): GodotENetAddress {
  if (typeof host !== 'string' || host.length === 0) throw new TypeError('ENet address host requires a nonempty String.');
  return { host, port: port('ENet address port', portValue) };
}

export class GodotENetPacketPeer {
  private metadata: unknown = null;
  constructor(private readonly carrier: GodotENetTransportCarrier, private readonly handle: object) {
    registerGodotObjectIdentity(this, 'ENetPacketPeer');
  }
  get_native_handle(): object { return this.handle; }
  peer_send(channel: number, packet: Iterable<number>, flags = 1): number {
    return this.carrier.send(this.handle, integer('ENetPacketPeer channel', channel, 0, 255), Uint8Array.from(packet), integer('ENetPacketPeer flags', flags));
  }
  ping(): void { this.carrier.ping(this.handle); }
  ping_interval(interval: number): void { this.carrier.pingInterval?.(this.handle, integer('ENetPacketPeer ping_interval', interval)); }
  timeout(timeoutValue: number, minimum: number, maximum: number): void {
    this.carrier.timeout?.(
      this.handle,
      integer('ENetPacketPeer timeout', timeoutValue),
      integer('ENetPacketPeer timeout_minimum', minimum),
      integer('ENetPacketPeer timeout_maximum', maximum),
    );
  }
  reset(): void { this.carrier.reset(this.handle); }
  disconnect(data = 0): void { this.carrier.disconnect(this.handle, integer('ENetPacketPeer disconnect data', data), false, false); }
  disconnect_later(data = 0): void { this.carrier.disconnect(this.handle, integer('ENetPacketPeer disconnect_later data', data), true, false); }
  disconnect_now(data = 0): void { this.carrier.disconnect(this.handle, integer('ENetPacketPeer disconnect_now data', data), false, true); }
  get_remote_address(): string { return this.carrier.peerAddress(this.handle).host; }
  get_remote_port(): number { return this.carrier.peerAddress(this.handle).port; }
  get_state(): number { return this.carrier.peerState(this.handle); }
  get_statistic(statistic: number): number {
    const kind = integer('ENetPacketPeer statistic', statistic);
    return this.carrier.peerStatistic?.(this.handle, kind) ?? (kind === 8 ? this.get_round_trip_time() : 0);
  }
  get_round_trip_time(): number { return this.carrier.peerRoundTripTime?.(this.handle) ?? 0; }
  throttle_configure(interval: number, acceleration: number, deceleration: number): void {
    this.carrier.setPeerThrottle?.(
      this.handle,
      integer('ENetPacketPeer throttle interval', interval),
      integer('ENetPacketPeer throttle acceleration', acceleration),
      integer('ENetPacketPeer throttle deceleration', deceleration),
    );
  }
  set_meta(value: unknown): void { this.metadata = value; this.carrier.setPeerData?.(this.handle, value); }
  get_meta(): unknown { return this.carrier.getPeerData?.(this.handle) ?? this.metadata; }
}

export interface GodotENetConnectionEvent {
  readonly type: number;
  readonly peer: GodotENetPacketPeer | null;
  readonly channelId: number;
  readonly data: number;
  readonly packet: PackedByteArray;
}

export class GodotENetConnection {
  private host: object | null = null;
  private compressionMode: number = GodotENetCompressionMode.NONE;
  private dtlsEnabled = false;
  private dtlsServer = false;
  private dtlsHostname = '';
  private dtlsOptions: unknown = null;
  private readonly peers = new WeakMap<object, GodotENetPacketPeer>();

  constructor(private readonly carrier: GodotENetTransportCarrier) {
    registerGodotObjectIdentity(this, 'ENetConnection');
  }

  create_host(maxClients = 32, maxChannels = 0, inBandwidth = 0, outBandwidth = 0): number {
    return this.create(null, maxClients, maxChannels, inBandwidth, outBandwidth);
  }
  create_host_bound(bindAddress: string, bindPort: number, maxClients = 32, maxChannels = 0, inBandwidth = 0, outBandwidth = 0): number {
    return this.create(address(bindAddress, bindPort), maxClients, maxChannels, inBandwidth, outBandwidth);
  }
  connect_to_host(targetAddress: string, targetPort: number, channels = 0, data = 0): GodotENetPacketPeer | null {
    const host = this.requireHost();
    const handle = this.carrier.connect(host, address(targetAddress, targetPort), integer('ENetConnection channel_count', channels), integer('ENetConnection connect data', data));
    return handle === null ? null : this.peer(handle);
  }
  service(timeoutMs = 0): GodotENetConnectionEvent {
    const event = this.carrier.service(this.requireHost(), integer('ENetConnection service timeout', timeoutMs));
    return this.event(event);
  }
  check_events(): GodotENetConnectionEvent {
    const event = this.carrier.checkEvents?.(this.requireHost()) ?? null;
    return this.event(event);
  }
  flush(): void { this.carrier.flush(this.requireHost()); }
  broadcast(channel: number, packet: Iterable<number>, flags = 1): void {
    this.carrier.broadcast(this.requireHost(), integer('ENetConnection broadcast channel', channel, 0, 255), Uint8Array.from(packet), integer('ENetConnection broadcast flags', flags));
  }
  bandwidth_limit(inBandwidth = 0, outBandwidth = 0): void {
    this.carrier.setBandwidthLimit?.(this.requireHost(), integer('ENetConnection in_bandwidth', inBandwidth), integer('ENetConnection out_bandwidth', outBandwidth));
  }
  channel_limit(limit: number): void { this.carrier.setChannelLimit?.(this.requireHost(), integer('ENetConnection channel_limit', limit, 0, 255)); }
  compress(mode: number): void {
    this.compressionMode = integer('ENetConnection compression_mode', mode, 0, 4);
    if (this.host !== null) this.carrier.setCompression?.(this.host, this.compressionMode);
  }
  get_compression_mode(): number { return this.compressionMode; }
  configure_dtls_server(options: unknown): void { this.dtlsEnabled = true; this.dtlsServer = true; this.dtlsOptions = options; }
  configure_dtls_client(hostname: string, options: unknown): void {
    if (typeof hostname !== 'string') throw new TypeError('ENetConnection DTLS hostname requires String.');
    this.dtlsEnabled = true; this.dtlsServer = false; this.dtlsHostname = hostname; this.dtlsOptions = options;
  }
  disable_dtls(): void { this.dtlsEnabled = false; this.dtlsServer = false; this.dtlsHostname = ''; this.dtlsOptions = null; }
  is_dtls_enabled(): boolean { return this.dtlsEnabled; }
  is_dtls_server(): boolean { return this.dtlsServer; }
  get_dtls_hostname(): string { return this.dtlsHostname; }
  get_dtls_options(): unknown { return this.dtlsOptions; }
  destroy(): void {
    if (this.host === null) return;
    this.carrier.destroyHost(this.host);
    this.host = null;
  }
  is_created(): boolean { return this.host !== null; }
  get_native_handle(): object | null { return this.host; }

  private create(bind: GodotENetAddress | null, maxClients: number, maxChannels: number, inBandwidth: number, outBandwidth: number): number {
    this.destroy();
    const host = this.carrier.createHost(
      bind,
      integer('ENetConnection max_clients', maxClients, 1),
      integer('ENetConnection max_channels', maxChannels, 0, 255),
      integer('ENetConnection in_bandwidth', inBandwidth),
      integer('ENetConnection out_bandwidth', outBandwidth),
    );
    if (host === null) return 1;
    this.host = host;
    this.carrier.setCompression?.(host, this.compressionMode);
    return 0;
  }
  private requireHost(): object {
    if (this.host === null) throw new Error('ENetConnection host has not been created.');
    return this.host;
  }
  private peer(handle: object): GodotENetPacketPeer {
    let value = this.peers.get(handle);
    if (value === undefined) { value = new GodotENetPacketPeer(this.carrier, handle); this.peers.set(handle, value); }
    return value;
  }
  private event(value: GodotENetCarrierEvent | null): GodotENetConnectionEvent {
    if (value === null) return { type: 0, peer: null, channelId: 0, data: 0, packet: packedByteArray() };
    return {
      type: integer('ENet event type', value.type, 0, 3),
      peer: value.peer === null ? null : this.peer(value.peer),
      channelId: integer('ENet event channel', value.channel, 0, 255),
      data: integer('ENet event data', value.data),
      packet: packedByteArray(value.packet ?? []),
    };
  }
}

interface QueuedPacket {
  readonly peerId: number;
  readonly channel: number;
  readonly mode: number;
  readonly data: PackedByteArray;
}

export class GodotENetMultiplayerPeer {
  private readonly connection: GodotENetConnection;
  private readonly peers = new Map<number, GodotENetPacketPeer>();
  private readonly handleToId = new WeakMap<object, number>();
  private readonly packets: QueuedPacket[] = [];
  private uniqueId = 0;
  private connectionStatus = 0;
  private server = false;
  private targetPeer = 0;
  private transferChannel = 0;
  private transferMode = 2;
  private refuseConnections = false;
  private currentPacket: QueuedPacket | null = null;
  private packetError = 0;
  private nextPeerId = 2;

  constructor(carrier: GodotENetTransportCarrier) {
    this.connection = new GodotENetConnection(carrier);
    registerGodotObjectIdentity(this, 'ENetMultiplayerPeer');
  }

  create_server(portValue: number, maxClients = 32, maxChannels = 0, inBandwidth = 0, outBandwidth = 0): number {
    this.close();
    const error = this.connection.create_host_bound('*', portValue, maxClients, maxChannels, inBandwidth, outBandwidth);
    if (error !== 0) return error;
    this.server = true; this.uniqueId = 1; this.connectionStatus = 2;
    return 0;
  }
  create_client(targetAddress: string, targetPort: number, channelCount = 0, inBandwidth = 0, outBandwidth = 0, localPort = 0): number {
    this.close();
    const created = localPort === 0
      ? this.connection.create_host(1, channelCount, inBandwidth, outBandwidth)
      : this.connection.create_host_bound('*', localPort, 1, channelCount, inBandwidth, outBandwidth);
    if (created !== 0) return created;
    const peer = this.connection.connect_to_host(targetAddress, targetPort, channelCount);
    if (peer === null) { this.close(); return 1; }
    this.server = false; this.uniqueId = this.randomPeerId(); this.connectionStatus = 1;
    this.registerPeer(1, peer);
    return 0;
  }
  create_mesh(uniqueId: number): number {
    this.close();
    const created = this.connection.create_host();
    if (created !== 0) return created;
    this.uniqueId = integer('ENetMultiplayerPeer unique_id', uniqueId, 1, 0x7fff_ffff);
    this.connectionStatus = 2; this.server = false;
    return 0;
  }
  add_mesh_peer(peerId: number, peer: GodotENetPacketPeer): number {
    const id = integer('ENetMultiplayerPeer peer_id', peerId, 1, 0x7fff_ffff);
    if (id === this.uniqueId || this.peers.has(id)) return 1;
    this.registerPeer(id, peer); return 0;
  }
  poll(): number {
    if (!this.connection.is_created()) return 0;
    for (;;) {
      const event = this.connection.check_events();
      if (event.type === GodotENetEventType.NONE) break;
      this.consume(event);
    }
    const event = this.connection.service(0);
    if (event.type !== GodotENetEventType.NONE) this.consume(event);
    return 0;
  }
  close(): void {
    this.connection.destroy(); this.peers.clear(); this.packets.length = 0; this.currentPacket = null;
    this.uniqueId = 0; this.connectionStatus = 0; this.server = false; this.nextPeerId = 2;
  }
  disconnect_peer(peerId: number, now = false): void {
    const peer = this.peers.get(integer('ENetMultiplayerPeer peer_id', peerId, 1));
    if (peer === undefined) return;
    if (now) peer.disconnect_now(); else peer.disconnect();
    this.peers.delete(peerId);
  }
  get_peer(peerId: number): GodotENetPacketPeer | null { return this.peers.get(peerId) ?? null; }
  get_available_packet_count(): number { return this.packets.length; }
  get_packet(): PackedByteArray {
    const packet = this.packets.shift();
    if (packet === undefined) { this.packetError = 1; return packedByteArray(); }
    this.currentPacket = packet; this.packetError = 0; return packet.data;
  }
  put_packet(packet: Iterable<number>): number {
    const bytes = Uint8Array.from(packet);
    const recipients = this.targets();
    if (recipients.length === 0) return 1;
    let error = 0;
    for (const peer of recipients) error ||= peer.peer_send(this.transferChannel, bytes, this.packetFlags());
    this.packetError = error; return error;
  }
  get_packet_error(): number { return this.packetError; }
  get_packet_peer(): number { return this.currentPacket?.peerId ?? 0; }
  get_packet_channel(): number { return this.currentPacket?.channel ?? 0; }
  get_packet_mode(): number { return this.currentPacket?.mode ?? 2; }
  get_max_packet_size(): number { return 1_048_576; }
  set_target_peer(value: number): void { this.targetPeer = integer('ENetMultiplayerPeer target_peer', Math.abs(value), 0, 0x7fff_ffff) * Math.sign(value); }
  get_target_peer(): number { return this.targetPeer; }
  set_transfer_channel(value: number): void { this.transferChannel = integer('ENetMultiplayerPeer transfer_channel', value, 0, 255); }
  get_transfer_channel(): number { return this.transferChannel; }
  set_transfer_mode(value: number): void { this.transferMode = integer('ENetMultiplayerPeer transfer_mode', value, 0, 2); }
  get_transfer_mode(): number { return this.transferMode; }
  get_unique_id(): number { return this.uniqueId; }
  is_server(): boolean { return this.server; }
  get_connection_status(): number { return this.connectionStatus; }
  set_refuse_new_connections(value: boolean): void { this.refuseConnections = value; }
  is_refusing_new_connections(): boolean { return this.refuseConnections; }
  is_server_relay_supported(): boolean { return true; }
  get_host(): GodotENetConnection { return this.connection; }

  private consume(event: GodotENetConnectionEvent): void {
    if (event.peer === null) return;
    if (event.type === GodotENetEventType.CONNECT) {
      if (this.refuseConnections) { event.peer.disconnect_now(); return; }
      if (!this.handleToId.has(event.peer.get_native_handle())) this.registerPeer(this.server ? this.nextPeerId++ : 1, event.peer);
      this.connectionStatus = 2;
    } else if (event.type === GodotENetEventType.DISCONNECT) {
      const id = this.handleToId.get(event.peer.get_native_handle());
      if (id !== undefined) this.peers.delete(id);
      if (!this.server && id === 1) this.connectionStatus = 0;
    } else if (event.type === GodotENetEventType.RECEIVE) {
      const id = this.handleToId.get(event.peer.get_native_handle()) ?? 0;
      this.packets.push({ peerId: id, channel: event.channelId, mode: 2, data: event.packet });
    }
  }
  private registerPeer(id: number, peer: GodotENetPacketPeer): void { this.peers.set(id, peer); this.handleToId.set(peer.get_native_handle(), id); }
  private targets(): GodotENetPacketPeer[] {
    if (this.targetPeer > 0) { const peer = this.peers.get(this.targetPeer); return peer === undefined ? [] : [peer]; }
    if (this.targetPeer < 0) return [...this.peers].filter(([id]) => id !== -this.targetPeer).map(([, peer]) => peer);
    return [...this.peers.values()];
  }
  private packetFlags(): number { return this.transferMode === 0 ? 0 : this.transferMode === 1 ? 2 : 1; }
  private randomPeerId(): number { return 2 + Math.floor(Math.random() * 0x7fff_fffd); }
}

export const createGodotENetConnection = (carrier: GodotENetTransportCarrier): GodotENetConnection => new GodotENetConnection(carrier);
export const createGodotENetMultiplayerPeer = (carrier: GodotENetTransportCarrier): GodotENetMultiplayerPeer => new GodotENetMultiplayerPeer(carrier);
