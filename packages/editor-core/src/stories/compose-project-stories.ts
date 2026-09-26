/**
 * Portable-story mounting — C3 (spec §9). Uses the REAL Storybook
 * portable-stories API (`composeStories`/`setProjectAnnotations` from
 * `@storybook/react`, confirmed against `node_modules/@storybook/react/dist/
 * index.d.ts`) so a dynamically-imported CSF module (`*.stories.tsx`/
 * `*.stories.ts`, found by `story-discovery.ts`) becomes a map of named,
 * fully-composed React components — args/decorators/play all applied by
 * Storybook itself, never re-implemented here. `loaders` are ALSO applied by
 * Storybook itself, but only once the caller awaits the composed story's own
 * `.load()` — Storybook's portable-story contract requires that explicit
 * call before render (the preview-api's
 * `composeStory`: loader data is populated inside `load()`, and the render
 * function only picks it up if `load()` already ran). `mountIsolatedStory`
 * (`StoryPreviewMount.tsx`) is the caller that does this, awaiting `.load()`
 * before its first render.
 *
 * `setProjectAnnotations` "should be run a single time" (its own doc
 * comment) — `ensureProjectAnnotations` below does that exactly once per
 * editor session, from the project's `.storybook/preview.ts(x)` if the
 * project has one, else an empty array (Storybook's own default). This is
 * the ONLY place project annotations are threaded; no VGAI-specific
 * override.
 *
 * No duplicate story format anywhere: `composeProjectStories` takes the
 * loaded module namespace as-is (whatever `story-discovery.ts`'s `load()`
 * returned from Vite's `/@fs/` dynamic import) and hands it straight to
 * `composeStories` — the CSF module on disk is read directly and is the only
 * story definition that ever exists.
 *
 * WHICH `@storybook/react` (and therefore which `react`) does the composing
 * is `story-dom-runtime.ts`'s question, not this module's: under the
 * packaged runtime the CSF module's own hooks resolve against the PROJECT's
 * react, so the compose/mount machinery must come from that same graph or
 * every story dies on "Invalid hook call" (see
 * `vite-plugin-module-doorways.ts`). That seam is why both entry points below
 * are async.
 */

import type { ComposedStoryFn } from 'storybook/internal/types';
import { resolveStoryDomRuntime } from '@volter/editor-sdk/kit/stories/story-dom-runtime';

let projectAnnotationsApplied: Promise<void> | null = null;

/**
 * Apply the project's `.storybook/preview` annotations to the portable-story
 * runtime exactly once per session (repeat calls are no-ops — `composeStories`
 * itself picks up whatever `setProjectAnnotations` last set, and re-calling
 * with a DIFFERENT project mid-session would be a footgun, not a feature. A
 * project switch reloads the whole editor page today, which resets this
 * module-level flag along with everything else).
 *
 * `previewAnnotations` is `undefined` when the project has no
 * `.storybook/preview.ts(x)` (this repo ships none — no `.storybook` folder
 * anywhere, confirmed by search) — Storybook's own documented default is an
 * empty project-annotations object, which `setProjectAnnotations([])`
 * already models via `composeStories`'s own `?? []` fallback.
 */
export function ensureProjectAnnotations(previewAnnotations?: unknown): Promise<void> {
  // The latch holds the IN-FLIGHT promise, not a boolean: a second caller
  // arriving while the first is still resolving the story runtime must wait
  // on the SAME application (compose-after-await ordering), not sail past a
  // `true` flag and compose before any annotations landed.
  projectAnnotationsApplied ??= resolveStoryDomRuntime().then((runtime) => {
    // biome-ignore lint/suspicious/noExplicitAny: `setProjectAnnotations` accepts the project's raw preview module namespace, whose shape is Storybook's own (NamedOrDefaultProjectAnnotations) — not something this editor declares.
    runtime.setProjectAnnotations((previewAnnotations ?? []) as any);
  });
  return projectAnnotationsApplied;
}

/** Test-only escape hatch: `ensureProjectAnnotations` is deliberately
 *  once-per-session: this resets that latch so each test file gets a clean
 *  slate rather than leaking a fixture's annotations into a later assertion. */
export function _resetProjectAnnotationsForTest(): void {
  projectAnnotationsApplied = null;
}

/** One successfully composed named story, ready for the preview UI to mount. */
export interface ComposedProjectStory {
  /** The CSF export name, e.g. `Primary`. */
  name: string;
  /** Storybook's stable composed id (title + export), when supplied. */
  id: string;
  /** Storybook's human-facing story name, falling back to the export name. */
  label: string;
  /** CSF meta title when explicitly authored (e.g. `Game/2048`). */
  title?: string;
  /** Name/display identity of CSF `meta.component`, when the module declared
   *  one. This is the ONLY join between a story and the component it renders —
   *  the asset browser matches a `three` prefab to its thumbnail story on it,
   *  and a React root matches its own entry component to its composed default
   *  preview (both via `story-registry.ts`'s `pickComponentPreviewStory`).
   *  Absent for a story whose meta names no component. */
  componentName?: string;
  /** Storybook's own composed CSF tags. The editor may use ordinary custom
   *  tags to project one project registry into distinct design boards; the
   *  story module remains the sole source of truth. */
  tags?: readonly string[];
  /** Fully-composed Storybook parameters. VGAI only reads the namespaced
   * `parameters.vgai` association; every other parameter remains Storybook's. */
  parameters: Record<string, unknown>;
  /** Storybook's fully-composed globals. Viewport selection is read from
   *  here exactly as the viewport addon reads it; no editor-side story
   *  metadata is introduced. */
  globals?: Record<string, unknown>;
  /** Whether this CSF meta/story explicitly authors `globals.viewport`.
   *  Storybook treats that as a locked viewport for the story. Project
   *  `initialGlobals` still chooses a default without disabling the toolbar. */
  viewportLocked?: boolean;
  /** Fully composed initial args. Kept as Storybook produced them so the
   * editor can render idiomatic Controls for an active story without
   * inventing a second fixture/state format. */
  args: Record<string, unknown>;
  /** The real Storybook portable-story component — args/decorators/loaders
   *  already applied; `.play` present when the original story declared one. */
  Component: ComposedStoryFn;
}

/** The result of composing one loaded CSF module. */
export type ComposeResult =
  | { ok: true; stories: ComposedProjectStory[] }
  | { ok: false; error: string };

/** The display/name identity of a React component — a function/class (its
 *  `displayName` or `.name`); anything else names nothing. Exported because
 *  BOTH sides of the story↔component join must compute the identity the same
 *  way: this file reads it off a CSF `meta.component`, and
 *  `design-time-layers.ts` reads it off a root entry's default export before
 *  asking `story-registry.ts`'s `getComponentPreviewStory` for that
 *  component's story. */
export function componentIdentityName(component: unknown): string | undefined {
  if (!component || (typeof component !== 'function' && typeof component !== 'object')) {
    return undefined;
  }
  const displayName = (component as Record<string, unknown>)['displayName'];
  if (typeof displayName === 'string') return displayName;
  return typeof component === 'function' && component.name ? component.name : undefined;
}

/**
 * Compose a dynamically-imported CSF module (`story-discovery.ts`'s
 * `load()` result) into its named, portable-story components via the real
 * `composeStories` (spec §9 "mount through Storybook portable-story APIs").
 *
 * Error handling (spec §9 "Errors identify the source module and story
 * export"): a module with no default export (no Meta — every CSF file needs
 * one), or a `composeStories` call that throws (e.g. a story referencing a
 * component that itself throws on import), surfaces an error naming
 * `modulePath`. A per-story failure is narrower still — `composeStories`
 * composes every export independently, so one bad story doesn't take the
 * rest of the module down; a story whose export isn't a valid CSF
 * annotation is simply not a function/object Storybook recognizes and is
 * skipped rather than crashing the whole module (mirrors `composeStories`'s
 * own `Store_CSFExports`-keyed-mapped-type contract, which already excludes
 * anything that isn't shaped like a story).
 */
export async function composeProjectStories(
  modulePath: string,
  mod: unknown,
): Promise<ComposeResult> {
  const record = (mod ?? {}) as Record<string, unknown>;
  if (record['default'] === null || typeof record['default'] !== 'object') {
    return {
      ok: false,
      error:
        `[stories] ${modulePath} has no default export — every CSF file exports ` +
        `\`export default { title, component, ... } satisfies Meta<...>\` ` +
        '(see the template example: src/ui/Button.stories.tsx). Skipped.',
    };
  }

  let composed: Record<string, unknown>;
  try {
    const runtime = await resolveStoryDomRuntime();
    // biome-ignore lint/suspicious/noExplicitAny: `composeStories` is generically typed over the module's own CSF export shape (Store_CSFExports<ReactRenderer, TModule>), which we can't name statically for an arbitrary dynamically-imported project module.
    composed = runtime.composeStories(record as any) as Record<string, unknown>;
  } catch (err) {
    return {
      ok: false,
      error: `[stories] ${modulePath} failed to compose — ${String(err instanceof Error ? err.message : err)}`,
    };
  }

  const meta = record['default'] as Record<string, unknown>;
  const title = typeof meta['title'] === 'string' ? meta['title'] : undefined;
  const componentName = componentIdentityName(meta['component']);
  const humanizeStoryName = (name: string): string =>
    name
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[-_]+/g, ' ')
      .trim();

  const stories: ComposedProjectStory[] = Object.entries(composed)
    .filter((entry): entry is [string, ComposedStoryFn] => typeof entry[1] === 'function')
    .map(([name, Component]) => {
      const portable = Component as unknown as Record<string, unknown>;
      const authoredStory = record[name];
      const authoredStoryRecord =
        authoredStory && typeof authoredStory === 'object'
          ? (authoredStory as Record<string, unknown>)
          : null;
      const metaGlobals =
        meta['globals'] && typeof meta['globals'] === 'object'
          ? (meta['globals'] as Record<string, unknown>)
          : null;
      const storyGlobals =
        authoredStoryRecord?.['globals'] && typeof authoredStoryRecord['globals'] === 'object'
          ? (authoredStoryRecord['globals'] as Record<string, unknown>)
          : null;
      const explicitLabel = authoredStoryRecord?.['name'];
      return {
        name,
        id: typeof portable['id'] === 'string' ? portable['id'] : name,
        label:
          typeof explicitLabel === 'string'
            ? explicitLabel
            : humanizeStoryName(
                typeof portable['storyName'] === 'string' ? portable['storyName'] : name,
              ),
        ...(title ? { title } : {}),
        ...(componentName ? { componentName } : {}),
        tags: Array.isArray(portable['tags'])
          ? portable['tags'].filter((tag): tag is string => typeof tag === 'string')
          : [],
        parameters:
          portable['parameters'] && typeof portable['parameters'] === 'object'
            ? (portable['parameters'] as Record<string, unknown>)
            : {},
        globals:
          portable['globals'] && typeof portable['globals'] === 'object'
            ? { ...(portable['globals'] as Record<string, unknown>) }
            : {},
        viewportLocked:
          Object.hasOwn(metaGlobals ?? {}, 'viewport') ||
          Object.hasOwn(storyGlobals ?? {}, 'viewport'),
        args:
          portable['args'] && typeof portable['args'] === 'object'
            ? { ...(portable['args'] as Record<string, unknown>) }
            : {},
        // Object.entries() loses the predicate's value refinement under the
        // root build tsconfig; the filter above is the runtime proof.
        Component: Component as ComposedStoryFn,
      };
    });

  if (stories.length === 0) {
    return {
      ok: false,
      error:
        `[stories] ${modulePath} exports no named stories — a CSF file needs at least one ` +
        'named export alongside the default Meta export (see src/ui/Button.stories.tsx). Skipped.',
    };
  }

  return { ok: true, stories };
}
