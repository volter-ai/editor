/**
 * What a script's `load(path)` loads, where the program fixes every string `path` can be
 * (`resource-load-paths`). GDScript's `load` is `ResourceLoader::load` of the path, localized to
 * `res://` (modules/gdscript/gdscript_utility_functions.cpp `load`, core/io/resource_loader.cpp:725):
 * the cached resource at that path, or null (with an error) when no file is there.
 *
 * A path's values are followed through the program: a string literal; `a + b` of two followed
 * strings (every pairing); `s.strip_edges()` (`String::strip_edges` drops the characters at or
 * below a space from both ends, core/string/ustring.cpp); an element of `s.split(delimiter)` (every
 * piece of every value); an untyped local declared once and never reassigned (its initializer); a
 * parameter nothing in its function reassigns (every argument a call of that name passes, or the
 * default where it passes none, when no Callable, string, scene connection or document names the
 * function and it is no engine virtual);
 * an element read out of a member container (`container-types.ts`: the values stored in it); and an
 * exported member of a script class no code assigns (its default and every value a scene or
 * resource document gives a property of that name).
 *
 * A `preload` of an imported sound is that sound's load, of its one path.
 *
 * The load lowers to the resources those values name. A value naming an imported sound is that
 * sound; a value naming no project file is Godot's null; a value naming any other project file, or
 * a path whose values are not all followed, leaves the load unresolved (and lowering refuses it).
 */
import type { GodotBoundDatatype, GodotBoundNode, GodotBoundScript } from '../godot-frontend/bound-program';
import type { ResourceDocument, SceneDocument } from '../read/godot-types';
import { argumentCountRuns, type ConnectedCallables } from './connected-callables';
import { type ContainerProjectIndex, type ContainerTyped, containerTypes } from './container-types';

/** How an imported file is loaded: the importer that imported it. */
export type ImportedSoundKind = 'ogg-vorbis' | 'mp3' | 'wav';

export interface ResourceLoadBranch {
  /** A string the path argument can be at run time. */
  readonly value: string;
  /** The project file it names. */
  readonly resPath: string;
  readonly kind: ImportedSoundKind;
}

/** A `load(path)` whose values the program fixes: the ones naming a sound; every other one is null. */
export interface BoundGodotResourceLoad {
  readonly nodeId: number;
  readonly branches: readonly ResourceLoadBranch[];
}

export interface ResourceLoadInputs {
  readonly programs: readonly GodotBoundScript[];
  /** A node's refined datatype (`refined-types.ts`), where the refinement fixed one. */
  readonly refined: (resPath: string, nodeId: number) => GodotBoundDatatype | undefined;
  readonly containers: ContainerProjectIndex;
  readonly connected: ConnectedCallables;
  readonly scenes: readonly SceneDocument[];
  readonly resources: readonly ResourceDocument[];
  /** A script's ancestors, nearest first. */
  readonly scriptAncestors: (resPath: string) => readonly string[];
  /** The import kind of a project file imported as a sound. */
  readonly importedSound: (resPath: string) => ImportedSoundKind | undefined;
  /** Whether a `res://` path names a project file. */
  readonly exists: (resPath: string) => boolean;
  /** Every project scene and resource document's text, for function names they spell as strings. */
  readonly documentTexts: readonly string[];
}

/** The most values a path is followed through before it counts as unknown. */
const VALUE_LIMIT = 256;

function within(inner: GodotBoundNode, outer: GodotBoundNode): boolean {
  return (
    (inner.startLine > outer.startLine || (inner.startLine === outer.startLine && inner.startColumn >= outer.startColumn)) &&
    (inner.endLine < outer.endLine || (inner.endLine === outer.endLine && inner.endColumn <= outer.endColumn))
  );
}

/** `String::strip_edges(true, true)`: characters at or below U+0020 leave both ends. */
function stripEdges(value: string): string {
  let begin = 0;
  let end = value.length;
  while (begin < end && value.charCodeAt(begin) <= 32) begin += 1;
  while (end > begin && value.charCodeAt(end - 1) <= 32) end -= 1;
  return value.slice(begin, end);
}

/** Every string a project document gives a property of this name, or undefined if one is not a string. */
function documentValues(documents: readonly unknown[], name: string): Set<string> | undefined {
  const found = new Set<string>();
  let other = false;
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    const record = value as Record<string, unknown>;
    const properties = record['properties'];
    if (properties !== null && typeof properties === 'object' && !Array.isArray(properties)) {
      const property = (properties as Record<string, unknown>)[name] as { kind?: string; value?: unknown } | undefined;
      if (property !== undefined) {
        if (property.kind === 'string' && typeof property.value === 'string') found.add(property.value);
        else other = true;
      }
    }
    for (const child of Object.values(record)) walk(child);
  };
  walk(documents);
  return other ? undefined : found;
}

export function resourceLoads(inputs: ResourceLoadInputs): ReadonlyMap<string, readonly BoundGodotResourceLoad[]> {
  const byPath = new Map(inputs.programs.map((program) => [program.resPath, program] as const));
  const identifierName = (program: GodotBoundScript, id: number): string | undefined => {
    const node = program.nodes[id];
    return node?.kind === 'IDENTIFIER' ? node.name : undefined;
  };
  const functionOf = (program: GodotBoundScript, node: GodotBoundNode) =>
    program.nodes.find((candidate) => candidate.kind === 'FUNCTION' && within(node, candidate)) as Extract<GodotBoundNode, { kind: 'FUNCTION' }> | undefined;
  const assignedIn = (program: GodotBoundScript, scope: GodotBoundNode, name: string, source: string): boolean =>
    program.nodes.some((other) => {
      if (other.kind !== 'ASSIGNMENT' || !within(other, scope)) return false;
      const assignee = program.nodes[other.assignee];
      return assignee?.kind === 'IDENTIFIER' && assignee.name === name && assignee.source === source;
    });

  // Names a string literal spells, attributes assigned anywhere, identifiers assigned by name.
  const spelled = new Set<string>();
  const assignedNames = new Set<string>();
  for (const program of inputs.programs) {
    for (const node of program.nodes) {
      if (node.kind === 'LITERAL' && (node.value.kind === 'string' || node.value.kind === 'string-name')) spelled.add(node.value.value);
      if (node.kind !== 'ASSIGNMENT') continue;
      const assignee = program.nodes[node.assignee];
      if (assignee?.kind === 'IDENTIFIER') assignedNames.add(assignee.name);
      if (assignee?.kind === 'SUBSCRIPT' && assignee.isAttribute) {
        const attribute = identifierName(program, assignee.attribute);
        if (attribute !== undefined) assignedNames.add(attribute);
      }
    }
  }
  const connectedMethods = new Set(inputs.scenes.flatMap((scene) => scene.connections.map((connection) => connection.method)));
  // A name a document spells as a string may be called by it (an animation's method track).
  for (const text of inputs.documentTexts) for (const match of text.matchAll(/&?"([A-Za-z_][A-Za-z0-9_]*)"/gu)) connectedMethods.add(match[1] as string);
  // Functions a script connects to a signal are called with the signal's arguments, not by name.
  for (const key of inputs.connected.sources.keys()) connectedMethods.add(key.slice(key.indexOf('\0') + 1));
  // A function reachable other than by a call of its name: a Callable of it, a string naming it, a
  // scene connection.
  const escaped = new Set<string>();
  for (const program of inputs.programs) {
    const callees = new Set(program.nodes.flatMap((node) => (node.kind === 'CALL' ? [node.callee] : [])));
    for (const node of program.nodes) {
      if (node.kind === 'IDENTIFIER' && node.source === 'MEMBER_FUNCTION' && !callees.has(node.id) && !inputs.connected.accounted.has(`${program.resPath}\0${String(node.id)}`)) escaped.add(node.name);
    }
  }

  const containerOf = new Map<string, (id: number) => ContainerTyped | undefined>();
  const containerRead = (program: GodotBoundScript, id: number): ContainerTyped | undefined => {
    let typed = containerOf.get(program.resPath);
    if (typed === undefined) {
      typed = containerTypes({
        program,
        index: inputs.containers,
        datatypeOf: (nodeId) => inputs.refined(program.resPath, nodeId) ?? program.nodes[nodeId]?.datatype,
        refinedOf: (nodeId) => inputs.refined(program.resPath, nodeId),
      });
      containerOf.set(program.resPath, typed);
    }
    return typed(id);
  };

  const union = (sets: readonly (Set<string> | undefined)[]): Set<string> | undefined => {
    const out = new Set<string>();
    for (const set of sets) {
      if (set === undefined) return undefined;
      for (const value of set) out.add(value);
      if (out.size > VALUE_LIMIT) return undefined;
    }
    return out;
  };

  const memo = new Map<string, Set<string> | undefined | null>();
  const values = (program: GodotBoundScript, id: number): Set<string> | undefined => {
    const key = `v\0${program.resPath}\0${String(id)}`;
    if (memo.has(key)) return memo.get(key) ?? undefined;
    memo.set(key, null);
    const found = computeValues(program, id);
    memo.set(key, found);
    return found;
  };
  const elements = (program: GodotBoundScript, id: number): Set<string> | undefined => {
    const key = `e\0${program.resPath}\0${String(id)}`;
    if (memo.has(key)) return memo.get(key) ?? undefined;
    memo.set(key, null);
    const found = computeElements(program, id);
    memo.set(key, found);
    return found;
  };

  /** The strings an untyped local holds: its one declaration's initializer, never reassigned. */
  const localInitializer = (program: GodotBoundScript, node: Extract<GodotBoundNode, { kind: 'IDENTIFIER' }>): number | undefined => {
    const scope = functionOf(program, node);
    if (scope === undefined || assignedIn(program, scope, node.name, 'LOCAL_VARIABLE')) return undefined;
    const declarations = program.nodes.filter((candidate) => candidate.kind === 'VARIABLE' && within(candidate, scope) && identifierName(program, candidate.identifier) === node.name);
    const declaration = declarations[0];
    return declarations.length === 1 && declaration?.kind === 'VARIABLE' && declaration.initializer >= 0 ? declaration.initializer : undefined;
  };

  const parameterValues = (program: GodotBoundScript, node: Extract<GodotBoundNode, { kind: 'IDENTIFIER' }>): Set<string> | undefined => {
    const scope = program.nodes.find(
      (candidate) =>
        candidate.kind === 'FUNCTION' &&
        within(node, candidate) &&
        candidate.parameters.some((parameterId) => {
          const parameter = program.nodes[parameterId];
          return parameter?.kind === 'PARAMETER' && identifierName(program, parameter.identifier) === node.name;
        }),
    ) as Extract<GodotBoundNode, { kind: 'FUNCTION' }> | undefined;
    const fn = scope === undefined ? undefined : identifierName(program, scope.identifier);
    // The engine calls its virtuals (every one named `_…`) with arguments no script call shows.
    if (scope === undefined || fn === undefined || fn.startsWith('_') || escaped.has(fn) || spelled.has(fn) || connectedMethods.has(fn)) return undefined;
    if (assignedIn(program, scope, node.name, 'FUNCTION_PARAMETER')) return undefined;
    const index = scope.parameters.findIndex((parameterId) => {
      const parameter = program.nodes[parameterId];
      return parameter?.kind === 'PARAMETER' && identifierName(program, parameter.identifier) === node.name;
    });
    const parameter = program.nodes[scope.parameters[index] as number] as Extract<GodotBoundNode, { kind: 'PARAMETER' }>;
    const found: (Set<string> | undefined)[] = [];
    for (const caller of inputs.programs) {
      for (const call of caller.nodes) {
        if (call.kind !== 'CALL' || call.functionName !== fn || !argumentCountRuns(program, scope, call.arguments.length)) continue;
        const argument = call.arguments[index];
        if (argument !== undefined) found.push(values(caller, argument));
        else found.push(parameter.initializer >= 0 ? values(program, parameter.initializer) : undefined);
      }
    }
    return found.length === 0 ? undefined : union(found);
  };

  const exportedValues = (program: GodotBoundScript, node: Extract<GodotBoundNode, { kind: 'SUBSCRIPT' }>): Set<string> | undefined => {
    const name = identifierName(program, node.attribute);
    const base = inputs.refined(program.resPath, node.base) ?? program.nodes[node.base]?.datatype;
    if (name === undefined || base === undefined || base.metaType || (base.kind !== 'CLASS' && base.kind !== 'SCRIPT') || base.scriptPath === '') return undefined;
    if (assignedNames.has(name) || spelled.has(name)) return undefined;
    for (const scriptPath of [base.scriptPath, ...inputs.scriptAncestors(base.scriptPath)]) {
      const script = byPath.get(scriptPath);
      const root = script?.nodes[script.rootNodeId];
      if (script === undefined || root?.kind !== 'CLASS') continue;
      const declaration = root.members.map((id) => script.nodes[id]).find((member) => member?.kind === 'VARIABLE' && identifierName(script, member.identifier) === name);
      if (declaration?.kind !== 'VARIABLE') continue;
      if (!declaration.exported || declaration.static || declaration.setter >= 0 || declaration.getter >= 0) return undefined;
      const defaults = declaration.initializer >= 0 ? values(script, declaration.initializer) : declaration.datatype.builtinType === 'String' ? new Set(['']) : undefined;
      return union([defaults, documentValues([...inputs.scenes, ...inputs.resources], name)]);
    }
    return undefined;
  };

  const computeValues = (program: GodotBoundScript, id: number): Set<string> | undefined => {
    const node = program.nodes[id];
    if (node === undefined) return undefined;
    const container = containerRead(program, id);
    if (container !== undefined) return union(container.sources.map((source) => values(program, source)));
    switch (node.kind) {
      case 'LITERAL':
        return node.value.kind === 'string' || node.value.kind === 'string-name' ? new Set([node.value.value]) : undefined;
      case 'BINARY_OPERATOR': {
        if (node.variantOperatorId !== 6) return undefined;
        const left = values(program, node.leftOperand);
        const right = values(program, node.rightOperand);
        if (left === undefined || right === undefined || left.size * right.size > VALUE_LIMIT) return undefined;
        return new Set([...left].flatMap((a) => [...right].map((b) => a + b)));
      }
      case 'CALL': {
        const callee = program.nodes[node.callee];
        if (node.functionName !== 'strip_edges' || node.arguments.length !== 0 || callee?.kind !== 'SUBSCRIPT' || !callee.isAttribute) return undefined;
        const base = values(program, callee.base);
        return base === undefined ? undefined : new Set([...base].map(stripEdges));
      }
      case 'SUBSCRIPT':
        return node.isAttribute ? exportedValues(program, node) : elements(program, node.base);
      case 'IDENTIFIER': {
        if (node.source === 'LOCAL_VARIABLE') {
          const initializer = localInitializer(program, node);
          return initializer === undefined ? undefined : values(program, initializer);
        }
        if (node.source === 'FUNCTION_PARAMETER') return parameterValues(program, node);
        return undefined;
      }
      default:
        return undefined;
    }
  };

  /** The strings a PackedStringArray value's elements can be. */
  const computeElements = (program: GodotBoundScript, id: number): Set<string> | undefined => {
    const node = program.nodes[id];
    if (node?.kind === 'IDENTIFIER' && node.source === 'LOCAL_VARIABLE') {
      const initializer = localInitializer(program, node);
      return initializer === undefined ? undefined : elements(program, initializer);
    }
    if (node?.kind !== 'CALL' || node.functionName !== 'split' || node.arguments.length !== 1) return undefined;
    const callee = program.nodes[node.callee];
    const delimiter = program.nodes[node.arguments[0] as number];
    if (callee?.kind !== 'SUBSCRIPT' || !callee.isAttribute || delimiter?.kind !== 'LITERAL' || delimiter.value.kind !== 'string' || delimiter.value.value === '') return undefined;
    const base = values(program, callee.base);
    const separator = delimiter.value.value;
    // `String::split(delimiter, allow_empty = true)`: every piece, empty ones included.
    return base === undefined ? undefined : union([...base].map((value) => new Set(value.split(separator))));
  };

  const loads = new Map<string, BoundGodotResourceLoad[]>();
  for (const program of inputs.programs) {
    for (const node of program.nodes) {
      // `preload("res://x.ogg")`: the imported sound at that path, as its `load` would be.
      if (node.kind === 'PRELOAD') {
        const kind = inputs.importedSound(node.resolvedPath);
        if (kind === undefined) continue;
        const rows = loads.get(program.resPath) ?? [];
        rows.push({ nodeId: node.id, branches: [{ value: node.resolvedPath, resPath: node.resolvedPath, kind }] });
        loads.set(program.resPath, rows);
        continue;
      }
      if (node.kind !== 'CALL' || node.compilerTarget.member !== 'load' || node.compilerTarget.owner !== '@GDScript' || node.arguments.length !== 1) continue;
      const found = values(program, node.arguments[0] as number);
      if (found === undefined) continue;
      const branches: ResourceLoadBranch[] = [];
      let resolved = true;
      for (const value of [...found].sort()) {
        if (value.startsWith('uid://')) {
          resolved = false;
          break;
        }
        // `ProjectSettings::localize_path`: a path without a scheme is relative to `res://`.
        const resPath = value.startsWith('res://') ? value : `res://${value.replace(/^\/+/u, '')}`;
        const kind = inputs.importedSound(resPath);
        if (kind !== undefined) branches.push({ value, resPath, kind });
        else if (inputs.exists(resPath)) {
          resolved = false;
          break;
        }
      }
      if (!resolved || branches.length === 0) continue;
      const rows = loads.get(program.resPath) ?? [];
      rows.push({ nodeId: node.id, branches });
      loads.set(program.resPath, rows);
    }
  }
  return loads;
}
