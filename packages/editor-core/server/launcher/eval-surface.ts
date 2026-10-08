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

/**
 * COMMON TASKS — a handful of one-line examples printed under the member list.
 *
 * The member list answers "what could I call?"; it cannot answer "which call
 * does the thing I want?". Measured 2026-10 (an agent building an obby): with
 * the full list in hand it still looked for `setCamera`, improvised a camera
 * pose from `frame()` + `orbit()`, and wrote its own helper to turn a capture's
 * base64 into a file. Every one of those was already a single call on this
 * surface. The examples are the editor façade's own calls (every product binds
 * `editor`), so they hold for every product that prints this listing; the
 * camera names the façade does not have are refused with a pointer to the same
 * call (`@volter/editor-live`'s `member-hints.ts`). An empty task continues the
 * line above it.
 */
const COMMON_TASKS: readonly (readonly [task: string, code: string])[] = [
  ['Pose the camera', 'await editor.present({ version: 1, viewport: { camera: { position: { x: 6, y: 4, z: 8 }, target: { x: 0, y: 0, z: 0 }, fov: 50 } } })'],
  ['', 'stage space: metres, Y up; a Blender point (x, y, z) is { x, y: z, z: -y }. Read it: return (await editor.currentView()).viewport'],
  ['Capture to a file', "const shot = await editor.captureEditorChrome({ region: 'play' }); (await import('node:fs')).writeFileSync('shot.png', Buffer.from(shot.base64, 'base64'))"],
  ['', "region 'document': the document as the person sees it, overlays included; 'play': the live Play frame and its UI"],
  ['Open a model', "return await editor.open('model:src/models/canyon.blend')"],
  ['Hold a key in Play', "return await editor.document.key('w', { code: 'KeyW', holdMs: 1500 })"],
  ['Read game state', "return await editor.document.query('[aria-label]', { limit: 20 })"],
  ['', "the running document's DOM, its HUD included: show the state you need to read there (text or data-* attributes)"],
];

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
  lines.push('', `Common tasks (each is one \`${command} eval '…'\` argument):`);
  const width = Math.max(...COMMON_TASKS.map(([task]) => task.length)) + 2;
  for (const [task, code] of COMMON_TASKS) lines.push(`  ${task.padEnd(width)}${task === '' ? '  ' : ''}${code}`);
  return lines.join('\n');
}
