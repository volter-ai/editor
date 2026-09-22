/**
 * The GENERIC fetched-asset parse error.
 *
 * Every authored asset format the engine validates at fetch time throws this
 * when Zod rejects the payload, naming the offending file (T4.6). It lives
 * here — beside `loader.ts`/`assets.ts` — rather than inside a format module so
 * every caller (currently the input-map loader in `input/input-manager.ts`)
 * does not have to reach into an unrelated subsystem for it.
 *
 * The name says ASSET, not scene: an `.inputmap.json` failure is not a scene
 * failure, and the class covers every structured fetched asset.
 */

import type { ZodIssue } from 'zod';

export class AssetParseError extends Error {
  readonly issues: ZodIssue[];
  /** The offending file's path/URL, when the caller knows it (T4.6). */
  readonly filePath?: string | undefined;

  constructor(issues: ZodIssue[], filePath?: string) {
    const msg = issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    const header = filePath ? `Asset validation failed (${filePath}):` : 'Asset validation failed:';
    super(`${header}\n${msg}`);
    this.name = 'AssetParseError';
    this.issues = issues;
    this.filePath = filePath;
  }
}
