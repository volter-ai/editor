/**
 * Debug ▸ Inspect Behavior — opens the first truthful live actor as the
 * Behavior document. Disabled while no live actor is registered, which is the
 * same predicate the open path itself refuses on; `disabled` is asked at
 * render, so it follows the session.
 */
import type { MenuContribution } from '@vgai/editor-sdk/chrome';
import { listLiveBehaviors, openFirstBehaviorDocument } from '../src/xstate/live-behaviors';

export const point = 'workspace.menu';

export const menu: MenuContribution = {
  menu: 'debug',
  items: [
    {
      id: 'inspect-behavior',
      label: 'Inspect Behavior',
      testId: 'menu-inspect-behavior',
      disabled: () => listLiveBehaviors().length === 0,
      execute: () => void openFirstBehaviorDocument(),
    },
  ],
};
