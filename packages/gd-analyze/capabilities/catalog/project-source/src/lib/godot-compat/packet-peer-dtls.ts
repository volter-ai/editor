/** PacketPeerDTLS disconnected state; browser WebRTC DTLS is not a generic datagram carrier. */

import { registerGodotObjectIdentity } from './object';
import { createGodotPacketState, type GodotPacketState, PACKET_PEER_ERR_UNAVAILABLE } from './packet-peer';
import type { PackedByteArray } from './packed-array';

export const PACKET_PEER_DTLS_STATUS_DISCONNECTED = 0;
export const PACKET_PEER_DTLS_STATUS_HANDSHAKING = 1;
export const PACKET_PEER_DTLS_STATUS_CONNECTED = 2;
export const PACKET_PEER_DTLS_STATUS_ERROR = 3;
export const PACKET_PEER_DTLS_STATUS_ERROR_HOSTNAME_MISMATCH = 4;

export class GodotPacketPeerDTLS {
  private readonly packet: GodotPacketState;
  constructor(godotMajor: 3 | 4 = 4) {
    this.packet = createGodotPacketState({
      send: () => PACKET_PEER_ERR_UNAVAILABLE,
      maxPacketSize: () => 65_507,
    }, godotMajor);
    registerGodotObjectIdentity(this, 'PacketPeerDTLS');
  }
  connect_to_peer(..._arguments: readonly unknown[]): never {
    throw new Error(
      'PacketPeerDTLS.connect_to_peer requires a generic DTLS datagram socket; ' +
      'browser WebRTC owns its private DTLS transport and cannot expose it as PacketPeer.',
    );
  }
  poll(): number { return 0; }
  get_status(): number { return PACKET_PEER_DTLS_STATUS_DISCONNECTED; }
  disconnect_from_peer(): void { this.packet.clear(); }
  get_available_packet_count(): number { return this.packet.get_available_packet_count(); }
  get_packet(): PackedByteArray { return this.packet.get_packet(); }
  put_packet(bytes: Iterable<number>): number { return this.packet.put_packet(bytes); }
  get_packet_error(): number { return this.packet.get_packet_error(); }
  get_max_packet_size(): number { return this.packet.get_max_packet_size(); }
  get_var(allowObjects = false): unknown { return this.packet.get_var(allowObjects); }
  put_var(value: unknown, fullObjects = false): number { return this.packet.put_var(value, fullObjects); }
  set_encode_buffer_max_size(bytes: number): void { this.packet.set_encode_buffer_max_size(bytes); }
  get_encode_buffer_max_size(): number { return this.packet.get_encode_buffer_max_size(); }
  set_allow_object_decoding(enabled: boolean): void { this.packet.set_allow_object_decoding(enabled); }
  is_object_decoding_allowed(): boolean { return this.packet.is_object_decoding_allowed(); }
  get encode_buffer_max_size(): number { return this.packet.encode_buffer_max_size; }
  set encode_buffer_max_size(bytes: number) { this.packet.encode_buffer_max_size = bytes; }
  get allow_object_decoding(): boolean { return this.packet.allow_object_decoding; }
  set allow_object_decoding(enabled: boolean) { this.packet.allow_object_decoding = enabled; }
}

export function createGodotPacketPeerDTLS(godotMajor: 3 | 4 = 4): GodotPacketPeerDTLS {
  return new GodotPacketPeerDTLS(godotMajor);
}
