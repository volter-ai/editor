export type ToolContributionPoint =
  | 'workspace.document'
  | 'selection.inspector'
  | 'asset.inspector'
  | 'generation.result'
  | 'workspace.utility'
  | 'workspace.analytics'
  | 'workspace.status';

/**
 * One contribution module, FOUND BY SCANNING — never listed anywhere.
 *
 * Nothing enumerates these. `src/tools/` in project source and `src/` in every
 * `vgai`-declaring dependency are walked for the naming convention
 * (`*.document.tsx`, `*.inspector.tsx`, `*.asset-inspector.tsx`,
 * `*.result.tsx`, `*.utility.tsx`, `*.analytics.tsx`), and the module itself declares everything
 * else: `point`, `title` (or `presentations`), and the `tool` it drives, by
 * name. Its id is derived from this path. A manifest cannot disagree with a
 * module it does not mention.
 */
export interface ProjectToolContribution {
  /** Project-relative or package-absolute browser module path. */
  entryPath: string;
  /** The dependency that declared it (`package.json#vgai.contributions`),
   *  absent for the project's own `src/contributions/` modules. */
  package?: string;
  /** The module's file, for a bundled package's entry (listed by specifier): what the
   *  page loads when its bundle carries no loader for it, as a checkout's bundle does
   *  not for a contribution added after it was built. */
  filePath?: string;
}

export interface ProjectToolErrorSummary {
  code: string;
  summary: string;
  dataSchema?: unknown;
}

export interface ProjectToolCatalogEntry {
  name: string;
  summary: string;
  description: string;
  sourcePath: string;
  inputSchema: unknown;
  resultSchema: unknown;
  errors: ProjectToolErrorSummary[];
  requires: Record<string, boolean | undefined>;
  host: 'node' | 'editor-browser' | 'runtime-page';
  mutates: boolean;
  supportsDryRun: boolean;
  longRunning: boolean;
  permission: { risk: 'read' | 'write' | 'destructive'; summary: string };
  generation?: { provider: string; role: 'submit' | 'poll' | 'cancel' | 'accept' };
}

export interface ProjectToolLoadError {
  sourcePath: string;
  message: string;
}

/**
 * What a host says when it cannot load the project's TypeScript at all.
 *
 * ONE owner for the sentence, because two realms reach this state through
 * different doors and both must say the same true thing rather than fall back
 * to a fabricated empty catalog:
 *
 *  - the NODE side (`packages/editor/server/project-tools.ts`) when a host
 *    builds the catalog with no `loadModule`; and
 *  - the PAGE side (`packages/editor/src/project-tools.ts`), whose fetch of
 *    `/__editor/project-tools` can be answered by an SPA FALLBACK — `200` and
 *    HTML — when no editor server is in front of the origin, so an unguarded
 *    fetch that merely checks `response.ok` reads a successful page load as a
 *    successful catalog, then dies in
 *    `res.json()`. The panel's empty state ("No project tools registered")
 *    is a FACT about the project; a host that cannot ask has not learned it.
 */
export const NO_PROJECT_MODULE_HOST_MESSAGE =
  'This editor host cannot RUN registered project tools (package.json#vgai.tools): callables ' +
  'execute on the Node side. Contribution panels still load from project source; to run the ' +
  'tools themselves, open the project in the Vite-backed dev or packaged editor.';

/** The catalog row that states {@link NO_PROJECT_MODULE_HOST_MESSAGE}. */
export function noProjectModuleHostError(): ProjectToolLoadError {
  return { sourcePath: 'package.json#vgai.tools', message: NO_PROJECT_MODULE_HOST_MESSAGE };
}

/**
 * Callables and contribution modules are SIBLINGS, not parent and child.
 *
 * They used to be nested — `tools[].contributions[]` — purely so the browser
 * loader had a tool to hand the component. A document is not owned by one
 * callable, and the nesting made project source structurally unable to present
 * a dependency-provided tool. The module names the tool it drives instead.
 */
export interface ProjectToolCatalog {
  tools: ProjectToolCatalogEntry[];
  contributions: ProjectToolContribution[];
  loadErrors: ProjectToolLoadError[];
  /** The contribution suffixes the serving host scans for
   *  (`TOOL_CONTRIBUTION_SUFFIXES`), so a page built from another revision can
   *  say which half is stale. */
  suffixes?: readonly string[];
}
