/** Browser-native Godot Crypto subset: CSPRNG, HMAC, and constant-time digest comparison. */

import { godotHashDigest } from './hashing-context';
import { GodotFileAccess } from './file-access';
import { registerGodotObjectIdentity } from './object';
import { packedByteArray, type PackedByteArray } from './packed-array';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';

const OK = 0;
const ERR_FILE_NOT_FOUND = 7;
const ERR_PARSE_ERROR = 43;

const bytesOf = (value: Uint8Array | readonly number[]): Uint8Array =>
  value instanceof Uint8Array ? value : Uint8Array.from(value);

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
}

export class GodotCrypto {
  constructor() { registerGodotObjectIdentity(this, 'Crypto'); }

  generate_random_bytes(size: number): PackedByteArray {
    if (!Number.isInteger(size) || size < 0) return packedByteArray();
    const provider = globalThis.crypto;
    if (provider?.getRandomValues === undefined) {
      throw new Error('Crypto.generate_random_bytes requires browser crypto.getRandomValues.');
    }
    const result = new Uint8Array(size);
    for (let offset = 0; offset < result.length; offset += 65_536) {
      provider.getRandomValues(result.subarray(offset, Math.min(result.length, offset + 65_536)));
    }
    return packedByteArray(result);
  }

  hmac_digest(hashType: number, keyValue: Uint8Array | readonly number[], messageValue: Uint8Array | readonly number[]): PackedByteArray {
    return godotHmacDigest(hashType, keyValue, messageValue);
  }

  constant_time_compare(trustedValue: Uint8Array | readonly number[], receivedValue: Uint8Array | readonly number[]): boolean {
    const trusted = bytesOf(trustedValue);
    const received = bytesOf(receivedValue);
    if (trusted.length !== received.length) return false;
    let difference = 0;
    for (let index = 0; index < trusted.length; index += 1) {
      difference |= (trusted[index] ?? 0) ^ (received[index] ?? 0);
    }
    return difference === 0;
  }
}

export function godotHmacDigest(
  hashType: number,
  keyValue: Uint8Array | readonly number[],
  messageValue: Uint8Array | readonly number[],
): PackedByteArray {
  if (hashType !== 0 && hashType !== 1 && hashType !== 2) return packedByteArray();
  let key = bytesOf(keyValue);
  const message = bytesOf(messageValue);
  const blockSize = 64;
  if (key.length > blockSize) key = Uint8Array.from(godotHashDigest(hashType, key));
  const padded = new Uint8Array(blockSize);
  padded.set(key);
  const inner = new Uint8Array(blockSize);
  const outer = new Uint8Array(blockSize);
  for (let index = 0; index < blockSize; index += 1) {
    inner[index] = (padded[index] ?? 0) ^ 0x36;
    outer[index] = (padded[index] ?? 0) ^ 0x5c;
  }
  const innerDigest = Uint8Array.from(godotHashDigest(hashType, concat(inner, message)));
  return godotHashDigest(hashType, concat(outer, innerDigest));
}

export function createGodotCrypto(): GodotCrypto { return new GodotCrypto(); }

/**
 * Runtime `CryptoKey.new()`. Key bytes stay private to the browser crypto carrier; the empty
 * constructor still has to be a real Resource identity so Node/Object/Resource APIs work before
 * a project loads or generates key material.
 */
export class GodotCryptoKey {
  #der: Uint8Array | null = null;
  #publicOnly = false;

  constructor() {
    registerGodotObjectIdentity(this, 'CryptoKey');
    bindGodotResourceProtocol(this, {
      createDuplicate: () => {
        const duplicate = new GodotCryptoKey();
        duplicate.#der = this.#der?.slice() ?? null;
        duplicate.#publicOnly = this.#publicOnly;
        return duplicate;
      },
    });
  }

  /**
   * Godot's synchronous PEM loader. The Web port retains the decoded DER bytes; crypto operations
   * can hand those bytes directly to SubtleCrypto without ever exposing key material as text.
   */
  load_from_string(key: string, publicOnly = false): number {
    if (typeof key !== 'string' || typeof publicOnly !== 'boolean') return ERR_PARSE_ERROR;
    const expectedLabels = publicOnly
      ? ['PUBLIC KEY', 'RSA PUBLIC KEY']
      : ['PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY'];
    const match = /^-----BEGIN ([A-Z0-9 ]+)-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END \1-----\s*$/.exec(key);
    const label = match?.[1] ?? '';
    if (match === null || !expectedLabels.includes(label)) return ERR_PARSE_ERROR;
    const encoded = (match[2] ?? '').replace(/\s+/g, '');
    if (encoded.length === 0 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      return ERR_PARSE_ERROR;
    }
    let binary: string;
    try {
      if (typeof atob !== 'function') return ERR_PARSE_ERROR;
      binary = atob(encoded);
    } catch {
      return ERR_PARSE_ERROR;
    }
    const der = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (!isSupportedKeyDer(label, der)) return ERR_PARSE_ERROR;
    this.#der = der;
    this.#publicOnly = publicOnly;
    godotResourceEmitChanged(this);
    return OK;
  }

  /** Synchronous Godot project-file load over the already-mounted res:// byte table. */
  load(path: string, publicOnly = false): number {
    if (typeof path !== 'string' || typeof publicOnly !== 'boolean') return ERR_PARSE_ERROR;
    if (!GodotFileAccess.file_exists(path)) return ERR_FILE_NOT_FOUND;
    let pem: string;
    try {
      pem = new TextDecoder('utf-8', { fatal: true }).decode(GodotFileAccess.get_file_as_bytes(path));
    } catch {
      return ERR_PARSE_ERROR;
    }
    return this.load_from_string(pem, publicOnly);
  }

  /** Native-key carrier for browser crypto consumers; the copy prevents mutable key-byte aliases. */
  encoded_key(): { readonly data: Uint8Array; readonly publicOnly: boolean } | null {
    return this.#der === null ? null : { data: this.#der.slice(), publicOnly: this.#publicOnly };
  }
}

interface DerValue { readonly tag: number; readonly bytes: Uint8Array; readonly end: number }

function readDer(input: Uint8Array, offset: number): DerValue | null {
  if (offset + 2 > input.length) return null;
  const tag = input[offset] ?? -1;
  const first = input[offset + 1] ?? 0;
  let cursor = offset + 2;
  let length = first;
  if ((first & 0x80) !== 0) {
    const count = first & 0x7f;
    if (count === 0 || count > 4 || cursor + count > input.length || input[cursor] === 0) return null;
    length = 0;
    for (let index = 0; index < count; index += 1) length = length * 256 + (input[cursor + index] ?? 0);
    cursor += count;
    if (length < 128) return null;
  }
  const end = cursor + length;
  return end <= input.length ? { tag, bytes: input.subarray(cursor, end), end } : null;
}

function children(sequence: DerValue): readonly DerValue[] | null {
  if (sequence.tag !== 0x30) return null;
  const result: DerValue[] = [];
  let offset = 0;
  while (offset < sequence.bytes.length) {
    const child = readDer(sequence.bytes, offset);
    if (child === null) return null;
    result.push(child);
    offset = child.end;
  }
  return result;
}

const oid = (value: DerValue): string | null => value.tag === 0x06
  ? Array.from(value.bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  : null;

function positiveInteger(value: DerValue): boolean {
  if (value.tag !== 0x02 || value.bytes.length === 0) return false;
  if ((value.bytes[0] ?? 0) >= 0x80) return false;
  return !(value.bytes.length > 1 && value.bytes[0] === 0 && (value.bytes[1] ?? 0) < 0x80);
}

function pkcs1Public(input: Uint8Array): boolean {
  const root = readDer(input, 0);
  if (root === null || root.end !== input.length) return false;
  const values = children(root);
  return values !== null && values.length === 2 && values.every(positiveInteger) &&
    values[0]!.bytes.length >= 64 && values[1]!.bytes.length >= 1 && values[1]!.bytes.length <= 8 &&
    (values[1]!.bytes[values[1]!.bytes.length - 1]! & 1) === 1;
}

function pkcs1Private(input: Uint8Array): boolean {
  const root = readDer(input, 0);
  if (root === null || root.end !== input.length) return false;
  const values = children(root);
  return values !== null && values.length >= 9 && values.slice(0, 9).every(positiveInteger) &&
    values[0]!.bytes.length === 1 && (values[0]!.bytes[0] === 0 || values[0]!.bytes[0] === 1) &&
    values[1]!.bytes.length >= 64 && values.slice(2, 9).every((value) => value.bytes.some((byte) => byte !== 0));
}

function sec1Private(input: Uint8Array): boolean {
  const root = readDer(input, 0);
  if (root === null || root.end !== input.length) return false;
  const values = children(root);
  return values !== null && values.length >= 2 && positiveInteger(values[0]!) &&
    values[0]!.bytes.length === 1 && values[0]!.bytes[0] === 1 &&
    values[1]!.tag === 0x04 && values[1]!.bytes.length >= 24 && values[1]!.bytes.length <= 80;
}

function algorithm(sequence: DerValue): { readonly oid: string; readonly params?: DerValue } | null {
  const values = children(sequence);
  const algorithmOid = values === null || values.length === 0 ? null : oid(values[0]!);
  if (algorithmOid === null || values!.length > 2) return null;
  return values!.length === 2 ? { oid: algorithmOid, params: values![1]! } : { oid: algorithmOid };
}

function subjectPublicKeyInfo(input: Uint8Array): boolean {
  const root = readDer(input, 0);
  if (root === null || root.end !== input.length) return false;
  const values = children(root);
  if (values === null || values.length !== 2 || values[1]!.tag !== 0x03 || values[1]!.bytes[0] !== 0) return false;
  const carrier = algorithm(values[0]!);
  if (carrier === null) return false;
  const key = values[1]!.bytes.subarray(1);
  if (carrier.oid === '2a864886f70d010101') return pkcs1Public(key);
  if (carrier.oid === '2a8648ce3d0201') {
    const curve = carrier.params === undefined ? null : oid(carrier.params);
    const length = curve === '2a8648ce3d030107' ? 65 : curve === '2b81040022' ? 97 : curve === '2b81040023' ? 133 : 0;
    return length > 0 && key.length === length && key[0] === 0x04;
  }
  if (carrier.oid === '2b6570') return key.length === 32;
  if (carrier.oid === '2b6571') return key.length === 57;
  return false;
}

function privateKeyInfo(input: Uint8Array): boolean {
  const root = readDer(input, 0);
  if (root === null || root.end !== input.length) return false;
  const values = children(root);
  if (
    values === null || values.length < 3 || !positiveInteger(values[0]!) ||
    values[0]!.bytes.length !== 1 || (values[0]!.bytes[0] !== 0 && values[0]!.bytes[0] !== 1) ||
    values[1]!.tag !== 0x30 || values[2]!.tag !== 0x04
  ) return false;
  const carrier = algorithm(values[1]!);
  if (carrier === null) return false;
  const key = values[2]!.bytes;
  if (carrier.oid === '2a864886f70d010101') return pkcs1Private(key);
  if (carrier.oid === '2a8648ce3d0201') return sec1Private(key);
  if (carrier.oid === '2b6570' || carrier.oid === '2b6571') {
    const nested = readDer(key, 0);
    const raw = nested?.tag === 0x04 && nested.end === key.length ? nested.bytes : key;
    return raw.length === (carrier.oid === '2b6570' ? 32 : 57);
  }
  return false;
}

function isSupportedKeyDer(label: string, der: Uint8Array): boolean {
  if (label === 'PUBLIC KEY') return subjectPublicKeyInfo(der);
  if (label === 'RSA PUBLIC KEY') return pkcs1Public(der);
  if (label === 'PRIVATE KEY') return privateKeyInfo(der);
  if (label === 'RSA PRIVATE KEY') return pkcs1Private(der);
  return label === 'EC PRIVATE KEY' && sec1Private(der);
}

export function createGodotX509Certificate(): GodotX509Certificate {
  return new GodotX509Certificate();
}

export function createGodotCryptoKey(): GodotCryptoKey {
  return new GodotCryptoKey();
}

export class GodotX509Certificate {
  public resource_name = '';
  #certificates: Uint8Array[] = [];
  constructor() {
    registerGodotObjectIdentity(this, 'X509Certificate');
    bindGodotResourceProtocol(this, {
      createDuplicate: () => {
        const duplicate = new GodotX509Certificate();
        duplicate.resource_name = this.resource_name;
        duplicate.#certificates = this.#certificates.map((certificate) => certificate.slice());
        return duplicate;
      },
    });
  }
  load_from_string(certificate: string): number {
    if (typeof certificate !== 'string') return ERR_PARSE_ERROR;
    const blocks = [...certificate.matchAll(/-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END CERTIFICATE-----/g)];
    if (blocks.length === 0 || certificate.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim() !== '') {
      return ERR_PARSE_ERROR;
    }
    const decoded: Uint8Array[] = [];
    for (const block of blocks) {
      const encoded = (block[1] ?? '').replace(/\s+/g, '');
      if (encoded.length === 0 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return ERR_PARSE_ERROR;
      let binary: string;
      try { binary = atob(encoded); } catch { return ERR_PARSE_ERROR; }
      const der = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      if (!isX509CertificateDer(der)) return ERR_PARSE_ERROR;
      decoded.push(der);
    }
    this.#certificates = decoded;
    godotResourceEmitChanged(this);
    return OK;
  }
  load(path: string): number {
    if (typeof path !== 'string') return ERR_PARSE_ERROR;
    if (!GodotFileAccess.file_exists(path)) return ERR_FILE_NOT_FOUND;
    let pem: string;
    try {
      pem = new TextDecoder('utf-8', { fatal: true }).decode(GodotFileAccess.get_file_as_bytes(path));
    } catch {
      return ERR_PARSE_ERROR;
    }
    return this.load_from_string(pem);
  }
  encoded_certificates(): readonly Uint8Array[] { return this.#certificates.map((certificate) => certificate.slice()); }
}

function isX509CertificateDer(input: Uint8Array): boolean {
  const root = readDer(input, 0);
  if (root === null || root.end !== input.length) return false;
  const values = children(root);
  if (values === null || values.length !== 3 || values[0]!.tag !== 0x30 || values[1]!.tag !== 0x30 || values[2]!.tag !== 0x03) return false;
  const signature = values[2]!.bytes;
  return signature.length > 1 && signature[0] === 0 && children(values[1]!)?.[0]?.tag === 0x06;
}

export type GodotTlsMode = 'client' | 'client-unsafe' | 'server';

export class GodotTLSOptions {
  constructor(
    readonly mode: GodotTlsMode,
    readonly trustedChain: GodotX509Certificate | null,
    readonly commonNameOverride: string,
    readonly privateKey: GodotCryptoKey | null,
    readonly ownCertificate: GodotX509Certificate | null,
  ) { registerGodotObjectIdentity(this, 'TLSOptions'); }

  is_unsafe_client(): boolean { return this.mode === 'client-unsafe'; }
}

export function createGodotTlsClientOptions(
  trustedChain: GodotX509Certificate | null = null,
  commonNameOverride = '',
): GodotTLSOptions {
  if (trustedChain !== null && !(trustedChain instanceof GodotX509Certificate)) throw new TypeError('TLSOptions.client trusted_chain requires X509Certificate or null.');
  if (typeof commonNameOverride !== 'string') throw new TypeError('TLSOptions.client common_name_override requires String.');
  return new GodotTLSOptions('client', trustedChain, commonNameOverride, null, null);
}

export function createGodotTlsUnsafeClientOptions(trustedChain: GodotX509Certificate | null = null): GodotTLSOptions {
  if (trustedChain !== null && !(trustedChain instanceof GodotX509Certificate)) throw new TypeError('TLSOptions.client_unsafe trusted_chain requires X509Certificate or null.');
  return new GodotTLSOptions('client-unsafe', trustedChain, '', null, null);
}

export function createGodotTlsServerOptions(key: GodotCryptoKey, certificate: GodotX509Certificate): GodotTLSOptions {
  if (!(key instanceof GodotCryptoKey)) throw new TypeError('TLSOptions.server private_key requires CryptoKey.');
  if (!(certificate instanceof GodotX509Certificate)) throw new TypeError('TLSOptions.server own_certificate requires X509Certificate.');
  if (key.encoded_key() === null || certificate.encoded_certificates().length === 0) {
    throw new Error('TLSOptions.server requires loaded key and certificate material.');
  }
  return new GodotTLSOptions('server', null, '', key, certificate);
}

export function assertGodotBrowserClientTlsOptions(options: unknown, member: string): void {
  if (options === null || options === undefined) return;
  if (!(options instanceof GodotTLSOptions)) throw new TypeError(`${member} requires TLSOptions or null.`);
  if (options.mode !== 'client' || options.trustedChain !== null || options.commonNameOverride !== '') {
    throw new Error(`${member} cannot override browser-managed TLS trust, hostname verification, or client/server mode.`);
  }
}
