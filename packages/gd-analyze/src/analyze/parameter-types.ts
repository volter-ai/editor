/**
 * The datatype of a script function's untyped parameter, where every value that can reach it has
 * one type Godot guarantees there. A parameter's values come from whoever calls the function, and
 * the analysis follows every such caller across the project:
 *
 * - `engine-virtual-parameter`: the engine calls a function that overrides a virtual of the
 *   script's native class (`_physics_process(delta)`) with the virtual's declared arguments
 *   (`ClassDB` virtual methods, the API dump's `is_virtual` rows, `GDVIRTUAL_CALL`);
 * - `signal-handler-parameter`: a scene `[connection]` calls its method with the signal's declared
 *   arguments (a native signal's from the API dump, a script signal's typed parameters, and for an
 *   untyped one the one type every `.emit()` / `emit_signal()` in the project passes, none of them
 *   dynamic), when the connection binds and unbinds nothing (`Object::emit_signalp`,
 *   core/object/object.cpp:1197);
 * - `call-site-parameter`: a script call by name passes its arguments' datatypes (an argument that
 *   is itself such a parameter carries the type found for it). A call on any receiver counts, since
 *   the method a name selects may be any script's function of that name.
 *
 * A parameter is typed only when every one of those sources exists for it, is known and agrees,
 * and the function cannot be reached another way: no `Callable` of it (a member-function identifier
 * outside a call), no string literal naming it in any script, and no `"name"` in a scene or resource
 * text other than the connections counted above (an animation's method track, `call_deferred`).
 */
import type { GodotBoundDatatype, GodotBoundNode, GodotBoundScript } from '../godot-frontend/bound-program';
import type { SceneDocument } from '../read/godot-types';
import type { GodotApiDump } from './api-dump';
import type { GodotAnalysisRuleId } from './refined-types';
import { resolveScenePath } from './call-receivers';
import { apiTypeDatatype } from './refined-types';

export type ParameterRule = Extract<GodotAnalysisRuleId, 'engine-virtual-parameter' | 'signal-handler-parameter' | 'call-site-parameter'>;

export interface ParameterType {
  readonly datatype: GodotBoundDatatype;
  readonly rules: readonly ParameterRule[];
}

export interface ParameterTypeInputs {
  readonly programs: readonly GodotBoundScript[];
  readonly apiDump: GodotApiDump;
  /** The native class at the root of a script's chain. */
  readonly nativeBase: (resPath: string) => string | undefined;
  /** A script's ancestors, nearest first. */
  readonly scriptAncestors: (resPath: string) => readonly string[];
  readonly scenes: readonly SceneDocument[];
  readonly scriptAt: (documentPath: string, nodePath: string) => string | undefined;
  /** Every project scene and resource document's text, for names they mention as strings. */
  readonly documentTexts: readonly string[];
  /**
   * Filled with the parameters (`parameterKey`) only script calls reach, each passing an int or a
   * float and both occurring (`numeric-variants.ts`).
   */
  readonly numeric?: Set<string>;
  /** An untyped member's one stored type (`member-types.ts`), for a member passed as an argument. */
  readonly memberType?: (resPath: string, name: string) => GodotBoundDatatype | undefined;
}

/** The key of a function's parameter: `resPath`, function name, parameter name. */
export function parameterKey(resPath: string, fn: string, parameter: string): string {
  return `${resPath}\0${fn}\0${parameter}`;
}

type Source = { readonly datatype: GodotBoundDatatype | undefined; readonly rule: ParameterRule };

function sameType(a: GodotBoundDatatype, b: GodotBoundDatatype): boolean {
  return a.kind === b.kind && a.builtinType === b.builtinType && a.nativeType === b.nativeType && a.scriptPath === b.scriptPath && a.metaType === b.metaType;
}

function known(datatype: GodotBoundDatatype): boolean {
  return datatype.kind === 'BUILTIN' || datatype.kind === 'NATIVE' || datatype.kind === 'CLASS' || datatype.kind === 'SCRIPT' || datatype.kind === 'ENUM';
}

interface FunctionSite {
  readonly resPath: string;
  readonly program: GodotBoundScript;
  readonly node: Extract<GodotBoundNode, { kind: 'FUNCTION' }>;
  readonly parameters: readonly { readonly name: string; readonly node: Extract<GodotBoundNode, { kind: 'PARAMETER' }> }[];
}

export function typeFunctionParameters(inputs: ParameterTypeInputs): ReadonlyMap<string, ParameterType> {
  const classes = new Map(inputs.apiDump.classes.map((entry) => [entry.name, entry] as const));
  const identifierName = (program: GodotBoundScript, id: number): string | undefined => {
    const node = program.nodes[id];
    return node?.kind === 'IDENTIFIER' ? node.name : undefined;
  };

  // Every script function by name.
  const functions = new Map<string, FunctionSite[]>();
  for (const program of inputs.programs) {
    for (const node of program.nodes) {
      if (node.kind !== 'FUNCTION') continue;
      const name = identifierName(program, node.identifier);
      if (name === undefined) continue;
      const parameters = node.parameters.flatMap((id) => {
        const parameter = program.nodes[id];
        const parameterName = parameter?.kind === 'PARAMETER' ? identifierName(program, parameter.identifier) : undefined;
        return parameter?.kind === 'PARAMETER' && parameterName !== undefined ? [{ name: parameterName, node: parameter }] : [];
      });
      const rows = functions.get(name) ?? [];
      rows.push({ resPath: program.resPath, program, node, parameters });
      functions.set(name, rows);
    }
  }

  // Names that escape: a Callable of the function, or a string naming it.
  const escaped = new Set<string>();
  for (const program of inputs.programs) {
    const callees = new Set(program.nodes.flatMap((node) => (node.kind === 'CALL' ? [node.callee] : [])));
    // `has_method("name")` asks whether a method exists (`Object::has_method`); it calls nothing.
    const queried = new Set(program.nodes.flatMap((node) => (node.kind === 'CALL' && node.functionName === 'has_method' && node.arguments.length === 1 ? [node.arguments[0] as number] : [])));
    for (const node of program.nodes) {
      if (node.kind === 'IDENTIFIER' && node.source === 'MEMBER_FUNCTION' && !callees.has(node.id)) escaped.add(node.name);
      if (node.kind === 'LITERAL' && (node.value.kind === 'string' || node.value.kind === 'string-name') && !queried.has(node.id)) escaped.add(node.value.value);
    }
  }
  const connectionLine = /^\[connection [^\]]*\]$/u;
  for (const text of inputs.documentTexts) {
    for (const line of text.split('\n')) {
      if (connectionLine.test(line.trim())) continue;
      for (const match of line.matchAll(/&?"([A-Za-z_][A-Za-z0-9_]*)"/gu)) escaped.add(match[1] as string);
    }
  }

  // The engine virtual a script function overrides: its declared argument types.
  const virtualArguments = (resPath: string, name: string): readonly string[] | undefined => {
    for (let current = classes.get(inputs.nativeBase(resPath) ?? ''); current !== undefined; ) {
      const method = current.methods.find((entry) => entry.name === name && entry.is_virtual);
      if (method !== undefined) return method.arguments.map((argument) => argument.type);
      current = current.base_class === '' ? undefined : classes.get(current.base_class);
    }
    return undefined;
  };

  // Every emission of a script signal in the project, by signal name: `sig.emit(...)`,
  // `obj.sig.emit(...)` and `emit_signal("sig", ...)`, each its arguments' datatypes. An emission
  // this cannot name (`emit_signal(name_var)`, a Signal held in a variable) makes every script
  // signal's emitted types unknown.
  const emitted = new Map<string, (GodotBoundDatatype | undefined)[][]>();
  let dynamicEmit = false;
  for (const program of inputs.programs) {
    const argumentTypes = (ids: readonly number[]) =>
      ids.map((id) => {
        const node = program.nodes[id];
        const datatype = node?.datatype;
        // An untyped member's weak datatype is not what it holds; the one type its stores give is.
        if (node?.kind === 'IDENTIFIER' && (node.source === 'MEMBER_VARIABLE' || node.source === 'INHERITED_VARIABLE') && datatype?.typeSource === 'INFERRED') return inputs.memberType?.(program.resPath, node.name);
        return datatype !== undefined && known(datatype) && !datatype.metaType ? datatype : undefined;
      });
    const record = (name: string, ids: readonly number[]) => {
      const rows = emitted.get(name) ?? [];
      rows.push(argumentTypes(ids));
      emitted.set(name, rows);
    };
    for (const node of program.nodes) {
      if (node.kind !== 'CALL') continue;
      if (node.functionName === 'emit_signal') {
        const first = program.nodes[node.arguments[0] ?? -1];
        if (first?.kind === 'LITERAL' && (first.value.kind === 'string' || first.value.kind === 'string-name')) record(first.value.value, node.arguments.slice(1));
        else dynamicEmit = true;
        continue;
      }
      if (node.functionName !== 'emit') continue;
      const callee = program.nodes[node.callee];
      if (callee?.kind !== 'SUBSCRIPT' || !callee.isAttribute) continue;
      const base = program.nodes[callee.base];
      if (base?.datatype.kind !== 'BUILTIN' || base.datatype.builtinType !== 'Signal') continue;
      const name =
        base.kind === 'IDENTIFIER' && base.source === 'MEMBER_SIGNAL'
          ? base.name
          : base.kind === 'SUBSCRIPT' && base.isAttribute
            ? identifierName(program, base.attribute)
            : undefined;
      if (name === undefined) dynamicEmit = true;
      else record(name, node.arguments);
    }
  }
  /** The one datatype every emission of `signal` passes at `index`, else undefined. */
  const emittedType = (signal: string, index: number): GodotBoundDatatype | undefined => {
    const rows = emitted.get(signal);
    if (dynamicEmit || rows === undefined || rows.length === 0) return undefined;
    const types = rows.map((row) => row[index]);
    const first = types[0];
    return first !== undefined && types.every((type) => type !== undefined && sameType(type, first)) ? first : undefined;
  };

  // The declared argument types of a signal on the node at `from` in `scene`: a script signal's
  // typed parameters, an untyped one (or one past its declaration) the type every emission passes.
  const signalArguments = (scene: SceneDocument, from: string, signal: string): readonly (GodotBoundDatatype | undefined)[] | undefined => {
    const resolved = resolveScenePath(new Map(inputs.scenes.map((entry) => [entry.resPath, entry] as const)), { documentPath: scene.resPath, nodePath: '.' }, from);
    if (typeof resolved === 'string') return undefined;
    const script = inputs.scriptAt(resolved.documentPath, resolved.pathInDocument);
    for (const resPath of script === undefined ? [] : [script, ...inputs.scriptAncestors(script)]) {
      const program = inputs.programs.find((entry) => entry.resPath === resPath);
      const declaration = program?.nodes.find((node) => node.kind === 'SIGNAL' && identifierName(program, node.identifier) === signal);
      if (program !== undefined && declaration?.kind === 'SIGNAL') {
        const declared = declaration.parameters.map((id) => {
          const parameter = program.nodes[id];
          return parameter !== undefined && known(parameter.datatype) && parameter.datatype.typeSource !== 'UNDETECTED' ? parameter.datatype : undefined;
        });
        const width = Math.max(declared.length, ...(emitted.get(signal) ?? []).map((row) => row.length));
        return Array.from({ length: width }, (_, index) => declared[index] ?? emittedType(signal, index));
      }
    }
    for (let current = classes.get(resolved.className); current !== undefined; ) {
      const declared = current.signals.find((entry) => entry.name === signal);
      if (declared !== undefined) return declared.arguments.map((argument) => apiTypeDatatype(inputs.apiDump, argument.type));
      current = current.base_class === '' ? undefined : classes.get(current.base_class);
    }
    return undefined;
  };

  // The sources that are not calls between scripts, per script function (`resPath`, name) and
  // parameter index: the engine calls a script's own override, a connection the function its target
  // node's script (or the nearest ancestor script) declares.
  const direct = new Map<string, Source[][]>();
  const siteKey = (resPath: string, name: string) => `${resPath}\0${name}`;
  const add = (key: string, index: number, source: Source): void => {
    const rows = direct.get(key) ?? [];
    while (rows.length <= index) rows.push([]);
    (rows[index] as Source[]).push(source);
    direct.set(key, rows);
  };
  for (const [name, sites] of functions) {
    for (const site of sites) {
      const declared = virtualArguments(site.resPath, name);
      if (declared === undefined) continue;
      site.parameters.forEach((_, index) => {
        const type = declared[index];
        add(siteKey(site.resPath, name), index, { datatype: type === undefined ? undefined : apiTypeDatatype(inputs.apiDump, type), rule: 'engine-virtual-parameter' });
      });
    }
  }
  const scenesByPath = new Map(inputs.scenes.map((entry) => [entry.resPath, entry] as const));
  for (const scene of inputs.scenes) {
    for (const connection of scene.connections) {
      const sites = functions.get(connection.method);
      if (sites === undefined) continue;
      // The function the connection calls: its target node's script's, else the nearest ancestor's.
      const resolved = resolveScenePath(scenesByPath, { documentPath: scene.resPath, nodePath: '.' }, connection.to);
      const script = typeof resolved === 'string' ? undefined : inputs.scriptAt(resolved.documentPath, resolved.pathInDocument);
      const site = script === undefined ? undefined : [script, ...inputs.scriptAncestors(script)].map((resPath) => sites.find((entry) => entry.resPath === resPath)).find((entry) => entry !== undefined);
      // A connection whose target the analysis cannot place reaches any function of that name.
      const targets = site === undefined ? sites : [site];
      const bound = (connection.binds?.length ?? 0) > 0 || (connection.unbinds ?? 0) > 0 || (connection.bindCount ?? 0) > 0;
      const argumentsOf = bound ? undefined : signalArguments(scene, connection.from, connection.signal);
      for (const target of targets) {
        target.parameters.forEach((_, index) => {
          add(siteKey(target.resPath, connection.method), index, { datatype: argumentsOf?.[index], rule: 'signal-handler-parameter' });
        });
      }
    }
  }

  const resolvedTypes = new Map<string, ParameterType>();
  const typeOfArgument = (program: GodotBoundScript, id: number): GodotBoundDatatype | undefined => {
    const node = program.nodes[id];
    if (node === undefined) return undefined;
    if (node.kind === 'IDENTIFIER' && node.source === 'FUNCTION_PARAMETER') {
      const scope = program.nodes.find((candidate) => candidate.kind === 'FUNCTION' && candidate.startLine <= node.startLine && candidate.endLine >= node.endLine && candidate.parameters.some((parameterId) => {
        const parameter = program.nodes[parameterId];
        return parameter?.kind === 'PARAMETER' && identifierName(program, parameter.identifier) === node.name;
      }));
      const fn = scope?.kind === 'FUNCTION' ? identifierName(program, scope.identifier) : undefined;
      const found = fn === undefined ? undefined : resolvedTypes.get(parameterKey(program.resPath, fn, node.name));
      if (found !== undefined) return found.datatype;
    }
    // An untyped member's datatype is only its initializer's (a weak type): what it holds is the
    // one type every store gives it (`member-types.ts`), else unknown.
    if (node.kind === 'IDENTIFIER' && (node.source === 'MEMBER_VARIABLE' || node.source === 'INHERITED_VARIABLE') && node.datatype.typeSource === 'INFERRED') return inputs.memberType?.(program.resPath, node.name);
    return known(node.datatype) && !node.datatype.metaType ? node.datatype : undefined;
  };

  const settle = (name: string, sites: readonly FunctionSite[], withCalls: boolean): void => {
    if (escaped.has(name)) return;
    const count = Math.max(...sites.map((site) => site.parameters.length));
    // The callers by name (any receiver): a call may reach any script's function of that name.
    const sources: Source[][] = Array.from({ length: count }, () => []);
    if (withCalls) {
      for (const program of inputs.programs) {
        for (const node of program.nodes) {
          if (node.kind !== 'CALL' || node.functionName !== name) continue;
          for (let index = 0; index < count; index += 1) {
            const argument = node.arguments[index];
            if (argument !== undefined) {
              (sources[index] as Source[]).push({ datatype: typeOfArgument(program, argument), rule: 'call-site-parameter' });
            } else {
              // An omitted argument takes the parameter's default: its datatype joins the sources.
              for (const site of sites) {
                const parameter = site.parameters[index]?.node;
                const initializer = parameter === undefined || parameter.initializer < 0 ? undefined : site.program.nodes[parameter.initializer];
                (sources[index] as Source[]).push({ datatype: initializer === undefined || !known(initializer.datatype) ? undefined : initializer.datatype, rule: 'call-site-parameter' });
              }
            }
          }
        }
      }
    }
    for (const site of sites) {
      site.parameters.forEach((parameter, index) => {
        if (parameter.node.datatype.kind !== 'VARIANT') return;
        const found = [...(sources[index] as Source[]), ...(direct.get(siteKey(site.resPath, name))?.[index] ?? [])];
        if (found.length === 0 || found.some((source) => source.datatype === undefined)) return;
        const first = found[0]?.datatype as GodotBoundDatatype;
        if (!found.every((source) => sameType(source.datatype as GodotBoundDatatype, first))) {
          // Script calls alone, passing ints and floats: the parameter holds either (a tagged number).
          const numeric = found.map((source) => {
            const datatype = source.datatype as GodotBoundDatatype;
            return datatype.metaType ? undefined : datatype.kind === 'ENUM' ? 'int' : datatype.kind === 'BUILTIN' ? datatype.builtinType : undefined;
          });
          if (found.every((source) => source.rule === 'call-site-parameter') && numeric.every((type) => type === 'int' || type === 'float') && new Set(numeric).size === 2) {
            inputs.numeric?.add(parameterKey(site.resPath, name, parameter.name));
          }
          return;
        }
        const rules = [...new Set(found.map((source) => source.rule))].sort();
        resolvedTypes.set(parameterKey(site.resPath, name, parameter.name), { datatype: first, rules });
      });
    }
  };
  // The engine's and the scenes' callers first, so a call passing such a parameter carries its type.
  for (const [name, sites] of functions) if (!inputs.programs.some((program) => program.nodes.some((node) => node.kind === 'CALL' && node.functionName === name))) settle(name, sites, false);
  // Then the functions scripts call, until no call's argument gains a type (a parameter passed on
  // to another function carries the type found for it).
  const called = [...functions].filter(([name]) => inputs.programs.some((program) => program.nodes.some((node) => node.kind === 'CALL' && node.functionName === name)));
  for (let size = -1; size !== resolvedTypes.size; ) {
    size = resolvedTypes.size;
    for (const [name, sites] of called) settle(name, sites, true);
  }
  return resolvedTypes;
}
