import type {
  ToolAssetInspectorAction,
  ToolAssetInspectorContributionProps,
  ToolContributionAsset,
} from '@volter/editor-sdk/contributions';
import { EditorIcon, editorIcons, groupLabelStyle } from '@volter/editor-sdk/widgets';
import { type ComponentType, useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { accountVersion, contributionAccount, subscribeAccount } from '@volter/editor-sdk/kit/account-client';
import { clearAssetInspectorActions, setAssetInspectorActions } from '../asset-inspector-actions';
import {
  assetSelectionVersion,
  getSelectedAsset,
  subscribeAssetSelection,
} from '@volter/editor-sdk/kit/asset-selection';
import { notify } from '../editor-notifications';
import { beginPageWork } from '../play-boot-phase';
import type { ProjectToolCatalogEntry } from '@volter/editor-sdk/kit/project-tools';
import {
  subscribeToolContributionPlay,
  toolContributionPlay,
  toolContributionPlayKey,
} from '@volter/editor-sdk/kit/tool-contribution-play';
import { getToolContributionClient } from '../tool-loader';
import { toolContributionSurfaces } from '@volter/editor-sdk/kit/components/ToolContributionSurfaces';
import { ToolErrorBoundary } from './ToolHost';

function selectedAsset(): ToolContributionAsset | null {
  const asset = getSelectedAsset();
  if (!asset) return null;
  return {
    path: asset.path,
    name: asset.name,
    kind: asset.kind,
    origin: asset.origin ?? 'project',
    ...(asset.sourcePath ? { sourcePath: asset.sourcePath } : {}),
  };
}

/** Publish this section's verbs while it is mounted, and forget them when it
 *  goes away — a list that outlived its section would be a verb the human
 *  can no longer see (`asset-inspector-actions.ts`). */
function useAssetInspectorActions(
  id: string,
  assetPath: string | null,
): (actions: readonly ToolAssetInspectorAction[]) => void {
  useEffect(() => () => clearAssetInspectorActions(id), [id]);
  return useCallback(
    (actions: readonly ToolAssetInspectorAction[]) => {
      if (assetPath === null) return;
      setAssetInspectorActions(id, assetPath, actions);
    },
    [id, assetPath],
  );
}

export function AssetInspectorToolSection({
  id,
  title,
  file,
  tool,
  Component,
}: {
  id: string;
  title: string;
  file: string;
  tool?: ProjectToolCatalogEntry | undefined;
  Component: ComponentType<ToolAssetInspectorContributionProps>;
}) {
  useSyncExternalStore(subscribeAssetSelection, assetSelectionVersion);
  useSyncExternalStore(subscribeAccount, accountVersion, accountVersion);
  useSyncExternalStore(
    subscribeToolContributionPlay,
    toolContributionPlayKey,
    toolContributionPlayKey,
  );
  const asset = selectedAsset();
  const setActions = useAssetInspectorActions(id, asset?.path ?? null);
  // The same two host doors ToolHost hands every other contribution: a
  // notice card keyed by title, and the main-thread work announcement. This
  // section assembled its own props and had neither, so a model probe that
  // spun the page for 45 s stalled every command with no phase named
  // (2026-09-06).
  const endWorkRef = useRef<(() => void) | null>(null);
  const work = useCallback((label: string | null) => {
    endWorkRef.current?.();
    endWorkRef.current =
      label === null ? null : beginPageWork(`building ${label.replace(/^building /, '')}`);
  }, []);
  useEffect(() => () => endWorkRef.current?.(), []);
  const notifyCard = useCallback(
    (notice: { tone: 'info' | 'warning' | 'error'; title: string; detail?: string }) =>
      notify({
        ...notice,
        id: `contribution:${id}:${notice.title}`,
        ...(notice.tone === 'warning' ? { fades: true } : {}),
      }),
    [id],
  );
  return (
    <div
      data-testid={`asset-inspector-tool-${id}`}
      style={{ padding: 8, borderTop: '1px solid var(--vgai-structural-divider)', marginTop: 4 }}
    >
      <div style={{ ...groupLabelStyle, marginBottom: 4 }}>
        <EditorIcon icon={editorIcons.tool.extension} tone="muted" style={{ marginRight: 4 }} />
        {title}
      </div>
      <ToolErrorBoundary file={file}>
        <Component
          {...(tool ? { tool } : {})}
          contributionId={id.slice(id.lastIndexOf(':') + 1)}
          client={getToolContributionClient()}
          surfaces={toolContributionSurfaces}
          account={contributionAccount()}
          play={toolContributionPlay()}
          asset={asset}
          setActions={setActions}
          notify={notifyCard}
          work={work}
        />
      </ToolErrorBoundary>
    </div>
  );
}
