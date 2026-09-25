/**
 * WHERE THE SETTINGS ARE: `IConfigurationService`, through a provider the
 * contribution installs here.
 *
 * Every setting is one dotted `vgai.*` name per LEAF of the settings document,
 * and the prefix is part of the key everywhere — in `EditorHost.settings`, in
 * `.vscode/settings.json`, in the Settings editor and in what a probe prints.
 * The table is DERIVED, never written: `@volter/editor-project/settings/keys` walks the
 * JSON Schema Zod itself produces, which is the same derivation
 * `npm run generate-schema` commits.
 *
 * The ADAPTER layer — the one thing that service does not already have — is
 * its own MEMORY target, which the platform merges ABOVE user; what puts the
 * PROJECT back above the adapter is an INSPECT GATE, re-evaluated on every
 * configuration change. See docs/CODE-OSS.md §The settings, under the frame.
 *
 * IT ARRIVES AFTER THE MOUNT, for the same reason the file provider does, and
 * a reader falls back to the store's own layers until it lands — which is why
 * a preference gesture made too early cannot write a `.vgai/settings.json` the
 * workbench knows nothing about.
 *
 * A provider's own change stream is subscribed HERE rather than by each
 * reader, so `subscribeSettingsProvider` is the one notification every consumer
 * of the store already listens to.
 */
import type {
  EditorHostSettingsInspection,
  EditorHostSettingsProvider,
} from '@volter/editor-sdk/host';

export type SettingsProvider = EditorHostSettingsProvider;
export type SettingsInspection = EditorHostSettingsInspection;

let provider: SettingsProvider | null = null;
const listeners = new Set<() => void>();
let stopProvider: (() => void) | null = null;

/**
 * Is the provider installed? False until it lands — later than the mount,
 * because a `ServicesAccessor` is valid only for a command's synchronous part,
 * so the contribution hands the provider over after the editor is running. In
 * that window a reader falls back to the store's own layers, which is why a
 * preference gesture made too early does not write a settings file the
 * workbench knows nothing about.
 */
export function settingsProviderInstalled(): boolean {
  return provider !== null;
}

/** The installed provider, or `null` before it lands. */
export function settingsProvider(): SettingsProvider | null {
  return provider;
}

/**
 * Install the configuration service the settings read and write through, or
 * `null` to withdraw it — the service is the workbench's, and a workbench that
 * went away takes it with it.
 *
 * A provider's own change stream is subscribed HERE rather than by each
 * reader, so `subscribeSettingsProvider` is the one notification every consumer
 * of the store already listens to — an adapter value clearing because a
 * project value appeared reaches the palette the same way a settings file
 * reload does.
 */
export function setSettingsProvider(next: SettingsProvider | null): void {
  if (provider === next) return;
  stopProvider?.();
  stopProvider = null;
  provider = next;
  if (provider) stopProvider = provider.subscribe(() => announce());
  announce();
}

function announce(): void {
  for (const listener of listeners) listener();
}

export function subscribeSettingsProvider(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
