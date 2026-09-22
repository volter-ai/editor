/**
 * The active BREAKPOINT for style edits (design ledger: breakpoints) — a CSS
 * media condition like `(max-width: 767px)`, or null for base. While set,
 * react-world style edits land in the element's named-style rule inside that
 * `@media` block; the dev server's serve-time container-query rewrite is what
 * previews the result per frame width.
 *
 * MODULE state, not adapter state (measured): design-time re-renders recreate
 * the authoring adapters between the select gesture and the next style edit,
 * so an instance field silently reset to base — the select still showed the
 * breakpoint while the write landed unscoped. Session-scoped UI state, like
 * the transform mode; never persisted, never game truth.
 */

// globalThis-backed: the editor page can hold MORE THAN ONE instance of this
// module (measured: even after a cold load, the select's set and the
// adapter's read disagreed — the write landed unscoped while the select held
// the breakpoint), so module-local state is not a singleton here. One global
// slot is.
interface BreakpointGlobal {
  __vgaiActiveBreakpoint?: string | null;
  __vgaiBreakpointListeners?: Set<() => void>;
}
const g = globalThis as BreakpointGlobal;

function listeners(): Set<() => void> {
  g.__vgaiBreakpointListeners ??= new Set();
  return g.__vgaiBreakpointListeners;
}

export function activeBreakpoint(): string | null {
  return g.__vgaiActiveBreakpoint ?? null;
}

export function setActiveBreakpoint(media: string | null): void {
  g.__vgaiActiveBreakpoint = media;
  for (const listener of listeners()) listener();
}

export function subscribeBreakpoint(listener: () => void): () => void {
  listeners().add(listener);
  return () => listeners().delete(listener);
}
