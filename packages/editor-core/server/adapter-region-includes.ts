import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdapterRegionIncludes } from '@volter/editor-sdk/kit/ui-source/adapter-region-includes';
import {
  ADAPTER_MODULE_FILENAME,
  EMPTY_REGION_INCLUDES,
  parseAdapterRegionIncludes,
} from '@volter/editor-sdk/kit/ui-source/adapter-region-includes';

/**
 * The dev server's filesystem half of the adapter's region `include`
 * globs — the pure parse lives in `../src/ui-source/adapter-region-includes.ts`
 * (browser-safe, because Content's component index reads the same declaration
 * through a storage backend), and this adds only "read the file beside the
 * manifest, once, and cache it".
 */

/** Cache: project directory -> its adapter's region includes. Same
 *  no-invalidation bar as the manifest-roots cache beside it — editing
 *  `vgai.adapter.ts` already restarts the dev session. */
const cache = new Map<string, AdapterRegionIncludes>();

/** Region includes declared by the `vgai.adapter.ts` beside `manifestDir`. A
 *  project with no adapter module gets the native default: no includes. */
export function adapterRegionIncludes(manifestDir: string): AdapterRegionIncludes {
  const cached = cache.get(manifestDir);
  if (cached !== undefined) return cached;
  let result = EMPTY_REGION_INCLUDES;
  try {
    result = parseAdapterRegionIncludes(
      readFileSync(join(manifestDir, ADAPTER_MODULE_FILENAME), 'utf8'),
    );
  } catch (err) {
    // No adapter module is the DECLARED native default. Any other fs error is a
    // real environment problem and is not swallowed into "declares nothing".
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
  cache.set(manifestDir, result);
  return result;
}

/** Test-only: forget what has been read. */
export function resetAdapterRegionIncludesCacheForTest(): void {
  cache.clear();
}

export { ADAPTER_MODULE_FILENAME };
