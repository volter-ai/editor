import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameManifestFile } from '@volter/editor-project/manifest/load-file';

// ---------------------------------------------------------------------------
// Usage: npx tsx validate-manifest.ts [manifestPath...]
//
// Single source of truth for game-manifest validation, shipped IN the
// project template (mirrors validate-assets.ts) so every scaffolded game
// gets a working `npm run validate-manifest`. Validates each given
// `vgai.project.json` path via `loadGameManifestFile` (parse -> cross-field
// checks -> resolution) and prints the
// resolved adapter-root list (id, adapter identity) on success. Any failure
// prints a descriptive error and
// exits 1.
//
// Defaults to THIS template's own manifest (`vgai.project.json`, a sibling of
// this script) when no path is given, so `npm run validate-manifest` works
// out of the box both from the monorepo root and from a scaffolded project.
// ---------------------------------------------------------------------------

const defaultManifestPath = fileURLToPath(new URL('./vgai.project.json', import.meta.url));

const args = process.argv.slice(2);
const manifestPaths = args.length > 0 ? args.map((p) => resolve(p)) : [defaultManifestPath];

let hadError = false;

for (const manifestPath of manifestPaths) {
  try {
    const resolved = loadGameManifestFile(manifestPath);
    console.log(
      `${manifestPath}: OK — "${resolved.name}" v${resolved.version} (engine ${resolved.engine.version})`,
    );
    for (const root of resolved.roots) {
      const { adapter } = root;
      const adapterLabel =
        adapter.type === 'ingest' ? `${adapter.identity} (${adapter.strategy})` : adapter.identity;
      console.log(`  root "${root.id}" adapter=${adapterLabel}`);
    }
  } catch (e) {
    hadError = true;
    console.error(`${manifestPath}: FAILED`);
    console.error(`  ${e instanceof Error ? e.message : String(e)}`);
  }
}

if (hadError) {
  process.exit(1);
} else {
  console.log(`Validated ${manifestPaths.length} manifest(s) — all OK`);
}
