/** Godot Web JavaScriptBridge methods over the browser's native JavaScript realm. */

import { GodotCallable } from './callable';
import { packedByteArray, type PackedByteArray } from './packed-array';

function source(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('JavaScriptBridge.eval code requires String.');
  return value;
}

/**
 * Evaluate in either the page global realm or an isolated function-local realm, matching Godot's
 * `use_global_execution_context` switch. Native evaluation failures remain native exceptions.
 */
export function godotJavaScriptBridgeEval(
  code: unknown,
  useGlobalExecutionContext: unknown = false,
): unknown {
  if (typeof useGlobalExecutionContext !== 'boolean') {
    throw new TypeError('JavaScriptBridge.eval use_global_execution_context requires bool.');
  }
  const text = source(code);
  if (useGlobalExecutionContext) return (0, eval)(text);
  return Function('source', '"use strict"; return eval(source);')(text);
}

function interfaceName(value: unknown, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`JavaScriptBridge.${member} requires a String interface name.`);
  if (value.length === 0) throw new Error(`JavaScriptBridge.${member} interface name cannot be empty.`);
  return value;
}

/** Return one property of the page's global object without cloning or proxying its native identity. */
export function godotJavaScriptBridgeGetInterface(nameValue: unknown): unknown {
  const name = interfaceName(nameValue, 'get_interface');
  return Reflect.get(globalThis, name) ?? null;
}

/** Wrap a Callable as a native JavaScript function whose sole Godot argument is the JS arg array. */
export function godotJavaScriptBridgeCreateCallback(callableValue: unknown): (...args: unknown[]) => unknown {
  if (!(callableValue instanceof GodotCallable) || !callableValue.isValid()) {
    throw new TypeError('JavaScriptBridge.create_callback requires a valid Callable.');
  }
  return (...args: unknown[]) => callableValue.call(args);
}

function bufferView(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

export function godotJavaScriptBridgeIsJsBuffer(value: unknown): boolean {
  return bufferView(value) !== null;
}

export function godotJavaScriptBridgeBufferToPackedByteArray(value: unknown): PackedByteArray {
  const view = bufferView(value);
  if (view === null) {
    throw new TypeError('JavaScriptBridge.js_buffer_to_packed_byte_array requires ArrayBuffer or an ArrayBuffer view.');
  }
  return packedByteArray(view);
}

/** Construct a native global JavaScript class with source-provided varargs. */
export function godotJavaScriptBridgeCreateObject(nameValue: unknown, ...args: unknown[]): unknown {
  const name = interfaceName(nameValue, 'create_object');
  const constructor = Reflect.get(globalThis, name);
  if (typeof constructor !== 'function') {
    throw new Error(`JavaScriptBridge.create_object could not find global constructor ${JSON.stringify(name)}.`);
  }
  return Reflect.construct(constructor, args);
}

function fileName(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('JavaScriptBridge.download_buffer name requires a non-empty String.');
  }
  return value;
}

function mimeType(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('JavaScriptBridge.download_buffer mime requires a non-empty String.');
  }
  return value;
}

/** Hand project bytes to the browser's ordinary Blob download path. */
export function godotJavaScriptBridgeDownloadBuffer(
  bufferValue: unknown,
  nameValue: unknown,
  mimeValue: unknown = 'application/octet-stream',
): void {
  const view = bufferView(bufferValue) ?? (
    bufferValue !== null && typeof bufferValue === 'object' && Symbol.iterator in bufferValue
      ? Uint8Array.from(bufferValue as Iterable<number>)
      : null
  );
  if (view === null) throw new TypeError('JavaScriptBridge.download_buffer requires PackedByteArray-compatible bytes.');
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new Error('JavaScriptBridge.download_buffer requires a browser document.');
  }
  const blob = new Blob([view.slice()], { type: mimeType(mimeValue) });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName(nameValue);
  anchor.style.display = 'none';
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    queueMicrotask(() => URL.revokeObjectURL(url));
  }
}

async function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || navigator.serviceWorker === undefined) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

let pwaWaiting = false;
void serviceWorkerRegistration().then((registration) => {
  pwaWaiting = registration?.waiting !== null && registration?.waiting !== undefined;
  registration?.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller !== null) pwaWaiting = true;
    });
  });
});

export function godotJavaScriptBridgePwaNeedsUpdate(): boolean { return pwaWaiting; }

/** Request activation of a waiting service worker; Error.OK=0, ERR_UNAVAILABLE=2. */
export function godotJavaScriptBridgePwaUpdate(): number {
  if (!pwaWaiting) return 2;
  void serviceWorkerRegistration().then((registration) => {
    registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    pwaWaiting = false;
  });
  return 0;
}

interface EmscriptenFileSystem {
  syncfs(populate: boolean, callback: (error?: unknown) => void): void;
}

/** Flush an Emscripten persistent mount when the exported host provides one. */
export function godotJavaScriptBridgeForceFsSync(): void {
  const fs = Reflect.get(globalThis, 'FS') as Partial<EmscriptenFileSystem> | undefined;
  if (typeof fs?.syncfs !== 'function') return;
  fs.syncfs(false, (error) => {
    if (error !== undefined && error !== null) {
      queueMicrotask(() => { throw error; });
    }
  });
}

/** Stable identity returned by `Engine.get_singleton("JavaScriptBridge")` on Web exports. */
export const GODOT_JAVASCRIPT_BRIDGE_SINGLETON = Object.freeze({
  eval: godotJavaScriptBridgeEval,
  get_interface: godotJavaScriptBridgeGetInterface,
  create_callback: godotJavaScriptBridgeCreateCallback,
  is_js_buffer: godotJavaScriptBridgeIsJsBuffer,
  js_buffer_to_packed_byte_array: godotJavaScriptBridgeBufferToPackedByteArray,
  create_object: godotJavaScriptBridgeCreateObject,
  download_buffer: godotJavaScriptBridgeDownloadBuffer,
  pwa_needs_update: godotJavaScriptBridgePwaNeedsUpdate,
  pwa_update: godotJavaScriptBridgePwaUpdate,
  force_fs_sync: godotJavaScriptBridgeForceFsSync,
});
