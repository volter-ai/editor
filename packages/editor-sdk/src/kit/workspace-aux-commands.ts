import { showWorkspaceAuxiliary } from '@volter/editor-sdk/kit/workspace-host-commands';

export function openUndoHistory(): void {
  showWorkspaceAuxiliary('undo-history');
}

export function installAuxiliaryEvents(): () => void {
  const onShowHistory = () => openUndoHistory();
  window.addEventListener('editor:show-history-tab', onShowHistory);
  return () => window.removeEventListener('editor:show-history-tab', onShowHistory);
}
