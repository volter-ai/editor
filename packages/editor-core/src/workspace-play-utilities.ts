import { adapterEditorConfiguration } from './adapter-editor-config';
import { editorConsole } from './editor-console';
import { layoutPolicy } from './layout-policy';
import { captureWorkspaceUtilities, showWorkspaceUtility } from './workspace-host-commands';
import { activeChromeRegions } from './workspace-regions';
import { availableWorkspaceUtilities } from '@volter/editor-sdk/kit/workspace-utility-registry';

let contributionsReady = false;
let pending: readonly string[] = [];
let restore: (() => void) | undefined;

function flush(): void {
  if (!contributionsReady || pending.length === 0) return;
  const requested = pending;
  pending = [];
  if (activeChromeRegions().drawer === 'hidden') return;
  restore ??= captureWorkspaceUtilities(requested);
  const available = new Set(availableWorkspaceUtilities().map((utility) => utility.id));
  for (const id of requested) {
    if (available.has(id)) showWorkspaceUtility(id);
    else
      editorConsole.error(
        `vgai.adapter.ts: editor.playUtilities names unavailable utility "${id}".`,
        'adapter',
      );
  }
}

/** Discovery may finish after Play. No contribution kind implicitly opens a panel. */
export function publishPlayUtilitiesReady(ready: boolean): void {
  contributionsReady = ready;
  flush();
}

export function revealWorkspacePlayUtilities(): void {
  pending = layoutPolicy()?.playUtilities ?? adapterEditorConfiguration().playUtilities ?? [];
  flush();
}

export function cancelPendingWorkspacePlayUtilities(): void {
  pending = [];
  restore?.();
  restore = undefined;
}
