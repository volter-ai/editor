/** Godot PacketPeerExtension protocol for script-defined packet transports. */

import { godotDecodeVariant, godotEncodeVariant } from './godot-variant-marshals';
import { registerGodotObjectIdentity } from './object';
import { packedByteArray, type PackedByteArray } from './packed-array';

export interface GodotPacketPeerExtensionHooks {
  _get_packet(): readonly [error: number, packet: Uint8Array | readonly number[]];
  _put_packet(packet: Uint8Array): number;
  _get_available_packet_count(): number;
  _get_max_packet_size(): number;
}

export class GodotPacketPeerExtension {
  private packetError = 0;
  private encodeBufferMaxSize = 8 * 1024 * 1024;

  constructor(private readonly hooks: GodotPacketPeerExtensionHooks) {
    registerGodotObjectIdentity(this, 'PacketPeerExtension');
  }

  _get_packet(): readonly [number, PackedByteArray] {
    const [error, packet] = this.hooks._get_packet();
    return [error, packedByteArray(packet)];
  }

  _put_packet(packet: Uint8Array | readonly number[]): number {
    return this.hooks._put_packet(Uint8Array.from(packet));
  }

  _get_available_packet_count(): number {
    return Math.max(0, Math.trunc(this.hooks._get_available_packet_count()));
  }

  _get_max_packet_size(): number {
    return Math.max(0, Math.trunc(this.hooks._get_max_packet_size()));
  }

  get_packet(): PackedByteArray {
    const [error, packet] = this._get_packet();
    this.packetError = error;
    return packet;
  }

  put_packet(packet: Uint8Array | readonly number[]): number {
    this.packetError = this._put_packet(packet);
    return this.packetError;
  }

  get_packet_error(): number { return this.packetError; }
  get_available_packet_count(): number { return this._get_available_packet_count(); }
  get_max_packet_size(): number { return this._get_max_packet_size(); }

  get_encode_buffer_max_size(): number { return this.encodeBufferMaxSize; }

  set_encode_buffer_max_size(maxSize: number): void {
    if (!Number.isSafeInteger(maxSize) || maxSize < 1024 || maxSize > 256 * 1024 * 1024) {
      throw new RangeError('PacketPeerExtension encode buffer requires 1024..268435456 bytes.');
    }
    this.encodeBufferMaxSize = maxSize;
  }

  put_var(value: unknown, fullObjects = false): number {
    const packet = godotEncodeVariant(value, fullObjects);
    if (packet.length > this.encodeBufferMaxSize) {
      throw new RangeError(`PacketPeerExtension Variant exceeds ${this.encodeBufferMaxSize} bytes.`);
    }
    return this.put_packet(packet);
  }

  get_var(allowObjects = false): unknown {
    const packet = this.get_packet();
    if (this.packetError !== 0) return null;
    if (packet.length > this.encodeBufferMaxSize) {
      throw new RangeError(`PacketPeerExtension Variant exceeds ${this.encodeBufferMaxSize} bytes.`);
    }
    return godotDecodeVariant(packet, 0, allowObjects)?.value ?? null;
  }
}

export function createGodotPacketPeerExtension(
  hooks: GodotPacketPeerExtensionHooks,
): GodotPacketPeerExtension {
  return new GodotPacketPeerExtension(hooks);
}
