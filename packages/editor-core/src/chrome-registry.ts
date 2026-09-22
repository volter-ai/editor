/**
 * CONTRIBUTED CHROME — the registry behind `@volter/editor-sdk/chrome`: the
 * palette actions, application-menu items and header items a package
 * contributes.
 *
 * WHO READS IT, measured rather than assumed: `palette-action-publisher.tsx`
 * takes {@link contributedActions} into the table the frame registers as
 * `MenuId.CommandPalette` items (so ⌘⇧P lists a package's actions with its own
 * labels); `components/ApplicationMenus.tsx` appends
 * {@link contributedMenuItems} per menu id; `components/ProjectHeader.tsx` and
 * `components/Object3DDocumentToolbar.tsx` draw {@link contributedHeaderItems}
 * in the title bar and the document's own strip; `tool-loader.ts` registers
 * what a package declares. Ids are namespaced `tool:` so they never collide
 * with the host's.
 */

import type {
  ActionContribution,
  ContributableMenu,
  ContributedAction,
  ContributedMenuItem,
  DocumentHeaderItemProps,
  HeaderPlacement,
  MenuContribution,
} from '@volter/editor-sdk/chrome';
import type { ComponentType } from 'react';

const CONTRIBUTABLE_MENUS: readonly ContributableMenu[] = [
  'asset',
  'view',
  'window',
  'debug',
  'tools',
  'help',
];

export interface ContributedHeaderItem {
  readonly id: string;
  readonly order: number;
  readonly placement: HeaderPlacement;
  readonly Component: ComponentType<DocumentHeaderItemProps>;
}

let headerItems: ContributedHeaderItem[] = [];
let actionRegistrations: readonly ActionContribution[] = [];
let menuItems: Array<{ menu: ContributableMenu; item: ContributedMenuItem }> = [];
let version = 0;
const listeners = new Set<() => void>();
function notify(): void {
  version++;
  for (const listener of listeners) listener();
}

export function subscribeContributedChrome(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function contributedChromeVersion(): number {
  return version;
}

/** Header items in `order`, ties by registration. */
export function contributedHeaderItems(
  placement: HeaderPlacement = 'transport',
): readonly ContributedHeaderItem[] {
  return headerItems
    .filter((item) => item.placement === placement)
    .sort((a, b) => a.order - b.order);
}

/** Register one header item (`.header.tsx`, `tool:<id>`). Returns the unregister. */
export function registerContributedHeaderItem(item: ContributedHeaderItem): () => void {
  if (headerItems.some((existing) => existing.id === item.id))
    throw new Error(`header item "${item.id}" is already contributed.`);
  headerItems = [...headerItems, item];
  notify();
  return () => {
    headerItems = headerItems.filter((existing) => existing !== item);
    notify();
  };
}

export function contributedActions(): readonly ContributedAction[] {
  const seen = new Set<string>();
  const out: ContributedAction[] = [];
  for (const registration of actionRegistrations) {
    const list =
      typeof registration.actions === 'function' ? registration.actions() : registration.actions;
    for (const action of list) {
      const id = `tool:${action.id}`;
      // A live set may repeat a static id across its own reads; first wins.
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ ...action, id });
    }
  }
  return out;
}

export function contributedMenuItems(menu: ContributableMenu): readonly ContributedMenuItem[] {
  return menuItems.filter((entry) => entry.menu === menu).map((entry) => entry.item);
}

export function isContributableMenu(value: unknown): value is ContributableMenu {
  return typeof value === 'string' && (CONTRIBUTABLE_MENUS as readonly string[]).includes(value);
}

/**
 * Register a contribution's actions, each under `tool:<id>`. A fixed list is
 * checked for duplicate ids now; a live one (`actions` as a function) is read
 * on every listing and re-listed whenever its `subscribe` fires. Returns the
 * unregister.
 */
export function registerContributedActions(contribution: ActionContribution): () => void {
  if (typeof contribution.actions !== 'function') {
    const listed = contributedActions();
    for (const action of contribution.actions)
      if (listed.some((existing) => existing.id === `tool:${action.id}`))
        throw new Error(`action "tool:${action.id}" is already contributed.`);
  }
  actionRegistrations = [...actionRegistrations, contribution];
  const stop = contribution.subscribe?.(notify);
  notify();
  return () => {
    stop?.();
    actionRegistrations = actionRegistrations.filter((existing) => existing !== contribution);
    notify();
  };
}

/** Register a contribution's menu items on one menu. Returns the unregister. */
export function registerContributedMenu(contribution: MenuContribution): () => void {
  const added = contribution.items.map((item) => ({
    menu: contribution.menu,
    item: { ...item, id: `tool:${item.id}` },
  }));
  for (const entry of added)
    if (menuItems.some((existing) => existing.item.id === entry.item.id))
      throw new Error(`menu item "${entry.item.id}" is already contributed.`);
  menuItems = [...menuItems, ...added];
  notify();
  return () => {
    menuItems = menuItems.filter((entry) => !added.includes(entry));
    notify();
  };
}

/**
 * A fingerprint of every contributed item's CURRENT `disabled` answer, across
 * every menu. The point (`@volter/editor-sdk/chrome`) promises that `disabled`
 * is asked at render and may follow session state — which is only true if
 * something re-renders the bar when that state moves. `ApplicationMenus`
 * samples this on the shared availability tick while a menu is OPEN, so an
 * item can go live or dead under the cursor and costs nothing when closed.
 */
export function contributedDisabledFingerprint(): string {
  return menuItems.map((entry) => (entry.item.disabled?.({}) ? '1' : '0')).join('');
}
