/**
 * THE REALM — where this editor session's project modules come from, as ONE
 * value instead of a three-way branch repeated in every root resolver.
 *
 * ## The fork this closes
 *
 * `resolveDefaultThreeAdapter`, `resolveDefaultCanvasAdapter` and
 * `resolveReactAdapterRootComponent` each carried their OWN copy of the same
 * question, and the copies had already drifted. There is one dispatch now, and
 * it is {@link RealmServices.loadEntryModule}.
 *
 * ## ONE LOADING LANE, TWO RUNTIMES
 *
 * A project module is fetched ONE way — `/@fs/` through the session's own dev
 * server — because the session IS the editor's host. What varies is the
 * RUNTIME: whose copy of react/fiber/pixi/three the mount builds with, the
 * editor SHELL's or the PROJECT's own module graph.
 *
 *   dev      = fs × shell
 *   packaged = fs × project graph
 *
 * ## What is here, and what is deliberately NOT
 *
 * The RUNTIME axis is already single-owner per subject — `r3f-entry-runtime`,
 * `canvas-entry-runtime`, `react-mount-runtime`, `three-ingest-runtime` each
 * decide it once, for everyone, from `isPackagedRuntime()`. This module names
 * the ones root binding actually opens so a resolver asks the realm rather
 * than importing four doorways by hand; it does not re-implement them, and it
 * does not list the two STORY doorways (`story-dom-runtime`,
 * `story-three-preview-runtime`) — their consumers are story/preview surfaces,
 * not root binding, so a member here would have no caller.
 *
 * Ingest's served-bundle-vs-`/@fs/` choice is likewise NOT here: it is a
 * per-PROJECT property (how that one game was vendored), so two ingested games
 * open in the same realm can answer differently. It lives with the ingest code
 * (`ingest/resolve-three.ts`).
 *
 * ## Reject, never guess
 *
 * Construction AWAITS `isPackagedRuntime()`, so a probe that could not get an
 * answer REJECTS through this function to the mount site. Nothing here spends
 * "I don't know" as "dev" — see `packaged-runtime.ts`'s header for the
 * measured session-long mis-mount that latch caused.
 */

import {
  type EntrypointSelectionOverride,
  type ProjectMountEpoch,
  projectEntryImportUrl,
} from '@volter/editor-sdk/session/project-module-url';
import type { AdapterSurface } from '@volter/editor-project/adapter/adapter-surface';
import { resolveCanvasEntryAdapterForEditor } from './canvas-entry-runtime';
import { isPackagedRuntime } from '@volter/editor-sdk/kit/packaged-runtime';
import { type ReactRootMountRuntime, resolveReactRootMountRuntime } from './react-mount-runtime';
import {
  resolveThreeIngestRuntimeForEditor,
  type ThreeIngestRuntime,
} from './three-ingest-runtime';

/** Which of the two this session is in. Reported, never inferred twice. */
export type RealmId = 'dev' | 'packaged';

/**
 * The realm's services, bound to ONE project root and ONE mount epoch — a
 * realm value is "how THIS project's modules are reached in THIS mount
 * generation", which is why it is constructed per resolve rather than being a
 * module-level singleton.
 */
export interface RealmServices {
  readonly id: RealmId;
  /** The project this realm was constructed for. */
  readonly projectRoot: string;
  /** The mount generation every module url of this composition shares. */
  readonly epoch: ProjectMountEpoch;
  /**
   * Import one root's entry module.
   *
   * `rootId` and `surface` identify the root for the caller's own errors;
   * dispatch is the entry PATH. `selectionOverride` is the dev server's
   * entrypoint swap slot, rewritten at serve time.
   */
  loadEntryModule(
    entry: string,
    rootId: string,
    surface: AdapterSurface,
    selectionOverride?: EntrypointSelectionOverride | undefined,
  ): Promise<Record<string, unknown>>;
  /** The entry namespace this realm hands back is the module's WHOLE
   *  namespace — the honest input to `RootDeclaration.entry`'s `reach`
   *  discriminant, which kept a second value while a bundle-map lane
   *  existed. */
  readonly entryReach: 'full';
  /** The canvas doorway: turn a canvas entry namespace into its adapter. */
  readonly pixiRuntime: typeof resolveCanvasEntryAdapterForEditor;
  /** The react-world mount's own react/react-dom/WorldProvider. */
  readonly reactDomRuntime: () => Promise<ReactRootMountRuntime>;
  /** The three-ingest doorway: the namespace an ingested three game captures
   *  against. */
  readonly threeIngestRuntime: () => Promise<ThreeIngestRuntime>;
}

const SHARED_RUNTIMES = {
  pixiRuntime: resolveCanvasEntryAdapterForEditor,
  reactDomRuntime: resolveReactRootMountRuntime,
  threeIngestRuntime: resolveThreeIngestRuntimeForEditor,
} as const;

/**
 * dev AND packaged: `/@fs/` through the dev server, always with the mount
 * epoch's cache-buster (`projectEntryImportUrl` — never a bare url; a
 * byte-identical specifier is served out of the browser's module registry on
 * remount while its cache-busted siblings are re-transformed, leaving two live
 * copies of one module-level `let` and no error).
 */
function fsLoader(projectRoot: string, epoch: ProjectMountEpoch) {
  return async (
    entry: string,
    _rootId: string,
    _surface: AdapterSurface,
    selectionOverride?: EntrypointSelectionOverride | undefined,
  ): Promise<Record<string, unknown>> =>
    (await import(
      /* @vite-ignore */ projectEntryImportUrl(projectRoot, entry, epoch, selectionOverride)
    )) as Record<string, unknown>;
}

/**
 * Construct this session's realm for one project and one mount epoch.
 *
 * REJECTS rather than guessing when `isPackagedRuntime()` could not get an
 * answer — see this module's header.
 */
export async function activeRealmServices(
  projectRoot: string,
  epoch: ProjectMountEpoch,
): Promise<RealmServices> {
  // The LOADING axis is `/@fs/` either way; only the runtime doorways differ,
  // and each of those decides for itself from the same probe.
  const packaged = await isPackagedRuntime();
  return {
    id: packaged ? 'packaged' : 'dev',
    projectRoot,
    epoch,
    loadEntryModule: fsLoader(projectRoot, epoch),
    entryReach: 'full',
    ...SHARED_RUNTIMES,
  };
}
