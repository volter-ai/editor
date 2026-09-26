/** Godot PacketPeer's protocol composed onto a native transport-owned object. */

import { packedByteArray, type PackedByteArray } from './packed-array';
import { godotDecodeVariant, godotEncodeVariant } from './godot-variant-marshals';

export const PACKET_PEER_OK = 0;
export const PACKET_PEER_ERR_UNAVAILABLE = 2;

export interface GodotPacketPeer {
  get_available_packet_count(): number;
  get_packet(): PackedByteArray;
  put_packet(packet: Iterable<number>): number;
  get_packet_error(): number;
  get_max_packet_size(): number;
  put_var(value: unknown, full_objects?: boolean): number;
  get_var(allow_objects?: boolean): unknown;
  set_encode_buffer_max_size(bytes: number): void;
  get_encode_buffer_max_size(): number;
  set_allow_object_decoding(enabled: boolean): void;
  is_object_decoding_allowed(): boolean;
  encode_buffer_max_size: number;
  allow_object_decoding: boolean;
}

export interface PacketPeerTransport {
  send(packet: Uint8Array): number;
  maxPacketSize(): number;
}

/** Private queue/marshal state; the native-backed peer remains the script-visible identity. */
export class GodotPacketState implements GodotPacketPeer {
  private readonly incoming: Uint8Array[] = [];
  private packetError = PACKET_PEER_OK;
  private encodeBufferMaxSize = 8 * 1024 * 1024;
  private allowObjectDecoding = false;

  constructor(private readonly transport: PacketPeerTransport, private readonly godotMajor: 3 | 4) {}

  get encode_buffer_max_size(): number { return this.encodeBufferMaxSize; }
  set encode_buffer_max_size(value: number) {
    if (!Number.isInteger(value) || value < 1024 || value > 256 * 1024 * 1024) {
      throw new RangeError('PacketPeer.encode_buffer_max_size requires 1024..268435456 bytes.');
    }
    this.encodeBufferMaxSize = 2 ** Math.ceil(Math.log2(value));
  }
  get allow_object_decoding(): boolean { return this.allowObjectDecoding; }
  set allow_object_decoding(value: boolean) {
    if (typeof value !== 'boolean') throw new TypeError('PacketPeer.allow_object_decoding requires bool.');
    this.allowObjectDecoding = value;
  }
  get_available_packet_count(): number { return this.incoming.length; }
  get_packet(): PackedByteArray {
    const packet = this.incoming.shift();
    if (packet === undefined) {
      this.packetError = PACKET_PEER_ERR_UNAVAILABLE;
      return packedByteArray([]);
    }
    this.packetError = PACKET_PEER_OK;
    return packedByteArray(packet);
  }
  get_packet_error(): number { return this.packetError; }
  get_max_packet_size(): number { return this.transport.maxPacketSize(); }
  put_packet(packet: Iterable<number>): number { return this.transport.send(Uint8Array.from(packet)); }
  put_var(value: unknown, fullObjects = false): number {
    const encoded = godotEncodeVariant(value, fullObjects || (this.godotMajor === 3 && this.allowObjectDecoding));
    if (encoded.length > this.encodeBufferMaxSize) {
      throw new RangeError(`PacketPeer encoded Variant exceeds encode_buffer_max_size (${this.encodeBufferMaxSize}).`);
    }
    return this.put_packet(encoded);
  }
  get_var(allowObjects = false): unknown {
    const packet = this.get_packet();
    if (packet.length > this.encodeBufferMaxSize) {
      throw new RangeError(`PacketPeer encoded Variant exceeds encode_buffer_max_size (${this.encodeBufferMaxSize}).`);
    }
    const decoded = godotDecodeVariant(
      packet,
      0,
      allowObjects || (this.godotMajor === 3 && this.allowObjectDecoding),
    );
    if (decoded === null) throw new Error('PacketPeer.get_var received invalid Variant packet data.');
    return decoded.value;
  }
  set_encode_buffer_max_size(bytes: number): void { this.encode_buffer_max_size = bytes; }
  get_encode_buffer_max_size(): number { return this.encode_buffer_max_size; }
  set_allow_object_decoding(enabled: boolean): void { this.allow_object_decoding = enabled; }
  is_object_decoding_allowed(): boolean { return this.allow_object_decoding; }
  queue(packet: ArrayBuffer | ArrayBufferView | Iterable<number>): void {
    const bytes = ArrayBuffer.isView(packet)
      ? new Uint8Array(packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength))
      : packet instanceof ArrayBuffer ? new Uint8Array(packet.slice(0)) : Uint8Array.from(packet);
    this.incoming.push(bytes);
  }
  clear(): void { this.incoming.length = 0; this.packetError = PACKET_PEER_OK; }
}

export function createGodotPacketState(
  transport: PacketPeerTransport,
  godotMajor: 3 | 4,
): GodotPacketState {
  return new GodotPacketState(transport, godotMajor);
}
