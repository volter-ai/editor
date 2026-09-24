/**
 * `Open Profiler` in the command palette — the same reveal as Debug ▸
 * Profiler, through the action point.
 */
import { profilerView } from '@editor/components/utility-view-state';
import type { ActionContribution } from '@vgai/editor-sdk/chrome';

export const point = 'workspace.action';

export const actions: ActionContribution['actions'] = [
  {
    id: 'profiler',
    label: 'Open Profiler',
    execute: () => profilerView.open('profiler'),
  },
];
