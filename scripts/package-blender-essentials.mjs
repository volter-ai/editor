// Trigger: updating the Essentials assets shipped with the pinned Blender engine.
// Materialize assets/** with git-lfs first. Verify every byte against the public
// source tree's LFS oid before packaging; never ship pointer files as .blend files.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

const source = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: node scripts/package-blender-essentials.mjs <public-blender-checkout>');
const out = resolve('packages/blender-engine/wasm');
const bundle = JSON.parse(readFileSync(join(out, 'BUNDLE.json'), 'utf8'));
const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
if (git('rev-parse', 'HEAD') !== bundle.source) throw new Error('Blender checkout is not the engine source pin');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = [], chunks = [];
let offset = 0;
for (const path of git('ls-tree', '-r', '--name-only', 'HEAD', '--', 'assets').split('\n').sort()) {
  const bytes = readFileSync(join(source, path));
  const declared = execFileSync('git', ['-C', source, 'show', `HEAD:${path}`]);
  const pointer = /^version https:\/\/git-lfs.github.com\/spec\/v1\noid sha256:([a-f0-9]{64})\nsize (\d+)/.exec(declared.toString());
  if (pointer ? digest(bytes) !== pointer[1] || bytes.length !== Number(pointer[2]) : !bytes.equals(declared)) {
    throw new Error(`${path}: bytes do not match the pinned source (fetch and checkout its LFS object)`);
  }
  files.push({ path: path.slice('assets/'.length), offset, bytes: bytes.length, sha256: digest(bytes) });
  chunks.push(bytes);
  offset += bytes.length;
}
const payload = Buffer.concat(chunks);
writeFileSync(join(out, 'essentials.bin.br'), brotliCompressSync(payload, {
  params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
}));
writeFileSync(join(out, 'essentials.json'), JSON.stringify({
  sourceRepository: bundle.sourceRepository, source: bundle.source,
  license: 'CC0-1.0', licenseFile: 'LICENSE', bytes: payload.length,
  sha256: digest(payload), files,
}, null, 2) + '\n');
console.log(`Packaged ${files.length} pinned Essentials files (${payload.length} bytes)`);
