/**
 * A project module loaded ON USE is as fresh as the file on disk — never as
 * fresh as the file watcher happens to be.
 *
 * The problem, measured on the blind modeling bench (2026-09-05): an agent
 * edits `src/models/barrel.ts` and runs `vgai screenshot src/models/barrel.ts`
 * in the same breath. The look verb's Node half loads the module through
 * Vite's SSR runner, whose module graph is invalidated by the FILE WATCHER —
 * and the watcher's change event lands seconds after the write (FSEvents on
 * macOS, a poll tick on drvfs). Inside that window the runner hands back the
 * previous evaluation, the four views come out byte-identical to the last
 * look, and the agent concludes its edit did nothing. Four sessions in five
 * hit it; one restarted the editor before every look, one tried to rewrite
 * the project's own module loader and broke it, one shipped on a stale
 * picture.
 *
 * The fix is the pattern `project-dependency-invalidation.ts` already uses
 * for installs: check ON USE. Before a load, every module reachable from the
 * requested one that lives under the project root is stat'ed; a file whose
 * mtime moved since it was last evaluated has its graph node invalidated
 * explicitly (the same invalidation the watcher performs — clears the
 * transform, so the runner's next `fetchModule` re-transforms and
 * re-evaluates). After a load, the reachable set's mtimes are recorded. A
 * watcher event that arrives later is harmless: an already-invalidated node
 * invalidates again for nothing.
 *
 * Scope is the PROJECT's own files. `node_modules` and the engine checkout are
 * not stat'ed: the first is immutable between installs (and installs have
 * their own door), the second restarts the server when it moves.
 */

import { statSync } from 'node:fs';
import { sep } from 'node:path';
import type { ViteDevServer } from 'vite';
import type { ProjectModuleLoader } from './project-tools';

interface GraphNode {
  readonly id: string | null;
  readonly file: string | null;
  readonly importedModules: Set<GraphNode>;
}

interface Graph {
  getModuleById(id: string): GraphNode | undefined;
  invalidateModule(node: GraphNode): void;
}

function mtimeOf(file: string): number | undefined {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return undefined; // deleted: the load itself will say so
  }
}

/** Every graph node reachable from `entry` whose file sits under `root`. */
function reachableProjectNodes(entry: GraphNode, root: string): GraphNode[] {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  const seen = new Set<GraphNode>();
  const out: GraphNode[] = [];
  const stack = [entry];
  while (stack.length) {
    const node = stack.pop() as GraphNode;
    if (seen.has(node)) continue;
    seen.add(node);
    const file = node.file;
    if (!file || !file.startsWith(prefix) || file.includes(`${sep}node_modules${sep}`)) continue;
    out.push(node);
    for (const child of node.importedModules) stack.push(child);
  }
  return out;
}

export function freshProjectModuleLoader(
  vite: ViteDevServer,
  getProjectRoot: () => string | undefined,
): ProjectModuleLoader {
  const graph = vite.environments.ssr.moduleGraph as unknown as Graph;
  const evaluatedAt = new Map<string, number>();
  return async (moduleId: string) => {
    const root = getProjectRoot();
    if (root) {
      const entry = graph.getModuleById(moduleId);
      if (entry) {
        for (const node of reachableProjectNodes(entry, root)) {
          const file = node.file as string;
          const recorded = evaluatedAt.get(file);
          const current = mtimeOf(file);
          if (recorded !== undefined && current !== undefined && current !== recorded) {
            graph.invalidateModule(node);
            evaluatedAt.delete(file);
          }
        }
      }
    }
    const loaded = await vite.ssrLoadModule(moduleId);
    if (root) {
      const entry = graph.getModuleById(moduleId);
      if (entry) {
        for (const node of reachableProjectNodes(entry, root)) {
          const file = node.file as string;
          const current = mtimeOf(file);
          if (current !== undefined) evaluatedAt.set(file, current);
        }
      }
    }
    return loaded;
  };
}
