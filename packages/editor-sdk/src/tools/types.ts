/**
 * Shared vocabulary for the operation registry (B1).
 */

/** The four namespaces every operation name must live under (§5.7). */
export const TOOL_NAMESPACES = ['project', 'editor', 'play', 'cinematic'] as const;
export type ToolNamespace = (typeof TOOL_NAMESPACES)[number];

/**
 * Which of the three hosts an operation executes on (§8 B1, the
 * review-hardened addition):
 *  - `node` — runs in the SDK's own Node process against files (or, for
 *    long-running jobs like `cinematic.render`, launches its own browser).
 *  - `editor-browser` — invoked through the existing
 *    `POST /__editor/command` SSE relay in
 *    `packages/editor/server/editor-server.ts`, which broadcasts to the
 *    connected browser editor and awaits its callback under a short timeout
 *    (~5s; 120s for `play`). The projection generates the relay stub.
 *  - `runtime-page` — invoked through the play/render harness in a launched
 *    runtime page.
 *
 * `cinematic.render` is pinned `node` and MUST NOT ride the editor relay's
 * short timeout — it is a long-running job (see `longRunning` on
 * `ToolDefinition`).
 */
export type ExecutionHost = 'node' | 'editor-browser' | 'runtime-page';

/** Which live contexts an operation needs before it can run. */
export interface ExecutionRequirements {
  /** Needs a project directory on disk (no editor process required). */
  project?: boolean;
  /** Needs an existing, connected editor session. */
  editor?: boolean;
  /** Needs a playable runtime (starts or targets one). */
  play?: boolean;
  /** Needs a controlled render runtime. */
  render?: boolean;
}

/** Coarse risk classification surfaced to permission-gated callers (agents, HTTP/MCP auth). */
export type PermissionRisk = 'read' | 'write' | 'destructive';

export interface PermissionMetadata {
  risk: PermissionRisk;
  /** Human summary of what this operation is permitted to touch or do. */
  summary: string;
}

/** One completed file handed to the host-managed generated-output boundary. */
export interface ProjectOutputFile {
  /** Project-relative destination. Slice 1 deliberately permits only public/**. */
  path: string;
  content: string | Uint8Array;
  mediaType?: string;
  role?: 'asset' | 'provenance' | 'other';
}

/** JSON-safe summary returned after an atomic generated-output transaction. */
export interface ProjectGeneratedOutputFile {
  path: string;
  bytes: number;
  mediaType?: string;
  role?: ProjectOutputFile['role'];
}

export interface ProjectGeneratedOutput {
  files: ProjectGeneratedOutputFile[];
  totalBytes: number;
  dryRun: boolean;
  /** Host-created logical record in .vgai/provenance.json; absent for dry runs. */
  provenanceOperationId?: string;
}

export interface ProjectProviderExecution {
  mode: 'mock' | 'direct' | 'managed';
  provider: string;
  operation?: string;
  model?: string;
  requestId?: string;
  taskId?: string;
  managedJobId?: string;
  /** Route-aware charge snapshot when this execution produced accepted output. */
  billing?: import('../generations.js').GenerationBilling;
}

/** Facts the operation host already owns and stamps onto every committed batch. */
export interface ProjectOutputProvenanceContext {
  operationName: string;
  operationSource?: string;
  /** Sanitized facts for a single provider execution. */
  execution?: ProjectProviderExecution;
  /** Ordered facts for a native multi-task pipeline that produced one output batch. */
  executions?: readonly ProjectProviderExecution[];
  /** WHICH editor session produced the bytes, for a `project.session.write`
   *  batch — the kind whose producer is a script an agent ran inside a live
   *  session rather than an operation that ran here. Shape and meaning:
   *  `project/provenance.ts`'s `ProjectProvenanceSessionSchema`, which is the
   *  validated form; this mirror exists because `types.ts` carries no zod. */
  session?: {
    id: string;
    port: number;
    revision: number;
    callId?: string;
  };
  /** Schema-validated, JSON-safe operation input. */
  input?: unknown;
  /** Project-relative paths of the project FILES these bytes were produced
   *  from — a session-written GLB names the `src/models/<name>.blend` it was
   *  exported from. Shape and meaning: `project/provenance.ts`'s `inputs`,
   *  which is the validated form; this mirror exists because `types.ts`
   *  carries no zod. It is what lets a reader drill DOWN by kind from a
   *  prefab's glTF to the model it came from. */
  inputs?: readonly string[];
}

/**
 * Host capability supplied only to Node-hosted project operations. Generator
 * implementations may stay ordinary native JS; their thin operation wrapper
 * calls this once it has a complete batch ready to commit.
 */
export interface ProjectOutputWriter {
  write(
    files: readonly ProjectOutputFile[],
    options?: { dryRun?: boolean },
  ): Promise<ProjectGeneratedOutput>;
}

/**
 * Runtime context passed to every operation's `impl`. Intentionally an open
 * record (`[key: string]: unknown`) — later units (B2-B8) will grow this with
 * concrete fields (editor session ids, play session handles, render job
 * state); B1 only needs the two seams its sample operations touch.
 */
export interface ToolContext {
  /** Absolute path to the target project's root, for `project`-context ops. */
  projectRoot?: string;
  /** Base URL of a connected editor session, for `editor`-context ops. */
  editorUrl?: string;
  /** Cooperative cancellation for long-running (`node`, `longRunning`) ops. */
  signal?: AbortSignal;
  /** Atomic writer for generated project assets (Node project operations). */
  projectOutputs?: ProjectOutputWriter;
  /** WHICH mounted instance a game-driving tool should address, when the
   *  editor has several live (multiplayer authoring). A tool that drives the
   *  game binds `game.instance(ctx.instance)` from it; omitted means the sole
   *  live instance. */
  instance?: string;
  /** The HOST's project-module loader (the editor server's Vite SSR loader,
   *  wrapped with dependency-change invalidation). A tool that imports the
   *  project's own source at run time — `project.bake.preview` importing
   *  `src/models/barrel.ts` — MUST load through this rather than a raw
   *  `import()`: Node's ESM cache never invalidates, so a raw import returned
   *  the FIRST version of a model for the life of the server and every later
   *  edit re-rendered byte-identical until `vgai restart` (measured on the
   *  blind modeling bench, 2026-09-05: three restarts in one barrel). Absent
   *  only when the tool runs outside an editor server. */
  loadProjectModule?: (absolutePath: string) => Promise<unknown>;
  [key: string]: unknown;
}
