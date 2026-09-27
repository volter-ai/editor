/**
 * A CHROME SLOT IS A PLACE, NOT A PANEL — the third registry in the same
 * family as `workspace-document-restore.ts` (a kind owns its persisted state)
 * and `document-open-registry.ts` (a kind owns how it opens). Here: the host
 * owns WHERE something sits and how big it is; a package owns WHAT sits there.
 *
 * WHY IT EXISTS. The host's chrome had two places whose CONTENT was a product
 * opinion rather than a workbench concern: the `agent` static panel
 * (`components/workspace-static-panel-registry.tsx` imported
 * `ConversationPanel`) and the bottom bar beside the status line
 * (`components/EditorBottomBar.tsx` imported `HarnessConversationTray`). Both
 * are an AGENT-HARNESS conversation surface — it talks to coding harnesses, not
 * to a game, not to a document — so a base library for making IDEs should not
 * carry it, and neither of the two existing seams fits: it is not a document,
 * so it neither opens nor persists (WORK.md §The open-source launch, phase 1
 * unit 6 half A).
 *
 * WHAT A SLOT ID IS. A plain string in the host's own vocabulary, spelled at
 * the ONE host call site that renders the slot. The host declares the place in
 * its own layout inventory (`workspace-static-panels.ts` still lists the
 * `agent` panel's title, hotkey scope and placement, because the frame
 * PERSISTS panel ids and the tab's own chrome is the dock's); what it no
 * longer holds is the surface.
 *
 * NOTHING REGISTERED IS A REAL ANSWER. A build whose package list carries no
 * filler for a slot renders nothing there — the same honest emptiness a
 * document kind with no registered opener gives.
 */

import type { ComponentType } from 'react';

export interface ChromeSlotFiller {
  /** The place, in the host's vocabulary (`panel:agent`, `bottom-bar`). */
  readonly slot: string;
  /** Which module registered it. Re-registering the same owner+slot REPLACES,
   *  so an HMR re-evaluation leaves one filler, not two. */
  readonly owner: string;
  /** Ascending; ties keep registration order. */
  readonly order?: number;
  readonly Content: ComponentType;
}

const _fillers = new Map<string, ChromeSlotFiller[]>();
const listeners = new Set<() => void>();
let version = 0;

function publish(): void {
  version++;
  for (const listener of listeners) listener();
}

/** Install a filler. Returns the teardown. */
export function registerChromeSlot(filler: ChromeSlotFiller): () => void {
  const existing = _fillers.get(filler.slot) ?? [];
  const next = existing.filter((item) => item.owner !== filler.owner);
  next.push(filler);
  next.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  _fillers.set(filler.slot, next);
  publish();
  return () => {
    const current = _fillers.get(filler.slot);
    if (!current) return;
    const remaining = current.filter((item) => item !== filler);
    if (remaining.length === 0) _fillers.delete(filler.slot);
    else _fillers.set(filler.slot, remaining);
    publish();
  };
}

/** Everything registered for `slot`, in order. A stable array per version, so
 *  it is a safe `useSyncExternalStore` snapshot. */
export function chromeSlotFillers(slot: string): readonly ChromeSlotFiller[] {
  return _fillers.get(slot) ?? EMPTY;
}

const EMPTY: readonly ChromeSlotFiller[] = [];

export function subscribeChromeSlots(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function chromeSlotRegistryVersion(): number {
  return version;
}

/** Test-only reset (mirrors the restore and open registries' own). */
export function __resetChromeSlotsForTest(): void {
  _fillers.clear();
  publish();
}
