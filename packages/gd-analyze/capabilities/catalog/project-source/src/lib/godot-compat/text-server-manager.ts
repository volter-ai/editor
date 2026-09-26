/** TextServerManager singleton registry over the browser-native and project-provided interfaces. */

import { registerGodotObjectIdentity } from './object';
import { godotTextServerGetFeatures, godotTextServerGetName, godotTextServerHasFeature } from './text-server';
import { godotDictionary, type GodotDictionary } from './variant';

export interface GodotTextServerInterface {
  get_name?(): string;
  get_features?(): number;
  has_feature?(feature: number): boolean;
  [member: string]: unknown;
}

function textServer(value: unknown, member: string): GodotTextServerInterface {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`TextServerManager.${member} requires TextServer.`);
  }
  return value as GodotTextServerInterface;
}

function nameOf(value: GodotTextServerInterface): string {
  const name = value.get_name?.();
  return typeof name === 'string' ? name : '';
}

const BROWSER_TEXT_SERVER: GodotTextServerInterface = {
  get_name: godotTextServerGetName,
  get_features: godotTextServerGetFeatures,
  has_feature: godotTextServerHasFeature,
};
registerGodotObjectIdentity(BROWSER_TEXT_SERVER, 'TextServer');

class GodotTextServerManagerRuntime {
  private readonly interfaces: GodotTextServerInterface[] = [BROWSER_TEXT_SERVER];
  private primary: GodotTextServerInterface = BROWSER_TEXT_SERVER;

  add_interface(value: unknown): void {
    const server = textServer(value, 'add_interface');
    if (!this.interfaces.includes(server)) this.interfaces.push(server);
  }

  get_interface_count(): number { return this.interfaces.length; }

  remove_interface(value: unknown): void {
    const server = textServer(value, 'remove_interface');
    if (server === BROWSER_TEXT_SERVER) {
      throw new Error('TextServerManager cannot remove its browser-native fallback interface.');
    }
    const index = this.interfaces.indexOf(server);
    if (index < 0) return;
    this.interfaces.splice(index, 1);
    if (this.primary === server) this.primary = BROWSER_TEXT_SERVER;
  }

  get_interface(index: unknown): GodotTextServerInterface {
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= this.interfaces.length) {
      throw new RangeError('TextServerManager.get_interface index is out of range.');
    }
    return this.interfaces[index]!;
  }

  get_interfaces(): GodotDictionary<string, number> {
    return godotDictionary(this.interfaces.map((entry, index) => [nameOf(entry), index] as const));
  }

  find_interface(nameValue: unknown): GodotTextServerInterface | null {
    if (typeof nameValue !== 'string') throw new TypeError('TextServerManager.find_interface requires String.');
    return this.interfaces.find((entry) => nameOf(entry) === nameValue) ?? null;
  }

  set_primary_interface(value: unknown): void {
    const server = textServer(value, 'set_primary_interface');
    if (!this.interfaces.includes(server)) this.interfaces.push(server);
    this.primary = server;
  }

  get_primary_interface(): GodotTextServerInterface { return this.primary; }

  clear(): void {
    this.interfaces.splice(0, this.interfaces.length, BROWSER_TEXT_SERVER);
    this.primary = BROWSER_TEXT_SERVER;
  }
}

export const GodotTextServerManager = new GodotTextServerManagerRuntime();

export function registerGodotTextServerInterface(value: GodotTextServerInterface): () => void {
  GodotTextServerManager.add_interface(value);
  return () => GodotTextServerManager.remove_interface(value);
}

export const godotTextServerManagerAddInterface = (value: unknown): void => GodotTextServerManager.add_interface(value);
export const godotTextServerManagerRemoveInterface = (value: unknown): void => GodotTextServerManager.remove_interface(value);
export const godotTextServerManagerGetInterfaces = (): GodotDictionary<string, number> => GodotTextServerManager.get_interfaces();
export const godotTextServerManagerFindInterface = (value: unknown): GodotTextServerInterface | null => GodotTextServerManager.find_interface(value);
export const godotTextServerManagerGetPrimaryInterface = (): GodotTextServerInterface => GodotTextServerManager.get_primary_interface();
export const godotTextServerManagerSetPrimaryInterface = (value: unknown): void => GodotTextServerManager.set_primary_interface(value);
export const godotTextServerManagerGetInterfaceCount = (): number => GodotTextServerManager.get_interface_count();
export const godotTextServerManagerGetInterface = (index: unknown): GodotTextServerInterface => GodotTextServerManager.get_interface(index);
