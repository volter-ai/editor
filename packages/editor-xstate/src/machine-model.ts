/**
 * A state machine as its SOURCE declares it: what the reader (`machine-source.ts`) finds in a
 * `createMachine(...)` call and what the Machine document draws and edits. Browser-safe: no
 * compiler here, only the shape both halves share.
 *
 * Every node carries the span of the code it came from, so an edit is a write to that code and
 * nothing else. A part the reader cannot read as data (a computed key, a spread, a config built
 * by a function) is reported in `opaque` and drawn as read-only: the source stays the truth.
 */

export interface SourceSpan {
  readonly start: number;
  readonly end: number;
}

export type MachineStateKind = 'atomic' | 'compound' | 'parallel' | 'final' | 'history';

export type MachineTransitionKind = 'on' | 'always' | 'after' | 'onDone';

export interface MachineTransition {
  /** Stable within one read: `<source state id>|<kind>|<event>|<index>`. */
  readonly id: string;
  readonly source: string;
  readonly kind: MachineTransitionKind;
  /** The event type (`on`), the delay (`after`), or `''` (`always`, `onDone`). */
  readonly event: string;
  /** The target strings as written; empty for a targetless transition. */
  readonly targets: readonly string[];
  /** The state ids those strings resolve to, by XState's own rules; `null` when one does not. */
  readonly resolved: readonly (string | null)[];
  readonly guard?: string;
  readonly actions: readonly string[];
  readonly span: SourceSpan;
}

export interface MachineState {
  /** Dot path from the root (`alive.movement`); the root is `''`. */
  readonly id: string;
  readonly key: string;
  readonly kind: MachineStateKind;
  readonly initial?: string;
  /** The custom `id` a state declares (`#combat` targets it). */
  readonly declaredId?: string;
  readonly children: readonly MachineState[];
  readonly transitions: readonly MachineTransition[];
  readonly entry: readonly string[];
  readonly exit: readonly string[];
  readonly tags: readonly string[];
  readonly description?: string;
  /** Source text of `meta`, when declared. */
  readonly meta?: string;
  /** Parts of this state's config the reader could not read as data. */
  readonly opaque: readonly string[];
  /** The state's config object literal. */
  readonly span: SourceSpan;
}

export interface MachineDefinition {
  /** `<project-relative file>#<export name | machine<n>>`: the identity a running actor carries. */
  readonly key: string;
  readonly file: string;
  readonly exportName: string | null;
  /** The machine's own `id`, when declared. */
  readonly machineId: string | null;
  readonly root: MachineState;
  /** The `createMachine(...)` call. */
  readonly span: SourceSpan;
}

/** The document's read of one module. */
export interface MachineModule {
  readonly file: string;
  readonly machines: readonly MachineDefinition[];
  /** What could not be read, said out loud (a config that is not an object literal). */
  readonly notes: readonly string[];
}

/** An edit the Machine document asks of the source. */
export type MachineEdit =
  | { readonly op: 'add-state'; readonly parent: string; readonly key: string }
  | { readonly op: 'rename-state'; readonly state: string; readonly key: string }
  | { readonly op: 'remove-state'; readonly state: string }
  | { readonly op: 'set-initial'; readonly parent: string; readonly key: string }
  | {
      readonly op: 'add-transition';
      readonly source: string;
      readonly event: string;
      readonly target: string;
    }
  | { readonly op: 'retarget-transition'; readonly transition: string; readonly target: string }
  | { readonly op: 'rename-event'; readonly transition: string; readonly event: string }
  | { readonly op: 'remove-transition'; readonly transition: string };

/** Walk every state of a definition, root first. */
export function* machineStates(state: MachineState): Generator<MachineState> {
  yield state;
  for (const child of state.children) yield* machineStates(child);
}

export function findMachineState(root: MachineState, id: string): MachineState | null {
  for (const state of machineStates(root)) if (state.id === id) return state;
  return null;
}

export function findMachineTransition(root: MachineState, id: string): MachineTransition | null {
  for (const state of machineStates(root)) {
    for (const transition of state.transitions) if (transition.id === id) return transition;
  }
  return null;
}

/** The ids of every state active in an XState `StateValue` (`{ alive: { movement: 'run' } }`). */
export function activeStateIds(value: unknown, prefix = ''): string[] {
  const ids: string[] = [];
  const join = (key: string) => (prefix ? `${prefix}.${key}` : key);
  if (typeof value === 'string') {
    ids.push(join(value));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      ids.push(join(key));
      ids.push(...activeStateIds(child, join(key)));
    }
  }
  return ids;
}
