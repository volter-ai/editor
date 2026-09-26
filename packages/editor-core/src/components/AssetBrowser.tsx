import {
  faArrowLeft,
  faChevronRight,
  faEllipsis,
  faFolder,
  faFolderTree,
  faList,
  faTable,
  faTableCellsLarge,
} from '@fortawesome/free-solid-svg-icons';
import {
  Button,
  EditorIcon,
  EditorToolbar,
  editorIcons,
  IconButton,
  Menu,
  MenuItem,
  radius,
  StateSurface,
  TextInput,
  ThemeRootPortal,
  ToolbarGroup,
  Tooltip,
  text,
  themeVars,
} from '@volter/editor-sdk/widgets';
import type { AuthoringAdapter, AuthoringAssetSubject } from '@volter/editor-project/adapter';
import type { DocumentEntry } from '@volter/editor-project/adapter/adapter-module';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { clearSelectedAsset, getSelectedAsset, setSelectedAsset } from '@volter/editor-sdk/kit/asset-selection';
import {
  type AssetCapabilityKind,
  assetCapabilities,
  assetDocumentKind,
} from '@volter/editor-sdk/kit/asset-capabilities';
import { confirmAssetAction } from '../asset-workflow/asset-workflow-quality';
import { previewAssetAudio, stopAssetAudioPreview } from '@volter/editor-sdk/kit/asset-workflow/audio-preview-player';
import { invalidateFolderPreviews } from '../asset-workflow/folder-preview';
import { PROJECT_ASSET_COMMANDS } from '../asset-workflow/project-asset-commands';
import { projectLocalSection, writeProjectLocalSection } from '@volter/editor-sdk/kit/project-local-state';

/** The browser's view state is the project's own (`kit/project-local-state`), like its layout. */
const CONTENT_BROWSER_SECTION = 'contentBrowser';
import { inspectProjectAssetHealthFromStorage } from '../asset-workflow/project-asset-health';
import { executeProjectAssetOperation } from '../asset-workflow/project-asset-operations';
import {
  ASSET_ROOTS,
  type AssetRootId,
  assetRootServingUrl,
  projectAssetPath,
  REFERENCE_ROOT,
} from '@volter/editor-sdk/kit/project-asset-roots';
import {
  collectProjectContentAssets,
  expandSpritesheetContentAssets,
  type ProjectComponentEntry,
  type ProjectContentAsset,
  type ProjectContentFacet,
  type ProjectContentSpritesheetFrame,
  projectComponentPriority,
  projectContentAssetFacet,
  projectContentAssetPriority,
} from '@volter/editor-sdk/kit/asset-workflow/project-content';
import { activeAuthoringVersion, subscribeActiveAuthoring } from '@volter/editor-sdk/kit/authoring/active-adapter';
import { resolvePanelAuthoring } from '@volter/editor-sdk/kit/authoring/panel-authoring';
import { contributedMenuItems } from '@volter/editor-sdk/kit/chrome-registry';
import {
  type ContentEntry,
  type ContentEntrySource,
  contentEntrySourceRegistryVersion,
  contentEntrySources,
  subscribeContentEntrySources,
} from '@volter/editor-sdk/kit/content-entry-source-registry';
import { openRegisteredDocument } from '@volter/editor-sdk/kit/document-open-registry';
import { type AssetEntry, listAssets, listProjectComponents, revealInFinder } from '@volter/editor-sdk/kit/editor-api';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { useEditorStore, useHistoryService } from '@volter/editor-sdk/kit/editor-runtime';
import type { AssetKind as DocumentAssetKind } from '@volter/editor-sdk/kit/asset-selection';
import { hierarchyNodesBreadthFirst } from '@volter/editor-sdk/kit/hierarchy-walk';
import { isEditableTarget, setActiveScope } from '@volter/editor-sdk/kit/hotkeys';
import { assetThumbnailRenderer } from '@volter/editor-sdk/kit/asset-thumbnails';
import { object3DDocumentWritePolicy } from '@volter/editor-sdk/kit/object3d-document-write-policy';
import { projectAdapterFacet, subscribeProjectAdapter } from '../project-adapter';
import { documentViewport } from '@volter/editor-sdk/kit/document-viewports';
import { getStorageBackend } from '@volter/editor-sdk/kit/storage/index';
import { getGlobalToolContributions, subscribeToolContributions } from '../tool-loader';
import { reportUnacceptedAssetDrop, showTransientHint } from '@volter/editor-sdk/kit/transient-hint';
import {
  type AvailableWorkspaceDocument,
  availableWorkspaceDocuments,
  openAvailableWorkspaceDocument,
  subscribeAvailableWorkspaceDocuments,
} from '@volter/editor-sdk/kit/workspace-available-documents';
import { planSceneDocument } from '../scene-document-plan';
import {
  activeWorkspaceDocumentId,
  subscribeWorkspaceDocuments,
  workspaceDocumentRegistryVersion,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { openAssetDocument, openAuthoringAssetDocument } from '@volter/editor-sdk/kit/components/asset-documents';
import {
  type AssetGlyphKind,
  AssetIcon,
  AudioAssetThumb,
  ModelThumbnail,
  TypedAssetThumbnail,
} from '@volter/editor-sdk/kit/components/asset-thumbnails';
import { SpritesheetSpriteView } from '@volter/editor-sdk/kit/components/asset-viewers/SpritesheetSpriteView';
import { DocumentThumbnail } from './DocumentThumbnail';
import { FolderPreviewTile } from './FolderPreviewTile';
import { openKindDocument, uneditedKindAssetKind } from './kind-documents';
import { openSceneTableEntry } from './scene-documents';

// --- Helpers ---

type AssetKind = AssetGlyphKind;

type BrowserKind = AssetKind;

function getAssetKind(entry: AssetEntry): AssetKind {
  if (entry.type === 'directory') return 'folder';
  return assetCapabilities(entry.name).kind as AssetCapabilityKind;
}

/** Build the serving URL for an asset (all assets are under public/). */
function assetServingUrl(root: AssetRoot, path: string, name: string): string {
  return assetRootServingUrl(root, path ? `${path}/${name}` : name);
}

/** Build the src path as it would appear in scene files. Public only — a
 *  reference is never placed in a scene (it would not ship). */
function assetScenePath(_root: AssetRoot, path: string, name: string): string {
  return path ? `/${path}/${name}` : `/${name}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ProjectAssetHealth = 'healthy' | 'source-only' | 'unsupported';

function projectAssetHealth(name: string): ProjectAssetHealth {
  const capability = assetCapabilities(name);
  if (!capability.importable) return 'unsupported';
  if (!capability.runtimeReady) return 'source-only';
  return 'healthy';
}

type AssetTreeVisibility = 'auto' | 'shown' | 'hidden';
const ASSET_TREE_MIN_INLINE_SIZE = 640;

interface PersistedAssetBrowserState {
  scope: ContentScope;
  root: AssetRoot;
  currentPath: string;
  viewMode: AssetViewMode;
  sort: AssetSort;
  filter: AssetFilter;
  density: number;
  expanded: string[];
  treeVisibility: AssetTreeVisibility;
  facets: ProjectContentFacet[];
}

const DEFAULT_BROWSER_STATE: PersistedAssetBrowserState = {
  scope: 'content',
  root: 'public',
  currentPath: '',
  viewMode: 'grid',
  sort: 'relevance',
  filter: 'all',
  density: 96,
  expanded: ['public'],
  treeVisibility: 'auto',
  facets: ['component'],
};

function readAssetBrowserState(): PersistedAssetBrowserState {
  try {
    const parsed =
      projectLocalSection<Partial<PersistedAssetBrowserState>>(CONTENT_BROWSER_SECTION) ?? {};
    const persistedViewMode = (parsed as Record<string, unknown>)['viewMode'];
    const persistedTreeVisibility = (parsed as Record<string, unknown>)['treeVisibility'];
    const persistedScope = (parsed as Record<string, unknown>)['scope'];
    const persistedRoot = (parsed as Record<string, unknown>)['root'];
    return {
      ...DEFAULT_BROWSER_STATE,
      ...parsed,
      root: persistedRoot === REFERENCE_ROOT ? REFERENCE_ROOT : 'public',
      currentPath: parsed.currentPath ?? '',
      scope: persistedScope === 'files' ? 'files' : 'content',
      viewMode: persistedScope === 'files' && persistedViewMode === 'list' ? 'list' : 'grid',
      treeVisibility:
        persistedTreeVisibility === 'shown' || persistedTreeVisibility === 'hidden'
          ? persistedTreeVisibility
          : 'auto',
      facets:
        Array.isArray(parsed.facets) && parsed.facets.length > 0
          ? [parsed.facets[0]!]
          : ['component'],
    };
  } catch {
    return DEFAULT_BROWSER_STATE;
  }
}

// --- Main Component ---

export interface AssetBrowserServices {
  readonly listAssets: typeof listAssets;
  readonly listProjectComponents: typeof listProjectComponents;
}

const DEFAULT_ASSET_BROWSER_SERVICES: AssetBrowserServices = { listAssets, listProjectComponents };

interface AssetBrowserProps {
  /** Explicit data seam for bounded production hosts; the app uses the real
   * editor API by default. */
  services?: AssetBrowserServices | undefined;
}

type AssetRoot = AssetRootId;

/** Why a reference row refuses an edit or a drop, in the user's terms. */
const REFERENCE_READ_ONLY_HINT =
  "Reference material is not part of the built game — it stays in the project's references/ " +
  'folder and is never exported. Copy the file into public/ to use it in the game; edit or ' +
  'remove it where it lives.';

/** The asset media and the component chip; every other facet is an open document kind. */
const FIXED_FACETS: ReadonlySet<string> = new Set([
  'component',
  'scene',
  'canvas',
  'model',
  'image',
  'video',
  'audio',
  'other',
]);

/** `model` → `Models`: a kind's chip, from its name. */
function facetLabel(facet: string): string {
  const word = facet.charAt(0).toUpperCase() + facet.slice(1);
  return word.endsWith('s') ? word : `${word}s`;
}

async function saveDocumentPreviewFraming(documentId: string, reset: boolean): Promise<void> {
  if (!reset && activeWorkspaceDocumentId() !== documentId) {
    throw new Error('Open this scene as the active document before using its current view.');
  }
  const viewed = documentViewport(documentId)?.read()?.camera;
  const camera = viewed && typeof viewed !== 'string' ? viewed : null;
  if (!reset && !camera) {
    throw new Error('The active scene has no ready 3D authoring view to save.');
  }
  await object3DDocumentWritePolicy().saveThumbnailFraming(
    `document:${documentId}`,
    reset
      ? undefined
      : {
          position: [camera!.position.x, camera!.position.y, camera!.position.z],
          target: [camera!.target.x, camera!.target.y, camera!.target.z],
          fov: camera!.fov ?? 50,
        },
  );
}
type ContentScope = 'content' | 'files';
type AssetViewMode = 'grid' | 'list';
type AssetSort = 'relevance' | 'name' | 'type' | 'size' | 'modified' | 'health';
type AssetFilter =
  | 'all'
  | 'runtime-ready'
  | 'source-only'
  | 'unsupported'
  | 'imported'
  | 'generated';

type BrowserEntry =
  | {
      source: 'available';
      key: string;
      name: string;
      path: string;
      available: AvailableWorkspaceDocument;
    }
  | {
      source: 'asset';
      key: string;
      name: string;
      /** Root-relative path (the root is `root`). */
      path: string;
      /** Which asset root this row was listed from. `references` rows are read
       *  material: shown, previewed and opened, never placed or mutated here. */
      root: AssetRoot;
      entry: AssetEntry;
      spritesheet?: ProjectContentSpritesheetFrame;
    }
  | {
      /** A component a REGISTERED content source admitted
       *  (`content-entry-source-registry.ts`). The host knows the index row it
       *  depicts and nothing about why it is content: the source paints the
       *  tile and decides what opening it means. */
      source: 'component';
      key: string;
      name: string;
      path: string;
      component: ProjectComponentEntry;
      contentSource: ContentEntrySource;
      contentEntry: ContentEntry;
      authoringAsset?: { id: string; subject: AuthoringAssetSubject } | undefined;
    }
  | {
      /** A DOCUMENT the adapter's finders produced under an open kind that is
       *  neither a scene nor a prefab (ARCHITECTURE-CORE §The project model,
       *  "Documents, not scenes") — a model, a page. Its facet IS its kind. */
      source: 'document';
      key: string;
      name: string;
      path: string;
      document: DocumentEntry;
    };

type PrefabMedium = '3d' | '2d' | 'ui';

interface ContentResultSection {
  id: string;
  label: string | null;
  headingLevel: 'section' | 'category' | null;
  entries: BrowserEntry[];
}

function prefabMedium(item: Extract<BrowserEntry, { source: 'component' }>): PrefabMedium {
  if (item.component.surface === 'three') return '3d';
  if (item.component.surface === 'canvas') return '2d';
  return 'ui';
}

function prefabMediumSections(entries: readonly BrowserEntry[]): ContentResultSection[] {
  const labels: Record<PrefabMedium, string> = { '3d': '3D', '2d': '2D', ui: 'UI' };
  return (['3d', '2d', 'ui'] as const).flatMap((medium) => {
    const mediumEntries = entries.filter(
      (entry) => entry.source === 'component' && prefabMedium(entry) === medium,
    );
    return mediumEntries.length > 0
      ? [
          {
            id: `prefabs-${medium}`,
            label: labels[medium],
            headingLevel: 'category' as const,
            entries: mediumEntries,
          },
        ]
      : [];
  });
}

function groupContentResults(
  entries: readonly BrowserEntry[],
  scope: ContentScope,
  facets: readonly ProjectContentFacet[],
): ContentResultSection[] {
  if (scope === 'files') {
    return [{ id: 'files', label: null, headingLevel: null, entries: [...entries] }];
  }
  if (facets.length === 1 && facets[0] === 'component') {
    return prefabMediumSections(entries);
  }
  return entries.length > 0
    ? [{ id: 'content', label: null, headingLevel: null, entries: [...entries] }]
    : [];
}

/**
 * A directory listing kept WITH the path it was fetched for. `currentPath`
 * (navigation intent) updates synchronously on navigate while the listing
 * arrives later; deriving tile paths/URLs from `currentPath` + the previous
 * entries paired a NEW path with STALE entries for a render, mounting folder
 * preview tiles (and asset `<img>`s) for paths that do not exist — a burst of
 * 404ing `?dir=` scans per navigation. All entry-derived rendering reads this
 * atomic pair instead; during a navigation the previous pair keeps rendering
 * (same content that was already on screen — no flash, no phantom fetches)
 * until the new listing resolves.
 */
interface FolderListing {
  path: string;
  entries: AssetEntry[];
  /** Set when the listing FAILED. An empty `entries` with no reason means the
   *  folder is empty; with a reason it means we could not look, and the panel
   *  says so instead of drawing an empty folder over a backend error. */
  failure?: string;
}

/** The Content chip an entry sits under: an asset's medium, a component's
 *  kind, or a document's OPEN kind — chrome from what the project holds. */
function browserEntryFacet(item: BrowserEntry): ProjectContentFacet {
  if (item.source === 'available') return item.available.category;
  if (item.source === 'component') return item.component.contentKind ?? 'component';
  if (item.source === 'document') return item.document.kind;
  return projectContentAssetFacet(item.name);
}

function browserEntryKind(item: BrowserEntry): BrowserKind {
  if (item.source === 'component') return item.component.contentKind ?? 'component';
  if (item.source === 'available' || item.source === 'document') return 'source';
  return getAssetKind(item.entry);
}

function parentAssetPath(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator < 0 ? '' : path.slice(0, separator);
}

function openProjectAssetEntry(
  item: BrowserEntry,
  options: {
    currentRoot: AssetRoot;
    currentPath: string;
    navigate: (root: AssetRoot, path: string) => void;
    openAsset: (url: string, kind: DocumentAssetKind) => void;
  },
): void {
  if (item.source === 'component' || item.source === 'document' || item.source === 'available')
    return;
  const { entry } = item;
  const { currentRoot, currentPath, navigate, openAsset } = options;
  if (entry.type === 'directory') {
    navigate(currentRoot, currentPath ? `${currentPath}/${entry.name}` : entry.name);
    return;
  }
  const capability = assetCapabilities(entry.name);
  const documentKind = assetDocumentKind(capability);
  if (!documentKind) return;
  if (item.spritesheet) {
    const frame = item.path.includes('#')
      ? item.path.slice(item.path.lastIndexOf('#') + 1)
      : entry.name.replace(/\.png$/i, '');
    openAsset(`/${item.spritesheet.sheetPath}#${frame}`, documentKind);
    return;
  }
  openAsset(assetServingUrl(item.root, currentPath, entry.name), documentKind);
}

function browserEntryDetail(item: BrowserEntry): string {
  if (item.source === 'component') {
    return `Component · line ${item.component.line}`;
  }
  if (item.source === 'available') return item.path || item.available.descriptor.title;
  if (item.source === 'document') return `${item.document.kind} · ${item.path}`;
  if (item.entry.type !== 'file') return 'Folder';
  // An UNREPORTED size is not a zero-byte file. `formatSize(0)` printed
  // "0 B" over every backend that does not stat, which reads as a broken asset.
  return item.entry.size === undefined ? 'Size unknown' : formatSize(item.entry.size);
}

function browserEntryTitle(item: BrowserEntry): string {
  if (item.source === 'component') {
    return `${item.name}\n${item.path}:${item.component.line}`;
  }
  if (item.source === 'available') return `${item.name}\n${item.path}`;
  if (item.source === 'document') return `${item.name}\n${item.path}`;
  const detail = browserEntryDetail(item);
  return detail ? `${item.name}\n${detail}` : item.name;
}

function matchesAssetFilter(item: BrowserEntry, filter: AssetFilter, currentPath: string): boolean {
  if (item.source === 'component' || item.source === 'document' || item.source === 'available')
    return true;
  if (filter === 'all' || item.entry.type === 'directory') return true;
  const capability = assetCapabilities(item.name);
  const path = currentPath ? `${currentPath}/${item.name}` : item.name;
  const predicates: Record<Exclude<AssetFilter, 'all'>, boolean> = {
    'runtime-ready': capability.runtimeReady,
    'source-only': capability.importable && !capability.runtimeReady,
    unsupported: !capability.importable,
    imported: path.startsWith('asset-library/local/'),
    generated: path.startsWith('.generated/'),
  };
  return predicates[filter];
}

function compareEntryNames(left: BrowserEntry, right: BrowserEntry): number {
  return left.name.localeCompare(right.name) || left.path.localeCompare(right.path);
}

function entryRelevance(item: BrowserEntry): number {
  if (item.source === 'asset') {
    return projectContentAssetPriority({ path: item.path, root: item.root, entry: item.entry });
  }
  if (item.source === 'available' || item.source === 'document') return 10;
  return projectComponentPriority(item.component) - 100;
}

function compareRelevance(left: BrowserEntry, right: BrowserEntry): number {
  const leftPriority = entryRelevance(left);
  const rightPriority = entryRelevance(right);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  if (left.source !== right.source) return left.source === 'component' ? -1 : 1;
  if (left.source === 'component' && right.source === 'component') {
    return compareEntryNames(left, right);
  }
  if (left.source !== 'asset' || right.source !== 'asset') return compareEntryNames(left, right);
  return compareEntryNames(left, right);
}

/** Descending by value, with UNMEASURED (`undefined`) always last. */
function compareMeasured(left: number | undefined, right: number | undefined): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return right - left;
}

function compareAssetFiles(
  left: Extract<BrowserEntry, { source: 'asset' }>,
  right: Extract<BrowserEntry, { source: 'asset' }>,
  sort: AssetSort,
): number {
  if (left.entry.type !== right.entry.type) return left.entry.type === 'directory' ? -1 : 1;
  // An entry the backend did not measure sorts LAST in either metric rather
  // than as 0 bytes / 1970 — which put unmeasured files at the bottom of
  // "largest first" and the bottom of "most recent" as if they had been read.
  if (sort === 'size' && left.entry.size !== right.entry.size)
    return compareMeasured(left.entry.size, right.entry.size);
  if (sort === 'modified' && left.entry.modifiedAt !== right.entry.modifiedAt)
    return compareMeasured(left.entry.modifiedAt, right.entry.modifiedAt);
  if (sort === 'type') {
    const order = getAssetKind(left.entry).localeCompare(getAssetKind(right.entry));
    if (order !== 0) return order;
  }
  if (sort === 'health') {
    const order = projectAssetHealth(left.name).localeCompare(projectAssetHealth(right.name));
    if (order !== 0) return order;
  }
  return compareEntryNames(left, right);
}

function compareAssetEntries(left: BrowserEntry, right: BrowserEntry, sort: AssetSort): number {
  if (sort === 'relevance') return compareRelevance(left, right);
  if (sort === 'name') return compareEntryNames(left, right);
  if (left.source !== right.source) return left.source === 'component' ? -1 : 1;
  if (left.source !== 'asset' || right.source !== 'asset') {
    return compareEntryNames(left, right);
  }
  return compareAssetFiles(left, right, sort);
}

function browserEntryMatches(
  item: BrowserEntry,
  options: {
    query: string;
    scope: ContentScope;
    facets: readonly ProjectContentFacet[];
    filter: AssetFilter;
    shownPath: string;
  },
): boolean {
  if (options.query && !`${item.name} ${item.path}`.toLowerCase().includes(options.query)) {
    return false;
  }
  if (options.scope === 'content' && options.facets.length > 0) {
    const facet = browserEntryFacet(item);
    return options.facets.includes(facet);
  }
  return options.scope === 'content' || matchesAssetFilter(item, options.filter, options.shownPath);
}

const GRID_ENTRY_STYLE: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  padding: 0,
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 3,
};

const LIST_ENTRY_STYLE: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  minHeight: 28,
  padding: '3px 6px',
  textAlign: 'left',
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 7,
};

function liveAuthoringAssets(
  adapter: AuthoringAdapter,
): Map<string, { id: string; subject: AuthoringAssetSubject }> {
  const assets = new Map<string, { id: string; subject: AuthoringAssetSubject }>();
  if (!adapter.assetSubject) return assets;
  const entries =
    adapter.assetSubject.entries?.() ??
    hierarchyNodesBreadthFirst(adapter.hierarchy).flatMap((node) => {
      const subject = adapter.assetSubject?.get(node.id);
      return subject ? [{ id: node.id, subject }] : [];
    });
  for (const { id, subject } of entries) {
    const normalized = subject.sourcePath?.replaceAll('\\', '/').replace(/^\.\//, '') ?? '';
    const srcMarker = normalized.lastIndexOf('/src/');
    const source = srcMarker >= 0 ? normalized.slice(srcMarker + 1) : normalized;
    assets.set(`${source}:${subject.name}`, { id, subject });
  }
  return assets;
}

const emptySubscribe = (): (() => void) => () => undefined;
const zeroSnapshot = (): number => 0;

function SpritesheetFrameThumb({
  sheetUrl,
  frame,
}: {
  sheetUrl: string;
  frame: ProjectContentSpritesheetFrame;
}) {
  return (
    <SpritesheetSpriteView
      sheetUrl={sheetUrl}
      frame={{
        name: '',
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        rotated: frame.rotated,
        sourceWidth: frame.sourceWidth,
        sourceHeight: frame.sourceHeight,
        trimX: frame.trimX,
        trimY: frame.trimY,
      }}
      maxEdge={48}
    />
  );
}

function BrowserEntryVisual({
  item,
  kind,
  assetUrl,
  grid,
  folderPath,
  previewRevision,
}: {
  item: BrowserEntry;
  kind: BrowserKind;
  assetUrl: string;
  grid: boolean;
  folderPath: string;
  previewRevision: number;
}) {
  const paintUrl = assetUrl;
  if (kind === 'folder') {
    // The list keeps the compact glyph (assets show flat icons there too);
    // Browse grid folders composite their contents.
    if (!grid) return <AssetIcon kind="folder" size={15} />;
    return (
      <FolderPreviewTile
        root={item.source === 'asset' ? item.root : 'public'}
        folderPath={folderPath}
        revision={previewRevision}
      />
    );
  }
  if (kind === 'audio' && assetUrl) {
    return <AudioAssetThumb url={paintUrl} name={item.name} />;
  }
  if (!grid) return <AssetIcon kind={kind} size={15} />;
  if (item.source === 'available' && item.available.descriptor.preview) {
    return (
      <DocumentThumbnail
        documentId={item.available.descriptor.id}
        source={item.available.descriptor.preview}
        previewRevision={previewRevision}
      />
    );
  }
  if (item.source === 'component') {
    // The source that admitted this component paints it. The host does not
    // know what the picture IS (a mounted portable story, a rendered turntable,
    // whatever a later source brings) — only where it goes.
    const { Thumbnail } = item.contentSource;
    return <Thumbnail entry={item.contentEntry} previewRevision={previewRevision} />;
  }
  if (assetCapabilities(item.name).editor === 'environment') {
    // Browsers cannot decode HDR/EXR through <img>; the real native-loader
    // preview lives in the environment Asset Lab document.
    return <TypedAssetThumbnail kind="image" name={item.name} />;
  }
  if (kind === 'image') {
    if (item.source === 'asset' && item.spritesheet) {
      return (
        <SpritesheetFrameThumb
          sheetUrl={`/${item.spritesheet.sheetPath}`}
          frame={item.spritesheet}
        />
      );
    }
    return (
      <img
        src={paintUrl}
        alt={item.name}
        style={{ maxWidth: 48, maxHeight: 48, objectFit: 'contain', borderRadius: radius.sm }}
      />
    );
  }
  if (kind === 'video' && paintUrl) {
    // The clip itself, one frame of it. `preload="metadata"` fetches enough for
    // a frame and nothing more, there is no autoplay and no sound (a wall of
    // tiles must not start playing at anyone), and the `#t=0.1` MEDIA FRAGMENT
    // is what makes a frame actually appear: a bare metadata preload leaves the
    // element painting black until something seeks it, which is the same "I
    // can't see the asset" a text row would have been.
    return (
      <video
        src={`${paintUrl}#t=0.1`}
        muted
        playsInline
        preload="metadata"
        style={{ maxWidth: 48, maxHeight: 48, objectFit: 'contain', borderRadius: radius.sm }}
      />
    );
  }
  if (kind === 'model' || assetThumbnailRenderer(assetUrl)) {
    return <ModelThumbnail url={assetUrl} />;
  }
  if (['prefab', 'json'].includes(kind)) {
    return <TypedAssetThumbnail kind={kind} name={item.name} />;
  }
  return <AssetIcon kind={kind} />;
}

function BrowserEntryCard({
  item,
  selected,
  onDragStart,
  onSelect,
  onOpen,
  onContextMenu,
  viewMode,
  previewRevision,
  showPath,
}: {
  item: BrowserEntry;
  selected: boolean;
  onDragStart: (event: React.DragEvent, item: BrowserEntry) => void;
  onSelect: (item: BrowserEntry, event: React.MouseEvent | React.KeyboardEvent) => void;
  onOpen: (item: BrowserEntry) => void;
  onContextMenu: (event: React.MouseEvent, item: BrowserEntry) => void;
  viewMode: AssetViewMode;
  previewRevision: number;
  showPath: boolean;
}) {
  const kind = browserEntryKind(item);
  const assetEntry = item.source === 'asset' ? item.entry : null;
  const capability = assetEntry?.type === 'file' ? assetCapabilities(assetEntry.name) : null;
  const assetUrl = item.source === 'asset' ? assetRootServingUrl(item.root, item.path) : '';
  const folderPath = item.path;
  const title = browserEntryTitle(item);
  const cursor = assetEntry
    ? assetEntry.type === 'directory' || capability?.placeable
      ? capability?.placeable
        ? 'grab'
        : 'pointer'
      : 'default'
    : 'pointer';
  const itemDetail = browserEntryDetail(item);
  const location =
    item.source === 'component'
      ? item.path
      : item.source === 'asset'
        ? projectAssetPath(item.root, parentAssetPath(item.path)).replace(/\/$/, '')
        : parentAssetPath(item.path) || 'public';
  const detail = showPath ? `${location} · ${itemDetail}` : itemDetail;
  // Tile presentation (full preview box, name under it, badges) is shared by
  // Both flat Content and Browse grid use tiles; only Browse list is compact.
  const grid = viewMode !== 'list';

  return (
    <div
      className="vgai-selectable vgai-project-asset-entry"
      data-selected={selected || undefined}
      data-view={viewMode}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      draggable={
        item.source === 'component' ||
        (item.source === 'asset' &&
          assetEntry?.type === 'file' &&
          capability?.placeable === true) ||
        // Draggable so the refusal can SPEAK (a non-draggable card fires no
        // dragstart, and nothing else says why the drag did nothing).
        (item.source === 'asset' && item.spritesheet !== undefined) ||
        (item.source === 'asset' && item.root === REFERENCE_ROOT && assetEntry?.type === 'file')
      }
      onPointerEnter={() => {
        if (kind === 'audio' && assetUrl) previewAssetAudio(assetUrl);
      }}
      onPointerLeave={() => {
        if (kind === 'audio' && assetUrl) stopAssetAudioPreview(assetUrl);
      }}
      onDragStart={(event) => onDragStart(event, item)}
      onDragEnd={reportUnacceptedAssetDrop}
      onClick={(event) => onSelect(item, event)}
      onDoubleClick={() => onOpen(item)}
      onContextMenu={(event) => onContextMenu(event, item)}
      onKeyDown={(event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          event.currentTarget.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              clientX: rect.left,
              clientY: rect.bottom,
            }),
          );
        } else if (event.key === 'Enter') onOpen(item);
        else if (event.key === ' ') {
          onSelect(item, event);
          event.preventDefault();
        }
      }}
      title={title}
      style={{
        ...(grid ? GRID_ENTRY_STYLE : LIST_ENTRY_STYLE),
        borderRadius: radius.sm,
        cursor,
        userSelect: 'none',
      }}
    >
      <div
        className="vgai-project-asset-entry__preview"
        data-testid="asset-entry-preview"
        style={{
          ...(grid
            ? {
                width: '100%',
                aspectRatio:
                  item.source === 'available' && item.available.descriptor.preview
                    ? '16 / 9'
                    : '1 / 1',
                margin: '0 auto',
              }
            : { width: 18, height: 18, margin: 0 }),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderRadius: radius.sm,
          pointerEvents: 'none',
          position: 'relative',
        }}
      >
        <BrowserEntryVisual
          item={item}
          kind={kind}
          assetUrl={assetUrl}
          grid={grid}
          folderPath={folderPath}
          previewRevision={previewRevision}
        />
        {grid && (
          <span
            className="vgai-project-asset-entry__kind"
            data-testid="asset-entry-kind"
            title={`${kind} asset`}
          >
            <AssetIcon kind={kind} size={11} />
          </span>
        )}
      </div>
      <div
        data-testid="asset-entry-name"
        style={{
          ...(grid
            ? {
                fontSize: 10,
                lineHeight: '13px',
                minHeight: 26,
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 2,
              }
            : { fontSize: 11, lineHeight: '18px', flex: 1 }),
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: grid ? 'normal' : 'nowrap',
          color: text[1],
          minWidth: 0,
        }}
      >
        {item.name}
      </div>
      {!grid && (
        <div
          role="listbox"
          aria-label="Project assets"
          aria-multiselectable="true"
          style={{
            maxWidth: '45%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: text[3],
            fontSize: 10,
          }}
        >
          {detail}
        </div>
      )}
    </div>
  );
}

interface AssetBrowserToolbarProps {
  scope: ContentScope;
  facets: readonly ProjectContentFacet[];
  /** The kinds the project holds — the only chips offered. */
  availableFacets: ReadonlySet<ProjectContentFacet>;
  currentPath: string;
  searchOpen: boolean;
  searchQuery: string;
  viewMode: AssetViewMode;
  density: number;
  treeVisible: boolean;
  onScopeChange: (scope: ContentScope) => void;
  onFacetToggle: (facet: ProjectContentFacet) => void;
  onFacetsClear: () => void;
  currentRoot: AssetRoot;
  onNavigate: (root: AssetRoot, path: string) => void;
  onSearchOpenChange: (open: boolean) => void;
  onSearchQueryChange: (query: string) => void;
  onViewModeChange: (mode: AssetViewMode) => void;
  onDensityChange: (density: number) => void;
  onTreeVisibilityToggle: () => void;
  onCreateFolder: () => void;
  onImport: () => void;
  onDelete: () => void;
  deleteDisabled: boolean;
  onRefresh: () => void;
  generationTools: readonly { id: string; title: string }[];
  onGenerate: () => void;
}

function AssetBrowserToolbar({
  scope,
  facets,
  availableFacets,
  currentPath,
  currentRoot,
  searchOpen,
  searchQuery,
  viewMode,
  density,
  treeVisible,
  onScopeChange,
  onFacetToggle,
  onFacetsClear,
  onNavigate,
  onSearchOpenChange,
  onSearchQueryChange,
  onViewModeChange,
  onDensityChange,
  onTreeVisibilityToggle,
  onCreateFolder,
  onImport,
  onDelete,
  deleteDisabled,
  onRefresh,
  generationTools,
  onGenerate,
}: AssetBrowserToolbarProps) {
  const actionsRef = useRef<HTMLDivElement>(null);
  const breadcrumbEndAnchoredRef = useRef(true);
  const breadcrumbRef = useRef<HTMLElement>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const breadcrumbSegments = currentPath ? currentPath.split('/') : [];
  const parentPath = parentAssetPath(currentPath);
  // The root crumb names the root being browsed: the shipped files, or the
  // project's reference material.
  const rootLabel = currentRoot === REFERENCE_ROOT ? 'References' : 'Files';
  const closeSearch = () => {
    onSearchQueryChange('');
    onSearchOpenChange(false);
  };
  useEffect(() => {
    if (!actionsOpen) return;
    const close = (event: PointerEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) setActionsOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [actionsOpen]);
  useLayoutEffect(() => {
    const breadcrumb = breadcrumbRef.current;
    if (!breadcrumb) return;
    const scrollToEnd = () => {
      breadcrumb.scrollLeft = breadcrumb.scrollWidth;
    };
    breadcrumbEndAnchoredRef.current = true;
    scrollToEnd();
    const updateEndAnchor = () => {
      breadcrumbEndAnchoredRef.current =
        breadcrumb.scrollWidth - breadcrumb.clientWidth - breadcrumb.scrollLeft <= 1;
    };
    breadcrumb.addEventListener('scroll', updateEndAnchor, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (breadcrumbEndAnchoredRef.current) scrollToEnd();
          });
    resizeObserver?.observe(breadcrumb);
    return () => {
      breadcrumb.removeEventListener('scroll', updateEndAnchor);
      resizeObserver?.disconnect();
    };
  }, [currentPath, searchOpen]);

  return (
    <div className="vgai-project-assets-toolbar">
      <EditorToolbar label="Content display" compact className="vgai-project-assets-toolbar__row">
        <ToolbarGroup>
          <Tooltip text="Content grid" position="top">
            <IconButton
              aria-label="Content grid"
              data-testid="content-scope-content"
              aria-pressed={scope === 'content'}
              onClick={() => {
                if (scope !== 'content') onScopeChange('content');
                onViewModeChange('grid');
              }}
            >
              <EditorIcon icon={faTableCellsLarge} />
            </IconButton>
          </Tooltip>
          <Tooltip text="Browse grid" position="top">
            <IconButton
              aria-label="Browse grid"
              data-testid="content-scope-files"
              aria-pressed={scope === 'files' && viewMode === 'grid'}
              onClick={() => {
                if (scope !== 'files') onScopeChange('files');
                onViewModeChange('grid');
              }}
            >
              <EditorIcon icon={faTable} />
            </IconButton>
          </Tooltip>
          <Tooltip text="Browse list" position="top">
            <IconButton
              aria-label="Browse list"
              data-testid="asset-view-list"
              aria-pressed={scope === 'files' && viewMode === 'list'}
              onClick={() => {
                if (scope !== 'files') onScopeChange('files');
                onViewModeChange('list');
              }}
            >
              <EditorIcon icon={faList} />
            </IconButton>
          </Tooltip>
        </ToolbarGroup>
        <span style={{ flex: 1 }} />
        {searchOpen ? (
          <TextInput
            type="text"
            data-testid="asset-search-input"
            aria-label="Search content"
            placeholder="Search content..."
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeSearch();
            }}
            className="vgai-input"
            autoFocus
            style={{ flex: '0 1 160px', minWidth: 60 }}
          />
        ) : null}

        <Tooltip text={searchOpen ? 'Close search' : 'Search'} position="top">
          <IconButton
            data-testid={searchOpen ? 'asset-search-close' : 'asset-search-toggle'}
            aria-label={searchOpen ? 'Close search' : 'Search content'}
            onClick={() => {
              if (searchOpen) closeSearch();
              else onSearchOpenChange(true);
            }}
          >
            <EditorIcon icon={searchOpen ? editorIcons.action.close : editorIcons.action.search} />
          </IconButton>
        </Tooltip>
      </EditorToolbar>
      <EditorToolbar
        label={scope === 'content' ? 'Content types' : 'Folder navigation'}
        compact
        className="vgai-project-assets-toolbar__row"
      >
        {scope === 'files' && (
          <>
            <Tooltip text={treeVisible ? 'Hide folders' : 'Show folders'} position="top">
              <IconButton
                data-testid="asset-tree-toggle"
                aria-label={treeVisible ? 'Hide folder tree' : 'Show folder tree'}
                aria-controls="project-asset-tree"
                aria-expanded={treeVisible}
                onClick={onTreeVisibilityToggle}
              >
                <EditorIcon icon={faFolderTree} />
              </IconButton>
            </Tooltip>
            <Tooltip text="Back" position="top">
              <IconButton
                data-testid="asset-back"
                aria-label="Back"
                disabled={!currentPath}
                onClick={() => onNavigate(currentRoot, parentPath)}
              >
                <EditorIcon icon={faArrowLeft} />
              </IconButton>
            </Tooltip>
            <nav
              ref={breadcrumbRef}
              data-testid="asset-breadcrumb"
              aria-label="Asset location"
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                fontSize: 12,
                minWidth: 0,
                overflowX: 'auto',
                overflowY: 'hidden',
                whiteSpace: 'nowrap',
              }}
            >
              {currentPath ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="compact"
                  onClick={() => onNavigate(currentRoot, '')}
                  style={{ flexShrink: 0 }}
                >
                  {rootLabel}
                </Button>
              ) : (
                <span aria-current="location" style={{ color: text[1] }}>
                  {rootLabel}
                </span>
              )}
              {breadcrumbSegments.map((segment, index) => {
                const path = breadcrumbSegments.slice(0, index + 1).join('/');
                const isLast = index === breadcrumbSegments.length - 1;
                return (
                  <span
                    key={path}
                    style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}
                  >
                    <span style={{ color: text[3] }}>/</span>
                    {isLast ? (
                      <span aria-current="location" title={segment} style={{ color: text[1] }}>
                        {segment}
                      </span>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="compact"
                        onClick={() => onNavigate(currentRoot, path)}
                      >
                        {segment}
                      </Button>
                    )}
                  </span>
                );
              })}
            </nav>
          </>
        )}
        {scope === 'content' && (
          <ToolbarGroup className="vgai-content-filter-inline" aria-label="Content types">
            {searchOpen && (
              <Button
                variant="ghost"
                size="compact"
                className="vgai-content-filter-chip"
                data-testid="content-filter-all"
                aria-pressed={facets.length === 0}
                onClick={onFacetsClear}
              >
                All
              </Button>
            )}
            {[
              ...(
                [
                  ['component', 'Prefabs'],
                  ['scene', 'Scenes'],
                  ['canvas', 'Canvases'],
                  ['model', 'Models'],
                  ['image', 'Images'],
                  ['video', 'Videos'],
                  ['audio', 'Audio'],
                  ['other', 'Other'],
                ] as const
              ).filter(([facet]) => availableFacets.has(facet)),
              ...[...availableFacets]
                .filter((facet) => !FIXED_FACETS.has(facet))
                .sort()
                .map((facet): readonly [string, string] => [facet, facetLabel(facet)]),
            ].map(([facet, label]) => (
              <Button
                key={facet}
                variant="ghost"
                size="compact"
                className="vgai-content-filter-chip"
                data-testid={`content-filter-${facet}`}
                aria-pressed={facets.includes(facet)}
                onClick={() => onFacetToggle(facet)}
              >
                {label}
              </Button>
            ))}
          </ToolbarGroup>
        )}
        <div ref={actionsRef} className="vgai-project-assets-toolbar__more">
          <Tooltip text="More asset actions" position="top">
            <IconButton
              aria-label="More asset actions"
              aria-expanded={actionsOpen}
              aria-haspopup="menu"
              onClick={() => setActionsOpen((value) => !value)}
            >
              <EditorIcon icon={faEllipsis} />
            </IconButton>
          </Tooltip>
          {actionsOpen && (
            <Menu
              autoFocusFirst
              className="vgai-project-assets-toolbar__menu"
              onDismiss={() => setActionsOpen(false)}
            >
              <MenuItem
                data-command-id={PROJECT_ASSET_COMMANDS.import.id}
                onSelect={() => {
                  setActionsOpen(false);
                  onImport();
                }}
              >
                Import files…
              </MenuItem>
              <MenuItem
                data-command-id={PROJECT_ASSET_COMMANDS.createFolder.id}
                onSelect={() => {
                  setActionsOpen(false);
                  onCreateFolder();
                }}
              >
                New folder
              </MenuItem>
              {generationTools.length > 0 && (
                <>
                  <hr className="vgai-menu-separator" />
                  <MenuItem
                    onSelect={() => {
                      setActionsOpen(false);
                      onGenerate();
                    }}
                  >
                    Create asset…
                  </MenuItem>
                </>
              )}
              <MenuItem
                onSelect={() => {
                  setActionsOpen(false);
                  onDensityChange(density <= 96 ? 132 : 88);
                }}
              >
                {density <= 96 ? 'Larger thumbnails' : 'Smaller thumbnails'}
              </MenuItem>
              <MenuItem
                disabled={deleteDisabled}
                data-command-id={PROJECT_ASSET_COMMANDS.delete.id}
                onSelect={() => {
                  setActionsOpen(false);
                  onDelete();
                }}
              >
                Delete selected
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  setActionsOpen(false);
                  onRefresh();
                }}
              >
                Refresh
              </MenuItem>
            </Menu>
          )}
        </div>
      </EditorToolbar>
    </div>
  );
}

function ProjectAssetTree(props: {
  currentRoot: AssetRoot;
  currentPath: string;
  expanded: ReadonlySet<string>;
  hidden: boolean;
  revision: number;
  loadAssets: typeof listAssets;
  onExpanded(path: string): void;
  onNavigate(root: AssetRoot, path: string): void;
}) {
  const [folders, setFolders] = useState(new Map<string, string[]>());

  useEffect(() => {
    setFolders(new Map());
  }, [props.revision]);

  useEffect(() => {
    for (const key of props.expanded) {
      if (folders.has(key)) continue;
      const root = ASSET_ROOTS.find(
        (candidate) => key === candidate || key.startsWith(`${candidate}/`),
      );
      if (!root) continue;
      const path = key === root ? '' : key.slice(`${root}/`.length);
      void props.loadAssets(root, path).then((listed) => {
        // A FAILED listing leaves this node UNRECORDED rather than recorded as
        // having no subfolders: the map's `has(key)` is the "already loaded"
        // gate, so recording an empty array would pin a folder open and empty
        // for the session. Not recording it means the next expand retries.
        if (!listed.ok) return;
        setFolders((current) => {
          const next = new Map(current);
          next.set(
            key,
            listed.entries.filter((entry) => entry.type === 'directory').map((entry) => entry.name),
          );
          return next;
        });
      });
    }
  }, [folders, props.expanded, props.loadAssets]);

  const renderFolder = (root: AssetRoot, path: string, depth: number): React.ReactNode => {
    const key = path ? `${root}/${path}` : root;
    const open = props.expanded.has(key);
    const name = path.split('/').pop() || root;
    return (
      <div key={key}>
        <div className="vgai-asset-tree-row" style={{ paddingLeft: 6 + depth * 14 }}>
          <IconButton
            className="vgai-asset-tree-toggle"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`}
            aria-expanded={open}
            onClick={() => props.onExpanded(key)}
          >
            <EditorIcon
              icon={faChevronRight}
              style={{ transform: open ? 'rotate(90deg)' : undefined }}
            />
          </IconButton>
          <Button
            variant="ghost"
            size="compact"
            className="vgai-asset-tree-target"
            aria-current={
              props.currentRoot === root && props.currentPath === path ? 'page' : undefined
            }
            onClick={() => props.onNavigate(root, path)}
          >
            <EditorIcon icon={faFolder} />
            {name}
          </Button>
        </div>
        {open &&
          folders
            .get(key)
            ?.map((child) => renderFolder(root, path ? `${path}/${child}` : child, depth + 1))}
      </div>
    );
  };

  return (
    <aside
      id="project-asset-tree"
      className="vgai-asset-tree"
      aria-label="Project asset sources"
      hidden={props.hidden}
    >
      <div className="vgai-asset-facet-title">Project</div>
      {renderFolder('public', '', 0)}
      <Button
        variant="ghost"
        size="compact"
        className="vgai-asset-tree-target"
        onClick={() => props.onNavigate('public', 'asset-library/local')}
      >
        Imported
      </Button>
      <Button
        variant="ghost"
        size="compact"
        className="vgai-asset-tree-target"
        onClick={() => props.onNavigate('public', '.generated')}
      >
        Generated
      </Button>
      {/* The project's own reference material — a real folder beside public/,
          browsed the same way. It is listed even when empty so the place to put
          a moodboard is discoverable, and it is never exported. */}
      <div className="vgai-asset-facet-title">References</div>
      {renderFolder(REFERENCE_ROOT, '', 0)}
    </aside>
  );
}

function useAdaptiveAssetTree(initialVisibility: AssetTreeVisibility) {
  const browserRef = useRef<HTMLDivElement>(null);
  const [treeVisibility, setTreeVisibility] = useState(initialVisibility);
  const [hasTreeSpace, setHasTreeSpace] = useState(true);

  useLayoutEffect(() => {
    const browser = browserRef.current;
    if (!browser) return;
    const updateAvailableSpace = (width: number) => {
      if (width > 0) setHasTreeSpace(width >= ASSET_TREE_MIN_INLINE_SIZE);
    };
    updateAvailableSpace(browser.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateAvailableSpace(entry.contentRect.width);
    });
    observer.observe(browser);
    return () => observer.disconnect();
  }, []);

  const treeVisible = treeVisibility === 'shown' || (treeVisibility === 'auto' && hasTreeSpace);
  const toggleTreeVisibility = useCallback(() => {
    setTreeVisibility(treeVisible ? 'hidden' : 'shown');
  }, [treeVisible]);

  return { browserRef, treeVisibility, treeVisible, toggleTreeVisibility };
}

export function AssetBrowser({ services = DEFAULT_ASSET_BROWSER_SERVICES }: AssetBrowserProps) {
  const store = useEditorStore();
  const subscribeStore = typeof store.subscribe === 'function' ? store.subscribe : emptySubscribe;
  const readStoreVersion =
    typeof store.getSnapshot === 'function' ? store.getSnapshot : zeroSnapshot;
  const readShellVersion =
    typeof store.getShellSnapshot === 'function' ? store.getShellSnapshot : readStoreVersion;
  const storeVersion = useSyncExternalStore(subscribeStore, readShellVersion, readShellVersion);
  const adapterVersion = useSyncExternalStore(
    subscribeActiveAuthoring,
    activeAuthoringVersion,
    activeAuthoringVersion,
  );
  const workspaceDocumentVersion = useSyncExternalStore(
    subscribeWorkspaceDocuments,
    workspaceDocumentRegistryVersion,
    workspaceDocumentRegistryVersion,
  );
  const storeRef = useRef(store);
  storeRef.current = store;
  const history = useHistoryService();
  const toolContributions = useSyncExternalStore(
    subscribeToolContributions,
    getGlobalToolContributions,
    getGlobalToolContributions,
  );
  // ONE subscription for every registered content source AND the registry
  // itself: a source's own ledger settling (portable-story discovery finishing)
  // re-reads the Content scope without the panel knowing what moved.
  const contentSourceVersion = useSyncExternalStore(
    subscribeContentEntrySources,
    contentEntrySourceRegistryVersion,
    contentEntrySourceRegistryVersion,
  );
  const generationTools = toolContributions.filter(
    (item) => item.point === 'workspace.document' && item.tool?.generation?.role === 'submit',
  );
  const initial = useMemo(readAssetBrowserState, []);
  // Browse Files navigates ONE root at a time; Content shows them all at once.
  const [currentRoot, setCurrentRoot] = useState<AssetRoot>(initial.root);
  const [scope, setScope] = useState<ContentScope>(initial.scope);
  const [facets, setFacets] = useState<ProjectContentFacet[]>(initial.facets);
  const [currentPath, setCurrentPath] = useState(initial.currentPath);
  const [viewMode, setViewMode] = useState<AssetViewMode>(initial.viewMode);
  const [sort, setSort] = useState<AssetSort>(initial.scope === 'content' ? 'relevance' : 'name');
  const [filter, setFilter] = useState<AssetFilter>('all');
  const [density, setDensity] = useState(initial.density);
  const { browserRef, treeVisibility, treeVisible, toggleTreeVisibility } = useAdaptiveAssetTree(
    initial.treeVisibility,
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [listing, setListing] = useState<FolderListing>({
    path: initial.currentPath,
    entries: [],
  });
  const [contentAssets, setContentAssets] = useState<ProjectContentAsset[]>([]);
  const [components, setComponents] = useState<ProjectComponentEntry[]>([]);
  const availableDocuments = useSyncExternalStore(
    subscribeAvailableWorkspaceDocuments,
    availableWorkspaceDocuments,
  );
  const adapterFacet = useSyncExternalStore(
    subscribeProjectAdapter,
    projectAdapterFacet,
    projectAdapterFacet,
  );
  const [contentLoading, setContentLoading] = useState(false);
  /** Listings that FAILED during the last Content scan, by name and reason. */
  const [contentFailures, setContentFailures] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(new Set(initial.expanded));
  const [treeRevision, setTreeRevision] = useState(0);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFiles, setSelectedFiles] = useState(new Set<string>());
  const [operationError, setOperationError] = useState<string | null>(null);
  /**
   * The asset browser's own inline prompt. `window.prompt` is banned in editor
   * UI (it blocks the whole tab and cannot be styled or driven), and this panel
   * still had three of them — folder name, rename, move-to-folder. One piece of
   * state serves all three: the question, the draft, and what to do with it.
   */
  const [prompt, setPrompt] = useState<{
    readonly title: string;
    readonly initial: string;
    readonly confirmLabel: string;
    readonly run: (value: string) => void | Promise<void>;
  } | null>(null);
  const [promptDraft, setPromptDraft] = useState('');
  const askFor = useCallback(
    (question: {
      readonly title: string;
      readonly initial: string;
      readonly confirmLabel: string;
      readonly run: (value: string) => void | Promise<void>;
    }): void => {
      setPromptDraft(question.initial);
      setPrompt(question);
    },
    [],
  );
  /** True while the panel is showing a drop target for OS files. */
  const [fileDropActive, setFileDropActive] = useState(false);
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: BrowserEntry;
  } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const cacheRef = useRef(new Map<string, AssetEntry[]>());
  /** Latest fetch key; an older in-flight fetch resolving late must not win. */
  const listingRequestRef = useRef('');

  useEffect(() => {
    writeProjectLocalSection(
      CONTENT_BROWSER_SECTION,
      {
        scope,
        root: currentRoot,
        facets,
        currentPath,
        viewMode,
        sort,
        filter,
        density,
        expanded: [...expanded],
        treeVisibility,
      } satisfies PersistedAssetBrowserState,
    );
  }, [
    currentPath,
    currentRoot,
    density,
    expanded,
    facets,
    filter,
    scope,
    sort,
    treeVisibility,
    viewMode,
  ]);

  const fetchEntries = useCallback(
    async (root: AssetRoot, dir: string) => {
      const key = `${root}:${dir}`;
      listingRequestRef.current = key;
      // Path and entries land in ONE state update, only if this is still the
      // newest request — navigate A→B→A can otherwise apply B's late result.
      const apply = (entries: AssetEntry[], failure?: string) => {
        if (listingRequestRef.current !== key) return;
        setListing({ path: dir, entries, ...(failure === undefined ? {} : { failure }) });
      };
      const cached = cacheRef.current.get(key);
      if (cached) {
        apply(cached);
        return;
      }
      try {
        const listed = await services.listAssets(root, dir);
        // A FAILED listing is never cached — caching it would pin "this folder
        // is empty" for the rest of the session over a transient backend error.
        if (!listed.ok) {
          apply([], listed.reason);
          return;
        }
        cacheRef.current.set(key, listed.entries);
        apply(listed.entries);
      } catch (error) {
        apply([], error instanceof Error ? error.message : String(error));
      }
    },
    [services],
  );

  useEffect(() => {
    fetchEntries(currentRoot, currentPath);
  }, [currentRoot, currentPath, fetchEntries]);

  const fetchContent = useCallback(async () => {
    setContentLoading(true);
    try {
      const [listed, componentListing] = await Promise.all([
        collectProjectContentAssets(services.listAssets),
        services.listProjectComponents(),
      ]);
      const assets = await expandSpritesheetContentAssets(listed.assets, async (path) => {
        try {
          const response = await fetch(`/${path}`);
          return response.ok ? await response.text() : null;
        } catch {
          return null;
        }
      });
      setContentAssets(assets);
      setComponents(componentListing.ok ? componentListing.entries : []);
      // An empty Content gallery over a FAILED scan is the fabrication this
      // panel is most likely to show an author: their project looks emptied.
      // Both halves report by name; neither is silently absorbed into `[]`.
      setContentFailures([
        ...listed.failedListings,
        ...(componentListing.ok ? [] : [`component index: ${componentListing.reason}`]),
      ]);
    } catch (error) {
      setContentAssets([]);
      setComponents([]);
      setContentFailures([error instanceof Error ? error.message : String(error)]);
    } finally {
      setContentLoading(false);
    }
  }, [services]);

  useEffect(() => {
    if (scope === 'content') void fetchContent();
  }, [fetchContent, scope]);

  const navigate = useCallback((root: AssetRoot, path: string) => {
    setCurrentRoot(root);
    setCurrentPath(path);
    setSelectedFiles(new Set());
    setSelectionAnchor(null);
    clearSelectedAsset();
    setSearchQuery('');
    setSearchOpen(false);
  }, []);

  const changeScope = useCallback((nextScope: ContentScope) => {
    setScope(nextScope);
    setSort(nextScope === 'content' ? 'relevance' : 'name');
    setFilter('all');
    setSelectedFiles(new Set());
    setSelectionAnchor(null);
    clearSelectedAsset();
  }, []);

  const selectFacet = useCallback((facet: ProjectContentFacet) => {
    setFacets([facet]);
  }, []);

  const changeSearchOpen = useCallback((open: boolean) => {
    setSearchOpen(open);
    if (!open) setFacets((current) => (current.length > 0 ? current : ['component']));
  }, []);

  // Content is a semantic, flattened projection over project-owned components
  // and public assets. Browse Files remains the literal public/ navigator; it
  // never invents synthetic folders for semantic concepts.
  //
  // Everything derived from the entries reads `shownPath` — the path the
  // rendered listing was actually fetched for — never `currentPath`, which
  // runs ahead of the listing during navigation (see FolderListing).
  const shownPath = listing.path;
  const authoredAssets = useMemo(
    () => liveAuthoringAssets(resolvePanelAuthoring(storeRef.current).adapter),
    [adapterVersion, storeVersion, workspaceDocumentVersion],
  );
  const activeContentSurface = useMemo(
    () => resolvePanelAuthoring(storeRef.current).surface,
    [adapterVersion, storeVersion, workspaceDocumentVersion],
  );
  const browserEntries = useMemo<BrowserEntry[]>(() => {
    if (scope === 'content') {
      // WHICH components are content, and why, belongs to whatever REGISTERED
      // a content source (`content-entry-source-registry.ts`). Source shape
      // alone cannot distinguish a reusable prefab from scene composition or
      // implementation detail, and the answer that can is a package's
      // (portable CSF today) — the host hands over its component index and
      // the focused surface and takes back rows.
      // A source answers about a NARROW ref (name, path, surface) — the shape
      // the Inspector's one-component question also has — so the grid pairs
      // each answer back with its own index row, which is what carries the
      // chip, the kind, the relevance and the detail line.
      const indexed = new Map(components.map((entry) => [`${entry.path}:${entry.name}`, entry]));
      const derivedComponents = contentEntrySources().flatMap((source) =>
        source.entries({ components, surface: activeContentSurface }).flatMap((contentEntry) => {
          const component = indexed.get(
            `${contentEntry.component.path}:${contentEntry.component.name}`,
          );
          // A source may only admit components it was GIVEN; one that answers
          // with something else is answering about a project this panel is not
          // showing, and the grid has no row for it.
          if (!component) return [];
          const key = `${component.path.replace(/^\.\//, '')}:${component.name}`;
          const authoringAsset = authoredAssets.get(key);
          return [
            {
              source: 'component' as const,
              key: `component:${source.id}:${contentEntry.id}`,
              name: component.name,
              path: component.path,
              component,
              contentSource: source,
              contentEntry,
              ...(authoringAsset ? { authoringAsset } : {}),
            },
          ];
        }),
      );
      const documentEntries = (adapterFacet?.scenes.entries ?? []).flatMap((document) => {
        if (document.kind === 'prefab') return [];
        // A scene entry whose plan is its root's own document, or an isolation
        // document already offered, is that document's tile, not a second one.
        // The root's document carries no source path when the entry has none.
        const plan = document.kind === 'scene' ? planSceneDocument(document) : null;
        if (
          plan &&
          availableDocuments.some(
            (item) =>
              (item.category === 'scene' || item.category === 'canvas') &&
              ((plan.kind === 'root-document' && item.rootId === plan.regionId) ||
                (plan.kind === 'isolation-document' && item.descriptor.id === plan.documentId) ||
                (!!document.source?.path &&
                  item.descriptor.provenance?.sourcePath?.replace(/^\.\//, '') ===
                    document.source.path.replace(/^\.\//, ''))),
          )
        )
          return [];
        if (document.kind !== 'scene' && !document.source) return [];
        return [
          {
            source: 'document' as const,
            key: `document:${document.id}`,
            name: document.label,
            path: document.source?.path ?? '',
            document,
          },
        ];
      });
      return [
        ...derivedComponents,
        ...documentEntries,
        ...availableDocuments.map((available) => ({
          source: 'available' as const,
          key: `available:${available.descriptor.id}`,
          name: available.descriptor.title,
          path: available.descriptor.provenance?.sourcePath ?? '',
          available,
        })),
        ...contentAssets.map(({ path, root, entry, spritesheet }) => ({
          source: 'asset' as const,
          key: `asset:${root}:${path}`,
          name: entry.name,
          path,
          root,
          entry,
          ...(spritesheet ? { spritesheet } : {}),
        })),
      ];
    }
    return listing.entries.map((entry) => {
      const path = listing.path ? `${listing.path}/${entry.name}` : entry.name;
      return {
        source: 'asset' as const,
        key: `asset:${currentRoot}:${path}`,
        name: entry.name,
        path,
        root: currentRoot,
        entry,
      };
    });
  }, [
    activeContentSurface,
    adapterFacet,
    availableDocuments,
    authoredAssets,
    components,
    contentAssets,
    // The registry's aggregate version: a source registering, or a registered
    // source's own ledger settling. `contentEntrySources()` is a stable array,
    // so this is what says the rows must be rebuilt.
    contentSourceVersion,
    currentRoot,
    listing,
    scope,
  ]);
  /** Why THIS scope's listing has nothing to show, when the reason is a
   *  failure rather than an empty result. `null` = nothing failed. */
  const listingFailure: string | null =
    scope === 'content' ? (contentFailures[0] ?? null) : (listing.failure ?? null);
  const filtered = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const visible = browserEntries.filter((item) =>
      browserEntryMatches(item, { query, scope, facets, filter, shownPath }),
    );
    const effectiveSort = scope === 'files' && sort === 'relevance' ? 'name' : sort;
    return [...visible].sort((left, right) => compareAssetEntries(left, right, effectiveSort));
  }, [browserEntries, facets, shownPath, filter, scope, searchQuery, sort]);
  // The Content chips are the kinds this project HOLDS (ARCHITECTURE-CORE
  // §The project model: chrome from what is declared, never a fixed list).
  const availableFacets = useMemo(() => {
    const present = new Set<ProjectContentFacet>();
    for (const item of browserEntries) present.add(browserEntryFacet(item));
    return present;
  }, [browserEntries]);
  const resultSections = useMemo(
    () => groupContentResults(filtered, scope, facets),
    [facets, filtered, scope],
  );

  // --- Drag start ---
  const onDragStart = useCallback(
    (e: React.DragEvent, item: BrowserEntry) => {
      if (item.source === 'component') {
        // `component` IS the adapter's `AssetDropContext.item`, discriminator
        // included: every drop consumer spreads it as the item, and without
        // `kind: 'component'` the adapter read a prefab drag as a model path
        // and refused it ("is not a .glb/.gltf model" — runhuman pass 45).
        const payload = {
          path: item.path,
          kind: 'component',
          name: item.name,
          component: {
            kind: 'component' as const,
            name: item.component.name,
            sourcePath: item.component.path,
            exportKind: item.component.defaultExport ? 'default' : 'named',
            surface: item.component.surface,
          },
        };
        e.dataTransfer.setData('text/plain', item.name);
        e.dataTransfer.setData('application/x-editor-asset', JSON.stringify(payload));
        return;
      }
      if (item.source === 'document' || item.source === 'available') {
        // A found document has no bytes to drop or size to read; its path is
        // the whole payload, and selecting it selects its source.
        if ('dataTransfer' in e) {
          e.dataTransfer.setData('text/plain', item.path);
          return;
        }
        return;
      }
      const { entry } = item;
      const capability = assetCapabilities(entry.name);
      // A REFERENCE IS NOT A GAME ASSET. It is draggable so the refusal can
      // speak (a non-draggable card fires no dragstart at all) and says the one
      // thing the author needs: this file does not ship.
      if (item.root === REFERENCE_ROOT) {
        e.preventDefault();
        showTransientHint(`${entry.name} is reference material. ${REFERENCE_READ_ONLY_HINT}`);
        return;
      }
      // A SPRITE-SHEET FRAME IS NOT A FILE TO DROP. The Images facet lists
      // every frame of the project's atlases beside real image files; a frame
      // dragged into the 2D scene did nothing and said nothing ("not able to
      // drag an image onto the 2D scene view… part B did not work" — runhuman
      // pass 136). The frame is placed through the component its sheet
      // belongs to — a Prefab — so the drag refuses and says that.
      if (item.spritesheet) {
        e.preventDefault();
        showTransientHint(
          `${entry.name} is one frame of the ${item.spritesheet.sheetPath.split('/').pop() ?? 'sprite sheet'} ` +
            'sprite sheet — it is placed through the Prefab that animates it, not on its own. ' +
            'Drop a Prefab, or a standalone image file.',
        );
        return;
      }
      if (entry.type !== 'file' || !capability.placeable) {
        e.preventDefault();
        return;
      }
      const kind = assetDocumentKind(capability);
      if (!kind) return;
      const path = assetScenePath(currentRoot, parentAssetPath(item.path), entry.name);
      const payload = { path, kind, name: entry.name };
      // Set text/plain first — Chromium silently cancels drags that only
      // carry custom MIME types (no ghost, no drag/dragend events).
      e.dataTransfer.setData('text/plain', entry.name);
      e.dataTransfer.setData('application/x-editor-asset', JSON.stringify(payload));
    },
    [currentRoot],
  );

  // --- Single-click: §5.1 SELECTION (W2) — compact preview/metadata in the
  // Inspector via `asset-selection.ts`; never opens anything. ---
  const onSelectEntry = useCallback(
    (item: BrowserEntry, event: React.MouseEvent | React.KeyboardEvent) => {
      let next = new Set<string>();
      if (event.shiftKey && selectionAnchor) {
        const anchorIndex = filtered.findIndex((entry) => entry.key === selectionAnchor);
        const itemIndex = filtered.findIndex((entry) => entry.key === item.key);
        if (anchorIndex >= 0 && itemIndex >= 0) {
          const [start, end] =
            anchorIndex < itemIndex ? [anchorIndex, itemIndex] : [itemIndex, anchorIndex];
          next = new Set(filtered.slice(start, end + 1).map((entry) => entry.key));
        }
      } else if (event.metaKey || event.ctrlKey) {
        next = new Set(selectedFiles);
        if (next.has(item.key)) next.delete(item.key);
        else next.add(item.key);
        setSelectionAnchor(item.key);
      } else {
        next.add(item.key);
        setSelectionAnchor(item.key);
      }
      setSelectedFiles(next);
      if (item.source === 'component') {
        if (item.component.contentKind === 'image' && item.authoringAsset) {
          setSelectedAsset({
            path: item.authoringAsset.subject.sourcePath ?? item.path,
            name: item.name,
            kind: 'image',
            capabilities: assetCapabilities('svg'),
            health: 'healthy',
            selectionCount: next.size,
          });
          return;
        }
        setSelectedAsset({
          path: item.path,
          name: item.name,
          kind: 'component',
          health: 'healthy',
          selectionCount: next.size,
          componentPreview: {
            surface: item.component.surface,
            sourcePath: item.component.path,
          },
        });
        return;
      }
      if (item.source === 'document' || item.source === 'available') {
        // A found document selects its SOURCE: the kind's own asset inspector
        // (the mesh capability's, for a model) takes it from there.
        setSelectedAsset({
          path: `/${item.path}`,
          name: item.name,
          kind: 'source',
          capabilities: assetCapabilities(item.name),
          origin: 'project',
          health: 'healthy',
          selectionCount: next.size,
        });
        return;
      }
      const { entry } = item;
      if (entry.type === 'directory') {
        clearSelectedAsset();
        return;
      }
      const capability = assetCapabilities(entry.name);
      const kind = assetDocumentKind(capability) ?? 'unknown';
      const servingUrl = assetRootServingUrl(item.root, item.path);
      setSelectedAsset({
        path: servingUrl,
        name: entry.name,
        kind,
        ...(entry.size === undefined ? {} : { sizeBytes: entry.size }),
        capabilities: capability,
        health: projectAssetHealth(entry.name),
        selectionCount: next.size,
        ...(item.path.startsWith('asset-library/local')
          ? { sourcePath: 'Asset Library provenance metadata' }
          : {}),
      });
      // Health inspection reads the SHIPPED tree through the public-rooted
      // storage backend; reference material has no runtime health question to
      // answer, so its row keeps the measurement above.
      if (item.root !== 'public') return;
      const path = item.path;
      void inspectProjectAssetHealthFromStorage(getStorageBackend(), path)
        .then((inspection) => {
          const servingPath = servingUrl;
          if (getSelectedAsset()?.path !== servingPath) return;
          setSelectedAsset({
            path: servingPath,
            name: entry.name,
            kind,
            ...(entry.size === undefined ? {} : { sizeBytes: entry.size }),
            capabilities: capability,
            health:
              inspection.health.status === 'healthy'
                ? 'healthy'
                : capability.runtimeReady
                  ? 'unsupported'
                  : 'source-only',
            healthCodes: inspection.health.codes,
            dependencies: inspection.dependencies,
            references: inspection.references,
            selectionCount: next.size,
          });
        })
        .catch(() => {});
    },
    [filtered, selectedFiles, selectionAnchor],
  );

  // --- Double-click / Enter: §5.1 OPEN — the full viewer as a CENTER
  // workspace document (W2; was a right-rail asset tab pre-W2). ---
  const onDoubleClick = useCallback(
    (item: BrowserEntry) => {
      if (item.source === 'component') {
        if (item.authoringAsset) {
          openAuthoringAssetDocument(item.authoringAsset.id, item.authoringAsset.subject);
          return;
        }
        // Double-click OPENS — the same promise every other row in this panel
        // makes. What the component opens AS is the source's answer, not the
        // host's (a `three` prefab's turntable, an isolated story document,
        // whatever a later source brings).
        item.contentSource.open(store, item.contentEntry, item.name);
        return;
      }
      if (item.source === 'available') {
        openAvailableWorkspaceDocument(item.available.descriptor.id);
        return;
      }
      if (item.source === 'document') {
        if (item.document.kind === 'scene') {
          const result = openSceneTableEntry(item.document.id);
          if (!result.ok) editorConsole.error(result.error, 'scene');
          return;
        }
        // The document opens in the editor registered for its KIND (a model
        // in the mesh editor); only a kind nothing edits opens as its source.
        if (!openKindDocument(item.document)) {
          openAssetDocument(`/${item.path}`, uneditedKindAssetKind(item.document));
        }
        return;
      }
      openProjectAssetEntry(item, {
        currentRoot,
        currentPath: item.source === 'asset' ? parentAssetPath(item.path) : '',
        navigate,
        openAsset: (url, kind) => openAssetDocument(url, kind),
      });
    },
    [currentRoot, navigate, store],
  );

  // --- Refresh ---
  const onRefresh = useCallback(
    (changedPaths?: readonly string[]) => {
      setTreeRevision((revision) => revision + 1);
      cacheRef.current.clear();
      // Folder previews share the refresh triggers of the entry cache — never
      // per-render. Scope invalidation to the mutated subtrees when the change
      // event names them, drop everything otherwise (manual refresh).
      if (changedPaths?.length) {
        for (const changed of changedPaths) {
          invalidateFolderPreviews(changed);
        }
      } else {
        invalidateFolderPreviews();
      }
      setPreviewRevision((revision) => revision + 1);
      fetchEntries(currentRoot, currentPath);
      if (scope === 'content') void fetchContent();
    },
    [currentRoot, currentPath, fetchContent, fetchEntries, scope],
  );

  // Auto-refresh when assets change (e.g. file move detected by server).
  // Some emitters name the mutated paths in `detail.paths` (public-relative,
  // e.g. `foo/bar.png` — see `projectAssetPath` in asset-editor-persistence);
  // those scope the folder-preview invalidation. No prefix stripping: a
  // top-level folder literally named `public` must not be mis-scoped.
  useEffect(() => {
    const handler = (event: Event) =>
      onRefresh((event as CustomEvent<{ paths?: string[] }>).detail?.paths);
    window.addEventListener('editor:assets-changed', handler);
    return () => window.removeEventListener('editor:assets-changed', handler);
  }, [onRefresh]);

  useEffect(() => {
    const handler = (event: Event) => {
      const path = (event as CustomEvent<{ path?: string }>).detail?.path;
      if (!path) return;
      const capability = assetCapabilities(path);
      const kind = assetDocumentKind(capability);
      if (!kind) return;
      openAssetDocument(path, kind);
    };
    window.addEventListener('editor:open-project-asset', handler);
    return () => window.removeEventListener('editor:open-project-asset', handler);
  }, [store]);

  const selectedItems = useMemo(
    () => browserEntries.filter((item) => selectedFiles.has(item.key)),
    [browserEntries, selectedFiles],
  );
  /** Public-relative paths of the selected FILES — the subjects of every
   *  mutating operation, which is why reference rows are not among them. */
  const selectedAssetPaths = useMemo(
    () =>
      selectedItems.flatMap((item) =>
        item.source === 'asset' && item.entry.type === 'file' && item.root === 'public'
          ? [item.path]
          : [],
      ),
    [selectedItems],
  );
  /** Project-relative paths of every selected file, reference rows included:
   *  copy-path and reveal-in-finder are about where the file IS. */
  const selectedProjectPaths = useMemo(
    () =>
      selectedItems.flatMap((item) =>
        item.source === 'asset' && item.entry.type === 'file'
          ? [projectAssetPath(item.root, item.path)]
          : [],
      ),
    [selectedItems],
  );

  useEffect(() => {
    const available = new Set(browserEntries.map((item) => item.key));
    setSelectedFiles((current) => {
      const next = new Set([...current].filter((key) => available.has(key)));
      if (current.size > 0 && next.size === 0) {
        setSelectionAnchor(null);
        clearSelectedAsset();
      }
      return next.size === current.size ? current : next;
    });
  }, [browserEntries]);

  const finishOperation = useCallback(
    async (operation: Parameters<typeof executeProjectAssetOperation>[0]) => {
      await executeProjectAssetOperation(operation, {
        backend: getStorageBackend(),
        history,
      });
      cacheRef.current.clear();
      if (currentRoot === 'public') await fetchEntries(currentRoot, currentPath);
      if (scope === 'content') await fetchContent();
    },
    [currentPath, currentRoot, fetchContent, fetchEntries, history, scope],
  );

  const deleteSelected = useCallback(async () => {
    if (selectedAssetPaths.length === 0) return;
    if (
      !confirmAssetAction(
        'delete',
        `Delete ${selectedAssetPaths.length} selected asset(s)? This is undoable.`,
      )
    )
      return;
    await finishOperation({ type: 'delete', paths: selectedAssetPaths });
    setSelectedFiles(new Set());
    setSelectionAnchor(null);
    clearSelectedAsset();
  }, [finishOperation, selectedAssetPaths]);

  const moveSelected = useCallback(() => {
    if (selectedAssetPaths.length === 0) return;
    askFor({
      title: `Move ${selectedAssetPaths.length} selected to folder`,
      initial: currentPath,
      confirmLabel: 'Move',
      run: async (destinationFolder) => {
        const folder = destinationFolder.replace(/^\/+|\/+$/g, '');
        setOperationError(null);
        try {
          await finishOperation({
            type: 'move-many',
            moves: selectedAssetPaths.map((source) => ({
              source,
              destination: folder
                ? `${folder}/${source.split('/').pop()}`
                : source.split('/').pop()!,
            })),
          });
        } catch (error) {
          setOperationError(error instanceof Error ? error.message : String(error));
        }
      },
    });
  }, [askFor, currentPath, finishOperation, selectedAssetPaths]);

  const createFolder = useCallback(() => {
    if (currentRoot !== 'public') return;
    askFor({
      title: 'New folder name',
      initial: '',
      confirmLabel: 'Create',
      run: async (name) => {
        if (!name) return;
        await finishOperation({
          type: 'create-folder',
          path: currentPath ? `${currentPath}/${name}` : name,
        });
      },
    });
  }, [askFor, currentPath, currentRoot, finishOperation]);

  /**
   * IMPORT MUST END SOMEWHERE THE USER CAN SEE, or say why it did not.
   *
   * A tester picked images through this panel's own Import files action,
   * repeatedly, and nothing appeared anywhere — no file, no error, no hint
   * (runhuman pass 74: "it's not accepting any type of image... nothing
   * happens"). Two silences caused that: a throw from the operation went
   * nowhere, and a file imported while the CONTENT tab is showing lands in the
   * project's files, which that tab does not list — so a successful import was
   * invisible too. Now failures land in the panel's own error row, and success
   * switches to Files at the destination folder and names what arrived.
   */
  const importFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      // Import writes SHIPPED assets. From Content (no folder) or from a
      // non-public root (reference material, which nothing here writes), it
      // lands at the top of public/ rather than at a path in another root.
      const destinationFolder = scope === 'content' || currentRoot !== 'public' ? '' : currentPath;
      const imported = await Promise.all(
        [...files].map(async (file) => ({
          path: destinationFolder ? `${destinationFolder}/${file.name}` : file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      );
      setOperationError(null);
      try {
        await finishOperation({ type: 'import', files: imported });
      } catch (error) {
        setOperationError(
          `Could not import ${imported.length === 1 ? imported[0]?.path : `${imported.length} files`}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }
      if (scope === 'content') changeScope('files');
      navigate('public', destinationFolder);
      showTransientHint(
        imported.length === 1
          ? `Imported ${imported[0]?.path}`
          : `Imported ${imported.length} files`,
      );
    },
    [changeScope, currentPath, currentRoot, finishOperation, navigate, scope],
  );

  const renameItem = useCallback(
    (item: BrowserEntry) => {
      if (item.source !== 'asset' || item.entry.type !== 'file') return;
      if (item.root !== 'public') {
        showTransientHint(`${item.name} is reference material. ${REFERENCE_READ_ONLY_HINT}`);
        return;
      }
      askFor({
        title: `Rename ${item.name}`,
        initial: item.name,
        confirmLabel: 'Rename',
        run: async (nextName) => {
          if (!nextName || nextName === item.name) return;
          const source = item.path;
          const parent = parentAssetPath(item.path);
          const destination = parent ? `${parent}/${nextName}` : nextName;
          await finishOperation({ type: 'move', source, destination });
        },
      });
    },
    [askFor, finishOperation],
  );

  const duplicateItem = useCallback(
    async (item: BrowserEntry) => {
      if (item.source !== 'asset' || item.entry.type !== 'file') return;
      if (item.root !== 'public') {
        showTransientHint(`${item.name} is reference material. ${REFERENCE_READ_ONLY_HINT}`);
        return;
      }
      const dot = item.name.lastIndexOf('.');
      const copyName =
        dot > 0 ? `${item.name.slice(0, dot)} copy${item.name.slice(dot)}` : `${item.name} copy`;
      const source = item.path;
      const parent = parentAssetPath(item.path);
      const destination = parent ? `${parent}/${copyName}` : copyName;
      await finishOperation({ type: 'duplicate', source, destination });
    },
    [finishOperation],
  );

  const toggleExpanded = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      const item = selectedItems[0];
      if (id === PROJECT_ASSET_COMMANDS.refresh.id) onRefresh();
      else if (id === PROJECT_ASSET_COMMANDS.import.id) importInputRef.current?.click();
      else if (id === PROJECT_ASSET_COMMANDS.createFolder.id) void createFolder();
      else if (id === PROJECT_ASSET_COMMANDS.move.id) void moveSelected();
      else if (id === PROJECT_ASSET_COMMANDS.delete.id) void deleteSelected();
      else if (id === PROJECT_ASSET_COMMANDS.rename.id && item) void renameItem(item);
      else if (id === PROJECT_ASSET_COMMANDS.duplicate.id && item) void duplicateItem(item);
      else if (id === PROJECT_ASSET_COMMANDS.copyPath.id && selectedProjectPaths[0])
        void navigator.clipboard.writeText(selectedProjectPaths[0]);
      else if (id === PROJECT_ASSET_COMMANDS.reveal.id && selectedProjectPaths[0])
        void revealInFinder(selectedProjectPaths[0]);
    };
    window.addEventListener('editor:project-asset-command', handler);
    return () => window.removeEventListener('editor:project-asset-command', handler);
  }, [
    createFolder,
    currentPath,
    deleteSelected,
    duplicateItem,
    moveSelected,
    onRefresh,
    renameItem,
    selectedItems,
    selectedProjectPaths,
  ]);

  const previewItem =
    contextMenu?.item.source === 'available' && contextMenu.item.available.descriptor.preview
      ? contextMenu.item
      : null;

  return (
    <div
      ref={browserRef}
      className="vgai-asset-browser"
      data-tree-visible={scope === 'files' && treeVisible}
      onPointerDown={() => setActiveScope('asset-browser')}
      onKeyDown={(event) => {
        if (isEditableTarget(event.target)) return;
        if (event.key === 'Delete' || event.key === 'Backspace') {
          void deleteSelected();
          event.preventDefault();
        } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
          const item = selectedItems[0];
          if (item) void duplicateItem(item);
          event.preventDefault();
        } else if (event.key === 'F2') {
          const item = selectedItems[0];
          if (item) void renameItem(item);
          event.preventDefault();
        }
      }}
      // DROP FILES FROM THE DESKTOP. Import existed only behind a toolbar
      // button and a hidden <input type=file>; dragging an image in from the
      // OS — the first thing anyone tries — did nothing at all. The drop lands
      // in the same `importFiles` the button uses, so the write path, the
      // destination folder and the refusals are identical.
      onDragOver={(event) => {
        if (currentRoot !== 'public' || !event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        if (!fileDropActive) setFileDropActive(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setFileDropActive(false);
      }}
      onDrop={(event) => {
        if (currentRoot !== 'public' || !event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setFileDropActive(false);
        void importFiles(event.dataTransfer.files);
      }}
      style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        position: 'relative',
        ...(fileDropActive
          ? { outline: `2px dashed ${themeVars.accent.default}`, outlineOffset: -2 }
          : {}),
      }}
    >
      <ProjectAssetTree
        currentRoot={currentRoot}
        currentPath={currentPath}
        expanded={expanded}
        hidden={scope !== 'files' || !treeVisible}
        revision={treeRevision}
        loadAssets={services.listAssets}
        onExpanded={toggleExpanded}
        onNavigate={navigate}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <TextInput
          ref={importInputRef}
          type="file"
          multiple
          aria-label="Import project assets"
          hidden
          onChange={(event) => {
            void importFiles(event.target.files);
            event.currentTarget.value = '';
          }}
        />
        <AssetBrowserToolbar
          availableFacets={availableFacets}
          scope={scope}
          facets={facets}
          currentPath={currentPath}
          currentRoot={currentRoot}
          searchOpen={searchOpen}
          searchQuery={searchQuery}
          viewMode={viewMode}
          density={density}
          treeVisible={treeVisible}
          onScopeChange={changeScope}
          onFacetToggle={selectFacet}
          onFacetsClear={() => setFacets([])}
          onNavigate={navigate}
          onSearchOpenChange={changeSearchOpen}
          onSearchQueryChange={setSearchQuery}
          onViewModeChange={setViewMode}
          onDensityChange={setDensity}
          onTreeVisibilityToggle={toggleTreeVisibility}
          onCreateFolder={() => void createFolder()}
          onImport={() => importInputRef.current?.click()}
          onDelete={() => void deleteSelected()}
          deleteDisabled={selectedAssetPaths.length === 0}
          onRefresh={onRefresh}
          generationTools={generationTools}
          onGenerate={() => {
            // The `generation` VIEW ADDRESS (`EditorView['document']`), served
            // by whichever package registered an opener for it; nothing
            // registered means nothing opens, and the button is only offered
            // when a generation tool contribution exists to feed it.
            openRegisteredDocument('generation', store, { kind: 'generation', id: 'create' });
          }}
        />

        {operationError && (
          <div role="alert" className="vgai-asset-operation-error">
            {operationError}
          </div>
        )}
        {prompt && (
          <form
            className="vgai-asset-inline-prompt"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px' }}
            onSubmit={(event) => {
              event.preventDefault();
              const question = prompt;
              setPrompt(null);
              void question.run(promptDraft.trim());
            }}
          >
            <span style={{ fontSize: 12 }}>{prompt.title}</span>
            <TextInput
              autoFocus
              aria-label={prompt.title}
              value={promptDraft}
              onChange={(event) => setPromptDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setPrompt(null);
              }}
            />
            <Button type="submit" size="compact">
              {prompt.confirmLabel}
            </Button>
            <Button type="button" variant="ghost" size="compact" onClick={() => setPrompt(null)}>
              Cancel
            </Button>
          </form>
        )}
        {selectedAssetPaths.length > 0 && (
          <EditorToolbar label="Selected asset actions" compact>
            <span>{selectedAssetPaths.length} selected</span>
            <Button variant="ghost" size="compact" onClick={() => void moveSelected()}>
              Move selected
            </Button>
            <Button
              variant="ghost"
              size="compact"
              aria-label="Delete selected assets"
              onClick={() => void deleteSelected()}
            >
              Delete
            </Button>
          </EditorToolbar>
        )}

        {/* One file-browser surface; grid/list are presentation modes, not navigation. */}
        <div
          className="vgai-project-assets-results"
          data-view={viewMode}
          data-testid="project-asset-results"
          role="listbox"
          aria-label={scope === 'content' ? 'Project content' : 'Project files'}
          aria-multiselectable="true"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 8,
            display: viewMode === 'list' ? 'flex' : 'grid',
            gridTemplateColumns:
              viewMode === 'grid'
                ? `repeat(auto-fill, minmax(${Math.round(density * 0.75)}px, 1fr))`
                : undefined,
            gridAutoRows: viewMode === 'list' ? undefined : 'min-content',
            flexDirection: viewMode === 'list' ? 'column' : undefined,
            gap: viewMode === 'list' ? 1 : 6,
            alignContent: 'start',
          }}
        >
          {resultSections.map((section) => (
            <div
              key={section.id}
              role="group"
              aria-label={section.label ?? undefined}
              className="vgai-content-result-section"
            >
              {section.label && (
                <div
                  role="presentation"
                  className="vgai-content-section-heading"
                  data-level={section.headingLevel ?? undefined}
                  data-testid={`content-section-${section.id}`}
                >
                  <span>{section.label}</span>
                </div>
              )}
              {section.entries.map((item) => (
                <BrowserEntryCard
                  key={item.key}
                  item={item}
                  selected={selectedFiles.has(item.key)}
                  onDragStart={onDragStart}
                  onSelect={onSelectEntry}
                  onOpen={onDoubleClick}
                  onContextMenu={(event, selectedItem) => {
                    event.preventDefault();
                    if (selectedItem.source === 'component') return;
                    if (!selectedFiles.has(selectedItem.key)) {
                      onSelectEntry(selectedItem, event);
                    }
                    setContextMenu({ x: event.clientX, y: event.clientY, item: selectedItem });
                  }}
                  viewMode={viewMode}
                  previewRevision={previewRevision}
                  showPath={scope === 'content'}
                />
              ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <StateSurface
              compact
              style={{ gridColumn: '1 / -1' }}
              icon={
                <EditorIcon
                  icon={
                    listingFailure
                      ? editorIcons.status.warning
                      : searchQuery
                        ? editorIcons.action.search
                        : editorIcons.content.folder
                  }
                />
              }
              // A listing that FAILED is NOT an empty folder, and this is the
              // surface where the difference matters most: "Empty folder" over
              // a backend error reads as the author's files being gone.
              title={
                contentLoading
                  ? 'Finding project content…'
                  : listingFailure
                    ? 'Listing failed'
                    : searchQuery
                      ? 'No matching content'
                      : scope === 'content'
                        ? 'No content in this type'
                        : 'Empty folder'
              }
              description={
                contentLoading
                  ? 'Scanning components and assets across the project.'
                  : listingFailure
                    ? `Listing failed: ${listingFailure}`
                    : searchQuery
                      ? 'Try a broader search or another content type.'
                      : scope === 'content'
                        ? 'Choose another type or import an asset.'
                        : 'Add files to this folder to see them here.'
              }
            />
          )}
        </div>
      </div>
      {previewItem && contextMenu && (
        <ThemeRootPortal>
          <Menu
            autoFocusFirst
            className="vgai-asset-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onDismiss={() => setContextMenu(null)}
          >
            <MenuItem
              type="button"
              role="menuitem"
              onClick={() => {
                onDoubleClick(previewItem);
                setContextMenu(null);
              }}
            >
              Open <kbd>Enter</kbd>
            </MenuItem>
            {previewItem.available.category === 'scene' && (
              <>
                <MenuItem
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const id = previewItem.available.descriptor.id;
                    setContextMenu(null);
                    void saveDocumentPreviewFraming(id, false)
                      .then(() => setPreviewRevision((value) => value + 1))
                      .catch((cause: unknown) =>
                        setOperationError(cause instanceof Error ? cause.message : String(cause)),
                      );
                  }}
                >
                  Use current view for preview
                </MenuItem>
                <MenuItem
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const id = previewItem.available.descriptor.id;
                    setContextMenu(null);
                    void saveDocumentPreviewFraming(id, true)
                      .then(() => setPreviewRevision((value) => value + 1))
                      .catch((cause: unknown) =>
                        setOperationError(cause instanceof Error ? cause.message : String(cause)),
                      );
                  }}
                >
                  Reset preview view
                </MenuItem>
              </>
            )}
            <MenuItem
              type="button"
              role="menuitem"
              onClick={() => {
                setContextMenu(null);
                setPreviewRevision((value) => value + 1);
              }}
            >
              Refresh preview
            </MenuItem>
          </Menu>
        </ThemeRootPortal>
      )}
      {contextMenu && contextMenu.item.source === 'asset' && (
        // Portaled to the theme root (W6): the menu's `position: fixed`
        // would resolve against a backdrop-filtered floating card and be
        // clipped by its overflow — see `ThemeRootPortal`'s rationale.
        <ThemeRootPortal>
          <Menu
            autoFocusFirst
            className="vgai-asset-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onDismiss={() => setContextMenu(null)}
          >
            <MenuItem
              type="button"
              role="menuitem"
              data-command-id={PROJECT_ASSET_COMMANDS.open.id}
              onClick={() => {
                onDoubleClick(contextMenu.item);
                setContextMenu(null);
              }}
            >
              Open <kbd>Enter</kbd>
            </MenuItem>
            <MenuItem
              type="button"
              role="menuitem"
              data-command-id={PROJECT_ASSET_COMMANDS.rename.id}
              onClick={() => {
                void renameItem(contextMenu.item);
                setContextMenu(null);
              }}
            >
              Rename <kbd>F2</kbd>
            </MenuItem>
            <MenuItem
              type="button"
              role="menuitem"
              data-command-id={PROJECT_ASSET_COMMANDS.duplicate.id}
              onClick={() => {
                void duplicateItem(contextMenu.item);
                setContextMenu(null);
              }}
            >
              Duplicate <kbd>⌘D</kbd>
            </MenuItem>
            <MenuItem
              type="button"
              role="menuitem"
              data-command-id={PROJECT_ASSET_COMMANDS.move.id}
              disabled={selectedAssetPaths.length === 0}
              title={selectedAssetPaths.length ? 'Move selected assets' : 'Select a file to move'}
              onClick={() => {
                void moveSelected();
                setContextMenu(null);
              }}
            >
              Move selected…
            </MenuItem>
            <MenuItem
              type="button"
              role="menuitem"
              data-command-id={PROJECT_ASSET_COMMANDS.copyPath.id}
              disabled={!selectedProjectPaths[0]}
              onClick={() => {
                if (selectedProjectPaths[0]) {
                  void navigator.clipboard.writeText(selectedProjectPaths[0]);
                }
                setContextMenu(null);
              }}
            >
              Copy path
            </MenuItem>
            {/* A package's own items on this asset (`@volter/editor-sdk/chrome`,
                menu `asset`): invoked with the asset's project path. `Open in
                Asset Budget` is one of them (`@vgai/game`'s
                `asset-budget-asset.menu.ts`) — it was a built-in row here
                until the budget became that package's document. */}
            {contributedMenuItems('asset').map((item) => {
              const file =
                contextMenu.item.source === 'asset' && contextMenu.item.entry.type === 'file';
              const subject =
                contextMenu.item.source === 'asset'
                  ? { assetPath: projectAssetPath(contextMenu.item.root, contextMenu.item.path) }
                  : {};
              return (
                <MenuItem
                  key={item.id}
                  type="button"
                  role="menuitem"
                  data-testid={item.testId}
                  disabled={!file || (item.disabled?.(subject) ?? false)}
                  onClick={() => {
                    void item.execute(subject);
                    setContextMenu(null);
                  }}
                >
                  {typeof item.label === 'function' ? item.label() : item.label}
                </MenuItem>
              );
            })}
            <MenuItem
              type="button"
              role="menuitem"
              data-command-id={PROJECT_ASSET_COMMANDS.reveal.id}
              disabled={!selectedProjectPaths[0]}
              onClick={() => {
                if (selectedProjectPaths[0]) void revealInFinder(selectedProjectPaths[0]);
                setContextMenu(null);
              }}
            >
              Reveal in Finder
            </MenuItem>
            <MenuItem
              type="button"
              role="menuitem"
              data-command-id={PROJECT_ASSET_COMMANDS.delete.id}
              disabled={selectedAssetPaths.length === 0}
              onClick={() => {
                void deleteSelected();
                setContextMenu(null);
              }}
            >
              Delete <kbd>⌫</kbd>
            </MenuItem>
          </Menu>
        </ThemeRootPortal>
      )}
    </div>
  );
}
