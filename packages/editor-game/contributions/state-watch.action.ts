/**
 * `Open State Watch` in the command palette — the same reveal as Debug ▸
 * State Watch. The host lists a contributed action unconditionally, so the
 * reveal is a no-op while nothing registers the tab (`available` gates it).
 */
import type { ActionContribution } from '@vgai/editor-sdk/chrome';
import { editorHost } from '@vgai/editor-sdk/host';

export const point = 'workspace.action';

export const actions: ActionContribution['actions'] = [
  {
    id: 'state-watch',
    label: 'Open State Watch',
    execute: () => editorHost().workspace.showUtility('tool:state-watch.utility'),
  },
];
