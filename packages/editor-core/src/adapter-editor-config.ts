import type { AdapterEditorConfiguration } from '@volter/editor-project/adapter/adapter-module';
import { activeProjectKey } from '@volter/editor-sdk/kit/active-project';

// Published by the adapter loader; consumers need no dependency on its module graph.
let configuration: AdapterEditorConfiguration = {};
let owner: string | null = null;
const EMPTY: AdapterEditorConfiguration = Object.freeze({});
const listeners = new Set<() => void>();

export function adapterEditorConfiguration(): AdapterEditorConfiguration {
  return owner !== null && owner === activeProjectKey() ? configuration : EMPTY;
}

export function setAdapterEditorConfiguration(value: AdapterEditorConfiguration = {}): void {
  owner = activeProjectKey();
  configuration = value;
  for (const listener of listeners) listener();
}

export function subscribeAdapterEditorConfiguration(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
