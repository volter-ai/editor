// Run after building release packages: `node scripts/check-packed-imports.mjs
// [list]`, default release/modeling.json. Inspect npm's actual packed file list,
// including declarations and bundles; source-tree success alone is insufficient.
import { execFileSync } from 'node:child_process';
import { isBuiltin } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [list = 'release/modeling.json', ...only] = process.argv.slice(2);
const selected = new Set(only);
const release = new Set(JSON.parse(readFileSync(join(root, list))).packages);
// This repository's own packages: one outside the release list is excluded from it. Other
// @volter packages (Volter Harness's) are ordinary dependencies.
const own = new Set(readdirSync(join(root, 'packages'))
  .filter((folder) => existsSync(join(root, 'packages', folder, 'package.json')))
  .map((folder) => JSON.parse(readFileSync(join(root, 'packages', folder, 'package.json'))).name));
const failures = new Set();
for (const name of selected) if (!release.has(name)) throw new Error(`Package ${name} is outside ${list}`);
let fileCount = 0;
let packageCount = 0;
for (const folder of readdirSync(join(root, 'packages'))) {
  const directory = join(root, 'packages', folder);
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json')));
  if (!release.has(manifest.name) || (selected.size && !selected.has(manifest.name))) continue;
  packageCount++;
  const declared = new Set([manifest.name, ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]);
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
  const paths = packed.files.map(({ path }) => path);
  const readJson = path => JSON.parse(readFileSync(join(directory, path), 'utf8'));
  const names = manifest => ['dependencies', 'devDependencies', 'optionalDependencies']
    .flatMap(field => Object.keys(manifest?.[field] ?? {}));
  // PROJECT TREES a product ships for its scaffolder to copy into a new
  // project resolve their imports through THAT project's manifest, not the
  // product's: a packed directory with its own package.json (the template) is
  // one; a catalog's `project-source/` lands in a project begun from that
  // template, which also gains the declaring entry's `packageJson` and those
  // of the entries it `requires`. A vendored package's peers resolve through
  // the enclosing package, so they count only where it declares them.
  const projects = paths.filter(path => /\/package\.json$/.test(path)).map(path => {
    const nested = readJson(path);
    return { prefix: path.slice(0, -'package.json'.length), declared: new Set([...names(nested),
      ...Object.keys(nested.peerDependencies ?? {}).filter(name => declared.has(name))]) };
  })
    .sort((a, b) => b.prefix.length - a.prefix.length);
  const template = projects.find(project => project.prefix === 'template/');
  // An addition's files are merged into a project begun from the template, so
  // they also resolve through the template's declarations.
  if (template) for (const project of projects.filter(project => project.prefix.startsWith('additions/')))
    for (const name of template.declared) project.declared.add(name);
  const entries = new Map(paths.filter(path => /(^|\/)catalog\/entries\/[^/]+\.json$/.test(path))
    .map(path => readJson(path)).map(entry => [entry.id, entry]));
  function catalogDeclared(path) {
    const [catalog, file] = path.split('project-source/');
    if (catalog !== 'catalog/' || !file || !template) return undefined;
    const declared = new Set(template.declared);
    const pending = [...entries.values()].filter(entry => entry.files?.includes(file)).map(entry => entry.id);
    for (const seen = new Set(); pending.length;) {
      const entry = entries.get(pending.pop());
      if (!entry || seen.has(entry.id)) continue;
      seen.add(entry.id);
      for (const name of names(entry.packageJson)) declared.add(name);
      pending.push(...(entry.requires ?? []));
    }
    return declared;
  }
  for (const path of paths) {
    if (!/\.(?:[cm]?[jt]s|tsx|jsx)$/.test(path)) continue;
    fileCount++;
    const project = projects.find(project => path.startsWith(project.prefix))?.declared ?? catalogDeclared(path);
    const source = ts.createSourceFile(path, readFileSync(join(directory, path), 'utf8'), ts.ScriptTarget.Latest, true);
    function check(specifier) {
      if (!project && Object.hasOwn(manifest.imports ?? {}, specifier)) return;
      if (specifier.startsWith('.') || specifier.startsWith('/') || isBuiltin(specifier)) return;
      // Build-time virtual modules and the documented core source alias are
      // resolved by the product build, not by npm's package resolver.
      if (specifier.startsWith('@editor/') || /^(?:volter|virtual):/.test(specifier) || specifier.startsWith('\0')) return;
      if (/^(https?:|data:)/.test(specifier)) return;
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      if (own.has(name) && !release.has(name))
        failures.add(`${manifest.name}/${path}: excluded package ${specifier}`);
      else if (!(project ?? declared).has(name)) failures.add(`${manifest.name}/${path}: undeclared import ${specifier}`);
    }
    // Iterative: a minified bundle's long operator chains overflow a recursive walk.
    for (const pending = [source]; pending.length;) {
      const node = pending.pop();
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
      else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && ['require', '__require'].includes(node.expression.text)))) specifier = node.arguments[0];
      if (specifier && ts.isStringLiteralLike(specifier)) check(specifier.text);
      ts.forEachChild(node, child => { pending.push(child); });
    }
  }
}
if (failures.size) {
  console.error([...failures, `Packed import declarations of ${list}: ${failures.size} findings.`].join('\n'));
  process.exitCode = 1;
} else console.log(`Packed import declarations of ${list}: ${fileCount} source/declaration/bundle files across ${packageCount} packages. Nonliteral loading, assets and licenses require separate review.`);
