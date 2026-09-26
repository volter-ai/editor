import { GodotStreamPeerExtension } from './stream-peer-extension';

export const GODOT_TLS_STATUS_DISCONNECTED = 0;
export const GODOT_TLS_STATUS_HANDSHAKING = 1;
export const GODOT_TLS_STATUS_CONNECTED = 2;
export const GODOT_TLS_STATUS_ERROR = 3;
export const GODOT_TLS_STATUS_ERROR_HOSTNAME_MISMATCH = 4;

export interface GodotTLSStream {
  get_data(bytes: number): readonly [number, Uint8Array | readonly number[]];
  get_partial_data(bytes: number): readonly [number, Uint8Array | readonly number[]];
  put_data(data: Uint8Array | readonly number[]): number;
  put_partial_data(data: Uint8Array | readonly number[]): readonly [number, number];
  get_available_bytes(): number;
}

export interface GodotTLSOptionsSeed {
  server: boolean;
  unsafeClient: boolean;
  commonNameOverride: string;
  trustedCAChain: unknown;
  privateKey: unknown;
  ownCertificate: unknown;
}

export class GodotTLSOptions {
  private constructor(private readonly values: GodotTLSOptionsSeed) {}

  static client(trustedChain: unknown = null, commonNameOverride = ''): GodotTLSOptions {
    return new GodotTLSOptions({
      server: false,
      unsafeClient: false,
      commonNameOverride,
      trustedCAChain: trustedChain,
      privateKey: null,
      ownCertificate: null,
    });
  }

  static client_unsafe(trustedChain: unknown = null): GodotTLSOptions {
    return new GodotTLSOptions({
      server: false,
      unsafeClient: true,
      commonNameOverride: '',
      trustedCAChain: trustedChain,
      privateKey: null,
      ownCertificate: null,
    });
  }

  static server(key: unknown, certificate: unknown): GodotTLSOptions {
    return new GodotTLSOptions({
      server: true,
      unsafeClient: false,
      commonNameOverride: '',
      trustedCAChain: null,
      privateKey: key,
      ownCertificate: certificate,
    });
  }

  is_server(): boolean { return this.values.server; }
  is_unsafe_client(): boolean { return this.values.unsafeClient; }
  get_common_name_override(): string { return this.values.commonNameOverride; }
  get_trusted_ca_chain(): unknown { return this.values.trustedCAChain; }
  get_private_key(): unknown { return this.values.privateKey; }
  get_own_certificate(): unknown { return this.values.ownCertificate; }
}

export interface GodotTLSHandshakeCarrier {
  beginClient?(stream: GodotTLSStream, commonName: string, options: GodotTLSOptions): unknown;
  beginServer?(stream: GodotTLSStream, options: GodotTLSOptions): unknown;
  poll?(peer: GodotStreamPeerTLS): number | void;
  disconnect?(peer: GodotStreamPeerTLS): void;
}

export class GodotStreamPeerTLS extends GodotStreamPeerExtension {
  private stream: GodotTLSStream | null = null;
  private options: GodotTLSOptions | null = null;
  private commonName = '';
  private status = GODOT_TLS_STATUS_DISCONNECTED;
  private handshakeResult: unknown = null;

  constructor(private readonly handshake: GodotTLSHandshakeCarrier = {}) {
    super({
      _get_data: (bytes) => this.read(bytes, false),
      _get_partial_data: (bytes) => this.read(bytes, true),
      _put_data: (data) => this.write(data, false),
      _put_partial_data: (data) => this.write(data, true) as readonly [number, number],
      _get_available_bytes: () => this.status === GODOT_TLS_STATUS_CONNECTED ? this.stream?.get_available_bytes() ?? 0 : 0,
    });
  }

  poll(): number {
    if (this.status !== GODOT_TLS_STATUS_HANDSHAKING) return 0;
    const status = this.handshake.poll?.(this);
    if (typeof status === 'number') this.status = status;
    else if (this.handshakeResult instanceof Promise) return 0;
    else this.status = GODOT_TLS_STATUS_CONNECTED;
    return this.status === GODOT_TLS_STATUS_ERROR || this.status === GODOT_TLS_STATUS_ERROR_HOSTNAME_MISMATCH ? 1 : 0;
  }

  accept_stream(stream: GodotTLSStream, serverOptions: GodotTLSOptions): number {
    if (!serverOptions.is_server()) return 31;
    if (this.status !== GODOT_TLS_STATUS_DISCONNECTED) return 5;
    this.stream = stream;
    this.options = serverOptions;
    this.commonName = '';
    this.status = GODOT_TLS_STATUS_HANDSHAKING;
    this.handshakeResult = this.handshake.beginServer?.(stream, serverOptions) ?? null;
    this.observeHandshake(this.handshakeResult);
    return 0;
  }

  connect_to_stream(stream: GodotTLSStream, commonName: string, clientOptions = GodotTLSOptions.client()): number {
    if (clientOptions.is_server()) return 31;
    if (this.status !== GODOT_TLS_STATUS_DISCONNECTED) return 5;
    this.stream = stream;
    this.options = clientOptions;
    this.commonName = commonName;
    this.status = GODOT_TLS_STATUS_HANDSHAKING;
    this.handshakeResult = this.handshake.beginClient?.(stream, commonName, clientOptions) ?? null;
    this.observeHandshake(this.handshakeResult);
    return 0;
  }

  get_status(): number { return this.status; }
  get_stream(): GodotTLSStream | null { return this.stream; }
  get_options(): GodotTLSOptions | null { return this.options; }
  get_common_name(): string { return this.commonName; }

  disconnect_from_stream(): void {
    this.handshake.disconnect?.(this);
    this.stream = null;
    this.options = null;
    this.commonName = '';
    this.handshakeResult = null;
    this.status = GODOT_TLS_STATUS_DISCONNECTED;
  }

  complete_handshake(): void {
    if (this.status === GODOT_TLS_STATUS_HANDSHAKING) this.status = GODOT_TLS_STATUS_CONNECTED;
  }

  fail_handshake(hostnameMismatch = false): void {
    this.status = hostnameMismatch ? GODOT_TLS_STATUS_ERROR_HOSTNAME_MISMATCH : GODOT_TLS_STATUS_ERROR;
  }

  private read(bytes: number, partial: boolean): readonly [number, Uint8Array | readonly number[]] {
    if (this.status !== GODOT_TLS_STATUS_CONNECTED || this.stream === null) return [1, new Uint8Array()];
    return partial ? this.stream.get_partial_data(bytes) : this.stream.get_data(bytes);
  }

  private write(data: Uint8Array, partial: boolean): readonly [number, number] | number {
    if (this.status !== GODOT_TLS_STATUS_CONNECTED || this.stream === null) return partial ? [1, 0] : 1;
    return partial ? this.stream.put_partial_data(data) : this.stream.put_data(data);
  }

  private observeHandshake(result: unknown): void {
    if (!(result instanceof Promise)) return;
    void result.then(
      () => this.complete_handshake(),
      (error: unknown) => {
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        this.fail_handshake(message.includes('hostname') || message.includes('common name'));
      },
    );
  }
}

export function createGodotStreamPeerTLS(handshake: GodotTLSHandshakeCarrier = {}): GodotStreamPeerTLS {
  return new GodotStreamPeerTLS(handshake);
}
