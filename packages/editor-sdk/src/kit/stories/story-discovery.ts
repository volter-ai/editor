/**
 * Story discovery — C3 (spec §9, "Add CSF Discovery and Portable Story
 * Mounting"). The story sibling of `tool-loader.ts`: conventional
 * `src/**\/*.stories.tsx` / `*.stories.ts` files of the open project are found
 * via the editor server's folder scan (`GET /__editor/story-files`,
 * `editor-server.ts`) — the SAME "discovery IS a live folder scan, never a
 * cached manifest" physics `tool-loader.ts`/ `DataPanel.tsx` already use.
 *
 * Deliberately paths-only, same reasoning as tool discovery: the CSF MODULE
 * itself is loaded client-side through Vite's `/@fs/` dynamic-import path
 * (`compose-project-stories.ts` calls `load()` below), so it arrives
 * transpiled with HMR and the editor never stores a duplicate story
 * definition anywhere — the CSF module on disk stays the single source of
 * truth (spec §9 C3 "Story source remains the CSF module").
 *
 * A HOST THAT DOES NOT SERVE `/__editor/story-files` is recognised by the
 * ANSWER's content type, never by `res.ok`: a host with an SPA fallback
 * answers any unmatched path `200` with HTML, so `res.ok` is TRUE and the only
 * failure is `res.json()` throwing into a `catch` that returned `undefined`.
 * Discovery then resolved to `[]`,
 * which the Stories panel renders as "this root has no portable CSF previews"
 * — a claim about the PROJECT, produced by a build that never read it.
 *
 * The browser (server-less) tier discovers and loads stories from STORAGE:
 * the scan is a `StorageBackend` walk for the same `*.stories.tsx?` shape the
 * server route matches, regions come from the project's own manifest/adapter
 * through the session's own route, and `load()` imports the CSF module the
 * way every project module loads.
 */

import type { ProjectRegionEntry } from '@volter/editor-sdk/kit/asset-workflow/project-source-index';
import { editorServerJson } from '@volter/editor-sdk/kit/editor-server-response';
import { setProjectStoryRegions } from '@volter/editor-sdk/kit/stories/project-story-regions';

/**
 * Why this session could not discover stories, or `null` when discovery
 * genuinely ran (in which case an empty list IS "no stories").
 *
 * Set by every path that returns early, so no caller has to tell "the project
 * has none" apart from "nobody looked" by inspecting an empty array.
 */
let _unavailable: string | null = null;

/** Why story discovery could not run this session, or `null` when it did.
 *  An empty module list with `null` here is a real "no stories" answer. */
export function storyDiscoveryUnavailable(): string | null {
  return _unavailable;
}

/** One discovered story module — path only; the module is loaded on demand. */
export interface DiscoveredStoryModule {
  /** Project-relative path, e.g. `src/ui/Button.stories.tsx`. */
  modulePath: string;
  /** Dynamically imports the CSF module via Vite's `/@fs/` path, cache-busted
   *  so a re-discover (or an explicit re-load) always gets fresh code — same
   *  contract as `tool-loader.ts`'s `refreshProjectTools`. Returns the raw
   *  module namespace (default export = Meta, named exports = stories). */
  load: () => Promise<unknown>;
}

/** Minimal shape `discoverProjectStories` needs from the open project — the
 *  same fields `getCurrentProject()` (`project-manager.ts`) already returns,
 *  kept as a narrow parameter so this module doesn't need to import the
 *  whole project-manager (and stays trivially testable with a fixture). */
export interface StoryDiscoveryProject {
  rootPath: string;
}

/** Shape of `/__editor/story-files` (editor-server.ts) — a live folder scan,
 *  never a cached manifest (D3), plus a server-truthed existence check for
 *  the project's optional `.storybook/preview.ts(x)`. */
interface StoryFilesPayload {
  files: Array<{ path: string }>;
  /** Project-relative path to whichever preview-config candidate exists on
   *  disk, or `null` when the project has no `.storybook/` folder at all
   *  (the common case — this repo's own template ships none). */
  previewModulePath?: string | null;
  /** Adapter + manifest regions the server already read — story medium is
   *  declared from these, never from a mount. Absent on older payloads. */
  regions?: ProjectRegionEntry[];
}

// No project param: the editor server is single-project (`projectRoot` is
// server-side session state — `/__editor/open-project`), so this GET is
// never parameterized by project, same as `/__editor/tool-files`/
// `/__editor/data-files`.
async function fetchStoryFilesPayload(): Promise<StoryFilesPayload | undefined> {
  try {
    const res = await fetch('/__editor/story-files');
    // Content type BEFORE parsing — see `editor-server-response.ts` for why
    // `res.ok` cannot tell a real scan apart from this origin's page fallback.
    const payload = await editorServerJson<StoryFilesPayload>(
      res,
      'Scanning this project for stories failed',
    );
    if (Array.isArray(payload.regions)) setProjectStoryRegions(payload.regions);
    return payload;
  } catch (error) {
    _unavailable = error instanceof Error ? error.message : String(error);
    return undefined;
  }
}

/**
 * Scan the open project for `*.stories.tsx` / `*.stories.ts` files (via the
 * editor server's `/__editor/story-files` route) and return one
 * `DiscoveredStoryModule` per file, each carrying a lazy `load()`.
 *
 * Never throws: a missing/unreachable route or no project open resolves to
 * `[]`, mirroring `refreshProjectTools`'s "keep the editor alive" discipline —
 * a broken discovery pass must not crash the Stories panel. Every early return
 * records {@link storyDiscoveryUnavailable} first, so an empty list is only
 * ever read as "this project has no stories" when discovery actually ran.
 */
export async function discoverProjectStories(
  project: StoryDiscoveryProject | null,
): Promise<DiscoveredStoryModule[]> {
  _unavailable = null;
  if (!project) return [];

  // Guard the REALM, not the response — the server-less tier scans storage
  // and bundles in-browser; the dev/packaged tier asks its server and loads
  // through `/@fs/`. Same split as `tool-loader.ts`'s contribution catalog.

  const payload = await fetchStoryFilesPayload();
  if (!payload) return [];

  return payload.files.map(({ path: modulePath }) => ({
    modulePath,
    load: () =>
      import(
        /* @vite-ignore */ `/@fs/${project.rootPath}/${modulePath}?t=${Date.now()}`
      ) as Promise<unknown>,
  }));
}

/**
 * Load the open project's `.storybook/preview.ts(x)` module namespace, if it
 * has one — the project-level annotations `setProjectAnnotations` applies
 * once per session (`compose-project-stories.ts`'s `ensureProjectAnnotations`,
 * called from `story-registry.ts`'s `refreshProjectStories`). Resolves to
 * `undefined` when the project has no `.storybook/` folder (this repo's own
 * template ships none — Storybook's own documented default project
 * annotations apply, same as running with no preview config at all) or when
 * the file fails to import for any other reason; never throws — a project
 * config error here must not block story discovery from working.
 *
 * Asks the server (`/__editor/story-files`'s `previewModulePath`) which
 * candidate, if any, actually exists on disk BEFORE importing anything — no
 * more blind `/@fs/` probing of a path that almost always isn't there. A
 * project with no `.storybook/` folder now costs zero network requests here
 * instead of one guaranteed-to-fail one (that failure was invisible to this
 * function's own try/catch, since a browser reports a failed `/@fs/` fetch
 * as a page-level network error regardless of how the JS that triggered it
 * handles the rejection — see `check-vgai-generated-project-p2p.ts`, which
 * caught this as a generated-project "browser error").
 */
export async function loadProjectPreviewAnnotations(
  project: StoryDiscoveryProject | null,
): Promise<unknown> {
  if (!project) return undefined;
  // Same realm split as `discoverProjectStories`. Deliberately does NOT touch
  // `_unavailable` — discovery owns that record, and this runs beside it.
  const payload = await fetchStoryFilesPayload();
  const modulePath = payload?.previewModulePath;
  if (!modulePath) return undefined;
  try {
    return await import(
      /* @vite-ignore */ `/@fs/${project.rootPath}/${modulePath}?t=${Date.now()}`
    );
  } catch {
    // Reported as present but failed to import for some other reason (a
    // genuine config error) — degrade the same way as "not present".
    return undefined;
  }
}
