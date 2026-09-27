/** Presentation chosen by mounted layout code. No game or website names live here. */
import type { WorkspaceArrangement } from '@volter/editor-sdk/layout-arrangements';
import { activeProjectKey } from '@volter/editor-sdk/kit/active-project';
export interface LayoutPolicy {
  readonly immersivePlay?: boolean;
  readonly playUtilities?: readonly string[];
  readonly arrangement?: WorkspaceArrangement;
}
let owner: string | null = null;
let policy: LayoutPolicy | null = null;
const listeners = new Set<() => void>();
export function layoutPolicy(): LayoutPolicy | null {
  return owner === activeProjectKey() ? policy : null;
}
export function subscribeLayoutPolicy(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function installLayoutPolicy(next: LayoutPolicy): () => void {
  owner = activeProjectKey();
  policy = next;
  for (const listener of listeners) listener();
  return () => {
    if (policy !== next) return;
    policy = null;
    owner = null;
    for (const listener of listeners) listener();
  };
}
