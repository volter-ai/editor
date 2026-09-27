/**
 * Exact ResourceLoader path resolution over the files that belong to one Godot project.
 *
 * Godot may reach the same resource through four source-backed spellings: its authored `res://`
 * path, the UID carried beside that path, an importer cache output recorded by `<source>.import`,
 * or the filesystem's case-preserving spelling on a case-insensitive host.  This index resolves
 * only those recorded facts.  In particular, the existence of a `.import` sidecar is not evidence
 * that its source or output bytes exist.
 */
import * as path from 'node:path';
import { parseGodotBinaryResourceMetadata } from './binary-format';
import { asString, stringItems } from './godot-value';
import type { GodotProjectFileSource } from './project-file-source';
import {
  isBrowserSourceAssetPath,
  isResPath,
  type ResourceKind,
  resolveProjectResourcePath,
  resourceKindOf,
} from './res-path';
import type { GodotTextFile } from './text-format';
import { parseGodotTextFile, parseGodotTextResourceMetadata } from './text-format';

export interface ResolvedProjectResource {
  /** Canonical logical path exposed by ResourceLoader and retained in the project model. */
  readonly resPath: string;
  /** Exact bytes backing the logical resource, when the resource is available. */
  readonly bytePath?: string;
  readonly present: boolean;
  /** Format of the bytes the reader opens; may differ from the logical imported-source suffix. */
  readonly kind: ResourceKind;
  readonly mechanism: 'exact' | 'case-normalized' | 'uid' | 'import-remap' | 'missing';
}

export interface CachedImportedDocument {
  /** The importer source path by which scenes and resources address this document. */
  readonly resPath: string;
  /** A real, recorded binary importer output containing the document bytes. */
  readonly bytePath: string;
}

export interface ProjectResourceResolver {
  readonly resolve: (resPath: string, uid?: string) => ResolvedProjectResource;
  readonly cachedDocuments: readonly CachedImportedDocument[];
  /** UID/path pairs proved by document/import metadata or checked-in `.uid` sidecars. */
  readonly uidPathCandidates: readonly Readonly<{ uid: string; path: string }>[];
}

interface ImportRemapFact {
  readonly source: string;
  readonly outputs: readonly string[];
  readonly uid?: string;
}

interface BinaryResourceIdentity {
  /** Physical path whose bytes carry this identity. Imported caches are rewritten to their
   * logical source path after the sidecar graph has been assembled. */
  readonly physicalResPath: string;
  readonly bytePath: string;
}

function normalizedResPath(value: string): string | undefined {
  if (!isResPath(value)) return undefined;
  const relative = path.posix.normalize(value.slice('res://'.length));
  if (
    relative === '' ||
    relative === '.' ||
    relative === '..' ||
    relative.startsWith('../') ||
    path.posix.isAbsolute(relative)
  )
    return undefined;
  return `res://${relative}`;
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

/** Build once before documents are decoded, so every text and binary reader sees one answer. */
export function buildProjectResourceResolver(
  source: GodotProjectFileSource,
): ProjectResourceResolver {
  const actualByFold = new Map<string, string[]>();
  const actualPaths = new Set<string>();
  const recordActual = (resPath: string): void => {
    const normalized = normalizedResPath(resPath);
    if (normalized === undefined) return;
    actualPaths.add(normalized);
    const key = normalized.toLocaleLowerCase('en-US');
    const paths = actualByFold.get(key);
    if (paths === undefined) actualByFold.set(key, [normalized]);
    else if (!paths.includes(normalized)) paths.push(normalized);
  };
  for (const resPath of source.resPaths) recordActual(resPath);

  const importFacts: ImportRemapFact[] = [];
  const uidCandidates = new Map<string, Set<string>>();
  const addUidCandidate = (uid: string | undefined, candidate: string | undefined): void => {
    if (uid === undefined || candidate === undefined || !uid.startsWith('uid://')) return;
    const normalized = normalizedResPath(candidate);
    if (normalized === undefined) return;
    const candidates = uidCandidates.get(uid);
    if (candidates === undefined) uidCandidates.set(uid, new Set([normalized]));
    else candidates.add(normalized);
  };

  for (const resPath of source.resPaths) {
    if (resPath.endsWith('.uid')) {
      const target = resPath.slice(0, -'.uid'.length);
      addUidCandidate(source.text(resPath).trim(), target);
      continue;
    }
    if (!/\.(?:tscn|escn|tres|gdns|import|remap)$/i.test(resPath)) continue;
    const requiresBody = resPath.endsWith('.import') || resPath.endsWith('.remap');
    let file: GodotTextFile;
    try {
      const text = source.text(resPath);
      file = requiresBody
        ? parseGodotTextFile(text, resPath)
        : parseGodotTextResourceMetadata(text, resPath);
    } catch {
      continue;
    }

    const documentHeader = file.sections.find(
      (section) => section.kind === 'gd_scene' || section.kind === 'gd_resource',
    );
    addUidCandidate(asString(documentHeader?.attributes['uid']), resPath);
    for (const external of file.sections.filter((section) => section.kind === 'ext_resource')) {
      const writtenPath = asString(external.attributes['path']);
      addUidCandidate(
        asString(external.attributes['uid']),
        writtenPath === undefined ? undefined : resolveProjectResourcePath(resPath, writtenPath),
      );
    }

    if (!requiresBody) continue;
    const deps = file.sections.find((section) => section.kind === 'deps');
    const remap = file.sections.find((section) => section.kind === 'remap');
    const sourceWritten = resPath.endsWith('.remap')
      ? resPath.slice(0, -'.remap'.length)
      : asString(deps?.properties['source_file']);
    const sourcePath =
      sourceWritten === undefined
        ? undefined
        : normalizedResPath(resolveProjectResourcePath(resPath, sourceWritten) ?? '');
    if (sourcePath === undefined) continue;
    const outputs = unique([
      ...stringItems(deps?.properties['dest_files']),
      ...Object.entries(remap?.properties ?? {})
        .flatMap(([name, value]) =>
          name === 'path' || name.startsWith('path.') ? [asString(value)] : [],
        )
        .filter((value): value is string => value !== undefined),
    ]).flatMap((output) => {
      const resolvedOutput = resolveProjectResourcePath(resPath, output);
      const normalized =
        resolvedOutput === undefined ? undefined : normalizedResPath(resolvedOutput);
      return normalized === undefined ? [] : [normalized];
    });
    const uid = asString(remap?.properties['uid']);
    importFacts.push({ source: sourcePath, outputs, ...(uid === undefined ? {} : { uid }) });
    addUidCandidate(uid, sourcePath);
  }

  const sourceByOutput = new Map<string, string>();
  const outputsBySource = new Map<string, string[]>();
  for (const fact of importFacts) {
    const retained = outputsBySource.get(fact.source) ?? [];
    for (const output of fact.outputs) {
      const prior = sourceByOutput.get(output);
      // An output naming two sources is corrupt importer metadata. Leaving it unmapped is the
      // only directory-order-independent answer.
      if (prior === undefined) sourceByOutput.set(output, fact.source);
      else if (prior !== fact.source) sourceByOutput.set(output, '');
      if (!retained.includes(output)) retained.push(output);
    }
    outputsBySource.set(fact.source, retained);
  }

  const exactOrCase = (
    requested: string,
  ):
    | { readonly resPath: string; readonly bytePath: string; readonly exact: boolean }
    | undefined => {
    const normalized = normalizedResPath(requested);
    if (normalized === undefined) return undefined;
    if (actualPaths.has(normalized) && source.has(normalized)) {
      return { resPath: normalized, bytePath: normalized, exact: true };
    }
    const candidates = actualByFold.get(normalized.toLocaleLowerCase('en-US')) ?? [];
    const existing = candidates.filter((candidate) => source.has(candidate));
    if (existing.length !== 1) return undefined;
    const canonical = existing[0] as string;
    return { resPath: canonical, bytePath: canonical, exact: false };
  };

  const binaryCacheFor = (
    sourcePath: string,
  ): { resPath: string; bytePath: string } | undefined => {
    const outputs = outputsBySource.get(sourcePath) ?? [];
    const available = outputs.flatMap((output) => {
      if (sourceByOutput.get(output) !== sourcePath) return [];
      if (resourceKindOf(output) !== 'binary') return [];
      return source.has(output) ? [{ resPath: output, bytePath: output }] : [];
    });
    // Importers can record platform alternatives, but a source document must have one exact
    // binary payload in this checkout. Choosing among multiple outputs would be platform policy.
    return available.length === 1 ? available[0] : undefined;
  };

  /**
   * Binary `.scn`/`.res` files carry the same source identity as text `[gd_scene]` /
   * `[gd_resource]` headers: the file UID plus a typed external-resource table whose entries may
   * themselves carry UIDs. The initial index historically read only the text half, so an exact
   * Godot 4 reference of the form
   *
   *     [ext_resource type="PackedScene" uid="uid://..." path="res://old-name.scn"]
   *
   * stayed missing when the present target was a renamed binary scene. The later binary reader
   * did discover the target UID, but that was too late: every earlier scene had already frozen
   * its ExtResource path and `instance-expansion-missing` followed from that stale spelling.
   *
   * Decode identity here, before any document is classified. The metadata and full readers share
   * `parseGodotBinaryHeader`; failures remain silent here so the normal project read emits the one
   * authoritative `document-parse-failed` diagnostic. Imported cache outputs are included only
   * when a checked-in sidecar names the exact output; their public identity is the sidecar's
   * logical source path, never `.godot/imported` editor residue.
   */
  const binaryIdentities = new Map<string, BinaryResourceIdentity>();
  const retainBinaryIdentity = (physicalResPath: string, bytePath: string): void => {
    if (resourceKindOf(physicalResPath) !== 'binary' || !source.has(bytePath)) return;
    const prior = binaryIdentities.get(bytePath);
    if (prior === undefined) binaryIdentities.set(bytePath, { physicalResPath, bytePath });
  };
  for (const resPath of source.resPaths) {
    retainBinaryIdentity(resPath, resPath);
  }
  for (const fact of importFacts) {
    for (const output of fact.outputs) {
      if (sourceByOutput.get(output) !== fact.source) continue;
      retainBinaryIdentity(output, output);
    }
  }
  for (const identity of binaryIdentities.values()) {
    let file: ReturnType<typeof parseGodotBinaryResourceMetadata>;
    try {
      file = parseGodotBinaryResourceMetadata(
        source.bytes(identity.bytePath),
        identity.physicalResPath,
      );
    } catch {
      continue;
    }
    const remappedSource = sourceByOutput.get(identity.physicalResPath);
    const logicalResPath =
      remappedSource === undefined || remappedSource === ''
        ? identity.physicalResPath
        : remappedSource;
    addUidCandidate(file.uid, logicalResPath);
    for (const external of file.extResources) {
      const candidate = resolveProjectResourcePath(logicalResPath, external.path);
      addUidCandidate(external.uid, candidate);
    }
  }

  const resolvePathOnly = (requested: string): ResolvedProjectResource => {
    const normalized = normalizedResPath(requested);
    if (normalized === undefined) {
      return {
        resPath: requested,
        present: false,
        kind: resourceKindOf(requested),
        mechanism: 'missing',
      };
    }
    const remappedSource = sourceByOutput.get(normalized);
    const logical =
      remappedSource === undefined || remappedSource === '' ? normalized : remappedSource;
    const direct = exactOrCase(logical);
    const cache = binaryCacheFor(logical);
    const requiresSourceBytes = isBrowserSourceAssetPath(logical);
    // A checked-in source such as `.fbx`/`.blend` is opaque to this reader, but Godot executes the
    // exact imported PackedScene named by its sidecar. Prefer those decoded bytes; for source
    // formats we open ourselves, the source remains authoritative and the cache is only fallback.
    if (
      cache !== undefined &&
      !requiresSourceBytes &&
      (direct === undefined || resourceKindOf(logical) === 'opaque')
    ) {
      return {
        resPath: logical,
        bytePath: cache.bytePath,
        present: true,
        kind: 'binary',
        mechanism: 'import-remap',
      };
    }
    if (direct !== undefined) {
      return {
        resPath: direct.resPath,
        bytePath: direct.bytePath,
        present: true,
        kind: resourceKindOf(direct.resPath),
        mechanism:
          remappedSource !== undefined && remappedSource !== ''
            ? 'import-remap'
            : direct.exact
              ? 'exact'
              : 'case-normalized',
      };
    }
    if (cache !== undefined && !requiresSourceBytes) {
      return {
        resPath: logical,
        bytePath: cache.bytePath,
        present: true,
        kind: 'binary',
        mechanism: 'import-remap',
      };
    }
    return {
      resPath: logical,
      present: false,
      kind: resourceKindOf(logical),
      mechanism: 'missing',
    };
  };

  const cachedDocuments = unique(importFacts.map((fact) => fact.source)).flatMap((source) => {
    const direct = exactOrCase(source);
    if (direct !== undefined && resourceKindOf(direct.resPath) !== 'opaque') return [];
    const cache = binaryCacheFor(source);
    return cache === undefined ? [] : [{ resPath: source, bytePath: cache.bytePath }];
  });

  const uidPath = new Map<string, string>();
  for (const [uid, candidates] of uidCandidates) {
    const available = unique(
      [...candidates]
        .map((candidate) => resolvePathOnly(candidate))
        .filter((resolved) => resolved.present)
        .map((resolved) => resolved.resPath),
    );
    if (available.length === 1) uidPath.set(uid, available[0] as string);
  }

  const uidPathCandidates = [...uidCandidates].flatMap(([uid, authored]) => {
    const available = unique(
      [...authored]
        .map((candidate) => resolvePathOnly(candidate))
        .filter((resolved) => resolved.present)
        .map((resolved) => resolved.resPath),
    );
    // Existing bytes are ResourceLoader's authority. Stale path companions beside one available
    // UID target do not make that target ambiguous; multiple available targets do. With no bytes,
    // retain every authored pair so downstream closure can still name the missing dependency.
    const paths = available.length > 0 ? available : [...authored];
    return paths.map((path) => ({ uid, path }));
  });

  return {
    resolve: (resPath, uid) => {
      const byPath = resolvePathOnly(resPath);
      // Godot 4 accepts a UID as the resource locator itself (not only as the `uid=` companion
      // carried by an ext_resource declaration). Autoload entries are one authored example. Only
      // resolve that spelling when this project's source-backed UID index has one available target;
      // an unknown or ambiguous UID must retain the loud missing result from `resolvePathOnly`.
      const effectiveUid = uid ?? (resPath.startsWith('uid://') ? resPath : undefined);
      const candidate = effectiveUid === undefined ? undefined : uidPath.get(effectiveUid);
      if (candidate !== undefined) {
        const resolved = resolvePathOnly(candidate);
        if (resolved.present) return { ...resolved, mechanism: 'uid' };
      }
      return byPath;
    },
    cachedDocuments,
    uidPathCandidates,
  };
}
