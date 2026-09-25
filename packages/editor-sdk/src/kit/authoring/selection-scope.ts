import type { AuthoringAdapter, EditorNode } from '@volter/editor-project/adapter';
import { setAuthoringSelection } from './consumer-actions';

/** Session-only contents scope shared by hierarchy, viewport picking, and
 * hotkeys. The adapter remains the source of hierarchy/ownership truth; this
 * module only records which semantic boundary the user has opened. */
interface SelectionScopeState {
  adapter: AuthoringAdapter;
  stack: string[];
}

let state: SelectionScopeState | null = null;
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function isScopeNode(node: EditorNode | null): boolean {
  return (
    !!node && (node.role === 'component' || node.role === 'instance' || node.role === 'boundary')
  );
}

function isDescendant(adapter: AuthoringAdapter, id: string, ancestorId: string): boolean {
  let current: string | null = id;
  let guard = 0;
  while (current && guard++ < 1000) {
    if (current === ancestorId) return true;
    current = adapter.hierarchy.node(current)?.parentId ?? null;
  }
  return false;
}

export function subscribeSelectionScope(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function selectionScopeVersion(): number {
  return version;
}

/** Current boundary id for pick resolution. Deliberately adapter-agnostic:
 * layered picking resolves through a composite's child adapter while the
 * hierarchy owns the composite adapter that opened the scope. */
export function currentSelectionScopeId(): string | null {
  return state?.stack.at(-1) ?? null;
}

export function selectionScopeStack(adapter: AuthoringAdapter): string[] {
  if (state?.adapter !== adapter) return [];
  const valid = state.stack.filter((id) => adapter.hierarchy.node(id) !== null);
  if (valid.length !== state.stack.length) {
    state = valid.length > 0 ? { adapter, stack: valid } : null;
  }
  return valid;
}

export function enterSelectionScope(adapter: AuthoringAdapter, id: string): boolean {
  const node = adapter.hierarchy.node(id);
  if (!isScopeNode(node) || node!.childIds.length === 0) return false;

  const current = state?.adapter === adapter ? state.stack : [];
  const parentScope = current.at(-1);
  if (parentScope && !isDescendant(adapter, id, parentScope)) return false;
  if (parentScope === id) return false;
  state = { adapter, stack: [...current, id] };
  setAuthoringSelection(adapter, [id]);
  emit();
  return true;
}

/** Navigate to an existing breadcrumb boundary, or null for the full Game. */
export function setSelectionScope(adapter: AuthoringAdapter, id: string | null): void {
  if (id === null) {
    if (state === null) return;
    state = null;
    emit();
    return;
  }
  const current = selectionScopeStack(adapter);
  const index = current.indexOf(id);
  if (index < 0) return;
  state = { adapter, stack: current.slice(0, index + 1) };
  setAuthoringSelection(adapter, [id]);
  emit();
}

export function exitSelectionScope(adapter: AuthoringAdapter): boolean {
  if (state && state.adapter !== adapter) {
    state = null;
    emit();
    return true;
  }
  const current = selectionScopeStack(adapter);
  if (current.length === 0) return false;
  const next = current.slice(0, -1);
  state = next.length > 0 ? { adapter, stack: next } : null;
  const selectionId = next.at(-1) ?? current[0]!;
  setAuthoringSelection(adapter, [selectionId]);
  emit();
  return true;
}

export function enterSelectedScope(adapter: AuthoringAdapter): boolean {
  const selected = adapter.selection?.get() ?? [];
  return selected.length === 1 ? enterSelectionScope(adapter, selected[0]!) : false;
}

/**
 * Drill in ONE level (the viewport's double-click, Figma's own gesture): open
 * `boundaryId`'s scope, then select whatever the SAME pointer resolves to now
 * that the scope is open.
 *
 * `repick` is the caller's own pick — `layered-pick.ts` already passes
 * `currentSelectionScopeId()` into `SelectionProvider.resolve`, and the
 * adapter's resolve already answers with the next member down its own owner
 * chain. So there is no second chain-walking rule here, and this module still
 * knows nothing about how a surface picks. Repeat the gesture to keep
 * descending; {@link exitSelectionScope} (Escape) walks back out.
 */
export function drillIntoSelectionScope(
  adapter: AuthoringAdapter,
  boundaryId: string,
  repick: () => string | null,
): boolean {
  if (!enterSelectionScope(adapter, boundaryId)) return false;
  // `enterSelectionScope` already selected the boundary; a deeper member under
  // the same pointer is what the gesture actually asked for. When the chain
  // ends here the boundary stays selected — entering was still correct.
  const deeper = repick();
  if (deeper && deeper !== boundaryId) setAuthoringSelection(adapter, [deeper]);
  return true;
}

/**
 * Figma's outside-click rule: a click that lands outside an open scope leaves
 * it. Pops every entry whose boundary does not CONTAIN `id`, so the stack
 * follows the click to the level that does; a `null` id (empty space) closes
 * every scope.
 *
 * Selection stays the caller's to set — the pick that produced `id` was
 * already resolved against the scope that was open (a chain without the scope
 * in it resolves to its own outermost owner), so this only makes the stack
 * agree with where the click landed.
 */
export function popSelectionScopesToContain(adapter: AuthoringAdapter, id: string | null): boolean {
  const current = selectionScopeStack(adapter);
  if (current.length === 0) return false;
  let depth = 0;
  while (id !== null && depth < current.length && isDescendant(adapter, id, current[depth]!)) {
    depth += 1;
  }
  if (depth === current.length) return false;
  state = depth > 0 ? { adapter, stack: current.slice(0, depth) } : null;
  emit();
  return true;
}

/**
 * ONE click's answer, across the scope exit the click itself causes — the
 * whole of the viewport's single-click resolution.
 *
 * A pick resolves against whatever scope is OPEN (`layered-pick.ts` hands
 * `currentSelectionScopeId()` to the adapter's own resolve), so a click that
 * leaves the innermost scope was resolved by a scope that is about to be
 * wrong. With a one-deep stack that is invisible — popping lands at "no
 * scope", which is what the stale answer already assumed. With a stack THREE
 * deep it is visible: the stale resolve answers with the chain's outermost
 * owner, one level shallower than the same click gives once the stack has
 * followed it, so the user has to click twice to land where one click should
 * have (reviewer, #1235).
 *
 * So: resolve, let {@link popSelectionScopesToContain} follow the hit, and
 * re-resolve ONCE — only when the stack actually moved, because a click that
 * stays inside the open scope has nothing to re-resolve against. The second
 * answer needs no second pop: it is a member of the scope the first pop
 * settled on.
 */
export function pickAcrossScopeExit(
  adapter: AuthoringAdapter,
  repick: () => string | null,
): string | null {
  const hit = repick();
  return popSelectionScopesToContain(adapter, hit) ? repick() : hit;
}

/** Test-only reset; production scope is intentionally session-local. */
export function _resetSelectionScopeForTest(): void {
  state = null;
  emit();
}
