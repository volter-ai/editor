/**
 * THE CHROME POINTS — palette actions and menu items a package contributes
 * (WORKBENCH.md §Contribution points). Both are data: an id, a label and what
 * happens on choose. The host renders them where its own live: a contributed
 * action in the command palette beside the editor's, a contributed item at the
 * end of the named application menu.
 *
 *   `profiler.action.ts`   export const point = 'workspace.action';  export const actions: ActionContribution['actions']
 *   `navmesh.menu.ts`      export const point = 'workspace.menu';    export const menu: MenuContribution
 *
 * A contribution's id is namespaced by the host under `tool:` like a
 * utility's, so it can never collide with an editor action. `disabled` is
 * asked at render, so an item may follow session state (a bake that has no
 * navigation adapter to run on).
 */

import type { EditorKeyActionId } from '@volter/editor-project/adapter/editor-looks';

export interface ContributedAction {
  readonly id: string;
  readonly label: string;
  readonly execute: () => void | Promise<void>;
  /** The key action this entry also is: the palette prints that action's chord
   *  in the ACTIVE keymap beside it. */
  readonly shortcut?: EditorKeyActionId;
}

export interface ActionContribution {
  /**
   * The palette actions — a fixed list, or a function for a LIVE set (one
   * action per running XState actor): the host asks it when the palette
   * opens and again whenever `subscribe` fires, the way a menu item's
   * `disabled` is asked at render.
   */
  readonly actions: readonly ContributedAction[] | (() => readonly ContributedAction[]);
  /** Fires when a live `actions` set moved. Returns the unsubscribe. */
  readonly subscribe?: (listener: () => void) => () => void;
}

/** The application menus a package may append to (`edit` is the host's
 *  own — its verbs are the history's and the selection's), and `asset`: the
 *  Asset Browser's context menu on one asset, whose items receive the asset. */
export type ContributableMenu = 'view' | 'window' | 'debug' | 'tools' | 'help' | 'asset';

/** What a context menu's item is invoked ON. Empty for the application menus. */
export interface MenuSubject {
  /** The project-relative path of the asset the `asset` menu opened on. */
  readonly assetPath?: string;
}

export interface ContributedMenuItem {
  readonly id: string;
  readonly label: string | (() => string);
  readonly execute: (subject: MenuSubject) => void | Promise<void>;
  readonly disabled?: (subject: MenuSubject) => boolean;
  /** A `data-testid` for the item, when a driver needs to find it. */
  readonly testId?: string;
}

export interface MenuContribution {
  readonly menu: ContributableMenu;
  readonly items: readonly ContributedMenuItem[];
}

/**
 * A HEADER item (`.header.tsx`, `point = 'workspace.header'`): a component
 * the host renders in the project header's transport cluster, in `order`.
 * The Play transport is the worked case — a package that plays a game puts
 * its play/pause/stop there; a project that declares nothing to run has an
 * empty cluster.
 */
export interface HeaderContribution {
  readonly order?: number;
  /**
   * Where the item renders: the project header's transport cluster (the
   * default), or the 3D document's toolbar (`object3d-document`), where the
   * component receives the open document's id and resolves its subject through
   * its own integration. A runtime debug toggle on a mounted model lives there.
   */
  readonly placement?: HeaderPlacement;
}

export type HeaderPlacement = 'transport' | 'object3d-document';

/** What a `object3d-document` header item is rendered with. */
export interface DocumentHeaderItemProps {
  readonly documentId: string;
}
