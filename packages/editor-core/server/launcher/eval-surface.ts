/**
 * What is in scope for `eval`, read from the binding OBJECTS themselves.
 *
 * A written list of members drifts from the code the day after it is written;
 * walking real objects cannot. Objects, not classes: instance fields such as
 * `game.input` exist on no prototype, so a class walk would miss them. The
 * objects are built unconnected (port 0), so `eval --list` answers "what could
 * I call?" before any session is running. `#`-private members are invisible to
 * `Object.getOwnPropertyNames`, so the runtime, not editorial taste, decides
 * what is public. Getters are listed without being read: listing never runs
 * product code.
 */

/** One member of an in-scope object. */
export interface SurfaceMember {
  /** `state`, or `input.hold` for a member of a nested namespace object. */
  readonly name: string;
  /** `method`: call it. `value`: read it. */
  readonly kind: 'method' | 'value';
  /** Declared parameter count (`Function.length`, optionals excluded); 0 for a value. */
  readonly arity: number;
}

const NOISE = new Set(['constructor', 'then', 'catch', 'finally']);
const FUNCTION_NOISE = new Set(['length', 'name', 'prototype', 'arguments', 'caller']);

function describe(target: object, key: string): PropertyDescriptor | undefined {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor !== undefined) return descriptor;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function ownAndInheritedKeys(target: object): string[] {
  const targetIsFunction = typeof target === 'function';
  const keys: string[] = [];
  const seen = new Set<string>();
  let current: object | null = target;
  while (current !== null && current !== Object.prototype && current !== Function.prototype && current !== Array.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (seen.has(name)) continue;
      seen.add(name);
      if (NOISE.has(name) || name.startsWith('_')) continue;
      if (targetIsFunction && FUNCTION_NOISE.has(name)) continue;
      keys.push(name);
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return keys;
}

/** A class instance hanging off a binding is a namespace of calls: expand it one level. */
function isNamespace(value: unknown): value is object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto === Object.prototype || proto === null) return false;
  return ownAndInheritedKeys(value).some(key => typeof describe(value, key)?.value === 'function');
}

/** Everything reachable on one binding, sorted; namespaces expand one level. */
export function surfaceMembers(target: unknown): SurfaceMember[] {
  if ((typeof target !== 'object' && typeof target !== 'function') || target === null) return [];
  const members: SurfaceMember[] = [];
  for (const name of ownAndInheritedKeys(target)) {
    const descriptor = describe(target, name);
    if (descriptor === undefined) continue;
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      members.push({ name, kind: 'value', arity: 0 });
      continue;
    }
    const value: unknown = descriptor.value;
    if (typeof value === 'function') members.push({ name, kind: 'method', arity: value.length });
    else if (isNamespace(value)) {
      for (const inner of ownAndInheritedKeys(value)) {
        const innerValue: unknown = describe(value, inner)?.value;
        if (typeof innerValue === 'function') members.push({ name: `${name}.${inner}`, kind: 'method', arity: innerValue.length });
      }
    } else members.push({ name, kind: 'value', arity: 0 });
  }
  return members.sort((a, b) => a.name.localeCompare(b.name));
}

/** The listing for a terminal: each binding and its members, three columns. */
export function formatSurface(command: string, bindings: Record<string, unknown>): string {
  const lines = [`In scope for \`${command} eval\` (read from the objects themselves):`, ''];
  for (const [binding, target] of Object.entries(bindings)) {
    const members = surfaceMembers(target);
    lines.push(binding);
    if (members.length === 0) lines.push(`  (data; inspect it with: ${command} eval 'return ${binding}')`);
    const names = members.map(m => (m.kind === 'method' ? `${m.name}(${m.arity || ''})` : m.name));
    const width = Math.max(0, ...names.map(n => n.length)) + 2;
    for (let i = 0; i < names.length; i += 3) lines.push(`  ${names.slice(i, i + 3).map(n => n.padEnd(width)).join('').trimEnd()}`);
    lines.push('');
  }
  lines.push('Parens mark a method; the number is its declared parameter count. A bare name is a field.');
  return lines.join('\n');
}
