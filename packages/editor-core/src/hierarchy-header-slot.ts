/**
 * The Hierarchy panel's controls do not belong to a row of their own.
 *
 * Blender's Outliner header is ONE row: the editor-type selector, the
 * display-mode selector, the search field, the filter popover and the
 * new-collection button all sit on the same strip, and the tree starts
 * directly under it. Ours had grown three rows — the dock group's tab strip
 * (Content · Hierarchy · Library, which IS Blender's editor-type selector),
 * a provenance breadcrumb, and a search row — for one panel's header.
 *
 * The tab strip is the row that stays, so the controls move ONTO it: this
 * module is the seam. The dock's `rightHeaderActionsComponent` publishes the
 * element it renders for the group whose ACTIVE panel is the Hierarchy
 * (`frame/bridge.tsx`'s outliner part), and `components/GameHierarchy.tsx`
 * portals its controls into it.
 *
 * It is a SLOT, not a control registry: the panel keeps owning its search
 * term, its expansion verbs and its Create menu, and nothing about them is
 * republished through module state. A host that renders the panel without a
 * dock — the design-system stories, a bounded host — publishes no element,
 * and the panel falls back to rendering its own toolbar row inline. That
 * fallback is the reason this is a DOM slot and not a props channel: there is
 * exactly one implementation of the controls either way.
 */

let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function hierarchyHeaderSlot(): HTMLElement | null {
  return slot;
}

export function subscribeHierarchyHeaderSlot(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setHierarchyHeaderSlot(element: HTMLElement | null): void {
  if (slot === element) return;
  slot = element;
  for (const listener of listeners) listener();
}

/** Clear only if THIS element is still the published one — a dock group that
 *  unmounts after its successor has already claimed the slot would otherwise
 *  blank a live header. */
export function clearHierarchyHeaderSlot(element: HTMLElement | null): void {
  if (slot !== element) return;
  setHierarchyHeaderSlot(null);
}
