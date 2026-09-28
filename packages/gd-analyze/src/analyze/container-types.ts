/**
 * What an untyped script member's Array or Dictionary holds, from every value the program puts in
 * it. Godot's untyped containers store Variants (`Array` is a `Vector<Variant>`,
 * core/variant/array.cpp; `Dictionary` a `HashMap<Variant, Variant>`, core/variant/dictionary.cpp),
 * so a read of one element is a Variant to the official analyzer. Where the program itself fixes
 * what goes in, the read is that value's type:
 *
 * - `container-element-type`: a member initialized to an array literal holds, as each element, the
 *   one datatype of the literal's elements and of every value stored in it (`append`, `push_back`,
 *   `push_front`, `insert`, `a[i] = v`); an element read (`a[i]`, `pop_front`, `pop_back`, `front`,
 *   `back`, a `for` over it) is that datatype. A member initialized to a dictionary literal holds
 *   the one datatype of its keys and of its values (`d[k] = v`), read by `d[k]`, and a `for` over
 *   `d` or `d.keys()` binds a key. An element that is itself a fresh array literal is an array
 *   typed the same way through every read of it (`d[k] = []` then `d[k].append(x)`).
 * - `record-field-type`: an element built only from dictionary literals with the same literal string
 *   keys, each key's values one datatype, and only ever read by a literal key (`e["path"]`,
 *   `e.path`, directly or through a local that holds it), is a record: the read of a key is that
 *   key's datatype.
 *
 * The member qualifies only when the program can see every store: it is not exported, static or
 * given accessors, no script extends its script, no string anywhere names it (reflection), no
 * attribute of that name is read on any object (`Audio.queue` from another script), and every read
 * of it is one of the uses above, a `size`/`is_empty`/`has`/`erase`/`clear`/`find`/`count`, or a
 * discarded statement. A use outside that list (passing it on, assigning it, another method) leaves
 * it untyped, and so does a stored value whose datatype is unknown or differs from the others.
 *
 * An element read past the end is `null` with an error in Godot (`Array::pop_front`,
 * core/variant/array.cpp:792); the element datatype describes every value the container can hold,
 * as a typed `Array[T]` would.
 */
import type { GodotBoundDatatype, GodotBoundNode, GodotBoundScript } from '../godot-frontend/bound-program';

function builtinDatatype(name: string): GodotBoundDatatype {
  return {
    kind: 'BUILTIN',
    typeSource: 'INFERRED',
    constant: false,
    readOnly: false,
    metaType: false,
    pseudoType: false,
    coroutine: false,
    display: name,
    builtinType: name,
    nativeType: '',
    enumType: '',
    scriptPath: '',
    className: '',
    containerTypes: [],
    enumValues: [],
  };
}

export type ContainerRuleId = 'container-element-type' | 'record-field-type';

export interface ContainerProjectIndex {
  /** Names a string literal spells in some script. */
  readonly spelled: ReadonlySet<string>;
  /** Attribute names read or written on some object (`x.name`). */
  readonly attributes: ReadonlySet<string>;
  /** Scripts some other script extends. */
  readonly extended: ReadonlySet<string>;
}

export function containerProjectIndex(
  programs: readonly GodotBoundScript[],
  scriptAncestors: (resPath: string) => readonly string[],
): ContainerProjectIndex {
  const spelled = new Set<string>();
  const attributes = new Set<string>();
  const extended = new Set<string>();
  for (const program of programs) {
    for (const ancestor of scriptAncestors(program.resPath)) extended.add(ancestor);
    for (const node of program.nodes) {
      if (node.kind === 'LITERAL' && (node.value.kind === 'string' || node.value.kind === 'string-name')) spelled.add(node.value.value);
      if (node.kind === 'SUBSCRIPT' && node.isAttribute) {
        const attribute = program.nodes[node.attribute];
        if (attribute?.kind === 'IDENTIFIER') attributes.add(attribute.name);
      }
    }
  }
  return { spelled, attributes, extended };
}

export interface ContainerTypeInputs {
  readonly program: GodotBoundScript;
  readonly index: ContainerProjectIndex;
  /** A node's datatype as the refinement reads it (its refined datatype, else the analyzer's). */
  readonly datatypeOf: (id: number) => GodotBoundDatatype | undefined;
  /** Whether the refinement fixed the node's datatype (else it is the analyzer's own). */
  readonly refinedOf: (id: number) => GodotBoundDatatype | undefined;
}

/** What a container slot holds. */
type Content =
  | { readonly kind: 'value'; readonly datatype: GodotBoundDatatype }
  | { readonly kind: 'record'; readonly fields: ReadonlyMap<string, GodotBoundDatatype> }
  | { readonly kind: 'array'; readonly element: Content | undefined }
  | { readonly kind: 'map'; readonly key: GodotBoundDatatype; readonly value: Content | undefined };

export interface ContainerTyped {
  readonly datatype: GodotBoundDatatype;
  readonly rule: ContainerRuleId;
  /** The stored value expressions the read can yield (for the values `resource-loads.ts` follows). */
  readonly sources: readonly number[];
}

const INSERTING: Readonly<Record<string, number>> = { append: 0, push_back: 0, push_front: 0, insert: 1 };
const ELEMENT_RESULT: ReadonlySet<string> = new Set(['pop_front', 'pop_back', 'front', 'back']);
const ARRAY_NEUTRAL: ReadonlySet<string> = new Set(['size', 'is_empty', 'has', 'erase', 'clear', 'find', 'count']);
const MAP_NEUTRAL: ReadonlySet<string> = new Set(['size', 'is_empty', 'has', 'erase', 'clear']);

function contentDatatype(content: Content): GodotBoundDatatype {
  switch (content.kind) {
    case 'value':
      return content.datatype;
    case 'array':
      return builtinDatatype('Array');
    default:
      return builtinDatatype('Dictionary');
  }
}

function sameType(a: GodotBoundDatatype, b: GodotBoundDatatype): boolean {
  const builtin = (d: GodotBoundDatatype) => (d.kind === 'ENUM' ? 'int' : d.builtinType);
  const kind = (d: GodotBoundDatatype) => (d.kind === 'ENUM' ? 'BUILTIN' : d.kind);
  return kind(a) === kind(b) && builtin(a) === builtin(b) && a.nativeType === b.nativeType && a.scriptPath === b.scriptPath;
}

function within(inner: GodotBoundNode, outer: GodotBoundNode): boolean {
  return (
    (inner.startLine > outer.startLine || (inner.startLine === outer.startLine && inner.startColumn >= outer.startColumn)) &&
    (inner.endLine < outer.endLine || (inner.endLine === outer.endLine && inner.endColumn <= outer.endColumn))
  );
}

type Parent = { readonly node: GodotBoundNode; readonly field: string };

/** Each node's parent, by the fields that hold child expressions and statements. */
function parents(program: GodotBoundScript): ReadonlyMap<number, Parent> {
  const found = new Map<number, Parent>();
  const set = (child: number, node: GodotBoundNode, field: string) => {
    if (child >= 0) found.set(child, { node, field });
  };
  for (const node of program.nodes) {
    switch (node.kind) {
      case 'ARRAY':
        for (const id of node.elements) set(id, node, 'elements');
        break;
      case 'DICTIONARY':
        for (const entry of node.elements) {
          set(entry.key, node, 'key');
          set(entry.value, node, 'value');
        }
        break;
      case 'CALL':
        set(node.callee, node, 'callee');
        for (const id of node.arguments) set(id, node, 'arguments');
        break;
      case 'SUBSCRIPT':
        set(node.base, node, 'base');
        set(node.index, node, 'index');
        set(node.attribute, node, 'attribute');
        break;
      case 'ASSIGNMENT':
        set(node.assignee, node, 'assignee');
        set(node.assignedValue, node, 'assignedValue');
        break;
      case 'BINARY_OPERATOR':
        set(node.leftOperand, node, 'leftOperand');
        set(node.rightOperand, node, 'rightOperand');
        break;
      case 'UNARY_OPERATOR':
        set(node.operand, node, 'operand');
        break;
      case 'TERNARY_OPERATOR':
        set(node.condition, node, 'condition');
        set(node.trueExpression, node, 'trueExpression');
        set(node.falseExpression, node, 'falseExpression');
        break;
      case 'CAST':
        set(node.operand, node, 'operand');
        break;
      case 'TYPE_TEST':
        set(node.operand, node, 'operand');
        break;
      case 'AWAIT':
        set(node.toAwait, node, 'toAwait');
        break;
      case 'RETURN':
        set(node.returnValue, node, 'returnValue');
        break;
      case 'ASSERT':
        set(node.condition, node, 'condition');
        set(node.message, node, 'message');
        break;
      case 'IF':
        set(node.condition, node, 'condition');
        break;
      case 'WHILE':
        set(node.condition, node, 'condition');
        break;
      case 'FOR':
        set(node.variable, node, 'variable');
        set(node.list, node, 'list');
        break;
      case 'MATCH':
        set(node.test, node, 'test');
        break;
      case 'VARIABLE':
      case 'CONSTANT':
      case 'PARAMETER':
        set(node.identifier, node, 'identifier');
        set(node.initializer, node, 'initializer');
        break;
      case 'SUITE':
        for (const id of node.statements) set(id, node, 'statements');
        break;
      case 'LAMBDA':
        for (const id of node.captures) set(id, node, 'captures');
        break;
      default:
        break;
    }
  }
  return found;
}

export function containerTypes(inputs: ContainerTypeInputs): (id: number) => ContainerTyped | undefined {
  const { program, index } = inputs;
  const nodes = program.nodes;
  const parentOf = parents(program);
  const root = nodes[program.rootNodeId];
  const identifierName = (id: number): string | undefined => {
    const node = nodes[id];
    return node?.kind === 'IDENTIFIER' ? node.name : undefined;
  };
  const functionOf = (node: GodotBoundNode) => nodes.find((candidate) => candidate.kind === 'FUNCTION' && within(node, candidate));
  const assignedIn = (scope: GodotBoundNode, name: string, source: string): boolean =>
    nodes.some((other) => {
      if (other.kind !== 'ASSIGNMENT' || !within(other, scope)) return false;
      const assignee = nodes[other.assignee];
      return assignee?.kind === 'IDENTIFIER' && assignee.name === name && assignee.source === source;
    });

  /** A stored value's datatype: known, not a container, and not a weak (reassignable) inference. */
  const valueType = (id: number): GodotBoundDatatype | undefined => {
    const node = nodes[id];
    const datatype = inputs.datatypeOf(id);
    if (node === undefined || datatype === undefined || datatype.metaType) return undefined;
    if (datatype.kind !== 'BUILTIN' && datatype.kind !== 'NATIVE' && datatype.kind !== 'CLASS' && datatype.kind !== 'ENUM') return undefined;
    if (datatype.builtinType === 'Nil' || (datatype.kind === 'BUILTIN' && (datatype.builtinType === 'Array' || datatype.builtinType === 'Dictionary'))) return undefined;
    if (inputs.refinedOf(id) === undefined && datatype.typeSource === 'INFERRED' && node.kind === 'IDENTIFIER') {
      // The analyzer's weak datatype for an untyped variable holds only while nothing reassigns it.
      if (node.source !== 'LOCAL_VARIABLE') return undefined;
      const scope = functionOf(node);
      if (scope === undefined || assignedIn(scope, node.name, 'LOCAL_VARIABLE')) return undefined;
    }
    return datatype.kind === 'ENUM' ? builtinDatatype('int') : datatype;
  };

  /**
   * The reads a value flows to: the expression itself, or, when it initializes an untyped local
   * that nothing reassigns, every read of that local.
   */
  const flows = (id: number): readonly number[] | undefined => {
    const parent = parentOf.get(id);
    if (parent?.node.kind !== 'VARIABLE' || parent.field !== 'initializer') return [id];
    const declaration = parent.node;
    if (declaration.datatypeSpecifier >= 0) return undefined;
    const name = identifierName(declaration.identifier);
    const scope = functionOf(declaration);
    if (name === undefined || scope === undefined || assignedIn(scope, name, 'LOCAL_VARIABLE')) return undefined;
    return nodes
      .filter((candidate) => candidate.kind === 'IDENTIFIER' && candidate.name === name && candidate.source === 'LOCAL_VARIABLE' && within(candidate, scope) && candidate.id !== declaration.identifier && candidate.startLine >= declaration.startLine)
      .map((candidate) => candidate.id);
  };

  /** The reads of a `for` loop's variable, when nothing in the loop assigns it. */
  const iteratorReads = (loop: Extract<GodotBoundNode, { kind: 'FOR' }>): readonly number[] | undefined => {
    const name = identifierName(loop.variable);
    const body = nodes[loop.loop];
    if (name === undefined || body === undefined || loop.datatypeSpecifier >= 0 || assignedIn(body, name, 'LOCAL_ITERATOR')) return undefined;
    return nodes.filter((candidate) => candidate.kind === 'IDENTIFIER' && candidate.name === name && candidate.source === 'LOCAL_ITERATOR' && within(candidate, body)).map((candidate) => candidate.id);
  };

  /** The method call a read is the receiver of (`read.method(...)`). */
  const methodCall = (read: number): { readonly name: string; readonly call: Extract<GodotBoundNode, { kind: 'CALL' }> } | undefined => {
    const attribute = parentOf.get(read);
    if (attribute?.node.kind !== 'SUBSCRIPT' || !attribute.node.isAttribute || attribute.field !== 'base') return undefined;
    const call = parentOf.get(attribute.node.id);
    const name = identifierName(attribute.node.attribute);
    if (call?.node.kind !== 'CALL' || call.field !== 'callee' || name === undefined) return undefined;
    return { name, call: call.node };
  };
  const discarded = (id: number): boolean => parentOf.get(id)?.node.kind === 'SUITE';
  const isInt = (id: number): boolean => {
    const datatype = inputs.datatypeOf(id);
    return (datatype?.kind === 'BUILTIN' && datatype.builtinType === 'int') || datatype?.kind === 'ENUM';
  };

  /** What a slot holds, from the values stored in it; `reads` are where the program reads a value of it. */
  type Produced = Map<number, ContainerTyped>;
  const settle = (stored: readonly number[], reads: readonly number[], produced: Produced): Content | undefined => {
    if (stored.length === 0) return undefined;
    const all = (kind: GodotBoundNode['kind']) => stored.every((id) => nodes[id]?.kind === kind);
    if (all('ARRAY')) {
      const literals = stored.map((id) => nodes[id] as Extract<GodotBoundNode, { kind: 'ARRAY' }>);
      return array(literals, reads, produced);
    }
    if (all('DICTIONARY')) {
      const literals = stored.map((id) => nodes[id] as Extract<GodotBoundNode, { kind: 'DICTIONARY' }>);
      return record(literals, reads, produced);
    }
    let agreed: GodotBoundDatatype | undefined;
    for (const id of stored) {
      const type = valueType(id);
      if (type === undefined || (agreed !== undefined && !sameType(agreed, type))) return undefined;
      agreed = type;
    }
    if (agreed === undefined) return undefined;
    const datatype = agreed;
    for (const read of reads) produced.set(read, { datatype, rule: 'container-element-type', sources: stored });
    return { kind: 'value', datatype };
  };

  /** Arrays created as these literals and read at `reads`. */
  const array = (literals: readonly Extract<GodotBoundNode, { kind: 'ARRAY' }>[], reads: readonly number[], produced: Produced): Content | undefined => {
    const stored: number[] = literals.flatMap((literal) => literal.elements);
    const elementReads: number[] = [];
    const pending = [...reads];
    while (pending.length > 0) {
      const read = pending.pop() as number;
      const parent = parentOf.get(read);
      const method = methodCall(read);
      if (method !== undefined) {
        const inserted = INSERTING[method.name];
        if (inserted !== undefined) {
          const value = method.call.arguments[inserted];
          if (value === undefined || method.call.arguments.length !== inserted + 1) return undefined;
          stored.push(value);
        } else if (ELEMENT_RESULT.has(method.name) && method.call.arguments.length === 0) {
          const flowed = flows(method.call.id);
          if (flowed === undefined) return undefined;
          if (!discarded(method.call.id)) elementReads.push(...flowed);
        } else if (!ARRAY_NEUTRAL.has(method.name)) {
          return undefined;
        }
        continue;
      }
      if (parent?.node.kind === 'SUBSCRIPT' && !parent.node.isAttribute && parent.field === 'base') {
        if (!isInt(parent.node.index)) return undefined;
        const store = parentOf.get(parent.node.id);
        if (store?.node.kind === 'ASSIGNMENT' && store.field === 'assignee') {
          if (store.node.operation !== 'OP_NONE') return undefined;
          stored.push(store.node.assignedValue);
          continue;
        }
        const flowed = flows(parent.node.id);
        if (flowed === undefined) return undefined;
        elementReads.push(...flowed);
        continue;
      }
      if (parent?.node.kind === 'FOR' && parent.field === 'list') {
        const iterated = iteratorReads(parent.node);
        if (iterated === undefined) return undefined;
        elementReads.push(...iterated);
        continue;
      }
      if (parent?.node.kind === 'VARIABLE' && parent.field === 'initializer') {
        const flowed = flows(read);
        if (flowed === undefined) return undefined;
        pending.push(...flowed);
        continue;
      }
      if (discarded(read)) continue;
      return undefined;
    }
    if (stored.length === 0) return { kind: 'array', element: undefined };
    const element = settle(stored, elementReads, produced);
    return element === undefined ? undefined : { kind: 'array', element };
  };

  /** Dictionaries created as these literals (a record when their keys are fixed strings), read at `reads`. */
  const record = (literals: readonly Extract<GodotBoundNode, { kind: 'DICTIONARY' }>[], reads: readonly number[], produced: Produced): Content | undefined => {
    const keyOf = (id: number): string | undefined => {
      const key = nodes[id];
      return key?.kind === 'LITERAL' && (key.value.kind === 'string' || key.value.kind === 'string-name') ? key.value.value : undefined;
    };
    const literalKeys = literals.every((literal) => literal.elements.length > 0 && literal.elements.every((entry) => keyOf(entry.key) !== undefined));
    if (!literalKeys) return map(literals, reads, produced);
    // A record: every literal has the same keys, each key's values one datatype.
    const fields = new Map<string, GodotBoundDatatype>();
    const first = literals[0] as Extract<GodotBoundNode, { kind: 'DICTIONARY' }>;
    const keySet = (literal: Extract<GodotBoundNode, { kind: 'DICTIONARY' }>) => literal.elements.map((entry) => keyOf(entry.key) as string).sort().join('\0');
    if (new Set(first.elements.map((entry) => keyOf(entry.key))).size !== first.elements.length) return undefined;
    for (const literal of literals) {
      if (keySet(literal) !== keySet(first)) return undefined;
      for (const entry of literal.elements) {
        const key = keyOf(entry.key) as string;
        const type = valueType(entry.value);
        const known = fields.get(key);
        if (type === undefined || (known !== undefined && !sameType(known, type))) return undefined;
        fields.set(key, type);
      }
    }
    const pending = [...reads];
    const fieldReads: [number, GodotBoundDatatype, string][] = [];
    while (pending.length > 0) {
      const read = pending.pop() as number;
      const parent = parentOf.get(read);
      if (parent?.node.kind === 'SUBSCRIPT' && parent.field === 'base') {
        const key = parent.node.isAttribute ? identifierName(parent.node.attribute) : keyOf(parent.node.index);
        const type = key === undefined ? undefined : fields.get(key);
        const use = parentOf.get(parent.node.id);
        if (type === undefined || (use?.node.kind === 'ASSIGNMENT' && use.field === 'assignee') || (use?.node.kind === 'CALL' && use.field === 'callee')) return undefined;
        fieldReads.push([parent.node.id, type, key as string]);
        continue;
      }
      if (parent?.node.kind === 'VARIABLE' && parent.field === 'initializer') {
        const flowed = flows(read);
        if (flowed === undefined) return undefined;
        pending.push(...flowed);
        continue;
      }
      if (discarded(read)) continue;
      return undefined;
    }
    for (const read of reads) produced.set(read, { datatype: builtinDatatype('Dictionary'), rule: 'container-element-type', sources: literals.map((literal) => literal.id) });
    for (const [id, datatype, key] of fieldReads) {
      const sources = literals.flatMap((literal) => literal.elements.filter((entry) => keyOf(entry.key) === key).map((entry) => entry.value));
      produced.set(id, { datatype, rule: 'record-field-type', sources });
    }
    return { kind: 'record', fields };
  };

  /** Dictionaries keyed by values, created as these literals and read at `reads`. */
  const map = (literals: readonly Extract<GodotBoundNode, { kind: 'DICTIONARY' }>[], reads: readonly number[], produced: Produced): Content | undefined => {
    const keys: number[] = literals.flatMap((literal) => literal.elements.map((entry) => entry.key));
    const values: number[] = literals.flatMap((literal) => literal.elements.map((entry) => entry.value));
    const keyReads: number[] = [];
    const valueReads: number[] = [];
    const pending = [...reads];
    const iterate = (loop: Extract<GodotBoundNode, { kind: 'FOR' }>): boolean => {
      const iterated = iteratorReads(loop);
      if (iterated === undefined) return false;
      keyReads.push(...iterated);
      return true;
    };
    while (pending.length > 0) {
      const read = pending.pop() as number;
      const parent = parentOf.get(read);
      const method = methodCall(read);
      if (method !== undefined) {
        if (method.name === 'keys' && method.call.arguments.length === 0) {
          const loop = parentOf.get(method.call.id);
          if (loop?.node.kind !== 'FOR' || loop.field !== 'list' || !iterate(loop.node)) return undefined;
        } else if (!MAP_NEUTRAL.has(method.name)) {
          return undefined;
        }
        continue;
      }
      if (parent?.node.kind === 'SUBSCRIPT' && !parent.node.isAttribute && parent.field === 'base') {
        const store = parentOf.get(parent.node.id);
        if (store?.node.kind === 'ASSIGNMENT' && store.field === 'assignee') {
          if (store.node.operation !== 'OP_NONE') return undefined;
          keys.push(parent.node.index);
          values.push(store.node.assignedValue);
          continue;
        }
        const flowed = flows(parent.node.id);
        if (flowed === undefined) return undefined;
        valueReads.push(...flowed);
        continue;
      }
      if (parent?.node.kind === 'FOR' && parent.field === 'list') {
        if (!iterate(parent.node)) return undefined;
        continue;
      }
      if (parent?.node.kind === 'VARIABLE' && parent.field === 'initializer') {
        const flowed = flows(read);
        if (flowed === undefined) return undefined;
        pending.push(...flowed);
        continue;
      }
      if (discarded(read)) continue;
      return undefined;
    }
    let key: GodotBoundDatatype | undefined;
    for (const id of keys) {
      const type = valueType(id);
      if (type === undefined || (key !== undefined && !sameType(key, type))) return undefined;
      key = type;
    }
    if (key === undefined) return undefined;
    const value = settle(values, valueReads, produced);
    if (value === undefined) return undefined;
    const keyType = key;
    for (const read of keyReads) produced.set(read, { datatype: keyType, rule: 'container-element-type', sources: keys });
    if (value.kind !== 'value') for (const read of valueReads) produced.set(read, { datatype: contentDatatype(value), rule: 'container-element-type', sources: values });
    return { kind: 'map', key: keyType, value };
  };

  /** Every read a member's container analysis types, computed once per member. */
  const members = new Map<string, Produced | null>();
  const memberProduced = (name: string): Produced | undefined => {
    if (members.has(name)) return members.get(name) ?? undefined;
    members.set(name, null);
    if (root?.kind !== 'CLASS' || index.extended.has(program.resPath) || index.spelled.has(name) || index.attributes.has(name)) return undefined;
    const declaration = root.members
      .map((id) => nodes[id])
      .find((member) => member?.kind === 'VARIABLE' && identifierName(member.identifier) === name);
    if (declaration?.kind !== 'VARIABLE' || declaration.static || declaration.exported || declaration.onready || declaration.setter >= 0 || declaration.getter >= 0 || declaration.datatypeSpecifier >= 0) return undefined;
    const initializer = nodes[declaration.initializer];
    if (initializer?.kind !== 'ARRAY' && initializer?.kind !== 'DICTIONARY') return undefined;
    const reads = nodes
      .filter((node) => node.kind === 'IDENTIFIER' && node.name === name && (node.source === 'MEMBER_VARIABLE' || node.source === 'INHERITED_VARIABLE') && node.id !== declaration.identifier)
      .map((node) => node.id);
    const produced: Produced = new Map();
    const content =
      initializer.kind === 'ARRAY'
        ? array([initializer], reads, produced)
        : initializer.elements.length === 0
          ? map([initializer], reads, produced)
          : record([initializer], reads, produced);
    // A member dictionary that is itself a record is typed by the analyzer's own member reads; only
    // what its elements produce is reported.
    if (content === undefined || content.kind === 'record') return undefined;
    members.set(name, produced);
    return produced;
  };

  /**
   * The member a value is read out of (`m[i]`, `m.pop_front()`, `m[k][j]`, a local or loop variable
   * holding one): only that member's analysis can type it.
   */
  const rootMember = (id: number, depth = 0): string | undefined => {
    const node = nodes[id];
    if (node === undefined || depth > 16) return undefined;
    if (node.kind === 'SUBSCRIPT') return rootMember(node.base, depth + 1);
    if (node.kind === 'CALL') {
      const callee = nodes[node.callee];
      return callee?.kind === 'SUBSCRIPT' && callee.isAttribute ? rootMember(callee.base, depth + 1) : undefined;
    }
    if (node.kind !== 'IDENTIFIER') return undefined;
    if (node.source === 'MEMBER_VARIABLE' || node.source === 'INHERITED_VARIABLE') return node.name;
    const scope = functionOf(node);
    if (scope === undefined) return undefined;
    if (node.source === 'LOCAL_VARIABLE') {
      const declaration = nodes.find((candidate) => candidate.kind === 'VARIABLE' && within(candidate, scope) && identifierName(candidate.identifier) === node.name);
      return declaration?.kind === 'VARIABLE' && declaration.initializer >= 0 ? rootMember(declaration.initializer, depth + 1) : undefined;
    }
    if (node.source === 'LOCAL_ITERATOR') {
      const loop = nodes.find((candidate) => candidate.kind === 'FOR' && within(node, candidate) && identifierName(candidate.variable) === node.name);
      return loop?.kind === 'FOR' ? rootMember(loop.list, depth + 1) : undefined;
    }
    return undefined;
  };
  return (id: number): ContainerTyped | undefined => {
    const name = rootMember(id);
    return name === undefined ? undefined : memberProduced(name)?.get(id);
  };
}
