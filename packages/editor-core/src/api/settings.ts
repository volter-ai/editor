/**
 * The two shared settings layers over the wire (`server/routes/settings.ts`):
 * `~/.vgai/settings.json` (user) and `<project>/.vgai/settings.json`
 * (project), both files the editor server owns.
 */
import type { EditorSettings } from '@volter/editor-project/settings/schema';
import { assertEditorServerResponse, editorServerJson } from '../editor-server-response';
import { BASE } from './base';

export type SettingsLayer = 'user' | 'project';

export interface SettingsLayerRead {
  readonly settings: EditorSettings;
  /** Problems with the stored document, spelled for the person who owns it. */
  readonly issues: readonly string[];
  /** Where the layer lives, for the issue report. */
  readonly path: string | null;
}

export async function loadSettingsLayer(layer: SettingsLayer): Promise<SettingsLayerRead> {
  const res = await fetch(`${BASE}/settings/${layer}`);
  return editorServerJson<SettingsLayerRead>(res, `Could not read ${layer} settings`);
}

export async function saveSettingsLayer(
  layer: SettingsLayer,
  settings: EditorSettings,
): Promise<void> {
  const body = JSON.stringify(settings, null, 2);
  const res = await fetch(`${BASE}/settings/${layer}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  assertEditorServerResponse(res, `Could not save ${layer} settings`);
}
