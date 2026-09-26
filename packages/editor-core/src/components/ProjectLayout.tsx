/** Project-authored composition over the same native editor documents and services. */
import {
  type DocumentViewProps,
  EditorFooter,
  EditorFrame,
  EditorHeader,
  Workspace as HostWorkspace,
} from '@volter/editor-sdk/layouts';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { activeProjectKey } from '@volter/editor-sdk/kit/active-project';
import {
  adapterEditorConfiguration,
  subscribeAdapterEditorConfiguration,
} from '@volter/editor-sdk/kit/adapter-editor-config';
import {
  documentViewport,
  documentViewportsVersion,
  subscribeDocumentViewports,
} from '@volter/editor-sdk/kit/document-viewports';
import { openRegisteredDocumentAsync } from '@volter/editor-sdk/kit/document-open-registry';
import { useEditorStore } from '@volter/editor-sdk/kit/editor-runtime';
import {
  projectAdapterWaitNarration,
  subscribeProjectAdapter,
  waitForProjectAdapter,
} from '@volter/editor-sdk/kit/project-adapter';
import {
  activateWorkspaceDocument,
  closeWorkspaceDocument,
  openWorkspaceDocuments,
  subscribeWorkspaceDocuments,
  workspaceDocumentRegistryVersion,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { openAssetDocument } from '@volter/editor-sdk/kit/components/asset-documents';
import { WorkspaceDocumentSurface } from './WorkspaceDocumentSurface';

const documentOwners = new Map<
  string,
  { project: string | null; count: number; created: boolean }
>();
function retainDocument(id: string, created: boolean): () => void {
  const project = activeProjectKey();
  let ownership = documentOwners.get(id);
  if (!ownership || ownership.project !== project) {
    ownership = { project, count: 0, created };
    documentOwners.set(id, ownership);
  }
  ownership.count++;
  const held = ownership;
  return () => {
    if (documentOwners.get(id) !== held || --held.count > 0) return;
    documentOwners.delete(id);
    if (held.created && activeProjectKey() === held.project) closeWorkspaceDocument(id);
  };
}

/**
 * ONE DOCUMENT, mounted with no chrome around it — the layout host's `Document`.
 *
 * It is exported rather than registered here: `frame/bridge.tsx` is the ONE
 * layout host there is, and it names this component in its own registration.
 * Before PART B this module registered a host of its own and the bridge
 * registered a second one OVER it, reading only this member back out — two
 * registrations for one door, where the second always won.
 */
export function DocumentView({
  document: address,
  chrome = true,
  active = true,
  onReady,
}: DocumentViewProps) {
  const store = useEditorStore();
  const [id, setId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addressKey = JSON.stringify(address);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const readySession = useRef<unknown>(null);
  useSyncExternalStore(
    subscribeWorkspaceDocuments,
    workspaceDocumentRegistryVersion,
    workspaceDocumentRegistryVersion,
  );
  const viewportsVersion = useSyncExternalStore(
    subscribeDocumentViewports,
    documentViewportsVersion,
    documentViewportsVersion,
  );
  useEffect(() => {
    let disposed = false;
    let release: (() => void) | undefined;
    const project = activeProjectKey();
    const current = () => !disposed && activeProjectKey() === project;
    const requested = JSON.parse(addressKey) as DocumentViewProps['document'];
    setId(null);
    setError(null);
    void (async () => {
      await waitForProjectAdapter();
      if (!current()) return;
      const existing = new Set(openWorkspaceDocuments().map((item) => item.descriptor.id));
      // AN ADDRESS, NEVER A BRANCH. A layout names a document; what can open
      // that kind is whatever registered an opener for it, and the kind's own
      // `settle` is the pre-load this used to do by hand for `story`
      // (`document-open-registry.ts`). The two kinds spelled out are the
      // HOST's own: an asset at a path, and a workspace document that is
      // either already open or is not coming.
      const opened =
        requested.kind === 'asset'
          ? openAssetDocument(requested.path, requested.assetKind ?? 'source', {
              activate: active,
            })
          : requested.kind === 'workspace'
            ? existing.has(requested.id)
              ? requested.id
              : null
            : await openRegisteredDocumentAsync(requested.kind, store, {
                ...requested,
                activate: active,
              });
      if (!current()) return;
      if (!opened) throw new Error('The requested layout document is unavailable.');
      release = retainDocument(opened, !existing.has(opened));
      setId(opened);
    })().catch((reason: unknown) => {
      if (current()) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      disposed = true;
      release?.();
    };
  }, [store, addressKey]);
  useEffect(() => {
    if (!id || !active) return;
    activateWorkspaceDocument(id);
  }, [id, active]);
  useEffect(() => {
    if (!id) return;
    // The document's stage answers for it (`@volter/editor-sdk/kit/document-viewports`).
    const stage = documentViewport(id);
    if (!stage || readySession.current === stage) return;
    readySession.current = stage;
    try {
      onReadyRef.current?.({
        select(name) {
          const matches = stage.idsNamed?.(name) ?? [];
          if (matches.length !== 1)
            throw new Error(`Expected one object named "${name}"; found ${matches.length}.`);
          stage.selection?.apply(matches);
        },
        transform(mode) {
          stage.setTransformMode?.(mode);
        },
        frame() {
          stage.frame('document');
        },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [id, viewportsVersion]);
  const opened = id
    ? openWorkspaceDocuments().find((item) => item.descriptor.id === id)
    : undefined;
  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {error ? (
        <div role="alert">{error}</div>
      ) : opened ? (
        <WorkspaceDocumentSurface descriptor={opened.descriptor} active={active} chrome={chrome} />
      ) : (
        <div role="status">Opening document…</div>
      )}
    </div>
  );
}

/**
 * THE LAYOUT A PROJECT THAT DECLARES NONE GETS — and it goes through the
 * LAYOUT HOST, exactly as every declared layout does. Never through the
 * components directly: the host is where the editor meets the workbench's
 * parts, and a layout that renders around it puts the project header in an
 * overlay root instead of the title bar and the document beside the editor
 * area instead of in it (measured 2026-09-19, the frame walk's beat 19, on
 * `public/ingest/three-points-waves/`).
 *
 * `configuration.Layout` comes from the project adapter's own `editor.Layout`,
 * which only the scaffolder and the Blender template ever write, so most
 * projects take this path.
 *
 * The body below is `GameLayout` minus `immersivePlay` (the flag is a CLAIM a
 * layout makes, and a project that declared no layout has made no claim).
 */
function LegacyLayout() {
  return (
    <EditorFrame>
      <EditorHeader />
      <HostWorkspace />
      <EditorFooter />
    </EditorFrame>
  );
}
export function ProjectLayout() {
  const store = useEditorStore();
  useSyncExternalStore(store.subscribe, store.getShellSnapshot ?? store.getSnapshot);
  const configuration = useSyncExternalStore(
    subscribeAdapterEditorConfiguration,
    adapterEditorConfiguration,
    adapterEditorConfiguration,
  );
  const [ready, setReady] = useState(false);
  // THE BOOT'S OWN STATUS LINE NAMES WHAT IT IS WAITING FOR. Resolving the
  // adapter can take a contribution pass — a project that declares an ingest
  // root has its adapter declaration in a package, and waiting for that
  // package is measured in seconds (`project-adapter.ts`'s
  // `waitForContributedAdapterSources`). Nine silent seconds under "Loading
  // project layout…" reads as a hung editor; the loader publishes the reason
  // and this line speaks it.
  const waiting = useSyncExternalStore(
    subscribeProjectAdapter,
    projectAdapterWaitNarration,
    projectAdapterWaitNarration,
  );
  useEffect(() => {
    let disposed = false;
    void waitForProjectAdapter().then(() => {
      if (!disposed) setReady(true);
    });
    return () => {
      disposed = true;
    };
  }, []);
  if (!ready) return <div role="status">{waiting ?? 'Loading project layout…'}</div>;
  const Layout = configuration.Layout ?? LegacyLayout;
  return <Layout playing={store.playState !== 'stopped'} paused={store.playState === 'paused'} />;
}
