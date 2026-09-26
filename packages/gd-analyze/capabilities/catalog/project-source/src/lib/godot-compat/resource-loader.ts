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
