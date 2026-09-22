/**
 * The tool-contribution FILENAME CONVENTION — the one definition for every
 * program that asks "is this file a contribution module?": the dev server's
 * scanner and `src/`-watcher classifier (`server/server-utils.ts`,
 * `server/project-tools.ts`), and the page-side readers that must reach the
 * same verdict about the same files. Lives in `src/` and names no DOM so the
 * server TypeScript program can import it — the same split
 * `game-globals-prelude.ts` documents for the globals prelude.
 */

/**
 * The two editor-side folders of a project (ARCHITECTURE-CORE §The project
 * model): `src/contributions/` — what the project adds to the editor
 * (documents, inspectors, utilities, analytics, kinds, finders) — and
 * `src/tools/` — the tools a person or an agent invokes (`*.tool.ts`).
 * Neither is bundled at Play; both reload the editor, never the game.
 */
export const CONTRIBUTIONS_DIR = 'src/contributions';
export const TOOLS_DIR = 'src/tools';
export const EDITOR_LANE_DIRS = [CONTRIBUTIONS_DIR, TOOLS_DIR] as const;

/** Whether a project-relative (or absolute, `/`-normalized) path sits in the editor's lane. */
export function isEditorLanePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  return EDITOR_LANE_DIRS.some(
    (dir) => normalized.startsWith(`${dir}/`) || normalized.includes(`/${dir}/`),
  );
}

export const TOOL_CONTRIBUTION_SUFFIXES = [
  '.document',
  '.inspector',
  '.asset-inspector',
  '.result',
  '.utility',
  '.analytics',
  // A STATUS-BAR item (`workspace-status-registry.ts`): compact, passive,
  // registered under `tool:<id>` like a utility tab.
  '.status',
  // A configuration KIND contribution (ARCHITECTURE-CORE §The project model);
  // read by the hosts that load the manifest, never mounted as UI.
  '.kind',
  // A FINDER contribution — registered into the finder registry by the host
  // that resolves the document table (the browser), never mounted as UI.
  '.finder',
  // The LOOK points (`@volter/editor-sdk/looks`): a workspace layout, a keymap
  // and a style bundle are DATA — registered by the host, mounted by no UI
  // point. What makes "the Blender" a build is a package contributing these.
  '.layout',
  '.keymap',
  '.style',
  // A COMMAND table (`@volter/editor-sdk/commands`): session verbs a package
  // answers, registered with the host's relay; data, no UI.
  '.command',
  // The CHROME points (`@volter/editor-sdk/chrome`): palette actions and
  // application-menu items; data the host renders in its own chrome.
  '.action',
  '.menu',
  // A HEADER item: a component in the project header's transport cluster.
  '.header',
  // A SERVICE (`@volter/editor-sdk/services`): code a package runs while its
  // contributions are loaded — started after a pass, stopped before the next.
  '.service',
] as const;

const TOOL_CONTRIBUTION_EXTENSIONS = ['.tsx', '.jsx', '.ts'] as const;

export type ChromeContributionKind = 'action' | 'menu' | 'header';

/** Which chrome point a contribution file names, or null. */
export function chromeContributionKind(fileName: string): ChromeContributionKind | null {
  for (const kind of ['action', 'menu', 'header'] as const)
    if (TOOL_CONTRIBUTION_EXTENSIONS.some((extension) => fileName.endsWith(`.${kind}${extension}`)))
      return kind;
  return null;
}

export function isServiceContribution(fileName: string): boolean {
  return TOOL_CONTRIBUTION_EXTENSIONS.some((extension) =>
    fileName.endsWith(`.service${extension}`),
  );
}

export function isCommandContribution(fileName: string): boolean {
  return TOOL_CONTRIBUTION_EXTENSIONS.some((extension) =>
    fileName.endsWith(`.command${extension}`),
  );
}

export type LookContributionKind = 'layout' | 'keymap' | 'style';

/** Which look point a contribution file names, or null for a module of
 *  another kind. */
export function lookContributionKind(fileName: string): LookContributionKind | null {
  for (const kind of ['layout', 'keymap', 'style'] as const)
    if (TOOL_CONTRIBUTION_EXTENSIONS.some((extension) => fileName.endsWith(`.${kind}${extension}`)))
      return kind;
  return null;
}

/** A kind contribution: scanned with the rest, mounted by no UI point. */
/** A finder contribution: registered by the document-table host, mounted by no UI point. */
export function isFinderContribution(fileName: string): boolean {
  return TOOL_CONTRIBUTION_EXTENSIONS.some((extension) => fileName.endsWith(`.finder${extension}`));
}

export function isConfigurationKindContribution(fileName: string): boolean {
  return TOOL_CONTRIBUTION_EXTENSIONS.some((extension) => fileName.endsWith(`.kind${extension}`));
}

/** Whether one file name is a contribution module by the convention above. */
export function isToolContributionModule(fileName: string): boolean {
  return TOOL_CONTRIBUTION_EXTENSIONS.some((extension) =>
    TOOL_CONTRIBUTION_SUFFIXES.some((suffix) => fileName.endsWith(`${suffix}${extension}`)),
  );
}
