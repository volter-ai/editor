import { GodotWebSocketPeer, WEBSOCKET_STATE_CLOSED, WEBSOCKET_STATE_OPEN } from './websocket-peer';
import { packedByteArray, packedStringArray, type PackedByteArray, type PackedStringArray } from './packed-array';

export interface GodotWebSocketServerCarrier {
  listen(port: number, bindAddress: string, tlsOptions: unknown): number;
  poll(): void;
  close(): void;
  peers(): ReadonlyMap<number, GodotWebSocketPeer>;
  address(peerId: number): string;
  port(peerId: number): number;
  disconnect(peerId: number, force: boolean): void;
}

interface QueuedMultiplayerPacket {
  peerId: number;
  channel: number;
  mode: number;
  data: PackedByteArray;
}

export class GodotWebSocketMultiplayerPeer {
  private readonly peers = new Map<number, GodotWebSocketPeer>();
  private readonly queues: QueuedMultiplayerPacket[] = [];
  private readonly disconnectors = new Map<number, Array<() => void>>();
  private supportedProtocols: string[] = [];
  private handshakeHeaders: string[] = [];
  private inboundBufferSize = 65_535;
  private outboundBufferSize = 65_535;
  private handshakeTimeout = 3;
  private maxQueuedPackets = 4096;
  private targetPeer = 0;
  private transferChannel = 0;
  private transferMode = 2;
  private packetError = 0;
  private uniqueId = 0;
  private server = false;
  private connectionStatus = 0;
  private refuseConnections = false;
  private currentPacket: QueuedMultiplayerPacket | null = null;

  constructor(private readonly serverCarrier: GodotWebSocketServerCarrier | null = null) {}

  create_client(url: string, tlsClientOptions: unknown = null): number {
    this.close();
    const peer = this.configurePeer(new GodotWebSocketPeer(), 1);
    const result = peer.connect_to_url(url, tlsClientOptions);
    if (result !== 0) return result;
    this.server = false;
    this.uniqueId = 0;
    this.connectionStatus = 1;
    this.peers.set(1, peer);
    return 0;
  }

  create_server(port: number, bindAddress = '*', tlsServerOptions: unknown = null): number {
    if (this.serverCarrier === null) return 2;
    this.close();
    const result = this.serverCarrier.listen(port, bindAddress, tlsServerOptions);
    if (result !== 0) return result;
    this.server = true;
    this.uniqueId = 1;
    this.connectionStatus = 2;
    this.syncServerPeers();
    return 0;
  }

  get_peer(peerId: number): GodotWebSocketPeer | null { return this.peers.get(peerId) ?? null; }
  get_peer_address(id: number): string { return this.serverCarrier?.address(id) ?? this.peers.get(id)?.get_connected_host() ?? ''; }
  get_peer_port(id: number): number { return this.serverCarrier?.port(id) ?? 0; }
  get_supported_protocols(): PackedStringArray { return packedStringArray(this.supportedProtocols); }
  set_supported_protocols(protocols: Iterable<string>): void { this.requireDisconnected(); this.supportedProtocols = [...protocols].map(String); }
  get_handshake_headers(): PackedStringArray { return packedStringArray(this.handshakeHeaders); }
  set_handshake_headers(headers: Iterable<string>): void { this.requireDisconnected(); this.handshakeHeaders = [...headers].map(String); }
  get_inbound_buffer_size(): number { return this.inboundBufferSize; }
  set_inbound_buffer_size(bufferSize: number): void { this.requireDisconnected(); this.inboundBufferSize = this.size(bufferSize); }
  get_outbound_buffer_size(): number { return this.outboundBufferSize; }
  set_outbound_buffer_size(bufferSize: number): void { this.requireDisconnected(); this.outboundBufferSize = this.size(bufferSize); }
  get_handshake_timeout(): number { return this.handshakeTimeout; }
  set_handshake_timeout(timeout: number): void {
    this.requireDisconnected();
    if (!Number.isFinite(timeout) || timeout <= 0) throw new RangeError('WebSocketMultiplayerPeer handshake timeout must be positive.');
    this.handshakeTimeout = timeout;
  }
  set_max_queued_packets(maxQueuedPackets: number): void { this.requireDisconnected(); this.maxQueuedPackets = this.size(maxQueuedPackets); }
  get_max_queued_packets(): number { return this.maxQueuedPackets; }

  poll(): number {
    if (this.server) {
      this.serverCarrier?.poll();
      this.syncServerPeers();
    }
    for (const peer of this.peers.values()) peer.poll();
    if (!this.server) {
      const peer = this.peers.get(1);
      if (peer?.get_ready_state() === WEBSOCKET_STATE_OPEN) {
        this.connectionStatus = 2;
        if (this.uniqueId === 0) this.uniqueId = this.randomPeerId();
      } else if (peer?.get_ready_state() === WEBSOCKET_STATE_CLOSED) this.connectionStatus = 0;
    }
    return 0;
  }

  close(): void {
    for (const unsubscribe of this.disconnectors.values()) for (const callback of unsubscribe) callback();
    this.disconnectors.clear();
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
    this.queues.length = 0;
    this.currentPacket = null;
    this.serverCarrier?.close();
    this.server = false;
    this.uniqueId = 0;
    this.connectionStatus = 0;
  }

  disconnect_peer(peerId: number, force = false): void {
    if (this.serverCarrier !== null && this.server) this.serverCarrier.disconnect(peerId, force);
    const peer = this.peers.get(peerId);
    if (peer !== undefined) peer.close(force ? 4000 : 1000, force ? 'Disconnected' : '');
    this.removePeer(peerId);
  }

  get_available_packet_count(): number { return this.queues.length; }

  get_packet(): PackedByteArray {
    const packet = this.queues.shift();
    if (packet === undefined) { this.packetError = 1; return packedByteArray(); }
    this.currentPacket = packet;
    this.packetError = 0;
    return packet.data;
  }

  put_packet(packet: Iterable<number>): number {
    const bytes = Uint8Array.from(packet);
    const recipients = this.resolveTargets();
    if (recipients.length === 0) return 1;
    let error = 0;
    for (const peer of recipients) error ||= peer.put_packet(bytes);
    this.packetError = error;
    return error;
  }

  get_packet_error(): number { return this.packetError; }
  get_max_packet_size(): number { return this.inboundBufferSize; }
  get_packet_peer(): number { return this.currentPacket?.peerId ?? 0; }
  get_packet_channel(): number { return this.currentPacket?.channel ?? 0; }
  get_packet_mode(): number { return this.currentPacket?.mode ?? 2; }
  set_target_peer(peer: number): void { this.targetPeer = peer; }
  get_target_peer(): number { return this.targetPeer; }
  set_transfer_channel(channel: number): void { this.transferChannel = channel; }
  get_transfer_channel(): number { return this.transferChannel; }
  set_transfer_mode(mode: number): void { this.transferMode = mode; }
  get_transfer_mode(): number { return this.transferMode; }
  get_unique_id(): number { return this.uniqueId; }
  is_server(): boolean { return this.server; }
  get_connection_status(): number { return this.connectionStatus; }
  set_refuse_new_connections(enable: boolean): void { this.refuseConnections = enable; }
  is_refusing_new_connections(): boolean { return this.refuseConnections; }
  is_server_relay_supported(): boolean { return true; }

  private configurePeer(peer: GodotWebSocketPeer, peerId: number): GodotWebSocketPeer {
    peer.set_supported_protocols(this.supportedProtocols);
    peer.set_handshake_headers(this.handshakeHeaders);
    peer.set_inbound_buffer_size(this.inboundBufferSize);
    peer.set_outbound_buffer_size(this.outboundBufferSize);
    peer.set_max_queued_packets(this.maxQueuedPackets);
    const subscriptions = [
      peer.on('packet', () => {
        while (peer.get_available_packet_count() > 0 && this.queues.length < this.maxQueuedPackets) {
          this.queues.push({ peerId, channel: 0, mode: 2, data: peer.get_packet() });
        }
      }),
      peer.on('close', () => this.removePeer(peerId)),
    ];
    this.disconnectors.set(peerId, subscriptions);
    return peer;
  }

  private syncServerPeers(): void {
    if (this.serverCarrier === null) return;
    for (const [id, peer] of this.serverCarrier.peers()) {
      if (this.refuseConnections && !this.peers.has(id)) { this.serverCarrier.disconnect(id, true); continue; }
      if (!this.peers.has(id)) this.peers.set(id, this.configurePeer(peer, id));
    }
  }

  private removePeer(peerId: number): void {
    for (const callback of this.disconnectors.get(peerId) ?? []) callback();
    this.disconnectors.delete(peerId);
    this.peers.delete(peerId);
  }

  private resolveTargets(): GodotWebSocketPeer[] {
    if (!this.server) return this.peers.get(1) ? [this.peers.get(1)!] : [];
    if (this.targetPeer > 0) return this.peers.get(this.targetPeer) ? [this.peers.get(this.targetPeer)!] : [];
    if (this.targetPeer < 0) return [...this.peers].filter(([id]) => id !== -this.targetPeer).map(([, peer]) => peer);
    return [...this.peers.values()];
  }

  private requireDisconnected(): void { if (this.connectionStatus !== 0) throw new Error('WebSocketMultiplayerPeer setting cannot change while active.'); }
  private size(value: number): number { if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('WebSocketMultiplayerPeer buffer size must be positive.'); return value; }
  private randomPeerId(): number { return Math.max(2, Math.floor(Math.random() * 0x7fff_fffd) + 2); }
}

export function createGodotWebSocketMultiplayerPeer(serverCarrier: GodotWebSocketServerCarrier | null = null): GodotWebSocketMultiplayerPeer {
  return new GodotWebSocketMultiplayerPeer(serverCarrier);
}
