/**
 * Who calls a script function, beyond the direct calls and scene connections `parameter-types.ts`
 * already follows. Two facts of Godot's call machinery settle a parameter's sources:
 *
 * - `connected-callable-parameter`: a script connecting an engine signal to one of its own
 *   functions, `obj.signal.connect(f)` or `obj.signal.connect(f.bind(a, …))`, where `obj`'s class
 *   is fixed, has `f` called with the signal's declared arguments followed by the bound ones:
 *   `Object::emit_signalp` calls each connected Callable with the emitted arguments
 *   (core/object/object.cpp:1178) and `CallableCustomBind::call` appends its binds after them
 *   (core/variant/callable_bind.cpp:141). The function identifier used that way is accounted for,
 *   so it does not count as a Callable escaping to unknown callers.
 * - `argument-count-mismatch`: a call passing more arguments than a GDScript function declares, or
 *   fewer than it requires, never runs that function's body: the VM returns
 *   CALL_ERROR_TOO_MANY_ARGUMENTS / CALL_ERROR_TOO_FEW_ARGUMENTS before the first instruction
 *   (modules/gdscript/gdscript_vm.cpp:561-574). Such a call (`player.play()` next to a script's
 *   `func play(path)`) passes that function nothing.
 */
import type { GodotBoundDatatype, GodotBoundNode, GodotBoundScript } from '../godot-frontend/bound-program';
import type { GodotApiDump } from './api-dump';
import { apiTypeDatatype } from './refined-types';

export interface ConnectedCallableInputs {
  readonly programs: readonly GodotBoundScript[];
  readonly apiDump: GodotApiDump;
  /** A script's ancestors, nearest first. */
  readonly scriptAncestors: (resPath: string) => readonly string[];
}

export interface ConnectedCallables {
  /**
   * Per script function (`${resPath}\0${name}`, the script that declares it), one row per
   * connection: the datatype each parameter receives, undefined where it is not known.
   */
  readonly sources: ReadonlyMap<string, readonly (readonly (GodotBoundDatatype | undefined)[])[]>;
  /** The function identifiers (`${resPath}\0${nodeId}`) these connections account for. */
  readonly accounted: ReadonlySet<string>;
}

function within(inner: GodotBoundNode, outer: GodotBoundNode): boolean {
  return (
    (inner.startLine > outer.startLine || (inner.startLine === outer.startLine && inner.startColumn >= outer.startColumn)) &&
    (inner.endLine < outer.endLine || (inner.endLine === outer.endLine && inner.endColumn <= outer.endColumn))
  );
}

/**
 * The datatype an expression holds as far as its own declaration guarantees: a hard (annotated)
 * datatype, or an untyped local's inferred one when nothing in its function assigns it again.
 */
function heldDatatype(program: GodotBoundScript, id: number): GodotBoundDatatype | undefined {
  const node = program.nodes[id];
  if (node === undefined) return undefined;
  const datatype = node.datatype;
  const known = (datatype.kind === 'BUILTIN' || datatype.kind === 'NATIVE' || datatype.kind === 'CLASS' || datatype.kind === 'ENUM') && !datatype.metaType && datatype.builtinType !== 'Nil';
  if (!known) return undefined;
  if (datatype.typeSource === 'ANNOTATED_EXPLICIT' || datatype.typeSource === 'ANNOTATED_INFERRED') return datatype;
  if (node.kind !== 'IDENTIFIER' || node.source !== 'LOCAL_VARIABLE') return undefined;
  const scope = program.nodes.find((candidate) => candidate.kind === 'FUNCTION' && within(node, candidate));
  if (scope === undefined) return undefined;
  const reassigned = program.nodes.some((other) => {
    if (other.kind !== 'ASSIGNMENT' || !within(other, scope)) return false;
    const assignee = program.nodes[other.assignee];
    return assignee?.kind === 'IDENTIFIER' && assignee.name === node.name && assignee.source === 'LOCAL_VARIABLE';
  });
  return reassigned ? undefined : datatype;
}

export function connectedCallables(inputs: ConnectedCallableInputs): ConnectedCallables {
  const classes = new Map(inputs.apiDump.classes.map((entry) => [entry.name, entry] as const));
  const byPath = new Map(inputs.programs.map((program) => [program.resPath, program] as const));
  const declares = (resPath: string, name: string): boolean =>
    byPath.get(resPath)?.nodes.some((node) => {
      if (node.kind !== 'FUNCTION') return false;
      const identifier = byPath.get(resPath)?.nodes[node.identifier];
      return identifier?.kind === 'IDENTIFIER' && identifier.name === name;
    }) === true;
  /** The declared argument types of an engine class's signal, up its ancestry. */
  const signalArguments = (className: string, signal: string): readonly (GodotBoundDatatype | undefined)[] | undefined => {
    for (let current = classes.get(className); current !== undefined; current = current.base_class === '' ? undefined : classes.get(current.base_class)) {
      const found = current.signals.find((entry) => entry.name === signal);
      if (found !== undefined) return found.arguments.map((argument) => apiTypeDatatype(inputs.apiDump, argument.type));
    }
    return undefined;
  };

  const sources = new Map<string, (GodotBoundDatatype | undefined)[][]>();
  const accounted = new Set<string>();
  for (const program of inputs.programs) {
    for (const node of program.nodes) {
      if (node.kind !== 'CALL' || node.functionName !== 'connect' || node.arguments.length < 1 || node.arguments.length > 2) continue;
      // `obj.signal.connect(...)`: the Signal read off an object whose engine class is fixed.
      const callee = program.nodes[node.callee];
      if (callee?.kind !== 'SUBSCRIPT' || !callee.isAttribute) continue;
      const signalRead = program.nodes[callee.base];
      if (signalRead?.kind !== 'SUBSCRIPT' || !signalRead.isAttribute) continue;
      const signalName = program.nodes[signalRead.attribute];
      const owner = heldDatatype(program, signalRead.base);
      if (signalName?.kind !== 'IDENTIFIER' || owner?.kind !== 'NATIVE') continue;
      const emitted = signalArguments(owner.nativeType, signalName.name);
      if (emitted === undefined) continue;
      // The Callable: `f`, or `f.bind(a, …)`, `f` a function of this script's chain.
      let callable = program.nodes[node.arguments[0] as number];
      let bound: readonly number[] = [];
      if (callable?.kind === 'CALL' && callable.functionName === 'bind') {
        const bindCallee = program.nodes[callable.callee];
        bound = callable.arguments;
        callable = bindCallee?.kind === 'SUBSCRIPT' && bindCallee.isAttribute ? program.nodes[bindCallee.base] : undefined;
      }
      if (callable?.kind !== 'IDENTIFIER' || callable.source !== 'MEMBER_FUNCTION') continue;
      const site = [program.resPath, ...inputs.scriptAncestors(program.resPath)].find((resPath) => declares(resPath, callable.name));
      if (site === undefined) continue;
      const key = `${site}\0${callable.name}`;
      const rows = sources.get(key) ?? [];
      rows.push([...emitted, ...bound.map((id) => heldDatatype(program, id))]);
      sources.set(key, rows);
      accounted.add(`${program.resPath}\0${String(callable.id)}`);
    }
  }
  return { sources, accounted };
}

/**
 * Whether a call with `argumentCount` arguments can run a GDScript function with these
 * parameters (`argument-count-mismatch`): within its required and declared counts, or any count
 * above the required one for a variadic function.
 */
export function argumentCountRuns(
  program: GodotBoundScript,
  fn: Extract<GodotBoundNode, { kind: 'FUNCTION' }>,
  argumentCount: number,
): boolean {
  const required = fn.parameters.filter((id) => {
    const parameter = program.nodes[id];
    return parameter?.kind === 'PARAMETER' && parameter.initializer < 0;
  }).length;
  if (argumentCount < required) return false;
  return fn.restParameter >= 0 || argumentCount <= fn.parameters.length;
}
