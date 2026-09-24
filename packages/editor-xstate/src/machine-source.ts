/**
 * THE READER: a module's `createMachine(...)` calls, read from its syntax tree into
 * `MachineDefinition`s (`machine-model.ts`). Server-side (it runs the TypeScript compiler); the
 * serving transform and the source routes share it, so the identity a running machine is stamped
 * with and the identity the document opens are computed by one function.
 *
 * Both of XState v5's spellings are machines: `createMachine(config)` and
 * `setup({...}).createMachine(config)`. The config is read where it is written: an object literal
 * in the call, or a `const` in the same module the call names.
 */

import ts from 'typescript';
import type {
  MachineDefinition,
  MachineModule,
  MachineState,
  MachineStateKind,
  MachineTransition,
  MachineTransitionKind,
  SourceSpan,
} from './machine-model';

export interface MachineCall {
  readonly call: ts.CallExpression;
  readonly config: ts.ObjectLiteralExpression | null;
  readonly key: string;
  readonly exportName: string | null;
}

export function parseModule(file: string, code: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind);
}

function isMachineCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'createMachine';
  return ts.isPropertyAccessExpression(callee) && callee.name.text === 'createMachine';
}

function variableNameOf(node: ts.Node): string | null {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isVariableDeclaration(at) && ts.isIdentifier(at.name)) return at.name.text;
    if (ts.isExportAssignment(at)) return 'default';
    if (ts.isFunctionLike(at) || ts.isClassLike(at)) return null;
  }
  return null;
}

function configObject(source: ts.SourceFile, argument: ts.Expression | undefined): ts.ObjectLiteralExpression | null {
  if (!argument) return null;
  const expression = ts.isAsExpression(argument) || ts.isSatisfiesExpression(argument) ? argument.expression : argument;
  if (ts.isObjectLiteralExpression(expression)) return expression;
  if (!ts.isIdentifier(expression)) return null;
  let found: ts.ObjectLiteralExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === expression.text) {
      const init = node.initializer;
      const inner = init && (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) ? init.expression : init;
      if (inner && ts.isObjectLiteralExpression(inner)) found = inner;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Every machine call in a module, in source order, with the key a running actor carries. */
export function findMachineCalls(file: string, source: ts.SourceFile): MachineCall[] {
  const calls: MachineCall[] = [];
  const visit = (node: ts.Node): void => {
    if (isMachineCall(node)) {
      calls.push({
        call: node,
        config: configObject(source, node.arguments[0]),
        exportName: variableNameOf(node),
        key: '',
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const used = new Set<string>();
  return calls.map((call, index) => {
    let name = call.exportName ?? `machine${index}`;
    if (used.has(name)) name = `${name}${index}`;
    used.add(name);
    return { ...call, key: `${file}#${name}` };
  });
}

const span = (node: ts.Node, source: ts.SourceFile): SourceSpan => ({ start: node.getStart(source), end: node.getEnd() });

export function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return null;
}

export function objectProperty(object: ts.ObjectLiteralExpression, key: string): ts.PropertyAssignment | null {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && propertyName(property.name) === key) return property;
  }
  return null;
}

function stringValue(expression: ts.Expression | undefined): string | null {
  if (!expression) return null;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  return null;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let at = expression;
  while (ts.isAsExpression(at) || ts.isSatisfiesExpression(at) || ts.isParenthesizedExpression(at)) at = at.expression;
  return at;
}

/** A name for an action, guard or tag as written: a string, `{ type }`, or the code itself. */
function describe(expression: ts.Expression, source: ts.SourceFile): string {
  const inner = unwrap(expression);
  const text = stringValue(inner);
  if (text !== null) return text;
  if (ts.isObjectLiteralExpression(inner)) {
    const type = stringValue(objectProperty(inner, 'type')?.initializer);
    if (type !== null) return type;
  }
  if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression)) return `${inner.expression.text}(…)`;
  if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) {
    // An inline guard or action is named by what it does: its body, as written.
    const body = inner.body.getText(source).replace(/\s+/g, ' ').replace(/^\{ ?return (.*?);? ?\}$/, '$1');
    return body.length > 48 ? `${body.slice(0, 45)}…` : body;
  }
  const raw = inner.getText(source);
  return raw.length > 40 ? `${raw.slice(0, 37)}…` : raw;
}

function names(expression: ts.Expression | undefined, source: ts.SourceFile): string[] {
  if (!expression) return [];
  const inner = unwrap(expression);
  if (ts.isArrayLiteralExpression(inner)) return inner.elements.map((element) => describe(element, source));
  return [describe(inner, source)];
}

interface RawTransition {
  kind: MachineTransitionKind;
  event: string;
  targets: string[];
  guard?: string;
  actions: string[];
  span: SourceSpan;
}

function readTransitionValue(
  value: ts.Expression,
  kind: MachineTransitionKind,
  event: string,
  source: ts.SourceFile,
  out: RawTransition[],
  opaque: string[],
): void {
  const inner = unwrap(value);
  if (ts.isArrayLiteralExpression(inner)) {
    for (const element of inner.elements) readTransitionValue(element, kind, event, source, out, opaque);
    return;
  }
  const direct = stringValue(inner);
  if (direct !== null) {
    out.push({ kind, event, targets: [direct], actions: [], span: span(inner, source) });
    return;
  }
  if (ts.isObjectLiteralExpression(inner)) {
    const targetNode = objectProperty(inner, 'target')?.initializer;
    const targets: string[] = [];
    if (targetNode) {
      const target = unwrap(targetNode);
      const single = stringValue(target);
      if (single !== null) targets.push(single);
      else if (ts.isArrayLiteralExpression(target)) {
        for (const element of target.elements) {
          const text = stringValue(element);
          if (text !== null) targets.push(text);
          else opaque.push(`${kind} ${event}: a target that is not a string`);
        }
      } else opaque.push(`${kind} ${event}: a target that is not a string`);
    }
    const guardNode = objectProperty(inner, 'guard')?.initializer;
    out.push({
      kind,
      event,
      targets,
      ...(guardNode ? { guard: describe(guardNode, source) } : {}),
      actions: names(objectProperty(inner, 'actions')?.initializer, source),
      span: span(inner, source),
    });
    return;
  }
  if (inner.kind === ts.SyntaxKind.UndefinedKeyword || (ts.isIdentifier(inner) && inner.text === 'undefined')) {
    out.push({ kind, event, targets: [], actions: [], span: span(inner, source) });
    return;
  }
  opaque.push(`${kind} ${event || kind}: not a transition literal`);
}

interface Built {
  state: Omit<MachineState, 'transitions' | 'children'> & { children: Built[] };
  raw: RawTransition[];
}

function readState(
  object: ts.ObjectLiteralExpression,
  key: string,
  id: string,
  source: ts.SourceFile,
): Built {
  const opaque: string[] = [];
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) opaque.push(`a spread (…${property.expression.getText(source)})`);
    else if (property.name && ts.isComputedPropertyName(property.name)) opaque.push(`a computed key ${property.name.getText(source)}`);
  }
  const statesNode = objectProperty(object, 'states')?.initializer;
  const children: Built[] = [];
  if (statesNode) {
    const states = unwrap(statesNode);
    if (ts.isObjectLiteralExpression(states)) {
      for (const property of states.properties) {
        if (!ts.isPropertyAssignment(property)) {
          opaque.push('a child state that is not written as `key: { … }`');
          continue;
        }
        const childKey = propertyName(property.name);
        const value = unwrap(property.initializer);
        if (childKey === null || !ts.isObjectLiteralExpression(value)) {
          opaque.push(`child state ${property.name.getText(source)} is not an object literal`);
          continue;
        }
        children.push(readState(value, childKey, id ? `${id}.${childKey}` : childKey, source));
      }
    } else opaque.push('`states` is not an object literal');
  }
  const type = stringValue(objectProperty(object, 'type')?.initializer);
  const kind: MachineStateKind =
    type === 'parallel' || type === 'final' || type === 'history' ? type : children.length > 0 ? 'compound' : 'atomic';
  const raw: RawTransition[] = [];
  const onNode = objectProperty(object, 'on')?.initializer;
  if (onNode) {
    const on = unwrap(onNode);
    if (ts.isObjectLiteralExpression(on)) {
      for (const property of on.properties) {
        if (!ts.isPropertyAssignment(property)) {
          opaque.push('an `on` entry that is not `EVENT: transition`');
          continue;
        }
        const event = propertyName(property.name);
        if (event === null) {
          opaque.push(`an \`on\` key ${property.name.getText(source)}`);
          continue;
        }
        readTransitionValue(property.initializer, 'on', event, source, raw, opaque);
      }
    } else opaque.push('`on` is not an object literal');
  }
  const always = objectProperty(object, 'always')?.initializer;
  if (always) readTransitionValue(always, 'always', '', source, raw, opaque);
  const afterNode = objectProperty(object, 'after')?.initializer;
  if (afterNode) {
    const after = unwrap(afterNode);
    if (ts.isObjectLiteralExpression(after)) {
      for (const property of after.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const delay = propertyName(property.name) ?? property.name.getText(source);
        readTransitionValue(property.initializer, 'after', delay, source, raw, opaque);
      }
    }
  }
  const onDone = objectProperty(object, 'onDone')?.initializer;
  if (onDone) readTransitionValue(onDone, 'onDone', '', source, raw, opaque);
  const initial = stringValue(objectProperty(object, 'initial')?.initializer);
  const declaredId = stringValue(objectProperty(object, 'id')?.initializer);
  const description = stringValue(objectProperty(object, 'description')?.initializer);
  const meta = objectProperty(object, 'meta')?.initializer;
  return {
    state: {
      id,
      key,
      kind,
      ...(initial !== null ? { initial } : {}),
      ...(declaredId !== null ? { declaredId } : {}),
      children,
      entry: names(objectProperty(object, 'entry')?.initializer, source),
      exit: names(objectProperty(object, 'exit')?.initializer, source),
      tags: names(objectProperty(object, 'tags')?.initializer, source),
      ...(description !== null ? { description } : {}),
      ...(meta ? { meta: meta.getText(source) } : {}),
      opaque,
      span: span(object, source),
    },
    raw,
  };
}

/**
 * XState v5's target rules, over the read tree: `#id` (a declared id, or the machine's own id
 * followed by a path), `.child` (below the source), and a bare key path (a sibling of the source,
 * so resolved from its parent).
 */
export function resolveTarget(
  target: string,
  sourceId: string,
  byId: ReadonlyMap<string, Built['state']>,
  declared: ReadonlyMap<string, string>,
  machineId: string | null,
): string | null {
  const walk = (from: string, path: readonly string[]): string | null => {
    let at = from;
    for (const segment of path) {
      const next = at ? `${at}.${segment}` : segment;
      if (!byId.has(next)) return null;
      at = next;
    }
    return at;
  };
  if (target.startsWith('#')) {
    const [head = '', ...rest] = target.slice(1).split('.');
    if (machineId !== null && head === machineId) return walk('', rest);
    const base = declared.get(head);
    return base === undefined ? null : walk(base, rest);
  }
  if (target.startsWith('.')) return walk(sourceId, target.slice(1).split('.'));
  const parent = sourceId.includes('.') ? sourceId.slice(0, sourceId.lastIndexOf('.')) : '';
  return sourceId === '' ? walk('', target.split('.')) : walk(parent, target.split('.'));
}

function finish(built: Built, byId: Map<string, Built['state']>, declared: Map<string, string>, machineId: string | null): MachineState {
  const transitions: MachineTransition[] = [];
  const counts = new Map<string, number>();
  for (const raw of built.raw) {
    const base = `${built.state.id}|${raw.kind}|${raw.event}`;
    const index = counts.get(base) ?? 0;
    counts.set(base, index + 1);
    transitions.push({
      id: `${base}|${index}`,
      source: built.state.id,
      kind: raw.kind,
      event: raw.event,
      targets: raw.targets,
      resolved: raw.targets.map((target) => resolveTarget(target, built.state.id, byId, declared, machineId)),
      ...(raw.guard !== undefined ? { guard: raw.guard } : {}),
      actions: raw.actions,
      span: raw.span,
    });
  }
  return {
    ...built.state,
    children: built.state.children.map((child) => finish(child, byId, declared, machineId)),
    transitions,
  };
}

function index(built: Built, byId: Map<string, Built['state']>, declared: Map<string, string>): void {
  byId.set(built.state.id, built.state);
  if (built.state.declaredId !== undefined) declared.set(built.state.declaredId, built.state.id);
  for (const child of built.state.children) index(child, byId, declared);
}

export function readMachine(call: MachineCall, file: string, source: ts.SourceFile): MachineDefinition | null {
  if (!call.config) return null;
  const built = readState(call.config, '', '', source);
  const byId = new Map<string, Built['state']>();
  const declared = new Map<string, string>();
  index(built, byId, declared);
  const machineId = built.state.declaredId ?? null;
  return {
    key: call.key,
    file,
    exportName: call.exportName,
    machineId,
    root: finish(built, byId, declared, machineId),
    span: span(call.call, source),
  };
}

/** Every machine a module declares, read. */
export function readMachineModule(file: string, code: string): MachineModule {
  const source = parseModule(file, code);
  const machines: MachineDefinition[] = [];
  const notes: string[] = [];
  for (const call of findMachineCalls(file, source)) {
    const machine = readMachine(call, file, source);
    if (machine) machines.push(machine);
    else notes.push(`${call.key}: the machine's config is not an object literal in this module, so it cannot be drawn.`);
  }
  return { file, machines, notes };
}
