/**
 * Generic Asset Lab persistence. Project code serializes its own native
 * document into ordinary files; this host-side bridge owns transaction
 * ordering, checksum preflight, compensation, and canonical undo/redo.
 */

import type { HistoryService } from '@volter/editor-sdk/kit/history/history-service';
import {
  getProjectFileHistory,
  type HistoryFileBackend,
  type ProjectFileMutation,
  type ProjectFileMutationSession,
} from '../history/project-file-history';
import { getProjectResourceHistoryBackend } from '../history/project-root-history-backends';
import { runWritePipe, type WriteAck, type WriteResolution } from '@volter/editor-sdk/kit/write-pipe';

/** One project-owned artifact participating in an Asset Lab commit. The document is whatever the
 *  medium hands its serializers (Three's is `ToolObject3DDocumentState`). */
export interface DocumentPersistenceResource<TDocument> {
  /** Project-root-relative destination. */
  readonly path: string;
  /** MIME type recorded in canonical history. */
  readonly contentType?: string;
  /** `null` removes the file in the same atomic transaction. */
  readonly serialize: (
    document: TDocument,
  ) => string | Uint8Array | null | Promise<string | Uint8Array | null>;
}

export interface DocumentPersistenceBinding<TDocument> {
  /** Default undo/redo label. A completed gesture may supply a narrower one. */
  readonly label?: string;
  /** Non-empty, path-unique set of files owned by this document. */
  readonly resources: readonly DocumentPersistenceResource<TDocument>[];
}

export interface OpenObject3DDocumentPersistenceOptions<TDocument = unknown> {
  readonly binding: DocumentPersistenceBinding<TDocument>;
  readonly document: TDocument;
  readonly history: HistoryService;
  readonly backend?: HistoryFileBackend;
}

async function serializeObject3DDocument<TDocument>(
  binding: DocumentPersistenceBinding<TDocument>,
  document: TDocument,
): Promise<ProjectFileMutation[]> {
  if (binding.resources.length === 0) {
    throw new Error('An Object3D document persistence binding must own at least one resource.');
  }
  const changes: ProjectFileMutation[] = [];
  for (const resource of binding.resources) {
    changes.push({
      path: resource.path,
      data: await resource.serialize(document),
      contentType: resource.contentType ?? 'application/octet-stream',
    });
  }
  return changes;
}

export interface Object3DDocumentPersistenceSession<TDocument = unknown> {
  /** Commit through the one persistence pipe, and answer for THIS commit.
   *  `persisted: false` means the serializers produced the bytes already on
   *  disk and nothing moved — a real outcome, not a failure (a failure throws). */
  commit(document: TDocument, label?: string): Promise<WriteAck>;
}

/** Where an Asset Lab document's bytes go — the binding's own resource paths,
 *  which is the finest-grained honest answer this lane has. */
function destinationOf<TDocument>(binding: DocumentPersistenceBinding<TDocument>): string {
  return binding.resources.map((resource) => resource.path).join(' + ');
}

/**
 * Establish the exact serialized bytes represented by a newly mounted native
 * document. Every later commit is checked against that mount-time baseline,
 * so a stale HMR module can never overwrite a newer sidecar on disk.
 */
export async function openObject3DDocumentPersistence<TDocument>(
  options: OpenObject3DDocumentPersistenceOptions<TDocument>,
): Promise<Object3DDocumentPersistenceSession<TDocument>> {
  const { binding, document, history } = options;
  const files = getProjectFileHistory(
    history,
    options.backend ?? getProjectResourceHistoryBackend(),
    'asset-lab-document',
  );
  const session: ProjectFileMutationSession = await files.openMutationSession(
    await serializeObject3DDocument(binding, document),
  );
  return {
    // THE ONE PIPE, this lane's plug: resolve (a binding with resources is a
    // real destination) → write (serialize + the file-mutation transaction) →
    // record (that transaction IS the history entry, so nothing more).
    commit: (nextDocument, requestedLabel) =>
      runWritePipe({
        resolve: (): WriteResolution => ({
          reaches: 'writer',
          // The document's own file is the anchor: no source literal addresses
          // it, and project code serializes the record the editor edited.
          anchorKind: 'data-record',
          destination: destinationOf(binding),
          write: async () => {
            // Check the mount-time bytes BEFORE entering project code. HMR can
            // invalidate a serializer's module-local state; a newer file must
            // still receive the canonical content-conflict refusal, never that
            // incidental serializer error and never an overwrite.
            await session.assertUnchanged();
            // Serialize before entering history: a failing project serializer
            // writes nothing and cannot advance the open-document checksum
            // baseline.
            const changes = await serializeObject3DDocument(binding, nextDocument);
            const label =
              requestedLabel?.trim() || binding.label?.trim() || 'Edit Asset Lab Document';
            return session.mutate(changes, { label });
          },
        }),
        record: () => undefined,
      }),
  };
}
