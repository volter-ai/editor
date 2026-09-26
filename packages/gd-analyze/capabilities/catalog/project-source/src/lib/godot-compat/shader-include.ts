import { registerGodotObjectIdentity } from './object';
import { godotResourceEmitChanged } from './resource-io';
import { GodotShader } from './shader';

export interface GodotShaderInclude {
  readonly __godotClass: 'ShaderInclude';
  code: string;
  path: string;
  setCode(code: string): void;
  getCode(): string;
}

export interface GodotShaderIncludeRegistry {
  readonly includes: ReadonlyMap<string, GodotShaderInclude>;
  resolve(path: string, fromPath?: string): GodotShaderInclude | null;
}

interface IncludeState {
  code: string;
  path: string;
  listeners: Set<() => void>;
}

interface ShaderBinding {
  source: string;
  sourcePath: string;
  registry: GodotShaderIncludeRegistry;
  releases: (() => void)[];
}

const INCLUDE_STATE = new WeakMap<GodotShaderInclude, IncludeState>();
const SHADER_BINDINGS = new WeakMap<GodotShader, ShaderBinding>();
const GLOBAL_INCLUDES = new Map<string, GodotShaderInclude>();
const BUILT_IN_INCLUDES = new Map<string, string>();
const BUILT_IN_WATCHERS = new Set<(filenames: readonly string[]) => void>();

function normalizePath(path: string, base = 'res://'): string {
  if (typeof path !== 'string' || path.trim() === '') throw new TypeError('godot-compat: ShaderInclude path requires nonempty String.');
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('res://')) return `res://${collapse(normalized.slice(6))}`;
  const baseDirectory = base.startsWith('res://') ? base.slice(6).replace(/\/[^/]*$/, '') : '';
  return `res://${collapse(`${baseDirectory}/${normalized}`)}`;
}

function collapse(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) throw new RangeError('godot-compat: ShaderInclude path escapes res://.');
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

function stateOf(include: GodotShaderInclude): IncludeState {
  const state = INCLUDE_STATE.get(include);
  if (state === undefined) throw new TypeError('godot-compat: ShaderInclude member requires ShaderInclude Resource.');
  return state;
}

function changed(include: GodotShaderInclude): void {
  godotResourceEmitChanged(include);
  for (const listener of stateOf(include).listeners) listener();
}

export function createGodotShaderInclude(code = '', path = ''): GodotShaderInclude {
  if (typeof code !== 'string') throw new TypeError('godot-compat: ShaderInclude.code requires String.');
  const include = {
    __godotClass: 'ShaderInclude' as const,
    get code() { return stateOf(include).code; },
    set code(value: string) { setGodotShaderIncludeCode(include, value); },
    get path() { return stateOf(include).path; },
    set path(value: string) { setGodotShaderIncludePath(include, value); },
    setCode(value: string) { setGodotShaderIncludeCode(include, value); },
    getCode() { return stateOf(include).code; },
  };
  INCLUDE_STATE.set(include, { code, path: path === '' ? '' : normalizePath(path), listeners: new Set() });
  registerGodotObjectIdentity(include, 'ShaderInclude');
  if (path !== '') registerGodotShaderInclude(include, path);
  return include;
}

export function getGodotShaderIncludeCode(include: GodotShaderInclude): string { return stateOf(include).code; }
export function setGodotShaderIncludeCode(include: GodotShaderInclude, code: unknown): void {
  if (typeof code !== 'string') throw new TypeError('godot-compat: ShaderInclude.code requires String.');
  const state = stateOf(include); if (state.code === code) return; state.code = code; changed(include);
}
export function getGodotShaderIncludePath(include: GodotShaderInclude): string { return stateOf(include).path; }
export function setGodotShaderIncludePath(include: GodotShaderInclude, path: unknown): void {
  if (typeof path !== 'string') throw new TypeError('godot-compat: ShaderInclude.path requires String.');
  const state = stateOf(include); const previous = state.path; const next = path === '' ? '' : normalizePath(path);
  if (previous === next) return;
  if (previous !== '' && GLOBAL_INCLUDES.get(previous) === include) GLOBAL_INCLUDES.delete(previous);
  state.path = next; if (next !== '') GLOBAL_INCLUDES.set(next, include); changed(include);
}

export function registerGodotShaderInclude(include: GodotShaderInclude, path = stateOf(include).path): () => void {
  const normalized = normalizePath(path);
  const existing = GLOBAL_INCLUDES.get(normalized);
  if (existing !== undefined && existing !== include) throw new Error(`godot-compat: duplicate ShaderInclude path ${normalized}.`);
  const state = stateOf(include); state.path = normalized; GLOBAL_INCLUDES.set(normalized, include);
  return () => { if (GLOBAL_INCLUDES.get(normalized) === include) GLOBAL_INCLUDES.delete(normalized); };
}

export function watchGodotShaderInclude(include: GodotShaderInclude, listener: () => void): () => void {
  const state = stateOf(include); state.listeners.add(listener); return () => state.listeners.delete(listener);
}

export function createGodotShaderIncludeRegistry(includes: readonly GodotShaderInclude[] = []): GodotShaderIncludeRegistry {
  const map = new Map<string, GodotShaderInclude>();
  for (const include of includes) {
    const path = stateOf(include).path;
    if (path === '') throw new Error('godot-compat: local ShaderInclude registry requires every include to have a path.');
    if (map.has(path)) throw new Error(`godot-compat: duplicate ShaderInclude path ${path}.`);
    map.set(path, include);
  }
  return Object.freeze({
    includes: map,
    resolve(path: string, fromPath = 'res://') {
      const normalized = normalizePath(path, fromPath);
      return map.get(normalized) ?? GLOBAL_INCLUDES.get(normalized) ?? null;
    },
  });
}

const INCLUDE_DIRECTIVE = /^\s*#include\s+["<]([^">]+)[">]\s*$/;

export function expandGodotShaderIncludes(
  code: string,
  registry: GodotShaderIncludeRegistry = createGodotShaderIncludeRegistry(),
  sourcePath = 'res://shader.gdshader',
): { readonly code: string; readonly dependencies: readonly GodotShaderInclude[] } {
  if (typeof code !== 'string') throw new TypeError('godot-compat: shader include expansion requires String code.');
  const dependencies = new Set<GodotShaderInclude>();
  const stack: string[] = [];
  const expand = (source: string, path: string): string => source.split(/\r?\n/).map((line) => {
    const match = INCLUDE_DIRECTIVE.exec(line);
    if (match === null) return line;
    const requested = match[1]!;
    const resolvedPath = normalizePath(requested, path);
    if (stack.includes(resolvedPath)) throw new Error(`godot-compat: ShaderInclude cycle: ${[...stack, resolvedPath].join(' -> ')}`);
    const include = registry.resolve(requested, path);
    if (include === null) throw new Error(`godot-compat: ShaderInclude ${requested} from ${path} is not registered.`);
    dependencies.add(include);
    stack.push(resolvedPath);
    try {
      return `// begin ${resolvedPath}\n${expand(include.code, resolvedPath)}\n// end ${resolvedPath}`;
    } finally { stack.pop(); }
  }).join('\n');
  return Object.freeze({ code: expand(code, normalizePath(sourcePath)), dependencies: Object.freeze([...dependencies]) });
}

function compileBinding(shader: GodotShader, binding: ShaderBinding): void {
  for (const release of binding.releases.splice(0)) release();
  const expanded = expandGodotShaderIncludes(binding.source, binding.registry, binding.sourcePath);
  shader.setCode(expanded.code);
  for (const include of expanded.dependencies) binding.releases.push(watchGodotShaderInclude(include, () => compileBinding(shader, binding)));
}

export function setGodotShaderCodeWithIncludes(
  shader: GodotShader,
  code: string,
  registry: GodotShaderIncludeRegistry = createGodotShaderIncludeRegistry(),
  sourcePath = 'res://shader.gdshader',
): void {
  const previous = SHADER_BINDINGS.get(shader);
  for (const release of previous?.releases ?? []) release();
  const binding: ShaderBinding = { source: code, sourcePath: normalizePath(sourcePath), registry, releases: [] };
  SHADER_BINDINGS.set(shader, binding);
  compileBinding(shader, binding);
}

export function getGodotShaderSourceWithIncludes(shader: GodotShader): string { return SHADER_BINDINGS.get(shader)?.source ?? shader.getCode(); }
export function releaseGodotShaderIncludes(shader: GodotShader): void {
  const binding = SHADER_BINDINGS.get(shader); if (binding === undefined) return;
  for (const release of binding.releases) release(); binding.releases.length = 0; SHADER_BINDINGS.delete(shader);
}

function builtInFilename(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('godot-compat: ShaderIncludeDB filename requires nonempty String.');
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.split('/').some((part) => part === '..')) throw new RangeError('godot-compat: ShaderIncludeDB filename cannot escape its built-in root.');
  return normalized;
}

function publishBuiltIns(): void {
  const filenames = Object.freeze([...BUILT_IN_INCLUDES.keys()].sort());
  for (const watcher of BUILT_IN_WATCHERS) watcher(filenames);
}

export function registerGodotBuiltInShaderInclude(filenameValue: unknown, code: unknown): () => void {
  const filename = builtInFilename(filenameValue);
  if (typeof code !== 'string') throw new TypeError('godot-compat: ShaderIncludeDB built-in code requires String.');
  if (BUILT_IN_INCLUDES.has(filename)) throw new Error(`godot-compat: ShaderIncludeDB duplicate built-in include ${filename}.`);
  BUILT_IN_INCLUDES.set(filename, code); publishBuiltIns();
  return () => { if (BUILT_IN_INCLUDES.get(filename) === code) { BUILT_IN_INCLUDES.delete(filename); publishBuiltIns(); } };
}

export function bindGodotBuiltInShaderIncludes(includes: Readonly<Record<string, string>> | ReadonlyMap<string, string>): () => void {
  const releases: Array<() => void> = [];
  const entries = includes instanceof Map ? includes.entries() : Object.entries(includes);
  for (const [filename, code] of entries) releases.push(registerGodotBuiltInShaderInclude(filename, code));
  return () => { for (const release of releases.splice(0).reverse()) release(); };
}

export function godotShaderIncludeDbListBuiltInIncludeFiles(): string[] { return [...BUILT_IN_INCLUDES.keys()].sort(); }
export function godotShaderIncludeDbHasBuiltInIncludeFile(filename: unknown): boolean { return BUILT_IN_INCLUDES.has(builtInFilename(filename)); }
export function godotShaderIncludeDbGetBuiltInIncludeFile(filename: unknown): string {
  const normalized = builtInFilename(filename), code = BUILT_IN_INCLUDES.get(normalized);
  if (code === undefined) throw new RangeError(`godot-compat: ShaderIncludeDB built-in include ${normalized} is not registered.`);
  return code;
}
export function watchGodotBuiltInShaderIncludes(watcher: (filenames: readonly string[]) => void): () => void {
  BUILT_IN_WATCHERS.add(watcher); watcher(Object.freeze(godotShaderIncludeDbListBuiltInIncludeFiles())); return () => BUILT_IN_WATCHERS.delete(watcher);
}
