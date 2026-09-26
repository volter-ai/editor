/**
 * read/godot-project.ts — the immutable project/resource decoder.
 *
 * The Godot lane's counterpart to `rbx-analyze`'s `readRojoProject`. It finds `project.godot`,
 * reads the four settings blocks that matter (`project-settings.ts`), walks the project tree for
 * every resource document, and parses those documents (`scene.ts`). Script meaning is supplied
 * exclusively by the separately captured official bound program.
 *
 * ## What it deliberately does not do
 *
 * - **It splices only decoded PackedScenes.** Text/binary documents and exact binary importer
 *   outputs are readable; source glTF model hosts, missing/opaque targets, placeholders and cycles
 *   remain loud instance boundaries. `[editable]` is an editor permission, not opacity: its
 *   serialized overrides compose over the readable base tree.
 * - **It does not open imported ASSETS** — with one exception, and the exception is the point.
 *   A `.png`/`.wav`/`.gdshader` reference is a per-item diagnostic (`res-path.ts`), never a guess,
 *   never fatal. A `<file>.import` beside one of them IS opened — it is text, in this same
 *   serialization, and it is where Godot recorded what its importer did (`import-sidecar.ts`).
 *   Godot's own binary RESOURCES (`.scn`/`.res`) are a different case and ARE opened: they hold
 *   first-party authored content (a Godot 4 project puts meshes, shapes and whole scenes there),
 *   and they decode to the same documents this loop builds from text — see `read/binary-format.ts`.
 *   A **`.glb` is a THIRD case and is also opened**, because it is not really an asset reference at
 *   all: instancing one mounts a node TREE, and a `.tscn` that instances a model overrides nodes
 *   inside it by path. Reading it is a glTF reader plus Godot's importer transform, which is
 *   `read/gltf-godot-scene.ts`; the result joins the `scenes` list like any other document, so
 *   nothing downstream learns that a third format exists.
 *
 * ## Failure policy
 *
 * A missing or unparseable `project.godot` THROWS — without it there is no project, and a caller
 * asked for one. Everything below that degrades to a diagnostic: a `.tscn` that will not parse
 * costs its own document and nothing else. Script diagnostics belong to the official frontend.
 */
import * as path from 'node:path';
import type { GodotProjectSnapshot } from '../snapshot/project-snapshot';
import type { GodotReadAuthority } from './authority';
import { GodotReadAuthorityResolver } from './authority';
import { readBinaryDocument } from './binary-document';
import { GodotBinaryParseError, parseGodotBinaryResource } from './binary-format';
import { GltfParseError } from './glb-container';
import { glbSceneDocument, readGlbAsGodotScene, readGltfAsGodotScene } from './gltf-godot-scene';
import type {
  Autoload,
  Diagnostic,
  GodotProject,
  InstancedParentOrigin,
  ProjectRuntimeRoot,
  ResourceDocument,
  RuntimeFileDependency,
  SceneDocument,
  SceneNode,
  UnplacedNode,
} from './godot-types';
import { walkSceneNodes } from './godot-types';
import type { ImportSidecar } from './import-sidecar';
import { readImportSidecar, readSceneImportParams } from './import-sidecar';
import { expandReadableSceneInstances } from './instance-expansion';
import { type GodotProjectFileSource, projectFileSourceFromSnapshot } from './project-file-source';
import { readProjectSettings } from './project-settings';
import { resolveProjectResourcePath, resourceKindOf, splitAutoloadTarget } from './res-path';
import { buildProjectResourceResolver } from './resource-path-resolver';
import type { DocumentContext } from './scene';
import { readResourceDocument, readSceneDocument } from './scene';
import type { GodotTextFile } from './text-format';
import { GodotParseError, parseGodotTextFile } from './text-format';
import { buildUidIndex, resolveResourceRef } from './uid-index';

export const PROJECT_FILE = 'project.godot';

export class GodotReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GodotReadError';
  }
}

/**
 * Godot 4.7's `ShaderPreprocessor::process_include` resolves quoted paths relative to the current
 * shader, then loads the `ShaderInclude` through ResourceLoader (shader_preprocessor.cpp:689-773).
 * Shader source remains opaque to the renderer translation; this small dependency reader records
 * only that source-proved file edge and does not pretend to parse shader semantics.
 */
function readShaderIncludes(
  source: GodotProjectFileSource,
  resPath: string,
  ctx: DocumentContext,
): {
  readonly dependencies: readonly RuntimeFileDependency[];
  readonly diagnostics: readonly Diagnostic[];
} {
  const from = resPath;
  const text = source.text(resPath);
  const rows: RuntimeFileDependency[] = [];
  const diagnostics: Diagnostic[] = [];
  const include = /^\s*#include\s+"([^"\r\n]+)"/gm;
  for (let match = include.exec(text); match !== null; match = include.exec(text)) {
    const raw = match[1] as string;
    const to = resolveProjectResourcePath(from, raw);
    const line = text.slice(0, match.index).split('\n').length;
    if (to === undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'shader-include-external',
        message: `shader include ${JSON.stringify(raw)} does not resolve inside this project`,
        at: `${from}:${String(line)}`,
      });
      continue;
    }
    if (!ctx.exists(to)) {
      diagnostics.push({
        severity: 'error',
        code: 'shader-include-missing',
        message: `shader include ${to} is not in the captured project tree`,
        at: `${from}:${String(line)}`,
      });
      continue;
    }
    rows.push({
      from,
      to,
      mechanism: 'shader-include',
      line,
    });
  }
  return { dependencies: rows, diagnostics };
}

/** JSON `.gltf` source with every external/data buffer normalized into one exact byte address space. */
function readExternalGltf(
  source: GodotProjectFileSource,
  resPath: string,
): { readonly json: unknown; readonly binary: Uint8Array } {
  let json: unknown;
  try {
    json = JSON.parse(source.text(resPath));
  } catch (error) {
    throw new GltfParseError(`${resPath}: invalid glTF JSON: ${String(error)}`);
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new GltfParseError(`${resPath}: glTF root is not an object`);
  }
  const root = json as Record<string, unknown>;
  const buffers = root['buffers'];
  if (buffers !== undefined && !Array.isArray(buffers)) {
    throw new GltfParseError(`${resPath}: buffers is not an array`);
  }
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let total = 0;
  for (const [index, buffer] of (buffers ?? []).entries()) {
    if (typeof buffer !== 'object' || buffer === null || Array.isArray(buffer)) {
      throw new GltfParseError(`${resPath}: buffers[${index}] is not an object`);
    }
    const uri = (buffer as Record<string, unknown>)['uri'];
    if (typeof uri !== 'string' || uri === '') {
      throw new GltfParseError(
        `${resPath}: buffers[${index}].uri must name an external file or base64 data buffer`,
      );
    }
    let bytes: Uint8Array;
    if (uri.startsWith('data:')) {
      const match =
        /^data:application\/(?:octet-stream|gltf-buffer)(?:;[^,]*)?;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(
          uri,
        );
      if (match === null) {
        throw new GltfParseError(`${resPath}: buffers[${index}].uri is not a base64 glTF buffer`);
      }
      bytes = Buffer.from(match[1] as string, 'base64');
    } else {
      if (/^[a-zA-Z][a-zA-Z+.-]*:/.test(uri)) {
        throw new GltfParseError(`${resPath}: buffers[${index}].uri uses external scheme ${uri}`);
      }
      let decodedUri: string;
      try {
        decodedUri = decodeURIComponent(uri);
      } catch {
        throw new GltfParseError(
          `${resPath}: buffers[${index}].uri is not valid percent-encoded text: ${uri}`,
        );
      }
      const relative = path.posix.normalize(
        path.posix.join(path.posix.dirname(resPath.slice(6)), decodedUri),
      );
      if (relative === '..' || relative.startsWith('../') || path.posix.isAbsolute(relative)) {
        throw new GltfParseError(
          `${resPath}: buffers[${index}].uri escapes the project root: ${uri}`,
        );
      }
      const bufferPath = `res://${relative}`;
      if (!source.has(bufferPath)) {
        throw new GltfParseError(`${resPath}: buffers[${index}].uri is missing: ${uri}`);
      }
      bytes = source.bytes(bufferPath);
    }
    offsets.push(total);
    chunks.push(bytes);
    total += bytes.byteLength;
  }
  const binary = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    binary.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  const views = Array.isArray(root['bufferViews'])
    ? root['bufferViews'].map((entry, index) => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          throw new GltfParseError(`${resPath}: bufferViews[${index}] is not an object`);
        }
        const view = entry as Record<string, unknown>;
        const source = typeof view['buffer'] === 'number' ? view['buffer'] : 0;
        const offset = offsets[source];
        if (offset === undefined)
          throw new GltfParseError(
            `${resPath}: bufferViews[${index}] names missing buffer ${source}`,
          );
        return {
          ...view,
          buffer: 0,
          byteOffset: offset + (typeof view['byteOffset'] === 'number' ? view['byteOffset'] : 0),
        };
      })
    : undefined;
  return {
    json: {
      ...root,
      buffers: [{ byteLength: total }],
      ...(views === undefined ? {} : { bufferViews: views }),
    },
    binary,
  };
}

function childAtPath(root: SceneNode, nodePath: string): SceneNode | undefined {
  if (nodePath === '.' || nodePath === '') return root;
  let at: SceneNode | undefined = root;
  for (const segment of nodePath.split('/')) {
    if (segment === '' || segment === '.') continue;
    at = at?.children.find((child) => child.name === segment);
    if (at === undefined) return undefined;
  }
  return at;
}

/**
 * Exact imported-node paths whose raw glTF names spell `nodePath`.
 *
 * Godot's importer may uniquify a node's runtime name when the synthesized scene root already owns
 * the raw name. An editable child path serialized at an instance destination can therefore retain
 * the glTF-side segment while the separately opened imported document records the uniquified Godot
 * segment. `GltfSceneOrigin.nameByPath` is the source-owned bridge between those spellings. This is
 * a path walk, not a name/suffix search: every segment must name a direct child, and duplicate raw
 * siblings remain multiple answers so the caller refuses them as ambiguous.
 */
function gltfSourcePathsAt(scene: SceneDocument, nodePath: string): readonly string[] {
  if (scene.root === undefined || scene.gltfOrigin === undefined) return [];
  const segments = nodePath.split('/').filter((segment) => segment !== '' && segment !== '.');
  let frontier: { readonly node: SceneNode; readonly path: string }[] = [
    { node: scene.root, path: '.' },
  ];
  for (const segment of segments) {
    const next: { readonly node: SceneNode; readonly path: string }[] = [];
    for (const parent of frontier) {
      for (const child of parent.node.children) {
        const childPath = parent.path === '.' ? child.name : `${parent.path}/${child.name}`;
        const rawName = scene.gltfOrigin.nameByPath.get(childPath);
        if (child.name === segment || rawName === segment)
          next.push({ node: child, path: childPath });
      }
    }
    if (next.length === 0) return [];
    frontier = next;
  }
  return [...new Set(frontier.map((candidate) => candidate.path))];
}

function unplacedAtPath(scene: SceneDocument, nodePath: string): UnplacedNode | undefined {
  const parts = nodePath.split('/').filter((part) => part !== '' && part !== '.');
  const name = parts.pop();
  if (name === undefined) return undefined;
  const parentPath = parts.length === 0 ? '.' : parts.join('/');
  return scene.unplacedNodes.find(
    (candidate) => candidate.name === name && candidate.parentPath === parentPath,
  );
}

type InstancedParentResolution =
  | { readonly kind: 'resolved'; readonly origin: InstancedParentOrigin }
  | { readonly kind: 'missing'; readonly reason: string }
  | { readonly kind: 'cycle'; readonly chain: readonly string[] }
  | {
      readonly kind: 'ambiguous';
      readonly origins: readonly InstancedParentOrigin[];
    };

/** Exact source identity at one opened scene path, including imported glTF node provenance. */
function instancedParentOrigin(scene: SceneDocument, nodePath: string): InstancedParentOrigin {
  const gltfNodeIndex = scene.gltfOrigin?.nodeIndexByPath.get(nodePath);
  const gltfName = scene.gltfOrigin?.nameByPath.get(nodePath);
  return {
    documentPath: scene.resPath,
    nodePath,
    ...(gltfNodeIndex === undefined ? {} : { gltfNodeIndex }),
    ...(gltfName === undefined ? {} : { gltfName }),
  };
}

/** Exact source owner of a node path after following only authored PackedScene instance edges. */
function resolveInheritedNodePath(
  scenes: ReadonlyMap<string, SceneDocument>,
  sceneResPath: string,
  nodePath: string,
  chain: readonly string[] = [],
  skipDirect = false,
): InstancedParentResolution {
  const visit = `${sceneResPath}#${nodePath}`;
  if (chain.includes(visit)) return { kind: 'cycle', chain: [...chain, visit] };
  const scene = scenes.get(sceneResPath);
  if (scene?.root === undefined) {
    return {
      kind: 'missing',
      reason: `${sceneResPath} is not an opened scene document`,
    };
  }
  if (!skipDirect && childAtPath(scene.root, nodePath) !== undefined) {
    return {
      kind: 'resolved',
      origin: instancedParentOrigin(scene, nodePath),
    };
  }
  const gltfSourcePaths = skipDirect ? [] : gltfSourcePathsAt(scene, nodePath);
  if (gltfSourcePaths.length === 1) {
    return {
      kind: 'resolved',
      origin: instancedParentOrigin(scene, gltfSourcePaths[0] as string),
    };
  }
  if (gltfSourcePaths.length > 1) {
    return {
      kind: 'ambiguous',
      origins: gltfSourcePaths.map((sourcePath) => instancedParentOrigin(scene, sourcePath)),
    };
  }

  const nextChain = [...chain, visit];
  const ownOverride = unplacedAtPath(scene, nodePath);
  if (ownOverride !== undefined) {
    // A class-bearing line or nested `instance=` line ADDS a node owned by this document. Its
    // placement can still be blocked on an inherited parent whose source document is absent, but
    // that does not make the added node's own identity ambiguous: a later authored child names
    // this exact outer-document node as its parent. Resolve that immediate ownership here and
    // leave the original added node's own parent diagnostic intact. Requiring the whole ancestor
    // chain first made one missing imported root cascade into a warning on every source-authored
    // descendant beneath it.
    if (ownOverride.type !== undefined || ownOverride.instanceOf !== undefined) {
      return {
        kind: 'resolved',
        origin: instancedParentOrigin(scene, nodePath),
      };
    }
    const parent = resolveInheritedNodePath(
      scenes,
      sceneResPath,
      ownOverride.parentPath,
      nextChain,
    );
    if (parent.kind !== 'resolved') return parent;
    // A typeless line OVERRIDES a child already owned by the instanced document. Returning this
    // outer document would fabricate a node absent from its tree, so follow the reconciled source
    // parent plus this exact authored child name instead.
    const inheritedChildPath =
      parent.origin.nodePath === '.' || parent.origin.nodePath === ''
        ? ownOverride.name
        : `${parent.origin.nodePath}/${ownOverride.name}`;
    return resolveInheritedNodePath(
      scenes,
      parent.origin.documentPath,
      inheritedChildPath,
      nextChain,
    );
  }

  const segments = nodePath.split('/').filter((segment) => segment !== '' && segment !== '.');
  for (let index = segments.length; index >= 0; index--) {
    const ancestorPath = index === 0 ? '.' : segments.slice(0, index).join('/');
    const ancestor = childAtPath(scene.root, ancestorPath) ?? unplacedAtPath(scene, ancestorPath);
    if (ancestor?.instanceOf === undefined) continue;
    if (
      'parentPath' in ancestor &&
      resolveInheritedNodePath(scenes, sceneResPath, ancestorPath, nextChain).kind !== 'resolved'
    ) {
      return {
        kind: 'missing',
        reason: `${sceneResPath}#${ancestorPath} is itself an unresolved instanced override`,
      };
    }
    const instanceOf = ancestor.instanceOf;
    const relativeSegments = segments.slice(index);
    const destinationRelativeSegments = [relativeSegments];
    if (index === 0 && relativeSegments[0] === scene.root.name) {
      destinationRelativeSegments.push(relativeSegments.slice(1));
    }
    const candidatePaths: string[] = [];
    const addCandidate = (parts: readonly string[]): void => {
      const candidate = parts.join('/') || '.';
      if (!candidatePaths.includes(candidate)) candidatePaths.push(candidate);
    };
    // PackedScene replaces the instanced document root with the destination instance node. Godot's
    // editable-child serialization nevertheless occurs in both exact source spellings across the
    // pinned projects: some parent paths begin at the imported root name (`Armature/Skeleton`,
    // `RootNode/Skeleton`), while others begin at its first child (`Skeleton`). The opened source
    // document proves which first segment is its root, so consuming THAT segment is an identity
    // normalization, not a suffix/name search. This also maps a root-only path (`Asteroids`) to
    // source `.` and works identically for an instance mounted below a named destination node.
    const sourceRootName = scenes.get(instanceOf)?.root?.name;
    for (const parts of destinationRelativeSegments) {
      addCandidate(parts);
      if (sourceRootName !== undefined && parts[0] === sourceRootName) {
        addCandidate(parts.slice(1));
      }
    }
    // Imported scenes may really author the outer-root-named branch, so exact source lookup wins.
    // Only then interpret that name as root-instance boundary syntax and consume it.
    const answers = candidatePaths.map((innerPath) =>
      resolveInheritedNodePath(scenes, instanceOf, innerPath, nextChain),
    );
    const origins = answers
      .filter(
        (answer): answer is Extract<InstancedParentResolution, { kind: 'resolved' }> =>
          answer.kind === 'resolved',
      )
      .map((answer) => answer.origin)
      .filter(
        (origin, originIndex, all) =>
          all.findIndex(
            (candidate) =>
              candidate.documentPath === origin.documentPath &&
              candidate.nodePath === origin.nodePath,
          ) === originIndex,
      );
    if (origins.length === 1)
      return { kind: 'resolved', origin: origins[0] as InstancedParentOrigin };
    if (origins.length > 1) return { kind: 'ambiguous', origins };
    const cycle = answers.find(
      (answer): answer is Extract<InstancedParentResolution, { kind: 'cycle' }> =>
        answer.kind === 'cycle',
    );
    if (cycle !== undefined) return cycle;
    const ambiguous = answers.find(
      (answer): answer is Extract<InstancedParentResolution, { kind: 'ambiguous' }> =>
        answer.kind === 'ambiguous',
    );
    if (ambiguous !== undefined) return ambiguous;
    return {
      kind: 'missing',
      reason:
        `${sceneResPath}#${ancestorPath} instances ${instanceOf}, but none of its exact ` +
        `source paths [${candidatePaths.join(', ')}] owns ${nodePath}`,
    };
  }
  return {
    kind: 'missing',
    reason: `${sceneResPath} authors no instancing ancestor for ${nodePath}`,
  };
}

/**
 * The per-document reader can identify an instanced parent only lexically because the referenced
 * document may be read later. Once the project owns every document, remove warnings whose exact
 * parent path resolves through source-authored instance ancestry and retain a blocker for every
 * path that still does not. No scene is spliced and no missing node is materialized.
 */
function reconcileInstancedParentDiagnostics(
  scenes: SceneDocument[],
  diagnostics: Diagnostic[],
): void {
  const byResPath = new Map(scenes.map((scene) => [scene.resPath, scene]));
  for (let index = diagnostics.length - 1; index >= 0; index--) {
    if (diagnostics[index]?.code === 'node-parent-instanced') diagnostics.splice(index, 1);
  }
  for (const scene of scenes) {
    const retainInheritedOrigins = (node: SceneNode): SceneNode => {
      const children = node.children.map(retainInheritedOrigins);
      if (node.type !== undefined) {
        return children.every((child, index) => child === node.children[index])
          ? node
          : { ...node, children };
      }
      // A placeholder is still a real PackedScene instance at runtime; only its descendants are
      // deliberately absent from the editor tree. Its omitted native class therefore comes from
      // the referenced root even though expansion must leave the placeholder edge intact.
      const inherited =
        node.instancePlaceholder === undefined
          ? resolveInheritedNodePath(byResPath, scene.resPath, node.path, [], true)
          : resolveInheritedNodePath(byResPath, node.instancePlaceholder, '.');
      return {
        ...node,
        children,
        ...(inherited.kind === 'resolved' ? { inheritedNode: inherited.origin } : {}),
      };
    };
    const reconciled: UnplacedNode[] = [];
    for (const node of scene.unplacedNodes) {
      if (node.instancedScene === undefined) {
        reconciled.push(node);
        continue;
      }
      const resolution = resolveInheritedNodePath(byResPath, scene.resPath, node.parentPath);
      if (resolution.kind === 'resolved') {
        const nodePath =
          node.parentPath === '.' || node.parentPath === ''
            ? node.name
            : `${node.parentPath}/${node.name}`;
        const inheritedNode =
          node.type === undefined && node.instanceOf === undefined
            ? resolveInheritedNodePath(byResPath, scene.resPath, nodePath)
            : undefined;
        reconciled.push({
          ...node,
          inheritedParent: resolution.origin,
          ...(inheritedNode?.kind === 'resolved' ? { inheritedNode: inheritedNode.origin } : {}),
        });
        continue;
      }
      reconciled.push(node);
      const nodePath =
        node.parentPath === '.' || node.parentPath === ''
          ? node.name
          : `${node.parentPath}/${node.name}`;
      diagnostics.push({
        severity: 'warning',
        code: 'node-parent-instanced',
        message:
          `node "${node.name}" declares parent "${node.parentPath}" below ${node.instancedScene}, ` +
          (resolution.kind === 'cycle'
            ? `but its captured scene-instance ancestry cycles through ${resolution.chain.join(' -> ')}`
            : resolution.kind === 'ambiguous'
              ? `but it resolves ambiguously to ${resolution.origins
                  .map((origin) => `${origin.documentPath}#${origin.nodePath}`)
                  .join(', ')}`
              : `but ${resolution.reason}`),
        at: `${scene.resPath}#${nodePath}`,
      });
    }
    const index = scenes.indexOf(scene);
    scenes[index] = {
      ...scene,
      ...(scene.root === undefined ? {} : { root: retainInheritedOrigins(scene.root) }),
      unplacedNodes: reconciled,
    };
  }
}

/**
 * A connection is serialized in the owning scene but either endpoint may live inside a
 * source-authored PackedScene/model instance. The document reader cannot know that referenced
 * tree yet, so it emits a provisional warning. Once every scene is open, resolve both endpoint
 * paths through the same exact ancestry graph used for node overrides; only a still-missing,
 * cyclic, or ambiguous endpoint remains a warning.
 */
function reconcileConnectionEndpointDiagnostics(
  scenes: readonly SceneDocument[],
  diagnostics: Diagnostic[],
): void {
  const byResPath = new Map(scenes.map((scene) => [scene.resPath, scene]));
  for (let index = diagnostics.length - 1; index >= 0; index--) {
    if (diagnostics[index]?.code === 'connection-endpoint-unresolved') diagnostics.splice(index, 1);
  }
  for (const scene of scenes) {
    for (const connection of scene.connections) {
      const from = resolveInheritedNodePath(byResPath, scene.resPath, connection.from);
      const to = resolveInheritedNodePath(byResPath, scene.resPath, connection.to);
      if (from.kind === 'resolved' && to.kind === 'resolved') continue;
      const describe = (endpoint: InstancedParentResolution): string =>
        endpoint.kind === 'resolved'
          ? `${endpoint.origin.documentPath}#${endpoint.origin.nodePath}`
          : endpoint.kind === 'cycle'
            ? `cycle ${endpoint.chain.join(' -> ')}`
            : endpoint.kind === 'ambiguous'
              ? `ambiguous ${endpoint.origins
                  .map((origin) => `${origin.documentPath}#${origin.nodePath}`)
                  .join(', ')}`
              : endpoint.reason;
      diagnostics.push({
        severity: 'warning',
        code: 'connection-endpoint-unresolved',
        message:
          `signal "${connection.signal}" wires ${connection.from} → ` +
          `${connection.to}.${connection.method}; exact source endpoint resolution is ` +
          `from=[${describe(from)}], to=[${describe(to)}]`,
        at: scene.resPath,
      });
    }
  }
}

export function readGodotProjectDocuments(
  source: GodotProjectFileSource,
  readAuthority: GodotReadAuthority,
): GodotProject {
  const authority = new GodotReadAuthorityResolver(readAuthority);
  const projectSettingsClaim = authority.require('project-settings');
  const textResourceClaim = authority.require('text-resource');
  const projectPath = `res://${PROJECT_FILE}`;
  if (!source.has(projectPath)) {
    throw new GodotReadError(
      `no ${PROJECT_FILE} in ${source.label} — a Godot project is defined by that file`,
    );
  }

  const settings = readProjectSettings(parseGodotTextFile(source.text(projectPath), projectPath));

  const diagnostics: Diagnostic[] = [];
  const projectFiles = [...source.resPaths].sort();
  const resourceResolver = buildProjectResourceResolver(source);
  const ctx: DocumentContext = {
    exists: (resPath) => source.has(resPath),
    resolveResource: resourceResolver.resolve,
  };

  const scenes: SceneDocument[] = [];
  const resources: ResourceDocument[] = [];
  const imports: ImportSidecar[] = [];
  const runtimeFileDependencies: RuntimeFileDependency[] = [];
  const templateDirectory = settings.scriptTemplatesSearchPath?.replace(/\/+$/, '');

  // Godot can run from a checked-in importer cache even when the original source asset is not in
  // the checkout. Open only cache outputs named by a real sidecar, and expose the decoded document
  // under the source's logical `res://` identity so scene instance references continue to join.
  for (const cached of resourceResolver.cachedDocuments) {
    try {
      const result = readBinaryDocument(
        parseGodotBinaryResource(source.bytes(cached.bytePath), cached.resPath),
        cached.resPath,
        ctx,
      );
      if (result.document.kind === 'scene') scenes.push(result.document.scene);
      else resources.push(result.document.resource);
      diagnostics.push(...result.diagnostics);
    } catch (error) {
      diagnostics.push({
        severity: 'error',
        code: 'document-parse-failed',
        message: error instanceof GodotBinaryParseError ? error.message : String(error),
        at: cached.resPath,
      });
    }
  }

  for (const resPath of projectFiles) {
    if (resPath === `res://${PROJECT_FILE}`) continue;
    // This file is our process adapter, copied temporarily into a project only so the pinned
    // Godot frontend can execute the native exporter. It is not project source (and its
    // GDScriptFrontendExporter type exists only in that custom exporter binary). A cancelled
    // capture may leave the dotfile behind; never turn that tool residue into a game's API row.
    if (resPath === 'res://.vgai-bound-capture.gd') continue;
    const ext = path.posix.extname(resPath).toLowerCase();
    if (
      ext === '.gd' &&
      templateDirectory !== undefined &&
      (resPath === templateDirectory || resPath.startsWith(`${templateDirectory}/`))
    ) {
      // Godot's editor expands `%BASE%` and the other template placeholders before the result is
      // ever parsed as GDScript. The project setting is exact ownership evidence that these bytes
      // are template input, not a script the player compiles.
      continue;
    }
    if (ext === '.gdshader' || ext === '.gdshaderinc') {
      const includes = readShaderIncludes(source, resPath, ctx);
      runtimeFileDependencies.push(...includes.dependencies);
      diagnostics.push(...includes.diagnostics);
    }
    if (ext === '.gd') {
      continue;
    }
    if (resourceKindOf(resPath) === 'binary') {
      // Godot's BINARY serialization of the same resources this loop reads as text. It produces
      // the same documents (`read/binary-document.ts`), so the lists below do not learn that a
      // second format exists — and a container it will not decode costs exactly this one
      // document, the same way an unparseable `.tscn` does.
      try {
        const result = readBinaryDocument(
          parseGodotBinaryResource(source.bytes(resPath), resPath),
          resPath,
          ctx,
        );
        if (result.document.kind === 'scene') scenes.push(result.document.scene);
        else resources.push(result.document.resource);
        diagnostics.push(...result.diagnostics);
      } catch (error) {
        diagnostics.push({
          severity: 'error',
          code: 'document-parse-failed',
          message: error instanceof GodotBinaryParseError ? error.message : String(error),
          at: resPath,
        });
      }
      continue;
    }
    if (resourceKindOf(resPath) === 'model') {
      // A `.glb` IS a scene in Godot — instancing one mounts the tree the importer built — so it
      // reads into the same `SceneDocument` list as a `.tscn`. Its `<file>.import` sidecar is a
      // REQUIRED input, not an optional one (`gltf/naming_version` alone renames every node), and
      // it is read here rather than taken from the `imports` list because that list is assembled by
      // this same loop in filename order, which puts `character.glb` before `character.glb.import`.
      const sidecarPath = `${resPath}.import`;
      if (!source.has(sidecarPath)) {
        diagnostics.push({
          severity: 'warning',
          code: 'model-not-imported',
          message:
            'no .import sidecar beside this model, so the project has never imported it and no ' +
            'node tree exists to read; Godot generates one on first open',
          at: resPath,
        });
        continue;
      }
      try {
        const params = readSceneImportParams(
          parseGodotTextFile(source.text(sidecarPath), `${resPath}.import`),
        );
        const engineMajor = settings.engine.major;
        if (engineMajor !== 3 && engineMajor !== 4) {
          throw new GltfParseError(
            `${resPath}: project.godot config_version does not identify whether the scene importer is Godot 3 or 4`,
          );
        }
        const imported =
          ext === '.gltf'
            ? (() => {
                const gltf = readExternalGltf(source, resPath);
                return readGltfAsGodotScene(gltf.json, gltf.binary, resPath, params, engineMajor);
              })()
            : readGlbAsGodotScene(source.bytes(resPath), resPath, params, engineMajor);
        scenes.push(glbSceneDocument(imported));
      } catch (error) {
        // One refused model costs exactly that document, like an unparseable `.tscn`: the
        // navigator goes back to saying the path is not a scene it opened, which is true again.
        diagnostics.push({
          severity: 'warning',
          code: 'model-read-refused',
          message: error instanceof GltfParseError ? error.message : String(error),
          at: resPath,
        });
      }
      continue;
    }
    if (
      ext !== '.tscn' &&
      ext !== '.escn' &&
      ext !== '.tres' &&
      ext !== '.gdns' &&
      ext !== '.import'
    )
      continue;

    let parsed: GodotTextFile;
    try {
      parsed = parseGodotTextFile(source.text(resPath), resPath);
    } catch (error) {
      diagnostics.push({
        severity: 'error',
        code: 'document-parse-failed',
        message: error instanceof GodotParseError ? error.message : String(error),
        at: resPath,
      });
      continue;
    }

    if (ext === '.import') {
      // A `<file>.import` is Godot's own record of how it imported the asset beside it — the same
      // text serialization, and the only place the project states that a `.glb`'s materials were
      // extracted to external `.tres` files. See `read/import-sidecar.ts`.
      imports.push(readImportSidecar(parsed));
    } else if (ext === '.tscn' || ext === '.escn') {
      const result = readSceneDocument(parsed, ctx);
      scenes.push(result.document);
      diagnostics.push(...result.diagnostics);
    } else {
      const result = readResourceDocument(parsed, ctx);
      resources.push(result.document);
      diagnostics.push(...result.diagnostics);
    }
  }

  // Resolve every source-ancestry fact while the documents still carry their authored `instance=`
  // boundaries. Expansion replaces an instance node with the referenced root and deliberately
  // removes `instanceOf`; reconciling afterwards therefore loses the only exact edge available to
  // a sibling override or connection whose destination remains outside the materialized tree.
  // The reconciled origins stay attached to surviving unplaced lines, while lines expansion can
  // place disappear normally with the rest of their temporary reader state.
  reconcileInstancedParentDiagnostics(scenes, diagnostics);
  reconcileConnectionEndpointDiagnostics(scenes, diagnostics);
  expandReadableSceneInstances(scenes, diagnostics);

  // NativeScript attachments are a resource-family fact; official GDScript attachment joins are
  // owned by analyze/ over this already-decoded scene graph.
  for (const scene of scenes) {
    if (scene.root === undefined) continue;
    const retainNativeScriptDiagnostic = (
      scriptPath: string | undefined,
      nodePath: string,
    ): void => {
      if (scriptPath === undefined || resourceKindOf(scriptPath) === 'script') return;
      diagnostics.push({
        severity: 'warning',
        code: 'script-not-gdscript',
        message: `node ${nodePath} attaches ${scriptPath}, which is not GDScript`,
        at: `${scene.resPath}#${nodePath}`,
      });
    };
    walkSceneNodes(scene.root, (node) => {
      retainNativeScriptDiagnostic(node.scriptPath, node.path);
    });
    for (const node of scene.unplacedNodes) {
      const nodePath =
        node.parentPath === '.' || node.parentPath === ''
          ? node.name
          : `${node.parentPath}/${node.name}`;
      retainNativeScriptDiagnostic(node.scriptPath, nodePath);
    }
  }

  // --- autoloads --------------------------------------------------------------------------------
  const autoloads: Autoload[] = settings.autoloadTargets.map(([name, raw]) => {
    const { singleton, resPath: authoredPath } = splitAutoloadTarget(raw);
    // Godot 4 project.godot may retain only `uid://...` here. Resolve it through the same exact,
    // ambiguity-refusing project resource index used by ExtResource before deciding the autoload
    // is missing; the canonical res:// identity is what later script/scene joins consume.
    const resolved = resourceResolver.resolve(authoredPath);
    if (!resolved.present) {
      diagnostics.push({
        severity: 'error',
        code: 'autoload-target-missing',
        message: `autoload "${name}" points at ${authoredPath}, which is not in the tree`,
        at: `res://${PROJECT_FILE}`,
      });
    }
    return {
      name,
      resPath: resolved.resPath,
      singleton,
      kind: resourceKindOf(resolved.resPath),
      present: resolved.present,
    };
  });
  // A `_global_script_classes` entry whose file is gone is a broken class registry, not a stale
  // comment — every `class_name` reference in every script resolves through it. This checks the
  // DECLARED registry, so it is empty (and this loop inert) on a Godot 4 project: a derived entry
  // came from a file this reader had just opened and cannot name a missing one.
  for (const declared of settings.globalClasses) {
    if (!ctx.exists(declared.resPath)) {
      diagnostics.push({
        severity: 'error',
        code: 'global-class-target-missing',
        message: `class_name "${declared.className}" is registered to ${declared.resPath}, which is not in the tree`,
        at: `res://${PROJECT_FILE}`,
      });
    }
  }

  // --- the entry point ---------------------------------------------------------------------------
  //
  // `run/main_scene` is written in EITHER of Godot's two reference spellings, and unlike an
  // `[ext_resource]` line it is a lone scalar with no path beside it — see `read/uid-index.ts`.
  // Resolving it here means everything downstream (`mainScene`, the boot set, the emitter's
  // `plan.models.has(...)`) keeps speaking `res://` and learns nothing about uids.
  const uidIndex = buildUidIndex(
    scenes,
    diagnostics,
    resources,
    imports,
    resourceResolver.uidPathCandidates,
  );
  const declaredMainScene = settings.mainScene;
  const mainScene =
    declaredMainScene === undefined ? undefined : resolveResourceRef(declaredMainScene, uidIndex);

  // Project settings can use a bare uid for ANY source-backed resource, not only the main scene.
  // `buildUidIndex` joins document headers, ext-resource path pairs, and checked-in import
  // sidecars without depending on Godot's ignored UID cache.
  const projectResourceUidIndex = uidIndex;
  const resolveDeclaredRuntimeRoot = (root: ProjectRuntimeRoot): ProjectRuntimeRoot | undefined => {
    const uidResolved = resolveResourceRef(root.resPath, projectResourceUidIndex) ?? root.resPath;
    const resolved = resourceResolver.resolve(uidResolved);
    if (!resolved.present) {
      diagnostics.push({
        severity: 'error',
        code: 'runtime-root-missing',
        message: `${root.mechanism} points at ${root.resPath}, which is not in the captured project tree`,
        at: `res://${PROJECT_FILE}`,
      });
      return undefined;
    }
    return { ...root, resPath: resolved.resPath };
  };
  const runtimeRoots = settings.runtimeRoots.flatMap((root) => {
    const resolved = resolveDeclaredRuntimeRoot(root);
    return resolved === undefined ? [] : [resolved];
  });

  const audioBusLayout =
    resolveResourceRef(settings.audioBusLayout, projectResourceUidIndex) ?? settings.audioBusLayout;
  const authoredAudioBusLayout =
    settings.authoredAudioBusLayout === undefined
      ? undefined
      : (resolveResourceRef(settings.authoredAudioBusLayout, projectResourceUidIndex) ??
        settings.authoredAudioBusLayout);

  const defaultAudioBusRoot = {
    mechanism: 'default-audio-bus-layout' as const,
    resPath: audioBusLayout,
  };
  const optionalRuntimeRoots: ProjectRuntimeRoot[] = [];
  if (settings.authoredAudioBusLayout !== undefined) {
    const resolved = resolveDeclaredRuntimeRoot(defaultAudioBusRoot);
    if (resolved !== undefined) optionalRuntimeRoots.push(resolved);
  } else {
    const resolved = resourceResolver.resolve(audioBusLayout);
    if (resolved.present) {
      optionalRuntimeRoots.push({ ...defaultAudioBusRoot, resPath: resolved.resPath });
    }
  }
  if (settings.openXrActionMap !== undefined) {
    const resolved = resolveDeclaredRuntimeRoot({
      mechanism: 'openxr-action-map',
      resPath: settings.openXrActionMap,
    });
    if (resolved !== undefined) optionalRuntimeRoots.push(resolved);
  }
  const nativeExtensions = projectFiles.filter((resPath) =>
    resPath.toLowerCase().endsWith('.gdextension'),
  );

  if (declaredMainScene === undefined) {
    diagnostics.push({
      severity: 'error',
      code: 'main-scene-undeclared',
      message: '[application] run/main_scene is not set — the project declares no entry point',
      at: `res://${PROJECT_FILE}`,
    });
  } else if (mainScene === undefined) {
    diagnostics.push({
      severity: 'error',
      code: 'main-scene-missing',
      message: `[application] run/main_scene is ${declaredMainScene}, a uid no scene in this project declares`,
      at: `res://${PROJECT_FILE}`,
    });
  } else if (!ctx.exists(mainScene)) {
    diagnostics.push({
      severity: 'error',
      code: 'main-scene-missing',
      message: `[application] run/main_scene is ${mainScene}, which is not in the tree`,
      at: `res://${PROJECT_FILE}`,
    });
  }

  return {
    projectDir: source.label,
    readEvidence: {
      claimIds: [projectSettingsClaim.claimId, textResourceClaim.claimId],
      registryDigest: authority.registryDigest,
    },
    sourceFiles: projectFiles,
    projectName: settings.projectName ?? source.fallbackProjectName ?? 'Imported Godot Project',
    engine: settings.engine,
    ...(mainScene === undefined ? {} : { mainScene }),
    mainLoopType: settings.mainLoopType,
    runtimeRoots: [...runtimeRoots, ...optionalRuntimeRoots],
    resourceUidPaths: [...projectResourceUidIndex].map(([uid, path]) => ({ uid, path })),
    ...(authoredAudioBusLayout === undefined ? {} : { authoredAudioBusLayout }),
    nativeExtensions,
    runtimeFileDependencies,
    ...(settings.window === undefined ? {} : { window: settings.window }),
    ...(settings.physicsFps === undefined ? {} : { physicsFps: settings.physicsFps }),
    ...(settings.physicsInterpolation === undefined
      ? {}
      : { physicsInterpolation: settings.physicsInterpolation }),
    gravity2D: settings.gravity2D,
    gravity3D: settings.gravity3D,
    damping3D: settings.damping3D,
    rendering: settings.rendering,
    resolvedSettings: settings.resolvedSettings,
    projectSettings: settings.projectSettings,
    authoredSettings: settings.authoredSettings,
    autoloads,
    inputActions: settings.inputActions,
    globalClasses: settings.globalClasses,
    scenes,
    resources,
    imports,
    diagnostics,
  };
}

/** Production reader: all bytes come from the verified content-addressed snapshot. */
export function readGodotProjectSnapshot(
  snapshot: GodotProjectSnapshot,
  authority: GodotReadAuthority,
): GodotProject {
  return readGodotProjectDocuments(projectFileSourceFromSnapshot(snapshot), authority);
}
