/**
 * The TypeScript type of an engine-class value: the receiver type compat's module for that class
 * already takes (`export function m(self: T, …)`), for the class and every ancestor that has a
 * module — a subclass value is passed to its ancestors' members too, so its type is the
 * intersection of their receivers (a RigidBody3D is `Object3D`, node-3d's; a Camera3D is drei's
 * `PerspectiveCamera`; a PhysicsDirectBodyState3D the module's own interface). A receiver of
 * `object` (the Node protocol's) adds nothing. The table is read from the modules themselves, so a
 * module that changes its receiver changes the type.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { GodotApiDump } from '../../analyze/api-dump';

/** Where one part of a native type is imported from: a compat module or a library (`three`). */
export interface GodotNativeTypePart {
  /** `lib/godot-compat/<module>` for a compat export, else the package (`three`). */
  readonly module: string;
  readonly exportName: string;
  readonly compat: boolean;
}

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const COMPAT_DIR = path.join(PACKAGE_ROOT, 'capabilities/catalog/project-source/src/lib/godot-compat');

/** Each Godot class's compat module receivers, as `@godot-class` and `self:` state them. */
function moduleReceivers(): ReadonlyMap<string, readonly GodotNativeTypePart[]> {
  const byClass = new Map<string, GodotNativeTypePart[]>();
  if (!existsSync(COMPAT_DIR)) return byClass;
  for (const file of readdirSync(COMPAT_DIR).sort()) {
    if (!/\.tsx?$/u.test(file)) continue;
    const source = readFileSync(path.join(COMPAT_DIR, file), 'utf8');
    const header = /^\/\*\*[\s\S]*?\*\//u.exec(source)?.[0] ?? '';
    const godotClass = /@godot-class\s+(\S+)/u.exec(header)?.[1];
    if (godotClass === undefined) continue;
    const module = `lib/godot-compat/${file.replace(/\.tsx?$/u, '')}`;
    const parts: GodotNativeTypePart[] = [];
    for (const match of source.matchAll(/^export function [A-Za-z_$][\w$]*\(self: ([A-Za-z_$][\w$]*)[,)]/gmu)) {
      const name = match[1] as string;
      if (name === 'object' || name === 'unknown' || parts.some((part) => part.exportName === name)) continue;
      if (new RegExp(`^export (?:interface|type|class) ${name}\\b`, 'mu').test(source)) {
        parts.push({ module, exportName: name, compat: true });
        continue;
      }
      const imported = [...source.matchAll(/^import (?:type )?\{([^}]*)\} from '([^']+)';/gmu)].find((entry) =>
        (entry[1] as string).split(',').some((binding) => binding.trim().replace(/^type\s+/u, '') === name),
      );
      if (imported === undefined) continue;
      const from = imported[2] as string;
      if (from.startsWith('./')) parts.push({ module: `lib/godot-compat/${from.slice(2)}`, exportName: name, compat: true });
      else if (!from.startsWith('.')) parts.push({ module: from, exportName: name, compat: false });
    }
    byClass.set(godotClass, [...(byClass.get(godotClass) ?? []), ...parts.filter((part) => !(byClass.get(godotClass) ?? []).some((prior) => prior.exportName === part.exportName))]);
  }
  return byClass;
}

let cached: ReadonlyMap<string, readonly GodotNativeTypePart[]> | undefined;

/**
 * The parts of `className`'s type, most derived first (their intersection is the type); empty
 * when no module up the chain takes more than `object`.
 */
export function godotNativeTypeParts(apiDump: GodotApiDump, className: string): readonly GodotNativeTypePart[] {
  cached ??= moduleReceivers();
  const classes = new Map(apiDump.classes.map((entry) => [entry.name, entry] as const));
  const parts: GodotNativeTypePart[] = [];
  for (let current = classes.get(className); current !== undefined; current = current.base_class === '' ? undefined : classes.get(current.base_class)) {
    for (const part of cached.get(current.name) ?? []) {
      if (!parts.some((prior) => prior.module === part.module && prior.exportName === part.exportName)) parts.push(part);
    }
  }
  return parts;
}

const RETURNS = new Map<string, string | undefined>();

/**
 * The return type a compat export declares (`export function name(…): T`), as written; undefined
 * when the module or the export is not found.
 */
export function godotCompatReturnType(module: string, exportName: string): string | undefined {
  const key = `${module}\0${exportName}`;
  if (RETURNS.has(key)) return RETURNS.get(key);
  const base = path.join(COMPAT_DIR, module.replace(/^lib\/godot-compat\//u, ''));
  const file = existsSync(`${base}.ts`) ? `${base}.ts` : existsSync(`${base}.tsx`) ? `${base}.tsx` : undefined;
  let returned: string | undefined;
  if (file !== undefined) {
    const source = readFileSync(file, 'utf8');
    const start = source.search(new RegExp(`^export function ${exportName}\\b`, 'mu'));
    if (start >= 0) {
      // The parameter list closes where the parentheses balance; the annotation runs to the body.
      let depth = 0;
      let index = source.indexOf('(', start);
      for (; index < source.length; index += 1) {
        if (source[index] === '(') depth += 1;
        else if (source[index] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const rest = source.slice(index + 1);
      const annotation = /^\s*:\s*([^{;]+?)\s*[{;]/u.exec(rest)?.[1];
      returned = annotation?.trim();
    }
  }
  RETURNS.set(key, returned);
  return returned;
}

/** The files the table is read from, for an implementation digest. */
export const GODOT_NATIVE_TYPE_SOURCE_DIR = COMPAT_DIR;
