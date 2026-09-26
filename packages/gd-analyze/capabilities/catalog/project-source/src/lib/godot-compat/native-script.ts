/** Godot 3 NativeScript/GDNativeLibrary retained metadata without executing native binaries. */

import type { GodotConfigFile } from './config-file';
import { registerGodotObjectIdentity } from './object';
import { packedStringArray, type PackedArrayValue } from './packed-array';
import { bindGodotResourceProtocol } from './resource-io';

function text(value: unknown, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`${member} requires String.`);
  return value;
}
function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} requires bool.`);
  return value;
}

export interface GodotGDNativeLibrary {
  config_file: GodotConfigFile | null;
  load_once: boolean;
  reloadable: boolean;
  singleton: boolean;
  symbol_prefix: string;
  get_config_file(): GodotConfigFile | null;
  set_config_file(value: GodotConfigFile | null): void;
  should_load_once(): boolean;
  set_load_once(value: boolean): void;
  is_reloadable(): boolean;
  set_reloadable(value: boolean): void;
  is_singleton(): boolean;
  set_singleton(value: boolean): void;
  get_symbol_prefix(): string;
  set_symbol_prefix(value: string): void;
  get_current_dependencies(): PackedArrayValue<string>;
  get_current_library_path(): string;
}

export function createGodotGDNativeLibrary(): GodotGDNativeLibrary {
  let configFile: GodotConfigFile | null = null;
  let loadOnce = true;
  let reloadable = true;
  let singleton = false;
  let symbolPrefix = 'godot_';
  const resource = {} as GodotGDNativeLibrary;
  const setConfigFile = (value: GodotConfigFile | null): void => {
    if (value !== null && typeof value !== 'object') throw new TypeError('GDNativeLibrary.config_file requires ConfigFile or null.');
    configFile = value;
  };
  const setLoadOnce = (value: unknown): void => { loadOnce = bool(value, 'GDNativeLibrary.load_once'); };
  const setReloadable = (value: unknown): void => { reloadable = bool(value, 'GDNativeLibrary.reloadable'); };
  const setSingleton = (value: unknown): void => { singleton = bool(value, 'GDNativeLibrary.singleton'); };
  const setSymbolPrefix = (value: unknown): void => { symbolPrefix = text(value, 'GDNativeLibrary.symbol_prefix'); };
  const platformValue = (key: string, fallback: unknown): unknown => {
    if (configFile === null) return fallback;
    const getter = Reflect.get(configFile, 'get_value');
    if (typeof getter !== 'function') return fallback;
    for (const section of ['entry', 'libraries', 'dependencies']) {
      const value = Reflect.apply(getter, configFile, [section, key, undefined]);
      if (value !== undefined && value !== null) return value;
    }
    return fallback;
  };
  Object.assign(resource, {
    get_config_file: () => configFile,
    set_config_file: setConfigFile,
    should_load_once: () => loadOnce,
    set_load_once: setLoadOnce,
    is_reloadable: () => reloadable,
    set_reloadable: setReloadable,
    is_singleton: () => singleton,
    set_singleton: setSingleton,
    get_symbol_prefix: () => symbolPrefix,
    set_symbol_prefix: setSymbolPrefix,
    get_current_dependencies: () => {
      const value = platformValue('dependencies', []);
      return packedStringArray(Array.isArray(value) ? value.map(String) : []);
    },
    get_current_library_path: () => String(platformValue('path', '')),
  });
  Object.defineProperties(resource, {
    config_file: { enumerable: true, get: () => configFile, set: setConfigFile },
    load_once: { enumerable: true, get: () => loadOnce, set: setLoadOnce },
    reloadable: { enumerable: true, get: () => reloadable, set: setReloadable },
    singleton: { enumerable: true, get: () => singleton, set: setSingleton },
    symbol_prefix: { enumerable: true, get: () => symbolPrefix, set: setSymbolPrefix },
  });
  registerGodotObjectIdentity(resource, 'GDNativeLibrary');
  return bindGodotResourceProtocol(resource, {
    createDuplicate: () => createGodotGDNativeLibrary(),
    populateDuplicate(source, target) {
      target.config_file = source.config_file;
      target.load_once = source.load_once;
      target.reloadable = source.reloadable;
      target.singleton = source.singleton;
      target.symbol_prefix = source.symbol_prefix;
    },
  });
}

export interface GodotNativeScript {
  class_name: string;
  library: GodotGDNativeLibrary | null;
  script_class_icon_path: string;
  script_class_name: string;
  get_class_name(): string;
  set_class_name(value: string): void;
  get_library(): GodotGDNativeLibrary | null;
  set_library(value: GodotGDNativeLibrary | null): void;
  get_script_class_icon_path(): string;
  set_script_class_icon_path(value: string): void;
  get_script_class_name(): string;
  set_script_class_name(value: string): void;
  get_class_documentation(): string;
  get_method_documentation(method: string): string;
  get_property_documentation(path: string): string;
  get_signal_documentation(signalName: string): string;
  new(): never;
}

export function createGodotNativeScript(): GodotNativeScript {
  let className = '';
  let library: GodotGDNativeLibrary | null = null;
  let iconPath = '';
  let scriptClassName = '';
  const resource = {} as GodotNativeScript;
  const setClassName = (value: unknown): void => { className = text(value, 'NativeScript.class_name'); };
  const setLibrary = (value: GodotGDNativeLibrary | null): void => {
    if (value !== null && typeof value !== 'object') throw new TypeError('NativeScript.library requires GDNativeLibrary or null.');
    library = value;
  };
  const setIconPath = (value: unknown): void => { iconPath = text(value, 'NativeScript.script_class_icon_path'); };
  const setScriptClassName = (value: unknown): void => { scriptClassName = text(value, 'NativeScript.script_class_name'); };
  Object.assign(resource, {
    get_class_name: () => className,
    set_class_name: setClassName,
    get_library: () => library,
    set_library: setLibrary,
    get_script_class_icon_path: () => iconPath,
    set_script_class_icon_path: setIconPath,
    get_script_class_name: () => scriptClassName,
    set_script_class_name: setScriptClassName,
    get_class_documentation: () => '',
    get_method_documentation: (method: unknown) => { text(method, 'NativeScript.get_method_documentation'); return ''; },
    get_property_documentation: (path: unknown) => { text(path, 'NativeScript.get_property_documentation'); return ''; },
    get_signal_documentation: (signalName: unknown) => { text(signalName, 'NativeScript.get_signal_documentation'); return ''; },
    new: (): never => { throw new Error(`NativeScript ${className || scriptClassName || '<unnamed>'} cannot instantiate a native binary in the browser host.`); },
  });
  Object.defineProperties(resource, {
    class_name: { enumerable: true, get: () => className, set: setClassName },
    library: { enumerable: true, get: () => library, set: setLibrary },
    script_class_icon_path: { enumerable: true, get: () => iconPath, set: setIconPath },
    script_class_name: { enumerable: true, get: () => scriptClassName, set: setScriptClassName },
  });
  registerGodotObjectIdentity(resource, 'NativeScript');
  return bindGodotResourceProtocol(resource, {
    createDuplicate: () => createGodotNativeScript(),
    populateDuplicate(source, target) {
      target.class_name = source.class_name;
      target.library = source.library;
      target.script_class_icon_path = source.script_class_icon_path;
      target.script_class_name = source.script_class_name;
    },
  });
}
