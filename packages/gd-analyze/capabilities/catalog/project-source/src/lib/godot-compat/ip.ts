/** Browser-safe IP singleton with literal, loopback, cache, and queued resolver state. */

import { packedStringArray, type PackedStringArray } from './packed-array';
import { godotDictionary, type GodotDictionary } from './variant';

export const GODOT_IP_TYPE_NONE = 0;
export const GODOT_IP_TYPE_IPV4 = 1;
export const GODOT_IP_TYPE_IPV6 = 2;
export const GODOT_IP_TYPE_ANY = 3;
export const GODOT_IP_RESOLVER_STATUS_NONE = 0;
export const GODOT_IP_RESOLVER_STATUS_WAITING = 1;
export const GODOT_IP_RESOLVER_STATUS_DONE = 2;
export const GODOT_IP_RESOLVER_STATUS_ERROR = 3;
export const GODOT_IP_RESOLVER_MAX_QUERIES = 256;
export const GODOT_IP_RESOLVER_INVALID_ID = -1;

interface ResolverItem {
  readonly id: number;
  readonly host: string;
  readonly type: number;
  readonly addresses: readonly string[];
  readonly status: number;
}

function hostName(value: unknown, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`IP.${member} host requires String.`);
  const host = value.trim();
  if (host.length === 0) throw new Error(`IP.${member} host cannot be empty.`);
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function ipType(value: unknown, member: string): number {
  if (value !== GODOT_IP_TYPE_NONE && value !== GODOT_IP_TYPE_IPV4 &&
      value !== GODOT_IP_TYPE_IPV6 && value !== GODOT_IP_TYPE_ANY) {
    throw new RangeError(`IP.${member} ip_type requires TYPE_NONE, TYPE_IPV4, TYPE_IPV6, or TYPE_ANY.`);
  }
  return value as number;
}

function ipv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) =>
    /^\d+$/.test(part) && part.length <= 3 && Number(part) >= 0 && Number(part) <= 255);
}

function ipv6(value: string): boolean {
  if (!value.includes(':') || !/^[0-9a-f:.%]+$/i.test(value)) return false;
  const address = value.split('%')[0] ?? value;
  if ((address.match(/::/g) ?? []).length > 1) return false;
  const parts = address.split(':');
  if (!address.includes('::') && parts.length !== 8) return false;
  if (address.includes('::') && parts.length > 8) return false;
  return parts.every((part) => part === '' || /^[0-9a-f]{1,4}$/i.test(part) || ipv4(part));
}

function permits(address: string, type: number): boolean {
  if (type === GODOT_IP_TYPE_NONE) return false;
  if (ipv4(address)) return type === GODOT_IP_TYPE_IPV4 || type === GODOT_IP_TYPE_ANY;
  if (ipv6(address)) return type === GODOT_IP_TYPE_IPV6 || type === GODOT_IP_TYPE_ANY;
  return false;
}

function browserHostname(): string {
  return typeof globalThis.location === 'object' && typeof globalThis.location.hostname === 'string'
    ? globalThis.location.hostname
    : '';
}

function literalAddresses(host: string, type: number): string[] {
  if (permits(host, type)) return [host];
  const normalized = host.toLowerCase();
  if (normalized === 'localhost' || normalized === browserHostname().toLowerCase()) {
    const result: string[] = [];
    if (type === GODOT_IP_TYPE_IPV4 || type === GODOT_IP_TYPE_ANY) result.push('127.0.0.1');
    if (type === GODOT_IP_TYPE_IPV6 || type === GODOT_IP_TYPE_ANY) result.push('::1');
    return result;
  }
  return [];
}

class GodotIPRuntime {
  private nextResolverId = 1;
  private readonly queued = new Map<number, ResolverItem>();
  private readonly cache = new Map<string, readonly string[]>();

  resolve_hostname(hostValue: unknown, typeValue = GODOT_IP_TYPE_ANY): string {
    return this.resolve_hostname_addresses(hostValue, typeValue)[0] ?? '';
  }

  resolve_hostname_addresses(hostValue: unknown, typeValue = GODOT_IP_TYPE_ANY): PackedStringArray {
    const host = hostName(hostValue, 'resolve_hostname_addresses');
    const type = ipType(typeValue, 'resolve_hostname_addresses');
    const key = `${type}:${host.toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return packedStringArray(cached);
    const addresses = literalAddresses(host, type);
    this.cache.set(key, addresses);
    return packedStringArray(addresses);
  }

  resolve_hostname_queue_item(hostValue: unknown, typeValue = GODOT_IP_TYPE_ANY): number {
    if (this.queued.size >= GODOT_IP_RESOLVER_MAX_QUERIES) return GODOT_IP_RESOLVER_INVALID_ID;
    const host = hostName(hostValue, 'resolve_hostname_queue_item');
    const type = ipType(typeValue, 'resolve_hostname_queue_item');
    const addresses = [...this.resolve_hostname_addresses(host, type)];
    const id = this.allocateResolverId();
    this.queued.set(id, {
      id,
      host,
      type,
      addresses,
      status: addresses.length === 0
        ? GODOT_IP_RESOLVER_STATUS_ERROR
        : GODOT_IP_RESOLVER_STATUS_DONE,
    });
    return id;
  }

  get_resolve_item_status(idValue: unknown): number {
    const id = this.resolverId(idValue, 'get_resolve_item_status');
    return this.queued.get(id)?.status ?? GODOT_IP_RESOLVER_STATUS_NONE;
  }

  get_resolve_item_address(idValue: unknown): string {
    const id = this.resolverId(idValue, 'get_resolve_item_address');
    return this.queued.get(id)?.addresses[0] ?? '';
  }

  get_resolve_item_addresses(idValue: unknown): string[] {
    const id = this.resolverId(idValue, 'get_resolve_item_addresses');
    return [...(this.queued.get(id)?.addresses ?? [])];
  }

  erase_resolve_item(idValue: unknown): void {
    const id = this.resolverId(idValue, 'erase_resolve_item');
    this.queued.delete(id);
  }

  get_local_addresses(): PackedStringArray {
    const addresses = ['127.0.0.1', '::1'];
    const current = browserHostname();
    if (permits(current, GODOT_IP_TYPE_ANY) && !addresses.includes(current)) addresses.push(current);
    return packedStringArray(addresses);
  }

  get_local_interfaces(): GodotDictionary[] {
    return [godotDictionary([
      ['name', 'browser-loopback'],
      ['friendly', 'Browser Loopback'],
      ['index', '0'],
      ['addresses', this.get_local_addresses()],
    ])];
  }

  clear_cache(hostnameValue = ''): void {
    if (typeof hostnameValue !== 'string') throw new TypeError('IP.clear_cache hostname requires String.');
    if (hostnameValue === '') {
      this.cache.clear();
      return;
    }
    const suffix = `:${hostnameValue.toLowerCase()}`;
    for (const key of [...this.cache.keys()]) if (key.endsWith(suffix)) this.cache.delete(key);
  }

  private resolverId(value: unknown, member: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 0x7fff_ffff) {
      throw new RangeError(`IP.${member} id requires a non-negative int32.`);
    }
    return value as number;
  }

  private allocateResolverId(): number {
    for (let attempts = 0; attempts < 0x7fff_ffff; attempts += 1) {
      const id = this.nextResolverId;
      this.nextResolverId = this.nextResolverId === 0x7fff_ffff ? 1 : this.nextResolverId + 1;
      if (!this.queued.has(id)) return id;
    }
    return GODOT_IP_RESOLVER_INVALID_ID;
  }
}

export const GodotIP = new GodotIPRuntime();
