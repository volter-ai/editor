import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ASSET_CONTENT_EXTENSIONS, validateAssetContentFile } from './validate-asset-content';

// ---------------------------------------------------------------------------
// Usage: npx tsx validate-assets.ts [folder]
//
// Content-parses every fetched-asset file under <folder>/public/ through the
// engine's own Zod schema — the same one the runtime rejects a malformed
// input map with, so a present-but-invalid `.inputmap.json` fails here instead
// of at load. Defaults to the current
// working directory.
//
// Shipped IN the project template so every scaffolded game gets a working
// `npm run validate-assets`; the engine is imported via the published
// the runtime packages' subpath exports, which resolve in both this monorepo and a
// generated project.
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const rootDir = resolve(args[0] ?? '.');
const publicDir = join(rootDir, 'public');

if (!existsSync(publicDir)) {
  console.error(`No public/ directory found in ${rootDir}`);
  process.exit(1);
}

function collectFiles(dir: string, ext: string): string[] {
  const result: string[] = [];
  if (!existsSync(dir)) return result;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      result.push(...collectFiles(full, ext));
    } else if (entry.endsWith(ext)) {
      result.push(full);
    }
  }
  return result;
}

const errors: string[] = [];
const assetContentFiles = ASSET_CONTENT_EXTENSIONS.flatMap((ext) => collectFiles(publicDir, ext));
for (const path of assetContentFiles) {
  errors.push(...validateAssetContentFile(path));
}

if (errors.length > 0) {
  console.error(`Asset validation failed with ${errors.length} error(s):\n`);
  for (const err of errors) {
    console.error(`  ${err}`);
  }
  process.exit(1);
} else {
  console.log(
    `Validated ${assetContentFiles.length} asset file(s) ` +
      `(.inputmap.json) in ${rootDir} — all OK`,
  );
}
