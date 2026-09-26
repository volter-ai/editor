import { Button } from '@volter/editor-sdk/widgets';
import { useSyncExternalStore } from 'react';
import {
  activeSaveDestination,
  activeSaveFailure,
  activeSaveState,
  saveActiveAuthoring,
} from '@volter/editor-sdk/kit/authoring/shell-document-ops';
import { useEditorStore, useOptionalHistoryService } from '@volter/editor-sdk/kit/editor-runtime';
import { showConsoleUtility } from '../workspace-utility-commands';

const subscribeToNothing = () => () => undefined;
const noHistorySnapshot = () => null;

/**
 * Compact save-status affordance for the status bar. Surfaces whether the
 * ACTIVE authoring adapter has unsaved edits. Click to force a save (also bound
 * to Cmd/Ctrl+S).
 */
export function SaveStatus() {
  const store = useEditorStore();
  const history = useOptionalHistoryService();
  useSyncExternalStore(store.subscribe, store.getShellSnapshot ?? store.getSnapshot);
  // Source writes clear HistoryService.lastError only after the async commit
  // succeeds. Subscribe directly so the red failure state clears at that
  // exact point rather than waiting for an unrelated store/HMR notification.
  useSyncExternalStore(
    history?.subscribe ?? subscribeToNothing,
    history?.getSnapshot ?? noHistorySnapshot,
    history?.getSnapshot ?? noHistorySnapshot,
  );
  const state = activeSaveState(store);
  // Success is the steady state, not an alert. Keep the status bar quiet
  // until there is unsaved work or a failure requiring attention.
  if (state === 'saved') return null;
  // Destination is the active adapter's own — never a hard-coded path — so
  // the status honestly reflects where a save (or autosave) would actually go.
  const destination = activeSaveDestination(store);

  const failed = state === 'failed';
  const failure = failed ? activeSaveFailure(store) : null;
  const config = failed
    ? {
        label: 'Save failed',
        title: failure
          ? `Save failed: ${failure} — click to open Console`
          : 'Save failed — click to open Console',
      }
    : {
        label: 'Unsaved',
        title: 'Unsaved changes — click to save (Cmd/Ctrl+S)',
      };
  const title = destination ? `${config.title} — ${destination}` : config.title;

  return (
    <Button
      type="button"
      data-testid="save-status"
      data-save-state={state}
      variant="ghost"
      size="compact"
      className="vgai-save-status"
      onClick={() => (failed ? showConsoleUtility() : void saveActiveAuthoring(store))}
      title={title}
    >
      <span className="vgai-save-status-dot" />
      {config.label}
    </Button>
  );
}
