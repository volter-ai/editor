/**
 * Context contributed by the active typed Asset Editor to the existing editor
 * shell. Asset documents own content; the workspace owns placement. Keeping
 * this as a tiny external store lets the status bar and the workspace's
 * inspection surface resolution know WHICH document is active without an
 * Asset Editor recreating those panes inside the center.
 *
 * It carries FACTS ONLY — id, title, type, status. Never markup: an open
 * asset document is a SUBJECT PRODUCER, and what it produces goes through the
 * one composer into the one inspector box like everything else. A React node
 * put on this store would be a second, invisible way for a document to render
 * somewhere else, and there is exactly one.
 */

import { useSyncExternalStore } from 'react';
import { createHmrRegistrationGroup, type HmrRegistrationContext } from '@volter/editor-sdk/kit/hmr-registration-group';
import { registerWorkspaceStatus } from './workspace-status-registry';

export interface AssetEditorContextValue {
  readonly documentId: string;
  readonly title: string;
  readonly type: string;
  readonly status?: string;
}

interface ActiveAssetEditorContext extends AssetEditorContextValue {
  readonly token: symbol;
}

let active: ActiveAssetEditorContext | null = null;
let version = 0;
const listeners = new Set<() => void>();

function notifyChanged(): void {
  version++;
  for (const listener of listeners) listener();
}

export function subscribeAssetEditorContext(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function assetEditorContextVersion(): number {
  return version;
}

export function getActiveAssetEditorContext(): AssetEditorContextValue | null {
  return active;
}

/** Activate one document contribution. The returned disposer only clears the
 * exact activation it created, so an older tab unmount cannot erase a newer
 * active tab's context. */
export function activateAssetEditorContext(value: AssetEditorContextValue): () => void {
  const token = Symbol(value.documentId);
  active = { ...value, token };
  notifyChanged();
  return () => {
    if (active?.token !== token) return;
    active = null;
    notifyChanged();
  };
}

export function AssetEditorStatus() {
  useSyncExternalStore(subscribeAssetEditorContext, assetEditorContextVersion);
  const context = getActiveAssetEditorContext();
  return context?.status ? (
    <span className="vgai-status-copy" data-testid="status-asset-editor" data-status-tone="muted">
      {context.status}
    </span>
  ) : null;
}

const registrationGroup = createHmrRegistrationGroup(
  // Vite's HMR context when a dev server serves this module; the SDK carries no bundler types.
  (import.meta as ImportMeta & { hot?: HmrRegistrationContext }).hot,
  'asset-editor-shell-contributions',
);

export function ensureAssetEditorShellContributionsRegistered(): void {
  registrationGroup.ensure((track) => {
    track(
      registerWorkspaceStatus({
        id: 'asset-editor-status',
        name: 'Asset editor',
        align: 'left',
        order: 40,
        Content: AssetEditorStatus,
      }),
    );
  });
}

ensureAssetEditorShellContributionsRegistered();

export function __resetAssetEditorContextForTest(): void {
  active = null;
  notifyChanged();
}
