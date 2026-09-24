/**
 * Window ▸ Asset Budget — the document in the application menu, beside the
 * editor's own windows.
 */
import type { MenuContribution } from '@volter/editor-sdk/chrome';
import { openAssetBudgetDocument } from '../src/asset-budget/AssetBudgetPanel';

export const point = 'workspace.menu';

export const menu: MenuContribution = {
  menu: 'window',
  items: [
    {
      id: 'asset-budget',
      label: 'Asset Budget',
      testId: 'menu-asset-budget',
      execute: () => {
        openAssetBudgetDocument();
      },
    },
  ],
};
