// The served-bundle runtime table answers the bare imports of a game served as
// a bundle. It is DERIVED: the packages the game template and the catalog's
// capabilities import, plus the runtime packages it resolves by glob. This
// check fails naming each package the table is missing or no longer needs.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const product = join(root, 'packages/game-editor');
const tablePath = join(root, 'packages/editor-game/src/host/served-bundle-runtime-modules.ts');
const packageOf = (specifier) =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];

const imported = new Set();
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(tsx?|mts|jsx?)$/.test(entry.name)) {
      // Statements only: the word "from" before a quote in prose or a message is not an import.
      const source = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const statements = /^\s*(?:import|export)\b[^'"`;]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/gm;
      for (const match of source.matchAll(statements)) {
        const specifier = match[1] ?? match[2] ?? match[3];
        if (/^(\.|\/|node:|virtual:)/.test(specifier) || !/^[@a-z][\w@.-]+/.test(specifier)) continue;
        imported.add(packageOf(specifier));
      }
    }
  }
};
walk(join(product, 'template'));
walk(join(product, 'catalog/project-source'));
// The template's and each capability's declared runtime dependencies are imports a project may make.
for (const name of Object.keys(JSON.parse(readFileSync(join(product, 'template/package.json'), 'utf8')).dependencies ?? {})) {
  imported.add(name);
}
for (const file of readdirSync(join(product, 'catalog/entries'))) {
  const entry = JSON.parse(readFileSync(join(product, 'catalog/entries', file), 'utf8'));
  for (const name of Object.keys(entry.packageJson?.dependencies ?? {})) imported.add(name);
}

const table = readFileSync(tablePath, 'utf8');
const start = table.indexOf('export const BUNDLE_RUNTIME_MODULE_LOADERS');
const body = table.slice(start, table.indexOf('\n};', start));
const loaded = new Set(
  [...body.matchAll(/^\s*(?:'([^']+)'|([A-Za-z_$][\w$]*)):\s*\(\)\s*=>/gm)].map((m) => packageOf(m[1] ?? m[2])),
);

// Resolved by the table's own glob family, not by entries.
const RUNTIME_PACKAGES = new Set(['@volter/editor-project', '@volter/threejs-runtime', '@volter/game-runtime']);
// Imported by project code that never runs in a served bundle: the dev server,
// the game's own Node server, the editor product and its tooling.
const NOT_SERVED = new Set([
  'vite', 'colyseus', '@colyseus/ws-transport', '@pm2/io', 'ztrack',
  '@volter/game-live', '@volter/editor-blender', '@volter/blender-engine',
  // A piece is authored in the editor and ships as its render (OGG), never as code.
  '@volter/dawproject', '@volter/editor-dawproject',
]);

const missing = [...imported].filter((name) => !loaded.has(name) && !RUNTIME_PACKAGES.has(name) && !NOT_SERVED.has(name));
const unused = [...loaded].filter(
  (name) => !imported.has(name) && !name.startsWith('@volter/editor-sdk') && name !== '@editor/game-module-access',
);
if (missing.length || unused.length) {
  if (missing.length) console.error(`served-bundle table lacks what projects import: ${missing.sort().join(', ')}`);
  if (unused.length) console.error(`served-bundle table serves what no project imports: ${unused.sort().join(', ')}`);
  process.exit(1);
}
console.log(`served-bundle table matches the template and catalog (${loaded.size} packages).`);

// THE RUNTIME IMAGE carries a game's full runtime set: a game links the
// product's install as its node_modules (packages/game-editor/node/runtime-image.ts),
// so the product must depend on everything the template and the catalog declare.
const productManifest = JSON.parse(readFileSync(join(product, 'package.json'), 'utf8'));
const templateManifest = JSON.parse(readFileSync(join(product, 'template/package.json'), 'utf8'));
const declared = new Set([
  ...Object.keys(templateManifest.dependencies ?? {}),
  ...Object.keys(templateManifest.devDependencies ?? {}),
]);
for (const file of readdirSync(join(product, 'catalog/entries'))) {
  const entry = JSON.parse(readFileSync(join(product, 'catalog/entries', file), 'utf8'));
  for (const name of Object.keys(entry.packageJson?.dependencies ?? {})) declared.add(name);
}
declared.delete(productManifest.name);
const carried = new Set(Object.keys(productManifest.dependencies ?? {}));
const absent = [...declared].filter((name) => !carried.has(name));
if (absent.length) {
  console.error(`the runtime image (the product's dependencies) lacks what games declare: ${absent.sort().join(', ')}`);
  process.exit(1);
}
console.log(`runtime image carries every template and catalog dependency (${declared.size}).`);
