/**
 * The emitted project's `node_modules` for `gd-analyze run`, which mounts it in Node: the packages as
 * gd-analyze resolves them (its own `node_modules` first), else the monorepo's.
 *
 * `@react-three/rapier` declares no `exports`, so Node would load its CommonJS build and with it
 * Rapier's CommonJS build, a second Rapier (its own WebAssembly memory) beside the ES module compat
 * imports. The project's bundler loads its ES module build (its `module` field), which imports the
 * one Rapier compat does; the run loads that build too.
 *
 * R3F and drei load as CommonJS (they declare no `exports`), and their `require('three')` would be
 * three's CommonJS build, a second three beside the ES module compat imports: R3F would then fail
 * `instanceof THREE.Color` on the scene's own lights and set a colour prop as a string. `three` is
 * its ES module build for `require` as well, as the bundler has one three.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');

/** Packages loaded through their ES module build, as the project's bundler loads them. */
const MODULE_BUILDS = new Set(['@react-three/rapier']);

/** The resolve hook a run's mount imports (`node --import ./gd-analyze-resolve.mjs`). */
export const EMITTED_RESOLVE_HOOK = 'gd-analyze-resolve.mjs';

export function linkEmittedNodeModules(out: string): void {
  const own = path.join(PACKAGE_ROOT, 'node_modules');
  const shared = path.join(MONOREPO_ROOT, 'node_modules');
  const target = path.join(out, 'node_modules');
  mkdirSync(target);
  const link = (name: string): void => {
    const local = path.join(own, name);
    const source = existsSync(local) ? local : path.join(shared, name);
    if (MODULE_BUILDS.has(name)) {
      const manifest = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8')) as { readonly module: string };
      mkdirSync(path.join(target, name));
      writeFileSync(path.join(target, name, 'package.json'), `${JSON.stringify({ name, type: 'module', main: 'index.js' })}\n`);
      writeFileSync(path.join(target, name, 'index.js'), `export * from ${JSON.stringify(pathToFileURL(path.join(source, manifest.module)).href)};\n`);
      return;
    }
    symlinkSync(source, path.join(target, name));
  };
  // A workspace package the world imports (`@volter/game-runtime`'s Rapier bridge) resolves its
  // dependencies from its own checkout, where Node would pick the CommonJS build again: every
  // importer's `@react-three/rapier` is the module build, as the bundler resolves it.
  const moduleUrls: Record<string, string> = {};
  for (const name of MODULE_BUILDS) {
    const local = path.join(own, name);
    const source = existsSync(local) ? local : path.join(shared, name);
    const manifest = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8')) as { readonly module: string };
    moduleUrls[name] = pathToFileURL(path.join(source, manifest.module)).href;
  }
  const three = existsSync(path.join(own, 'three')) ? path.join(own, 'three') : path.join(shared, 'three');
  const threeManifest = JSON.parse(readFileSync(path.join(three, 'package.json'), 'utf8')) as { readonly exports: { readonly '.': { readonly import: string } } };
  moduleUrls['three'] = pathToFileURL(path.join(three, threeManifest.exports['.'].import)).href;
  // Synchronous hooks, which `require` passes through as well as `import`.
  writeFileSync(
    path.join(out, EMITTED_RESOLVE_HOOK),
    `import { registerHooks } from 'node:module';\nconst urls = ${JSON.stringify(moduleUrls)};\nregisterHooks({\n  resolve(specifier, context, next) {\n    const url = urls[specifier];\n    return url === undefined ? next(specifier, context) : { url, format: 'module', shortCircuit: true };\n  },\n});\n`,
  );
  for (const entry of readdirSync(shared)) {
    if (entry.startsWith('.')) continue;
    if (!entry.startsWith('@')) {
      link(entry);
      continue;
    }
    mkdirSync(path.join(target, entry));
    for (const scoped of readdirSync(path.join(shared, entry))) link(`${entry}/${scoped}`);
  }
}
