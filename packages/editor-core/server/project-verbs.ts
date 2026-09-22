/**
 * THE PROJECT'S OWN FILES, AS FACTS — the server half of the `project.*`
 * coverage family (`src/coverage/project-verb-coverage.ts`).
 *
 * Two files the browser cannot read for itself, and neither is served as part
 * of the project's asset tree: the project's `package.json` (the dev server
 * serves `public/`-scoped assets, and a root-level read there returns the SPA
 * fallback — the same trap that once hid `vgai.project.json` from a manifest
 * reader), and the resolved manifest's root adapters.
 *
 * FACTS ONLY. Nothing here decides whether a verb is present: it reports the
 * script names that exist and the adapter each root resolved to, and the pure
 * rules on the client turn those into rows. Keeping the verdict client-side is
 * what lets the whole table be unit-tested with no server, and keeps ONE place
 * to read when a row's wording is wrong.
 *
 * `scripts: null` is reserved for "this project has no package.json" — which is
 * a different answer from an empty scripts block, and the rules say so.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadGameManifestDir } from '@volter/editor-project/manifest/load-file';

export interface ProjectVerbRootFact {
  readonly id: string;
  readonly type: string;
  readonly identity: string;
}

export interface ProjectVerbFactsResponse {
  /** Script NAMES only — a command line is not a fact any row reads, and not
   *  something to hand a browser. `null` ⇒ the question could not be answered;
   *  `[]` with {@link ProjectVerbFactsResponse.hasPackageJson} `false` is the
   *  MEASURED answer "there is no package.json here", which is a different
   *  thing and produces a different row. */
  readonly scripts: readonly string[] | null;
  /** Whether a readable `package.json` exists at the project root. */
  readonly hasPackageJson: boolean;
  /** Dependency NAMES (runtime + dev, merged), on the same discipline as
   *  {@link ProjectVerbFactsResponse.scripts}: names are facts a row reads, a
   *  version range is not. `null` ⇒ the question could not be answered.
   *
   *  Read by the `system.*` family's DETECTOR half: a project that ships a
   *  physics library while nothing binds a physics adapter is a contradiction,
   *  and the host's "nothing built a physics world" inference is not safe to
   *  print as settled over it. */
  readonly dependencies: readonly string[] | null;
  /** Resolved manifest roots, or `null` when the manifest could not be read
   *  (which the client reports as unmeasured, never as a clean answer). */
  readonly roots: readonly ProjectVerbRootFact[] | null;
  /** Why a `null` above is null, in this module's own words. */
  readonly unavailable: string | null;
}

/** Read both facts for `projectRoot`. Never throws: every failure becomes a
 *  named `unavailable`, because "I could not look" is a real answer here and
 *  an exception would be reported as "no project" by the caller. */
export async function readProjectVerbFacts(
  projectRoot: string | null,
): Promise<ProjectVerbFactsResponse> {
  if (!projectRoot) {
    return {
      scripts: null,
      hasPackageJson: false,
      dependencies: null,
      roots: null,
      unavailable: 'no project folder is open, so there are no project files to read',
    };
  }
  const reasons: string[] = [];
  let scripts: readonly string[] | null = null;
  let dependencies: readonly string[] | null = null;
  let hasPackageJson = false;
  try {
    const parsed = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf-8')) as {
      scripts?: unknown;
      dependencies?: unknown;
      devDependencies?: unknown;
    };
    hasPackageJson = true;
    scripts =
      parsed.scripts && typeof parsed.scripts === 'object'
        ? Object.keys(parsed.scripts as Record<string, unknown>)
        : [];
    const names = new Set<string>();
    for (const block of [parsed.dependencies, parsed.devDependencies]) {
      if (block && typeof block === 'object') {
        for (const name of Object.keys(block as Record<string, unknown>)) names.add(name);
      }
    }
    dependencies = [...names];
  } catch (error) {
    // ENOENT is the MEASURED answer "this project has no package.json" — an
    // empty script set with `hasPackageJson: false`, which the rules report as
    // a real gap. Any OTHER failure (unreadable, malformed JSON) is a fact
    // nobody could read, and is named instead of being flattened into it.
    const code = (error as { code?: unknown }).code;
    if (code === 'ENOENT') {
      scripts = [];
      dependencies = [];
    } else {
      reasons.push(
        `this project's package.json could not be read (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
  let roots: readonly ProjectVerbRootFact[] | null = null;
  try {
    roots = loadGameManifestDir(projectRoot).roots.map((root) => ({
      id: root.id,
      type: root.adapter.type,
      identity: root.adapter.identity,
    }));
  } catch (error) {
    reasons.push(
      `this project's vgai.project.json could not be resolved (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  return {
    scripts,
    hasPackageJson,
    dependencies,
    roots,
    unavailable: reasons.length > 0 ? reasons.join('; ') : null,
  };
}
