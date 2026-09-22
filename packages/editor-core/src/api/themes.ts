/**
 * Custom palette documents over the wire (`server/routes/themes.ts`): one
 * JSON file per theme under `~/.vgai/themes/` (user) and
 * `<project>/.vgai/themes/` (project) — both files the editor server owns.
 */
import { assertEditorServerResponse, editorServerJson } from '../editor-server-response';
import { BASE } from './base';
import type { SettingsLayer } from './settings';

export interface ThemeDocumentRead {
  readonly id: string;
  readonly path: string;
  readonly document: unknown;
}

export interface ThemeLayerRead {
  readonly documents: readonly ThemeDocumentRead[];
  /** Files that could not be read as JSON, spelled by path. */
  readonly issues: readonly string[];
}

export async function listThemeDocuments(layer: SettingsLayer): Promise<ThemeLayerRead> {
  const res = await fetch(`${BASE}/themes/${layer}`);
  return editorServerJson<ThemeLayerRead>(res, `Could not list ${layer} themes`);
}

export async function saveThemeDocument(
  layer: SettingsLayer,
  id: string,
  document: unknown,
): Promise<void> {
  const res = await fetch(`${BASE}/themes/${layer}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, document }),
  });
  assertEditorServerResponse(res, `Could not save the ${layer} theme ${id}`);
}

export async function deleteThemeDocument(layer: SettingsLayer, id: string): Promise<void> {
  const res = await fetch(`${BASE}/themes/${layer}?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  assertEditorServerResponse(res, `Could not delete the ${layer} theme ${id}`);
}
