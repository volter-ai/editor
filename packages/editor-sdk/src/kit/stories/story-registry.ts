/**
 * Story registry (C3, spec §9) — the story sibling of `tool-loader.ts`'s
 * registry half: ties `story-discovery.ts` (find modules) and
 * `compose-project-stories.ts` (portable-mount one loaded module) together
 * into a live, `useSyncExternalStore`-shaped list consumed by React design-time
 * world mounting and its document/story hierarchy.
 *
 * Same discipline as the tool registry: discovery is a live rescan (never a
 * cached manifest, D3), re-run on project open/change and on the server's
 * `story-files-changed` SSE broadcast (a new/removed `*.stories.tsx`).
 * Per-module failures (a module that fails to import, or fails to compose)
 * are collected alongside successes rather than dropped — the panel shows a
 * broken module's error inline, naming the module (spec §9 "errors identify
 * the source module"), instead of silently omitting it.
 */

import { sortStoriesV7 } from 'storybook/internal/preview-api';
import type { Addon_StorySortParameterV7, IndexEntry } from 'storybook/internal/types';
import { activeProjectKey } from '@volter/editor-sdk/kit/active-project';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import {
  describeModuleFetch,
  diagnoseModuleFetch,
  failedImportEntry,
} from '@volter/editor-sdk/kit/module-fetch-diagnosis';
import {
  recordStoryDiscoveryTiming,
  waitForFirstViewportFrame,
} from '@volter/editor-sdk/kit/viewport-activation-timings';
import {
  type ComposedProjectStory,
  composeProjectStories,
  ensureProjectAnnotations,
} from './compose-project-stories';
import { getProjectStoryRegions } from '@volter/editor-sdk/kit/stories/project-story-regions';
import { declaredStoryMedium } from '@volter/editor-sdk/kit/stories/story-declared-medium';
import { deriveStoryGroupPath, formatStoryGroupPath } from './story-grouping';

/** One composed portable CSF story of the open project, carrying the source
 * module it came from. A story belongs to the PROJECT, not to a root: the
 * design-time board is the project's component gallery, and which root a
 * story previews is DERIVED from the component its CSF meta renders
 * ({@link pickComponentPreviewStory}). No story args/decorators/loaders are
 * copied or reinterpreted. */
export interface ProjectPreviewStory extends ComposedProjectStory {
  readonly modulePath: string;
}

import { discoverProjectStories, loadProjectPreviewAnnotations } from './story-discovery';

/** One discovered module's outcome after load + compose. */
export type ProjectStoryModule =
  | { modulePath: string; ok: true; stories: ComposedProjectStory[] }
  | { modulePath: string; ok: false; error: string };

interface StoryDiscoveryProjectLike {
  rootPath: string;
}

let _modules: ProjectStoryModule[] = [];
let _ready = false;
let _refreshGeneration = 0;
let _registryProjectKey: string | null = null;
const _requestedModules = new Map<string, Promise<void>>();
const _listeners = new Set<() => void>();

function adoptRegistryProject(): void {
  const key = activeProjectKey();
  if (_registryProjectKey === key) return;
  _registryProjectKey = key;
  _refreshGeneration++;
  _requestedModules.clear();
  publish([], false);
}

/** Current story modules (stable reference between refreshes). */
export function getProjectStoryModules(): ProjectStoryModule[] {
  return _modules;
}

/** True only after the current project's discovery pass has published. An
 * empty ready registry is a real "no stories" answer; an empty unready one is
 * boot in flight and must never be graded as a missing component surface. */
export function projectStoriesReady(): boolean {
  return _ready;
}

/** Subscribe to story-registry changes. Returns an unsubscribe function. */
export function subscribeProjectStoryModules(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/**
 * Resolve once the registry is READY — which is not the same as awaiting your
 * own {@link refreshProjectStories}.
 *
 * A refresh that a LATER refresh supersedes returns EARLY, by design (a
 * second concurrent pass aborts the first), and it returns with `_modules`
 * still emptied by `_ready = false`. A caller that only awaited its own call
 * therefore reads an empty registry and cannot tell it from "this project has
 * no stories" — measured 2026-09-18 on a `full` scaffold, where the boot
 * document restore raced the discovery lifecycle's own pass and dropped the
 * open story document as a failed verification.
 *
 * Deliberately unbounded: every path that clears `_ready` is a refresh that
 * publishes ready again when it finishes, succeeded or failed, and the
 * workspace restore that calls this is itself time-boxed by the host
 * (`workspace-state-persistence.ts`'s `RESTORE_TIMEOUT_MS` bounds when
 * write-through installs, never the restore). A number here would be an
 * invented tolerance over a condition that already resolves itself.
 */
export function whenProjectStoriesReady(): Promise<void> {
  if (_ready) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = subscribeProjectStoryModules(() => {
      if (!_ready) return;
      stop();
      resolve();
    });
  });
}

function vgaiParameters(story: ComposedProjectStory): Record<string, unknown> | null {
  const value = story.parameters['vgai'];
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** Every composed story the project declares, in discovery/export order —
 * the whole membership of the React design-time board and of the hierarchy's
 * story documents. Deliberately unfiltered: the board is the project's
 * component gallery, so a story earns its place by existing, and only the
 * root's own default preview is derived from a component
 * ({@link getComponentPreviewStory}). */
export function getProjectPreviewStories(): ProjectPreviewStory[] {
  const out: ProjectPreviewStory[] = [];
  for (const module_ of _modules) {
    if (!module_.ok) continue;
    for (const story of module_.stories) {
      out.push({ ...story, modulePath: module_.modulePath });
    }
  }
  const storySort = out
    .map((story) => {
      const options = story.parameters['options'];
      return options && typeof options === 'object'
        ? (options as Record<string, unknown>)['storySort']
        : undefined;
    })
    .find((value) => value !== undefined) as Addon_StorySortParameterV7 | undefined;
  if (!storySort) return out;

  const byId = new Map(out.map((story) => [story.id, story]));
  const entries: IndexEntry[] = out.map((story) => ({
    type: 'story',
    subtype: 'story',
    id: story.id,
    name: story.label,
    title:
      story.title ?? formatStoryGroupPath(deriveStoryGroupPath({ modulePath: story.modulePath })),
    importPath: story.modulePath,
    tags: [...(story.tags ?? [])],
  }));
  return sortStoriesV7(entries, storySort, [...new Set(out.map((story) => story.modulePath))])
    .map((entry) => byId.get(entry.id))
    .filter((story): story is ProjectPreviewStory => story !== undefined);
}

/** Whether a CSF module declares this story as its component's default:
 *  `parameters.vgai.default === true` on the story itself, or a
 *  `vgai.defaultStory` naming it (a meta-level parameter, which Storybook
 *  composes down onto every story in the module). */
export function isDeclaredDefaultStory(story: ComposedProjectStory): boolean {
  const vgai = vgaiParameters(story);
  if (!vgai) return false;
  if (vgai['default'] === true) return true;
  return typeof vgai['defaultStory'] === 'string' && vgai['defaultStory'] === story.name;
}

/** The directory portion of a project-relative source path, normalized. */
function sourceDir(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(0, slash) : '';
}

/**
 * Choose the best composed story for one component, joined on
 * `meta.component`'s name (the registry's own `componentName`) — pure over a
 * module list so it is unit-testable without the live registry. This is THE
 * story↔component join: a `three` prefab's own declaration and
 * THUMBNAIL (mounted off-screen by `story-three-preview.ts`; no live instance
 * or referenced asset substitutes for it) and a React root's composed default
 * preview (`design-time-layers.ts`, joined against the root entry's
 * default-exported component) both go through it.
 *
 * `componentPath` (the component's own source file) disambiguates the known
 * weak spot of a name-only join: two files can export a same-named component,
 * so a story is PREFERRED when its module sits in the same source directory as
 * the component. Within the chosen set, a story the module declares as the
 * default ({@link isDeclaredDefaultStory}) wins; otherwise discovery order.
 */
export function pickComponentPreviewStory(
  modules: readonly ProjectStoryModule[],
  componentName: string,
  componentPath?: string,
): ProjectPreviewStory | null {
  const pool = componentPreviewStories(modules, componentName, componentPath);
  return pool.find(isDeclaredDefaultStory) ?? pool[0] ?? null;
}

/**
 * Every portable state declared for one component. The same source-directory
 * preference as {@link pickComponentPreviewStory} disambiguates equal export
 * names without hiding sibling stories from the component's Inspector.
 */
export function componentPreviewStories(
  modules: readonly ProjectStoryModule[],
  componentName: string,
  componentPath?: string,
): ProjectPreviewStory[] {
  const matches: ProjectPreviewStory[] = [];
  for (const module_ of modules) {
    if (!module_.ok) continue;
    for (const story of module_.stories) {
      if (story.componentName === componentName) {
        matches.push({ ...story, modulePath: module_.modulePath });
      }
    }
  }
  if (matches.length === 0) return [];
  const sameDir = componentPath
    ? matches.filter((story) => sourceDir(story.modulePath) === sourceDir(componentPath))
    : [];
  return sameDir.length > 0 ? sameDir : matches;
}

/** {@link pickComponentPreviewStory} over the LIVE registry — what the content
 *  gallery calls to find a prefab's thumbnail story, and what
 *  `design-time-layers.ts` calls to find a React root's composed default
 *  preview from the root entry's own component. */
export function getComponentPreviewStory(
  componentName: string,
  componentPath?: string,
): ProjectPreviewStory | null {
  return pickComponentPreviewStory(_modules, componentName, componentPath);
}

/** Live-registry form of {@link componentPreviewStories}. */
export function getComponentPreviewStories(
  componentName: string,
  componentPath?: string,
): ProjectPreviewStory[] {
  return componentPreviewStories(_modules, componentName, componentPath);
}

function publish(next: ProjectStoryModule[], ready: boolean): void {
  _modules = next;
  _ready = ready;
  for (const fn of _listeners) fn();
}

interface TimedStoryModule {
  readonly result: ProjectStoryModule;
  readonly loadMs: number;
  readonly composeMs: number;
}

async function loadStoryModule({
  modulePath,
  load,
}: {
  readonly modulePath: string;
  readonly load: () => Promise<unknown>;
}): Promise<TimedStoryModule> {
  const loadStartedAtMs = Date.now();
  let mod: unknown;
  try {
    mod = await load();
  } catch (err) {
    const entry = failedImportEntry(String(err instanceof Error ? err.message : err));
    if (entry) {
      void diagnoseModuleFetch(entry).then((diagnosis) =>
        editorConsole.error(`[stories] ${modulePath}: ${describeModuleFetch(diagnosis)}`, 'authoring'),
      );
    }
    return {
      result: {
        modulePath,
        ok: false,
        error: `[stories] failed to load ${modulePath} — ${String(err instanceof Error ? err.message : err)}`,
      },
      loadMs: Date.now() - loadStartedAtMs,
      composeMs: 0,
    };
  }
  const loadMs = Date.now() - loadStartedAtMs;
  const composeStartedAtMs = Date.now();
  const result = await composeProjectStories(modulePath, mod);
  return {
    result: result.ok
      ? { modulePath, ok: true, stories: result.stories }
      : { modulePath, ok: false, error: result.error },
    loadMs,
    composeMs: Date.now() - composeStartedAtMs,
  };
}

/** Open one explicit story without evaluating every other project example.
 * Full discovery still owns catalog completeness; this only publishes the
 * requested module into that same registry, without marking it complete. */
export function ensureProjectStoryModule(
  project: StoryDiscoveryProjectLike | null,
  modulePath: string,
): Promise<void> {
  adoptRegistryProject();
  const projectKey = activeProjectKey();
  const key = `${projectKey}\n${modulePath}`;
  const existing = _requestedModules.get(key);
  if (existing) return existing;
  const pending = loadRequestedStoryModule(project, projectKey, modulePath).finally(() => {
    if (_requestedModules.get(key) === pending) _requestedModules.delete(key);
  });
  _requestedModules.set(key, pending);
  return pending;
}

async function loadRequestedStoryModule(
  project: StoryDiscoveryProjectLike | null,
  projectKey: string,
  modulePath: string,
): Promise<void> {
  while (activeProjectKey() === projectKey) {
    // A published composition is immediately usable. The document subscribes
    // to subsequent source refreshes; opening never waits on unrelated modules.
    const prior = _modules.find((module_) => module_.modulePath === modulePath);
    if (prior?.ok) return;
    const generation = _refreshGeneration;
    const current = () => activeProjectKey() === projectKey && generation === _refreshGeneration;
    const annotations = await loadProjectPreviewAnnotations(project);
    if (!current()) continue;
    await ensureProjectAnnotations(annotations);
    if (!current()) continue;
    const discovered = await discoverProjectStories(project);
    if (!current()) continue;
    const requested = discovered.find((module_) => module_.modulePath === modulePath);
    if (!requested) throw new Error(`Story module not found: ${modulePath}`);
    const { result } = await loadStoryModule(requested);
    if (!current()) continue;
    // Full discovery can publish this module while its demanded load runs.
    // That publication owns the row; a slower request must not replace it.
    const published = _modules.find((module_) => module_.modulePath === modulePath);
    if (published && published !== prior) {
      if (!published.ok) throw new Error(published.error);
      return;
    }
    publish([..._modules.filter((module_) => module_.modulePath !== modulePath), result], _ready);
    if (!result.ok) throw new Error(result.error);
    return;
  }
  throw new Error(`Project changed while opening story: ${modulePath}`);
}

/** Let the first visible editor work finish before evaluating story modules
 * whose medium cannot be known from the project's declared regions. Those
 * modules commonly hold dense DOM kits; loading them eagerly made a 3D board
 * wait on code it cannot display. Storybook uses the same broad architecture:
 * index first, evaluate a story module only when its surface needs it. */
async function waitForStoryImportIdle(): Promise<void> {
  // `requestIdleCallback` only means the browser main thread is momentarily
  // idle; it fired while the first Scene was still driving ~1,000 Vite module
  // requests and pulled the data-grid story graph into that same
  // queue. Wait for an authored frame first. The timeout preserves recovery
  // for a genuinely broken viewport without making background stories part
  // of the ordinary startup path.
  await Promise.race([
    waitForFirstViewportFrame(),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  await new Promise<void>((resolve) => {
    const idle = globalThis.requestIdleCallback;
    if (typeof idle === 'function') {
      idle(() => resolve(), { timeout: 2_000 });
      return;
    }
    setTimeout(resolve, 0);
  });
}

/**
 * Re-run the whole discovery + load + compose pass. Never throws: a broken
 * module (import failure, or a `composeProjectStories` failure) becomes an
 * `{ ok: false, error }` entry naming the module, and every other module
 * still loads — the same "one bad file never takes the rest down" physics
 * `refreshProjectTools` uses.
 *
 * Applies the project's `.storybook/preview.ts(x)` annotations (if the
 * project has one — `loadProjectPreviewAnnotations`) via
 * `ensureProjectAnnotations` before composing anything, exactly once per
 * session. `explicitPreviewAnnotations` is a test/caller override — pass it
 * to skip the `/@fs/` discovery and thread a fixture's annotations directly.
 */
export async function refreshProjectStories(
  project: StoryDiscoveryProjectLike | null,
  explicitPreviewAnnotations?: unknown,
  options: {
    readonly deferUndeclared?: boolean;
    /**
     * The source paths a CONTENT write changed, when that is what triggered
     * this refresh. With it, a story module whose bundled closure holds none
     * of them keeps its published result instead of being re-evaluated, and
     * the modules that do reload go ONE AT A TIME with a frame between them:
     * re-bundling all ten of a project's story modules at once, on the main
     * thread, beside the world's own remount, is what held the editor at 7–12
     * FPS for seconds after every prefab drop (three human passes; profiled
     * 2026-09-03). Boot and explicit refreshes pass nothing and load in
     * parallel, as before.
     */
    readonly changedPaths?: ReadonlySet<string>;
  } = {},
): Promise<void> {
  adoptRegistryProject();
  const generation = ++_refreshGeneration;
  const projectKey = activeProjectKey();
  const current = () => generation === _refreshGeneration && projectKey === activeProjectKey();
  const loadAll = async (
    list: readonly { readonly modulePath: string; readonly load: () => Promise<unknown> }[],
  ): Promise<TimedStoryModule[]> => {
    if (!options.changedPaths) return Promise.all(list.map(loadStoryModule));
    // A write-driven refresh loads one module per frame instead: the reload
    // itself is a module-cache hit, but COMPOSING every story on one turn
    // beside the world's own remount is what held the editor at 7-12 FPS
    // after a prefab drop.
    const out: TimedStoryModule[] = [];
    for (const item of list) {
      out.push(await loadStoryModule(item));
      // Give the viewport a frame between modules.
      await new Promise((resolve) => setTimeout(resolve, 16));
      if (!current()) break;
    }
    return out;
  };
  _ready = false;
  for (const fn of _listeners) fn();
  const startedAtMs = Date.now();
  const previewStartedAtMs = Date.now();
  const previewAnnotations =
    explicitPreviewAnnotations ?? (await loadProjectPreviewAnnotations(project));
  if (!current()) return;
  const previewAnnotationsMs = Date.now() - previewStartedAtMs;
  const annotationsStartedAtMs = Date.now();
  await ensureProjectAnnotations(previewAnnotations);
  if (!current()) return;
  const runtimeAnnotationsMs = Date.now() - annotationsStartedAtMs;

  const scanStartedAtMs = Date.now();
  const discovered = await discoverProjectStories(project);
  if (!current()) return;
  const fileScanMs = Date.now() - scanStartedAtMs;
  // Module evaluation is independent; only STORY MOUNTING is serialized
  // (`story-mount-turn.ts`) because loaders may mutate shared preview state.
  // Loading every CSF module one after another made editor boot scale with the
  // SUM of Vite transforms and network round trips (measured at 16s for the
  // template and 23s for third-person). Preserve discovery order by mapping
  // `Promise.all` over the ordered input rather than pushing as jobs finish.
  const regions = getProjectStoryRegions();
  const deferred = options.deferUndeclared
    ? discovered.filter(
        ({ modulePath }) => declaredStoryMedium({ modulePath, regions }).via === 'undeclared',
      )
    : [];
  const deferredPaths = new Set(deferred.map(({ modulePath }) => modulePath));
  const immediate = discovered.filter(({ modulePath }) => !deferredPaths.has(modulePath));
  const modulesStartedAtMs = Date.now();
  const immediateLoaded = await loadAll(immediate);
  const moduleLoadAndComposeMs = Date.now() - modulesStartedAtMs;
  const immediateResults = immediateLoaded.map(({ result }) => result);
  if (!current()) return;

  // Publish the declared surfaces as soon as they are usable. The registry is
  // deliberately not "ready" until the background tail has also landed, so
  // acceptance/coverage cannot mistake a partial index for the final answer.
  const immediateByPath = new Map(
    [
      // A demanded story may already be open while the catalog evaluates its
      // immediate set. Keep that row (and other last-good deferred rows) until
      // their replacements arrive; a partial catalog must not remove them.
      ..._modules.filter(({ modulePath }) => deferredPaths.has(modulePath)),
      ...immediateResults,
    ].map((result) => [result.modulePath, result]),
  );
  publish(
    discovered
      .map(({ modulePath }) => immediateByPath.get(modulePath))
      .filter((result): result is ProjectStoryModule => result !== undefined),
    deferred.length === 0,
  );
  recordStoryDiscoveryTiming({
    ms: Date.now() - startedAtMs,
    completedAtMs: Date.now(),
    moduleCount: immediateResults.length,
    storyCount: immediateResults.reduce(
      (count, module_) => count + (module_.ok ? module_.stories.length : 0),
      0,
    ),
    previewAnnotationsMs,
    runtimeAnnotationsMs,
    fileScanMs,
    moduleLoadAndComposeMs,
    modules: immediateLoaded.map(({ result, loadMs, composeMs }) => ({
      modulePath: result.modulePath,
      loadMs,
      composeMs,
      ok: result.ok,
    })),
  });
  if (deferred.length === 0) return;

  await waitForStoryImportIdle();
  if (!current()) return;
  const deferredResults = (await loadAll(deferred)).map(({ result }) => result);
  if (!current()) return;
  const resultByPath = new Map(
    [...immediateResults, ...deferredResults].map((result) => [result.modulePath, result]),
  );
  const next = discovered
    .map(({ modulePath }) => resultByPath.get(modulePath))
    .filter((result): result is ProjectStoryModule => result !== undefined);
  publish(next, true);
}
