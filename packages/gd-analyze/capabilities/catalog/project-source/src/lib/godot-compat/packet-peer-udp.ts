/** PacketPeerUDP's disconnected state; browser runtimes expose no UDP socket carrier. */

import { registerGodotObjectIdentity } from './object';
import { createGodotPacketState, type GodotPacketState, PACKET_PEER_ERR_UNAVAILABLE } from './packet-peer';
import type { PackedByteArray } from './packed-array';

export class GodotPacketPeerUDP {
  private readonly packet: GodotPacketState;
  private destinationHost = '';
  private destinationPort = 0;
  private broadcast = false;

  constructor(godotMajor: 3 | 4 = 4) {
    this.packet = createGodotPacketState({
      send: () => this.sendUnavailable(),
      maxPacketSize: () => 65_507,
    }, godotMajor);
    registerGodotObjectIdentity(this, 'PacketPeerUDP');
  }

  bind(_port: number, _bindAddress = '*', _receiveBufferSize = 65_536): never {
    throw this.udpUnavailable('bind');
  }
  connect_to_host(_host: string, _port: number): never { throw this.udpUnavailable('connect_to_host'); }
  wait(): never { throw this.udpUnavailable('wait'); }
  join_multicast_group(_address: string, _interfaceName: string): never {
    throw this.udpUnavailable('join_multicast_group');
  }
  leave_multicast_group(_address: string, _interfaceName: string): never {
    throw this.udpUnavailable('leave_multicast_group');
  }
  close(): void { this.packet.clear(); }
  is_bound(): boolean { return false; }
  is_socket_connected(): boolean { return false; }
  get_packet_ip(): string { return ''; }
  get_packet_port(): number { return 0; }
  get_local_port(): number { return 0; }

  set_dest_address(host: string, port: number): void {
    if (typeof host !== 'string' || host.length === 0) throw new TypeError('PacketPeerUDP destination host requires String.');
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new RangeError('PacketPeerUDP destination port requires 1..65535.');
    this.destinationHost = host;
    this.destinationPort = port;
  }
  set_broadcast_enabled(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('PacketPeerUDP broadcast requires bool.');
    this.broadcast = enabled;
  }

  get_available_packet_count(): number { return this.packet.get_available_packet_count(); }
  get_packet(): PackedByteArray { return this.packet.get_packet(); }
  put_packet(bytes: Iterable<number>): number {
    if (this.destinationHost === '' || this.destinationPort === 0) return PACKET_PEER_ERR_UNAVAILABLE;
    return this.packet.put_packet(bytes);
  }
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

  private udpUnavailable(member: string): Error {
    return new Error(`PacketPeerUDP.${member} requires a UDP socket; browsers expose no exact UDP carrier.`);
  }
  private sendUnavailable(): never {
    void this.broadcast;
    throw this.udpUnavailable('put_packet');
  }
}

export function createGodotPacketPeerUDP(godotMajor: 3 | 4 = 4): GodotPacketPeerUDP {
  return new GodotPacketPeerUDP(godotMajor);
}
