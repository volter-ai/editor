/**
 * Asset DOCUMENTS (W2 — inventory rows R2–R7):
 * model/image/audio/input-map/JSON viewers open as CENTER workspace documents
 * through `workspace-document-registry.ts`, replacing the former `RightPanel`
 * asset-tab mechanism (`editor-store.ts`'s `AssetTab` list, deleted in this
 * wave). The Inspector is never displaced by a viewer again (§10 acceptance
 * #3).
 *
 * Identity (§7.1 stable ids): document ids keep the exact key vocabulary the
 * old store tabs used, so the control-API surface (`open-asset-tab` /
 * `close-asset-tab` / `active-tab` in `command-listener.ts`, `vgai
 * open-asset`) keeps its meaning unchanged:
 *
 *   - project asset  → the serving path itself (`/textures/crate.png`)
 *   - Asset Editor → `asset-editor:entity:<entityId>`
 *   - online asset   → `online:<source>:<id>`
 *
 * Titles are source-owned file names as authored (§8 — `crate.png`, never a
 * technology bucket); the online document keeps the catalog's own asset name.
 *
 * Per-document RUNTIME state (an online asset resolving to a local path after
 * download) lives in an HMR-stable module spec map in the house
 * `useSyncExternalStore` shape — the registry's descriptors stay immutable,
 * and `AssetDocumentContent` re-renders from the spec map. Specs are dropped
 * on document dispose (close / project teardown via
 * `closeAllWorkspaceDocuments`), so nothing leaks across sessions.
 *
 * T6.3 interplay: activating an asset document means neither the scene
 * viewport nor the Game preview is the active center surface, so the
 * descriptor's `onActivate` writes the store's `'scene'` tab — the play input
 * gate (`playState === 'playing' && activeViewportTab === 'play'`) drops
 * without stopping play, exactly like clicking the scene tab.
 */

import { faCloudArrowDown, faFileLines } from '@fortawesome/free-solid-svg-icons';
import { bg, danger, text } from '@volter/editor-sdk/widgets';
import type { AuthoringAssetSubject } from '@volter/editor-project/adapter';
import { lazy, type ReactNode, Suspense, useEffect, useSyncExternalStore } from 'react';
import { clearSelectedAsset } from '../asset-selection';
import { assetCapabilities } from '@volter/editor-sdk/kit/asset-capabilities';
import {
  splitSpritesheetAssetPath,
  spritesheetFrameTitle,
} from '../asset-workflow/pixi-spritesheet';
import { authoringAssetDataUrl } from '../authoring/authoring-asset-url';
import { awaitAnnouncedObject3DDocumentSession } from '../document-context-registry';
import { registerDocumentOpener } from '../document-open-registry';
import { projectFileExists } from '../editor-api';
import type { AssetKind, OnlineAssetInfo } from '../asset-selection';
import { type InspectionSection, PROPERTIES_SECTION_ORDER } from '@volter/editor-sdk/kit/inspection-model';
import { threeStoreForHost } from '../shell-store-door';
import { DOCUMENT_REGISTRATION_TIMEOUT_MS, waitUntil } from '../wait-until';
import {
  activeWorkspaceDocumentId,
  openWorkspaceDocument,
  setWorkspaceDocumentTitle,
  type WorkspaceDocumentContentProps,
  type WorkspaceDocumentDescriptor,
  workspaceDocumentSelection,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { registerWorkspaceDocumentRestorer } from '../workspace-document-restore';

import { MediaProperties } from './MediaProperties';

const AssetEditorShell = lazy(async () => {
  const module = await import('./AssetEditorShell');
  return { default: module.AssetEditorShell };
});
const AudioViewer = lazy(async () => {
  const module = await import('./asset-viewers/AudioViewer');
  return { default: module.AudioViewer };
});
const EntityModelDocument = lazy(async () => {
  const module = await import('./asset-viewers/EntityModelDocument');
  return { default: module.EntityModelDocument };
});
const EnvironmentAssetDocument = lazy(async () => {
  const module = await import('./asset-viewers/EnvironmentAssetDocument');
  return { default: module.EnvironmentAssetDocument };
});
const ImageViewer = lazy(async () => {
  const module = await import('./asset-viewers/ImageViewer');
  return { default: module.ImageViewer };
});
const VideoViewer = lazy(async () => {
  const module = await import('./asset-viewers/VideoViewer');
  return { default: module.VideoViewer };
});
const JsonAssetDocument = lazy(async () => {
  const module = await import('./asset-viewers/JsonAssetDocument');
  return { default: module.JsonAssetDocument };
});
const ModelAssetDocument = lazy(async () => {
  const module = await import('./asset-viewers/ModelAssetDocument');
  return { default: module.ModelAssetDocument };
});
const OnlineAssetDetail = lazy(async () => {
  const module = await import('./asset-viewers/OnlineAssetDetail');
  return { default: module.OnlineAssetDetail };
});
const SourceAssetViewer = lazy(async () => {
  const module = await import('./asset-viewers/SourceAssetViewer');
  return { default: module.SourceAssetViewer };
});

/** What one open asset document is showing — the former `AssetTab` shape,
 *  now keyed by workspace-document id. */
export interface AssetDocumentSpec {
  readonly assetPath: string;
  readonly kind: AssetKind;
  /** Entity source for a session-only Asset Editor document. Never serialized. */
  readonly entityId?: string;
  /** Present while this document shows an online (not-yet-downloaded) asset. */
  readonly online?: OnlineAssetInfo;
  readonly unavailableReason?: string;
  /** Incremented when the file bytes change at the same path. */
  readonly revision?: number;
  /** Display metadata for an adapter-provided in-memory asset (for example inline SVG). */
  readonly displayName?: string;
  readonly sourcePath?: string;
}

export interface AssetDocumentMutation {
  type: 'move' | 'delete' | 'change';
  oldPath?: string;
  newPath?: string;
  paths?: readonly string[];
}

const hotData = import.meta.hot?.data;
const _specs =
  (hotData?.['vgai:asset-document-specs'] as Map<string, AssetDocumentSpec> | undefined) ??
  new Map<string, AssetDocumentSpec>();
const _pathAliases =
  (hotData?.['vgai:asset-document-path-aliases'] as Map<string, string> | undefined) ??
  new Map<string, string>();
const _focusReturnTargets = new Map<string, HTMLElement>();
if (hotData) {
  // Workspace descriptors intentionally survive compatible Fast Refreshes.
  // Their specs must survive with them or the next persistence snapshot drops
  // the open document and leaves a titled-but-empty tab on reload.
  hotData['vgai:asset-document-specs'] = _specs;
  hotData['vgai:asset-document-path-aliases'] = _pathAliases;
}
let _version = 0;
const _listeners = new Set<() => void>();

function notifyChanged(): void {
  _version++;
  for (const fn of _listeners) fn();
}

/** Subscribe to spec changes (online-asset resolution). Returns unsubscribe. */
export function subscribeAssetDocuments(fn: () => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

/** Monotonic change counter — the `getSnapshot` for `useSyncExternalStore`. */
export function assetDocumentsVersion(): number {
  return _version;
}

/** The spec behind an open asset document id, or `undefined`. */
export function assetDocumentSpec(id: string): AssetDocumentSpec | undefined {
  return _specs.get(id);
}

/** Whether `id` is one of this module's asset documents (used by
 *  `command-listener.ts` to report the legacy `activeTabKey` facet). */
export function isAssetDocumentId(id: string): boolean {
  return _specs.has(id);
}

/** The narrow store surface asset documents need (T6.3 gate hand-off). */
export interface AssetDocumentStore {
}

/** The Asset Editor additionally needs the live object's name for its §8 title. */
export interface EntityAssetDocumentStore extends AssetDocumentStore {
  readonly objectMap: ReadonlyMap<string, { readonly name: string }>;
}

/** Shallow equality over the union of both specs' keys — the specs are flat
 *  records of primitives plus two small objects, and the only question asked
 *  of them is "did the request ask for something different". */
function sameSpec(a: AssetDocumentSpec, b: AssetDocumentSpec): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = (a as unknown as Record<string, unknown>)[key];
    const right = (b as unknown as Record<string, unknown>)[key];
    if (left === right) continue;
    if (JSON.stringify(left) !== JSON.stringify(right)) return false;
  }
  return true;
}

function openSpecDocument(
  id: string,
  title: string,
  spec: AssetDocumentSpec,
  provenance?: WorkspaceDocumentDescriptor['provenance'],
  options: { activate?: boolean } = {},
): string {
  if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    _focusReturnTargets.set(id, document.activeElement);
  }
  const existing = _specs.get(id);
  if (!existing) {
    _specs.set(id, spec);
    notifyChanged();
  } else {
    // FIRST SPEC NO LONGER WINS. Re-opening the same path with a DIFFERENT
    // kind used to be a silent no-op: the id IS the path, the spec was written
    // once, and every later request was dropped on the floor while the call
    // still acked. `editor.openAsset('/x.json', 'source')` therefore handed
    // back the JSON viewer and reported success.
    //
    // The honest resolution is UPDATE, not refuse, because of what the two
    // halves of this identity are: the PATH is the document's identity (the id
    // is literally the path) and the KIND is a VIEW of that file. A second
    // view of the same file is an ordinary request, not a collision — refusing
    // it would mean a file already open can only be re-viewed by closing it
    // first, a modal rule the workspace has nowhere to show. Layout
    // persistence agrees: it serializes whatever the spec CURRENTLY says
    // (`{path, assetKind}`) and restores by calling this function against an
    // empty registry, so an updated spec round-trips exactly and refusal would
    // never fire on that path anyway.
    //
    // The request wins key-by-key; fields the request does not speak for
    // (`revision`, `unavailableReason` — facts about the FILE at that path,
    // maintained by `applyAssetDocumentMutation`) survive.
    const merged = { ...existing, ...spec };
    if (!sameSpec(existing, merged)) {
      _specs.set(id, merged);
      notifyChanged();
    }
  }
  const descriptor: WorkspaceDocumentDescriptor = {
    id,
    title,
    kind: 'asset',
    workspaceRole: 'authored-subject',
    ...(provenance ? { provenance } : {}),
    Content: AssetDocumentContent,
    closeable: true,
    presentation: () => {
      const current = _specs.get(id);
      if (!current) return null;
      if (current.entityId)
        return { kind: 'asset', entityId: current.entityId, assetKind: 'model' };
      if (!current.assetPath || current.online) return null;
      return {
        kind: 'asset',
        path: current.assetPath,
        assetKind: current.kind,
      };
    },
    // Only a real FILE-BACKED view restores: a live-entity Asset Editor
    // session and an unresolved online asset are not truthfully re-resolvable
    // from a cold boot, so they return nothing and the host stores nothing.
    persist: () => {
      const current = _specs.get(id);
      if (!current?.assetPath || current.online || current.entityId !== undefined) return undefined;
      return { path: current.assetPath, assetKind: current.kind };
    },
    onActivate: () => {
      if (spec.kind === 'image' || spec.kind === 'video' || spec.kind === 'audio')
        clearSelectedAsset();
    },
    onDispose: (documentId) => {
      if (_specs.delete(documentId)) notifyChanged();
      const focusTarget = _focusReturnTargets.get(documentId);
      _focusReturnTargets.delete(documentId);
      if (focusTarget?.isConnected) setTimeout(() => focusTarget.focus(), 0);
    },
  };
  return openWorkspaceDocument(descriptor, options);
}

/**
 * Open a project asset as a center document (double-click/Enter in the asset
 * browser, `open-asset-tab` control command). Re-opening an already-open
 * path activates the existing document (registry dedupe) — and re-opening it
 * with a DIFFERENT kind re-points that document's spec at the requested view
 * rather than silently keeping the first one (see `openSpecDocument`).
 */
export function openAssetDocument(
  assetPath: string,
  kind: AssetKind,
  options: { activate?: boolean } = {},
): string {
  const title = spritesheetFrameTitle(assetPath);
  const { frameName } = splitSpritesheetAssetPath(assetPath);
  const id = _pathAliases.get(normalizeAssetPath(assetPath)) ?? assetPath;
  return openSpecDocument(id,
    title,
    frameName ? { assetPath, kind, displayName: title } : { assetPath, kind },
    { sourcePath: assetPath },
    options,
  );
}

/**
 * Reopen a persisted asset document. Verified with an EXISTENCE-ONLY probe
 * (`projectFileExists` — a backend stat in browser-hosted projects, an HTTP
 * HEAD on the local server): a deleted asset resolves false and the document
 * is dropped. Deliberately not `readProjectTextFile`, which downloads the
 * whole asset body just to throw it away here.
 */
registerWorkspaceDocumentRestorer({
  kind: 'asset',
  owner: 'asset-documents',
  restore: async ({ state }) => {
    const record = state as { path?: unknown; assetKind?: unknown } | null | undefined;
    const path = typeof record?.path === 'string' ? record.path : null;
    const assetKind = typeof record?.assetKind === 'string' ? record.assetKind : null;
    if (!path || !assetKind) return false;
    if (!(await projectFileExists(path))) return false;
    openAssetDocument(path, assetKind as AssetKind);
    return true;
  },
});

/**
 * THE `asset` ADDRESS (`document-open-registry.ts`) — an asset at a path, or
 * the Asset Editor over a live scene entity. Registered at module load, the
 * shape `packages/game/src/story-documents/three-story-documents.tsx:239`
 * uses; what an extension means, and what `@volter/editor-sdk`'s published view
 * kinds map onto internally, are this module's rules and the presenter no
 * longer holds either.
 *
 * `ready` (the post-open half of `settle`) is why the address exists as more
 * than a call: an asset document answers its id the moment its tab is
 * registered, while `present` must not return until the Inspector has mounted
 * — and for a MODEL, until its live Object3D adapter has replaced the identity
 * floor, or an immediate inspect/setField sees a mounted tab whose graph is
 * not ready. That rule is the asset family's; the host used to await it by
 * hand because it knew the rule.
 */
/**
 * THE ASSET DOCUMENT'S READINESS — this family's rule, and a DOOR a caller
 * outside the view protocol holds besides the `ready` below
 * (`command-listener.ts`'s `open-asset-tab`). It lived in `editor-view-presentation.ts` while the presenter did
 * the waiting by hand; the presenter holds no kind's rule any more, so the
 * rule lives beside the documents it describes.
 */
export async function waitForAssetDocumentInspector(
  documentId: string,
  kind: AssetKind,
): Promise<boolean> {
  return waitUntil(() => {
    if (activeWorkspaceDocumentId() !== documentId) return false;
    const selection = workspaceDocumentSelection(documentId);
    if (!selection) return false;
    // Every asset shell publishes its own identity once mounted. A model has
    // a stronger readiness bar: its live Object3D adapter must have replaced
    // that identity floor, otherwise an immediate inspect/setField would see
    // a mounted tab whose graph and project authoring contribution are not
    // ready yet.
    return kind !== 'model' || selection.adapter !== null;
  }, DOCUMENT_REGISTRATION_TIMEOUT_MS);
}

registerDocumentOpener<{
  readonly path?: string;
  readonly assetKind?: string;
  readonly entityId?: string;
}>({
  id: 'asset',
  owner: 'asset-documents',
  open: (_store, request) => {
    if (request.entityId) {
      // The Asset Editor's §8 title comes from the LIVE object map, which the
      // address seam's narrow store (`WorkspaceStateStore`) does not carry and
      // should not: `shell-store-door.ts` is how a lane reaches the one shell
      // store without the seam widening for a single family.
      const shell = threeStoreForHost();
      if (!shell) return null;
      const id = openEntityAssetDocument(shell, request.entityId);
      if (!id) throw new Error(`Scene entity is not available: ${request.entityId}`);
      return id;
    }
    const path = request.path;
    if (path === undefined) return null;
    return openAssetDocument(path, requestedAssetKind(request.assetKind, path));
  },
  ready: async (documentId, request) => {
    const kind: AssetKind = request.entityId
      ? 'model'
      : requestedAssetKind(request.assetKind, request.path ?? '');
    if (!(await waitForAssetDocumentInspector(documentId, kind)))
      throw new Error(`Asset document did not finish mounting its Inspector: ${documentId}`);
    // AND ITS STAGE, where it mounted one. The KIND does not decide that and
    // this module must not pretend it does: a `model` always mounts one, a
    // `source` asset only when its module is a model builder
    // (`asset-viewers/SourceAssetViewer.tsx:256`) and a `json` only when its
    // content is a three.quarks system (`asset-viewers/JsonAssetDocument.tsx:64`),
    // so the stage's own announcement is what answers. The Inspector wait above
    // is what makes an absent announcement mean "no stage" rather than "not
    // yet": the shell that would have rendered one has already mounted.
    await awaitAnnouncedObject3DDocumentSession(documentId);
  },
});

/**
 * The internal view kind an address asks for. `@volter/editor-sdk`'s public
 * view-link contract still carries 'animation' and 'prefab' kinds that have no
 * internal counterpart; exactly those remap to their closest surviving
 * internal kinds. Unnamed falls back to what the extension says.
 */
function requestedAssetKind(requested: string | undefined, path: string): AssetKind {
  if (requested === 'animation') return 'source';
  if (requested === 'prefab') return 'json';
  return (requested as AssetKind | undefined) ?? inferAssetKind(path);
}

/** What an extension means. The asset browser's own vocabulary, which is why
 *  it lives beside the documents it opens rather than in the presenter. */
function inferAssetKind(path: string): AssetKind {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'glb' || ext === 'gltf') return 'model';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) return 'image';
  if (['mp3', 'ogg', 'wav', 'flac'].includes(ext)) return 'audio';
  if (['glsl', 'vert', 'frag', 'ts', 'tsx', 'js', 'jsx', 'css', 'html', 'md', 'txt'].includes(ext))
    return 'source';
  return 'json';
}

/** Open the Asset Editor document for a live entity. */
export function openEntityAssetDocument(
  store: EntityAssetDocumentStore,
  entityId: string,
): string | null {
  const object = store.objectMap.get(entityId);
  if (!object) return null;
  // The live `Object3D.name` is the only name there is.
  const title = object.name || entityId;
  return openSpecDocument(`asset-editor:entity:${entityId}`,
    title,
    { assetPath: '', kind: 'model', entityId },
    { origin: `entity:${entityId}` },
  );
}

/** Open an adapter-owned atomic asset that is embedded in a source document. */
export function openAuthoringAssetDocument(
  entityId: string,
  subject: AuthoringAssetSubject,
): string {
  const assetPath = authoringAssetDataUrl(subject);
  return openSpecDocument(`asset-editor:subject:${entityId}`,
    subject.name,
    {
      assetPath,
      kind: subject.kind,
      displayName: subject.name,
      ...(subject.sourcePath ? { sourcePath: subject.sourcePath } : {}),
    },
    subject.sourcePath ? { sourcePath: subject.sourcePath } : { origin: `entity:${entityId}` },
  );
}

/** Open an online-library asset's detail/download document. */
export function openOnlineAssetDocument(online: OnlineAssetInfo): void {
  const kind: AssetKind =
    online.type === 'model'
      ? 'model'
      : online.type === 'animation' || online.type === 'source'
        ? 'source'
        : 'image';
  openSpecDocument(`online:${online.source}:${online.id}`,
    online.name,
    { assetPath: '', kind, online },
    { origin: `online:${online.source}:${online.id}` },
  );
}

/** Point an online asset document at its downloaded local file — the local
 *  viewer takes over in place (same document id/title). */
export function resolveOnlineAssetDocument(id: string, localPath: string): void {
  const spec = _specs.get(id);
  if (!spec) return;
  const { online: _dropped, ...rest } = spec;
  _specs.set(id, { ...rest, assetPath: localPath });
  notifyChanged();
}

/** Test-only reset — drops all specs without touching the document registry
 *  (pair it with `__resetWorkspaceDocumentRegistryForTest`). */
export function __resetAssetDocumentsForTest(): void {
  _specs.clear();
  _pathAliases.clear();
  _focusReturnTargets.clear();
  notifyChanged();
}

/** Keep a live editor bound to asset identity while its source path changes. */
export function applyAssetDocumentMutation(
  documentId: string,
  detail: AssetDocumentMutation,
): void {
  const spec = _specs.get(documentId);
  if (!spec?.assetPath) return;
  const current = normalizeAssetPath(spec.assetPath);
  if (
    detail.type === 'move' &&
    detail.oldPath &&
    detail.newPath &&
    current === normalizeAssetPath(detail.oldPath)
  ) {
    const newPath = `/${normalizeAssetPath(detail.newPath)}`;
    _specs.set(documentId, { ...spec, assetPath: newPath });
    _pathAliases.set(normalizeAssetPath(newPath), documentId);
    setWorkspaceDocumentTitle(documentId, newPath.split('/').pop() ?? newPath);
    notifyChanged();
  } else if (
    detail.type === 'delete' &&
    detail.paths?.some((path) => normalizeAssetPath(path) === current)
  ) {
    _specs.set(documentId, {
      ...spec,
      unavailableReason: `The source ${spec.assetPath} was deleted. Undo the deletion or close this editor.`,
    });
    notifyChanged();
  } else if (
    detail.type === 'change' &&
    detail.paths?.some((path) => normalizeAssetPath(path) === current)
  ) {
    _specs.set(documentId, { ...spec, revision: (spec.revision ?? 0) + 1 });
    notifyChanged();
  }
}

export type AssetDocumentViewerRoute =
  | 'online'
  | 'model'
  | 'environment'
  | 'image'
  | 'video'
  | 'audio'
  | 'source'
  | 'json'
  | 'unsupported';

/** Pure routing decision, exported so every recognized asset kind is test-pinned. */
export function assetDocumentViewerRoute(spec: AssetDocumentSpec): AssetDocumentViewerRoute {
  if (spec.online) return 'online';
  if (assetCapabilities(spec.assetPath).editor === 'environment') return 'environment';
  if (spec.kind === 'json')
    return 'json';
  if (['model', 'image', 'video', 'audio', 'source'].includes(spec.kind))
    return spec.kind as AssetDocumentViewerRoute;
  return 'unsupported';
}

/** Where this asset CAME FROM — the document's own provenance block, one of
 *  the sections it publishes as its subject
 *  (`components/AssetEditorShell.tsx`). */
function sourceSection(spec: AssetDocumentSpec): InspectionSection {
  return {
    id: 'source',
    title: 'Source',
    icon: faFileLines,
    order: PROPERTIES_SECTION_ORDER,
    body: {
      kind: 'custom',
      render: () => <div style={{ padding: 4 }}>{spec.sourcePath ?? spec.assetPath}</div>,
    },
  };
}

/** Routes a spec to its center viewer/editor. */
function AssetViewerBody({
  id,
  spec,
  active,
}: {
  id: string;
  spec: AssetDocumentSpec;
  active: boolean;
}) {
  if (spec.unavailableReason) {
    return (
      <AssetEditorShell
        documentId={id}
        active={active}
        type={spec.kind}
        title={spec.assetPath.split('/').pop() || 'Deleted asset'}
        status="Source unavailable"
      >
        <div style={{ padding: 20, color: danger }}>{spec.unavailableReason}</div>
      </AssetEditorShell>
    );
  }
  const route = assetDocumentViewerRoute(spec);
  if (route === 'online' && spec.online) {
    const online = spec.online;
    return (
      <AssetEditorShell
        documentId={id}
        active={active}
        type="online"
        title={online.name}
        sections={[
          {
            id: 'online-asset',
            title: 'Asset',
            icon: faCloudArrowDown,
            order: PROPERTIES_SECTION_ORDER,
            body: {
              kind: 'custom',
              render: () => (
                <OnlineAssetDetail
                  online={online}
                  mode="inspector"
                  onResolved={(localPath) => resolveOnlineAssetDocument(id, localPath)}
                />
              ),
            },
          },
        ]}
        status={`${online.type} · ${online.source}`}
      >
        <OnlineAssetDetail online={online} mode="preview" />
      </AssetEditorShell>
    );
  }
  const title = (spec.displayName ?? spec.assetPath.split('/').pop()) || spec.entityId || 'Asset';
  const viewerKey = `${id}:${spec.revision ?? 0}`;
  if (route === 'model')
    if (spec.assetPath)
      return (
        <ModelAssetDocument
          documentId={id}
          key={viewerKey}
          assetPath={spec.assetPath}
          displayName={title}
          active={active}
        />
      );
    else if (spec.entityId)
      return (
        <EntityModelDocument
          documentId={id}
          key={viewerKey}
          entityId={spec.entityId}
          displayName={title}
          active={active}
        />
      );
    else return <div style={{ padding: 20, color: danger }}>Model source is unavailable.</div>;
  if (route === 'environment')
    return (
      <EnvironmentAssetDocument
        key={viewerKey}
        documentId={id}
        assetPath={spec.assetPath}
        active={active}
      />
    );
  if (route === 'source')
    return (
      <SourceAssetViewer
        key={viewerKey}
        documentId={id}
        assetPath={spec.assetPath}
        active={active}
      />
    );
  // A .json is content-routed: three.quarks names no extension of its own, so
  // only the file's own structure can say whether this is a particle document
  // or ordinary JSON. `JsonAssetDocument` owns the shell for both answers.
  if (route === 'json')
    return (
      <JsonAssetDocument
        key={viewerKey}
        documentId={id}
        assetPath={spec.assetPath}
        displayName={title}
        active={active}
        sections={[sourceSection(spec)]}
        status={`json · ${spec.sourcePath ?? spec.displayName ?? spec.assetPath}`}
      />
    );
  let viewer: ReactNode;
  switch (route) {
    case 'image':
      viewer = (
        <ImageViewer
          key={viewerKey}
          assetPath={spec.assetPath}
          {...(spec.displayName ? { displayName: spec.displayName } : {})}
        />
      );
      break;
    case 'video':
      viewer = <VideoViewer key={viewerKey} assetPath={spec.assetPath} />;
      break;
    case 'audio':
      viewer = <AudioViewer key={viewerKey} assetPath={spec.assetPath} />;
      break;
    default:
      viewer = (
        <div style={{ padding: 16, color: text[2], fontSize: 12 }}>
          No viewer available for this asset type.
        </div>
      );
  }
  return (
    <AssetEditorShell
      documentId={id}
      active={active}
      type={route}
      title={title}
      fill={route === 'image' || route === 'video'}
      sections={
        (route === 'image' && !spec.assetPath.includes('#')) ||
        route === 'video' ||
        route === 'audio'
          ? [
              {
                id: 'media-properties',
                title: 'Properties',
                icon: faFileLines,
                order: PROPERTIES_SECTION_ORDER,
                body: {
                  kind: 'custom',
                  render: () => (
                    <MediaProperties
                      key={viewerKey}
                      assetPath={spec.assetPath}
                      kind={route as 'image' | 'video' | 'audio'}
                    />
                  ),
                },
              },
              ...(spec.sourcePath ? [sourceSection(spec)] : []),
            ]
          : [sourceSection(spec)]
      }
      status={`${route} · ${spec.sourcePath ?? spec.displayName ?? spec.assetPath}`}
    >
      {viewer}
    </AssetEditorShell>
  );
}

/**
 * Full-size type-specific Asset Editor document host.
 */
export function AssetDocumentContent({ documentId, active }: WorkspaceDocumentContentProps) {
  useSyncExternalStore(subscribeAssetDocuments, assetDocumentsVersion);
  useEffect(() => {
    const handleMutation = (rawEvent: Event) => {
      applyAssetDocumentMutation(
        documentId,
        (rawEvent as CustomEvent<AssetDocumentMutation>).detail,
      );
    };
    window.addEventListener('editor:asset-mutation', handleMutation);
    return () => window.removeEventListener('editor:asset-mutation', handleMutation);
  }, [documentId]);
  const spec = _specs.get(documentId);
  return (
    <div
      data-testid={`asset-document:${documentId}`}
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        pointerEvents: 'auto',
        background: bg[1],
      }}
    >
      {spec ? (
        <Suspense
          fallback={
            <div style={{ padding: 16, color: text[2], fontSize: 12 }}>Loading asset viewer…</div>
          }
        >
          <AssetViewerBody id={documentId} spec={spec} active={active} />
        </Suspense>
      ) : (
        <div style={{ padding: 16, color: text[2], fontSize: 12 }}>
          This asset document is no longer available.
        </div>
      )}
    </div>
  );
}

function normalizeAssetPath(path: string): string {
  return path.split(/[?#]/, 1)[0]!.replace(/^\/+/, '');
}
