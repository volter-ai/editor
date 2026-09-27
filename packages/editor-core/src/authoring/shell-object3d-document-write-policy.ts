/**
 * THE SHELL'S ANSWERS to `Object3DDocumentWritePolicy` — the composition the
 * editor installs at boot (`EditorContext.tsx`'s `EditorProvider`).
 *
 * `openPersistence` and `replaceSource` are one-line delegations to the
 * modules that already owned them. `saveThumbnailFraming` moved here WHOLE
 * from `components/Object3DDocumentToolbar.tsx` (nothing about it changed) —
 * merging `.vgai/thumbnails.json` is transport work end to end: read the
 * project's manifest, refuse an unreadable one, write the merged bytes back
 * through the project-file route.
 *
 * The point of the seam is only that the Asset Lab 3D document and its
 * toolbar no longer import the server SDK barrel, the project file history,
 * or the storage backend (ARCHITECTURE-CORE §Editor chrome, "the viewport
 * stack is separable").
 *
 * This file is the shell side of that boundary and is free to import all of
 * them.
 */

import {
  loadProjectThumbnailManifest,
  resetProjectThumbnailManifestCache,
  THUMBNAIL_MANIFEST_PATH,
  THUMBNAIL_PROFILE,
} from '@volter/editor-sdk/kit/asset-workflow/thumbnail-system';
import { workspaceHistoryService } from '@volter/editor-sdk/kit/components/workspace-history';
import { projectFiles } from '@volter/editor-sdk/kit/files/project-files';
import { getProjectFileHistory } from '@volter/editor-sdk/kit/history/project-file-history';
import { getProjectResourceHistoryBackend } from '@volter/editor-sdk/kit/history/project-root-history-backends';
import { replaceProjectSource } from '@volter/editor-sdk/kit/history/source-history-backend';
import type {
  Object3DDocumentThumbnailFraming,
  Object3DDocumentWritePolicy,
} from '@volter/editor-sdk/kit/object3d-document-write-policy';
import { sourceWriteBackendIfPrimed } from '@volter/editor-sdk/kit/ui-source/tier-source-write-backend';
import { openObject3DDocumentPersistence } from '@volter/editor-sdk/kit/authoring/object3d-document-persistence';

async function persistThumbnailFraming(
  assetPath: string,
  framing: Object3DDocumentThumbnailFraming | undefined,
): Promise<void> {
  const read = await loadProjectThumbnailManifest();
  // REFUSE rather than rebuild. `absent` and `unreadable` used to arrive as the
  // same `null`, so a manifest that merely failed to parse was treated as "no
  // manifest yet" and the write below replaced every framing entry in the
  // project with `{}`.
  if (read.status === 'unreadable') {
    throw new Error(
      `${THUMBNAIL_MANIFEST_PATH} is present but could not be read (${read.reason}). ` +
        'Refusing to overwrite it — fix or delete the file, then try again.',
    );
  }
  const manifest =
    read.status === 'ok'
      ? read.manifest
      : {
          version: 1 as const,
          profile: THUMBNAIL_PROFILE.version,
          generatedAt: new Date().toISOString(),
          entries: {},
        };
  const key = assetPath.replace(/^\/+/, '');
  const prior = manifest.entries[key] ?? {
    state: 'fallback' as const,
    profileVersion: THUMBNAIL_PROFILE.version,
    issueCode: 'thumbnail.pending-regeneration',
  };
  const updated = {
    ...manifest,
    // Re-stamp the profile that produced this rewrite while KEEPING every
    // existing entry; each entry's own `profileVersion` is what marks it stale.
    profile: THUMBNAIL_PROFILE.version,
    generatedAt: new Date().toISOString(),
    entries: {
      ...manifest.entries,
      [key]: { ...prior, framing },
    },
  };
  const content = `${JSON.stringify(updated, null, 2)}\n`;
  const history = workspaceHistoryService();
  const written = history
    ? await getProjectFileHistory(
        history,
        getProjectResourceHistoryBackend(),
        'project-resources',
      ).write(THUMBNAIL_MANIFEST_PATH, content, {
        label: `${framing ? 'Save' : 'Reset'} thumbnail framing ${assetPath}`,
        kind: 'project-file',
        contentType: 'application/json',
      })
    : await projectFiles.write(THUMBNAIL_MANIFEST_PATH, content).then(() => true);
  if (written) resetProjectThumbnailManifestCache();
}

export const SHELL_OBJECT3D_DOCUMENT_WRITE_POLICY: Object3DDocumentWritePolicy = {
  openPersistence: (options) => openObject3DDocumentPersistence(options),
  replaceSource: async (history, request) => {
    // The session's recorder, read per use rather than captured: it is
    // confirmed once at boot and a caller that captured it earlier would hold
    // `undefined` for the session (a human hit exactly that duplicating from
    // the Asset Editor — runhuman pass 41).
    const backend = sourceWriteBackendIfPrimed('The Asset Editor');
    if (!backend) throw new Error('This editor tier cannot write project source.');
    return replaceProjectSource(backend, history, request);
  },
  saveThumbnailFraming: persistThumbnailFraming,
};
