/** Godot PacketPeerStream framing over one retained StreamPeerBuffer identity. */

import { registerGodotObjectIdentity } from './object';
import {
  createGodotPacketState,
  type GodotPacketState,
  PACKET_PEER_ERR_UNAVAILABLE,
} from './packet-peer';
import { type PackedByteArray } from './packed-array';
import { GodotStreamPeerBuffer } from './stream-peer-buffer';

export class GodotPacketPeerStream {
  private stream: GodotStreamPeerBuffer | null = null;
  private inputBufferMaxSize = 65_532;
  private outputBufferMaxSize = 65_532;
  private readonly packet: GodotPacketState;

  constructor(godotMajor: 3 | 4 = 4) {
    this.packet = createGodotPacketState({
      send: (bytes) => this.writePacket(bytes),
      maxPacketSize: () => Math.min(this.inputBufferMaxSize, this.outputBufferMaxSize),
    }, godotMajor);
    registerGodotObjectIdentity(this, 'PacketPeerStream');
  }

  set_stream_peer(stream: GodotStreamPeerBuffer | null): void {
    if (stream !== null && !(stream instanceof GodotStreamPeerBuffer)) {
      throw new TypeError(
        'PacketPeerStream.stream_peer requires a StreamPeerBuffer in a browser runtime; ' +
        'native TCP/SSL stream handles have no browser-readable carrier.',
      );
    }
    this.stream = stream;
    this.packet.clear();
  }
  get_stream_peer(): GodotStreamPeerBuffer | null { return this.stream; }

  get_available_packet_count(): number {
    this.readAvailablePackets();
    return this.packet.get_available_packet_count();
  }
  get_packet(): PackedByteArray {
    this.readAvailablePackets();
    return this.packet.get_packet();
  }
  put_packet(bytes: Iterable<number>): number { return this.packet.put_packet(bytes); }
  get_packet_error(): number { return this.packet.get_packet_error(); }
  get_max_packet_size(): number { return this.packet.get_max_packet_size(); }
  put_var(value: unknown, fullObjects = false): number { return this.packet.put_var(value, fullObjects); }
  get_var(allowObjects = false): unknown {
    this.readAvailablePackets();
    return this.packet.get_var(allowObjects);
  }
  set_encode_buffer_max_size(bytes: number): void { this.packet.set_encode_buffer_max_size(bytes); }
  get_encode_buffer_max_size(): number { return this.packet.get_encode_buffer_max_size(); }
  set_allow_object_decoding(enabled: boolean): void { this.packet.set_allow_object_decoding(enabled); }
  is_object_decoding_allowed(): boolean { return this.packet.is_object_decoding_allowed(); }

  set_input_buffer_max_size(bytes: number): void {
    this.inputBufferMaxSize = this.bufferSize(bytes, 'input_buffer_max_size');
  }
  get_input_buffer_max_size(): number { return this.inputBufferMaxSize; }
  set_output_buffer_max_size(bytes: number): void {
    this.outputBufferMaxSize = this.bufferSize(bytes, 'output_buffer_max_size');
  }
  get_output_buffer_max_size(): number { return this.outputBufferMaxSize; }

  private writePacket(bytes: Uint8Array): number {
    const stream = this.stream;
    if (stream === null) return PACKET_PEER_ERR_UNAVAILABLE;
    if (bytes.byteLength > this.outputBufferMaxSize) return 46;
    stream.put_u32(bytes.byteLength);
    return stream.put_data(bytes);
  }

  private readAvailablePackets(): void {
    const stream = this.stream;
    if (stream === null) return;
    for (;;) {
      if (stream.get_available_bytes() < 4) return;
      const headerPosition = stream.get_position();
      const packetSize = stream.get_u32();
      if (packetSize > this.inputBufferMaxSize) {
        stream.seek(headerPosition);
        throw new RangeError(
          `PacketPeerStream incoming packet ${packetSize} exceeds input_buffer_max_size ${this.inputBufferMaxSize}.`,
        );
      }
      if (stream.get_available_bytes() < packetSize) {
        stream.seek(headerPosition);
        return;
      }
      const [error, bytes] = stream.get_data(packetSize);
      if (error !== 0) {
        stream.seek(headerPosition);
        return;
      }
      this.packet.queue(bytes);
    }
  }

  private bufferSize(value: number, property: string): number {
    if (!Number.isInteger(value) || value < 4 || value > 256 * 1024 * 1024) {
      throw new RangeError(`PacketPeerStream.${property} requires 4..268435456 bytes.`);
    }
    return value;
  }
}

export function createGodotPacketPeerStream(godotMajor: 3 | 4 = 4): GodotPacketPeerStream {
  return new GodotPacketPeerStream(godotMajor);
}
