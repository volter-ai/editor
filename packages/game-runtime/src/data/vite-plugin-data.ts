/**
 * `vgaiDataCheck` — build-path validation for data assets and project tools (the
 * enforcement half of W5). A Vite plugin for the PROJECT's own `vite.config.ts`
 * (the template wires it; the editor dev server boots Vite from the ENGINE's
 * config and never runs this — its surface is covered by `vgai doctor` instead).
 * Build-only (`apply: 'build'`): in dev, `defineData`'s parse-on-load already
 * fails loud in the console.
 *
 * Three checks, all failing the build loud:
 *
 * 1. **Schema integrity** (`buildStart`): every registered asset's
 *    `.data.json` is read fresh from disk and validated through
 *    {@link parseDataJson} — the EXACT parse `defineData` runs at load (§9.1:
 *    an emitted-JSON-Schema validator here could disagree with runtime; the
 *    Zod schema itself never can). The schemas arrive EXECUTABLE because
 *    `vite.config.ts` statically imports the project's data-asset registry
 *    (`src/data/assets.ts` in the template) — Vite's config loader bundles
 *    config-relative TS imports, which is what makes this the one build-side
 *    place project Zod schemas can run.
 * 2. **Ref integrity** (`buildStart`): every `file#key(.field)*` string in
 *    every `src/data/*.data.json` (registered or not) must resolve — shared
 *    definition with `vgai doctor` via {@link findDanglingDataRefs}, so the
 *    two surfaces can never disagree about what "dangling" means. A second,
 *    narrower ref check runs alongside it for REGISTERED assets only: any
 *    field declared with `dataRef(target)` (`./data-ref.ts`) whose `target`
 *    names no asset currently on disk fails loud too (§9.4's "renamed the
 *    target file" hole, closed for declared refs — see
 *    `collectDeclaredRefFields`/`findMissingRefTargets` in `data-check-core.ts`).
 * 3. **Tools never ship** (`generateBundle`): no emitted chunk may contain a
 *    module from `src/contributions/`, `src/tools/` or a `*.tool.*` file (§4: tester serves and
 *    standalone builds strip tools entirely; W4 made this true by
 *    construction — nothing imports tools — and this check PINS it against
 *    the day some game module imports a tool "just for a helper").
 *
 * Unregistered data files (a `.data.json` with no entry in the passed
 * `assets` list) are a WARNING, not an error: they still get ref-integrity
 * and runtime parse-on-load, but no build-time schema check — the warning
 * names the registry file to fix.
 */

// Node built-ins are imported LAZILY (inside `collectDataCheckProblems`),
// never statically: this module is re-exported by the `@volter/game-runtime/config`
// barrel, which every project `*.schema.ts` reaches through its `data-ref`
// shim — so this module EVALUATES in the browser graph of any world whose
// schema the game imports. A static `import { … } from 'node:fs'` dies there
// ("Module node:fs has been externalized for browser compatibility") before
// the world can mount. The fs work itself only ever runs in Node (vite build
// / emit-schemas), where the dynamic import resolves normally.
import type { Plugin } from 'vite';
import type { z } from 'zod';
import { parseDataJson, toDataJsonSchema } from './data-asset';
import {
  collectDeclaredRefFields,
  findDanglingDataRefs,
  findMissingRefTargets,
} from './data-check-core';

/** One registered data asset: its executable Zod schema + the project-relative path of its `.data.json`. */
export interface DataCheckAsset {
  readonly schema: z.ZodType;
  /** e.g. `'src/data/tuning.data.json'` — read fresh from disk at buildStart. */
  readonly sourcePath: string;
}

export interface VgaiDataCheckOptions {
  readonly assets: readonly DataCheckAsset[];
  /** Project root the `sourcePath`s resolve against. Default: `process.cwd()` (vite build's cwd). */
  readonly root?: string;
}

/** The Node APIs the checks need, resolved lazily — see the import note above. */
interface NodeIo {
  readdirSync: typeof import('node:fs')['readdirSync'];
  readFileSync: typeof import('node:fs')['readFileSync'];
  statSync: typeof import('node:fs')['statSync'];
  join: typeof import('node:path')['join'];
  relative: typeof import('node:path')['relative'];
}

async function loadNodeIo(): Promise<NodeIo> {
  const [fs, path] = await Promise.all([import('node:fs'), import('node:path')]);
  return {
    readdirSync: fs.readdirSync,
    readFileSync: fs.readFileSync,
    statSync: fs.statSync,
    join: path.join,
    relative: path.relative,
  };
}

/** Recursively collect `*.data.json` under `dir` (absent dir → empty — a project with no data assets builds fine). */
function findDataFiles(io: NodeIo, dir: string): string[] {
  let entries: string[];
  try {
    entries = io.readdirSync(dir) as string[];
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = io.join(dir, entry);
    if (io.statSync(full).isDirectory()) out.push(...findDataFiles(io, full));
    else if (entry.endsWith('.data.json')) out.push(full);
  }
  return out;
}

/** `src/data/tuning.data.json` → `tuning` (normalizing either slash direction). */
function assetStem(sourcePath: string): string {
  const rel = sourcePath.split('\\').join('/');
  return (
    rel
      .split('/')
      .pop()
      ?.replace(/\.data\.json$/, '') ?? rel
  );
}

/**
 * Parse every data file in the project once — the registered subset gets
 * schema validation, the whole set feeds ref integrity. Unparseable files
 * become errors; unregistered files become warnings naming the registry.
 *
 * DUPLICATE-STEM GUARD: `findDataFiles` walks `src/data/` recursively, so two
 * files in different subdirectories can share a stem (e.g.
 * `src/data/enemies.data.json` and `src/data/legacy/enemies.data.json`) — the
 * exact identity `file#key` refs AND the registry's `sourcePath` lookup both
 * address by stem alone (§2.2). Without this guard `parsedByStem.set` would
 * silently last-wins the collision, and check 1 below could validate a
 * REGISTERED asset's schema against a totally unrelated file's JSON. Detected
 * here (one error per colliding path, naming every path) and excluded from
 * `parsedByStem` entirely — any resolution against a duplicate stem would be
 * an arbitrary, possibly-wrong pick, so neither check 1 nor check 2 (ref
 * integrity) resolves anything through it once it's flagged.
 */
interface ParsedDataFiles {
  parsedByStem: Map<string, unknown>;
  /** Stems the duplicate-stem guard already flagged — check 1 skips its own
   *  redundant "not found on disk" for these (the duplicate-stem error
   *  already explains why the stem has no single resolvable payload). */
  ambiguousStems: Set<string>;
}

function parseAllDataFiles(
  io: NodeIo,
  root: string,
  registered: ReadonlySet<string>,
  errors: string[],
  warnings: string[],
): ParsedDataFiles {
  const parsedByStem = new Map<string, unknown>();
  const pathsByStem = new Map<string, string[]>();
  for (const abs of findDataFiles(io, io.join(root, 'src', 'data'))) {
    const rel = io.relative(root, abs).split('\\').join('/');
    const stem = assetStem(rel);
    const paths = pathsByStem.get(stem);
    if (paths) paths.push(rel);
    else pathsByStem.set(stem, [rel]);

    try {
      parsedByStem.set(stem, JSON.parse(io.readFileSync(abs, 'utf-8') as string));
    } catch (err) {
      errors.push(
        `"${rel}" is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (!registered.has(rel)) {
      warnings.push(
        `"${rel}" is not registered in the data-asset registry (src/data/assets.ts), so it gets ` +
          'no build-time schema check (runtime parse-on-load still applies). Register it there — ' +
          'the template ships the worked example.',
      );
    }
  }

  const ambiguousStems = new Set<string>();
  for (const [stem, paths] of pathsByStem) {
    if (paths.length < 2) continue;
    ambiguousStems.add(stem);
    errors.push(
      `asset stem "${stem}" is claimed by ${paths.length} files (${paths.join(', ')}) — ` +
        '"file#key" refs and the data-asset registry address a file by its stem alone (§2.2), so ' +
        'this is an unresolvable identity collision. Rename one — asset stems must be unique ' +
        'across the whole project, not just per directory.',
    );
    parsedByStem.delete(stem); // arbitrary otherwise — neither check below may resolve through it
  }

  return { parsedByStem, ambiguousStems };
}

/**
 * The fs half of checks 1 + 2, extracted from the plugin hook so it is
 * directly unit-testable against a fixture folder (no rollup context needed).
 */
export async function collectDataCheckProblems(options: VgaiDataCheckOptions): Promise<{
  errors: string[];
  warnings: string[];
}> {
  const io = await loadNodeIo();
  const root = options.root ?? process.cwd();
  const errors: string[] = [];
  const warnings: string[] = [];
  const registered = new Set(options.assets.map((a) => a.sourcePath.split('\\').join('/')));
  const { parsedByStem, ambiguousStems } = parseAllDataFiles(
    io,
    root,
    registered,
    errors,
    warnings,
  );

  // Check 1 — registered assets validate through the exact runtime parse.
  for (const asset of options.assets) {
    const rel = asset.sourcePath.split('\\').join('/');
    if (!parsedByStem.has(assetStem(rel))) {
      // An AMBIGUOUS stem already has its own duplicate-stem error above,
      // which fully explains why there's no single payload to validate
      // against — a second "not found on disk" here would just be
      // confusing noise about a file that plainly IS on disk.
      if (!ambiguousStems.has(assetStem(rel))) {
        errors.push(
          `registered data asset "${rel}" was not found on disk — fix the path in the registry ` +
            '(src/data/assets.ts) or restore the file.',
        );
      }
      continue;
    }
    try {
      parseDataJson(asset.schema, parsedByStem.get(assetStem(rel)), rel);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  // Check 2 — no dangling refs anywhere.
  for (const dangling of findDanglingDataRefs(parsedByStem)) {
    errors.push(
      `dangling data ref in "src/data/${dangling.inAsset}.data.json" at ${dangling.atPath}: ` +
        `"${dangling.ref}" — "${dangling.missingSegment}" does not exist in ` +
        `src/data/${dangling.targetAsset}.data.json. Fix the key or remove the ref ` +
        '(refs are "file#key" strings).',
    );
  }

  // Check 2b — every declared `dataRef(target)` field (registered assets
  // only, same set check 1 already validates) must name a target that's
  // actually on disk — the §9.4 fix: this fires even if NO current value
  // happens to look like a ref, unlike check 2 above (see
  // `data-check-core.ts`'s module doc).
  const assetNames = new Set(parsedByStem.keys());
  for (const asset of options.assets) {
    const rel = asset.sourcePath.split('\\').join('/');
    const declared = collectDeclaredRefFields(toDataJsonSchema(asset.schema));
    for (const missing of findMissingRefTargets(declared, assetNames)) {
      errors.push(
        `"${rel}" declares field "${missing.fieldPath}" as dataRef('${missing.targetStem}'), but ` +
          `no "src/data/${missing.targetStem}.data.json" exists. Restore/rename the target file, ` +
          `or update the dataRef('${missing.targetStem}') call in the schema.`,
      );
    }
  }

  return { errors, warnings };
}

/** True iff a bundled module id is tool code that must never ship (§4). Pure, unit-tested. */
export function isToolModuleId(id: string): boolean {
  const normalized = id.split('\\').join('/');
  return (
    /\/src\/(?:tools|contributions)\//.test(normalized) || /\.tool\.[tj]sx?(\?|$)/.test(normalized)
  );
}

/**
 * Build-path validation plugin — see the module doc. Wire it in the project's
 * `vite.config.ts`, passing the data-asset registry:
 *
 * ```ts
 * import { vgaiDataCheck } from './vite-plugin-data';
 * import { dataAssets } from './src/data/assets';
 * export default defineConfig({
 *   plugins: [vgaiDataCheck({
 *     root: __dirname,
 *     assets: dataAssets.map((a) => ({ schema: a.schema, sourcePath: `src/data/${a.name}.data.json` })),
 *   })],
 * });
 * ```
 */
export function vgaiDataCheck(options: VgaiDataCheckOptions): Plugin {
  return {
    name: 'vgai:data-check',
    apply: 'build',
    async buildStart() {
      const { errors, warnings } = await collectDataCheckProblems(options);
      for (const warning of warnings) this.warn(warning);
      if (errors.length > 0) {
        // ONE error carrying every problem — fail loud with the full picture,
        // not a fix-one-rebuild-see-the-next loop.
        this.error(
          `data-asset validation failed (${errors.length} problem${errors.length === 1 ? '' : 's'}` +
            `):\n${errors.map((e) => `  - ${e}`).join('\n')}`,
        );
      }
    },
    generateBundle(_outputOptions, bundle) {
      const leaked = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const id of Object.keys(output.modules)) {
          if (isToolModuleId(id)) leaked.add(id.split('\\').join('/'));
        }
      }
      if (leaked.size > 0) {
        this.error(
          'project tool code reached the game build — tools are editor-only and must never ship ' +
            'to players. Remove every game-code import of these ' +
            `modules (tools may import game code, never the reverse):\n${[...leaked]
              .map((id) => `  - ${id}`)
              .join('\n')}`,
        );
      }
    },
  };
}
