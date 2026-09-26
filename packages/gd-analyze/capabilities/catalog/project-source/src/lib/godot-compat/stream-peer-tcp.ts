/** StreamPeerTCP's disconnected browser state; raw TCP sockets are not exposed on the web. */

import { registerGodotObjectIdentity } from './object';

export const STREAM_PEER_TCP_STATUS_NONE = 0;
export const STREAM_PEER_TCP_STATUS_CONNECTING = 1;
export const STREAM_PEER_TCP_STATUS_CONNECTED = 2;
export const STREAM_PEER_TCP_STATUS_ERROR = 3;

/** Shared disconnected socket state for Godot 4's abstract StreamPeerSocket base. */
export class GodotStreamPeerSocket {
  protected socketStatus = STREAM_PEER_TCP_STATUS_NONE;

  constructor(className = 'StreamPeerSocket') { registerGodotObjectIdentity(this, className); }

  disconnect_from_host(): void { this.socketStatus = STREAM_PEER_TCP_STATUS_NONE; }
  poll(): number { return 0; }
  get_status(): number { return this.socketStatus; }
}

export class GodotStreamPeerTCP extends GodotStreamPeerSocket {
  private bigEndian = false;
  private noDelay = true;

  constructor(className = 'StreamPeerTCP') { super(className); }

  bind(_port: number, _host = '*'): never { throw this.unavailable('bind'); }
  connect_to_host(_host: string, _port: number): never { throw this.unavailable('connect_to_host'); }
  get_connected_host(): string { return ''; }
  get_connected_port(): number { return 0; }
  get_local_port(): number { return 0; }
  set_no_delay(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('StreamPeerTCP.set_no_delay requires bool.');
    this.noDelay = enabled;
    void this.noDelay;
  }

  put_data(_value: Iterable<number>): never { throw this.unavailable('put_data'); }
  put_partial_data(_value: Iterable<number>): never { throw this.unavailable('put_partial_data'); }
  get_data(_bytes: number): never { throw this.unavailable('get_data'); }
  get_partial_data(_bytes: number): never { throw this.unavailable('get_partial_data'); }
  get_available_bytes(): number { return 0; }
  set_big_endian(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('StreamPeer.big_endian requires bool.');
    this.bigEndian = enabled;
  }
  is_big_endian_enabled(): boolean { return this.bigEndian; }
  put_8(_value: number): never { throw this.unavailable('put_8'); }
  put_u8(_value: number): never { throw this.unavailable('put_u8'); }
  put_16(_value: number): never { throw this.unavailable('put_16'); }
  put_u16(_value: number): never { throw this.unavailable('put_u16'); }
  put_32(_value: number): never { throw this.unavailable('put_32'); }
  put_u32(_value: number): never { throw this.unavailable('put_u32'); }
  put_64(_value: number): never { throw this.unavailable('put_64'); }
  put_u64(_value: number): never { throw this.unavailable('put_u64'); }
  put_half(_value: number): never { throw this.unavailable('put_half'); }
  put_float(_value: number): never { throw this.unavailable('put_float'); }
  put_double(_value: number): never { throw this.unavailable('put_double'); }
  put_string(_value: string): never { throw this.unavailable('put_string'); }
  put_utf8_string(_value: string): never { throw this.unavailable('put_utf8_string'); }
  put_var(_value: unknown, _fullObjects = false): never { throw this.unavailable('put_var'); }
  get_8(): never { throw this.unavailable('get_8'); }
  get_u8(): never { throw this.unavailable('get_u8'); }
  get_16(): never { throw this.unavailable('get_16'); }
  get_u16(): never { throw this.unavailable('get_u16'); }
  get_32(): never { throw this.unavailable('get_32'); }
  get_u32(): never { throw this.unavailable('get_u32'); }
  get_64(): never { throw this.unavailable('get_64'); }
  get_u64(): never { throw this.unavailable('get_u64'); }
  get_half(): never { throw this.unavailable('get_half'); }
  get_float(): never { throw this.unavailable('get_float'); }
  get_double(): never { throw this.unavailable('get_double'); }
  get_string(_bytes = -1): never { throw this.unavailable('get_string'); }
  get_utf8_string(_bytes = -1): never { throw this.unavailable('get_utf8_string'); }
  get_var(_allowObjects = false): never { throw this.unavailable('get_var'); }

  private unavailable(member: string): Error {
    return new Error(`StreamPeerTCP.${member} requires a raw TCP socket; browsers expose no exact TCP carrier.`);
  }
}

export const STREAM_PEER_TLS_STATUS_DISCONNECTED = 0;
export const STREAM_PEER_TLS_STATUS_HANDSHAKING = 1;
export const STREAM_PEER_TLS_STATUS_CONNECTED = 2;
export const STREAM_PEER_TLS_STATUS_ERROR = 3;
export const STREAM_PEER_TLS_STATUS_ERROR_HOSTNAME_MISMATCH = 4;

export class GodotStreamPeerTLS extends GodotStreamPeerTCP {
  constructor() { super('StreamPeerTLS'); }
  accept_stream(..._arguments: readonly unknown[]): never {
    throw new Error('StreamPeerTLS.accept_stream requires a server-owned raw TLS stream unavailable in browsers.');
  }
  connect_to_stream(..._arguments: readonly unknown[]): never {
    throw new Error(
      'StreamPeerTLS.connect_to_stream requires a raw TLS socket; browser TLS is owned by fetch/WebSocket and exposes no StreamPeer.',
    );
  }
  override poll(): number { return 0; }
  override get_status(): number { return STREAM_PEER_TLS_STATUS_DISCONNECTED; }
  get_stream(): null { return null; }
  disconnect_from_stream(): void {}
}

export function createGodotStreamPeerTCP(): GodotStreamPeerTCP { return new GodotStreamPeerTCP(); }
export function createGodotStreamPeerTLS(): GodotStreamPeerTLS { return new GodotStreamPeerTLS(); }
