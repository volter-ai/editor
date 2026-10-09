#!/usr/bin/env node
// Install THIS checkout's built packages into a project, so the project runs exactly what was built:
//
//   npm run build:playable && node scripts/install-local-build.mjs <project dir> [release/playable.json]
//
// WHY A SCRIPT: done by hand (npm pack each package, point the project's package.json at the
// tarballs, npm install), npm silently KEEPS the copy it already installed whenever the version
// number did not change, because the lockfile and node_modules both say that version is present.
// The project then runs the previous build while every step reported success (measured
// 2026-10-08: two "fixed" test runs were the old code until node_modules/@volter was deleted).
// So this packs fresh tarballs, removes the installed copies of exactly those packages and the
// lockfile, installs, and then CHECKS that each installed package is the one just packed.
//
// It also moves the project's engine pin (volter.project.json engine.version) to the packed
// @volter/editor-core version, which `edit` otherwise refuses as a mismatch.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

/** One file out of an npm tarball, read here rather than by a `tar` binary (Git Bash's GNU tar
 *  reads `C:` in a Windows path as a remote host). */
function tarballFile(tarball, wantedPath) {
  const data = gunzipSync(readFileSync(tarball));
  for (let at = 0; at + 512 <= data.length;) {
    const name = data.toString('utf8', at, at + 100).replace(/\0.*$/s, '');
    if (!name) break;
    const size = parseInt(data.toString('utf8', at + 124, at + 136).replace(/\0.*$/s, '').trim() || '0', 8);
    if (name === wantedPath) return data.toString('utf8', at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${tarball} has no ${wantedPath}`);
}

const [projectArg, manifestArg = 'release/playable.json'] = process.argv.slice(2);
if (!projectArg) {
  console.error('Usage: node scripts/install-local-build.mjs <project dir> [release/<list>.json]');
  process.exit(1);
}
const repo = resolve(import.meta.dirname, '..');
const project = resolve(projectArg);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args, cwd) => execFileSync(npm, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });

const wanted = JSON.parse(readFileSync(resolve(repo, manifestArg), 'utf8')).packages;
const dirs = new Map();
for (const dir of readdirSync(join(repo, 'packages'))) {
  const file = join(repo, 'packages', dir, 'package.json');
  if (!existsSync(file)) continue;
  const name = JSON.parse(readFileSync(file, 'utf8')).name;
  if (wanted.includes(name)) dirs.set(name, join(repo, 'packages', dir));
}
const missing = wanted.filter((name) => !dirs.has(name));
if (missing.length) throw new Error(`${manifestArg} names packages this checkout has no folder for: ${missing.join(', ')}`);

// 1. Fresh tarballs, and only these.
const out = join(project, '.volter', 'local-build');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const packed = new Map(); // name -> { file, version, sha }
for (const [name, dir] of dirs) {
  const file = run(['pack', '--silent', '--pack-destination', out], dir).trim().split(/\r?\n/).pop();
  const version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
  const sha = createHash('sha256').update(readFileSync(join(out, file))).digest('hex');
  packed.set(name, { file, version, sha });
}

// 2. The project's dependencies and overrides point at them (overrides, so a transitive @volter
//    dependency resolves to the same tarball instead of the registry's copy).
const pkgPath = join(project, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const spec = (name) => `file:${relative(project, join(out, packed.get(name).file)).replaceAll('\\', '/')}`;
for (const section of ['dependencies', 'devDependencies']) {
  for (const name of Object.keys(pkg[section] ?? {})) if (packed.has(name)) pkg[section][name] = spec(name);
}
pkg.overrides = { ...(pkg.overrides ?? {}) };
for (const name of packed.keys()) pkg.overrides[name] = spec(name);
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// 3. The engine pin follows the packed editor.
const manifestPath = join(project, 'volter.project.json');
const core = packed.get('@volter/editor-core');
if (core && existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.engine && manifest.engine.version !== core.version) {
    console.log(`engine pin ${manifest.engine.version} -> ${core.version}`);
    manifest.engine.version = core.version;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
}

// 4. No copy npm could keep: the installed packages and the lockfile go, then install.
for (const name of packed.keys()) rmSync(join(project, 'node_modules', ...name.split('/')), { recursive: true, force: true });
rmSync(join(project, 'package-lock.json'), { force: true });
run(['install', '--no-audit', '--no-fund'], project);

// 5. Check what landed: each installed package must carry the packed version, and its files must
//    be the packed ones (compared by the installed package.json against the tarball's).
const stale = [];
for (const [name, { version, file }] of packed) {
  const installed = join(project, 'node_modules', ...name.split('/'), 'package.json');
  if (!existsSync(installed)) { stale.push(`${name}: not installed`); continue; }
  const got = JSON.parse(readFileSync(installed, 'utf8')).version;
  if (got !== version) stale.push(`${name}: installed ${got}, packed ${version}`);
  const inTarball = tarballFile(join(out, file), 'package/package.json');
  if (JSON.parse(inTarball).version !== got || readFileSync(installed, 'utf8').trim() !== inTarball.trim()) {
    stale.push(`${name}: installed package.json differs from ${file}`);
  }
}
if (stale.length) throw new Error(`The project did not get this build:\n  ${stale.join('\n  ')}`);
console.log(`Installed ${packed.size} packages from this checkout into ${project}:`);
for (const [name, { version, sha }] of packed) console.log(`  ${name}@${version}  ${sha.slice(0, 12)}`);
