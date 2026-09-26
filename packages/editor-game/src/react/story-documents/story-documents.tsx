import { Checkbox, TextInput, themeVars } from '@volter/editor-sdk/widgets';

/**
 * Story DOCUMENTS (W2 — inventory row B9): a selected CSF story opens as a
 * CENTER workspace document (kind `'story'`, title = the story's export name
 * as authored, §8), mounted through the SAME Storybook portable-story
 * pipeline the Stories dock used (`stories/StoryPreviewMount.tsx`'s isolated
 * `react-dom/client` root — never a child of the editor's own tree), with:
 *
 *   - **args → Inspector** (§5 "Storybook args | right Inspector"): a
 *     story-scoped section registered through the EXISTING
 *     inspector-section registry, live-editable for primitive args (string/
 *     number/boolean — the Storybook-controls semantic); edits re-render the
 *     SAME composed story with override props (portable stories accept
 *     partial props over their composed args — Storybook's own API, not a
 *     re-implementation);
 *   - **addon results → utilities** (§5 "Actions/interactions … story-scoped
 *     utility tabs"): `Actions` (function-valued args are wrapped with
 *     logging spies at mount — the actions-addon behavior — and every call
 *     from the story's own rendered component is logged) and `Interactions`
 *     (the story's `play()` run results) are registered in the W0
 *     workspace-utility registry, available only while a story document is
 *     active. The host draws available registrations as utility tabs in the
 *     region below the viewport.
 *
 * §4.2 Play interplay: a story document renders in its OWN isolated preview
 * root — never the live React world root. During Play the live connector
 * owns the React root (design-time layers are suspended, `design-time-
 * layers.ts`); opening/activating a story document must NOT stop Play and
 * does not pretend the story is mounted on the root — it only drops the T6.3
 * input gate (`onActivate` writes the store's `'scene'` tab) exactly like
 * activating any non-Game document. What Stop restores on the root stays
 * owned by `design-time-layers.ts`'s remembered per-root story selection.
 *
 * Per-document runtime state (arg overrides, action log, play results, the
 * live preview container) lives in a module-scope map in the house
 * `useSyncExternalStore` shape; dropped on document dispose.
 */

// `@editor/active-project` and not `@editor/project-manager`: the same
// function, re-exported, without dragging the whole project-open/storage
// estate into this package's program.
import { getCurrentProject } from '@volter/editor-sdk/kit/active-project';
import { type Resolution, ResolutionPicker } from '../../host/components/ResolutionPicker';
import { SurfaceStateOverlay } from '@volter/editor-sdk/kit/components/SurfaceStateOverlay';
import { registerDocumentOpener } from '@volter/editor-sdk/kit/document-open-registry';
import { createHmrRegistrationGroup } from '@volter/editor-sdk/kit/hmr-registration-group';
import {
  CONTRIBUTED_SECTION_ORDER,
  STORY_ARGS_SECTION_ID,
  STORY_ARGS_SECTION_TITLE,
} from '@volter/editor-sdk/kit/inspection-model';
import { registerInspectorSections } from '@volter/editor-sdk/kit/inspector-section-registry';
import type { ComposedProjectStory } from '@volter/editor-sdk/kit/stories/compose-project-stories';
import { getProjectStoryRegions } from '@volter/editor-sdk/kit/stories/project-story-regions';
import { mountIsolatedStory, runStoryPlay } from '@volter/editor-sdk/kit/stories/StoryPreviewMount';
import { declaredStoryMedium } from '@volter/editor-sdk/kit/stories/story-declared-medium';
import {
  ISOLATED_STORY_DOCUMENT_OPENER,
  STORY_DOCS_DOCUMENT_OPENER,
  type StoryDocumentOpenRequest,
} from '@volter/editor-sdk/kit/story-document-openers';
import {
  getProjectStoryModules,
  refreshProjectStories,
  subscribeProjectStoryModules,
  whenProjectStoriesReady,
} from '@volter/editor-sdk/kit/stories/story-registry';
import { domHasRenderableContent } from '../../host/surface-content';
import { explainSurface, type SurfaceContentState } from '@volter/editor-sdk/kit/surface-state';
import { CONTRIBUTED_WORKSPACE_UTILITIES } from '@volter/editor-sdk/kit/workspace-core-utilities';
import {
  activeWorkspaceDocument,
  openWorkspaceDocument,
  type WorkspaceDocumentContentProps,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { registerWorkspaceDocumentRestorer } from '@volter/editor-sdk/kit/workspace-document-restore';
import { registerWorkspaceUtility } from '@volter/editor-sdk/kit/workspace-utility-registry';
import { fitPresentation } from '@volter/game-runtime/runtime/presentation';
import { Button, fontMono, fontSizeVar, spaceVar } from '@volter/editor-sdk/widgets';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { STORY_ARGS_SECTION_ICON } from './story-args-section';

/** One logged action-arg invocation (the actions-addon semantic). */
export interface StoryActionEntry {
  readonly name: string;
  readonly args: readonly unknown[];
  readonly time: number;
}

export interface StoryAccessibilityViolation {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly helpUrl: string;
  readonly nodes: readonly { readonly html: string; readonly target: readonly string[] }[];
}

export interface StoryDocumentState {
  readonly modulePath: string;
  readonly storyName: string;
  readonly mode: 'preview' | 'docs';
  readonly store: StoryDocumentStore;
  argOverrides: Record<string, unknown>;
  actionLog: StoryActionEntry[];
  playResult: { ran: boolean; error?: string } | null;
  accessibility:
    | { status: 'idle' | 'running'; violations: StoryAccessibilityViolation[]; error?: undefined }
    | { status: 'complete'; violations: StoryAccessibilityViolation[]; error?: undefined }
    | { status: 'error'; violations: StoryAccessibilityViolation[]; error: string };
  /** The live isolated preview container (set by the content on mount) —
   *  what `play()` receives as its `canvasElement` scope. */
  container: HTMLElement | null;
  /** True only after the current composed story + loaders have mounted. */
  previewReady: boolean;
  /** Invalidates async play/accessibility results across remounts. */
  previewRevision: number;
  resolution: Resolution;
  scale: number;
}

const _states = new Map<string, StoryDocumentState>();
let _version = 0;
const _listeners = new Set<() => void>();

function notifyChanged(): void {
  _version++;
  for (const fn of _listeners) fn();
}

/** Subscribe to story-document state changes. Returns unsubscribe. */
export function subscribeStoryDocuments(fn: () => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

/** Monotonic change counter — the `getSnapshot` for `useSyncExternalStore`. */
export function storyDocumentsVersion(): number {
  return _version;
}

/** Stable §7.1 identity for one story document. */
export function storyDocumentId(modulePath: string, storyName: string): string {
  return `story:${modulePath}#${storyName}`;
}

/** Stable identity for the Storybook Docs companion document. */
export function storyDocsDocumentId(modulePath: string, storyName: string): string {
  return `story-docs:${modulePath}#${storyName}`;
}

/** The state behind an open story document id, or `undefined`. */
export function storyDocumentState(id: string): StoryDocumentState | undefined {
  return _states.get(id);
}

/** The ACTIVE center document's story state, or `null` when the active
 *  document isn't a story (utilities/inspector section gate on this). */
export function activeStoryDocumentState(): (StoryDocumentState & { id: string }) | null {
  const active = activeWorkspaceDocument();
  if (!active || active.descriptor.kind !== 'story') return null;
  const state = _states.get(active.descriptor.id);
  return state?.mode === 'preview' ? { ...state, id: active.descriptor.id } : null;
}

/** Set one arg override (Inspector Story Args section) — remounts the story
 *  against the merged args. `value === undefined` CLEARS the override (the
 *  `delete`-the-key convention used elsewhere, e.g. `MaterialSection.tsx`'s
 *  `setField`) rather than storing `undefined`/`NaN` — the composed-args
 *  spread merge (`composedStoryArgs`/`activeStoryDocumentState` callers) only
 *  falls back to the authored value when the key is ABSENT, so a stored
 *  `NaN` (e.g. from an emptied number input) would otherwise win over the
 *  authored value and also make the input go from controlled to `NaN`. */
export function setStoryArgOverride(id: string, key: string, value: unknown): void {
  const state = _states.get(id);
  if (!state) return;
  if (value === undefined) {
    const next = { ...state.argOverrides };
    delete next[key];
    state.argOverrides = next;
  } else {
    state.argOverrides = { ...state.argOverrides, [key]: value };
  }
  notifyChanged();
}

function logStoryAction(id: string, name: string, args: readonly unknown[]): void {
  const state = _states.get(id);
  if (!state) return;
  state.actionLog = [...state.actionLog, { name, args, time: Date.now() }].slice(-200);
  notifyChanged();
}

/** Clear the action log (Actions utility affordance). */
export function clearStoryActionLog(id: string): void {
  const state = _states.get(id);
  if (!state || state.actionLog.length === 0) return;
  state.actionLog = [];
  notifyChanged();
}

/** The narrow store surface story documents need (T6.3 gate hand-off —
 *  same contract as `asset-documents.tsx`). */
export interface StoryDocumentStore {
}

/**
 * Open (or activate) the center document for one named story. §4.2: this
 * never touches the play session — during Play it only opens a tab; the
 * live connector keeps owning the React root.
 */
export function openStoryDocument(
  store: StoryDocumentStore,
  modulePath: string,
  storyName: string,
  options: { activate?: boolean; title?: string } = {},
): string {
  ensureStoryContributionsRegistered();
  const id = storyDocumentId(modulePath, storyName);
  if (!_states.has(id)) {
    _states.set(id, {
      modulePath,
      storyName,
      mode: 'preview',
      store,
      argOverrides: {},
      actionLog: [],
      playResult: null,
      accessibility: { status: 'idle', violations: [] },
      container: null,
      previewReady: false,
      previewRevision: 0,
      resolution: { label: 'Fill', width: null, height: null },
      scale: 1,
    });
    notifyChanged();
  }
  const openOptions = options.activate === undefined ? {} : { activate: options.activate };
  return openWorkspaceDocument(
    {
      id,
      // §8 — the story's export name exactly as authored in the CSF module
      // (`Default`, `Playing`), never a humanized/uppercased variant.
      title: options.title ?? storyName,
      kind: 'story',
      workspaceRole: 'authored-subject',
      provenance: { sourcePath: modulePath },
      Content: StoryDocumentContent,
      Toolbar: StoryDocumentToolbar,
      closeable: true,
      presentation: () => ({ kind: 'story', modulePath, storyName, mode: 'preview' }),
      persist: () => ({ modulePath, storyName }),
      onDispose: (documentId) => {
        if (_states.delete(documentId)) notifyChanged();
      },
    },
    openOptions,
  );
}

/** Open the composed story's Storybook Docs companion as a center document. */
export function openStoryDocsDocument(
  store: StoryDocumentStore,
  modulePath: string,
  storyName: string,
): string {
  const id = storyDocsDocumentId(modulePath, storyName);
  if (!_states.has(id)) {
    _states.set(id, {
      modulePath,
      storyName,
      mode: 'docs',
      store,
      argOverrides: {},
      actionLog: [],
      playResult: null,
      accessibility: { status: 'idle', violations: [] },
      container: null,
      previewReady: false,
      previewRevision: 0,
      resolution: { label: 'Fill', width: null, height: null },
      scale: 1,
    });
    notifyChanged();
  }
  return openWorkspaceDocument({
    id,
    title: `${storyName} — Docs`,
    kind: 'story',
    workspaceRole: 'workspace-reference',
    provenance: { sourcePath: modulePath },
    Content: StoryDocsDocumentContent,
    closeable: true,
    presentation: () => ({ kind: 'story', modulePath, storyName, mode: 'docs' }),
    persist: () => ({ modulePath, storyName, view: 'docs' }),
    onDispose: (documentId) => {
      if (_states.delete(documentId)) notifyChanged();
    },
  });
}

/**
 * THE STORY REGISTRY MUST BE SETTLED BEFORE ANY STORY DOCUMENT RESTORES —
 * both this kind and the three-medium one (`three-story-documents.tsx`) read
 * it synchronously to verify. Shared as ONE function so the restore host,
 * which dedupes prepares by identity, refreshes once rather than twice (a
 * second concurrent refresh bumps the registry's generation and aborts the
 * first).
 */
export function prepareStoryDocumentRestore(): Promise<void> {
  const project = getCurrentProject();
  if (!project) return Promise.resolve();
  // Awaiting OUR refresh is not enough: a concurrent later pass (the
  // discovery lifecycle's own, a project change) aborts this one, which then
  // returns early over an EMPTY registry — and an empty registry reads as "the
  // story is gone", so the restore drops the tab. Settle on the registry's own
  // readiness instead; see `whenProjectStoriesReady`.
  return refreshProjectStories(project).then(whenProjectStoriesReady, whenProjectStoriesReady);
}

/** Reopen a persisted story document. VERIFIED against the settled registry:
 *  the module must still load AND still export that story name. A preview
 *  additionally checks the story's DECLARED medium — a saved renderer is
 *  convenience state, not the story's current declaration, so a preview whose
 *  medium has moved to `three` is dropped here rather than mounted on the
 *  wrong one (`three-story-documents.tsx` restores that one). */
registerWorkspaceDocumentRestorer({
  kind: 'story',
  owner: 'story-documents',
  prepare: prepareStoryDocumentRestore,
  restore: ({ state, store }) => {
    const record = state as
      | { modulePath?: unknown; storyName?: unknown; view?: unknown }
      | null
      | undefined;
    const modulePath = typeof record?.modulePath === 'string' ? record.modulePath : null;
    const storyName = typeof record?.storyName === 'string' ? record.storyName : null;
    if (!modulePath || !storyName) return false;
    const module_ = getProjectStoryModules().find((m) => m.modulePath === modulePath);
    if (!module_?.ok) return false;
    if (!module_.stories.some((story) => story.name === storyName)) return false;
    if (record?.view === 'docs') {
      openStoryDocsDocument(store, modulePath, storyName);
      return true;
    }
    const { medium } = declaredStoryMedium({ modulePath, regions: getProjectStoryRegions() });
    if (medium !== 'dom' && medium !== 'canvas') return false;
    openStoryDocument(store, modulePath, storyName);
    return true;
  },
});

/**
 * The two addresses this module answers (`document-open-registry.ts`): the
 * isolated preview and the Docs companion. Which address a gesture uses is
 * the CALLER's decision — the declared medium for a routed open, the owning
 * component's surface for the Content grid — exactly as it was when these
 * were imported functions.
 */
registerDocumentOpener<StoryDocumentOpenRequest>({
  id: ISOLATED_STORY_DOCUMENT_OPENER,
  owner: 'story-documents',
  open: (store, request) =>
    openStoryDocument(store, request.modulePath, request.storyName, {
      ...(request.title === undefined ? {} : { title: request.title }),
      ...(request.activate === undefined ? {} : { activate: request.activate }),
    }),
});
registerDocumentOpener<StoryDocumentOpenRequest>({
  id: STORY_DOCS_DOCUMENT_OPENER,
  owner: 'story-documents',
  open: (store, request) => openStoryDocsDocument(store, request.modulePath, request.storyName),
});

/** Test-only reset — drops all story-document state (pair with the document
 *  registry's own reset). */
export function __resetStoryDocumentsForTest(): void {
  _states.clear();
  notifyChanged();
}

// --- Story resolution against the live registry ---------------------------

function findComposedStory(
  modulePath: string,
  storyName: string,
): { story: ComposedProjectStory | undefined; moduleError: string | undefined } {
  const module_ = getProjectStoryModules().find((m) => m.modulePath === modulePath);
  if (!module_) return { story: undefined, moduleError: undefined };
  if (!module_.ok) return { story: undefined, moduleError: module_.error };
  return { story: module_.stories.find((s) => s.name === storyName), moduleError: undefined };
}

/** A composed story's own args (Storybook attaches them to the portable
 *  component). Defensive read — `{}` when absent. */
export function composedStoryArgs(story: ComposedProjectStory): Record<string, unknown> {
  const args = (story.Component as unknown as Record<string, unknown>)['args'];
  return args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
}

/** Merge order: composed args ← wrapped action spies ← user overrides. The
 *  spies re-wrap the ORIGINAL function so authored handlers still run. */
function buildOverrideProps(id: string, story: ComposedProjectStory): Record<string, unknown> {
  const state = _states.get(id);
  const overrides: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(composedStoryArgs(story))) {
    if (typeof value === 'function') {
      overrides[key] = (...callArgs: unknown[]) => {
        logStoryAction(id, key, callArgs);
        return (value as (...a: unknown[]) => unknown)(...callArgs);
      };
    }
  }
  return { ...overrides, ...(state?.argOverrides ?? {}) };
}

// --- Document content + toolbar -------------------------------------------

function StoryDocumentContent({ documentId }: WorkspaceDocumentContentProps) {
  useSyncExternalStore(subscribeStoryDocuments, storyDocumentsVersion);
  // Re-resolve the composed story on every registry refresh (project change,
  // `story-files-changed` SSE) — same live-rescan physics as the Stories dock.
  useSyncExternalStore(subscribeProjectStoryModules, () => getProjectStoryModules());
  const state = _states.get(documentId);
  const outerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewContent, setPreviewContent] = useState<SurfaceContentState>('unknown');
  const [previewFailure, setPreviewFailure] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const { story, moduleError } = state
    ? findComposedStory(state.modulePath, state.storyName)
    : { story: undefined, moduleError: undefined };
  // Arg-override identity for the remount effect below.
  const overridesKey = state ? JSON.stringify(state.argOverrides) : '';

  useEffect(() => {
    const element = outerRef.current;
    if (!element) return;
    if (typeof ResizeObserver === 'undefined') {
      setContainerSize({ width: element.clientWidth, height: element.clientHeight });
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setContainerSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !state) return;
    if (state.container !== container) {
      state.container = container; // play()'s canvasElement scope
      notifyChanged();
    }
    const previewRevision = state.previewRevision + 1;
    state.previewRevision = previewRevision;
    state.previewReady = false;
    state.playResult = null;
    state.accessibility = { status: 'idle', violations: [] };
    notifyChanged();
    setPreviewContent('unknown');
    setPreviewFailure(null);
    if (!story) {
      setLoading(false);
      setPreviewContent('empty');
      return;
    }
    let cancelled = false;
    let unmountFn: (() => void) | undefined;
    let settleTask: ReturnType<typeof setTimeout> | undefined;
    const updatePreviewContent = (): void => {
      if (cancelled) return;
      setPreviewContent(domHasRenderableContent(container) ? 'present' : 'empty');
    };
    const observer = new MutationObserver(updatePreviewContent);
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    setLoading(true);
    void mountIsolatedStory(
      container,
      state.modulePath,
      state.storyName,
      story.Component,
      buildOverrideProps(documentId, story),
    ).then(
      (result) => {
        if (cancelled) {
          result?.unmount();
          return;
        }
        if (!result) {
          if (_states.get(documentId)?.previewRevision === previewRevision) {
            setLoading(false);
            setPreviewContent('empty');
          }
          return;
        }
        const current = _states.get(documentId);
        if (!current || current.previewRevision !== previewRevision) {
          result.unmount();
          return;
        }
        unmountFn = result.unmount;
        current.previewReady = true;
        setLoading(false);
        // `root.render()` may commit after mountIsolatedStory resolves. Cross one event-loop task;
        // unlike rAF this also runs in a hidden editor tab, where live control and capture remain
        // supported. The observer above keeps the answer live for later Suspense/async commits.
        settleTask = setTimeout(updatePreviewContent, 0);
        notifyChanged();
      },
      (reason: unknown) => {
        if (cancelled || _states.get(documentId)?.previewRevision !== previewRevision) return;
        setLoading(false);
        setPreviewFailure(reason instanceof Error ? reason.message : String(reason));
        setPreviewContent('empty');
      },
    );
    return () => {
      cancelled = true;
      observer.disconnect();
      if (settleTask !== undefined) clearTimeout(settleTask);
      unmountFn?.();
    };
    // `story.Component` identity changes on registry refresh; overridesKey on
    // arg edits — both remount, which is exactly the wanted behavior.
  }, [documentId, state, story, overridesKey]);

  const isFill = state?.resolution.width === null;
  // Device-preview semantics: never upscale (`fitPresentation`'s default). This artboard is one of
  // the two callers that module deduplicated — do not reintroduce inline fit math here.
  const scale =
    !state || isFill
      ? 1
      : fitPresentation(containerSize, {
          width: state.resolution.width!,
          height: state.resolution.height!,
        }).scale;
  useEffect(() => {
    if (!state || !Number.isFinite(scale) || scale <= 0 || state.scale === scale) return;
    state.scale = scale;
    notifyChanged();
  }, [scale, state]);

  if (!state) {
    return (
      <div
        style={{
          padding: spaceVar[6],
          fontSize: fontSizeVar.md,
          color: themeVars.content.muted,
          pointerEvents: 'auto',
        }}
      >
        This story document is no longer available.
      </div>
    );
  }

  const storyRootId = `${state.modulePath}#${state.storyName}`;
  const storyExplanation = !story
    ? {
        tone: 'error' as const,
        title: `Story ${storyRootId} is unavailable`,
        description:
          moduleError ??
          `No story export named “${state.storyName}” exists in ${state.modulePath}; it may have been renamed or removed.`,
      }
    : previewFailure
      ? {
          tone: 'error' as const,
          title: `Story ${storyRootId} failed`,
          description: previewFailure,
        }
      : explainSurface({
          surface: 'Story',
          rootIds: [storyRootId],
          phase: loading ? 'loading' : 'ready',
          content: previewContent,
        });

  return (
    <div
      style={{
        // §2.31: no root fill — the dock document surface shows through.
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'auto',
      }}
    >
      <div
        ref={outerRef}
        style={{
          // §2.31: the letterbox around the device canvas is transparent —
          // the story ARTBOARD below keeps its inset stage fill (a preview
          // canvas backing, exempt like the viewport's).
          position: 'relative',
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={
            isFill
              ? { position: 'absolute', inset: 0 }
              : {
                  position: 'relative',
                  width: state.resolution.width! * scale,
                  height: state.resolution.height! * scale,
                  flex: '0 0 auto',
                }
          }
        >
          <div
            data-testid="story-preview-root"
            ref={containerRef}
            // A story owns the whole selected device canvas. Containment
            // keeps fixed/full-page UI inside that canvas, never over editor
            // chrome.
            style={{
              position: 'absolute',
              inset: 0,
              isolation: 'isolate',
              contain: 'layout paint',
              overflow: 'auto',
              background: themeVars.surface.inset,
              ...(isFill
                ? {}
                : {
                    width: state.resolution.width!,
                    height: state.resolution.height!,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                  }),
            }}
          />
          <SurfaceStateOverlay explanation={storyExplanation} testId="story-surface-status" />
        </div>
      </div>
    </div>
  );
}

function docsDescription(story: ComposedProjectStory): { component?: string; story?: string } {
  const docs = story.parameters['docs'];
  if (!docs || typeof docs !== 'object') return {};
  const description = (docs as Record<string, unknown>)['description'];
  if (typeof description === 'string') return { story: description };
  if (!description || typeof description !== 'object') return {};
  const record = description as Record<string, unknown>;
  return {
    ...(typeof record['component'] === 'string' ? { component: record['component'] } : {}),
    ...(typeof record['story'] === 'string' ? { story: record['story'] } : {}),
  };
}

/** Storybook Docs companion: composed CSF metadata, canvas, and args table. */
export function StoryDocsDocumentContent({ documentId }: WorkspaceDocumentContentProps) {
  useSyncExternalStore(subscribeStoryDocuments, storyDocumentsVersion);
  useSyncExternalStore(subscribeProjectStoryModules, () => getProjectStoryModules());
  const state = _states.get(documentId);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [previewContent, setPreviewContent] = useState<SurfaceContentState>('unknown');
  const [previewFailure, setPreviewFailure] = useState<string | null>(null);
  const { story, moduleError } = state
    ? findComposedStory(state.modulePath, state.storyName)
    : { story: undefined, moduleError: undefined };
  useEffect(() => {
    const container = previewRef.current;
    if (!container || !state || !story) return;
    let disposed = false;
    let unmount: (() => void) | null = null;
    let settleTask: ReturnType<typeof setTimeout> | undefined;
    setPreviewContent('unknown');
    setPreviewFailure(null);
    const updatePreviewContent = (): void => {
      if (!disposed) setPreviewContent(domHasRenderableContent(container) ? 'present' : 'empty');
    };
    const observer = new MutationObserver(updatePreviewContent);
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    void mountIsolatedStory(container, state.modulePath, state.storyName, story.Component).then(
      (result) => {
        if (!result) {
          if (!disposed) setPreviewContent('empty');
          return;
        }
        if (disposed) result.unmount();
        else {
          unmount = result.unmount;
          settleTask = setTimeout(updatePreviewContent, 0);
        }
      },
      (reason: unknown) => {
        if (disposed) return;
        setPreviewFailure(reason instanceof Error ? reason.message : String(reason));
        setPreviewContent('empty');
      },
    );
    return () => {
      disposed = true;
      observer.disconnect();
      if (settleTask !== undefined) clearTimeout(settleTask);
      unmount?.();
    };
  }, [state, story]);

  if (!state || !story) {
    return (
      <div
        style={{ padding: spaceVar[8], color: themeVars.semantic.danger, fontSize: fontSizeVar.md }}
      >
        {moduleError ?? 'This Storybook Docs document is no longer available.'}
      </div>
    );
  }
  const description = docsDescription(story);
  const args = story.args;
  const storyRootId = `${state.modulePath}#${state.storyName}`;
  const canvasExplanation = previewFailure
    ? {
        tone: 'error' as const,
        title: `Story ${storyRootId} failed`,
        description: previewFailure,
      }
    : explainSurface({
        surface: 'Story',
        rootIds: [storyRootId],
        phase: previewContent === 'unknown' ? 'loading' : 'ready',
        content: previewContent,
      });
  return (
    <article
      data-testid="story-docs-document"
      // §2.31 P2 amendment: docs prose reads over a local frost layer.
      className="vgai-content-frost"
      style={{
        // §2.31: no root fill — the dock document surface shows through.
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        pointerEvents: 'auto',
        padding: '24px clamp(18px, 5vw, 64px)',
      }}
    >
      <div
        style={{
          maxWidth: 920,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
        }}
      >
        <header>
          <div
            style={{ color: themeVars.content.dim, fontSize: fontSizeVar.base, marginBottom: 5 }}
          >
            {story.title ?? state.modulePath}
          </div>
          <h1
            style={{ color: themeVars.content.primary, fontSize: fontSizeVar.heading, margin: 0 }}
          >
            {story.label}
          </h1>
          {(description.story ?? description.component) && (
            <p
              style={{
                color: themeVars.content.primary,
                lineHeight: 1.6,
                maxWidth: 760,
                whiteSpace: 'pre-wrap',
              }}
            >
              {description.story ?? description.component}
            </p>
          )}
        </header>
        <section>
          <h2 style={{ color: themeVars.content.primary, fontSize: fontSizeVar.xl }}>Canvas</h2>
          <div style={{ position: 'relative', minHeight: 180 }}>
            <div
              ref={previewRef}
              data-testid="story-docs-canvas"
              style={{
                position: 'relative',
                isolation: 'isolate',
                contain: 'layout paint',
                minHeight: 180,
                padding: 18,
                overflow: 'auto',
                background: themeVars.surface.inset,
                border: `1px solid ${themeVars.boundary.default}`,
                borderRadius: themeVars.shape.medium,
              }}
            />
            <SurfaceStateOverlay
              explanation={canvasExplanation}
              testId="story-docs-surface-status"
            />
          </div>
        </section>
        <section>
          <h2 style={{ color: themeVars.content.primary, fontSize: fontSizeVar.xl }}>Args</h2>
          <div
            style={{
              border: `1px solid ${themeVars.boundary.default}`,
              borderRadius: themeVars.shape.medium,
              overflow: 'hidden',
            }}
          >
            {Object.entries(args).map(([name, value]) => (
              <div
                key={name}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(120px, .4fr) minmax(140px, .6fr) 1fr',
                  gap: spaceVar[6],
                  padding: `${spaceVar[4]} ${spaceVar[5]}`,
                  borderBottom: `1px solid ${themeVars.boundary.default}`,
                  fontSize: fontSizeVar.base,
                }}
              >
                <code style={{ color: themeVars.accent.default }}>{name}</code>
                <span style={{ color: themeVars.content.muted }}>
                  {Array.isArray(value) ? 'array' : typeof value}
                </span>
                <code
                  style={{
                    color: themeVars.content.primary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {typeof value === 'function' ? 'function' : JSON.stringify(value)}
                </code>
              </div>
            ))}
            {Object.keys(args).length === 0 && (
              <div
                style={{
                  padding: spaceVar[5],
                  color: themeVars.content.dim,
                  fontSize: fontSizeVar.base,
                }}
              >
                This story declares no args.
              </div>
            )}
          </div>
        </section>
        <footer style={{ color: themeVars.content.dim, fontSize: fontSizeVar.sm }}>
          {state.modulePath} · {state.storyName}
        </footer>
      </div>
    </article>
  );
}

/** Document-local toolbar (§7.1 contribution): source module + Run play(). */
function StoryDocumentToolbar({ documentId }: WorkspaceDocumentContentProps) {
  useSyncExternalStore(subscribeStoryDocuments, storyDocumentsVersion);
  useSyncExternalStore(subscribeProjectStoryModules, () => getProjectStoryModules());
  const state = _states.get(documentId);
  if (!state) return null;
  const { story } = findComposedStory(state.modulePath, state.storyName);
  const hasPlay = typeof story?.Component.play === 'function';
  const result = state.playResult;
  return (
    <div
      data-testid="story-document-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: spaceVar[4],
        padding: '3px 10px',
        fontSize: fontSizeVar.sm,
        color: themeVars.content.muted,
        borderBottom: `1px solid ${themeVars.boundary.default}`,
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {state.modulePath} —{' '}
        <code style={{ color: themeVars.accent.default }}>{state.storyName}</code>
      </span>
      <ResolutionPicker
        resolution={state.resolution}
        scale={state.scale}
        onResolutionChange={(resolution) => {
          state.resolution = resolution;
          notifyChanged();
        }}
      />
      <Button
        size="compact"
        data-testid="story-open-docs"
        onClick={() => openStoryDocsDocument(state.store, state.modulePath, state.storyName)}
        style={{ flexShrink: 0 }}
      >
        Docs
      </Button>
      {hasPlay && story && (
        <Button
          variant="outline"
          size="compact"
          data-testid="story-run-play"
          onClick={async () => {
            if (!state.container || !state.previewReady) return;
            const previewRevision = state.previewRevision;
            const playResult = await runStoryPlay(
              state.modulePath,
              state.storyName,
              story.Component,
              state.container,
            );
            const current = _states.get(documentId);
            if (current?.previewReady && current.previewRevision === previewRevision) {
              current.playResult = playResult;
              notifyChanged();
            }
          }}
          disabled={!state.previewReady}
          style={{ flexShrink: 0 }}
        >
          Run play()
        </Button>
      )}
      {result?.ran && !result.error && (
        <span
          data-testid="story-play-result"
          style={{ color: themeVars.semantic.success, fontWeight: 600 }}
        >
          play() ran
        </span>
      )}
      {result?.error && (
        <span data-testid="story-play-result" style={{ color: themeVars.semantic.danger }}>
          {result.error}
        </span>
      )}
    </div>
  );
}

// --- Inspector "Story Args" section (§5: Storybook args → right Inspector) -

function ArgRow({ id, name, value }: { id: string; name: string; value: unknown }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: spaceVar[3], padding: '3px 0' }}>
      <span
        style={{
          width: 90,
          flexShrink: 0,
          fontSize: fontSizeVar.base,
          color: themeVars.content.muted,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={name}
      >
        {name}
      </span>
      {typeof value === 'boolean' ? (
        <Checkbox
          className="vgai-checkbox"
          data-testid={`story-arg-${name}`}
          checked={value}
          onChange={(e) => setStoryArgOverride(id, name, e.target.checked)}
        />
      ) : typeof value === 'number' ? (
        <TextInput
          type="number"
          className="vgai-input"
          data-testid={`story-arg-${name}`}
          value={value}
          onChange={(e) => {
            // Empty/unparseable input clears the override (falls back to the
            // authored arg) instead of setting NaN — `Number.parseFloat('')`
            // is NaN, and storing NaN would both win over the authored value
            // in the composed-args merge (see `setStoryArgOverride`'s doc
            // comment) and make this a controlled input whose displayed
            // `value` is `NaN`, which React warns about.
            const raw = e.target.value;
            const parsed = Number.parseFloat(raw);
            setStoryArgOverride(id, name, raw === '' || Number.isNaN(parsed) ? undefined : parsed);
          }}
          style={{ width: 80 }}
        />
      ) : typeof value === 'string' ? (
        <TextInput
          type="text"
          className="vgai-input"
          data-testid={`story-arg-${name}`}
          value={value}
          onChange={(e) => setStoryArgOverride(id, name, e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
      ) : (
        <span
          style={{ fontSize: fontSizeVar.base, color: themeVars.content.dim }}
          data-testid={`story-arg-${name}`}
        >
          {typeof value === 'function' ? 'fn (logged to Actions)' : JSON.stringify(value)}
        </span>
      )}
    </div>
  );
}

/** Registered section: renders while the ACTIVE center document is a story —
 *  the args of THAT story (composed args merged with live overrides). */
export function StoryArgsSection() {
  useSyncExternalStore(subscribeStoryDocuments, storyDocumentsVersion);
  useSyncExternalStore(subscribeProjectStoryModules, () => getProjectStoryModules());
  const active = activeStoryDocumentState();
  if (!active) return null;
  const { story } = findComposedStory(active.modulePath, active.storyName);
  const args = story ? { ...composedStoryArgs(story), ...active.argOverrides } : {};
  const names = Object.keys(args);
  return (
    <div
      data-testid="inspector-story-args"
      style={{
        pointerEvents: 'auto',
        padding: spaceVar[4],
        borderBottom: `1px solid ${themeVars.boundary.default}`,
      }}
    >
      <div
        style={{
          fontSize: fontSizeVar.base,
          color: themeVars.content.dim,
          textTransform: 'uppercase',
          marginBottom: spaceVar[2],
        }}
      >
        Story Args
      </div>
      <div
        style={{
          fontSize: fontSizeVar.base,
          color: themeVars.content.primary,
          fontWeight: 600,
          marginBottom: spaceVar[2],
        }}
      >
        {active.storyName}
      </div>
      {names.length === 0 && (
        <div style={{ fontSize: fontSizeVar.base, color: themeVars.content.dim }}>
          {story ? 'This story declares no args.' : 'Story source unavailable.'}
        </div>
      )}
      {names.map((name) => (
        <ArgRow key={name} id={active.id} name={name} value={args[name]} />
      ))}
    </div>
  );
}

// --- Utilities: Actions + Interactions (§5 story-scoped utility tabs) ------

/** Actions utility content: the wrapped-arg call log of the active story. */
export function StoryActionsUtility() {
  useSyncExternalStore(subscribeStoryDocuments, storyDocumentsVersion);
  const active = activeStoryDocumentState();
  if (!active) {
    return (
      <div style={{ padding: spaceVar[6], fontSize: fontSizeVar.md, color: themeVars.content.dim }}>
        No active story.
      </div>
    );
  }
  return (
    <div
      data-testid="story-actions-utility"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: spaceVar[4],
        fontSize: fontSizeVar.base,
      }}
    >
      <Button
        size="compact"
        style={{ marginBottom: spaceVar[3] }}
        onClick={() => clearStoryActionLog(active.id)}
      >
        Clear
      </Button>
      {active.actionLog.length === 0 ? (
        <div style={{ color: themeVars.content.dim }}>
          No actions logged — function-valued args are wrapped with logging spies; interact with the
          story preview to see calls here.
        </div>
      ) : (
        active.actionLog.map((entry, i) => (
          <div
            key={i}
            style={{
              padding: `${spaceVar[1]} 0`,
              borderBottom: `1px solid ${themeVars.boundary.default}`,
            }}
          >
            <code style={{ color: themeVars.accent.default }}>{entry.name}</code>{' '}
            <span style={{ color: themeVars.content.muted }}>
              (
              {entry.args
                .map((a) => {
                  try {
                    return typeof a === 'object' ? JSON.stringify(a)?.slice(0, 80) : String(a);
                  } catch {
                    return String(a);
                  }
                })
                .join(', ')}
              )
            </span>
          </div>
        ))
      )}
    </div>
  );
}

/** Interactions utility content: the active story's play() run results. */
export function StoryInteractionsUtility() {
  useSyncExternalStore(subscribeStoryDocuments, storyDocumentsVersion);
  const active = activeStoryDocumentState();
  if (!active) {
    return (
      <div style={{ padding: spaceVar[6], fontSize: fontSizeVar.md, color: themeVars.content.dim }}>
        No active story.
      </div>
    );
  }
  const result = active.playResult;
  return (
    <div
      data-testid="story-interactions-utility"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: spaceVar[6],
        fontSize: fontSizeVar.md,
      }}
    >
      {!result && (
        <div style={{ color: themeVars.content.dim }}>
          No interaction run yet — use the story document's “Run play()”.
        </div>
      )}
      {result && !result.ran && (
        <div style={{ color: themeVars.content.dim }}>This story declares no play() function.</div>
      )}
      {result?.ran && !result.error && (
        <div style={{ color: themeVars.semantic.success, fontWeight: 600 }}>
          play() ran without errors.
        </div>
      )}
      {result?.error && (
        <div style={{ color: themeVars.semantic.danger, whiteSpace: 'pre-wrap' }}>
          {result.error}
        </div>
      )}
    </div>
  );
}

/** Run axe-core against the active story's isolated preview root. */
export async function runStoryAccessibility(id: string): Promise<void> {
  const state = _states.get(id);
  if (!state?.container || !state.previewReady) return;
  const container = state.container;
  const previewRevision = state.previewRevision;
  state.accessibility = { status: 'running', violations: [] };
  notifyChanged();
  try {
    const axe = (await import('axe-core')).default;
    const result = await axe.run(container);
    const current = _states.get(id);
    if (
      !current?.previewReady ||
      current.previewRevision !== previewRevision ||
      current.container !== container
    )
      return;
    current.accessibility = {
      status: 'complete',
      violations: result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact ?? null,
        help: violation.help,
        helpUrl: violation.helpUrl,
        nodes: violation.nodes.map((node) => ({
          html: node.html,
          target: node.target.map(String),
        })),
      })),
    };
    notifyChanged();
  } catch (reason) {
    const current = _states.get(id);
    if (
      !current?.previewReady ||
      current.previewRevision !== previewRevision ||
      current.container !== container
    )
      return;
    current.accessibility = {
      status: 'error',
      violations: [],
      error: reason instanceof Error ? reason.message : String(reason),
    };
    notifyChanged();
  }
}

/** Story-scoped accessibility results, powered by the same axe engine Storybook uses. */
export function StoryAccessibilityUtility() {
  useSyncExternalStore(subscribeStoryDocuments, storyDocumentsVersion);
  const active = activeStoryDocumentState();
  if (!active)
    return (
      <div style={{ padding: spaceVar[6], fontSize: fontSizeVar.md, color: themeVars.content.dim }}>
        No active story.
      </div>
    );
  const result = active.accessibility;
  return (
    <div
      data-testid="story-accessibility-utility"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: spaceVar[5],
        fontSize: fontSizeVar.base,
      }}
    >
      <Button
        variant="outline"
        size="compact"
        disabled={!active.container || !active.previewReady || result.status === 'running'}
        onClick={() => void runStoryAccessibility(active.id)}
        style={{ marginBottom: spaceVar[4] }}
      >
        {result.status === 'running' ? 'Checking…' : 'Run accessibility check'}
      </Button>
      {result.status === 'idle' && (
        <div style={{ color: themeVars.content.dim }}>
          Run axe against the mounted story preview.
        </div>
      )}
      {result.status === 'error' && (
        <div style={{ color: themeVars.semantic.danger }}>{result.error}</div>
      )}
      {result.status === 'complete' && result.violations.length === 0 && (
        <div style={{ color: themeVars.semantic.success, fontWeight: 600 }}>
          No accessibility violations found.
        </div>
      )}
      {result.violations.map((violation) => (
        <details
          key={violation.id}
          style={{
            borderBottom: `1px solid ${themeVars.boundary.default}`,
            padding: `${spaceVar[3]} 0`,
          }}
        >
          <summary
            style={{
              color:
                violation.impact === 'critical' || violation.impact === 'serious'
                  ? themeVars.semantic.danger
                  : themeVars.content.primary,
              cursor: 'pointer',
            }}
          >
            {violation.help} · {violation.nodes.length} node
            {violation.nodes.length === 1 ? '' : 's'}
          </summary>
          <a
            href={violation.helpUrl}
            target="_blank"
            rel="noreferrer"
            style={{ color: themeVars.accent.default, display: 'inline-block', margin: '5px 0' }}
          >
            How to fix
          </a>
          {violation.nodes.map((node, index) => (
            <pre
              key={`${violation.id}:${index}`}
              style={{
                color: themeVars.content.muted,
                fontFamily: fontMono,
                fontSize: fontSizeVar.sm,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {node.target.join(' ')}
              {`\n`}
              {node.html}
            </pre>
          ))}
        </details>
      ))}
    </div>
  );
}

const registrationGroup = createHmrRegistrationGroup(import.meta.hot, 'story-contributions');

/**
 * Idempotent one-time registration of the story-scoped shell contributions:
 * the Inspector `Story Args` section and the `Actions`/`Interactions`
 * utilities. Called from `openStoryDocument` (and importable directly) so
 * merely importing this module in a test doesn't mutate the registries.
 */
export function ensureStoryContributionsRegistered(): void {
  registrationGroup.ensure((track) => {
    track(
      registerInspectorSections({
        match: () => activeWorkspaceDocument()?.descriptor.kind === 'story',
        id: STORY_ARGS_SECTION_ID,
        title: STORY_ARGS_SECTION_TITLE,
        icon: STORY_ARGS_SECTION_ICON,
        order: CONTRIBUTED_SECTION_ORDER,
        Section: StoryArgsSection,
      }),
    );
    const storyActive = () => activeStoryDocumentState() !== null;
    track(
      registerWorkspaceUtility({
        ...CONTRIBUTED_WORKSPACE_UTILITIES.storyActions,
        Content: StoryActionsUtility,
        available: storyActive,
      }),
    );
    track(
      registerWorkspaceUtility({
        ...CONTRIBUTED_WORKSPACE_UTILITIES.storyInteractions,
        Content: StoryInteractionsUtility,
        available: storyActive,
      }),
    );
    track(
      registerWorkspaceUtility({
        ...CONTRIBUTED_WORKSPACE_UTILITIES.storyAccessibility,
        Content: StoryAccessibilityUtility,
        available: storyActive,
      }),
    );
  });
}

/** Test-only: allow re-registration after a registry reset. */
export function __resetStoryContributionsForTest(): void {
  registrationGroup.reset();
}
