/**
 * WHICH MODULE A FAILED DYNAMIC IMPORT COULD NOT LOAD. The browser reports any
 * failure anywhere in an imported module's graph as the top module alone
 * ("Failed to fetch dynamically imported module: <entry>"), so a world whose
 * entry serves fine but whose graph holds one refused file reads as a broken
 * entry. This walks the entry's static and dynamic import specifiers with the
 * page's own `fetch` and names the first module that does not answer 200 with
 * a script type; when every module answers, it says so, which moves the
 * question from the server to the realm that imported it.
 */

const FAILED_IMPORT = /Failed to fetch dynamically imported module: (\S+)/;
const SPECIFIER = /(?:\bimport\s*\(\s*|\bimport\s+|\bfrom\s*)["']((?:\/|\.\.?\/)[^"']+)["']/g;
const LIMIT = 400;

// The browser keeps 250 resource timings by default and a project boot issues more requests than
// that, so the first attempt at a module (the one the loader remembers) would already be dropped
// by the time a failure asks for it.
if (typeof performance !== 'undefined' && typeof performance.setResourceTimingBufferSize === 'function') {
  performance.setResourceTimingBufferSize(20_000);
}

export interface ModuleFetchDiagnosis {
  readonly entry: string;
  readonly fetched: number;
  /** The first module that did not load, or `null` when every one answered. */
  readonly failed: { readonly url: string; readonly status: number; readonly detail: string } | null;
}

/** The entry named by a failed dynamic import's message, or `null` for any other error. */
export function failedImportEntry(message: string): string | null {
  return FAILED_IMPORT.exec(message)?.[1] ?? null;
}

export async function diagnoseModuleFetch(entry: string): Promise<ModuleFetchDiagnosis> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0 && seen.size < LIMIT) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    let response: Response;
    try {
      response = await fetch(url, { cache: 'no-store' });
    } catch (err) {
      return { entry, fetched: seen.size, failed: { url, status: 0, detail: String(err) } };
    }
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !/javascript|ecmascript/.test(type)) {
      return {
        entry,
        fetched: seen.size,
        failed: { url, status: response.status, detail: type || '(no content type)' },
      };
    }
    const body = await response.text();
    for (const match of body.matchAll(SPECIFIER)) {
      // A served import always carries an extension or a query; a bare relative name is text
      // inside a string or comment (a library's docs), not an edge of the graph.
      if (!/\.[a-z]+(?:[?#]|$)|\?/i.test(match[1]!)) continue;
      const next = new URL(match[1]!, url).href;
      if (!seen.has(next)) queue.push(next);
    }
  }
  // Every file answered, so ask the module loader: import deepest-first, and the first module it
  // refuses is the one the entry's import tripped on (the loader keeps a failed module failed).
  const refused: string[] = [];
  for (const url of [...seen].reverse()) {
    try {
      await import(/* @vite-ignore */ url);
    } catch {
      refused.push(url);
    }
  }
  if (refused.length > 0) {
    // What the network answered the FIRST time, for every module of the graph: the loader keeps a
    // module that failed once failed, so the attempt that matters is the one before this walk.
    const earlier = performance
      .getEntriesByType('resource')
      .filter((timing): timing is PerformanceResourceTiming => seen.has(timing.name) || refused.includes(timing.name))
      .filter((timing) => refused.includes(timing.name))
      .map(
        (timing) =>
          `${timing.name} → ${'responseStatus' in timing ? timing.responseStatus : '?'} ` +
          `(${timing.transferSize}B over the wire, ${timing.decodedBodySize}B body, ${timing.initiatorType}) ` +
          `at ${Math.round(timing.startTime)}ms`,
      );
    return {
      entry,
      fetched: seen.size,
      failed: {
        url: refused[0]!,
        status: 200,
        detail:
          `the loader refused ${refused.length}: ${refused.join(' ')}; their network attempts ` +
          `(${performance.getEntriesByType('resource').length} timings kept): ` +
          (earlier.join(' | ') || 'none'),
      },
    };
  }
  return { entry, fetched: seen.size, failed: null };
}

export function describeModuleFetch(diagnosis: ModuleFetchDiagnosis): string {
  return diagnosis.failed
    ? `module ${diagnosis.failed.url} answered ${diagnosis.failed.status} (${diagnosis.failed.detail}), ` +
        `found walking ${diagnosis.fetched} modules from ${diagnosis.entry}`
    : `all ${diagnosis.fetched} modules from ${diagnosis.entry} fetch and import from the page now`;
}
