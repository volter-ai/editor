#!/usr/bin/env node
/**
 * Vendor one complete Godot project as an immutable analysis fixture.
 *
 * Usage:
 *   node packages/gd-analyze/test/vendor-fixture.mjs \
 *     <id> <repo-url> <commit> <branch> <license> <license-file>
 *
 * The fixture shelf is evidence: the exact tracked upstream tree is copied at a pinned commit,
 * and a sibling lock records every byte. This helper deliberately refuses an existing target;
 * changing a pin is a reviewed replacement, never an in-place network update.
 */
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');

function fail(message) {
  process.stderr.write(`vendor-fixture: ${message}\n`);
  process.exit(2);
}

function walk(root, base = root, acc = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) walk(absolute, base, acc);
    else acc.push(relative(base, absolute).split('/').join('/'));
  }
  return acc;
}

const [id, repo, commit, branch, license, licenseFile] = process.argv.slice(2);
if (!id || !repo || !commit || !branch || !license || !licenseFile) {
  fail('expected <id> <repo-url> <commit> <branch> <license> <license-file>');
}
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) fail(`invalid fixture id "${id}"`);
if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
  fail(`repo must be a canonical GitHub URL without .git: ${repo}`);
}
if (!/^[0-9a-f]{40}$/.test(commit)) fail(`commit is not 40 lowercase hex: ${commit}`);

const target = resolve(FIXTURES, id);
const lockPath = resolve(FIXTURES, `${id}.UPSTREAM.lock`);
if (dirname(target) !== resolve(FIXTURES)) fail(`fixture id escapes the fixture shelf: ${id}`);
if (existsSync(target) || existsSync(lockPath)) {
  fail(`${id} already exists; refusing to overwrite pinned evidence`);
}

const temporary = mkdtempSync(join(tmpdir(), `vgai-godot-${id}-`));
const checkout = join(temporary, 'upstream');
try {
  execFileSync('git', ['init', '--quiet', checkout]);
  execFileSync('git', ['remote', 'add', 'origin', `${repo}.git`], { cwd: checkout });
  execFileSync('git', ['fetch', '--quiet', '--depth', '1', 'origin', commit], { cwd: checkout });
  execFileSync('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], { cwd: checkout });

  if (!existsSync(join(checkout, 'project.godot'))) {
    fail(`${repo}@${commit} has no project.godot at its root`);
  }
  if (!existsSync(join(checkout, licenseFile))) {
    fail(`${repo}@${commit} has no declared license file ${licenseFile}`);
  }

  cpSync(checkout, target, {
    recursive: true,
    filter: (source) => source !== join(checkout, '.git') && !source.startsWith(`${join(checkout, '.git')}/`),
  });

  const files = walk(target).sort();
  const sha256Manifest = {};
  let bytes = 0;
  for (const path of files) {
    const absolute = join(target, path);
    const content = readFileSync(absolute);
    sha256Manifest[path] = createHash('sha256').update(content).digest('hex');
    bytes += lstatSync(absolute).size;
  }

  const lock = {
    id,
    upstreams: [
      {
        repo,
        commit,
        branch,
        upstream_path: '.',
        license,
        license_file: licenseFile,
        retrieved: new Date().toISOString().slice(0, 10),
        vendored_into: '.',
        vendored_paths: ['.'],
        note:
          `${id} is an official Kenney Godot project, pinned at the named upstream commit as ` +
          'unmodified migration evidence. The repository root is the Godot project root.',
        excluded_from_upstream: {
          rule: `NOTHING is excluded. All ${files.length} tracked files are vendored byte-for-byte.`,
          why:
            'The complete upstream project is small enough to retain, and its scenes, scripts, ' +
            'resources, assets, import metadata, license, and README are all relevant migration evidence.',
          file_count: 0,
          bytes: 0,
          paths: [],
        },
      },
    ],
    vendored_file_count: files.length,
    vendored_bytes: bytes,
    sha256_manifest: sha256Manifest,
  };
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  process.stdout.write(`vendored ${id}: ${files.length} files, ${bytes} bytes, ${commit}\n`);
} catch (error) {
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  if (existsSync(lockPath)) rmSync(lockPath, { force: true });
  throw error;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
