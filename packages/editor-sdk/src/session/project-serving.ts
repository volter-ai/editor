/**
 * THE PROJECT-SERVING DOOR — how an integration takes part in serving a project's own modules.
 *
 * A package the product composes may declare `package.json#vgai.serving`: a built Node module
 * (`.mjs`) whose `servingPlugins(services)` returns Vite plugins the session adds to the
 * project's module graph. The browser half of an integration stays `vgai.contributions`; this is
 * its server half, for what only a transform over the project's source can do (a JSX identity
 * stamp, an authoring route over the project's files). The kit names no integration: it reads the
 * declaration from the product's composed packages, exactly as it reads `vgai.contributions`.
 *
 * `services` are the kit's own server capabilities a serving module may use, so an integration
 * never imports kit internals.
 */

import type { ComponentContractAnalyzer } from '../source-analysis';
import type { R3fAuthoringDiagnostic, SourceDialectEvidence } from '../source-authoring';

/** The root surface a project module renders on, as the kit's region decision answers it. */
export interface ServedModuleSurface {
  /** The identity attribute a JSX element on this surface carries. */
  readonly attribute: 'data-oid' | 'userData-oid';
  /** The declared surface, when a region placed the file; absent when nothing did. */
  readonly surface?: 'three' | 'canvas' | 'dom';
  /** Report the decision's diagnostics (a file stamped against its declaration) once. */
  report(): void;
}

/** The collaboration record every source write is attributed and ordered through. */
export interface ServingCollaboration {
  /** The revision the next write must expect. */
  revision(): number;
  /** Refuse a write whose author expected an older revision of these resources. */
  assertSourceMutation(authorId: string, expectedRevision: number, resources: readonly string[]): void;
  /** Record a write; `null` when the bytes were already recorded. */
  recordSourceMutation(input: {
    authorId: string;
    source: 'editor';
    resources: readonly { path: string; sha: string | null }[];
  }): { revision: number } | null;
}

export interface ProjectServingServices {
  /** The editor estate a vendored game's writes are recorded against. */
  readonly engineRoot: string;
  /** The opened project's roots and the in-tree ingest roots: "is this the project's own code". */
  readonly projectRoots: () => ReadonlySet<string>;
  /** The project the session serves now; it can change after boot. */
  readonly currentProjectRoot: () => string | undefined;
  /** The region decision for `file`, over the served module graph. */
  surfaceOf(file: string, code: string, moduleGraph: unknown, projectRoot?: string): ServedModuleSurface;
  /** Bind the served graph an editor write invalidates (`configureServer`). */
  bindModuleGraph(moduleGraph: unknown, projectRoot: () => string): void;
  /** Write a project source file the way every editor write lands: a vendored file is recorded
   *  against its lock, and the modules it replaces are invalidated. Throws on a refusal. */
  writeSource(file: string, code: string): void;
  /** Settle a pending vendored write to `file` before it is read. */
  settleSource(file: string): void;
  /** The collaboration record for a project root. */
  collaboration(projectRoot: string): ServingCollaboration;
  /** Whether `error` is a collaboration conflict (a stale expected revision). */
  isCollaborationConflict(error: unknown): boolean;
}

/** What a `vgai.serving` module exports. */
export interface ProjectServingModule {
  servingPlugins(services: ProjectServingServices): readonly unknown[];
  /** What a module's own source says about its dialect: whether it imports a reconciler, and
   *  the intrinsic tags only one renderer draws. The kit's region decision reads it for a file
   *  no region places; with no module answering, a source proves nothing. */
  readonly sourceDialectEvidence?: (code: string) => SourceDialectEvidence;
  /** Authoring diagnostics for one project module the kit validates; `knownThreeSurface` is the
   *  region decision's answer for it. */
  readonly sourceDiagnostics?: (
    code: string,
    file: string,
    options: { knownThreeSurface: boolean },
  ) => readonly R3fAuthoringDiagnostic[];
  /** The component-contract analyzer the kit's Content index uses on the server
   *  (`@volter/editor-sdk/source-analysis`; the browser registers its own). */
  readonly componentContracts?: ComponentContractAnalyzer;
}

/** The plugin name a serving module gives the plugin that serves `/__ui-source/*`, so the kit
 *  can say whether this session serves source writes without naming who does. */
export const SOURCE_WRITE_ROUTES_PLUGIN = 'vgai-ui-oid';
