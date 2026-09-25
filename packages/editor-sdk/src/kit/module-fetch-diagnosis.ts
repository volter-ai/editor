/**
 * WHICH MODULE A FAILED DYNAMIC IMPORT COULD NOT LOAD. The browser reports any
 * failure anywhere in an imported module's graph as the top module alone
 * ("Failed to fetch dynamically imported module: <entry>"), so a world whose
 * entry serves fine but whose graph holds one refused file reads as a broken
 * entry. This walks the entry's STATIC import graph with the page's own `fetch`
 * and names the first module that does not answer 200 with a script type.
 *
 * When every file answers, the failure is the loader's memory: a module that
 * failed once stays failed for the document, whatever the network says now. The
 * walk then imports the graph in dependency order (a module only after all it
 * imports) and stops at the first refusal, which is therefore the module that
 * failed itself rather than one that inherited a dependency's failure; that
 * module's own network attempts are reported with their bytes over the wire (0
 * means the browser answered from its cache without asking). The probe only runs
 * after a failure and imports only the static graph the failed import was
 * already evaluating; `import()` edges are not followed.
 *
 * Walks running together share one request per URL and at most
 * {@link MAX_DIAGNOSES} run at once, so a shared dependency failing under many
 * stories costs one walk's requests. Nothing is kept once the walks finish: a
 * later failure of the same entry is walked afresh.
 */

const FAILED_IMPORT = [
  /Failed to fetch dynamically imported module: (\S+)/, // Chromium
  /error loading dynamically imported module: (\S+)/, // Firefox
];
/** Static edges only: `import … from`, `import "…"`, `export … from`. */
const SPECIFIER =
  /(?:\bimport\s*(?:[\w*{}\s,$]+\s*from\s*)?|\bexport\s*[\w*{}\s,$]+\s*from\s*)["']((?:\/|\.\.?\/)[^"']+)["']/g;
const LIMIT = 400;
const MAX_DIAGNOSES = 5;

// The browser keeps 250 resource timings by default and a project boot issues more requests than
// that, so the first attempt at a module (the one the loader remembers) would already be dropped
// by the time a failure asks for it.
if (typeof performance !== 'undefined' && typeof performance.setResourceTimingBufferSize === 'function') {
  performance.setResourceTimingBufferSize(5_000);
}

export interface ModuleFetchDiagnosis {
  readonly entry: string;
  readonly fetched: number;
  /** The first module that did not load, or `null` when every one loads now. */
  readonly failed: {
    readonly url: string;
    /** The network's answer; `null` when the network answered and the loader refused. */
    readonly status: number | null;
    readonly detail: string;
  } | null;
}

/** The entry named by a failed dynamic import's message, or `null` for any other error. */
export function failedImportEntry(message: string): string | null {
  for (const pattern of FAILED_IMPORT) {
    const entry = pattern.exec(message)?.[1];
    if (entry) return entry;
  }
  return null;
}

interface FetchedModule {
  readonly status: number;
  readonly type: string;
  readonly imports: readonly string[];
}

/** Requests shared by the walks in flight; cleared when the last one settles. */
const fetchedModules = new Map<string, Promise<FetchedModule>>();
/** The walks in flight, by entry. */
const diagnoses = new Map<string, Promise<ModuleFetchDiagnosis>>();

function fetchModule(url: string): Promise<FetchedModule> {
  let pending = fetchedModules.get(url);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(url, { cache: 'no-store' });
      const type = response.headers.get('content-type') ?? '';
      if (!response.ok || !/javascript|ecmascript/.test(type)) return { status: response.status, type, imports: [] };
      const body = await response.text();
      const imports = new Set<string>();
      for (const match of body.matchAll(SPECIFIER)) {
        const specifier = match[1]!;
        // A served import carries an extension, a query or Vite's `/@` prefix (`/@id/…` virtual
        // modules); a bare relative name is text in a string or comment, not an edge.
        if (!/\.[a-z]+(?:[?#]|$)|\?|^\/@/i.test(specifier)) continue;
        imports.add(new URL(specifier, url).href);
      }
      return { status: response.status, type, imports: [...imports] };
    })();
    fetchedModules.set(url, pending);
  }
  return pending;
}

/** Diagnose a failed import of `entry`; never rejects. */
export function diagnoseModuleFetch(entry: string): Promise<ModuleFetchDiagnosis> {
  const existing = diagnoses.get(entry);
  if (existing) return existing;
  if (diagnoses.size >= MAX_DIAGNOSES) {
    return Promise.resolve({
      entry,
      fetched: 0,
      failed: { url: entry, status: null, detail: `not walked: ${MAX_DIAGNOSES} other failed imports are being walked` },
    });
  }
  const pending = walk(entry)
    .catch(
      (err): ModuleFetchDiagnosis => ({
        entry,
        fetched: 0,
        failed: { url: entry, status: null, detail: `walk failed: ${String(err)}` },
      }),
    )
    .finally(() => {
      diagnoses.delete(entry);
      if (diagnoses.size === 0) fetchedModules.clear();
    });
  diagnoses.set(entry, pending);
  return pending;
}

async function walk(entry: string): Promise<ModuleFetchDiagnosis> {
  const root = new URL(entry, location.href).href;
  const edges = new Map<string, readonly string[]>();
  const queue = [root];
  while (queue.length > 0 && edges.size < LIMIT) {
    const url = queue.shift()!;
    if (edges.has(url)) continue;
    let fetched: FetchedModule;
    try {
      fetched = await fetchModule(url);
    } catch (err) {
      return { entry, fetched: edges.size + 1, failed: { url, status: 0, detail: String(err) } };
    }
    if (fetched.status !== 200 || !/javascript|ecmascript/.test(fetched.type)) {
      return {
        entry,
        fetched: edges.size + 1,
        failed: { url, status: fetched.status, detail: fetched.type || '(no content type)' },
      };
    }
    edges.set(url, fetched.imports);
    for (const next of fetched.imports) if (!edges.has(next)) queue.push(next);
  }

  // Dependency order: a module after everything it imports (post-order from the entry).
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (url: string): void => {
    if (visited.has(url) || !edges.has(url)) return;
    visited.add(url);
    for (const next of edges.get(url)!) visit(next);
    order.push(url);
  };
  visit(root);

  for (const url of order) {
    try {
      await import(/* @vite-ignore */ url);
    } catch (err) {
      const attempts = performance
        .getEntriesByType('resource')
        .filter((timing): timing is PerformanceResourceTiming => timing.name === url)
        .map(
          (timing) =>
            `${'responseStatus' in timing ? timing.responseStatus : '?'} ` +
            `(${timing.transferSize}B over the wire, ${timing.initiatorType}) at ${Math.round(timing.startTime)}ms`,
        );
      return {
        entry,
        fetched: edges.size,
        failed: {
          url,
          status: null,
          detail:
            `every module it imports loads and the network serves it, but the loader refused it (${String(err)}); ` +
            `its attempts on this page: ${attempts.join(' | ') || 'none kept'}`,
        },
      };
    }
  }
  return { entry, fetched: edges.size, failed: null };
}

export function describeModuleFetch(diagnosis: ModuleFetchDiagnosis): string {
  const { failed } = diagnosis;
  if (!failed) return `all ${diagnosis.fetched} modules from ${diagnosis.entry} fetch and import from the page now`;
  const answer = failed.status === null ? '' : ` answered ${failed.status}`;
  return `module ${failed.url}${answer}: ${failed.detail} (walking ${diagnosis.fetched} modules from ${diagnosis.entry})`;
}
