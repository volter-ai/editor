/**
 * Analyzer-only view of godot-compat's executable ClassDB dispatch declarations.
 *
 * The runtime tables import every backend they can call (Three, Pixi, Rapier, particles, audio,
 * and the rest). gd-analyze only needs to know whether a declared row has a get/set/call form and
 * whether that form returns a translated scene. Loading the executable objects to answer those
 * five bits executes the whole compatibility runtime during analysis.
 *
 * These tables are derived directly from the checked-in dispatch declaration source. There is no
 * second member inventory to drift: adding/removing a runtime row changes this view immediately.
 * Generated game code still imports the executable tables themselves; this module is used only by
 * analyzer-time inspection.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type CompatDispatchSurface = 'canvas' | 'three';
export type CompatDispatchMemberKind = 'construct' | 'property' | 'signal' | 'method';

export interface CompatDispatchMemberMetadata {
  readonly construct: boolean;
  readonly read: boolean;
  readonly write: boolean;
  readonly call: boolean;
  readonly result?: 'scene' | 'scene-array';
}

export interface CompatDispatchMetadataRow extends CompatDispatchMemberMetadata {
  readonly className: string;
  readonly kind: CompatDispatchMemberKind;
  readonly memberName: string;
}

const EMPTY_FLAGS: CompatDispatchMemberMetadata = Object.freeze({
  construct: false,
  read: false,
  write: false,
  call: false,
});

const TABLE_CACHE = new Map<string, ReadonlyMap<string, CompatDispatchMemberMetadata>>();
let externalCache: ReadonlyMap<string, CompatDispatchMemberMetadata> | undefined;

function memberKey(
  className: string,
  kind: CompatDispatchMemberKind,
  memberName: string,
): string {
  return `${className}\0${kind}\0${memberName}`;
}

function metadataOf(row: string, kind: CompatDispatchMemberKind): CompatDispatchMemberMetadata {
  const result = /\bresult:\s*['"](scene(?:-array)?)['"]/.exec(row)?.[1] as
    | 'scene'
    | 'scene-array'
    | undefined;
  return {
    construct: kind === 'construct',
    read: kind === 'property' || kind === 'signal' ? /\bget\s*:/.test(row) : false,
    write: kind === 'property' || kind === 'signal' ? /\bset\s*:/.test(row) : false,
    call: kind === 'method' ? /\bcall\s*:/.test(row) : false,
    ...(result === undefined ? {} : { result }),
  };
}

type DispatchSectionKind = Exclude<CompatDispatchMemberKind, 'construct'>;

interface ParsedDispatchClass {
  readonly construct: boolean;
  readonly bases: Readonly<Record<DispatchSectionKind, string | undefined>>;
  readonly rows: Readonly<Record<
    DispatchSectionKind,
    ReadonlyMap<string, CompatDispatchMemberMetadata | null>
  >>;
}

function parseGeneratedDispatch(source: string): ReadonlyMap<string, CompatDispatchMemberMetadata> {
  const definitions = new Map<string, ParsedDispatchClass>();
  const classes = /^const Dispatch_([A-Za-z0-9_]+): GodotObjectClassDispatch = \{([\s\S]*?)^\};/gm;
  for (const classMatch of source.matchAll(classes)) {
    const variableName = classMatch[1] as string;
    const body = classMatch[2] as string;
    const bases: Record<DispatchSectionKind, string | undefined> = {
      property: undefined,
      signal: undefined,
      method: undefined,
    };
    const rowsByKind: Record<
      DispatchSectionKind,
      Map<string, CompatDispatchMemberMetadata | null>
    > = {
      property: new Map(),
      signal: new Map(),
      method: new Map(),
    };
    const sections = /^  (properties|signals|methods): \{([^\n]*)\n([\s\S]*?)^  \},/gm;
    for (const sectionMatch of body.matchAll(sections)) {
      const section = sectionMatch[1] as 'properties' | 'signals' | 'methods';
      const kind: DispatchSectionKind =
        section === 'properties' ? 'property' : section === 'signals' ? 'signal' : 'method';
      const inherited = /\.\.\.Dispatch_([A-Za-z0-9_]+)\.(?:properties|signals|methods)/
        .exec(sectionMatch[2] as string)?.[1];
      bases[kind] = inherited;
      const rows = /^\s+"([^"]+)":\s*(null|\{.*\}),$/gm;
      for (const rowMatch of (sectionMatch[3] as string).matchAll(rows)) {
        const memberName = rowMatch[1] as string;
        rowsByKind[kind].set(
          memberName,
          rowMatch[2] === 'null' ? null : metadataOf(rowMatch[2] as string, kind),
        );
      }
    }
    definitions.set(variableName, {
      construct: /^  construct\s*:/m.test(body),
      bases,
      rows: rowsByKind,
    });
  }

  const resolvedSections = new Map<string, ReadonlyMap<string, CompatDispatchMemberMetadata>>();
  const resolveSection = (
    variableName: string,
    kind: DispatchSectionKind,
    stack: ReadonlySet<string> = new Set(),
  ): ReadonlyMap<string, CompatDispatchMemberMetadata> => {
    const cacheKey = `${variableName}\0${kind}`;
    const cached = resolvedSections.get(cacheKey);
    if (cached !== undefined) return cached;
    if (stack.has(cacheKey)) {
      throw new Error(`godot compat dispatch metadata has a cyclic ${kind} spread at Dispatch_${variableName}`);
    }
    const definition = definitions.get(variableName);
    if (definition === undefined) return new Map();
    const nextStack = new Set(stack);
    nextStack.add(cacheKey);
    const base = definition.bases[kind];
    const resolved = new Map(
      base === undefined ? [] : resolveSection(base, kind, nextStack),
    );
    for (const [memberName, metadata] of definition.rows[kind]) {
      if (metadata === null) resolved.delete(memberName);
      else resolved.set(memberName, metadata);
    }
    resolvedSections.set(cacheKey, resolved);
    return resolved;
  };

  const table = new Map<string, CompatDispatchMemberMetadata>();
  const exports = /^\s*"([^"]+)":\s*Dispatch_([A-Za-z0-9_]+),$/gm;
  for (const exported of source.matchAll(exports)) {
    const className = exported[1] as string;
    const variableName = exported[2] as string;
    const definition = definitions.get(variableName);
    if (definition === undefined) continue;
    if (definition.construct) {
      table.set(memberKey(className, 'construct', 'new'), {
        ...EMPTY_FLAGS,
        construct: true,
      });
    }
    for (const kind of ['property', 'signal', 'method'] as const) {
      for (const [memberName, metadata] of resolveSection(variableName, kind)) {
        table.set(memberKey(className, kind, memberName), metadata);
      }
    }
  }
  return table;
}

function dispatchSourcePath(major: 3 | 4, surface: CompatDispatchSurface): string {
  return fileURLToPath(new URL(
    `../../capabilities/catalog/project-source/src/lib/godot-compat/object-dispatch-${major}-${surface}.ts`,
    import.meta.url,
  ));
}

function tableFor(
  major: 3 | 4,
  surface: CompatDispatchSurface,
): ReadonlyMap<string, CompatDispatchMemberMetadata> {
  const cacheKey = `${major}:${surface}`;
  const cached = TABLE_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;
  const parsed = parseGeneratedDispatch(readFileSync(dispatchSourcePath(major, surface), 'utf8'));
  TABLE_CACHE.set(cacheKey, parsed);
  return parsed;
}

/** Exact executable metadata for one generated ClassDB row. */
export function compatDispatchMetadata(
  major: 3 | 4,
  surface: CompatDispatchSurface,
  className: string,
  kind: CompatDispatchMemberKind,
  memberName: string,
): CompatDispatchMemberMetadata | undefined {
  return tableFor(major, surface).get(memberKey(className, kind, memberName));
}

/** Every executable row exactly as the generated runtime table exposes it after source spreads. */
export function allCompatDispatchMetadata(
  major: 3 | 4,
  surface: CompatDispatchSurface,
): readonly CompatDispatchMetadataRow[] {
  return [...tableFor(major, surface)].map(([key, metadata]) => {
    const [className, kind, memberName] = key.split('\0') as [
      string,
      CompatDispatchMemberKind,
      string,
    ];
    return { className, kind, memberName, ...metadata };
  });
}

function declarationSlice(source: string, variable: string): string | undefined {
  const start = source.search(new RegExp(`(?:export\\s+)?const\\s+${variable}\\b`));
  if (start < 0) return undefined;
  const declarationLineEnd = source.indexOf('\n', start);
  if (declarationLineEnd < 0) return source.slice(start);
  const rest = source.slice(declarationLineEnd + 1);
  const next = rest.search(/^\s*(?:export\s+)?const\s+[A-Z0-9_]+\b/m);
  return next < 0
    ? source.slice(start)
    : source.slice(start, declarationLineEnd + 1 + next);
}

function parseExternalDispatch(): ReadonlyMap<string, CompatDispatchMemberMetadata> {
  const source = readFileSync(fileURLToPath(new URL(
    '../../capabilities/catalog/project-source/src/lib/godot-compat/external-native-extensions.ts',
    import.meta.url,
  )), 'utf8');
  const table = new Map<string, CompatDispatchMemberMetadata>();
  const exports = /^\s*([A-Za-z0-9_]+):\s*([A-Z0-9_]+_DISPATCH),$/gm;
  for (const exported of source.matchAll(exports)) {
    const className = exported[1] as string;
    const declaration = declarationSlice(source, exported[2] as string);
    if (declaration === undefined) continue;
    const row = /^\s*(?:"([^"]+)"|([A-Za-z_$][A-Za-z0-9_$]*)):\s*(null|\{.*\}),?$/gm;
    for (const match of declaration.matchAll(row)) {
      if (match[3] === 'null') continue;
      const memberName = (match[1] ?? match[2]) as string;
      if (memberName === 'methods' || memberName === 'properties' || memberName === 'signals') continue;
      const before = declaration.slice(0, match.index);
      const sectionStarts = [
        ['property', before.lastIndexOf('properties:')] as const,
        ['signal', before.lastIndexOf('signals:')] as const,
        ['method', before.lastIndexOf('methods:')] as const,
      ].sort((left, right) => right[1] - left[1]);
      const [kind, position] = sectionStarts[0] as readonly [
        Exclude<CompatDispatchMemberKind, 'construct'>,
        number,
      ];
      if (position < 0) continue;
      table.set(memberKey(className, kind, memberName), metadataOf(match[3] as string, kind));
    }
  }
  return table;
}

/** Exact executable metadata for one external-native dispatch row. */
export function externalNativeDispatchMetadata(
  className: string,
  kind: CompatDispatchMemberKind,
  memberName: string,
): CompatDispatchMemberMetadata | undefined {
  externalCache ??= parseExternalDispatch();
  return externalCache.get(memberKey(className, kind, memberName));
}

/** Every executable row declared by the external-native runtime dispatch source. */
export function allExternalNativeDispatchMetadata(): readonly CompatDispatchMetadataRow[] {
  externalCache ??= parseExternalDispatch();
  return [...externalCache].map(([key, metadata]) => {
    const [className, kind, memberName] = key.split('\0') as [
      string,
      CompatDispatchMemberKind,
      string,
    ];
    return { className, kind, memberName, ...metadata };
  });
}
