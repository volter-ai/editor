/**
 * THE EDITOR RUNTIME CONTEXT — the light half of what `EditorContext.tsx`
 * used to be: the `EditorRuntime` shape (store, stats, init promise,
 * session), the React context that carries it, `EditorRuntimeProvider`,
 * and every `use*` hook that reads it. Nothing here starts a lifecycle:
 * no project discovery, no command listener, no save wiring. That is the
 * point of the split — a connected component's only dependency on the
 * editor is this module (closure: the shell store, the history session and
 * two context helpers), so a bounded host (a document mounted alone,
 * Storybook, a component test) mounts the same components without the
 * application's whole boot graph. `EditorContext.tsx` keeps the
 * application-level `EditorProvider` that owns those lifecycles.
 *
 * Measured 2026-09-03 (`scripts/validate-editor-closure.mjs --rank`): the
 * bounded entry's closure was 505 files, 500 of them through
 * `EditorContext.tsx`'s lifecycle imports, and the web build put 6.5 MB of
 * the editor into that page for one Provider. This module is the cut.
 */

import { type InteractiveEditScope, InteractiveEditScopeContext } from '@volter/editor-sdk/widgets';
import { type ReactNode, Suspense, useContext, useMemo, useSyncExternalStore } from 'react';
import type { ShellStore } from './shell-store';
import type { EditorShellStore } from './editor-shell-store';
import { optionalThreeStateOf, threeStateOf } from './three-state';
import type { EditorSession } from './history/editor-session';
import type { HistoryCommandSnapshot, HistoryCommands } from './history/history-commands';
import type { HistoryService, HistorySnapshot } from './history/history-service';
import { createHmrStableReactContext } from './hmr-stable-react-context';

export interface EditorStats {
  fps: number;
  frameTime: number;
  drawCalls: number;
  triangles: number;
  cameraPosition: { x: number; y: number; z: number };
  cameraTarget: { x: number; y: number; z: number };
}

export interface EditorRuntime {
  store: ShellStore;
  stats: EditorStats;
  initPromise: Promise<void>;
  session: EditorSession;
}

const EditorContext = createHmrStableReactContext<EditorRuntime | null>(
  import.meta.hot?.data,
  'EditorContext',
  null,
);

/**
 * Provide an already-constructed editor runtime without starting project
 * discovery, filesystem initialization, command listeners, or global bridges.
 *
 * The application-level {@link EditorProvider} below owns those lifecycles.
 * Bounded production hosts (Storybook, component tests, embedded tools) use
 * this provider so they render the same connected components against explicit
 * dependencies instead of cloning the UI or accidentally booting a project.
 */
export function EditorRuntimeProvider({
  runtime,
  children,
}: {
  readonly runtime: EditorRuntime;
  readonly children: ReactNode;
}) {
  // The shell's interactive-edit scope is INERT by design: coalescing a drag
  // into one undo entry is each adapter's own business, done next to the
  // writes it owns, so nothing here needs to bracket them.
  const editScope = useMemo<InteractiveEditScope>(() => ({ begin: () => {}, end: () => {} }), []);

  return (
    <EditorContext.Provider value={runtime}>
      <InteractiveEditScopeContext.Provider value={editScope}>
        <Suspense>{children}</Suspense>
      </InteractiveEditScopeContext.Provider>
    </EditorContext.Provider>
  );
}

export function useEditorStore(): ShellStore {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditorStore must be used within <EditorProvider>');
  return ctx.store;
}

export function useEditorStats(): EditorStats {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditorStats must be used within <EditorProvider>');
  return ctx.stats;
}

export function useEditorInit(): Promise<void> {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditorInit must be used within <EditorProvider>');
  return ctx.initPromise;
}

export function useHistoryService(): HistoryService {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useHistoryService must be used within <EditorProvider>');
  return ctx.session.history;
}

/** History-aware panels may still be rendered in isolated component tests. */
export function useOptionalHistoryService(): HistoryService | null {
  return useContext(EditorContext)?.session.history ?? null;
}

/**
 * The shell store WHEN THERE IS A SHELL — `null` in a bounded host.
 *
 * Same contract as {@link useOptionalHistoryService}, and it exists for the
 * same reason: the surfaces `scripts/validate-editor-closure.mjs` pins are
 * exactly the ones a bounded host mounts with no `EditorProvider` above them
 * (`@volter/editor-blender`'s Model document mounts `ToolObject3DAuthoring` that way).
 * A stage asking what the WORKSPACE is showing must be able to hear "there is
 * no workspace" instead of throwing the host's own document off the screen.
 */
export function useOptionalEditorStore(): ShellStore | null {
  return useContext(EditorContext)?.store ?? null;
}

/** The shell's frame/camera readout WHEN THERE IS A SHELL — same contract as
 *  {@link useOptionalEditorStore}, for the stage host: the world root's stage
 *  writes this every frame and the shell's own readouts (`CameraInfo`,
 *  `StatsOverlay`) read it, while a bounded host has neither. */
export function useOptionalEditorStats(): EditorStats | null {
  return useContext(EditorContext)?.stats ?? null;
}

export function useHistoryCommands(): HistoryCommands {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useHistoryCommands must be used within <EditorProvider>');
  return ctx.session.historyCommands;
}

export function useHistoryCommandSnapshot(): HistoryCommandSnapshot {
  const history = useHistoryCommands();
  return useSyncExternalStore(history.subscribe, history.getSnapshot, history.getSnapshot);
}

export function useHistorySnapshot(): HistorySnapshot {
  const history = useHistoryService();
  return useSyncExternalStore(history.subscribe, history.getSnapshot, history.getSnapshot);
}

/** The session store's Three half (`threeStateOf`), for a component that reads the scene,
 *  object map, camera or viewport tools. */
export function useThreeEditorStore(): EditorShellStore {
  return threeStateOf(useEditorStore());
}

/** {@link useThreeEditorStore} outside a session answers `null`. */
export function useOptionalThreeEditorStore(): EditorShellStore | null {
  return optionalThreeStateOf(useOptionalEditorStore());
}
