/**
 * Debug ▸ Profiler — the menu item that selects the bench's Profiler view and
 * reveals the drawer tab this package contributes. The host namespaces every
 * contributed id under `tool:`, so the utility revealed is
 * `tool:profiler.utility` (`profilerView.open` names it).
 */
import { profilerView } from '@editor/components/utility-view-state';
import type { MenuContribution } from '@vgai/editor-sdk/chrome';

export const point = 'workspace.menu';

export const menu: MenuContribution = {
  menu: 'debug',
  items: [
    {
      id: 'profiler',
      label: 'Profiler',
      testId: 'menu-profiler',
      execute: () => profilerView.open('profiler'),
    },
  ],
};
