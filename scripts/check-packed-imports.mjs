// Run after building release packages. Inspect npm's actual packed file list,
// including declarations and bundles; source-tree success alone is insufficient.
import { execFileSync } from 'node:child_process';
import { isBuiltin } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const release = new Set(JSON.parse(readFileSync(join(root, 'release/modeling.json'))).packages);
const failures = new Set();
let fileCount = 0;
for (const folder of readdirSync(join(root, 'packages'))) {
  const directory = join(root, 'packages', folder);
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json')));
  if (!release.has(manifest.name)) continue;
  const declared = new Set([manifest.name, ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]);
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
  for (const { path } of packed.files) {
    if (!/\.(?:[cm]?[jt]s|tsx|jsx)$/.test(path)) continue;
    fileCount++;
    const source = ts.createSourceFile(path, readFileSync(join(directory, path), 'utf8'), ts.ScriptTarget.Latest, true);
    function check(specifier) {
      if (Object.hasOwn(manifest.imports ?? {}, specifier)) return;
      if (specifier.startsWith('.') || specifier.startsWith('/') || isBuiltin(specifier)) return;
      // Build-time virtual modules and the documented core source alias are
      // resolved by the product build, not by npm's package resolver.
      if (specifier.startsWith('@editor/') || specifier.startsWith('vgai:') || specifier.startsWith('\0')) return;
      if (/^(https?:|data:)/.test(specifier)) return;
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      if (name.startsWith('@vgai/') || (name.startsWith('@volter/') && !release.has(name)))
        failures.add(`${manifest.name}/${path}: excluded package ${specifier}`);
      else if (!declared.has(name)) failures.add(`${manifest.name}/${path}: undeclared import ${specifier}`);
    }
    function visit(node) {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
      else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && ['require', '__require'].includes(node.expression.text)))) specifier = node.arguments[0];
      if (specifier && ts.isStringLiteralLike(specifier)) check(specifier.text);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
if (failures.size) {
  console.error([...failures].join('\n'));
  process.exitCode = 1;
} else console.log(`Packed import declarations: ${fileCount} source/declaration/bundle files across ${release.size} packages. Nonliteral loading, assets and licenses require separate review.`);
