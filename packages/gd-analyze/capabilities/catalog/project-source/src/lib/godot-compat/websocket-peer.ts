/** Godot WebSocketPeer/legacy WebSocketClient over the browser's native WebSocket. */

import { createGodotPacketState, type GodotPacketState, PACKET_PEER_ERR_UNAVAILABLE, PACKET_PEER_OK } from './packet-peer';
import { packedByteArray, packedStringArray, type PackedByteArray, type PackedStringArray } from './packed-array';
import { registerGodotObjectIdentity } from './object';
import { createSignal, type GodotSignal } from './signal';

export const WEBSOCKET_STATE_CONNECTING = 0;
export const WEBSOCKET_STATE_OPEN = 1;
export const WEBSOCKET_STATE_CLOSING = 2;
export const WEBSOCKET_STATE_CLOSED = 3;
export const WEBSOCKET_WRITE_MODE_TEXT = 0;
export const WEBSOCKET_WRITE_MODE_BINARY = 1;

type PeerEvent = 'open' | 'close' | 'error' | 'packet';
type PeerListener = (...args: readonly unknown[]) => void;

export class GodotWebSocketPeer {
  private readonly packet: GodotPacketState;
  private socket: WebSocket | null = null;
  private readyState = WEBSOCKET_STATE_CLOSED;
  private requestedUrl = '';
  private selectedProtocol = '';
  private protocols: string[] = [];
  private handshakeHeaders: string[] = [];
  private inboundBufferSize = 65_535;
  private outboundBufferSize = 65_535;
  private maxQueuedPackets = 4096;
  private heartbeatInterval = 0;
  private closeCode = -1;
  private closeReason = '';
  private lastPacketWasString = false;
  private writeMode = WEBSOCKET_WRITE_MODE_BINARY;
  private readonly packetKinds: boolean[] = [];
  private readonly listeners = new Map<PeerEvent, Set<PeerListener>>();
  private readonly pendingEvents: Array<() => void> = [];

  constructor(godotMajor: 3 | 4 = 4) {
    this.packet = createGodotPacketState({
      send: (bytes) => this.sendPacket(bytes),
      maxPacketSize: () => this.inboundBufferSize,
    }, godotMajor);
    registerGodotObjectIdentity(this, 'WebSocketPeer');
  }

  connect_to_url(url: string, tlsClientOptions: unknown = null): number {
    if (this.readyState !== WEBSOCKET_STATE_CLOSED) return 44;
    if (tlsClientOptions !== null && tlsClientOptions !== undefined) {
      throw new Error('WebSocketPeer custom TLSOptions cannot be represented by browser WebSocket.');
    }
    if (this.handshakeHeaders.length > 0) {
      throw new Error('WebSocketPeer.handshake_headers cannot be supplied by the browser WebSocket API.');
    }
    let parsed: URL;
    try { parsed = new URL(url, globalThis.location?.href); } catch { return 31; }
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return 31;
    this.resetClose();
    this.requestedUrl = parsed.href;
    this.readyState = WEBSOCKET_STATE_CONNECTING;
    try {
      const socket = new WebSocket(parsed, this.protocols);
      socket.binaryType = 'arraybuffer';
      this.socket = socket;
      socket.addEventListener('open', () => {
        this.pendingEvents.push(() => {
          if (this.socket !== socket) return;
          this.readyState = WEBSOCKET_STATE_OPEN;
          this.selectedProtocol = socket.protocol;
          this.emit('open', this.selectedProtocol);
        });
      });
      socket.addEventListener('message', (event) => {
        if (typeof event.data === 'string') {
          const bytes = new TextEncoder().encode(event.data);
          this.pendingEvents.push(() => this.receive(bytes, true, socket));
        } else if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data.slice(0));
          this.pendingEvents.push(() => this.receive(bytes, false, socket));
        } else if (event.data instanceof Blob) {
          void event.data.arrayBuffer().then((buffer) => {
            const bytes = new Uint8Array(buffer);
            this.pendingEvents.push(() => this.receive(bytes, false, socket));
          });
        }
      });
      socket.addEventListener('error', () => this.pendingEvents.push(() => this.emit('error')));
      socket.addEventListener('close', (event) => {
        this.pendingEvents.push(() => {
          if (this.socket !== socket) return;
          this.readyState = WEBSOCKET_STATE_CLOSED;
          this.closeCode = event.code;
          this.closeReason = event.reason;
          this.socket = null;
          this.emit('close', event.wasClean, event.code, event.reason);
        });
      });
      return 0;
    } catch {
      this.socket = null;
      this.readyState = WEBSOCKET_STATE_CLOSED;
      return 36;
    }
  }

  accept_stream(_stream: unknown): never {
    throw new Error('WebSocketPeer.accept_stream server-side WebSocket upgrades are unavailable in a browser client.');
  }

  poll(): void {
    const events = this.pendingEvents.splice(0);
    for (const event of events) event();
  }

  close(code = 1000, reason = ''): void {
    if (!Number.isInteger(code) || code < 1000 || code >= 5000) throw new RangeError('WebSocket close code must be 1000..4999.');
    if (code !== 1000 && code < 3000) {
      throw new Error(`Browser WebSocket clients cannot send reserved close code ${code}; use 1000 or 3000..4999.`);
    }
    const encoded = new TextEncoder().encode(reason);
    if (encoded.byteLength > 123) throw new RangeError('WebSocket close reason may contain at most 123 UTF-8 bytes.');
    if (this.socket === null) return;
    this.readyState = WEBSOCKET_STATE_CLOSING;
    this.socket.close(code, reason);
  }

  get_packet(): PackedByteArray {
    const result = this.packet.get_packet();
    this.lastPacketWasString = this.packetKinds.shift() ?? false;
    return result;
  }

  send(message: Iterable<number>, writeMode = WEBSOCKET_WRITE_MODE_BINARY): number {
    if (writeMode === WEBSOCKET_WRITE_MODE_TEXT) {
      const bytes = Uint8Array.from(message);
      return this.send_text(new TextDecoder().decode(bytes));
    }
    if (writeMode !== WEBSOCKET_WRITE_MODE_BINARY) return 31;
    return this.put_packet(message);
  }

  send_text(message: string): number {
    if (this.socket?.readyState !== WebSocket.OPEN) return PACKET_PEER_ERR_UNAVAILABLE;
    this.socket.send(String(message));
    return PACKET_PEER_OK;
  }

  private sendPacket(packet: Uint8Array): number {
    if (this.readyState !== WEBSOCKET_STATE_OPEN || this.socket?.readyState !== WebSocket.OPEN) return PACKET_PEER_ERR_UNAVAILABLE;
    if (this.socket.bufferedAmount + packet.byteLength >= this.outboundBufferSize) return 46;
    if (this.writeMode === WEBSOCKET_WRITE_MODE_TEXT) this.socket.send(new TextDecoder().decode(packet));
    else this.socket.send(packet);
    return PACKET_PEER_OK;
  }

  get_available_packet_count(): number { return this.packet.get_available_packet_count(); }
  put_packet(bytes: Iterable<number>): number { return this.packet.put_packet(bytes); }
  get_packet_error(): number { return this.packet.get_packet_error(); }
  get_max_packet_size(): number { return this.packet.get_max_packet_size(); }
  put_var(value: unknown, fullObjects = false): number { return this.packet.put_var(value, fullObjects); }
  get_var(allowObjects = false): unknown { return this.packet.get_var(allowObjects); }
  set_encode_buffer_max_size(bytes: number): void { this.packet.set_encode_buffer_max_size(bytes); }
  get_encode_buffer_max_size(): number { return this.packet.get_encode_buffer_max_size(); }
  set_allow_object_decoding(enabled: boolean): void { this.packet.set_allow_object_decoding(enabled); }
  is_object_decoding_allowed(): boolean { return this.packet.is_object_decoding_allowed(); }
  get encode_buffer_max_size(): number { return this.packet.encode_buffer_max_size; }
  set encode_buffer_max_size(bytes: number) { this.packet.encode_buffer_max_size = bytes; }
  get allow_object_decoding(): boolean { return this.packet.allow_object_decoding; }
  set allow_object_decoding(enabled: boolean) { this.packet.allow_object_decoding = enabled; }
  get_current_outbound_buffered_amount(): number { return this.socket?.bufferedAmount ?? 0; }
  is_connected_to_host(): boolean { return this.readyState === WEBSOCKET_STATE_OPEN; }
  set_no_delay(_enabled: boolean): never {
    throw new Error('WebSocketPeer.set_no_delay is unavailable in Godot web exports and browser WebSocket.');
  }
  was_string_packet(): boolean { return this.lastPacketWasString; }
  get_ready_state(): number { return this.readyState; }
  get_close_code(): number { return this.closeCode; }
  get_close_reason(): string { return this.closeReason; }
  get_connected_host(): string {
    if (this.readyState !== WEBSOCKET_STATE_OPEN || this.requestedUrl === '') return '';
    return new URL(this.requestedUrl).hostname;
  }
  get_connected_port(): never {
    throw new Error('WebSocketPeer.get_connected_port is unavailable in Godot web exports and browser WebSocket.');
  }
  get_requested_url(): string { return this.requestedUrl; }
  get_selected_protocol(): string { return this.selectedProtocol; }
  set_supported_protocols(protocols: Iterable<string>): void {
    if (this.readyState !== WEBSOCKET_STATE_CLOSED) throw new Error('WebSocketPeer supported protocols cannot change while connected.');
    this.protocols = [...protocols].map(String);
  }
  get_supported_protocols(): PackedStringArray { return packedStringArray(this.protocols); }
  set_handshake_headers(headers: Iterable<string>): void {
    this.requireClosed('handshake_headers');
    this.handshakeHeaders = [...headers].map(String);
  }
  get_handshake_headers(): PackedStringArray { return packedStringArray(this.handshakeHeaders); }
  set_inbound_buffer_size(bytes: number): void {
    this.requireClosed('inbound_buffer_size');
    this.inboundBufferSize = this.positiveSize(bytes, 'inbound_buffer_size');
  }
  get_inbound_buffer_size(): number { return this.inboundBufferSize; }
  set_outbound_buffer_size(bytes: number): void {
    this.requireClosed('outbound_buffer_size');
    this.outboundBufferSize = this.positiveSize(bytes, 'outbound_buffer_size');
  }
  get_outbound_buffer_size(): number { return this.outboundBufferSize; }
  set_max_queued_packets(count: number): void {
    this.requireClosed('max_queued_packets');
    this.maxQueuedPackets = this.positiveSize(count, 'max_queued_packets');
  }
  get_max_queued_packets(): number { return this.maxQueuedPackets; }
  set_heartbeat_interval(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('WebSocketPeer.heartbeat_interval requires a non-negative number.');
    if (seconds !== 0) throw new Error('Browser WebSocket cannot send native protocol ping frames for heartbeat_interval.');
    this.heartbeatInterval = 0;
  }
  get_heartbeat_interval(): number { return this.heartbeatInterval; }
  set_write_mode(mode: number): void {
    if (mode !== WEBSOCKET_WRITE_MODE_TEXT && mode !== WEBSOCKET_WRITE_MODE_BINARY) {
      throw new RangeError('WebSocketPeer.write_mode requires WRITE_MODE_TEXT or WRITE_MODE_BINARY.');
    }
    this.writeMode = mode;
  }
  get_write_mode(): number { return this.writeMode; }

  on(event: PeerEvent, listener: PeerListener): () => void {
    let listeners = this.listeners.get(event);
    if (listeners === undefined) { listeners = new Set(); this.listeners.set(event, listeners); }
    listeners.add(listener);
    return () => listeners?.delete(listener);
  }
  private emit(event: PeerEvent, ...args: readonly unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
  private receive(bytes: Uint8Array, text: boolean, socket: WebSocket): void {
    if (this.socket !== socket) return;
    if (this.get_available_packet_count() >= this.maxQueuedPackets) {
      this.emit('error');
      socket.close(1009, 'Godot max_queued_packets exceeded');
      return;
    }
    if (bytes.byteLength > this.inboundBufferSize) {
      this.emit('error');
      socket.close(1009, 'Godot inbound_buffer_size exceeded');
      return;
    }
    this.packet.queue(bytes);
    this.packetKinds.push(text);
    this.emit('packet');
  }
  private resetClose(): void {
    this.closeCode = -1; this.closeReason = ''; this.selectedProtocol = '';
    this.packet.clear(); this.packetKinds.length = 0; this.pendingEvents.length = 0;
  }
  private positiveSize(value: number, property: string): number {
    if (!Number.isInteger(value) || value < 1) throw new RangeError(`WebSocketPeer.${property} requires a positive integer.`);
    return value;
  }
  private requireClosed(property: string): void {
    if (this.readyState !== WEBSOCKET_STATE_CLOSED) {
      throw new Error(`WebSocketPeer.${property} cannot change while connected.`);
    }
  }
}

export interface GodotWebSocketClient {
  readonly connection_established: GodotSignal<readonly [string]>;
  readonly connection_error: GodotSignal<readonly []>;
  readonly connection_closed: GodotSignal<readonly [boolean]>;
  readonly data_received: GodotSignal<readonly []>;
  readonly server_close_request: GodotSignal<readonly [number, string]>;
}

export class GodotWebSocketClientPeer implements GodotWebSocketClient {
  private readonly peer = new GodotWebSocketPeer(3);
  private readonly established = createSignal<readonly [string]>();
  private readonly failed = createSignal<readonly []>();
  private readonly closed = createSignal<readonly [boolean]>();
  private readonly received = createSignal<readonly []>();
  private readonly serverClose = createSignal<readonly [number, string]>();
  private verifySsl = true;
  private trustedCertificate: unknown = null;
  private localDisconnect = false;
  private establishedConnection = false;
  private emittedConnectionError = false;
  readonly connection_established = this.established.signal;
  readonly connection_error = this.failed.signal;
  readonly connection_closed = this.closed.signal;
  readonly data_received = this.received.signal;
  readonly server_close_request = this.serverClose.signal;

  constructor() {
    registerGodotObjectIdentity(this, 'WebSocketClient');
    this.peer.on('open', (protocol) => {
      this.establishedConnection = true;
      this.established.emit(String(protocol ?? ''));
    });
    this.peer.on('error', () => {
      if (!this.establishedConnection && !this.emittedConnectionError) {
        this.emittedConnectionError = true;
        this.failed.emit();
      }
    });
    this.peer.on('close', (clean, code, reason) => {
      if (!this.establishedConnection) {
        if (!this.emittedConnectionError) this.failed.emit();
        this.localDisconnect = false;
        return;
      }
      if (!this.localDisconnect) this.serverClose.emit(Number(code ?? 1005), String(reason ?? ''));
      this.localDisconnect = false;
      this.establishedConnection = false;
      this.closed.emit(Boolean(clean));
    });
    this.peer.on('packet', () => this.received.emit());
  }

  connect_to_url(url: string, protocols: Iterable<string> = [], gdMpApi = false, customHeaders: Iterable<string> = []): number {
    if (gdMpApi) throw new Error('WebSocketClient gd_mp_api framing is unavailable without Godot MultiplayerAPI.');
    if (!this.verifySsl || this.trustedCertificate !== null) {
      throw new Error('WebSocketClient custom TLS certificate verification cannot be represented by browser WebSocket.');
    }
    this.peer.set_supported_protocols(protocols);
    this.peer.set_handshake_headers(customHeaders);
    this.localDisconnect = false;
    this.establishedConnection = false;
    this.emittedConnectionError = false;
    return this.peer.connect_to_url(url);
  }
  disconnect_from_host(code = 1000, reason = ''): void { this.localDisconnect = true; this.peer.close(code, reason); }
  get_peer(id = 1): GodotWebSocketPeer | null { return id === 1 ? this.peer : null; }
  get_connection_status(): number {
    const state = this.peer.get_ready_state();
    return state === WEBSOCKET_STATE_OPEN ? 2 : state === WEBSOCKET_STATE_CONNECTING ? 1 : 0;
  }
  poll(): void { this.peer.poll(); }
  get_available_packet_count(): number { return this.peer.get_available_packet_count(); }
  get_packet(): PackedByteArray { return this.peer.get_packet(); }
  put_packet(packet: Iterable<number>): number { return this.peer.put_packet(packet); }
  get_packet_error(): number { return this.peer.get_packet_error(); }
  get_max_packet_size(): number { return this.peer.get_max_packet_size(); }
  get_var(allowObjects = false): unknown { return this.peer.get_var(allowObjects); }
  put_var(value: unknown, fullObjects = false): number { return this.peer.put_var(value, fullObjects); }
  set_verify_ssl_enabled(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('WebSocketClient.verify_ssl requires bool.');
    this.verifySsl = enabled;
  }
  is_verify_ssl_enabled(): boolean { return this.verifySsl; }
  set_trusted_ssl_certificate(certificate: unknown): void { this.trustedCertificate = certificate; }
  get_trusted_ssl_certificate(): unknown { return this.trustedCertificate; }
  set_inbound_buffer_size(bytes: number): void { this.peer.set_inbound_buffer_size(bytes); }
  get_inbound_buffer_size(): number { return this.peer.get_inbound_buffer_size(); }
  set_outbound_buffer_size(bytes: number): void { this.peer.set_outbound_buffer_size(bytes); }
  get_outbound_buffer_size(): number { return this.peer.get_outbound_buffer_size(); }
  set_max_queued_packets(count: number): void { this.peer.set_max_queued_packets(count); }
  get_max_queued_packets(): number { return this.peer.get_max_queued_packets(); }
}

export function createGodotWebSocketPeer(godotMajor: 3 | 4 = 4): GodotWebSocketPeer {
  return new GodotWebSocketPeer(godotMajor);
}
export function createGodotWebSocketClient(): GodotWebSocketClientPeer {
  return new GodotWebSocketClientPeer();
}
