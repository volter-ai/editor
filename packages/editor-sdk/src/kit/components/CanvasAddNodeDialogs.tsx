/**
 * GODOT'S RIGHT-CLICK ON A 2D SCENE, whole: a menu of "Add 2D Node Here…" and "Instantiate Scene
 * Here…" at the press, and the dialog each opens. Read from the installed Godot 4.7.1 (its
 * CreateDialog, titled for the base class): Favorites and Recent beside a Search field with an
 * (un)favorite button, the Matches as a class tree, the selected class's Description, and Create.
 * Instantiate picks one of the project's canvas components, which are this editor's scenes.
 *
 * Both dialogs render through `ThemeRootPortal`, so the document door reaches them through the
 * view that opened them.
 */

import type { AuthoringAdapter, CreatableKind, StructureProvider } from '@volter/editor-project/adapter';
import { Button, Menu, MenuItem, TextInput, ThemeRootPortal, themeVars, zIndex } from '@volter/editor-sdk/widgets';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { editorHost } from '@volter/editor-sdk/host';
import { listProjectComponents } from '@volter/editor-sdk/kit/api/assets';
import type { ProjectComponentEntry } from '@volter/editor-sdk/kit/asset-workflow/project-content';
import { dropAuthoringAsset } from '@volter/editor-sdk/kit/authoring/consumer-actions';

export interface AddNodeHereState {
  readonly x: number;
  readonly y: number;
  /** The press in the frame the adapter's rects answer in, already snapped. */
  readonly at: { readonly x: number; readonly y: number };
  readonly parentId: string | null;
  readonly structure: StructureProvider;
  readonly kinds: readonly CreatableKind[];
  readonly adapter: AuthoringAdapter;
}

/** Favorites and Recent, kept per checkout as Godot keeps them per project. */
const CREATE_HISTORY_SECTION = 'canvasCreateNode';
interface CreateHistory {
  readonly favorites: readonly string[];
  readonly recent: readonly string[];
}
function readHistory(): CreateHistory {
  return editorHost().projectLocalState.read<CreateHistory>(CREATE_HISTORY_SECTION) ?? { favorites: [], recent: [] };
}
function writeHistory(history: CreateHistory): void {
  editorHost().projectLocalState.write(CREATE_HISTORY_SECTION, history);
}

function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref, onClose]);
}

export function AddNodeHere({ state, onClose }: { state: AddNodeHereState; onClose: () => void }): ReactNode {
  const [step, setStep] = useState<'menu' | 'create' | 'instantiate'>('menu');
  if (step === 'create') return <CreateNodeDialog state={state} onClose={onClose} />;
  if (step === 'instantiate') return <InstantiateSceneDialog state={state} onClose={onClose} />;
  return <AddNodeHereMenu state={state} onClose={onClose} onPick={setStep} />;
}

function AddNodeHereMenu({
  state,
  onClose,
  onPick,
}: {
  state: AddNodeHereState;
  onClose: () => void;
  onPick: (step: 'create' | 'instantiate') => void;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  return (
    <ThemeRootPortal>
      <Menu
        ref={ref}
        aria-label="Add node here"
        data-testid="viewport-add-menu"
        style={{ position: 'fixed', left: state.x, top: state.y, minWidth: 190, zIndex: zIndex.dropdown }}
      >
        <MenuItem data-testid="viewport-add-menu-item" onSelect={() => onPick('create')}>
          Add 2D Node Here…
        </MenuItem>
        {state.adapter.assetDrop ? (
          <MenuItem data-testid="viewport-add-menu-item" onSelect={() => onPick('instantiate')}>
            Instantiate Scene Here…
          </MenuItem>
        ) : null}
      </Menu>
    </ThemeRootPortal>
  );
}

function DialogFrame({
  title,
  testId,
  onClose,
  children,
  footer,
}: {
  title: string;
  testId: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  return (
    <ThemeRootPortal>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: zIndex.dropdown,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0, 0, 0, .35)',
        }}
      >
        <div
          ref={ref}
          role="dialog"
          aria-label={title}
          data-testid={testId}
          style={{
            width: 640,
            maxWidth: '90vw',
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 12,
            borderRadius: 6,
            background: themeVars.surface.raised,
            color: themeVars.content.primary,
            boxShadow: '0 12px 40px rgba(0, 0, 0, .5)',
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 600 }}>{title}</div>
          {children}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>{footer}</div>
        </div>
      </div>
    </ThemeRootPortal>
  );
}

const muted = { color: themeVars.content.muted } as const;

function Row({
  selected,
  onPick,
  onOpen,
  testId,
  indent = 0,
  children,
}: {
  selected: boolean;
  onPick: () => void;
  onOpen: () => void;
  testId: string;
  indent?: number;
  children: ReactNode;
}): ReactNode {
  return (
    <div
      role="option"
      aria-selected={selected}
      data-testid={testId}
      onClick={onPick}
      onDoubleClick={onOpen}
      style={{
        padding: `2px 6px 2px ${6 + indent * 14}px`,
        borderRadius: 3,
        cursor: 'default',
        background: selected ? themeVars.accent.muted : 'transparent',
      }}
    >
      {children}
    </div>
  );
}

/** A kind's depth in the class tree its `extends` links draw. */
function depthOf(kind: CreatableKind, byKind: ReadonlyMap<string, CreatableKind>): number {
  let depth = 0;
  let parent = kind.extends ? byKind.get(kind.extends) : undefined;
  while (parent && depth < 16) {
    depth += 1;
    parent = parent.extends ? byKind.get(parent.extends) : undefined;
  }
  return depth;
}

/** The project's canvas components a drop can place: this editor's scenes, and the dialog's
 *  custom classes. `null` while the index is being read. */
function useCanvasComponents(enabled: boolean): {
  components: readonly ProjectComponentEntry[] | null;
  failure: string | null;
} {
  const [components, setComponents] = useState<readonly ProjectComponentEntry[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void listProjectComponents().then((listing) => {
      if (!live) return;
      if (!listing.ok) {
        setFailure(listing.reason);
        setComponents([]);
        return;
      }
      setComponents(
        listing.entries.filter((entry) => entry.surface === 'canvas' && entry.exported && entry.contentKind !== 'image'),
      );
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return { components, failure };
}

const componentKey = (entry: ProjectComponentEntry): string => `component:${entry.path}#${entry.name}`;

/** Place one project component at the press through the adapter's drop door. */
function placeComponent(state: AddNodeHereState, entry: ProjectComponentEntry): string | null {
  const drop = state.adapter.assetDrop;
  if (!drop) return 'This surface places no components.';
  const context = {
    position: [state.at.x, state.at.y, 0] as const,
    item: {
      kind: 'component' as const,
      name: entry.name,
      sourcePath: entry.path,
      exportKind: entry.defaultExport ? ('default' as const) : ('named' as const),
      surface: entry.surface,
    },
  };
  const target = state.parentId ?? '';
  if (!drop.accepts(target, entry.path, context)) return `${entry.name} cannot be placed here.`;
  void dropAuthoringAsset(state.adapter, target, entry.path, context);
  return null;
}

function CreateNodeDialog({ state, onClose }: { state: AddNodeHereState; onClose: () => void }): ReactNode {
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState<CreateHistory>(readHistory);
  // Godot's Matches › Filters: Show Built-in and Show Custom (a project's own classes, here its
  // canvas components); its Show Editor lists editor-only classes, which a Pixi project has none of.
  const [filters, setFilters] = useState({ builtIn: true, custom: true });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { components } = useCanvasComponents(Boolean(state.adapter.assetDrop));
  const root = state.kinds.find((kind) => !kind.extends);
  const custom: CreatableKind[] = (components ?? []).map((entry) => ({
    kind: componentKey(entry),
    label: entry.name,
    ...(root ? { extends: root.kind } : {}),
    description: `A project component, from ${entry.path}.`,
  }));
  const all = [...(filters.builtIn ? state.kinds : []), ...(filters.custom ? custom : [])];
  const byKind = useMemo(
    () => new Map([...state.kinds, ...custom].map((kind) => [kind.kind, kind])),
    // biome-ignore lint/correctness/useExhaustiveDependencies: `custom` is derived from `components`
    [state.kinds, components],
  );
  const matches = all.filter((kind) => kind.label.toLowerCase().includes(search.trim().toLowerCase()));
  const [selected, setSelected] = useState<string | null>(state.kinds[0]?.kind ?? null);
  const current = selected && matches.some((kind) => kind.kind === selected) ? selected : (matches[0]?.kind ?? null);
  const chosen = current ? byKind.get(current) : undefined;
  const create = (kind: string | null): void => {
    if (!kind) return;
    const entry = (components ?? []).find((candidate) => componentKey(candidate) === kind);
    if (entry) {
      const refused = placeComponent(state, entry);
      if (refused) {
        setFailure(refused);
        return;
      }
    } else {
      void state.structure.create(kind, state.parentId ?? undefined, state.at).ack;
    }
    writeHistory({ ...history, recent: [kind, ...history.recent.filter((entry) => entry !== kind)].slice(0, 10) });
    onClose();
  };
  const toggleFavorite = (): void => {
    if (!current) return;
    const favorites = history.favorites.includes(current)
      ? history.favorites.filter((entry) => entry !== current)
      : [...history.favorites, current];
    const next = { ...history, favorites };
    writeHistory(next);
    setHistory(next);
  };
  const listOf = (ids: readonly string[], testId: string) =>
    ids
      .map((id) => byKind.get(id))
      .filter((kind): kind is CreatableKind => kind !== undefined)
      .map((kind) => (
        <Row
          key={kind.kind}
          testId={testId}
          selected={kind.kind === current}
          onPick={() => setSelected(kind.kind)}
          onOpen={() => create(kind.kind)}
        >
          {kind.label}
        </Row>
      ));
  return (
    <DialogFrame
      // Godot titles the dialog after the class every match descends from ("Create New CanvasItem").
      title={`Create New ${root?.label ?? 'Node'}`}
      testId="canvas-create-node-dialog"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" data-testid="canvas-create-node-create" disabled={!current} onClick={() => create(current)}>
            Create
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 12, minHeight: 240 }}>
        <div style={{ width: 170, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={muted}>Favorites:</span>
          <div data-testid="canvas-create-node-favorites" style={{ flex: 1 }}>
            {listOf(history.favorites, 'canvas-create-node-favorite')}
          </div>
          <span style={muted}>Recent:</span>
          <div data-testid="canvas-create-node-recent" style={{ flex: 1 }}>
            {listOf(history.recent, 'canvas-create-node-recent-item')}
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={muted}>Search:</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <TextInput
              data-testid="canvas-create-node-search"
              value={search}
              autoFocus
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') create(current);
                // Up and Down walk the Matches from the search field, as Godot's do.
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const at = matches.findIndex((kind) => kind.kind === current);
                  const next = matches[Math.min(matches.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)))];
                  if (next) setSelected(next.kind);
                }
              }}
              style={{ flex: 1 }}
            />
            <Button
              type="button"
              variant="ghost"
              data-testid="canvas-create-node-favorite-toggle"
              aria-pressed={current ? history.favorites.includes(current) : false}
              title="(Un)favorite selected item."
              disabled={!current}
              onClick={toggleFavorite}
            >
              {current && history.favorites.includes(current) ? '★' : '☆'}
            </Button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={muted}>Matches:</span>
            <span style={{ flex: 1 }} />
            <Button
              type="button"
              variant="ghost"
              data-testid="canvas-create-node-filters"
              aria-haspopup="menu"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              Filters
            </Button>
          </div>
          {filtersOpen ? (
            <div role="menu" data-testid="canvas-create-node-filter-menu" style={{ display: 'flex', gap: 12 }}>
              {(
                [
                  ['builtIn', 'Show Built-in'],
                  ['custom', 'Show Custom'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} role="menuitemcheckbox" aria-checked={filters[key]} style={{ display: 'flex', gap: 4 }}>
                  <input
                    type="checkbox"
                    data-testid={`canvas-create-node-filter-${key}`}
                    checked={filters[key]}
                    onChange={() => setFilters({ ...filters, [key]: !filters[key] })}
                  />
                  {label}
                </label>
              ))}
            </div>
          ) : null}
          <div role="listbox" data-testid="canvas-create-node-matches" style={{ flex: 1, overflow: 'auto' }}>
            {matches.map((kind) => (
              <Row
                key={kind.kind}
                testId="canvas-create-node-match"
                indent={search.trim() === '' ? depthOf(kind, byKind) : 0}
                selected={kind.kind === current}
                onPick={() => setSelected(kind.kind)}
                onOpen={() => create(kind.kind)}
              >
                {kind.label}
              </Row>
            ))}
          </div>
          <span style={muted}>Description:</span>
          {failure ? (
            <span data-testid="canvas-create-node-failure" style={muted}>
              {failure}
            </span>
          ) : null}
          <div data-testid="canvas-create-node-description" style={{ minHeight: 36 }}>
            {chosen ? (
              <>
                <div>
                  {chosen.label}
                  {chosen.extends ? <span style={muted}>{` < ${byKind.get(chosen.extends)?.label ?? chosen.extends}`}</span> : null}
                </div>
                {chosen.description ? <div style={muted}>{chosen.description}</div> : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </DialogFrame>
  );
}

function InstantiateSceneDialog({ state, onClose }: { state: AddNodeHereState; onClose: () => void }): ReactNode {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const { components: scenes, failure: listFailure } = useCanvasComponents(true);
  const [placeFailure, setFailure] = useState<string | null>(null);
  const failure = placeFailure ?? listFailure;
  const keyOf = (entry: ProjectComponentEntry) => `${entry.path}#${entry.name}`;
  const matches = (scenes ?? []).filter((entry) =>
    `${entry.name} ${entry.path}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const current = matches.find((entry) => keyOf(entry) === selected) ?? matches[0] ?? null;
  const instantiate = (entry: ProjectComponentEntry | null): void => {
    if (!entry) return;
    const refused = placeComponent(state, entry);
    if (refused) {
      setFailure(refused);
      return;
    }
    onClose();
  };
  return (
    <DialogFrame
      title="Instantiate Scene"
      testId="canvas-instantiate-dialog"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" data-testid="canvas-instantiate-open" disabled={!current} onClick={() => instantiate(current)}>
            Instantiate
          </Button>
        </>
      }
    >
      <span style={muted}>Search:</span>
      <TextInput
        data-testid="canvas-instantiate-search"
        value={search}
        autoFocus
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') instantiate(current);
        }}
      />
      <div role="listbox" data-testid="canvas-instantiate-matches" style={{ minHeight: 160, overflow: 'auto' }}>
        {scenes === null ? <span style={muted}>Reading the project's components…</span> : null}
        {scenes !== null && matches.length === 0 ? <span style={muted}>No canvas component matches.</span> : null}
        {matches.map((entry) => (
          <Row
            key={keyOf(entry)}
            testId="canvas-instantiate-match"
            selected={current !== null && keyOf(entry) === keyOf(current)}
            onPick={() => setSelected(keyOf(entry))}
            onOpen={() => instantiate(entry)}
          >
            {entry.name} <span style={muted}>{entry.path}</span>
          </Row>
        ))}
      </div>
      {failure ? (
        <span data-testid="canvas-instantiate-failure" style={muted}>
          {failure}
        </span>
      ) : null}
    </DialogFrame>
  );
}
