/**
 * The emitted project's `node_modules` for a proof that mounts it in Node: the packages as
 * gd-analyze resolves them (its own `node_modules` first), else the monorepo's.
 *
 * `@react-three/rapier` declares no `exports`, so Node would load its CommonJS build and with it
 * Rapier's CommonJS build, a second Rapier (its own WebAssembly memory) beside the ES module compat
 * imports. The project's bundler loads its ES module build (its `module` field), which imports the
 * one Rapier compat does; the proof loads that build too.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');

/** Packages loaded through their ES module build, as the project's bundler loads them. */
const MODULE_BUILDS = new Set(['@react-three/rapier']);

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
