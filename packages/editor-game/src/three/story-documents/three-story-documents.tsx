/**
 * The per-story 3D document the `3D` board opens: ONE mounted `three`
 * story, presented on the editor's existing Object3D document surface
 * (`StageHost.tsx`'s `Object3DDocumentViewport` — real
 * EditorViewport, orbit camera, source-backed R3F hierarchy and transforms,
 * the shared `Object3DDocumentToolbar`). There is deliberately no
 * new viewport class here: a mounted story IS an `Object3D`, so it opens on the
 * surface every other native `Object3D` opens on.
 *
 * ## What this module actually owns
 *
 * This module owns each asynchronous story mount. A viewport borrows it until
 * its content replacement has settled; retiring a source releases the fiber
 * root only after the last viewport borrow returns. A source revision never
 * closes the document or resets its editor state.
 *
 * ## Args → Inspector
 *
 * A registered Inspector section (the same `inspector-section-registry` seam
 * `story-documents.tsx`'s `Story Args` uses), whose editable set and widget
 * types come from the SHARED `storyArgPropertyDescriptors`
 * (`stories/story-arg-descriptors.ts`, extracted from
 * `react-world-authoring-adapter.ts`'s `portableStoryArgDescriptors`) — so a
 * story arg is editable in exactly one place's opinion, whichever surface shows
 * it.
 */

import { Object3DDocumentViewport } from '@volter/editor-threejs/kit/components/Object3DDocumentViewport';
import type { SourceDocumentAuthoringFactory } from '@volter/editor-threejs/kit/components/StageHost';
import { SurfaceStateOverlay } from '@volter/editor-core/components/SurfaceStateOverlay';
import { STANDARD_COMPONENT_CAMERA_DIRECTION } from '@volter/editor-threejs/kit/components/standard-viewport-dressing';
import { registerDocumentOpener } from '@volter/editor-sdk/kit/document-open-registry';
import { createHmrRegistrationGroup } from '@volter/editor-sdk/kit/hmr-registration-group';
import {
  CONTRIBUTED_SECTION_ORDER,
  STORY_ARGS_SECTION_ID,
  STORY_ARGS_SECTION_TITLE,
} from '@volter/editor-sdk/kit/inspection-model';
import { registerInspectorSections } from '@volter/editor-sdk/kit/inspector-section-registry';
import type { ComposedProjectStory } from '@volter/editor-core/stories/compose-project-stories';
import {
  type MountedStoryViewportSource,
  mountedStoryViewportSource,
} from '../../host/stories/mounted-story-viewport-source';
import { getProjectStoryRegions } from '@volter/editor-sdk/kit/stories/project-story-regions';
import { storyArgPropertyDescriptors } from '../../host/stories/story-arg-descriptors';
import { declaredStoryMedium } from '@volter/editor-sdk/kit/stories/story-declared-medium';
import {
  type StoryDocumentOpenRequest,
  THREE_STORY_DOCUMENT_OPENER,
} from '@volter/editor-sdk/kit/story-document-openers';
import {
  getProjectStoryModules,
  subscribeProjectStoryModules,
} from '@volter/editor-core/stories/story-registry';
import {
  disposeStoryObject3D,
  mountStoryObject3D,
  type StoryPreviewComponent,
} from '../../host/stories/story-three-preview';
import { mountedStoryHasThreeContent } from '@volter/editor-threejs/kit/stories/three-story-model';
import { explainSurface } from '@volter/editor-sdk/kit/surface-state';
import { sourceWriteBackendIfPrimed } from '@volter/editor-core/ui-source/tier-source-write-backend';
import {
  activeWorkspaceDocument,
  closeWorkspaceDocument,
  openWorkspaceDocument,
  type WorkspaceDocumentContentProps,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { registerWorkspaceDocumentRestorer } from '@volter/editor-sdk/kit/workspace-document-restore';
import { STORY_ARGS_SECTION_ICON } from '../../react/story-documents/story-args-section';
import {
  prepareStoryDocumentRestore,
  storyDocumentId,
} from '../../react/story-documents/story-documents';
import { Checkbox, TextInput, themeVars } from '@volter/editor-sdk/widgets';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { R3fSourceAuthoringAdapter } from '../authoring/r3f-source-authoring-adapter';

/** Inspector path namespace for this document's story args. Its own, because
 *  the path namespace belongs to the node the values are read back through. */
const THREE_STORY_ARG_PATH_PREFIX = 'threeStory.arg.';

/** The narrow store surface a three-story document needs — the T6.3 input-gate
 *  hand-off, identical to `story-documents.tsx`'s `StoryDocumentStore`. */
interface ThreeStoryDocumentState {
  readonly modulePath: string;
  readonly storyName: string;
  argOverrides: Record<string, unknown>;
}

const _states = new Map<string, ThreeStoryDocumentState>();
let _version = 0;
const _listeners = new Set<() => void>();

function notifyChanged(): void {
  _version++;
  for (const fn of _listeners) fn();
}

function subscribeThreeStoryDocuments(fn: () => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

function threeStoryDocumentsVersion(): number {
  return _version;
}

/** Stable identity for a portable story rendered on the declared Three medium. */
export function threeStoryDocumentId(modulePath: string, storyName: string): string {
  return `three-story:${modulePath}#${storyName}`;
}

/** The ACTIVE center document's three-story state, or `null`. */
function activeThreeStoryDocument(): (ThreeStoryDocumentState & { id: string }) | null {
  const active = activeWorkspaceDocument();
  if (!active) return null;
  const state = _states.get(active.descriptor.id);
  return state ? { ...state, id: active.descriptor.id } : null;
}

/** Set one arg override — remounts this story's Object3D. `undefined` CLEARS
 *  the override (the `delete`-the-key convention `setStoryArgOverride` uses,
 *  for the same reason: an absent key falls back to the authored arg, a stored
 *  `NaN` would win over it). */
export function setThreeStoryArgOverride(id: string, key: string, value: unknown): void {
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

/**
 * Open (or activate) the 3D document for one `three` story. The board's
 * exhibit click-through target.
 */
export function openThreeStoryDocument(
  modulePath: string,
  storyName: string,
  title = storyName,
  // A click-through OPENS AND FOCUSES, which is why activation is the default.
  // The Edit tab row (`scene-documents.tsx`) opens a story-reached scene as a
  // STANDING tab instead: it is offered, never imposed, so it passes `false`
  // for the same reason the boards do.
  options: { activate?: boolean } = {},
): string {
  ensureThreeStoryContributionsRegistered();
  // One portable story has one preview document. Close a stale DOM preview
  // of the same story before opening its resolved Object3D medium; otherwise
  // the hidden DOM renderer still mounts the R3F component and reports a
  // misleading "Hooks can only be used within Canvas" crash.
  closeWorkspaceDocument(storyDocumentId(modulePath, storyName));
  const id = threeStoryDocumentId(modulePath, storyName);
  if (!_states.has(id)) {
    _states.set(id, { modulePath, storyName, argOverrides: {} });
    notifyChanged();
  }
  return openWorkspaceDocument(
    {
      id,
      title,
      kind: 'world',
      workspaceRole: 'authored-subject',
      provenance: { sourcePath: modulePath },
      Content: ThreeStoryDocumentContent,
      closeable: true,
      presentation: () => ({ kind: 'story', modulePath, storyName, mode: 'preview' }),
      // A per-story 3D document is SESSION-CREATED — nothing at boot
      // re-derives it from the composite, unlike a manifest world — so it
      // writes itself down or comes back as a titled panel with no content.
      // The LIVE tab text goes with it: the opening board names an exhibit by
      // a board-scoped rule (`board-scene.ts`) that one story cannot
      // re-derive.
      persist: ({ title: liveTitle }) => ({ modulePath, storyName, title: liveTitle }),
      onDispose: (documentId) => {
        if (_states.delete(documentId)) notifyChanged();
      },
    },
    { activate: options.activate !== false },
  );
}

/** One open three-story document's identity, or `undefined`. A story is a
 *  STABLE, ADDRESSABLE state (module path + story name), so this is everything
 *  `workspace-state-persistence` needs to write the document down and reopen
 *  it on the next boot — the same shape, and the same reason, as
 *  `story-documents.tsx`'s `storyDocumentState`. */
export function threeStoryDocumentState(
  id: string,
): { readonly modulePath: string; readonly storyName: string } | undefined {
  const state = _states.get(id);
  return state ? { modulePath: state.modulePath, storyName: state.storyName } : undefined;
}

/**
 * Reopen a persisted three-story document at boot, or refuse. VERIFIES first
 * (the persistence module's "persist+restore only documents that can
 * truthfully reopen" rule): a module that no longer loads, or no longer
 * exports that story, restores NOTHING and the stale document is dropped
 * by the workspace's ordinary reconciliation. Callers must have settled the
 * story registry (`refreshProjectStories`) first — this reads it synchronously.
 */
export function restoreThreeStoryDocument(
  modulePath: string,
  storyName: string,
  title?: string,
): boolean {
  const { story } = findComposedStory(modulePath, storyName);
  if (!story) return false;
  if (declaredStoryMedium({ modulePath, regions: getProjectStoryRegions() }).medium !== 'three') {
    return false;
  }
  // `title` is the tab's saved text. The board names an exhibit by a
  // BOARD-SCOPED rule (`board-scene.ts`: the component leaf, disambiguated
  // with the story label only where one leaf contributes several exhibits),
  // which no single story can re-derive — so the tab is restored with the text
  // it had, falling back to the registry's own label for a record that
  // predates this or came from another opener.
  openThreeStoryDocument(modulePath, storyName, title ?? story.label);
  return true;
}

/** The turntable's address (`document-open-registry.ts`) — a story mounted as
 *  an Object3D on the standard 3D document surface. */
registerDocumentOpener<StoryDocumentOpenRequest>({
  id: THREE_STORY_DOCUMENT_OPENER,
  owner: 'three-story-documents',
  open: (_store, request) =>
    openThreeStoryDocument(request.modulePath,
      request.storyName,
      request.title ?? request.storyName,
      request.activate === undefined ? {} : { activate: request.activate },
    ),
});

/** Reopen a persisted 3D story document. `restoreThreeStoryDocument` is the
 *  verification (module loads, story still exported, medium still `three`)
 *  and answers `false` when any of it has moved. */
registerWorkspaceDocumentRestorer({
  kind: 'world',
  owner: 'three-story-documents',
  prepare: prepareStoryDocumentRestore,
  restore: ({ state }) => {
    const record = state as
      | { modulePath?: unknown; storyName?: unknown; title?: unknown }
      | null
      | undefined;
    const modulePath = typeof record?.modulePath === 'string' ? record.modulePath : null;
    const storyName = typeof record?.storyName === 'string' ? record.storyName : null;
    if (!modulePath || !storyName) return false;
    const title = typeof record?.title === 'string' ? record.title : undefined;
    return restoreThreeStoryDocument(modulePath, storyName, title);
  },
});

/** Test-only reset — drops all three-story document state. */
export function __resetThreeStoryDocumentsForTest(): void {
  _states.clear();
  notifyChanged();
}

function findComposedStory(
  modulePath: string,
  storyName: string,
): { story: ComposedProjectStory | undefined; moduleError: string | undefined } {
  const module_ = getProjectStoryModules().find((m) => m.modulePath === modulePath);
  if (!module_) return { story: undefined, moduleError: undefined };
  if (!module_.ok) return { story: undefined, moduleError: module_.error };
  return { story: module_.stories.find((s) => s.name === storyName), moduleError: undefined };
}

// --- Document content -----------------------------------------------------

function ThreeStoryDocumentContent({ documentId, active }: WorkspaceDocumentContentProps) {
  useSyncExternalStore(subscribeThreeStoryDocuments, threeStoryDocumentsVersion);
  // Re-resolve on every registry refresh (project change, `story-files-changed`
  // SSE) — the same live-rescan physics every other story surface uses.
  useSyncExternalStore(subscribeProjectStoryModules, getProjectStoryModules);
  const state = _states.get(documentId);
  const [source, setSource] = useState<MountedStoryViewportSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ownedSources = useRef(new Set<MountedStoryViewportSource>());
  // Keep the displayed mount alive while its replacement compiles and settles.
  // Retire old mounts only after React has committed the new viewport source.
  useEffect(() => {
    if (!source) return;
    for (const owned of ownedSources.current) {
      // Set insertion order is publication order. A newer result may already
      // be queued for React; never retire it from an older commit's effect.
      if (owned === source) break;
      owned.dispose();
      ownedSources.current.delete(owned);
    }
  }, [source]);
  useEffect(
    () => () => {
      for (const owned of ownedSources.current) owned.dispose();
      ownedSources.current.clear();
    },
    [],
  );
  // The layout host mounts every open document, so a session
  // restored with several story tabs would otherwise mount every one of their
  // fiber roots at boot. Mount on FIRST activation and retain the mount
  // afterwards — latching rather than tracking `active` is the point: a mount
  // freed on deactivation is exactly the black-panel defect
  // `mountedStoryViewportSource` documents.
  const [visited, setVisited] = useState(active);
  // This document is a mounted project-owned R3F composition whose stamped
  // JSX source is its write authority, so THIS caller supplies the source
  // adapter — the Object3D document constructs no source lane itself.
  // Memoized on the identity it closes over: the factory is an activation
  // dependency of the viewport and must not change per render.
  const modulePath = state?.modulePath;
  const sourceAuthoring = useMemo<SourceDocumentAuthoringFactory | undefined>(
    () =>
      modulePath
        ? ({ store, scene, hierarchyRoots }) => {
            const adapter = new R3fSourceAuthoringAdapter(store, scene, {
              worldId: documentId,
              entryPath: modulePath,
              writeBackend: sourceWriteBackendIfPrimed('The Asset Editor'),
              hierarchyMode: 'definition',
              ...(hierarchyRoots ? { hierarchyRoots } : {}),
            });
            return { adapter, dispose: () => adapter.dispose() };
          }
        : undefined,
    [documentId, modulePath],
  );
  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);
  const { story, moduleError } = state
    ? findComposedStory(state.modulePath, state.storyName)
    : { story: undefined, moduleError: undefined };
  const overridesKey = state ? JSON.stringify(state.argOverrides) : '';

  useEffect(() => {
    if (!visited || !story || !state) return;
    let cancelled = false;
    setError(null);
    void mountStoryObject3D(story.Component as StoryPreviewComponent, {
      ...state.argOverrides,
    })
      .then((mounted) => {
        if (cancelled) {
          void disposeStoryObject3D(mounted);
          return;
        }
        // A story that reconciles to an EMPTY subtree is the one remaining way
        // this document could paint a black viewport with nothing to say. Same
        // predicate every three surface qualifies on, so they cannot disagree
        // about what "mounted as three" means — and here it
        // becomes a reported failure rather than an empty picture.
        if (!mountedStoryHasThreeContent(mounted.root)) {
          void disposeStoryObject3D(mounted);
          setError(
            'The story mounted with no three content — its first R3F commit rendered an empty ' +
              'subtree. A <Suspense> boundary around three content is the usual cause: the ' +
              'boundary commits its fallback first, so the real children arrive on a later ' +
              'commit this document never sees.',
          );
          return;
        }
        const next = mountedStoryViewportSource(mounted);
        ownedSources.current.add(next);
        setSource(next);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
      // Cancel obsolete builds. The displayed source remains owned until a
      // replacement commits or the document closes; HMR is not a close.
    };
    // `story.Component` identity changes on registry refresh, `overridesKey` on
    // an arg edit — both remount, which is exactly the wanted behavior.
    // `visited` only ever goes false → true, so it never tears a mount down.
  }, [visited, story, state, overridesKey]);

  if (!state) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: themeVars.content.muted }}>
        This story document is no longer available.
      </div>
    );
  }

  if ((!story || error) && !source) {
    const rootId = `${state.modulePath}#${state.storyName}`;
    return (
      <div
        data-testid="three-story-document-error"
        style={{ position: 'relative', flex: 1, minHeight: 0 }}
      >
        <SurfaceStateOverlay
          testId="three-story-surface-status"
          explanation={{
            tone: 'error',
            title: `Story ${rootId} failed`,
            description:
              error ?? moduleError ?? 'It may have been renamed or removed; close this document.',
          }}
        />
      </div>
    );
  }

  if (!source) {
    return (
      <div
        data-testid="three-story-document-loading"
        style={{ position: 'relative', flex: 1, minHeight: 0 }}
      >
        <SurfaceStateOverlay
          testId="three-story-surface-status"
          explanation={explainSurface({
            surface: 'Story',
            rootIds: [`${state.modulePath}#${state.storyName}`],
            phase: 'loading',
            content: 'unknown',
          })}
        />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', display: 'flex', flex: 1, minHeight: 0 }}>
      <Object3DDocumentViewport
        documentId={documentId}
        sourcePath={state.modulePath}
        build={source.build}
        displayName={story?.label ?? state.storyName}
        active={active}
        assetType="component"
        {...(sourceAuthoring ? { sourceAuthoring } : {})}
        cameraDirection={STANDARD_COMPONENT_CAMERA_DIRECTION}
      />
      {(!story || error) && (
        <SurfaceStateOverlay
          testId="three-story-surface-status"
          explanation={{
            tone: 'error',
            title: 'Source update failed',
            description:
              error ??
              moduleError ??
              'This story is unavailable. The last working view is retained.',
          }}
        />
      )}
    </div>
  );
}

// --- Inspector "Story Args" section for a three-story document -------------

function ThreeStoryArgsSection() {
  useSyncExternalStore(subscribeThreeStoryDocuments, threeStoryDocumentsVersion);
  useSyncExternalStore(subscribeProjectStoryModules, getProjectStoryModules);
  const active = activeThreeStoryDocument();
  if (!active) return null;
  const { story } = findComposedStory(active.modulePath, active.storyName);
  const args = story ? { ...story.args, ...active.argOverrides } : {};
  // One owner for "which args are editable, and as what" — shared with the
  // React world adapter's story nodes.
  const descriptors = storyArgPropertyDescriptors(args, THREE_STORY_ARG_PATH_PREFIX);

  return (
    <div
      data-testid="inspector-story-args-three"
      style={{
        pointerEvents: 'auto',
        padding: 8,
        borderBottom: `1px solid ${themeVars.boundary.default}`,
      }}
    >
      {/* No mini-label of its own: the projection heads this section with its
          title and icon (`components/InspectionProjection.tsx`). */}
      <div
        style={{ fontSize: 11, color: themeVars.content.primary, fontWeight: 600, marginBottom: 4 }}
      >
        {active.storyName}
      </div>
      {descriptors.length === 0 && (
        <div style={{ fontSize: 11, color: themeVars.content.dim }}>
          {story ? 'This story declares no editable args.' : 'Story source unavailable.'}
        </div>
      )}
      {descriptors.map((descriptor) => (
        <div
          key={descriptor.path}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}
        >
          <span
            title={descriptor.label}
            style={{
              width: 90,
              flexShrink: 0,
              fontSize: 11,
              color: themeVars.content.muted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {descriptor.label}
          </span>
          {descriptor.type === 'boolean' ? (
            <Checkbox
              className="vgai-checkbox"
              data-testid={`three-story-arg-${descriptor.label}`}
              checked={args[descriptor.label] === true}
              onChange={(e) =>
                setThreeStoryArgOverride(active.id, descriptor.label, e.target.checked)
              }
            />
          ) : descriptor.type === 'number' ? (
            <TextInput
              type="number"
              className="vgai-input"
              data-testid={`three-story-arg-${descriptor.label}`}
              value={args[descriptor.label] as number}
              onChange={(e) => {
                // Empty/unparseable clears the override rather than storing
                // NaN — same reason as `setThreeStoryArgOverride`'s doc.
                const raw = e.target.value;
                const parsed = Number.parseFloat(raw);
                setThreeStoryArgOverride(
                  active.id,
                  descriptor.label,
                  raw === '' || Number.isNaN(parsed) ? undefined : parsed,
                );
              }}
              style={{ width: 80 }}
            />
          ) : descriptor.type === 'string' ? (
            <TextInput
              type="text"
              className="vgai-input"
              data-testid={`three-story-arg-${descriptor.label}`}
              value={args[descriptor.label] as string}
              onChange={(e) =>
                setThreeStoryArgOverride(active.id, descriptor.label, e.target.value)
              }
              style={{ flex: 1, minWidth: 0 }}
            />
          ) : (
            <span
              data-testid={`three-story-arg-${descriptor.label}`}
              style={{ fontSize: 11, color: themeVars.content.dim }}
            >
              {JSON.stringify(args[descriptor.label])}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

const registrationGroup = createHmrRegistrationGroup(import.meta.hot, 'three-story-contributions');

/** Idempotent one-time registration of the three-story Inspector section.
 *  Called from `openThreeStoryDocument` so merely importing this module in a
 *  test does not mutate shared registries. */
export function ensureThreeStoryContributionsRegistered(): void {
  registrationGroup.ensure((track) => {
    track(
      registerInspectorSections({
        match: () => activeThreeStoryDocument() !== null,
        id: STORY_ARGS_SECTION_ID,
        title: STORY_ARGS_SECTION_TITLE,
        icon: STORY_ARGS_SECTION_ICON,
        order: CONTRIBUTED_SECTION_ORDER,
        Section: ThreeStoryArgsSection,
      }),
    );
  });
}

/** Test-only: allow re-registration after a registry reset. */
export function __resetThreeStoryContributionsForTest(): void {
  registrationGroup.reset();
}
