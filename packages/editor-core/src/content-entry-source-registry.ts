/**
 * A CONTENT ENTRY IS SOURCED, NOT DERIVED — the fourth registry in the family
 * of `workspace-document-restore.ts` (a kind owns its persisted state),
 * `document-open-registry.ts` (a kind owns how it opens) and
 * `chrome-slot-registry.ts` (the host owns the place, a package owns what sits
 * there). Here: the host owns the Content SCOPE — the grid, the chips, the
 * sort, the search, the selection and the drag — and a package owns WHY a
 * project component is content at all, what it looks like, and what opening it
 * means.
 *
 * WHY IT EXISTS. The Content scope of `components/AssetBrowser.tsx` already
 * concatenates two sources it does not own: the active adapter facet's
 * document entries and `liveAuthoringAssets(adapter)`. A THIRD was hard-wired
 * — `pickComponentPreviewStory` decided which components were content and
 * `StoryComponentThumbnail` painted them — which made the host's Content
 * browser know what portable CSF is, and dragged the story registry (and
 * therefore Storybook) into every editor boot, a `models` build that authors
 * no stories included (WORK.md §Stories leave the host, edge 1 — the ONE new
 * door that design mints). The shape is transcribed from
 * `chrome-slot-registry.ts`: register / list / subscribe / version, with the
 * same owner-replaces-owner rule for an HMR re-evaluation.
 *
 * NOTHING REGISTERED IS A REAL ANSWER. A build whose package list carries no
 * content source lists documents and assets and no component tiles — the same
 * honest emptiness a document kind with no registered opener gives.
 *
 * WHAT THE HOST STILL OWNS, and why it is not a leak: the COMPONENT INDEX
 * (`services.listProjectComponents()`, the server's own scan) is the host's,
 * and it is handed to every source as context. A source answers "which of
 * these, and why" — it never rescans the project.
 */

import type { AdapterSurface } from '@volter/editor-project/adapter';
import type { ComponentType } from 'react';
import type { ProjectComponentEntry } from './asset-workflow/project-content';
import type { WorkspaceStateStore } from './workspace-document-restore';

/**
 * A component as a SOURCE sees it: what it is called, where its module is,
 * which surface it mounts on. Deliberately narrower than the host's own index
 * row (`ProjectComponentEntry`, which is assignable to it), because the other
 * caller of this registry has exactly these three facts and no index: the
 * Inspector, asking for the picture of ONE component.
 */
export interface ContentComponentRef {
  readonly name: string;
  readonly path: string;
  readonly surface: ProjectComponentEntry['surface'];
}

/** What a source is asked ABOUT: components, and the surface the question is
 *  focused on (`null` = no active authoring surface, so nothing is filtered
 *  out by surface). The Content scope passes its whole index; the Inspector
 *  passes one. */
export interface ContentEntrySourceContext {
  readonly components: readonly ContentComponentRef[];
  readonly surface: AdapterSurface | null;
}

/** One admitted component. `detail` is the source's own reason — opaque to the
 *  host, handed back to the source's `Thumbnail` and `open`. */
export interface ContentEntry {
  /** Unique within the source; the host keys its row on `<source>:<id>`. */
  readonly id: string;
  /** The component this entry depicts — the very ref the source was given. */
  readonly component: ContentComponentRef;
  /** The source's own reason, opaque by construction: only the source that
   *  minted the entry ever reads it, and it casts. */
  readonly detail: unknown;
}

export interface ContentEntryThumbnailProps {
  readonly entry: ContentEntry;
  /** Bumped by the panel when a preview must be re-taken. */
  readonly previewRevision: number;
  readonly width?: number;
  readonly height?: number;
}

export interface ContentEntrySource {
  /** The source's id, in its own vocabulary. Part of every row key. */
  readonly id: string;
  /** Which module registered it. Re-registering the same owner+id REPLACES,
   *  so an HMR re-evaluation leaves one source, not two. */
  readonly owner: string;
  /** Ascending; ties keep registration order. */
  readonly order?: number;
  readonly entries: (context: ContentEntrySourceContext) => readonly ContentEntry[];
  /** The source's OWN change signal — its ledger settling, a discovery pass
   *  finishing. The panel re-reads on it without knowing what moved. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Paints the tile. A stable component type (not a closure per entry), so
   *  the grid re-renders rather than remounting every preview. */
  readonly Thumbnail: ComponentType<ContentEntryThumbnailProps>;
  /** Double-click: open whatever this entry's subject opens as. */
  readonly open: (store: WorkspaceStateStore, entry: ContentEntry, title: string) => void;
}

const _sources: ContentEntrySource[] = [];
const listeners = new Set<() => void>();
/** Live teardowns for the per-source subscriptions the registry re-fans. */
const sourceSubscriptions = new Map<ContentEntrySource, () => void>();
let version = 0;

function publish(): void {
  version++;
  for (const listener of listeners) listener();
}

/** Install a source. Returns the teardown. */
export function registerContentEntrySource(source: ContentEntrySource): () => void {
  const stale = _sources.findIndex((item) => item.owner === source.owner && item.id === source.id);
  if (stale >= 0) {
    const [removed] = _sources.splice(stale, 1);
    if (removed) {
      sourceSubscriptions.get(removed)?.();
      sourceSubscriptions.delete(removed);
    }
  }
  _sources.push(source);
  _sources.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  sourceSubscriptions.set(source, source.subscribe(publish));
  publish();
  return () => {
    const at = _sources.indexOf(source);
    if (at < 0) return;
    _sources.splice(at, 1);
    sourceSubscriptions.get(source)?.();
    sourceSubscriptions.delete(source);
    publish();
  };
}

const EMPTY: readonly ContentEntrySource[] = [];

/** Everything registered, in order. A stable array per version, so it is a
 *  safe `useSyncExternalStore` snapshot. */
export function contentEntrySources(): readonly ContentEntrySource[] {
  return _sources.length === 0 ? EMPTY : _sources;
}

/** ONE subscription for the panel: the registry's own changes AND every
 *  registered source's. What changed is never the panel's question. */
export function subscribeContentEntrySources(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function contentEntrySourceRegistryVersion(): number {
  return version;
}

/**
 * THE SAME QUESTION, ABOUT ONE COMPONENT: the first registered source that
 * admits it, and the entry it minted — what the INSPECTOR asks when it wants a
 * picture of a component it cannot photograph natively (a canvas entity with
 * no Object3D, a selected component-backed asset).
 *
 * It is deliberately not a second door. "Is this component content, and what
 * does it look like?" is one question; the Content grid asks it of the whole
 * index and the Inspector of a single ref, and both take back the same
 * `{ source, entry }` pair to paint with `source.Thumbnail`.
 */
export function contentEntryForComponent(
  component: ContentComponentRef,
): { readonly source: ContentEntrySource; readonly entry: ContentEntry } | null {
  for (const source of _sources) {
    // Surface `null`: the Inspector is asking about THIS component, not about
    // what belongs on the surface currently in focus.
    const entry = source.entries({ components: [component], surface: null })[0];
    if (entry) return { source, entry };
  }
  return null;
}

/** Test-only reset (mirrors the restore, open and chrome-slot registries'). */
export function __resetContentEntrySourcesForTest(): void {
  for (const stop of sourceSubscriptions.values()) stop();
  sourceSubscriptions.clear();
  _sources.length = 0;
  publish();
}
