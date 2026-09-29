/**
 * @godot-class ResourceLoader
 * @role PROTOCOL
 *
 * Godot 4.7's `ResourceLoader` (`core/io/resource_loader.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as the page loads a project's imported resources:
 * Godot reads a resource's bytes before `load()` returns, and a scene's resources before it is
 * instantiated; on the page the bytes arrive asynchronously, so each load is tracked here and the
 * main loop (`main.tsx`) mounts the scenes only once every tracked load has finished.
 */

const pending = new Set<Promise<unknown>>();
const failures: unknown[] = [];

/**
 * Tracks a load started for a resource the project's scenes construct.
 *
 * @godot ResourceLoader (protocol)
 * @source core/io/resource_loader.cpp:725
 */
export function godot_resource_loader_track(load: Promise<unknown>): void {
  const tracked = load.catch((error: unknown) => {
    failures.push(error);
  });
  pending.add(tracked);
  void tracked.finally(() => pending.delete(tracked));
}

/**
 * Resolves once every tracked load (including loads started while waiting) has finished; rejects
 * with the first failure.
 *
 * @godot ResourceLoader (protocol)
 * @source core/io/resource_loader.cpp:725
 */
export async function godot_resource_loader_settled(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending]);
  if (failures.length > 0) throw failures[0];
}

type ScriptClasses = Readonly<Record<string, new (native: object) => object>>;

const LOADED = new Map<string, unknown>();

/** A value as the page's storage keeps it: a script resource by its script's path, a record frozen. */
function store(value: unknown, classes: ScriptClasses): unknown {
  if (value === null || typeof value !== 'object') return value ?? null;
  if (Array.isArray(value)) return value.map((item) => store(item, classes));
  if (value instanceof Map) return { $map: [...value].map(([key, item]) => [store(key, classes), store(item, classes)]) };
  const script = Object.entries(classes).find(([, cls]) => value.constructor === cls)?.[0];
  if (script !== undefined) {
    const fields = Object.fromEntries(Object.entries(value).filter(([name]) => !name.startsWith('$')).map(([name, item]) => [name, store(item, classes)]));
    return { $script: script, fields };
  }
  if (Object.isFrozen(value)) return { $record: { ...value } };
  throw new Error('godot-compat: ResourceSaver.save of a value that is not a script resource, a record or a container');
}

function revive(value: unknown, classes: ScriptClasses, make: (cls: new (native: object) => object, fields: Readonly<Record<string, unknown>>) => object): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => revive(item, classes, make));
  const record = value as Readonly<Record<string, unknown>>;
  if (Array.isArray(record['$map'])) return new Map((record['$map'] as [unknown, unknown][]).map(([key, item]) => [revive(key, classes, make), revive(item, classes, make)]));
  if (typeof record['$script'] === 'string') {
    const cls = classes[record['$script']];
    if (cls === undefined) return null;
    const fields = Object.fromEntries(Object.entries((record['fields'] ?? {}) as Readonly<Record<string, unknown>>).map(([name, item]) => [name, revive(item, classes, make)]));
    return make(cls, fields);
  }
  if (record['$record'] !== undefined) return Object.freeze({ ...(record['$record'] as object) });
  return null;
}

function storage(): Storage | undefined {
  try {
    return (globalThis as { readonly localStorage?: Storage }).localStorage;
  } catch {
    return undefined;
  }
}

/**
 * `ResourceLoader.load(path)`: a project resource the translation built (`project`, by path), made
 * once and cached as the loader caches it; a `user://` resource from the page's storage, where
 * `ResourceSaver.save` put it, its script resources made of the project's script classes by path;
 * null (Godot's error) for anything else.
 *
 * @godot ResourceLoader (protocol)
 * @source core/io/resource_loader.cpp:725
 */
export function godot_resource_loader_load(
  path: string,
  project: Readonly<Record<string, () => unknown>>,
  classes: ScriptClasses,
  make: (cls: new (native: object) => object, fields: Readonly<Record<string, unknown>>) => object,
): unknown {
  if (path.startsWith('user://')) {
    const text = storage()?.getItem(`godot:${path}`);
    if (text === null || text === undefined) return null;
    return revive(JSON.parse(text) as unknown, classes, make);
  }
  if (LOADED.has(path)) return LOADED.get(path);
  const build = project[path];
  if (build === undefined) return null;
  const value = build();
  LOADED.set(path, value);
  return value;
}

/**
 * `ResourceSaver.save(resource, path)` to `user://`: the resource kept in the page's storage, its
 * script resources by their scripts' paths; `OK`, or `ERR_FILE_CANT_WRITE` elsewhere.
 *
 * @godot ResourceLoader (protocol)
 * @source core/io/resource_saver.cpp:84
 */
export function godot_resource_saver_save(resource: unknown, path: string, classes: ScriptClasses): number {
  const target = storage();
  if (!path.startsWith('user://') || target === undefined) return 19;
  target.setItem(`godot:${path}`, JSON.stringify(store(resource, classes)));
  return 0;
}
