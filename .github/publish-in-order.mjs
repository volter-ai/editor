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
//
// npm's own output from each publish stays in the log, stdout and stderr, success or not: it is
// the evidence of what npm accepted. A large package (blender-engine unpacks to ~44 MB)
// can take minutes to be served after npm accepts it, so waiting polls with backoff up to the
// bound and prints what it is still waiting for; running out says the publish itself succeeded
// and only the registry has not served it yet, so a slow registry never reads as a lost release.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WAIT_MS = 20 * 60_000;
// The first check is soon; then each wait doubles, up to a minute between checks.
const FIRST_POLL_MS = 5_000;
const MAX_POLL_MS = 60_000;
const servedOnly = process.argv[2] === '--served';
const dirs = process.argv.slice(process.argv[2]?.startsWith('--') ? 3 : 2);
const manifest = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
const packages = new Map(dirs.map((dir) => { const m = manifest(dir); return [m.name, { dir, name: m.name, version: m.version, manifest: m }]; }));
const spec = (pkg) => `${pkg.name}@${pkg.version}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const minutes = (ms) => `${(ms / 60_000).toFixed(1)} min`;
/** The packages npm accepted a publish of in this process ("+ pkg@ver"), by name. */
const accepted = new Set();

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

/** '' when npm serves this exact version and its tarball downloads; otherwise what is missing. */
async function unserved(pkg) {
  const view = spawnSync('npm', ['view', spec(pkg), 'dist.tarball'], { encoding: 'utf8', shell: process.platform === 'win32' });
  const tarball = view.status === 0 ? view.stdout.trim() : '';
  if (!tarball) return 'version not listed yet';
  try {
    const answer = await fetch(tarball, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
    await answer.body?.cancel();
    return answer.ok ? '' : `tarball answers ${answer.status}`;
  } catch (error) {
    return `tarball unreachable (${error.message})`;
  }
}

/**
 * Wait, bounded, until npm serves every package in `list`. `publishedHere` says the publish of
 * each was accepted earlier in this run (the --served check runs only after the Publish step
 * succeeded), so running out is reported as the registry lagging, not as a failed publish.
 */
async function waitServed(list, why, publishedHere = (pkg) => accepted.has(pkg.name)) {
  const started = Date.now();
  let pause = FIRST_POLL_MS;
  let waiting = [...list];
  while (waiting.length) {
    const still = [];
    for (const pkg of waiting) {
      const missing = await unserved(pkg);
      if (missing) still.push({ pkg, missing });
    }
    if (!still.length) return;
    const waited = Date.now() - started;
    const describe = still.map(({ pkg, missing }) => `${spec(pkg)} (${missing})`).join(', ');
    if (waited >= WAIT_MS) {
      const lagging = still.filter(({ pkg }) => publishedHere(pkg)).map(({ pkg }) => spec(pkg));
      const said = lagging.length
        ? ` npm accepted the publish of ${lagging.join(', ')} in this run: the publish itself succeeded and the registry has not served it yet, so the release is not lost. Read it again later with npm view <pkg>@<version> dist.tarball.`
        : '';
      console.error(`::error::npm does not serve ${describe} after ${minutes(waited)}${why}.${said} If npm staged it, an owner lists it with npx npm@latest stage list <pkg> and approves it (2FA).`);
      process.exit(1);
    }
    pause = Math.min(pause, WAIT_MS - waited);
    console.log(`waiting for npm to serve ${describe}${why}: ${minutes(waited)} of ${minutes(WAIT_MS)}, next check in ${Math.round(pause / 1000)} s`);
    waiting = still.map(({ pkg }) => pkg);
    await sleep(pause);
    pause = Math.min(pause * 2, MAX_POLL_MS);
  }
}

if (process.argv[2] === '--order') {
  console.log(ordered().map(spec).join('\n'));
  process.exit(0);
}

if (servedOnly) {
  await waitServed([...packages.values()], '', () => true);
  console.log(`npm serves ${[...packages.values()].map(spec).join(', ')}`);
  process.exit(0);
}

for (const pkg of ordered()) {
  const deps = releasedDependencies(pkg);
  if (deps.length) await waitServed(deps, ` before publishing ${spec(pkg)}, which depends on them`);
  console.log(`npm publish ${spec(pkg)}`);
  const result = spawnSync('npm', ['publish', '--access', 'public', '--provenance', '--ignore-scripts'], { cwd: pkg.dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // npm's own words, both streams, every time: its notices (tarball contents, size, integrity) go to
  // stderr even when the publish succeeds.
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) {
    console.error(`::error::npm publish ${spec(pkg)} did not run: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (!/cannot publish over/i.test(result.stderr ?? '')) {
      console.error(`::error::npm publish ${spec(pkg)} exited ${result.status}; npm's output is above.`);
      process.exit(1);
    }
    console.log(`${spec(pkg)} was already published`);
    continue;
  }
  accepted.add(pkg.name);
  console.log(`npm accepted ${spec(pkg)}; dependents wait until it is served`);
}
