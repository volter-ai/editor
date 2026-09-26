#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
/** Build the official bound-GDScript exporter into an exact pinned Godot source tree (`--version 4.6|4.7`). */
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..');
const MODULE_ROOT = join(
  PACKAGE_ROOT,
  'godot-frontend/exporter-modules/gdscript_frontend_exporter',
);
/**
 * Each pinned Godot release: its exact commit, the digest of its `.cpp`/`.h` tree under this
 * script's own `aggregate`, the digest of the GitHub source archive for that commit, and the
 * frontend instrumentation patch written against that tree.
 */
const VERSIONS = {
  '4.6': {
    revision: '89cea143987d564363e15d207438530651d943ac',
    sourceTreeSha256: '0bbc5b19dc29cfd69b020f58691dd710539c5e8717dc14082aa963a1be9f57f3',
    sourceArchiveSha256: '4387f22b1ef3ad9efd34ba0cd8075b0c3f192ddb3fc2ad7e400c9c44145900ad',
    patch: '4.6-selected-call-targets.patch',
  },
  '4.7': {
    revision: '5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88',
    sourceTreeSha256: 'b25d23ca60d7a9e99c2cccda9a5a1b2e736e6d0f79a8411d6647dafd4693cbec',
    sourceArchiveSha256: 'b3d705612228c09083d55a89ed3ea7381e6181387ecfdb74fd5cf9733b28eee6',
    patch: '4.7-selected-call-targets.patch',
  },
};
const BUILD_OPTIONS =
  'platform=macos target=editor arch=arm64 dev_build=yes debug_symbols=no lto=none vulkan=no opengl3=no metal=no angle=no accesskit=no sdl=no disable_path_overrides=no modules_enabled_by_default=yes module_gdscript_enabled=yes module_gdscript_frontend_exporter_enabled=yes';
const EXCLUDED_SOURCE_SEGMENTS = new Set(['.git', 'thirdparty', 'tests']);
const EXCLUDED_EXPORTER_FILES = new Set(['build_identity.gen.h']);

function fail(message) {
  throw new Error(`build Godot bound exporter: ${message}`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function files(root, options = {}) {
  const found = [];
  const excludedSegments = options.excludedSegments ?? new Set();
  const accept = options.accept ?? (() => true);
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      if (excludedSegments.has(name)) continue;
      if (options.excludedFiles?.has(name)) continue;
      const absolute = join(dir, name);
      const entry = statSync(absolute);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && accept(name)) found.push(absolute);
    }
  }
  walk(root);
  return found;
}

function aggregate(root, paths) {
  return sha256(
    paths
      .map((absolute) => {
        const path = relative(root, absolute).split(sep).join('/');
        return `${path}\0${sha256(readFileSync(absolute))}`;
      })
      .join('\n'),
  );
}

export function exporterSourceSha256(officialSourcePatch) {
  const roots = [MODULE_ROOT, officialSourcePatch];
  const rows = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    if (statSync(root).isDirectory()) {
      for (const absolute of files(root, { excludedFiles: EXCLUDED_EXPORTER_FILES })) {
        rows.push(
          `${relative(PACKAGE_ROOT, absolute).split(sep).join('/')}\0${sha256(readFileSync(absolute))}`,
        );
      }
    } else {
      rows.push(
        `${relative(PACKAGE_ROOT, root).split(sep).join('/')}\0${sha256(readFileSync(root))}`,
      );
    }
  }
  return sha256(rows.sort().join('\n'));
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const sourceRootArg = argument('--source-root');
const sourceArchiveArg = argument('--source-archive');
const versionArg = argument('--version') ?? '4.7';
if (sourceRootArg === undefined || sourceArchiveArg === undefined) {
  fail(
    'usage: build-godot-bound-exporter.mjs --source-root <tree> --source-archive <tar.gz> [--version <4.6|4.7>] [--out-dir <dir>]',
  );
}
if (!Object.hasOwn(VERSIONS, versionArg)) {
  fail(`--version must be one of ${Object.keys(VERSIONS).join(', ')}, received ${versionArg}`);
}
const {
  revision: REVISION,
  sourceTreeSha256: SOURCE_TREE_SHA256,
  sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
  patch,
} = VERSIONS[versionArg];
const OFFICIAL_SOURCE_PATCH = join(PACKAGE_ROOT, 'godot-frontend/official-source-patches', patch);
const sourceRoot = resolve(sourceRootArg);
const sourceArchive = resolve(sourceArchiveArg);
const outDir = resolve(
  argument('--out-dir') ?? join(PACKAGE_ROOT, '../../.vgai/tmp/godot-bound-exporter'),
);
const cacheDir = join(outDir, 'scons-cache');
mkdirSync(cacheDir, { recursive: true });
if (sha256(readFileSync(sourceArchive)) !== SOURCE_ARCHIVE_SHA256) {
  fail(`source archive is not the pinned ${REVISION} archive`);
}
const sourcePaths = files(sourceRoot, {
  excludedSegments: EXCLUDED_SOURCE_SEGMENTS,
  accept: (name) => name.endsWith('.cpp') || name.endsWith('.h'),
});
const sourceTreeSha256 = aggregate(sourceRoot, sourcePaths);
if (sourceTreeSha256 !== SOURCE_TREE_SHA256) {
  fail(`source tree is not the audited ${REVISION} tree: got ${sourceTreeSha256}`);
}

const exporterSha256 = exporterSourceSha256(OFFICIAL_SOURCE_PATCH);
const temp = mkdtempSync(join(tmpdir(), 'vgai-godot-bound-exporter-module-'));
const buildRoot = mkdtempSync(join(dirname(sourceRoot), '.vgai-godot-bound-exporter-build-'));
const buildSource = join(buildRoot, 'source');
const customModules = join(temp, 'modules');
const generatedModule = join(customModules, basename(MODULE_ROOT));
mkdirSync(customModules, { recursive: true });
cpSync(MODULE_ROOT, generatedModule, { recursive: true });
writeFileSync(
  join(generatedModule, 'build_identity.gen.h'),
  [
    '#pragma once',
    `#define VGAI_GODOT_SOURCE_REVISION "${REVISION}"`,
    `#define VGAI_GODOT_SOURCE_TREE_SHA256 "${SOURCE_TREE_SHA256}"`,
    `#define VGAI_GODOT_SOURCE_ARCHIVE_SHA256 "${SOURCE_ARCHIVE_SHA256}"`,
    `#define VGAI_GODOT_EXPORTER_SOURCE_SHA256 "${exporterSha256}"`,
    `#define VGAI_GODOT_EXPORTER_BUILD_OPTIONS "${BUILD_OPTIONS}"`,
    '',
  ].join('\n'),
);

try {
  mkdirSync(buildSource, { recursive: true });
  const clone = spawnSync('cp', ['-cR', `${sourceRoot}/.`, buildSource], { stdio: 'inherit' });
  if (clone.error !== undefined) fail(`could not clone pinned source: ${clone.error.message}`);
  if (clone.status !== 0) fail(`source clone exited ${String(clone.status)}`);
  const instrument = spawnSync('patch', ['-p1', '--forward', '-i', OFFICIAL_SOURCE_PATCH], {
    cwd: buildSource,
    stdio: 'inherit',
  });
  if (instrument.error !== undefined) {
    fail(`could not instrument pinned frontend: ${instrument.error.message}`);
  }
  if (instrument.status !== 0) {
    fail(`frontend instrumentation patch exited ${String(instrument.status)}`);
  }
  const result = spawnSync(
    'scons',
    [
      '-j8',
      'platform=macos',
      'target=editor',
      'arch=arm64',
      'dev_build=yes',
      'debug_symbols=no',
      'lto=none',
      'vulkan=no',
      'opengl3=no',
      'metal=no',
      'angle=no',
      'accesskit=no',
      'sdl=no',
      'disable_path_overrides=no',
      'modules_enabled_by_default=yes',
      'module_gdscript_enabled=yes',
      'module_gdscript_frontend_exporter_enabled=yes',
      `cache_path=${cacheDir}`,
      `custom_modules=${customModules}`,
    ],
    { cwd: buildSource, stdio: 'inherit' },
  );
  if (result.error !== undefined) fail(`could not execute scons: ${result.error.message}`);
  if (result.status !== 0) fail(`scons exited ${String(result.status)}`);

  const candidates = readdirSync(join(buildSource, 'bin'))
    .filter((name) => /^godot\.macos\.editor\.dev\.arm64(?:\.app)?$/.test(name))
    .sort();
  if (candidates.length !== 1) {
    fail(`expected one arm64 editor binary, found ${candidates.join(', ') || 'none'}`);
  }
  const candidate = join(buildSource, 'bin', candidates[0]);
  const builtBinary = candidate.endsWith('.app')
    ? join(candidate, 'Contents/MacOS/Godot')
    : candidate;
  if (!existsSync(builtBinary)) fail(`built executable does not exist: ${builtBinary}`);
  mkdirSync(outDir, { recursive: true });
  const outputBinary = join(outDir, `godot-${versionArg}-bound-exporter-arm64`);
  cpSync(builtBinary, outputBinary);
  chmodSync(outputBinary, 0o755);
  const executableSha256 = sha256(readFileSync(outputBinary));
  const identity = {
    protocol: 'vgai.godot-bound-exporter-build',
    protocolVersion: 1,
    sourceRevision: REVISION,
    sourceTreeSha256: SOURCE_TREE_SHA256,
    sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
    exporterSourceSha256: exporterSha256,
    executableSha256,
    buildOptions: BUILD_OPTIONS,
    executable: outputBinary,
  };
  writeFileSync(join(outDir, 'identity.json'), `${JSON.stringify(identity, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
} finally {
  rmSync(temp, { recursive: true, force: true });
  rmSync(buildRoot, { recursive: true, force: true });
}
