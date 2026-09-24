/**
 * `Open in Asset Budget` on ONE asset — the Asset Browser's `asset` context
 * menu (`@vgai/editor-sdk/chrome`), whose items are invoked with the asset's
 * project path. It was a built-in item in `AssetBrowser.tsx`; the budget is
 * this package's document, so the item is this package's too, and a models
 * project's context menu simply does not carry it.
 */
import type { MenuContribution } from '@vgai/editor-sdk/chrome';
import { openAssetBudgetDocument } from '../src/asset-budget/AssetBudgetPanel';

export const point = 'workspace.menu';

export const menu: MenuContribution = {
  menu: 'asset',
  items: [
    {
      id: 'open-budget',
      label: 'Open in Asset Budget',
      testId: 'asset-context-open-budget',
      execute: ({ assetPath }) => {
        if (assetPath === undefined) return;
        openAssetBudgetDocument(assetPath);
      },
    },
  ],
};
