/**
 * THE MODULE LANE of `vgai eval` — reach the RUNNING mount's own module
 * instances, by served path, using URLs retained by their owning realm.
 *
 * WHY THE MOUNT STAMP IS LOAD-BEARING. Project modules are served per mount
 * as `/<path>?vgai-mount=<id>` (`project-module-instance.ts` propagates the
 * id through the whole project subtree), so browser module identity is
 * per-instance BY URL. A bare `import('/src/sim/host.ts')` therefore loads a
 * SECOND, never-ticked copy — the phantom-module trap the old string-command
 * registry existed to dodge. Importing through the ACTIVE mount's stamped
 * url returns the exact instance the game is running, from the browser's own
 * module cache.
 *
 * This is a DEV-SERVER door: exported builds are bundles with no module
 * urls, and their curated surface is the adapter's own exports. Errors here
 * teach the contract instead of leaving it to inference.
 */

// DEPENDENCY-LIGHT ON PURPOSE: project tool contributions import this
// module for their faces, and a project's `tsc` walks its imports — pulling
// `play-mode` (and through it half the editor) breaks every game's own
// typecheck. The focused-instance read is therefore INJECTED by the editor
// at boot rather than imported, and the query key is inlined as a constant
// with a guard test on the one true owner.
/** Mirrors `project-module-url.ts`'s PROJECT_MOUNT_QUERY (guarded by test —
 *  the two must never drift). */
const PROJECT_MOUNT_QUERY = 'vgai-mount';

let focusedInstanceProvider: (() => string) | null = null;
/** The packaged shell and source-served contributions share the host realm owner. */
function moduleUrls(instanceId: string): readonly string[] {
  const host = globalThis as typeof globalThis & {
    __vgaiGameModuleUrls?: (id: string) => readonly string[];
  };
  return host.__vgaiGameModuleUrls?.(instanceId) ?? [];
}

/** Wired once by the editor shell (`command-listener.ts`) at boot. */
export function setFocusedInstanceProvider(provider: () => string): void {
  focusedInstanceProvider = provider;
}

/** Validate/normalize a project-relative module path. Exported pure for the
 *  unit test; the rules are the error message. */
export function normalizeGameModulePath(path: string): string {
  const clean = path.replace(/^\/+/, '');
  if (!clean.startsWith('src/') || /[?#]/.test(clean)) {
    throw new Error(
      `modules("${path}"): pass the project-relative served path, starting "src/" with its real ` +
        'extension and no query — e.g. modules("src/sim/host.ts").',
    );
  }
  return clean;
}

/**
 * Every project module the mount has ACTUALLY LOADED, as the exact
 * project-relative strings {@link importGameModule} accepts — `src/world.tsx`,
 * not the `/@fs/…` pathname the browser fetched. This is the answer to "what
 * can I reach?", and it is read from URLs recorded by module evaluation.
 *
 * One owner, two readers: the `modules.loaded` listing below and the
 * not-loaded error message. They used to disagree — the error listed raw
 * `/@fs/…` pathnames while its own first sentence told you to pass
 * `src/…`, so the fix it printed was not the fix it named.
 */
export function loadedGameModulePaths(instanceId: string): string[] {
  const paths = moduleUrls(instanceId).flatMap((name) => {
    const { pathname, searchParams } = new URL(name);
    if (searchParams.get(PROJECT_MOUNT_QUERY) !== instanceId) return [];
    const at = pathname.lastIndexOf('/src/');
    return at === -1 ? [] : [pathname.slice(at + 1)];
  });
  return [...new Set(paths)].sort();
}

/**
 * The `modules` binding of `vgai eval`'s `game.run` scope and of the
 * `game-eval` op — a RESOLVER, `modules('src/sim/host.ts')`, that also
 * ENUMERATES what it can resolve.
 *
 * WHY THE ENUMERATION EXISTS (measured, cold mug #2, 2026-08-29). There is no
 * module registry here and there never was: `modules` is a function. So a cold
 * agent's first move — `game.run(({ modules }) => Object.keys(modules))` —
 * answered `[]` against a mount with twelve loaded modules, and `[]` reads as
 * "this game registers none". A function whose only honest answer to
 * `Object.keys` is an empty array is a door that lies when asked what is
 * behind it. `loaded` is an enumerable own accessor, so `Object.keys(modules)`
 * now names it and `modules.loaded` is the list of paths to pass back in.
 *
 * WHY THE RESULT IS A GUARDED PROMISE (measured, cold fox #3, 2026-08-29).
 * `modules(path)` is ASYNC — it dynamic-imports the running mount's own url —
 * and a cold agent who skipped the `await` got
 * `TypeError: modules(...).liveFoxes is not a function`, which names the
 * export, names the module, and says nothing whatsoever about promises. The
 * misuse is exactly detectable, so it is now caught where it happens: reading
 * any non-Promise member off the returned value throws a sentence naming the
 * fix. That is the same treatment `loaded` got — a door that answers the
 * question actually being asked instead of a true-but-useless fact.
 */
export function createGameModuleResolver(
  instanceId?: string,
): ((path: string) => Promise<Record<string, unknown>>) & { readonly loaded: string[] } {
  const resolve = (path: string) => awaitOnly(path, importGameModule(path, instanceId));
  Object.defineProperty(resolve, 'loaded', {
    enumerable: true,
    get: () => {
      const id = instanceId ?? focusedInstanceProvider?.();
      return id ? loadedGameModulePaths(id) : [];
    },
  });
  return resolve as ((path: string) => Promise<Record<string, unknown>>) & {
    readonly loaded: string[];
  };
}

/** Everything a legitimate consumer of a promise reads off it. Anything else
 *  is a caller that forgot the `await` and is reaching for a module export. */
const PROMISE_MEMBERS = new Set(['then', 'catch', 'finally', 'constructor', 'toJSON']);

/**
 * The promise `modules(path)` hands back, with one behaviour added: reading a
 * member that is not a promise's own throws a sentence naming the `await`.
 *
 * `then`/`catch`/`finally` are forwarded BOUND to the real promise — a
 * Proxy has no promise internal slots, so `Promise.prototype.then` called with
 * the proxy as `this` would throw for the wrong reason and break every correct
 * caller.
 */
function awaitOnly(
  path: string,
  promise: Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  return new Proxy(promise, {
    get(target, key) {
      if (key === 'then' || key === 'catch' || key === 'finally') {
        return (Reflect.get(target, key) as (...args: unknown[]) => unknown).bind(target);
      }
      if (typeof key === 'symbol' || PROMISE_MEMBERS.has(key)) return Reflect.get(target, key);
      throw new Error(
        `modules("${path}") returns a PROMISE — it dynamic-imports the running mount's own copy ` +
          `of that module — so \`.${String(key)}\` reads a promise, not your export. Await it: ` +
          `\`const m = await modules("${path}"); m.${String(key)}\` (and make the \`game.run\` ` +
          'callback `async`).',
      );
    },
  });
}

/** The running mount's instance of one project module. */
export async function importGameModule(
  path: string,
  instanceId?: string,
): Promise<Record<string, unknown>> {
  const clean = normalizeGameModulePath(path);
  const id = instanceId ?? focusedInstanceProvider?.();
  if (!id) {
    throw new Error('modules(): no play instance is mounted — enter Play first (`vgai play`).');
  }
  // Resolve the served base from what the browser ACTUALLY LOADED for this
  // mount, never from a rebuilt path: Vite rewrites a mount's imports to its
  // own resolved forms (root-relative in-repo, /@fs in a scaffold), and any
  // byte of divergence yields a SECOND module instance — the phantom this
  // lane exists to make impossible. Measured before this guard: an /@fs
  // rebuild read a dead copy while the registered door watched the sweep run.
  // ZERO URL CONSTRUCTION. Every attempt to rebuild the served url from
  // parts produced a phantom second instance off by one byte (/@fs vs
  // root-relative; a Vite-appended ?import). The only string guaranteed to
  // name the RUNNING instance is the one the graph already fetched — so the
  // accessor imports that string VERBATIM from its owning realm's evaluated
  // module URLs, and refuses when the module has not been
  // loaded by the game yet. The running graph's modules are, by definition,
  // loaded — so this covers exactly what "touch the running game" means.
  const suffix = `/${clean}`;
  const url = moduleUrls(id).find((name) => {
    const u = new URL(name);
    return u.pathname.endsWith(suffix) && u.searchParams.get(PROJECT_MOUNT_QUERY) === id;
  });
  if (!url) {
    const candidates = loadedGameModulePaths(id);
    throw new Error(
      `modules("${path}"): the running mount has not loaded that module (nothing to reach — a ` +
        'module the game never imported has no live instance). Loaded project modules ' +
        `(also readable as modules.loaded): ${candidates.join(', ') || '(none yet — play first)'}`,
    );
  }
  try {
    return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `modules("${path}") could not load ${url} — the path must be the exact served file ` +
        `(check the extension: .ts vs .tsx). ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
