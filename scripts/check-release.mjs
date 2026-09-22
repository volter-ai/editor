// Validate the public modeling package boundary. Corresponding source, packed
// assets and installed acceptance remain separate release gates.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const { packages } = read('release/modeling.json');
assert.equal(new Set(packages).size, packages.length, 'Duplicate release package');
const manifests = new Map(readdirSync(join(root, 'packages')).map(folder => {
  const manifest = read(`packages/${folder}/package.json`);
  return [manifest.name, { manifest, folder }];
}));
for (const name of packages) {
  const entry = manifests.get(name);
  assert.ok(entry, `Release package ${name} is missing`);
  const { manifest, folder } = entry;
  assert.ok(name.startsWith('@volter/'), `${name} is outside the public @volter scope`);
  assert.notEqual(manifest.private, true, `${name} is still private`);
  assert.equal(manifest.publishConfig?.access, 'public', `${name} is not configured for public access`);
  assert.ok(manifest.license, `${name} has no declared license`);
  assert.ok(existsSync(join(root, 'packages', folder, 'LICENSE')), `${name} has no LICENSE`);
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [dependency, version] of Object.entries(manifest[field] ?? {})) {
      assert.ok(!dependency.startsWith('@vgai/'), `${name} retains ${dependency}`);
      if (manifests.has(dependency) || dependency.startsWith('@volter/')) {
        assert.ok(packages.includes(dependency), `${name} reaches excluded package ${dependency}`);
        if (!(field === 'peerDependencies' && version === '*')) {
          assert.equal(version, manifests.get(dependency)?.manifest.version,
            `${name} must pin the release version of ${dependency}`);
        }
      }
      assert.ok(!/^(file:|link:|workspace:)/.test(version), `${name} has local dependency ${dependency}`);
    }
  }
}
console.log(`Modeling manifest boundary: ${packages.length} packages. Packed-code and release acceptance remain separate checks.`);
