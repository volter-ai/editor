/**
 * The verbs an `asset.inspector` contribution offers for the asset it is
 * currently showing — published BY the section, because the section is what
 * knows.
 *
 * WHY NOT A STATIC EXPORT. The first shape of this was `export const
 * actions(asset)`, resolved synchronously beside `match(asset)`. It could
 * only filter on the path, while the section itself decides structurally —
 * the Edit Mesh door imports the module and calls `build()` — so the panel
 * and `inspect().quickActions` disagreed: measured 2026-09-03, every `src/**`
 * script offered "Edit mesh" through the control API while the human saw the
 * button on mesh modules alone. A verb the human cannot see is exactly what
 * `editor.inspect()` promises never to report, so the declaration moved to
 * where the answer is.
 *
 * The section calls `props.setActions(...)` when it knows (and `[]` when it
 * knows the answer is no); this store keys the list by contribution and
 * asset, so a stale answer for a previous selection can never be served, and
 * bumps a version `inspection/use-active-inspection.ts` subscribes to, the
 * same way the section registry does.
 */
import type { ToolAssetInspectorAction } from '@volter/editor-sdk/contributions';

interface Published {
  readonly assetPath: string;
  readonly actions: readonly ToolAssetInspectorAction[];
}

const published = new Map<string, Published>();
let version = 0;
const listeners = new Set<() => void>();

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** Publish (or clear) one contribution's verbs for the asset it is showing. */
export function setAssetInspectorActions(
  contributionId: string,
  assetPath: string,
  actions: readonly ToolAssetInspectorAction[],
): void {
  const current = published.get(contributionId);
  if (
    current &&
    current.assetPath === assetPath &&
    current.actions.length === actions.length &&
    current.actions.every((action, i) => action === actions[i])
  ) {
    return;
  }
  published.set(contributionId, { assetPath, actions });
  changed();
}

/** Forget a contribution's verbs (its section unmounted). */
export function clearAssetInspectorActions(contributionId: string): void {
  if (!published.delete(contributionId)) return;
  changed();
}

/** Every verb published FOR this asset, in contribution registration order.
 *  A list published for a different asset is ignored rather than served. */
export function assetInspectorActionsFor(assetPath: string): readonly ToolAssetInspectorAction[] {
  const out: ToolAssetInspectorAction[] = [];
  for (const entry of published.values()) {
    if (entry.assetPath !== assetPath) continue;
    out.push(...entry.actions);
  }
  return out;
}

export function subscribeAssetInspectorActions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function assetInspectorActionsVersion(): number {
  return version;
}

/** Test seam, mirroring the other module-scope stores. */
export function __resetAssetInspectorActionsForTest(): void {
  published.clear();
  version = 0;
}
