/** Godot HTTPClient state and response streaming over the browser's native fetch. */

import { registerGodotObjectIdentity } from './object';
import { packedByteArray, packedStringArray, type PackedByteArray, type PackedStringArray } from './packed-array';
import { godotDictionary } from './variant';

/** Stable Godot enum namespace identities. Generated games retain these objects when an enum is
 * assigned, passed, or returned instead of reconstructing translator-owned literal tables. */
export const GodotHTTPClientMethod = Object.freeze({
  METHOD_GET: 0,
  METHOD_HEAD: 1,
  METHOD_POST: 2,
  METHOD_PUT: 3,
  METHOD_DELETE: 4,
  METHOD_OPTIONS: 5,
  METHOD_TRACE: 6,
  METHOD_CONNECT: 7,
  METHOD_PATCH: 8,
  METHOD_MAX: 9,
} as const);

export const GodotHTTPClientStatus4 = Object.freeze({
  STATUS_DISCONNECTED: 0,
  STATUS_RESOLVING: 1,
  STATUS_CANT_RESOLVE: 2,
  STATUS_CONNECTING: 3,
  STATUS_CANT_CONNECT: 4,
  STATUS_CONNECTED: 5,
  STATUS_REQUESTING: 6,
  STATUS_BODY: 7,
  STATUS_CONNECTION_ERROR: 8,
  STATUS_TLS_HANDSHAKE_ERROR: 9,
} as const);

export const GodotHTTPClientStatus3 = Object.freeze({
  STATUS_DISCONNECTED: 0,
  STATUS_RESOLVING: 1,
  STATUS_CANT_RESOLVE: 2,
  STATUS_CONNECTING: 3,
  STATUS_CANT_CONNECT: 4,
  STATUS_CONNECTED: 5,
  STATUS_REQUESTING: 6,
  STATUS_BODY: 7,
  STATUS_CONNECTION_ERROR: 8,
  STATUS_SSL_HANDSHAKE_ERROR: 9,
} as const);

export const GodotHTTPClientResponseCode = Object.freeze({
  RESPONSE_CONTINUE: 100,
  RESPONSE_SWITCHING_PROTOCOLS: 101,
  RESPONSE_PROCESSING: 102,
  RESPONSE_OK: 200,
  RESPONSE_CREATED: 201,
  RESPONSE_ACCEPTED: 202,
  RESPONSE_NON_AUTHORITATIVE_INFORMATION: 203,
  RESPONSE_NO_CONTENT: 204,
  RESPONSE_RESET_CONTENT: 205,
  RESPONSE_PARTIAL_CONTENT: 206,
  RESPONSE_MULTI_STATUS: 207,
  RESPONSE_ALREADY_REPORTED: 208,
  RESPONSE_IM_USED: 226,
  RESPONSE_MULTIPLE_CHOICES: 300,
  RESPONSE_MOVED_PERMANENTLY: 301,
  RESPONSE_FOUND: 302,
  RESPONSE_SEE_OTHER: 303,
  RESPONSE_NOT_MODIFIED: 304,
  RESPONSE_USE_PROXY: 305,
  RESPONSE_SWITCH_PROXY: 306,
  RESPONSE_TEMPORARY_REDIRECT: 307,
  RESPONSE_PERMANENT_REDIRECT: 308,
  RESPONSE_BAD_REQUEST: 400,
  RESPONSE_UNAUTHORIZED: 401,
  RESPONSE_PAYMENT_REQUIRED: 402,
  RESPONSE_FORBIDDEN: 403,
  RESPONSE_NOT_FOUND: 404,
  RESPONSE_METHOD_NOT_ALLOWED: 405,
  RESPONSE_NOT_ACCEPTABLE: 406,
  RESPONSE_PROXY_AUTHENTICATION_REQUIRED: 407,
  RESPONSE_REQUEST_TIMEOUT: 408,
  RESPONSE_CONFLICT: 409,
  RESPONSE_GONE: 410,
  RESPONSE_LENGTH_REQUIRED: 411,
  RESPONSE_PRECONDITION_FAILED: 412,
  RESPONSE_REQUEST_ENTITY_TOO_LARGE: 413,
  RESPONSE_REQUEST_URI_TOO_LONG: 414,
  RESPONSE_UNSUPPORTED_MEDIA_TYPE: 415,
  RESPONSE_REQUESTED_RANGE_NOT_SATISFIABLE: 416,
  RESPONSE_EXPECTATION_FAILED: 417,
  RESPONSE_IM_A_TEAPOT: 418,
  RESPONSE_MISDIRECTED_REQUEST: 421,
  RESPONSE_UNPROCESSABLE_ENTITY: 422,
  RESPONSE_LOCKED: 423,
  RESPONSE_FAILED_DEPENDENCY: 424,
  RESPONSE_UPGRADE_REQUIRED: 426,
  RESPONSE_PRECONDITION_REQUIRED: 428,
  RESPONSE_TOO_MANY_REQUESTS: 429,
  RESPONSE_REQUEST_HEADER_FIELDS_TOO_LARGE: 431,
  RESPONSE_UNAVAILABLE_FOR_LEGAL_REASONS: 451,
  RESPONSE_INTERNAL_SERVER_ERROR: 500,
  RESPONSE_NOT_IMPLEMENTED: 501,
  RESPONSE_BAD_GATEWAY: 502,
  RESPONSE_SERVICE_UNAVAILABLE: 503,
  RESPONSE_GATEWAY_TIMEOUT: 504,
  RESPONSE_HTTP_VERSION_NOT_SUPPORTED: 505,
  RESPONSE_VARIANT_ALSO_NEGOTIATES: 506,
  RESPONSE_INSUFFICIENT_STORAGE: 507,
  RESPONSE_LOOP_DETECTED: 508,
  RESPONSE_NOT_EXTENDED: 510,
  RESPONSE_NETWORK_AUTH_REQUIRED: 511,
} as const);

export const HTTP_METHOD_GET = GodotHTTPClientMethod.METHOD_GET;
export const HTTP_METHOD_HEAD = GodotHTTPClientMethod.METHOD_HEAD;
export const HTTP_METHOD_POST = GodotHTTPClientMethod.METHOD_POST;
export const HTTP_METHOD_PUT = GodotHTTPClientMethod.METHOD_PUT;
export const HTTP_METHOD_DELETE = GodotHTTPClientMethod.METHOD_DELETE;
export const HTTP_METHOD_OPTIONS = GodotHTTPClientMethod.METHOD_OPTIONS;
export const HTTP_METHOD_TRACE = GodotHTTPClientMethod.METHOD_TRACE;
export const HTTP_METHOD_CONNECT = GodotHTTPClientMethod.METHOD_CONNECT;
export const HTTP_METHOD_PATCH = GodotHTTPClientMethod.METHOD_PATCH;

export const HTTP_STATUS_DISCONNECTED = GodotHTTPClientStatus4.STATUS_DISCONNECTED;
export const HTTP_STATUS_RESOLVING = GodotHTTPClientStatus4.STATUS_RESOLVING;
export const HTTP_STATUS_CANT_RESOLVE = GodotHTTPClientStatus4.STATUS_CANT_RESOLVE;
export const HTTP_STATUS_CONNECTING = GodotHTTPClientStatus4.STATUS_CONNECTING;
export const HTTP_STATUS_CANT_CONNECT = GodotHTTPClientStatus4.STATUS_CANT_CONNECT;
export const HTTP_STATUS_CONNECTED = GodotHTTPClientStatus4.STATUS_CONNECTED;
export const HTTP_STATUS_REQUESTING = GodotHTTPClientStatus4.STATUS_REQUESTING;
export const HTTP_STATUS_BODY = GodotHTTPClientStatus4.STATUS_BODY;
export const HTTP_STATUS_CONNECTION_ERROR = GodotHTTPClientStatus4.STATUS_CONNECTION_ERROR;
export const HTTP_STATUS_TLS_HANDSHAKE_ERROR = GodotHTTPClientStatus4.STATUS_TLS_HANDSHAKE_ERROR;

const METHOD_NAMES = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT', 'PATCH'] as const;
type GodotHTTPClientStatus = (typeof GodotHTTPClientStatus4)[keyof typeof GodotHTTPClientStatus4];
const OK = 0;
const ERR_BUSY = 44;
const ERR_INVALID_PARAMETER = 31;

function headerPairs(lines: readonly string[]): Headers {
  const headers = new Headers();
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator <= 0) throw new Error(`HTTPClient header must contain a name and colon: ${line}`);
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (name === '') throw new Error('HTTPClient header name cannot be empty.');
    refuseBrowserOwnedHeader(name, 'HTTPClient');
    headers.set(name, value);
  }
  return headers;
}

export function refuseBrowserOwnedHeader(name: string, owner: string): void {
  const lower = name.toLowerCase();
  if (
    ['accept-charset', 'accept-encoding', 'access-control-request-headers',
      'access-control-request-method', 'connection', 'content-length', 'cookie', 'cookie2',
      'date', 'dnt', 'expect', 'host', 'keep-alive', 'origin', 'referer', 'te', 'trailer',
      'transfer-encoding', 'upgrade', 'via'].includes(lower) ||
    lower.startsWith('proxy-') || lower.startsWith('sec-')
  ) {
    throw new Error(`${owner} cannot set browser-owned HTTP header ${name}.`);
  }
}

function portFor(scheme: string, port: number): number {
  if (port >= 0) return port;
  return scheme === 'https:' ? 443 : 80;
}

export class GodotHTTPClient {
  private baseUrl: URL | null = null;
  private status: GodotHTTPClientStatus = HTTP_STATUS_DISCONNECTED;
  private responseCode = 0;
  private responseHeaders: string[] = [];
  private responseBodyLength = -1;
  private responseChunked = false;
  private responseChunks: Uint8Array[] = [];
  private responseComplete = true;
  private readChunkSize = 65_536;
  private abort: AbortController | null = null;
  private blocking = false;
  private readonly pendingEvents: Array<() => void> = [];

  constructor() {
    registerGodotObjectIdentity(this, 'HTTPClient');
  }

  connect_to_host(host: string, port = -1, tlsOrUseSsl: unknown = null, verifyHost = true): number {
    if (this.status !== HTTP_STATUS_DISCONNECTED) return ERR_BUSY;
    const legacyUseSsl = typeof tlsOrUseSsl === 'boolean' ? tlsOrUseSsl : false;
    if (typeof tlsOrUseSsl !== 'boolean' && tlsOrUseSsl !== null && tlsOrUseSsl !== undefined) {
      throw new Error('HTTPClient.connect_to_host custom TLSOptions cannot be represented by browser fetch.');
    }
    if (!verifyHost) throw new Error('HTTPClient verify_host=false cannot be represented by browser fetch.');
    try {
      const withScheme = /^[a-z][a-z\d+.-]*:/i.test(host) ? host : `${legacyUseSsl ? 'https' : 'http'}://${host}`;
      const parsed = new URL(withScheme);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ERR_INVALID_PARAMETER;
      const resolvedPort = portFor(parsed.protocol, port);
      parsed.port = (parsed.protocol === 'https:' && resolvedPort === 443) ||
        (parsed.protocol === 'http:' && resolvedPort === 80) ? '' : String(resolvedPort);
      parsed.pathname = '/'; parsed.search = ''; parsed.hash = '';
      this.baseUrl = parsed;
      this.status = HTTP_STATUS_RESOLVING;
      return OK;
    } catch {
      this.status = HTTP_STATUS_CANT_RESOLVE;
      return ERR_INVALID_PARAMETER;
    }
  }

  connect_to_host_tls(host: string, port = -1, verifyHost = true, trustedChain: unknown = null): number {
    if (!verifyHost || trustedChain !== null) {
      throw new Error('HTTPClient.connect_to_host custom TLS verification cannot be represented by browser fetch.');
    }
    return this.connect_to_host(`https://${host}`, port, null);
  }

  request(method: number, url: string, headers: readonly string[] = [], body = ''): number {
    return this.beginRequest(method, url, headers, body);
  }

  request_raw(method: number, url: string, headers: readonly string[] = [], body: Iterable<number> = []): number {
    return this.beginRequest(method, url, headers, Uint8Array.from(body));
  }

  private beginRequest(method: number, path: string, headers: readonly string[], body: BodyInit | null): number {
    if (this.baseUrl === null || this.status !== HTTP_STATUS_CONNECTED) return ERR_BUSY;
    if (!Number.isInteger(method) || method < HTTP_METHOD_GET || method > HTTP_METHOD_PATCH) return ERR_INVALID_PARAMETER;
    if (method === HTTP_METHOD_TRACE || method === HTTP_METHOD_CONNECT) {
      throw new Error(`HTTPClient ${METHOD_NAMES[method]} is forbidden by the browser Fetch standard.`);
    }
    let target: URL;
    try { target = new URL(path, this.baseUrl); } catch { return ERR_INVALID_PARAMETER; }
    if (target.origin !== this.baseUrl.origin) {
      throw new Error('HTTPClient request URL must remain on the host passed to connect_to_host.');
    }
    if (typeof location !== 'undefined' && target.origin !== location.origin) {
      throw new Error('HTTPClient cross-origin fetch cannot expose Godot\'s complete raw response headers in a browser.');
    }
    this.resetResponse();
    this.status = HTTP_STATUS_REQUESTING;
    this.abort = new AbortController();
    const methodName = METHOD_NAMES[method];
    if (methodName === undefined) return ERR_INVALID_PARAMETER;
    void fetch(target, {
      method: methodName,
      headers: headerPairs(headers),
      body: method === HTTP_METHOD_GET || method === HTTP_METHOD_HEAD ? null : body,
      redirect: 'manual',
      signal: this.abort.signal,
    }).then(async (response) => {
      if (this.abort === null) return;
      const responseHeaders: string[] = [];
      response.headers.forEach((value, name) => responseHeaders.push(`${name}: ${value}`));
      const length = response.headers.get('content-length');
      const responseLength = length === null ? -1 : Number.parseInt(length, 10);
      const chunked = /\bchunked\b/i.test(response.headers.get('transfer-encoding') ?? '');
      const reader = response.body?.getReader();
      this.pendingEvents.push(() => {
        if (this.abort === null) return;
        this.responseCode = response.status;
        this.responseHeaders = responseHeaders;
        this.responseBodyLength = responseLength;
        this.responseChunked = chunked;
        this.responseComplete = reader === undefined;
        this.status = reader === undefined ? HTTP_STATUS_CONNECTED : HTTP_STATUS_BODY;
      });
      if (reader === undefined) {
        this.pendingEvents.push(() => { this.abort = null; });
        return;
      }
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        if (next.value.byteLength > 0) {
          const chunk = next.value.slice();
          this.pendingEvents.push(() => {
            if (this.abort === null) return;
            this.responseChunks.push(chunk);
            this.status = HTTP_STATUS_BODY;
          });
        }
      }
      this.pendingEvents.push(() => {
        this.abort = null;
        this.responseComplete = true;
        this.status = this.responseChunks.length === 0 ? HTTP_STATUS_CONNECTED : HTTP_STATUS_BODY;
      });
    }).catch((error: unknown) => {
      if (this.abort === null) return;
      this.pendingEvents.push(() => {
        this.abort = null;
        this.status = error instanceof DOMException && error.name === 'AbortError'
          ? HTTP_STATUS_DISCONNECTED : HTTP_STATUS_CONNECTION_ERROR;
      });
    });
    return OK;
  }

  poll(): number {
    const events = this.pendingEvents.splice(0);
    for (const event of events) event();
    if (this.status === HTTP_STATUS_RESOLVING) {
      this.status = HTTP_STATUS_CONNECTING;
      return OK;
    }
    if (this.status === HTTP_STATUS_CONNECTING) {
      this.status = HTTP_STATUS_CONNECTED;
      return OK;
    }
    return this.status === HTTP_STATUS_CONNECTION_ERROR || this.status === HTTP_STATUS_CANT_CONNECT ? 36 : OK;
  }

  close(): void {
    this.abort?.abort();
    this.abort = null;
    this.baseUrl = null;
    this.status = HTTP_STATUS_DISCONNECTED;
    this.resetResponse();
    this.pendingEvents.length = 0;
  }

  get_status(): number { return this.status; }
  has_response(): boolean { return this.responseCode !== 0; }
  is_response_chunked(): boolean { return this.responseChunked; }
  get_response_code(): number { return this.responseCode; }
  get_response_headers(): PackedStringArray { return packedStringArray(this.responseHeaders); }
  get_response_headers_as_dictionary(): ReadonlyMap<string, string> {
    const result = godotDictionary();
    for (const header of this.responseHeaders) {
      const separator = header.indexOf(':');
      const name = header.slice(0, separator).trim().toLowerCase();
      const value = header.slice(separator + 1).trim();
      const prior = result.get(name);
      result.set(name, prior === undefined ? value : `${prior}, ${value}`);
    }
    return result;
  }
  get_response_body_length(): number { return this.responseBodyLength; }
  read_response_body_chunk(): PackedByteArray {
    const first = this.responseChunks[0];
    if (first === undefined) return packedByteArray([]);
    if (first.byteLength <= this.readChunkSize) {
      this.responseChunks.shift();
      if (this.responseChunks.length === 0 && this.responseComplete) this.status = HTTP_STATUS_CONNECTED;
      return packedByteArray(first);
    }
    const chunk = first.slice(0, this.readChunkSize);
    this.responseChunks[0] = first.slice(this.readChunkSize);
    return packedByteArray(chunk);
  }
  set_read_chunk_size(bytes: number): void {
    if (!Number.isInteger(bytes) || bytes < 256) throw new RangeError('HTTPClient.read_chunk_size must be at least 256.');
    this.readChunkSize = bytes;
  }
  get_read_chunk_size(): number { return this.readChunkSize; }
  set_blocking_mode(enabled: boolean): void {
    if (enabled) throw new Error('HTTPClient blocking mode is unavailable in a browser runtime.');
    this.blocking = false;
  }
  is_blocking_mode_enabled(): boolean { return this.blocking; }
  set_connection(_connection: unknown): never {
    throw new Error('HTTPClient.connection replacement is unavailable with browser-native fetch.');
  }
  get_connection(): never {
    throw new Error('HTTPClient.get_connection cannot expose browser fetch\'s private transport stream.');
  }
  set_http_proxy(host: string, port: number): void {
    if (host !== '' || port !== -1) throw new Error('HTTPClient HTTP proxy cannot be configured through browser fetch.');
  }
  set_https_proxy(host: string, port: number): void {
    if (host !== '' || port !== -1) throw new Error('HTTPClient HTTPS proxy cannot be configured through browser fetch.');
  }
  set_tls_options(options: unknown): void {
    if (options !== null && options !== undefined) {
      throw new Error('HTTPClient custom TLSOptions cannot be configured through browser fetch.');
    }
  }

  private resetResponse(): void {
    this.responseCode = 0;
    this.responseHeaders = [];
    this.responseBodyLength = -1;
    this.responseChunked = false;
    this.responseChunks = [];
    this.responseComplete = false;
  }
}

export function createGodotHTTPClient(): GodotHTTPClient { return new GodotHTTPClient(); }

export function godotHttpQueryStringFromDict(fields: Readonly<Record<string, unknown>> | ReadonlyMap<unknown, unknown>): string {
  const entries = fields instanceof Map ? [...fields.entries()] : Object.entries(fields);
  const pairs: string[] = [];
  for (const [key, value] of entries) {
    const encodedKey = encodeURIComponent(String(key));
    if (Array.isArray(value)) {
      for (const item of value) pairs.push(`${encodedKey}=${encodeURIComponent(String(item))}`);
    } else {
      pairs.push(`${encodedKey}=${encodeURIComponent(String(value))}`);
    }
  }
  return pairs.join('&');
}
