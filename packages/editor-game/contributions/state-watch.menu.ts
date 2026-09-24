/**
 * Debug ▸ State Watch — disabled while no game exposes a `DebugAdapter`, the
 * same predicate the drawer tab's own `available` gate reads. `disabled` is
 * asked at render, so it follows the session.
 */
import { getActiveDebug } from '@editor/authoring/active-systems';
import type { MenuContribution } from '@vgai/editor-sdk/chrome';
import { editorHost } from '@vgai/editor-sdk/host';

export const point = 'workspace.menu';

export const menu: MenuContribution = {
  menu: 'debug',
  items: [
    {
      id: 'state-watch',
      label: 'State Watch',
      testId: 'menu-state-watch',
      disabled: () => getActiveDebug() == null,
      execute: () => editorHost().workspace.showUtility('tool:state-watch.utility'),
    },
  ],
};
