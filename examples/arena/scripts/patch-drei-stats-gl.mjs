import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, parse, resolve } from 'node:path';

const upstreamRange = '^2.2.8';
const compatibleRange = '^2.2.8 || ^4.2.3';
let searchRoot = process.cwd();
let packagePath;

while (true) {
  const candidate = resolve(searchRoot, 'node_modules/@react-three/drei/package.json');
  if (existsSync(candidate)) {
    packagePath = candidate;
    break;
  }
  const parent = dirname(searchRoot);
  if (parent === searchRoot || parse(searchRoot).root === searchRoot) break;
  searchRoot = parent;
}

if (!packagePath) {
  throw new Error(
    'Cannot find installed @react-three/drei package to validate stats-gl compatibility.',
  );
}

const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
const currentRange = packageJson.dependencies?.['stats-gl'];
if (currentRange !== upstreamRange && currentRange !== compatibleRange) {
  throw new Error(`Unexpected @react-three/drei stats-gl range: ${String(currentRange)}`);
}

if (currentRange === upstreamRange) {
  packageJson.dependencies['stats-gl'] = compatibleRange;
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}
