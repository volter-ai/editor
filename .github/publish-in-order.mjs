// Publish the release's new packages so `latest` never names a tree npm cannot install. Run by
// the publish workflow with the new package directories as arguments:
//
//   node .github/publish-in-order.mjs <dir>…            publish, dependencies first
//   node .github/publish-in-order.mjs --served <dir>…   only wait until each is served
//
// A package is published only after every package it depends on that this run publishes is
// SERVED: the registry answers its exact version AND its tarball downloads. Both are checked
// because they diverge: on 2026-10-06 npm listed @volter/blender-engine@0.1.122 (published
// 18:06:57Z) while its tarball answered 404 for minutes, and @volter/model-editor@0.5.185,
// published right after it and already `latest`, could not be installed. A dependency that is
// not served within the bound stops the run before its dependents are published.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WAIT_MS = 20 * 60_000;
const POLL_MS = 15_000;
const servedOnly = process.argv[2] === '--served';
const dirs = process.argv.slice(process.argv[2]?.startsWith('--') ? 3 : 2);
const manifest = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
const packages = new Map(dirs.map((dir) => { const m = manifest(dir); return [m.name, { dir, name: m.name, version: m.version, manifest: m }]; }));
const spec = (pkg) => `${pkg.name}@${pkg.version}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The packages this run publishes that `pkg` depends on (any dependency field). */
function releasedDependencies(pkg) {
  const m = pkg.manifest;
  const names = new Set(Object.keys({ ...m.dependencies, ...m.peerDependencies, ...m.optionalDependencies }));
  return [...names].filter((name) => name !== pkg.name && packages.has(name)).map((name) => packages.get(name));
}

/** Dependencies before dependents; a cycle keeps the release list's own order for its members. */
function ordered() {
  const out = [];
  const state = new Map();
  const visit = (pkg) => {
    if (state.get(pkg.name) === 'done' || state.get(pkg.name) === 'visiting') return;
    state.set(pkg.name, 'visiting');
    for (const dep of releasedDependencies(pkg)) visit(dep);
    state.set(pkg.name, 'done');
    out.push(pkg);
  };
  for (const pkg of packages.values()) visit(pkg);
  return out;
}

/** Whether npm serves this exact version and its tarball downloads. */
async function served(pkg) {
  const view = spawnSync('npm', ['view', spec(pkg), 'dist.tarball'], { encoding: 'utf8', shell: process.platform === 'win32' });
  const tarball = view.status === 0 ? view.stdout.trim() : '';
  if (!tarball) return false;
  try {
    const answer = await fetch(tarball, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
    await answer.body?.cancel();
    return answer.ok;
  } catch {
    return false;
  }
}

async function waitServed(list, why) {
  const deadline = Date.now() + WAIT_MS;
  let waiting = [...list];
  while (waiting.length) {
    const still = [];
    for (const pkg of waiting) if (!(await served(pkg))) still.push(pkg);
    if (!still.length) return;
    if (Date.now() >= deadline) {
      console.error(`::error::npm does not serve ${still.map(spec).join(', ')} (version and tarball) after ${WAIT_MS / 60_000} min${why}. If npm staged it, an owner lists it with npx npm@latest stage list <pkg> and approves it (2FA).`);
      process.exit(1);
    }
    console.log(`waiting for npm to serve ${still.map(spec).join(', ')}${why}`);
    waiting = still;
    await sleep(POLL_MS);
  }
}

if (process.argv[2] === '--order') {
  console.log(ordered().map(spec).join('\n'));
  process.exit(0);
}

if (servedOnly) {
  await waitServed([...packages.values()], '');
  console.log(`npm serves ${[...packages.values()].map(spec).join(', ')}`);
  process.exit(0);
}

for (const pkg of ordered()) {
  const deps = releasedDependencies(pkg);
  if (deps.length) await waitServed(deps, ` before publishing ${spec(pkg)}, which depends on them`);
  const result = spawnSync('npm', ['publish', '--access', 'public', '--provenance', '--ignore-scripts'], { cwd: pkg.dir, encoding: 'utf8' });
  process.stdout.write(result.stdout ?? '');
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    if (!/cannot publish over/i.test(result.stderr ?? '')) process.exit(1);
  }
  console.log(`published ${spec(pkg)}`);
}
