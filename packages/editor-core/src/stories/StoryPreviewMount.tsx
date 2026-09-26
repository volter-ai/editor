/**
 * Isolated story preview mount — C3 (spec §9 "A story may be opened in an
 * isolated editor preview"). Renders one composed story (`ComposedProjectStory`
 * from `compose-project-stories.ts`) into a SEPARATE `react-dom/client` root,
 * not a child of the editor's own React tree: the preview container div is
 * handed to its own `createRoot`, so a story's own React version/context/
 * error state can never leak into (or be affected by) the editor shell's
 * tree — the same isolation a Storybook iframe gives you, achieved here with
 * a dedicated root instead (this editor has no existing iframe-preview
 * pattern to reuse — see the module doc comment on `StoriesPanel.tsx`).
 *
 * Error handling (spec §9 "Errors identify the source module and story
 * export"): a story that throws while rendering is caught by
 * `StoryPreviewErrorBoundary` (mirrors `ToolHost.tsx`'s `ToolErrorBoundary`)
 * and reported with BOTH the module path and the story export name — one
 * throwing story never takes down the panel or another story's preview.
 *
 * Play functions (spec §9 "supported play functions mount... optional but
 * nice"): `runPlay` below calls the composed story's own `.play()` (Storybook
 * populates it via `composeStories` when the CSF export declares one) inside
 * the SAME error containment, so a throwing play function reports the same
 * module+export naming instead of crashing the preview. `play()` is called
 * with `{ canvasElement }` set to the isolated preview root's own container —
 * without it, Storybook's portable-story `play()` defaults `canvasElement` to
 * `document.body` (confirmed in `storybook/dist/preview-api/index.cjs`'s
 * `composeStory`: `g.canvasElement ??= globalThis?.document?.body`), which
 * would let a story's play() query/interact with the ENTIRE page instead of
 * just its own isolated preview.
 *
 * Loaders (spec §9 "loaders ... mount through Storybook portable-story
 * APIs"): a composed story only runs its `loaders` when `.load()` is
 * explicitly awaited before render. Confirmed directly in Storybook 9's own
 * `composeStory` (`storybook/dist/preview-api/index.cjs`): the render
 * function reads a module-closure variable (`x`) for `loaded` data, and that
 * variable is populated ONLY inside `load: async () => { ...; f.loaded =
 * await c.applyLoaders(f); ...; x = f; }` — i.e. `applyLoaders` (which runs
 * every `loaders` entry) never runs unless `.load()` itself runs first.
 * Rendering the composed component directly (no `.load()`) leaves `loaded`
 * as `{}`. `mountIsolatedStory` below is therefore async and awaits
 * `StoryComponent.load()` before calling `root.render(...)`.
 */

import { markGameCssScope } from '@volter/editor-sdk/session/game-css-scope';
import { themeVars } from '@volter/editor-sdk/widgets';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import type { ComposedStoryFn } from 'storybook/internal/types';
import { getCurrentProject } from '@volter/editor-sdk/kit/project-manager';
import { ensureScopedGameStyles } from '@volter/editor-sdk/kit/scoped-game-css';
import { resolveStoryDomRuntime } from '@volter/editor-sdk/kit/stories/story-dom-runtime';

interface StoryPreviewErrorBoundaryProps {
  modulePath: string;
  storyName: string;
  children: ReactNode;
}

interface StoryPreviewErrorBoundaryState {
  error: Error | null;
}

/** Crash containment for one mounted story — names both the source module
 *  AND the story export in the fallback UI and the console, per spec §9. */
export class StoryPreviewErrorBoundary extends Component<
  StoryPreviewErrorBoundaryProps,
  StoryPreviewErrorBoundaryState
> {
  override state: StoryPreviewErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): StoryPreviewErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // biome-ignore lint/suspicious/noConsole: deliberate, greppable — a crashed story preview must be diagnosable from the console (spec §9 "errors identify the source module and story export"), mirroring ToolHost.tsx's ToolErrorBoundary
    console.error(
      `[stories] ${this.props.modulePath} — story "${this.props.storyName}" crashed while rendering:`,
      error,
      info.componentStack,
    );
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div style={{ padding: 12, fontSize: 12, color: themeVars.semantic.danger, maxWidth: 640 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Story crashed: <code>{this.props.modulePath}</code> — export{' '}
            <code>{this.props.storyName}</code>
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.error)}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

/** One container's isolated root plus a generation counter — see
 *  `mountIsolatedStory` below for why the counter (not just the `Root`
 *  object's identity) is what a stale `unmount()` must check. `root` is
 *  `undefined` for the brief window between a mount call CLAIMING a
 *  generation (synchronously) and that same call's `await
 *  StoryComponent.load()` resolving — no `Root` exists yet for a container
 *  that has never been rendered into before (the very first mount), so the
 *  reservation itself can't supply one. */
interface ContainerMount {
  root: Root | undefined;
  generation: number;
}

// One isolated `react-dom/client` root per container, reused across repeated
// `mountIsolatedStory` calls (e.g. a story switch: `StoriesPanel.tsx`'s
// `StoryPreviewHost` effect re-fires for the SAME DOM node with a new
// `StoryComponent`). Calling `createRoot` twice on the SAME node is a hard
// react-dom warning ("already been passed to createRoot() before") — this
// map is the guard: a second `mountIsolatedStory` on the same container
// `.render()`s onto the EXISTING root instead of creating a new one, exactly
// react-dom's own documented fix for that warning.
const mountsByContainer = new WeakMap<HTMLElement, ContainerMount>();

/**
 * Mount one composed story into `container` via its OWN `createRoot` —
 * isolated from whatever React root `container` itself lives inside.
 * Returns an `unmount` the caller runs on cleanup (e.g. story switch or
 * panel close) — same lifecycle discipline every other editor mount point
 * (`ToolHost`) uses. Safe to
 * call again on the same `container` before a previous `unmount()` has
 * landed (see `mountsByContainer` above) — the isolated root is reused, and
 * `unmount()` (below) removes it from the container entirely rather than
 * merely clearing its content, so callers who intend a REAL teardown (panel
 * close) still get one.
 *
 * Async: awaits `StoryComponent.load()` (runs the story's `loaders`, per the
 * module doc comment above) BEFORE the first render. The generation counter
 * is claimed SYNCHRONOUSLY (before the `await`), exactly like the sync
 * version did — so a second `mountIsolatedStory` call on the same container
 * (e.g. the user switches stories again while this one's `.load()` is still
 * in flight) still bumps the generation immediately and makes it visible to
 * this in-flight call. After the await, this call re-reads the container's
 * CURRENT generation and bails out (never creates/renders a root, never
 * touches `mountsByContainer`) if it's no longer the current one — so a
 * stale `.load()` resolving late can never win a render race against a
 * newer story switch, even though nothing was mounted yet for it to
 * unmount.
 */
export async function mountIsolatedStory(
  container: HTMLElement,
  modulePath: string,
  storyName: string,
  StoryComponent: ComposedStoryFn,
  // W2 (story documents): optional per-mount prop overrides. Portable
  // stories are plain React components whose composed args are DEFAULTS —
  // Storybook's own documented portable-story contract lets a caller pass
  // partial props over them (`<Story label="…" />`). The story-document
  // Inspector's editable args and its action-logging spies ride this;
  // omitted (every pre-W2 caller) the render is byte-identical to before.
  overrideProps?: Record<string, unknown>,
): Promise<{ root: Root; unmount: () => void } | null> {
  const existing = mountsByContainer.get(container);
  // Bumped on EVERY mount, including a reuse of the same `Root` object (a
  // story switch) — this is the piece a same-root reuse needs that plain
  // `Root`-identity checking (an earlier version of this function) doesn't
  // give you: reusing the root means two DIFFERENT stories' mounts can share
  // the exact same `Root` instance, so a stale `unmount()` comparing
  // `Root`s would see "yes, that's still the registered root" and tear down
  // the NEWER story's render a moment after it landed. Comparing the
  // generation this specific `mountIsolatedStory` call captured against the
  // container's CURRENT generation instead correctly recognizes "a newer
  // mount has since claimed this container" even when the root itself
  // didn't change. Claimed HERE, synchronously, before the `load()` await
  // below — so a newer call arriving while this one awaits sees (and bumps
  // past) this generation immediately, rather than racing to claim the same
  // number once both awaits resolve.
  const generation = (existing?.generation ?? 0) + 1;
  mountsByContainer.set(container, { root: existing?.root, generation });

  // THE STORY'S OWN PAGE CSS, if its project has any. A story of a foreign
  // game's HUD component is a plain React component whose entire layout lives
  // in that game's page-level stylesheet — without it the card renders real
  // DOM with zero layout, which reads as wreckage rather than as a component.
  // This is the ONE seam every story surface passes through (the UI board's
  // cards, the story documents, `vgai screenshot <file>.stories.tsx`), so
  // marking the container here styles all of them; the sheet itself is
  // installed once per project, never per card (`scoped-game-css.ts`).
  // Deliberately awaited BEFORE the first render so a card never flashes
  // unstyled, and deliberately non-fatal: a project with no declared
  // stylesheet mounts exactly as it did before.
  markGameCssScope(container);
  const currentProject = getCurrentProject();
  if (currentProject) await ensureScopedGameStyles(currentProject.rootPath);

  // Loaders (spec §9): must run — and their `loaded` data become part of the
  // composed story's render-time context — before the story is ever
  // rendered. See the module doc comment for why this can't be skipped.
  await StoryComponent.load();

  // WHICH graph's react-dom mounts the story is the packaged-runtime seam
  // (`story-dom-runtime.ts`): the CSF component's hooks resolve against the
  // project's react, so the mounting `createRoot` must come from that same
  // graph or the render dies on "Invalid hook call". Resolved BEFORE the
  // generation re-check below, so the stale-call guard covers every await
  // this call performs. (The error-boundary wrapper stays this bundle's own
  // React deliberately: it is a class component — no hooks, no dispatcher —
  // and React elements are cross-instance by design via Symbol.for.)
  const { createRoot, flushSync } = await resolveStoryDomRuntime();

  // Re-check AFTER the await: if a newer `mountIsolatedStory` call (story
  // switch) has since claimed this container, its generation will have
  // moved past `generation` above — this stale call must not create a root
  // or render into a container a newer story already owns (or is about to).
  const afterLoad = mountsByContainer.get(container);
  if (!afterLoad || afterLoad.generation !== generation) return null;

  const root = existing?.root ?? createRoot(container);
  mountsByContainer.set(container, { root, generation });

  // A resolved mount is a COMMITTED mount. The UI/2D boards await this
  // function before announcing their document ready, and Doctor photographs
  // that document immediately afterward. Leaving `root.render()` on React's
  // scheduler produced a perfectly plausible empty board: its synchronous
  // frame chrome existed, but every authored story was still absent. Use the
  // `flushSync` from the SAME project-owned React graph as `createRoot` (the
  // ordinary React design-time entry mount has the identical contract in
  // `design-time-layers.ts`). This is not capture-specific waiting: every
  // caller now receives the honest lifecycle guarantee its return value
  // implies.
  flushSync(() => {
    root.render(
      <StoryPreviewErrorBoundary modulePath={modulePath} storyName={storyName}>
        {/* `ComposedStoryFn` is a callable React function component
            (Storybook's portable-story contract) — its own composed
            args/decorators are already baked in by `composeStories`;
            `overrideProps` (when given) override individual args per that same
            contract. */}
        <StoryComponent {...(overrideProps ?? {})} />
      </StoryPreviewErrorBoundary>,
    );
  });
  return {
    root,
    // Deferred to a microtask, deliberately NOT called synchronously:
    // `unmount` is returned as `StoryPreviewHost`'s effect cleanup, and
    // React runs an effect's cleanup SYNCHRONOUSLY as part of its own
    // render/commit pass whenever the OUTER tree unmounts (e.g. the whole
    // Stories panel closing). React tracks "is any root currently
    // rendering" as a single GLOBAL flag for the whole call stack
    // (`executionContext`, react-dom-client.development.js) — so calling
    // THIS (independent, inner) root's `.unmount()` synchronously from
    // inside that outer pass trips "Attempted to synchronously unmount a
    // root while React was already rendering" even though the inner root
    // itself has nothing in flight. Queuing the call for the next microtask
    // runs it once the outer commit has fully finished and cleared that
    // flag, which is the documented fix for exactly this nested-root
    // pattern (no functional delay — the isolated root is still torn down
    // effectively immediately).
    unmount: () => {
      queueMicrotask(() => {
        // Only the mount that's STILL the container's current generation
        // actually tears the root down — see the `generation` doc comment
        // above for why this can't just compare `Root` identity.
        const current = mountsByContainer.get(container);
        if (!current || current.generation !== generation || !current.root) return;
        mountsByContainer.delete(container);
        current.root.unmount();
      });
    },
  };
}

/**
 * Run a composed story's `.play()` if it declared one, inside the same
 * module+export-naming error containment as render crashes. Returns whether
 * a play function existed and ran ok — the caller (`StoriesPanel`) uses this
 * to show a "no play function" state distinctly from a failure.
 *
 * `canvasElement` is passed through to `.play({ canvasElement })` — the
 * composed story's own `play` accepts `Partial<StoryContext>` (confirmed in
 * `storybook/dist/types/index.d.ts`: `play?: (context?: Partial<StoryContext<...>>)
 * => Promise<void>`, and `StoryContext.canvasElement: TRenderer['canvasElement']`).
 * Without it, Storybook's `composeStory` defaults `canvasElement` to
 * `globalThis.document.body` (`storybook/dist/preview-api/index.cjs`:
 * `g.canvasElement ??= globalThis?.document?.body`), which would let a
 * story's play() query/interact with the WHOLE page instead of just its own
 * isolated preview root.
 */
export async function runStoryPlay(
  modulePath: string,
  storyName: string,
  StoryComponent: ComposedStoryFn,
  canvasElement: HTMLElement,
): Promise<{ ran: boolean; error?: string }> {
  if (typeof StoryComponent.play !== 'function') return { ran: false };
  try {
    await StoryComponent.play({ canvasElement });
    return { ran: true };
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    // biome-ignore lint/suspicious/noConsole: deliberate, greppable — a throwing play() must be diagnosable from the console, same naming discipline as a render crash
    console.error(`[stories] ${modulePath} — story "${storyName}"'s play() threw:`, err);
    return {
      ran: true,
      error: `[stories] ${modulePath} — story "${storyName}"'s play() failed: ${message}`,
    };
  }
}
