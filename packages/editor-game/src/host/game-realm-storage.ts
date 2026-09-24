/**
 * A game-realm view of ordinary same-origin browser storage.
 *
 * Storage DATA stays shared, exactly as it is for two tabs on one origin. The
 * facade exists for a different reason: project code must not receive the
 * editor's actual Storage instance and whose calls otherwise cannot be
 * attributed to the mount that made them. A transient mount id is not a
 * durable profile id, so this deliberately does not prefix, copy, or
 * virtualize keys.
 */

export interface GameRealmStorageStats {
  readonly reads: number;
  readonly writes: number;
}

export interface GameRealmStorageView {
  readonly storage: Storage;
  stats(): GameRealmStorageStats;
}

export function createGameRealmStorage(source: Storage): GameRealmStorageView {
  let reads = 0;
  let writes = 0;
  const target = Object.create(Object.getPrototypeOf(source)) as object;

  const getItem = (key: string): string | null => {
    reads += 1;
    return source.getItem(String(key));
  };
  const setItem = (key: string, value: string): void => {
    writes += 1;
    source.setItem(String(key), String(value));
  };
  const removeItem = (key: string): void => {
    writes += 1;
    source.removeItem(String(key));
  };
  const clear = (): void => {
    writes += 1;
    source.clear();
  };
  const key = (index: number): string | null => {
    reads += 1;
    return source.key(Number(index));
  };

  const facade = new Proxy(target, {
    get(_target, property) {
      if (property === 'length') {
        reads += 1;
        return source.length;
      }
      if (property === 'getItem') return getItem;
      if (property === 'setItem') return setItem;
      if (property === 'removeItem') return removeItem;
      if (property === 'clear') return clear;
      if (property === 'key') return key;
      if (property === Symbol.toStringTag) return 'Storage';
      if (typeof property === 'string') return getItem(property) ?? undefined;
      return Reflect.get(target, property, target);
    },
    set(_target, property, value) {
      if (typeof property !== 'string') return Reflect.set(target, property, value, target);
      setItem(property, String(value));
      return true;
    },
    deleteProperty(_target, property) {
      if (typeof property !== 'string') return Reflect.deleteProperty(target, property);
      removeItem(property);
      return true;
    },
    defineProperty(_target, property, descriptor) {
      if (typeof property !== 'string' || !('value' in descriptor)) return false;
      setItem(property, String(descriptor.value));
      return true;
    },
    has(_target, property) {
      if (typeof property !== 'string') return Reflect.has(target, property);
      if (property in target) return true;
      return getItem(property) !== null;
    },
    ownKeys() {
      const keys: string[] = [];
      for (let index = 0; index < source.length; index += 1) {
        const name = source.key(index);
        if (name !== null) keys.push(name);
      }
      return keys;
    },
    getOwnPropertyDescriptor(_target, property) {
      if (typeof property !== 'string') return undefined;
      const value = source.getItem(property);
      return value === null
        ? undefined
        : { configurable: true, enumerable: true, value, writable: true };
    },
  }) as Storage;

  return {
    storage: facade,
    stats: () => ({ reads, writes }),
  };
}
