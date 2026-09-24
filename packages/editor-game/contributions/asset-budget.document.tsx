/**
 * THE ASSET BUDGET (`workspace.document`) — what a project's shipped assets
 * cost: per-asset size, VRAM estimate, triangle count, who references it, and
 * the glTF/KTX2 optimizers that rewrite it. A singleton center document,
 * opened from Window ▸ Asset Budget, the palette, or an asset's own context
 * menu (`asset-budget-asset.menu.ts`, which hands it the asset's path).
 *
 * It ships with `@vgai/game` because a budget is a GAME's question — what the
 * player downloads and what the GPU holds. A folder of models has no shipped
 * asset set and no Asset Budget tab.
 */

import type { ToolContributionProps } from '@vgai/editor-sdk/contributions';
import { AssetBudgetPanel } from '../src/asset-budget/AssetBudgetPanel';

export const point = 'workspace.document';
export const title = 'Asset Budget';

export default function AssetBudgetDocument(_props: ToolContributionProps) {
  return <AssetBudgetPanel />;
}
