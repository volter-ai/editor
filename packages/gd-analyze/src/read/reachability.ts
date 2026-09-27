/**
 * Which decoded documents the running game can reach, and the ones it cannot.
 *
 * Godot loads a resource only when something asks for it: the main scene, an autoload, a project
 * setting (a theme, an environment, a bus layout, an icon), a `preload`/`load` a script spells, or
 * a dependency of something already loaded. A document nothing asks for is never loaded, so a
 * defect inside it (a dependency that was never committed) never reaches the player; the editor
 * sees it, the game does not. Such a document is not planned: it is recorded as UNPLANNED with its
 * reason, and its own reader diagnostics travel with that record instead of refusing the project.
 * A document that IS reachable keeps every diagnostic, so a reachable missing dependency still
 * refuses.
 *
 * The walk over-approximates reachability, never under-approximates it:
 *
 * - every `res://` or `uid://` string spelled anywhere in `project.godot`, in any project script or
 *   data file (`SPELLED_PATH_TEXT`: a level list in JSON is how a game names what it loads), or in
 *   an inline script of a reachable scene is a root, and it reaches every path it is a PREFIX of (a
 *   script that assembles `"res://levels/level" + str(n) + ".tscn"` reaches every level);
 * - a reachable document reaches each of its `[ext_resource]` targets;
 * - a reachable imported asset reaches the materials its `.import` sidecar extracted.
 *
 * What it cannot see: a path assembled from pieces none of which is spelled with a `res://` or
 * `uid://` prefix. Such a load reaches a document this walk calls unplanned.
 */
import type { Diagnostic, ResourceDocument, SceneDocument } from './godot-types';
import type { ImportSidecar } from './import-sidecar';

export interface UnplannedDocument {
  readonly resPath: string;
  /** Why the game never loads it, and the reader diagnostics it would otherwise have raised. */
  readonly reason: string;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ReachabilityInput {
  /** `project.godot`, every project script and data file (`SPELLED_PATH_TEXT`), as text. */
  readonly rootTexts: readonly string[];
  /** Already-resolved entry paths: main scene, autoloads, runtime roots. */
  readonly rootPaths: readonly string[];
  readonly scenes: readonly SceneDocument[];
  readonly resources: readonly ResourceDocument[];
  readonly imports: readonly ImportSidecar[];
  readonly uids: ReadonlyMap<string, string>;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ReachabilityResult {
  readonly scenes: readonly SceneDocument[];
  readonly resources: readonly ResourceDocument[];
  readonly diagnostics: readonly Diagnostic[];
  readonly unplanned: readonly UnplannedDocument[];
}

/** The project files whose text is searched for spelled paths: scripts and data files. */
export const SPELLED_PATH_TEXT: ReadonlySet<string> = new Set(['.godot', '.gd', '.json', '.cfg', '.ini', '.txt', '.csv', '.xml', '.yaml', '.yml']);

const SPELLED_PATH = /(?:res|uid):\/\/[^"'\s)\]]*/g;

function spelledPaths(text: string): string[] {
  return [...text.matchAll(SPELLED_PATH)].map((match) => match[0]);
}

/** The document a diagnostic's `at` names: `res://a/b.tscn`, `res://a/b.tscn:12`, `res://a#Node`. */
function documentOf(at: string): string | undefined {
  if (!at.startsWith('res://')) return undefined;
  const rest = at.slice('res://'.length);
  const end = rest.search(/[:#]/);
  return `res://${end === -1 ? rest : rest.slice(0, end)}`;
}

export function partitionReachableDocuments(input: ReachabilityInput): ReachabilityResult {
  const documents = new Map<string, SceneDocument | ResourceDocument>();
  for (const document of [...input.scenes, ...input.resources]) documents.set(document.resPath, document);
  const sidecarsBySource = new Map<string, ImportSidecar[]>();
  for (const sidecar of input.imports) {
    if (sidecar.sourceFile === undefined) continue;
    const rows = sidecarsBySource.get(sidecar.sourceFile) ?? [];
    rows.push(sidecar);
    sidecarsBySource.set(sidecar.sourceFile, rows);
  }

  const prefixes = new Set<string>();
  const reached = new Set<string>();
  const queue: string[] = [];
  const reach = (resPath: string): void => {
    const path = input.uids.get(resPath) ?? resPath;
    if (reached.has(path)) return;
    reached.add(path);
    queue.push(path);
  };
  const spell = (text: string): void => {
    for (const spelled of spelledPaths(text)) {
      const path = input.uids.get(spelled) ?? spelled;
      prefixes.add(path);
      reach(path);
    }
  };
  for (const text of input.rootTexts) spell(text);
  for (const path of input.rootPaths) reach(path);
  for (const path of documents.keys()) {
    for (const prefix of prefixes) if (path.startsWith(prefix)) reach(path);
  }
  while (queue.length > 0) {
    const path = queue.pop() as string;
    for (const sidecar of sidecarsBySource.get(path) ?? []) {
      for (const material of Object.values(sidecar.externalMaterials ?? {})) reach(material);
    }
    const document = documents.get(path);
    if (document === undefined) continue;
    for (const dependency of document.extResources) reach(dependency.resPath);
    if ('inlineScripts' in document) {
      for (const script of document.inlineScripts ?? []) {
        const before = prefixes.size;
        spell(script.text);
        if (prefixes.size === before) continue;
        for (const other of documents.keys()) {
          for (const prefix of prefixes) if (other.startsWith(prefix)) reach(other);
        }
      }
    }
  }

  const unreachable = new Set([...documents.keys()].filter((path) => !reached.has(path)));
  const kept: Diagnostic[] = [];
  const dropped = new Map<string, Diagnostic[]>();
  for (const diagnostic of input.diagnostics) {
    const owner = documentOf(diagnostic.at);
    if (owner === undefined || !unreachable.has(owner)) {
      kept.push(diagnostic);
      continue;
    }
    const rows = dropped.get(owner) ?? [];
    rows.push(diagnostic);
    dropped.set(owner, rows);
  }
  const unplanned = [...unreachable].sort().map((resPath) => {
    const diagnostics = dropped.get(resPath) ?? [];
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    return {
      resPath,
      reason:
        'nothing the game loads reaches it (main scene, autoloads, project settings, paths spelled in scripts and data files)' +
        errors.map((error) => `; ${error.message}`).join(''),
      diagnostics,
    };
  });
  return {
    scenes: input.scenes.filter((scene) => !unreachable.has(scene.resPath)),
    resources: input.resources.filter((resource) => !unreachable.has(resource.resPath)),
    diagnostics: kept,
    unplanned,
  };
}
