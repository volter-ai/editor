/**
 * WHAT THE ASSET LAB 3D DOCUMENT ASKS THE SHELL — the one collaborator
 * `StageHost.tsx` (with its toolbar) declares and the shell
 * installs at boot.
 *
 * ARCHITECTURE-CORE §Editor chrome, "The viewport stack is separable": a
 * surface below the shell never imports the shell's transport, a world
 * authoring adapter, or project discovery. The 3D document was importing four
 * modules to answer three questions —
 *
 *   · where do this document's own bytes go? (`object3d-document-persistence`
 *     → project file history → the resource history backend)
 *   · how do I replace a whole SOURCE file? (`ui-source/tier-source-write-backend`
 *     for the tier's recorder + `history/source-history-backend` to run it)
 *   · where does a thumbnail framing get recorded? (`asset-workflow/thumbnail-system`
 *     to read `.vgai/thumbnails.json` + `components/asset-editor-persistence`
 *     to write it, which reaches `editor-api.ts`)
 *
 * — and every one of those is TRANSPORT. Measured, those edges were 72 of the
 * document's 213 files, all of them behind the server SDK barrel; the document
 * itself only ever needed "hand these bytes to the project and tell me whether
 * one moved".
 *
 * ## The default is the NO-SHELL answer, and it is deliberate
 *
 * {@link DEFAULT_OBJECT3D_DOCUMENT_WRITE_POLICY} is what a document mounted
 * with no shell above it (a bounded host; a fixture) gets: there is no
 * project to write to, so each member REFUSES by name rather than
 * half-answering. Every call site here already renders a refusal — the
 * document's error state, the toolbar's error banner — because the same
 * refusal is what a read-only tier produced before this seam existed
 * ("This editor tier cannot write project source").
 *
 * In the editor the shell policy is installed once by `EditorProvider`
 * (`EditorContext.tsx`), beside the viewport policy and before any document
 * mounts, so today's behaviour is unchanged.
 */

import type {
  Object3DDocumentPersistenceSession,
  OpenObject3DDocumentPersistenceOptions,
} from './authoring/object3d-document-persistence';
import type { HistoryService } from '@volter/editor-sdk/kit/history/history-service';

/** Re-exported from its declaration site so a consumer of this seam does not
 *  import the persistence module (which reaches project file history) for a
 *  type. `import type` is erased, so this costs the closure nothing. */
export type { Object3DDocumentPersistenceSession } from './authoring/object3d-document-persistence';

/** A whole-file SOURCE replacement — the document's animation binding and its
 *  single-module documents both write this way. */
export interface Object3DDocumentSourceReplacement {
  readonly file: string;
  readonly source: string;
  readonly label: string;
}

/** The camera framing `.vgai/thumbnails.json` records for one asset.
 *  `undefined` is the RESET — remove this asset's framing. */
export interface Object3DDocumentThumbnailFraming {
  readonly position: [number, number, number];
  readonly target: [number, number, number];
  readonly fov?: number;
}

export interface Object3DDocumentWritePolicy {
  /**
   * Open the persistence baseline for a document that declares a binding.
   * The session owns transaction ordering, checksum preflight and canonical
   * undo/redo; the document only calls `commit`.
   */
  openPersistence(
    options: OpenObject3DDocumentPersistenceOptions,
  ): Promise<Object3DDocumentPersistenceSession>;
  /**
   * Replace a whole source file through the tier's recorder, in `history`.
   * Resolves to whether a byte actually moved. The HISTORY lookup stays with
   * the document (it holds the session's service already, and its two call
   * sites word an absent one differently); what the shell owns here is the
   * WRITE BACKEND — the thing a read-only tier does not have.
   */
  replaceSource(
    history: HistoryService,
    request: Object3DDocumentSourceReplacement,
  ): Promise<boolean>;
  /**
   * Record (or clear, with `undefined`) this asset's thumbnail framing in the
   * project's thumbnail manifest. Refuses loudly rather than rebuilding a
   * manifest it could not read.
   */
  saveThumbnailFraming(
    assetPath: string,
    framing: Object3DDocumentThumbnailFraming | undefined,
  ): Promise<void>;
}

/** The one refusal, worded for the member that raised it. Rejected rather than
 *  thrown so every member answers the same way; each call site is already
 *  inside the `await` of a try/catch that renders the message. */
function refuse<T>(what: string): Promise<T> {
  return Promise.reject(new Error(`This editor tier cannot ${what}.`));
}

export const DEFAULT_OBJECT3D_DOCUMENT_WRITE_POLICY: Object3DDocumentWritePolicy = {
  openPersistence: () => refuse('persist Asset Lab documents'),
  // The exact wording a read-only tier produced when the document asked the
  // tier recorder for a source-write backend and got none.
  replaceSource: () => refuse('write project source'),
  saveThumbnailFraming: () => refuse('write project thumbnail framing'),
};

let _policy: Object3DDocumentWritePolicy = DEFAULT_OBJECT3D_DOCUMENT_WRITE_POLICY;

/**
 * Install the shell's composition. One owner, same rule as
 * `installViewportAuthoringPolicy` and the store's `attachHistory`:
 * re-installing the SAME policy is a no-op (React strict-mode double-invokes
 * the provider body), a DIFFERENT one throws rather than letting two shells
 * disagree about where a document's bytes go.
 */
export function installObject3DDocumentWritePolicy(policy: Object3DDocumentWritePolicy): void {
  if (_policy === policy) return;
  if (_policy !== DEFAULT_OBJECT3D_DOCUMENT_WRITE_POLICY) {
    throw new Error('An Object3D document write policy is already installed.');
  }
  _policy = policy;
}

/** The installed policy, or the no-shell default. */
export function object3DDocumentWritePolicy(): Object3DDocumentWritePolicy {
  return _policy;
}

/** Test seam: drop the installed policy. */
export function __resetObject3DDocumentWritePolicyForTest(): void {
  _policy = DEFAULT_OBJECT3D_DOCUMENT_WRITE_POLICY;
}
