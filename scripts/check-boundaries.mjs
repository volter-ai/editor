// Trigger: a commit that stages package source (.githooks/pre-commit). The reverse
// dependency edges ARCHITECTURE.md §The plan removes, frozen by exact importing file and
// imported module (type-only and lazy imports included): the baseline may only shrink.
// A new edge refuses the commit; a removed edge is written out of the baseline and staged.
//
//   node scripts/check-boundaries.mjs          check, shrinking the baseline
//   node scripts/check-boundaries.mjs --init   write the baseline from the tree
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const BASELINE = 'release/boundary-baseline.json';
const SKIP = new Set(['node_modules', 'dist', 'dist-node', 'dist-server', '.artifacts', 'template', 'catalog', 'starter']);
const KIT = ['packages/editor-core', 'packages/editor-sdk', 'packages/editor-project'];
const RUNTIMES = ['packages/game-runtime', 'packages/threejs-runtime'];
const MEDIA = /^(three(\/|$)|@react-three\/|pixi\.js|@pixi\/|@volter\/(editor-threejs|blender-engine|editor-blender|threejs-runtime|game-runtime|editor-game|editor-react|editor-xstate|model-editor|game-editor)(\/|$))/;

const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|mts|mjs)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(path);
  }
  return out;
};
// Comments are not imports: a doc comment quoting `from 'three'` is not an edge.
const withoutComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const specifiers = (code) =>
  [...withoutComments(code).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm)].map((m) => m[1]);

const edges = new Set();
for (const pkg of readdirSync(join(root, 'packages'))) {
  const dir = `packages/${pkg}`;
  for (const file of walk(join(root, dir))) {
    const rel = relative(root, file);
    const code = readFileSync(file, 'utf8');
    for (const spec of specifiers(code)) {
      if (KIT.includes(dir) && MEDIA.test(spec)) edges.add(`kit-media  ${rel} -> ${spec}`);
      if (dir !== 'packages/editor-core' && spec.startsWith('@volter/editor-core/')) edges.add(`kit-internal  ${rel} -> ${spec}`);
      if (RUNTIMES.includes(dir) && /^@volter\/editor-/.test(spec)) edges.add(`runtime-editor  ${rel} -> ${spec}`);
    }
  }
}

if (process.argv.includes('--init')) {
  writeFileSync(BASELINE, JSON.stringify([...edges].sort(), null, 1) + '\n');
  console.log(`boundary baseline written: ${edges.size} edges.`);
  process.exit(0);
}
const baseline = new Set(JSON.parse(readFileSync(BASELINE, 'utf8')));
const added = [...edges].filter((edge) => !baseline.has(edge));
const removed = [...baseline].filter((edge) => !edges.has(edge));
if (added.length > 0) {
  console.error(`New reverse edges (ARCHITECTURE.md §The plan; the baseline only shrinks):\n  ${added.join('\n  ')}`);
  process.exit(1);
}
if (removed.length > 0) {
  writeFileSync(BASELINE, JSON.stringify([...edges].sort(), null, 1) + '\n');
  execFileSync('git', ['add', BASELINE]);
  console.log(`boundary baseline shrank by ${removed.length} to ${edges.size} edges.`);
} else {
  console.log(`boundary baseline holds (${edges.size} edges).`);
}
