/**
 * read/scene.ts — a parsed `.tscn`/`.tres` document → the S0 model.
 *
 * The structural work is assembling a `[node]` LIST into a tree. Godot writes nodes flat, each
 * naming its parent by path (`parent="Sprites/Root/Body"`), root first, and every child after its
 * parent — so one forward pass with a path→node index is enough.
 *
 * The one genuinely interesting case is a node whose parent path this document does NOT author.
 * That happens when a scene overrides a node living inside a scene it INSTANCED
 * (`[node name="Arrow" parent="." instance=ExtResource( 6 )]`, then
 * `[node name="Tip" parent="Arrow/Body"]`). Such a node is not an error and not an orphan in
 * Godot's eyes — it patches a node that exists in the other document. Since this reader
 * cannot splice one scene into another until the project reader has opened every referenced
 * document, so it records the node in `unplacedNodes` with the parent path it asked for and emits
 * a provisional per-item diagnostic. The project-level instance expansion later consumes the
 * readable `.tscn` cases. Two codes, because the two situations are not equally benign:
 *
 *   `node-parent-instanced`  — an ancestor of the requested path IS an instancing node, so the
 *                              target lives in that instanced scene. Expected; a warning.
 *   `node-parent-unresolved` — nothing on the path explains it. A real hole; an error.
 *
 * Inventing placeholder nodes here would put names in the tree before their source document is
 * known. Recording them beside the tree keeps the per-file parse exact; project-level expansion
 * moves them only after an opened PackedScene proves the complete parent chain.
 */

import type {
  Diagnostic,
  ExtResourceRef,
  InlineScriptResource,
  ResourceDocument,
  SceneDocument,
  SceneNode,
  SignalConnection,
  SubResource,
  UnplacedNode,
} from './godot-types';
import type { GodotValue, ResourceId } from './godot-value';
import {
  asNonNegativeSafeInteger,
  asNumber,
  asString,
  resourceRefId,
  stringItems,
} from './godot-value';
import { type ResourceKind, resolveProjectResourcePath, resourceKindOf } from './res-path';
import type { GodotSection, GodotTextFile } from './text-format';

/** What the document reader needs from the filesystem — injected so the parser stays pure. */
export interface DocumentContext {
  readonly exists: (resPath: string) => boolean;
  /** Godot import-cache output → checked-in source asset, proved by that source's `.import`. */
  readonly importedSource?: (resPath: string) => string | undefined;
  /** Source/UID/import metadata resolution, built once from the complete project tree. */
  readonly resolveResource?: (
    resPath: string,
    uid?: string,
  ) => {
    readonly resPath: string;
    readonly present: boolean;
    /** Actual decoded backing format when importer metadata redirects a logical source path. */
    readonly kind?: ResourceKind;
  };
}

interface MutableNode {
  readonly name: string;
  readonly path: string;
  readonly type?: string;
  readonly instanceOf?: string;
  readonly instancePlaceholder?: string;
  readonly ownerPath?: string;
  readonly sourceOrder: number;
  readonly siblingIndex?: number;
  readonly scriptPath?: string;
  readonly groups: readonly string[];
  readonly nodePathProperties: readonly string[];
  readonly properties: Readonly<Record<string, GodotValue>>;
  readonly children: MutableNode[];
}

/**
 * The `id=` attribute of an `[ext_resource]`/`[sub_resource]` header, in either engine's spelling:
 * Godot 3's bare number (`id=4`) or Godot 4's quoted token (`id="1_ybvw5"`, and `id="13"` for the
 * ones that still look numeric). Anything else is not an id — that is the malformed case.
 */
function headerId(value: GodotValue | undefined): ResourceId | undefined {
  if (value?.kind === 'number' || value?.kind === 'string') return value.value;
  return undefined;
}

/**
 * One external reference classified, with the per-item diagnostic its classification earns.
 *
 * Extracted from `readExtResources` (this file, and it remains its only text-side caller) when
 * `binary-document.ts` arrived: a `.res`/`.scn` states the same three facts about a dependency —
 * declared type, `res://` path, is-it-there — through a table of strings instead of an
 * `[ext_resource]` line, and the ANSWER must not depend on which serialization asked. Keeping two
 * copies of this policy is how a project's binary half would start reporting a missing texture
 * differently from its text half.
 */
export function classifyExtResource(
  ref: {
    readonly id: ResourceId;
    readonly resPath: string;
    readonly type: string;
    readonly uid?: string;
  },
  ctx: DocumentContext,
  declaringResPath: string,
  at: string,
  diagnostics: Diagnostic[],
): ExtResourceRef {
  const projectPath = resolveProjectResourcePath(declaringResPath, ref.resPath);
  const lookupPath = projectPath ?? ref.resPath;
  const resolved = ctx.resolveResource?.(lookupPath, ref.uid);
  const sourcePath = resolved?.resPath ?? ctx.importedSource?.(lookupPath) ?? lookupPath;
  const kind = resolved?.kind ?? resourceKindOf(sourcePath);
  const present = resolved?.present ?? ctx.exists(sourcePath);
  if (!present) {
    diagnostics.push({
      severity: 'error',
      code: 'ext-resource-missing',
      message: `references ${sourcePath}, which is not in the captured project tree`,
      at,
    });
  } else if (kind === 'opaque') {
    // Opaque is about the FORMAT. Existing bytes remain a resolved asset input even though the
    // reader does not interpret them; missing opaque bytes are unresolved and were refused above.
    diagnostics.push({
      severity: 'warning',
      code: 'ext-resource-opaque',
      message: `references ${sourcePath} (declared ${ref.type === '' ? '?' : ref.type}), a format this reader does not open`,
      at,
    });
  }
  return {
    id: ref.id,
    resPath: sourcePath,
    ...(ref.uid === undefined ? {} : { uid: ref.uid }),
    type: ref.type,
    kind,
    present,
  };
}

function readExtResources(
  file: GodotTextFile,
  ctx: DocumentContext,
  diagnostics: Diagnostic[],
): ExtResourceRef[] {
  return file.sections
    .filter((s) => s.kind === 'ext_resource')
    .flatMap((s) => {
      const id = headerId(s.attributes['id']);
      const resPath = asString(s.attributes['path']);
      const uid = asString(s.attributes['uid']);
      if (id === undefined || resPath === undefined) {
        diagnostics.push({
          severity: 'error',
          code: 'ext-resource-malformed',
          message: 'an [ext_resource] line declares no id and/or no path',
          at: `${file.resPath}:${s.line}`,
        });
        return [];
      }
      return [
        classifyExtResource(
          {
            id,
            resPath,
            type: asString(s.attributes['type']) ?? '',
            ...(uid === undefined ? {} : { uid }),
          },
          ctx,
          file.resPath,
          `${file.resPath}:${s.line}`,
          diagnostics,
        ),
      ];
    });
}

function readSubResources(file: GodotTextFile): SubResource[] {
  return file.sections
    .filter((s) => s.kind === 'sub_resource')
    .flatMap((s) => {
      const id = headerId(s.attributes['id']);
      if (id === undefined) return [];
      return [{ id, type: asString(s.attributes['type']) ?? '', properties: s.properties }];
    });
}

function inlineScriptPath(scenePath: string, id: ResourceId): string {
  const stem = scenePath.replace(/\.(?:tscn|escn)$/i, '');
  const safeId = String(id).replace(/[^A-Za-z0-9_-]/g, '_');
  return `${stem}.__inline_gdscript_${safeId}.gd`;
}

function readInlineScripts(
  file: GodotTextFile,
  subResources: readonly SubResource[],
  diagnostics: Diagnostic[],
): {
  readonly scripts: readonly InlineScriptResource[];
  readonly pathById: ReadonlyMap<ResourceId, string>;
} {
  const scripts: InlineScriptResource[] = [];
  const pathById = new Map<ResourceId, string>();
  for (const subResource of subResources) {
    if (subResource.type !== 'GDScript') continue;
    const resPath = inlineScriptPath(file.resPath, subResource.id);
    const text = asString(subResource.properties['script/source']);
    if (text === undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'inline-gdscript-source-missing',
        message: `GDScript subresource ${String(subResource.id)} has no string script/source`,
        at: file.resPath,
      });
      continue;
    }
    scripts.push({ resPath, text });
    pathById.set(subResource.id, resPath);
  }
  return { scripts, pathById };
}

/** Resolve an `ExtResource( n )` property to its authored path. */
function refPath(
  value: GodotValue | undefined,
  byId: ReadonlyMap<ResourceId, ExtResourceRef>,
): string | undefined {
  const id = resourceRefId(value, 'ExtResource');
  return id === undefined ? undefined : byId.get(id)?.resPath;
}

export function nodePathOf(parent: string | undefined, name: string): string {
  if (parent === undefined) return '.';
  return parent === '.' ? name : `${parent}/${name}`;
}

function placeChild(parent: MutableNode, child: MutableNode): void {
  const index = child.siblingIndex;
  if (index === undefined || !Number.isSafeInteger(index) || index < 0) {
    parent.children.push(child);
    return;
  }
  parent.children.splice(Math.min(index, parent.children.length), 0, child);
}

/**
 * Which INSTANCED scene, if any, owns `parentPath` — the one predicate that separates this file's
 * `node-parent-instanced` warning from its `node-parent-unresolved` error.
 *
 * A `[node]` whose parent path this document does not author is an override into a scene it
 * instanced, and the way to tell is to ask whether any ANCESTOR of that path is an instancing
 * node. The ancestors are the path's prefixes — `Arrow` for `Arrow/Body` — *plus the root*, which
 * is an ancestor of every path in the document and is keyed `"."` rather than by its own name
 * (`nodePathOf` above). Walking prefixes alone therefore skips exactly one ancestor, and it is the
 * one a Kenney-style project leans on: when a `.tscn`'s ROOT is itself an instance
 * (`[node name="character" instance=ExtResource("…")]`, then `[node name="leg-left"
 * parent="character/root"]` addressing nodes inside the imported `.glb`), every override reads as
 * a hole in a document that has none. That is a wrong-REASON refusal — the reader really cannot
 * splice the instanced scene, but the node is not unexplained — so the root is consulted last,
 * after the named prefixes, longest first.
 *
 * `byPath` is the in-progress index, which is why this takes a map rather than a tree: nodes are
 * placed in document order and a parent is only ever an EARLIER line.
 *
 * ONE owner for two readers: `binary-document.ts` decodes the same scene model out of Godot's
 * `RSRC` container and used to carry a hand-copied twin of this walk, annotated as mirroring this
 * file "exactly, codes included". A mirror that has to be maintained is a mirror that drifts —
 * this one already had, silently, the moment the text side was the only one anyone measured.
 */
export function instancedAncestorOf(
  parentPath: string,
  byPath: ReadonlyMap<string, { readonly instanceOf?: string | undefined }>,
): string | undefined {
  const segments = parentPath.split('/');
  for (let i = segments.length; i > 0; i--) {
    const ancestor = byPath.get(segments.slice(0, i).join('/'));
    if (ancestor?.instanceOf !== undefined) return ancestor.instanceOf;
  }
  return byPath.get('.')?.instanceOf;
}

/**
 * The `[node]` attributes this reader reads — and the two Godot 4.7 ones it DELIBERATELY DOES NOT.
 *
 * `unique_id=926755287` and `parent_id_path=PackedInt32Array(97896761, 1436141822)` are a second,
 * hash-based addressing scheme Godot 4.7 writes ALONGSIDE the `parent="…"` string path, never
 * instead of it: every line carrying them also carries the string path, and that path resolves to
 * the same node in the loop below. So ignoring the pair is a DECISION, not an oversight — the
 * godot4 fixture places 143 of its 143 authored nodes without them — and honouring it would mean
 * carrying a second addressing model whose only advantage (surviving a rename) belongs to an
 * editing session this reader never has.
 *
 * Written here rather than in a doc because the day a document arrives whose `parent=` is absent
 * or stale, this is the comment that says where the other half of the address lives. `index=` is
 * separate: it is Godot's sibling identity/order for inherited renames and insertions, so the
 * shared exact integer reader accepts both engines' serialized Variant spellings below.
 */
function buildNode(
  section: GodotSection,
  path: string,
  byId: ReadonlyMap<ResourceId, ExtResourceRef>,
  inlineScriptPathById: ReadonlyMap<ResourceId, string>,
  name: string,
  sourceOrder: number,
): MutableNode {
  const type = asString(section.attributes['type']);
  const instanceOf = refPath(section.attributes['instance'], byId);
  const instancePlaceholder = asString(section.attributes['instance_placeholder']);
  // Every non-root `[node]` serialized into this PackedScene is owned by its document root unless
  // the line states a different owner. Godot omits the default `owner="."` in text scenes; the
  // section's presence is itself the authoritative ownership fact.
  const authoredOwnerPath = asString(section.attributes['owner']);
  const ownerPath = authoredOwnerPath ?? (path === '.' ? undefined : '.');
  const siblingIndex = asNonNegativeSafeInteger(section.attributes['index']);
  const scriptValue = section.properties['script'];
  const inlineScriptId = resourceRefId(scriptValue, 'SubResource');
  const scriptPath =
    refPath(scriptValue, byId) ??
    (inlineScriptId === undefined ? undefined : inlineScriptPathById.get(inlineScriptId));
  return {
    name,
    path,
    ...(type === undefined ? {} : { type }),
    ...(instanceOf === undefined ? {} : { instanceOf }),
    ...(instancePlaceholder === undefined ? {} : { instancePlaceholder }),
    ...(ownerPath === undefined ? {} : { ownerPath }),
    sourceOrder,
    ...(siblingIndex === undefined ? {} : { siblingIndex }),
    ...(scriptPath === undefined ? {} : { scriptPath }),
    groups: stringItems(section.attributes['groups']),
    // Godot 4's `node_paths=PackedStringArray("target")` — see `SceneNode.nodePathProperties`. Read
    // through the same helper `groups` uses because it is the same shape (a string array written as
    // `PackedStringArray(…)` on 4.x); a Godot 3 header never carries it and comes back empty.
    nodePathProperties: stringItems(section.attributes['node_paths']),
    properties: section.properties,
    children: [],
  };
}

export function readSceneDocument(
  file: GodotTextFile,
  ctx: DocumentContext,
): { document: SceneDocument; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const extResources = readExtResources(file, ctx, diagnostics);
  const byId = new Map(extResources.map((ref) => [ref.id, ref]));
  const subResources = readSubResources(file);
  const inlineScripts = readInlineScripts(file, subResources, diagnostics);

  const header = file.sections.find((s) => s.kind === 'gd_scene');
  const format = asNumber(header?.attributes['format']);
  const uid = asString(header?.attributes['uid']);

  const byPath = new Map<string, MutableNode>();
  const unplacedNodes: UnplacedNode[] = [];
  let root: MutableNode | undefined;
  let nodeCount = 0;

  for (const section of file.sections) {
    if (section.kind !== 'node') continue;
    nodeCount++;
    const name = asString(section.attributes['name']);
    if (name === undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'node-unnamed',
        message: 'a [node] line declares no name',
        at: `${file.resPath}:${section.line}`,
      });
      continue;
    }
    const parentPath = asString(section.attributes['parent']);
    const path = nodePathOf(parentPath, name);
    const node = buildNode(section, path, byId, inlineScripts.pathById, name, nodeCount - 1);

    if (parentPath === undefined) {
      if (root === undefined) {
        root = node;
        byPath.set('.', node);
      } else {
        diagnostics.push({
          severity: 'error',
          code: 'scene-multiple-roots',
          message: `a second parentless [node] "${name}"; a scene has exactly one root`,
          at: `${file.resPath}:${section.line}`,
        });
      }
      continue;
    }

    const parent = byPath.get(parentPath);
    if (parent === undefined) {
      // Is some ANCESTOR of the requested path an instancing node? Then the target lives inside
      // that instanced scene and this is an override, not a hole.
      const instancedAncestor = instancedAncestorOf(parentPath, byPath);
      unplacedNodes.push({
        name,
        parentPath,
        sourceDiagnosticAt: `${file.resPath}:${section.line}`,
        ...(instancedAncestor === undefined ? {} : { instancedScene: instancedAncestor }),
        // The `[node]` line's own declarations, carried verbatim — see UnplacedNode's docstring.
        // The node is still not in the tree and its parent is still not invented.
        ...(node.type === undefined ? {} : { type: node.type }),
        ...(node.instanceOf === undefined ? {} : { instanceOf: node.instanceOf }),
        ...(node.instancePlaceholder === undefined
          ? {}
          : { instancePlaceholder: node.instancePlaceholder }),
        ...(node.ownerPath === undefined ? {} : { ownerPath: node.ownerPath }),
        sourceOrder: node.sourceOrder,
        ...(node.siblingIndex === undefined ? {} : { siblingIndex: node.siblingIndex }),
        ...(node.scriptPath === undefined ? {} : { scriptPath: node.scriptPath }),
        groups: node.groups,
        nodePathProperties: node.nodePathProperties,
        properties: node.properties,
      });
      diagnostics.push(
        instancedAncestor === undefined
          ? {
              severity: 'error',
              code: 'node-parent-unresolved',
              message: `node "${name}" declares parent "${parentPath}", which this scene does not author`,
              at: `${file.resPath}:${section.line}`,
            }
          : {
              severity: 'warning',
              code: 'node-parent-instanced',
              message: `node "${name}" overrides "${parentPath}" inside the instanced scene ${instancedAncestor}; awaiting project-level readable-scene expansion`,
              at: `${file.resPath}:${section.line}`,
            },
      );
      continue;
    }
    placeChild(parent, node);
    byPath.set(path, node);
  }

  if (root === undefined && nodeCount > 0) {
    diagnostics.push({
      severity: 'error',
      code: 'scene-rootless',
      message: `${nodeCount} [node] line(s) but none without a parent — no root`,
      at: file.resPath,
    });
  }

  const connections = file.sections
    .filter((s) => s.kind === 'connection')
    .map((s): SignalConnection => {
      const unbinds = asNumber(s.attributes['unbinds']);
      const bindsValue = s.attributes['binds'];
      const binds = bindsValue?.kind === 'array' ? bindsValue.items : undefined;
      return {
        signal: asString(s.attributes['signal']) ?? '',
        from: asString(s.attributes['from']) ?? '',
        to: asString(s.attributes['to']) ?? '',
        method: asString(s.attributes['method']) ?? '',
        ...(binds === undefined ? {} : { binds }),
        ...(unbinds === undefined ? {} : { unbinds }),
      };
    });

  for (const connection of connections) {
    if (!byPath.has(connection.from) || !byPath.has(connection.to)) {
      diagnostics.push({
        severity: 'warning',
        code: 'connection-endpoint-unresolved',
        message: `signal "${connection.signal}" wires ${connection.from} → ${connection.to}.${connection.method}; at least one endpoint is not a node this scene authors`,
        at: file.resPath,
      });
    }
  }

  return {
    document: {
      resPath: file.resPath,
      ...(uid === undefined ? {} : { uid }),
      ...(format === undefined ? {} : { format }),
      ...(root === undefined ? {} : { root: root as SceneNode }),
      nodeCount,
      unplacedNodes,
      extResources,
      subResources,
      inlineScripts: inlineScripts.scripts,
      connections,
      editablePaths: file.sections
        .filter((s) => s.kind === 'editable')
        .flatMap((s) => {
          const path = asString(s.attributes['path']);
          return path === undefined ? [] : [path];
        }),
    },
    diagnostics,
  };
}

export function readResourceDocument(
  file: GodotTextFile,
  ctx: DocumentContext,
): { document: ResourceDocument; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const extResources = readExtResources(file, ctx, diagnostics);
  const header = file.sections.find((s) => s.kind === 'gd_resource');
  const body = file.sections.find((s) => s.kind === 'resource');
  const uid = asString(header?.attributes['uid']);
  if (header === undefined) {
    diagnostics.push({
      severity: 'error',
      code: 'resource-header-missing',
      message: 'no [gd_resource] header — this is not a Godot resource document',
      at: file.resPath,
    });
  }
  return {
    document: {
      resPath: file.resPath,
      ...(uid === undefined ? {} : { uid }),
      type: asString(header?.attributes['type']) ?? '',
      properties: body?.properties ?? {},
      extResources,
      subResources: readSubResources(file),
    },
    diagnostics,
  };
}
