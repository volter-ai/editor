import {
  object3DDocumentSession,
  object3DDocumentStageAnnounced,
} from './authoring/object3d-document-session-registry';
import { DOCUMENT_REGISTRATION_TIMEOUT_MS, waitUntil } from './wait-until';

/**
 * THE OPEN DOCUMENT'S OWN CONTEXT, published for the REPL door.
 *
 * A tool document (`workspace.document`) may hand the host ONE object — the
 * live session it edits through — and `editor.document.run(ctx => …)`
 * (`vgai eval`) runs a wire-carried step against it, in Edit mode, without
 * play. This is the "explore in the REPL, commit as source" half of the
 * parity program's one spine (docs/BLENDER-PARITY.md §Execution model): the
 * mesh document publishes its `MeshEditSession`, whose `ctx` is the
 * bpy-shaped edit context, so an agent phrases a modeling step the way the
 * corpus does — context + selection + op — and reads the result back.
 *
 * Keyed by workspace document id; the door resolves the ACTIVE document and
 * refuses by name when it published nothing (a data sheet, a story). A
 * document re-publishes whenever its session object changes (a reload swaps
 * it); publishing returns the unpublish.
 *
 * ITS SIBLING FACT, and the reason they share a module: whether a contributed
 * document has MOUNTED AT ALL. Both are things a contribution's own React root
 * tells the host about itself, and both exist because `ToolHost.tsx` renders
 * that contribution into a SEPARATE root (`createEditorRoot(...).render(...)`),
 * which React schedules — so nothing in the host's own commit can say whether
 * the contribution has rendered yet. Every door that must not read a document
 * "before it decided what it is" waits on one of these two.
 */

const _contexts = new Map<string, unknown>();
const _listeners = new Set<() => void>();
const _mounted = new Set<string>();
const _mountListeners = new Set<() => void>();

let _version = 0;

function _notifyContexts(): void {
  _version += 1;
  for (const listener of [..._listeners]) listener();
}

export function publishDocumentContext(documentId: string, context: unknown): () => void {
  _contexts.set(documentId, context);
  _notifyContexts();
  return () => {
    if (_contexts.get(documentId) === context) _contexts.delete(documentId);
  };
}

/**
 * THE PUBLISHED CONTEXT HAS MOVED — said by the package that DRIVES the
 * document, not by the one that published it.
 *
 * The context object is a live handle, so a package can change what it answers
 * without ever republishing: `@volter/editor-blender` reads the engine through its RNA
 * door and the answer decides which Properties TABS exist for the selected
 * datablock (an armature has a Bone tab, a cube does not). Nothing in the
 * host's own stores moves when that answer arrives, so before this existed the
 * inspector had no reason to re-compose and the rail stayed at whatever the
 * first render could see.
 *
 * `use-active-inspection.ts` subscribes to {@link documentContextVersion}, so
 * this makes the whole inspection re-derive — matches included.
 */
export function notifyDocumentContextChanged(documentId: string): void {
  if (!_contexts.has(documentId)) return;
  _notifyContexts();
}

export function subscribeDocumentContexts(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

export function documentContextVersion(): number {
  return _version;
}

export function documentContextFor(documentId: string): unknown {
  return _contexts.get(documentId);
}

/** Opening a document activates its tab before an async model import can
 * publish its context. The REPL waits for that publication; it never executes
 * against a placeholder or mistakes a loading document for an unsupported one. */
export function waitForDocumentContext(documentId: string, timeoutMs = 10_000): Promise<unknown> {
  const current = documentContextFor(documentId);
  if (current !== undefined) return Promise.resolve(current);
  return new Promise((resolve) => {
    const onPublish = () => {
      const context = documentContextFor(documentId);
      if (context === undefined) return;
      clearTimeout(timeout);
      _listeners.delete(onPublish);
      resolve(context);
    };
    const timeout = setTimeout(() => {
      _listeners.delete(onPublish);
      resolve(undefined);
    }, timeoutMs);
    _listeners.add(onPublish);
  });
}

export function __resetDocumentContextsForTest(): void {
  _contexts.clear();
  _mounted.clear();
}

/**
 * A CONTRIBUTED DOCUMENT'S REACT ROOT HAS COMMITTED — published by the host's
 * own wrapper INSIDE that root (`ToolHost.tsx`), so every child effect has run
 * by the time it fires. That ordering is the whole point: it is what lets an
 * opener's `ready` read an absent stage announcement as "this document has no
 * stage" rather than "the stage has not rendered yet"
 * (`authoring/object3d-document-session-registry.ts`).
 */
export function markContributedDocumentMounted(documentId: string): () => void {
  _mounted.add(documentId);
  for (const listener of [..._mountListeners]) listener();
  return () => {
    _mounted.delete(documentId);
  };
}

/** Resolves once this document's contribution has committed, `false` if the
 *  bounded window elapses first — the same shape and reason as
 *  {@link waitForDocumentContext} above. */
export function waitForContributedDocumentMount(
  documentId: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  if (_mounted.has(documentId)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onMount = () => {
      if (!_mounted.has(documentId)) return;
      clearTimeout(timeout);
      _mountListeners.delete(onMount);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      _mountListeners.delete(onMount);
      resolve(false);
    }, timeoutMs);
    _mountListeners.add(onMount);
  });
}

/**
 * THE SHARED HALF OF EVERY OPENER'S `ready` (`document-open-registry.ts`): a
 * document whose stage announced itself
 * (`authoring/object3d-document-session-registry.ts`) is not ready to be
 * driven until that stage has registered its session, and one that announced
 * nothing is ready already. Each caller has already waited for its own MOUNT
 * to settle — the asset family for its Inspector, a contributed document for
 * the React root above — which is what makes an absent announcement mean
 * "this document has no stage" rather than "the stage has not rendered yet".
 *
 * The refusal sentence is the one `editor-view-presentation.ts` used to throw,
 * moved to the kinds' own side unchanged.
 */
export async function awaitAnnouncedObject3DDocumentSession(documentId: string): Promise<void> {
  if (!object3DDocumentStageAnnounced(documentId)) return;
  if (
    await waitUntil(
      () => object3DDocumentSession(documentId) !== null,
      DOCUMENT_REGISTRATION_TIMEOUT_MS,
    )
  )
    return;
  throw new Error(`The requested Object3D view did not mount for document: ${documentId}`);
}
