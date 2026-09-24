/**
 * `Open Asset Budget` in the command palette — the same document Window ▸
 * Asset Budget opens, through the action point.
 */
import type { ActionContribution } from '@vgai/editor-sdk/chrome';
import { openAssetBudgetDocument } from '../src/asset-budget/AssetBudgetPanel';

export const point = 'workspace.action';

export const actions: ActionContribution['actions'] = [
  {
    id: 'asset-budget',
    label: 'Open Asset Budget',
    execute: () => {
      openAssetBudgetDocument();
    },
  },
];
