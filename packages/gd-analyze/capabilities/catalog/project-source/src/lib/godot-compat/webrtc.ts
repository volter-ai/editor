/** Godot WebRTC resources over the browser's native RTCPeerConnection and RTCDataChannel. */

import { registerGodotObjectIdentity } from './object';
import { createSignal, type GodotSignal } from './signal';
import {
  GodotMultiplayerPeer,
  MULTIPLAYER_PEER_CONNECTION_CONNECTED,
  MULTIPLAYER_PEER_CONNECTION_CONNECTING,
  MULTIPLAYER_PEER_CONNECTION_DISCONNECTED,
  MULTIPLAYER_PEER_TRANSFER_MODE_RELIABLE,
  MULTIPLAYER_PEER_TRANSFER_MODE_UNRELIABLE_ORDERED,
  type GodotMultiplayerPacketCarrier,
} from './multiplayer-api';

const OK = 0;
const ERR_UNAVAILABLE = 2;

function browserValue(value: unknown): unknown {
  if (value instanceof Map) {
    return Object.fromEntries([...value].map(([key, entry]) => [String(key), browserValue(entry)]));
  }
  if (Array.isArray(value)) return value.map(browserValue);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, browserValue(entry)]));
  }
  return value;
}

function dictionaryObject(value: unknown, member: string): Record<string, unknown> {
  if (value instanceof Map) return browserValue(value) as Record<string, unknown>;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return browserValue(value) as Record<string, unknown>;
  }
  throw new TypeError(`${member} requires a Dictionary.`);
}

function browserRtcConstructor(): typeof RTCPeerConnection {
  const constructor = globalThis.RTCPeerConnection;
  if (constructor === undefined) {
    throw new Error('WebRTCPeerConnection requires the browser RTCPeerConnection API.');
  }
  return constructor;
}

function description(type: string, sdp: string): RTCSessionDescriptionInit {
  if (type !== 'offer' && type !== 'answer' && type !== 'pranswer' && type !== 'rollback') {
    throw new TypeError(`WebRTCPeerConnection description type ${JSON.stringify(type)} is invalid.`);
  }
  if (typeof sdp !== 'string') throw new TypeError('WebRTCPeerConnection description SDP requires String.');
  return type === 'rollback' ? { type } : { type, sdp };
}

export class GodotWebRTCPeerConnection {
  private readonly iceCandidate = createSignal<readonly [string, number, string]>();
  private readonly sessionDescription = createSignal<readonly [string, string]>();
  readonly ice_candidate_created: GodotSignal<readonly [string, number, string]> = this.iceCandidate.signal;
  readonly session_description_created: GodotSignal<readonly [string, string]> = this.sessionDescription.signal;
  private connection: RTCPeerConnection | null = null;
  /** Retained native rejection for host diagnostics; promise failures never escape as unhandled events. */
  last_async_error: unknown = null;

  constructor() {
    registerGodotObjectIdentity(this, 'WebRTCPeerConnection');
  }

  initialize(configuration: unknown = {}): number {
    const config = dictionaryObject(configuration, 'WebRTCPeerConnection.initialize') as RTCConfiguration;
    this.connection?.close();
    this.last_async_error = null;
    const NativePeer = browserRtcConstructor();
    const connection = new NativePeer(config);
    connection.addEventListener('icecandidate', (event) => {
      if (this.connection !== connection) return;
      const candidate = event.candidate;
      if (candidate === null) return;
      this.iceCandidate.emit(
        candidate.sdpMid ?? '',
        candidate.sdpMLineIndex ?? 0,
        candidate.candidate,
      );
    });
    this.connection = connection;
    return OK;
  }

  create_offer(): number {
    const connection = this.connection;
    if (connection === null) return ERR_UNAVAILABLE;
    void connection.createOffer()
      .then((offer) => {
        if (this.connection === connection) this.sessionDescription.emit(offer.type, offer.sdp ?? '');
      })
      .catch((error: unknown) => {
        if (this.connection === connection) this.last_async_error = error;
      });
    return OK;
  }

  set_local_description(type: string, sdp: string): number {
    const connection = this.connection;
    if (connection === null) return ERR_UNAVAILABLE;
    void connection.setLocalDescription(description(type, sdp))
      .catch((error: unknown) => {
        if (this.connection === connection) this.last_async_error = error;
      });
    return OK;
  }

  set_remote_description(type: string, sdp: string): number {
    const connection = this.connection;
    if (connection === null) return ERR_UNAVAILABLE;
    const remote = description(type, sdp);
    void connection.setRemoteDescription(remote)
      .then(async () => {
        if (this.connection !== connection) return;
        if (remote.type !== 'offer') return;
        const answer = await connection.createAnswer();
        if (this.connection === connection) this.sessionDescription.emit(answer.type, answer.sdp ?? '');
      })
      .catch((error: unknown) => {
        if (this.connection === connection) this.last_async_error = error;
      });
    return OK;
  }

  add_ice_candidate(media: string, index: number, candidate: string): number {
    const connection = this.connection;
    if (connection === null) return ERR_UNAVAILABLE;
    if (typeof media !== 'string' || !Number.isSafeInteger(index) || index < 0 || typeof candidate !== 'string') {
      throw new TypeError('WebRTCPeerConnection.add_ice_candidate requires String, non-negative int, String.');
    }
    void connection.addIceCandidate({ sdpMid: media, sdpMLineIndex: index, candidate })
      .catch((error: unknown) => {
        if (this.connection === connection) this.last_async_error = error;
      });
    return OK;
  }

  create_data_channel(label: string, options: unknown = {}): GodotWebRTCDataChannel {
    if (typeof label !== 'string') throw new TypeError('WebRTCPeerConnection.create_data_channel requires String label.');
    const init = dictionaryObject(options, 'WebRTCPeerConnection.create_data_channel') as RTCDataChannelInit;
    return retainGodotWebRTCDataChannel(this.native('create_data_channel').createDataChannel(label, init));
  }

  poll(): number {
    return this.connection === null ? ERR_UNAVAILABLE : OK;
  }

  get_connection_state(): number {
    const state = this.connection?.connectionState ?? 'closed';
    return ({ new: 0, connecting: 1, connected: 2, disconnected: 3, failed: 4, closed: 5 } as const)[state];
  }

  get_gathering_state(): number {
    const state = this.connection?.iceGatheringState ?? 'complete';
    return ({ new: 0, gathering: 1, complete: 2 } as const)[state];
  }

  get_signaling_state(): number {
    const state = this.connection?.signalingState ?? 'closed';
    return ({ stable: 0, 'have-local-offer': 1, 'have-remote-offer': 2, 'have-local-pranswer': 3, 'have-remote-pranswer': 4, closed: 5 } as const)[state];
  }

  close(): void {
    this.connection?.close();
    this.connection = null;
    this.last_async_error = null;
  }

  native(member = 'native WebRTC operation'): RTCPeerConnection {
    if (this.connection === null) throw new Error(`WebRTCPeerConnection.${member} requires initialize() first.`);
    return this.connection;
  }
}

export function createGodotWebRTCPeerConnection(): GodotWebRTCPeerConnection {
  return new GodotWebRTCPeerConnection();
}

export const WEBRTC_DATA_CHANNEL_STATE_CONNECTING = 0;
export const WEBRTC_DATA_CHANNEL_STATE_OPEN = 1;
export const WEBRTC_DATA_CHANNEL_STATE_CLOSING = 2;
export const WEBRTC_DATA_CHANNEL_STATE_CLOSED = 3;

export class GodotWebRTCDataChannel {
  private writeMode = 1;
  constructor(readonly native: RTCDataChannel) {
    registerGodotObjectIdentity(this, 'WebRTCDataChannel');
  }

  get_ready_state(): number {
    switch (this.native.readyState) {
      case 'connecting': return WEBRTC_DATA_CHANNEL_STATE_CONNECTING;
      case 'open': return WEBRTC_DATA_CHANNEL_STATE_OPEN;
      case 'closing': return WEBRTC_DATA_CHANNEL_STATE_CLOSING;
      case 'closed': return WEBRTC_DATA_CHANNEL_STATE_CLOSED;
    }
  }

  poll(): number { return OK; }
  close(): void { this.native.close(); }
  was_string_packet(): boolean { return this.native.binaryType !== 'arraybuffer'; }
  set_write_mode(mode: number): void {
    if (mode !== 0 && mode !== 1) throw new RangeError('WebRTCDataChannel.set_write_mode requires WRITE_MODE_TEXT or WRITE_MODE_BINARY.');
    this.writeMode = mode;
    this.native.binaryType = mode === 1 ? 'arraybuffer' : 'blob';
  }
  get_write_mode(): number { return this.writeMode; }
  get_label(): string { return this.native.label; }
  is_ordered(): boolean { return this.native.ordered; }
  get_id(): number { return this.native.id ?? -1; }
  get_max_packet_life_time(): number { return this.native.maxPacketLifeTime ?? 0xffff; }
  get_max_retransmits(): number { return this.native.maxRetransmits ?? 0xffff; }
  get_protocol(): string { return this.native.protocol; }
  is_negotiated(): boolean { return this.native.negotiated; }
  get_buffered_amount(): number { return this.native.bufferedAmount; }
}

export function retainGodotWebRTCDataChannel(channel: RTCDataChannel): GodotWebRTCDataChannel {
  return new GodotWebRTCDataChannel(channel);
}

interface WebRTCPeerChannels {
  readonly connection: GodotWebRTCPeerConnection;
  readonly channels: readonly [RTCDataChannel, RTCDataChannel, RTCDataChannel];
}

class BrowserWebRTCMultiplayerCarrier implements GodotMultiplayerPacketCarrier {
  localPeerId = 0;
  server = false;
  status = MULTIPLAYER_PEER_CONNECTION_DISCONNECTED;
  readonly pendingLocalPeerId = true;
  readonly serverRelaySupported = false;
  private readonly remote = new Map<number, WebRTCPeerChannels>();
  private owner: GodotMultiplayerPeer | null = null;

  bind(owner: GodotMultiplayerPeer): () => void {
    this.owner = owner;
    return () => { this.owner = null; };
  }

  configure(localPeerId: number, server: boolean): void {
    if (!Number.isSafeInteger(localPeerId) || localPeerId < 1 || localPeerId > 0x7fff_ffff) {
      throw new RangeError('WebRTCMultiplayerPeer local peer ID requires a positive 31-bit integer.');
    }
    if (this.status !== MULTIPLAYER_PEER_CONNECTION_DISCONNECTED) {
      throw new Error('WebRTCMultiplayerPeer has already been initialized.');
    }
    this.localPeerId = localPeerId;
    this.server = server;
    this.status = server ? MULTIPLAYER_PEER_CONNECTION_CONNECTED : MULTIPLAYER_PEER_CONNECTION_CONNECTING;
  }

  peers(): readonly number[] { return [...this.remote.keys()].sort((a, b) => a - b); }
  poll(): number { return OK; }

  add(peer: GodotWebRTCPeerConnection, id: number, unreliableLifetime: number): number {
    if (this.localPeerId === 0) return ERR_UNAVAILABLE;
    if (!Number.isSafeInteger(id) || id < 1 || id > 0x7fff_ffff || id === this.localPeerId) {
      throw new RangeError('WebRTCMultiplayerPeer.add_peer requires a distinct positive 31-bit peer ID.');
    }
    if (!Number.isSafeInteger(unreliableLifetime) || unreliableLifetime < 0) {
      throw new RangeError('WebRTCMultiplayerPeer.add_peer unreliable_lifetime must be a non-negative integer.');
    }
    if (this.remote.has(id)) return 31;
    const connection = peer.native('add_peer');
    const reliable = connection.createDataChannel('_godot_reliable', { negotiated: true, id: 1, ordered: true });
    const unordered = connection.createDataChannel('_godot_unreliable', {
      negotiated: true,
      id: 2,
      ordered: false,
      maxRetransmits: 0,
    });
    const ordered = connection.createDataChannel('_godot_ordered', {
      negotiated: true,
      id: 3,
      ordered: true,
      maxPacketLifeTime: unreliableLifetime,
    });
    const channels = [reliable, unordered, ordered] as const;
    this.remote.set(id, { connection: peer, channels });
    let announced = false;
    const announce = (): void => {
      if (announced || !channels.every((channel) => channel.readyState === 'open')) return;
      announced = true;
      this.status = MULTIPLAYER_PEER_CONNECTION_CONNECTED;
      this.owner?.notify_peer_connected(id);
      if (!this.server && id === 1) this.owner?.notify_connection_succeeded();
    };
    channels.forEach((channel, channelIndex) => {
      channel.binaryType = 'arraybuffer';
      channel.addEventListener('open', announce);
      channel.addEventListener('message', (event) => {
        const bytes = event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : ArrayBuffer.isView(event.data)
            ? new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength)
            : null;
        if (bytes !== null) {
          const mode = channelIndex === 0
            ? MULTIPLAYER_PEER_TRANSFER_MODE_RELIABLE
            : channelIndex === 2
              ? MULTIPLAYER_PEER_TRANSFER_MODE_UNRELIABLE_ORDERED
              : 0;
          this.owner?.notify_packet(id, bytes, mode, 0);
        }
      });
      channel.addEventListener('close', () => {
        if (!announced) return;
        announced = false;
        this.owner?.notify_peer_disconnected(id);
        if (!this.server && id === 1) this.owner?.notify_server_disconnected();
      });
    });
    announce();
    return OK;
  }

  has(id: number): boolean { return this.remote.has(id); }
  get(id: number): GodotWebRTCPeerConnection | null {
    if (!Number.isSafeInteger(id) || id < 1 || id > 0x7fff_ffff) {
      throw new RangeError('WebRTCMultiplayerPeer.get_peer requires a positive 31-bit peer ID.');
    }
    return this.remote.get(id)?.connection ?? null;
  }

  remove(id: number): void {
    const found = this.remote.get(id);
    if (found === undefined) return;
    this.remote.delete(id);
    found.channels.forEach((channel) => channel.close());
  }

  send(packet: Uint8Array, targetPeer: number, transferMode: number): number {
    const targets = targetPeer === 0
      ? [...this.remote.entries()]
      : targetPeer < 0
        ? [...this.remote.entries()].filter(([id]) => id !== -targetPeer)
        : [...this.remote.entries()].filter(([id]) => id === targetPeer);
    if (targets.length === 0) return ERR_UNAVAILABLE;
    const channelIndex = transferMode === MULTIPLAYER_PEER_TRANSFER_MODE_RELIABLE
      ? 0
      : transferMode === MULTIPLAYER_PEER_TRANSFER_MODE_UNRELIABLE_ORDERED ? 2 : 1;
    for (const [, found] of targets) {
      const channel = found.channels[channelIndex];
      if (channel.readyState !== 'open') return ERR_UNAVAILABLE;
      channel.send(packet.slice().buffer);
    }
    return OK;
  }

  disconnectPeer(id: number): void { this.remove(id); }

  close(): void {
    for (const id of [...this.remote.keys()]) this.remove(id);
    this.status = MULTIPLAYER_PEER_CONNECTION_DISCONNECTED;
    this.localPeerId = 0;
  }
}

export class GodotWebRTCMultiplayerPeer extends GodotMultiplayerPeer {
  private readonly rtcCarrier = new BrowserWebRTCMultiplayerCarrier();

  constructor(private readonly major: 3 | 4) {
    super(major === 3 ? 'WebRTCMultiplayer' : 'WebRTCMultiplayerPeer', major);
    this.attach_browser_carrier(this.rtcCarrier);
  }

  initialize(peerId: number, serverCompatibility = false): number {
    if (this.major !== 3) throw new Error('WebRTCMultiplayerPeer.initialize is a Godot 3 API.');
    if (typeof serverCompatibility !== 'boolean') throw new TypeError('WebRTCMultiplayer.initialize server_compatibility requires bool.');
    if (serverCompatibility) {
      throw new Error('WebRTCMultiplayer.initialize server_compatibility requires Godot WebRTC server channel negotiation unavailable in browser peers.');
    }
    this.rtcCarrier.configure(peerId, peerId === 1);
    return OK;
  }

  create_client(peerId: number, channelsConfig: unknown[] = []): number {
    this.requireDefaultChannels(channelsConfig, 'create_client');
    this.rtcCarrier.configure(peerId, false);
    return OK;
  }

  create_server(channelsConfig: unknown[] = []): number {
    this.requireDefaultChannels(channelsConfig, 'create_server');
    this.rtcCarrier.configure(1, true);
    return OK;
  }

  create_mesh(peerId: number, channelsConfig: unknown[] = []): number {
    this.requireDefaultChannels(channelsConfig, 'create_mesh');
    this.rtcCarrier.configure(peerId, false);
    return OK;
  }

  add_peer(peer: GodotWebRTCPeerConnection, peerId: number, unreliableLifetime = 1): number {
    if (!(peer instanceof GodotWebRTCPeerConnection)) {
      throw new TypeError('WebRTCMultiplayerPeer.add_peer requires WebRTCPeerConnection.');
    }
    return this.rtcCarrier.add(peer, peerId, unreliableLifetime);
  }

  remove_peer(peerId: number): void { this.rtcCarrier.remove(peerId); }
  has_peer(peerId: number): boolean { return this.rtcCarrier.has(peerId); }
  get_peer(peerId: number): GodotWebRTCPeerConnection | null { return this.rtcCarrier.get(peerId); }

  private requireDefaultChannels(channels: unknown, member: string): void {
    if (!Array.isArray(channels)) throw new TypeError(`WebRTCMultiplayerPeer.${member} channels_config requires Array.`);
    if (channels.length > 0) {
      throw new Error(`WebRTCMultiplayerPeer.${member} custom channel configurations are not represented by the fixed native Godot channels.`);
    }
  }
}

export function createGodotWebRTCMultiplayerPeer(major: 3 | 4): GodotWebRTCMultiplayerPeer {
  return new GodotWebRTCMultiplayerPeer(major);
}
