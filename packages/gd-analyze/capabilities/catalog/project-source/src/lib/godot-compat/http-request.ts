/** Godot HTTPRequest retained request state over one native Fetch request. */

import { HTTP_STATUS_DISCONNECTED, HTTP_STATUS_REQUESTING, refuseBrowserOwnedHeader } from './http-client';
import { registerGodotObjectIdentity } from './object';
import { packedByteArray, packedStringArray, type PackedByteArray, type PackedStringArray } from './packed-array';
import { createSignal, type GodotSignal } from './signal';
import { assertGodotBrowserClientTlsOptions, type GodotTLSOptions } from './crypto';

export const HTTP_REQUEST_RESULT_SUCCESS = 0;
export const HTTP_REQUEST_RESULT_CHUNKED_BODY_SIZE_MISMATCH = 1;
export const HTTP_REQUEST_RESULT_CANT_CONNECT = 2;
export const HTTP_REQUEST_RESULT_CANT_RESOLVE = 3;
export const HTTP_REQUEST_RESULT_CONNECTION_ERROR = 4;
export const HTTP_REQUEST_RESULT_TLS_HANDSHAKE_ERROR = 5;
export const HTTP_REQUEST_RESULT_NO_RESPONSE = 6;
export const HTTP_REQUEST_RESULT_BODY_SIZE_LIMIT_EXCEEDED = 7;
export const HTTP_REQUEST_RESULT_BODY_DECOMPRESS_FAILED = 8;
export const HTTP_REQUEST_RESULT_REQUEST_FAILED = 9;
export const HTTP_REQUEST_RESULT_DOWNLOAD_FILE_CANT_OPEN = 10;
export const HTTP_REQUEST_RESULT_DOWNLOAD_FILE_WRITE_ERROR = 11;
export const HTTP_REQUEST_RESULT_REDIRECT_LIMIT_REACHED = 12;
export const HTTP_REQUEST_RESULT_TIMEOUT = 13;

const METHOD_NAMES = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT', 'PATCH'] as const;
const OK = 0;
const ERR_BUSY = 44;
const ERR_INVALID_PARAMETER = 31;

function toHeaders(lines: readonly string[]): Headers {
  const result = new Headers();
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator <= 0) throw new Error(`HTTPRequest custom header requires "name: value": ${line}`);
    const name = line.slice(0, separator).trim();
    refuseBrowserOwnedHeader(name, 'HTTPRequest');
    result.set(name, line.slice(separator + 1).trim());
  }
  return result;
}

export interface GodotHTTPRequest {
  name: string;
  readonly parent: object | null;
  readonly tree: HTTPRequestTree | null;
  readonly isInsideTree: boolean;
  readonly siblingIndex: number | undefined;
  readonly request_completed: GodotSignal<readonly [number, number, PackedStringArray, PackedByteArray]>;
  request(url: string, customHeaders?: readonly string[], method?: number, requestData?: string): number;
  request_raw(url: string, customHeaders?: readonly string[], method?: number, requestDataRaw?: Iterable<number>): number;
  cancel_request(): void;
  get_http_client_status(): number;
  get_body_size(): number;
  get_downloaded_bytes(): number;
  set_tls_options(options: unknown): void;
  set_timeout(seconds: number): void;
  get_timeout(): number;
}

export class GodotHTTPRequestNode implements GodotHTTPRequest {
  name: string;
  readonly siblingIndex: number | undefined;
  private attachedParent: object | null = null;
  private attachedTree: HTTPRequestTree | null = null;
  private releaseTree: (() => void) | null = null;
  private readonly completed = createSignal<readonly [number, number, PackedStringArray, PackedByteArray]>();
  readonly request_completed = this.completed.signal;
  private controller: AbortController | null = null;
  private timeoutSeconds = 0;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private status: number = HTTP_STATUS_DISCONNECTED;
  private downloadFile = '';
  private downloadChunkSize = 65_536;
  private bodySizeLimit = -1;
  private bodySize = -1;
  private downloadedBytes = 0;
  private maxRedirects = 8;
  private acceptGzip = true;
  private useThreads = false;
  private tlsOptions: GodotTLSOptions | null = null;

  constructor(options: CreateHTTPRequestOptions = {}) {
    this.name = options.name ?? '';
    this.siblingIndex = options.siblingIndex;
    registerGodotObjectIdentity(this, 'HTTPRequest');
  }
  get parent(): object | null { return this.attachedParent; }
  get tree(): HTTPRequestTree | null { return this.attachedTree; }
  get isInsideTree(): boolean { return this.attachedTree !== null; }

  request(url: string, customHeaders: readonly string[] = [], method = 0, requestData = ''): number {
    return this.start(url, customHeaders, method, requestData);
  }

  request_raw(url: string, customHeaders: readonly string[] = [], method = 0, requestDataRaw: Iterable<number> = []): number {
    return this.start(url, customHeaders, method, Uint8Array.from(requestDataRaw));
  }

  private start(url: string, customHeaders: readonly string[], method: number, body: BodyInit): number {
    assertGodotBrowserClientTlsOptions(this.tlsOptions, 'HTTPRequest.request');
    if (!this.isInsideTree) return 3;
    if (this.controller !== null) return ERR_BUSY;
    if (!Number.isInteger(method) || method < 0 || method >= METHOD_NAMES.length) return ERR_INVALID_PARAMETER;
    const methodName = METHOD_NAMES[method];
    if (methodName === undefined) return ERR_INVALID_PARAMETER;
    if (method === 6 || method === 7) {
      throw new Error(`HTTPRequest ${methodName} is forbidden by the browser Fetch standard.`);
    }
    let target: URL;
    try { target = new URL(url, globalThis.location?.href); } catch { return ERR_INVALID_PARAMETER; }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return ERR_INVALID_PARAMETER;
    if (typeof location !== 'undefined' && target.origin !== location.origin) {
      throw new Error('HTTPRequest cross-origin fetch cannot expose Godot\'s complete raw response headers in a browser.');
    }
    if (this.downloadFile !== '') {
      throw new Error('HTTPRequest.download_file cannot write native filesystem paths in a browser runtime.');
    }
    if (!this.acceptGzip) {
      throw new Error('HTTPRequest.accept_gzip=false cannot disable browser-managed response decompression.');
    }
    const controller = new AbortController();
    this.controller = controller;
    this.status = HTTP_STATUS_REQUESTING;
    this.bodySize = -1;
    this.downloadedBytes = 0;
    let timedOut = false;
    if (this.timeoutSeconds > 0) {
      this.timeoutId = setTimeout(() => {
        timedOut = true;
        this.controller?.abort();
      }, this.timeoutSeconds * 1000);
    }
    const fetchHeaders = toHeaders(customHeaders);
    void this.fetchWithRedirects(target, {
      method: methodName,
      headers: fetchHeaders,
      body: method === 0 || method === 1 ? null : body,
      signal: controller.signal,
    }).then(async (response) => {
      if (this.controller === null) return;
      this.status = 7;
      const responseHeaders: string[] = [];
      response.headers.forEach((value, name) => responseHeaders.push(`${name}: ${value}`));
      const declaredLength = Number(response.headers.get('content-length') ?? -1);
      this.bodySize = Number.isFinite(declaredLength) ? declaredLength : -1;
      if (this.bodySizeLimit >= 0 && declaredLength > this.bodySizeLimit) {
        this.finish(HTTP_REQUEST_RESULT_BODY_SIZE_LIMIT_EXCEEDED, response.status, responseHeaders, new Uint8Array());
        return;
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (reader !== undefined) {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.byteLength;
          this.downloadedBytes = length;
          if (this.bodySizeLimit >= 0 && length > this.bodySizeLimit) {
            await reader.cancel();
            this.finish(HTTP_REQUEST_RESULT_BODY_SIZE_LIMIT_EXCEEDED, response.status, responseHeaders, new Uint8Array());
            return;
          }
          chunks.push(next.value.slice());
        }
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const encoded = response.headers.has('content-encoding');
      const result = !encoded && declaredLength >= 0 && declaredLength !== length
        ? HTTP_REQUEST_RESULT_CHUNKED_BODY_SIZE_MISMATCH : HTTP_REQUEST_RESULT_SUCCESS;
      this.finish(result, response.status, responseHeaders, bytes);
    }).catch((error: unknown) => {
      if (error instanceof Error && (
        error.message.startsWith('HTTPRequest cannot observe') ||
        error.message.startsWith('HTTPRequest cross-origin')
      )) {
        this.finish(HTTP_REQUEST_RESULT_REQUEST_FAILED, 0, [], new Uint8Array());
        queueMicrotask(() => { throw error; });
        return;
      }
      const result = timedOut ? HTTP_REQUEST_RESULT_TIMEOUT
        : error instanceof DOMException && error.name === 'AbortError'
          ? HTTP_REQUEST_RESULT_REQUEST_FAILED : HTTP_REQUEST_RESULT_CONNECTION_ERROR;
      this.finish(result, 0, [], new Uint8Array());
    });
    return OK;
  }

  private async fetchWithRedirects(target: URL, init: RequestInit): Promise<Response> {
    let current = target;
    let currentInit = init;
    for (let redirects = 0; ; redirects += 1) {
      const response = await fetch(current, { ...currentInit, redirect: 'manual' });
      if (response.type === 'opaqueredirect') {
        throw new Error('HTTPRequest cannot observe a cross-origin redirect through browser fetch.');
      }
      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers.get('location');
      if (location === null) return response;
      if (redirects >= this.maxRedirects) {
        this.finish(HTTP_REQUEST_RESULT_REDIRECT_LIMIT_REACHED, response.status, [], new Uint8Array());
        throw new DOMException('Redirect limit reached', 'AbortError');
      }
      const next = new URL(location, current);
      if (next.origin !== current.origin) {
        throw new Error('HTTPRequest cross-origin redirect cannot preserve Godot-observable headers in browser fetch.');
      }
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentInit.method === 'POST')) {
        const headers = new Headers(currentInit.headers);
        headers.delete('content-length');
        headers.delete('content-type');
        currentInit = { ...currentInit, method: 'GET', body: null, headers };
      }
      current = next;
    }
  }

  private finish(result: number, code: number, headers: readonly string[], body: Uint8Array): void {
    if (this.controller === null) return;
    this.clearTimeout();
    this.controller = null;
    this.status = HTTP_STATUS_DISCONNECTED;
    this.completed.emit(result, code, packedStringArray(headers), packedByteArray(body));
  }

  cancel_request(): void {
    const active = this.controller;
    this.controller = null;
    this.clearTimeout();
    active?.abort();
    this.status = HTTP_STATUS_DISCONNECTED;
  }

  get_http_client_status(): number { return this.status; }
  get_body_size(): number { return this.bodySize; }
  get_downloaded_bytes(): number { return this.downloadedBytes; }
  set_timeout(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('HTTPRequest.timeout requires a non-negative finite number.');
    this.timeoutSeconds = seconds;
  }
  get_timeout(): number { return this.timeoutSeconds; }
  set_download_file(path: string): void { this.downloadFile = String(path); }
  get_download_file(): string { return this.downloadFile; }
  set_download_chunk_size(bytes: number): void {
    if (!Number.isInteger(bytes) || bytes < 256) throw new RangeError('HTTPRequest.download_chunk_size must be at least 256.');
    this.downloadChunkSize = bytes;
  }
  get_download_chunk_size(): number { return this.downloadChunkSize; }
  set_body_size_limit(bytes: number): void {
    if (!Number.isInteger(bytes) || bytes < -1) throw new RangeError('HTTPRequest.body_size_limit requires -1 or a non-negative integer.');
    this.bodySizeLimit = bytes;
  }
  get_body_size_limit(): number { return this.bodySizeLimit; }
  set_max_redirects(value: number): void {
    if (!Number.isInteger(value) || value < 0) throw new RangeError('HTTPRequest.max_redirects requires a non-negative integer.');
    this.maxRedirects = value;
  }
  get_max_redirects(): number { return this.maxRedirects; }
  set_accept_gzip(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('HTTPRequest.accept_gzip requires bool.');
    this.acceptGzip = enabled;
  }
  is_accepting_gzip(): boolean { return this.acceptGzip; }
  set_use_threads(enabled: boolean): void {
    if (enabled) throw new Error('HTTPRequest.use_threads has no browser main-loop equivalent; fetch is already asynchronous.');
    this.useThreads = false;
  }
  is_using_threads(): boolean { return this.useThreads; }
  set_http_proxy(host: string, port: number): void {
    if (host !== '' || port !== -1) throw new Error('HTTPRequest HTTP proxy cannot be configured through browser fetch.');
  }
  set_https_proxy(host: string, port: number): void {
    if (host !== '' || port !== -1) throw new Error('HTTPRequest HTTPS proxy cannot be configured through browser fetch.');
  }
  set_tls_options(options: unknown): void {
    assertGodotBrowserClientTlsOptions(options, 'HTTPRequest.set_tls_options');
    this.tlsOptions = options === null || options === undefined ? null : options as GodotTLSOptions;
  }
  private clearTimeout(): void {
    if (this.timeoutId !== null) clearTimeout(this.timeoutId);
    this.timeoutId = null;
  }

  enterTree(tree: HTTPRequestTree, parent: object, release: () => void): void {
    if (this.attachedTree !== null) throw new Error('HTTPRequest cannot enter two SceneTrees.');
    this.attachedTree = tree;
    this.attachedParent = parent;
    this.releaseTree = release;
  }
  exitTree(): void {
    if (this.attachedTree === null) return;
    this.cancel_request();
    this.attachedTree = null;
    this.attachedParent = null;
    const release = this.releaseTree;
    this.releaseTree = null;
    release?.();
  }
}

export interface CreateHTTPRequestOptions {
  readonly name?: string;
  readonly siblingIndex?: number;
}

export interface HTTPRequestTree {
  registerNonDisplayChild(parent: object, child: object, siblingIndex?: number): () => void;
}

export function createGodotHTTPRequest(options: CreateHTTPRequestOptions = {}): GodotHTTPRequestNode {
  return new GodotHTTPRequestNode(options);
}

export function attachHTTPRequestToTree(
  tree: HTTPRequestTree,
  parent: object,
  request: GodotHTTPRequestNode,
): () => void {
  if (request.isInsideTree) throw new Error('HTTPRequest cannot enter two SceneTrees.');
  const release = tree.registerNonDisplayChild(parent, request, request.siblingIndex);
  request.enterTree(tree, parent, release);
  return () => request.exitTree();
}
