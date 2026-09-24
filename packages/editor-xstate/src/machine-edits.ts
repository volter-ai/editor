/**
 * THE WRITER: a `MachineEdit` applied to the module's own text. Each edit re-parses the module,
 * finds the exact syntax it changes and splices only that, so everything the edit does not name
 * (comments, formatting, actions, guards, the code around the machine) is byte-for-byte what the
 * author wrote. An edit that would leave the machine wrong (a target nothing resolves, a removed
 * state something still targets) is refused with the reason, and nothing is written.
 */

import ts from 'typescript';
import {
  findMachineState,
  findMachineTransition,
  type MachineDefinition,
  type MachineEdit,
  machineStates,
  type MachineState,
} from './machine-model';
import {
  findMachineCalls,
  objectProperty,
  parseModule,
  propertyName,
  readMachine,
} from './machine-source';

interface Splice {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function apply(code: string, splices: readonly Splice[]): string {
  let out = code;
  for (const splice of [...splices].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, splice.start) + splice.text + out.slice(splice.end);
  }
  return out;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const keyText = (key: string): string => (IDENTIFIER.test(key) ? key : `'${key.replace(/'/g, "\\'")}'`);
const quote = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function indentAt(code: string, position: number): string {
  const lineStart = code.lastIndexOf('\n', position - 1) + 1;
  return /^[ \t]*/.exec(code.slice(lineStart))?.[0] ?? '';
}

/** The unit of indentation the module uses (two spaces when it shows none). */
function indentUnit(code: string): string {
  const match = /\n([ \t]+)\S/.exec(code);
  if (!match?.[1]) return '  ';
  return match[1].startsWith('\t') ? '\t' : match[1].length >= 4 && match[1].length % 4 === 0 ? '    ' : '  ';
}

/** Insert `key: value` as the last property of an object literal, in the module's own style. */
function addProperty(code: string, object: ts.ObjectLiteralExpression, source: ts.SourceFile, key: string, value: string): Splice {
  const unit = indentUnit(code);
  const outer = indentAt(code, object.getStart(source));
  const inner = outer + unit;
  const properties = object.properties;
  if (properties.length === 0) {
    return { start: object.getStart(source), end: object.getEnd(), text: `{\n${inner}${key}: ${value},\n${outer}}` };
  }
  const last = properties[properties.length - 1]!;
  const lastIndent = indentAt(code, last.getStart(source));
  const multiline = code.slice(object.getStart(source), object.getEnd()).includes('\n');
  const after = code.slice(last.getEnd(), object.getEnd() - 1);
  const hasTrailingComma = /^\s*,/.test(after);
  if (!multiline) {
    return { start: last.getEnd(), end: last.getEnd(), text: `, ${key}: ${value}` };
  }
  const insertAt = hasTrailingComma ? last.getEnd() + after.indexOf(',') + 1 : last.getEnd();
  return { start: insertAt, end: insertAt, text: `${hasTrailingComma ? '' : ','}\n${lastIndent}${key}: ${value}${hasTrailingComma ? ',' : ''}` };
}

/** Remove one element of a comma-separated list (properties, array elements), with its comma. */
function removeListItem(code: string, node: ts.Node, list: ts.NodeArray<ts.Node>): Splice {
  const at = list.indexOf(node as never);
  const next = list[at + 1];
  const previous = list[at - 1];
  if (next) return { start: node.getFullStart(), end: next.getFullStart(), text: '' };
  if (previous) {
    // A list written with trailing commas keeps the previous item's comma; one without them
    // loses the comma that separated the removed item.
    const comma = code.slice(node.getEnd(), list.end).indexOf(',');
    return comma >= 0
      ? { start: node.getFullStart(), end: node.getEnd() + comma + 1, text: '' }
      : { start: previous.getEnd(), end: node.getEnd(), text: '' };
  }
  return { start: node.getFullStart(), end: list.end, text: '' };
}

function unwrap(expression: ts.Expression): ts.Expression {
  let at = expression;
  while (ts.isAsExpression(at) || ts.isSatisfiesExpression(at) || ts.isParenthesizedExpression(at)) at = at.expression;
  return at;
}

function objectOf(expression: ts.Expression | undefined): ts.ObjectLiteralExpression | null {
  if (!expression) return null;
  const inner = unwrap(expression);
  return ts.isObjectLiteralExpression(inner) ? inner : null;
}

/** The config object literal of the state `id` (`''` is the root). */
function stateObject(config: ts.ObjectLiteralExpression, id: string): ts.ObjectLiteralExpression | null {
  if (id === '') return config;
  let at: ts.ObjectLiteralExpression | null = config;
  for (const segment of id.split('.')) {
    const states = objectOf(at ? objectProperty(at, 'states')?.initializer : undefined);
    at = objectOf(states ? objectProperty(states, segment)?.initializer : undefined);
    if (!at) return null;
  }
  return at;
}

/** The syntax node of one read transition: found again by its span in the fresh parse. */
function nodeAtSpan(source: ts.SourceFile, start: number, end: number): ts.Expression | null {
  let found: ts.Expression | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node.getStart(source) === start && node.getEnd() === end && ts.isExpression(node)) {
      found = node;
      return;
    }
    if (node.getStart(source) <= start && node.getEnd() >= end) ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** How a transition in `source` must spell `target`, by XState's own resolution rules. */
function targetString(machine: MachineDefinition, sourceId: string, targetId: string): string {
  const parent = sourceId.includes('.') ? sourceId.slice(0, sourceId.lastIndexOf('.')) : '';
  if (sourceId !== '' && targetId.startsWith(sourceId + '.')) return `.${targetId.slice(sourceId.length + 1)}`;
  if (sourceId === '') return targetId;
  if (parent === '' || targetId.startsWith(parent + '.')) return parent === '' ? targetId : targetId.slice(parent.length + 1);
  if (machine.machineId !== null) return `#${machine.machineId}.${targetId}`;
  throw new Error(
    `${targetId} is not below ${sourceId}'s parent, so XState can only reach it by id, and this machine declares none. ` +
      'Give the machine an `id` to target across levels.',
  );
}

function descendsFrom(id: string, ancestor: string): boolean {
  return id === ancestor || id.startsWith(ancestor + '.');
}

/** Rewrite one target string so it still names the same state after `renamed` becomes `key`. */
function renamedTarget(target: string, sourceId: string, machine: MachineDefinition, renamed: string, key: string): string {
  const renameIn = (base: string, segments: string[], prefix: string): string => {
    let at = base;
    const out = [...segments];
    for (let i = 0; i < segments.length; i++) {
      const next = at ? `${at}.${segments[i]}` : segments[i]!;
      if (next === renamed) out[i] = key;
      at = next;
    }
    return prefix + out.join('.');
  };
  if (target.startsWith('#')) {
    const [head = '', ...rest] = target.slice(1).split('.');
    if (machine.machineId !== null && head === machine.machineId) return renameIn('', rest, `#${head}${rest.length ? '.' : ''}`);
    return target;
  }
  if (target.startsWith('.')) return renameIn(sourceId, target.slice(1).split('.'), '.');
  const parent = sourceId.includes('.') ? sourceId.slice(0, sourceId.lastIndexOf('.')) : '';
  return renameIn(sourceId === '' ? '' : parent, target.split('.'), '');
}

/** The string literals a read transition's targets are written in, in order. */
function targetLiterals(expression: ts.Expression): ts.StringLiteralLike[] {
  const inner = unwrap(expression);
  if (ts.isStringLiteralLike(inner)) return [inner];
  if (!ts.isObjectLiteralExpression(inner)) return [];
  const target = objectProperty(inner, 'target')?.initializer;
  if (!target) return [];
  const value = unwrap(target);
  if (ts.isStringLiteralLike(value)) return [value];
  if (ts.isArrayLiteralExpression(value)) return value.elements.filter(ts.isStringLiteralLike);
  return [];
}

function incomingFromOutside(machine: MachineDefinition, subtree: string): string[] {
  const hits: string[] = [];
  for (const state of machineStates(machine.root)) {
    if (descendsFrom(state.id, subtree)) continue;
    for (const transition of state.transitions) {
      if (transition.resolved.some((target) => target !== null && descendsFrom(target, subtree))) {
        hits.push(`${state.id || '(root)'} ${transition.event || transition.kind}`);
      }
    }
  }
  return hits;
}

function childKeyValid(parent: MachineState, key: string): void {
  if (!key.trim()) throw new Error('A state needs a name.');
  if (key.includes('.') || key.startsWith('#')) throw new Error(`"${key}" cannot name a state: XState reads "." and "#" as target syntax.`);
  if (parent.children.some((child) => child.key === key)) throw new Error(`${parent.id || 'The machine'} already has a state named ${key}.`);
}

/**
 * Apply `edit` to the machine `key` in `code`. Returns the new module text; throws with the reason
 * when the edit cannot be made as asked.
 */
export function applyMachineEdit(file: string, code: string, key: string, edit: MachineEdit): string {
  const source = parseModule(file, code);
  const call = findMachineCalls(file, source).find((candidate) => candidate.key === key);
  if (!call?.config) throw new Error(`${key} is not a machine this module declares as an object literal.`);
  const machine = readMachine(call, file, source);
  if (!machine) throw new Error(`${key} could not be read.`);
  const config = call.config;
  const stateNode = (id: string): ts.ObjectLiteralExpression => {
    const node = stateObject(config, id);
    if (!node) throw new Error(`State ${id || '(root)'} is not written as an object literal in ${file}.`);
    return node;
  };
  const state = (id: string): MachineState => {
    const found = findMachineState(machine.root, id);
    if (!found) throw new Error(`${key} has no state ${id || '(root)'}.`);
    return found;
  };

  switch (edit.op) {
    case 'add-state': {
      const parent = state(edit.parent);
      childKeyValid(parent, edit.key);
      if (parent.kind === 'final' || parent.kind === 'history') throw new Error(`A ${parent.kind} state has no child states.`);
      const node = stateNode(edit.parent);
      const states = objectOf(objectProperty(node, 'states')?.initializer);
      if (states) return apply(code, [addProperty(code, states, source, keyText(edit.key), '{}')]);
      const splices: Splice[] = [];
      // A leaf becoming compound needs an initial child; its first child is that.
      if (parent.kind === 'atomic' && !objectProperty(node, 'initial')) {
        splices.push(addProperty(code, node, source, 'initial', quote(edit.key)));
      }
      const withInitial = apply(code, splices);
      const reparsed = parseModule(file, withInitial);
      const again = findMachineCalls(file, reparsed).find((candidate) => candidate.key === key)?.config;
      const target = again ? stateObject(again, edit.parent) : null;
      if (!target) throw new Error(`State ${edit.parent || '(root)'} moved while it was edited.`);
      return apply(withInitial, [addProperty(withInitial, target, reparsed, 'states', `{ ${keyText(edit.key)}: {} }`)]);
    }

    case 'rename-state': {
      if (edit.state === '') throw new Error('The machine itself has no key to rename.');
      const renamed = state(edit.state);
      const parentId = edit.state.includes('.') ? edit.state.slice(0, edit.state.lastIndexOf('.')) : '';
      const parent = state(parentId);
      childKeyValid(parent, edit.key);
      const splices: Splice[] = [];
      const parentNode = stateNode(parentId);
      const states = objectOf(objectProperty(parentNode, 'states')?.initializer);
      const property = states?.properties.find(
        (candidate): candidate is ts.PropertyAssignment =>
          ts.isPropertyAssignment(candidate) && propertyName(candidate.name) === renamed.key,
      );
      if (!property) throw new Error(`State ${edit.state} is not written as \`${renamed.key}: { … }\`.`);
      splices.push({ start: property.name.getStart(source), end: property.name.getEnd(), text: keyText(edit.key) });
      const initial = objectProperty(parentNode, 'initial')?.initializer;
      if (initial && ts.isStringLiteralLike(initial) && initial.text === renamed.key) {
        splices.push({ start: initial.getStart(source), end: initial.getEnd(), text: quote(edit.key) });
      }
      for (const from of machineStates(machine.root)) {
        for (const transition of from.transitions) {
          const node = nodeAtSpan(source, transition.span.start, transition.span.end);
          if (!node) continue;
          const literals = targetLiterals(node);
          transition.targets.forEach((target, i) => {
            const literal = literals[i];
            const resolved = transition.resolved[i];
            if (!literal || resolved == null || !descendsFrom(resolved, edit.state)) return;
            const next = renamedTarget(target, from.id, machine, edit.state, edit.key);
            if (next !== target) splices.push({ start: literal.getStart(source), end: literal.getEnd(), text: quote(next) });
          });
        }
      }
      return apply(code, splices);
    }

    case 'remove-state': {
      if (edit.state === '') throw new Error('Remove the machine in code; the document edits its states.');
      const removed = state(edit.state);
      const incoming = incomingFromOutside(machine, edit.state);
      if (incoming.length > 0) {
        throw new Error(`${edit.state} is still a target of ${incoming.join(', ')}. Retarget or remove those transitions first.`);
      }
      const parentId = edit.state.includes('.') ? edit.state.slice(0, edit.state.lastIndexOf('.')) : '';
      const parent = state(parentId);
      if (parent.kind === 'compound' && parent.initial === removed.key && parent.children.length > 1) {
        throw new Error(`${removed.key} is ${parentId || 'the machine'}'s initial state. Make another state initial first.`);
      }
      const parentNode = stateNode(parentId);
      const states = objectOf(objectProperty(parentNode, 'states')?.initializer)!;
      const property = states.properties.find(
        (candidate) => ts.isPropertyAssignment(candidate) && propertyName(candidate.name) === removed.key,
      )!;
      return apply(code, [removeListItem(code, property, states.properties)]);
    }

    case 'set-initial': {
      const parent = state(edit.parent);
      if (parent.kind !== 'compound') throw new Error(`Only a compound state has an initial state; ${edit.parent || 'the machine'} is ${parent.kind}.`);
      if (!parent.children.some((child) => child.key === edit.key)) throw new Error(`${edit.key} is not a child of ${edit.parent || 'the machine'}.`);
      const node = stateNode(edit.parent);
      const initial = objectProperty(node, 'initial');
      if (initial) return apply(code, [{ start: initial.initializer.getStart(source), end: initial.initializer.getEnd(), text: quote(edit.key) }]);
      return apply(code, [addProperty(code, node, source, 'initial', quote(edit.key))]);
    }

    case 'add-transition': {
      state(edit.source);
      state(edit.target);
      if (!edit.event.trim()) throw new Error('A transition needs an event.');
      const target = quote(targetString(machine, edit.source, edit.target));
      const node = stateNode(edit.source);
      const on = objectOf(objectProperty(node, 'on')?.initializer);
      if (!on) return apply(code, [addProperty(code, node, source, 'on', `{ ${keyText(edit.event)}: ${target} }`)]);
      const existing = objectProperty(on, edit.event);
      if (!existing) return apply(code, [addProperty(code, on, source, keyText(edit.event), target)]);
      const value = unwrap(existing.initializer);
      if (ts.isArrayLiteralExpression(value)) {
        const last = value.elements[value.elements.length - 1];
        const at = last ? last.getEnd() : value.getStart(source) + 1;
        return apply(code, [{ start: at, end: at, text: last ? `, ${target}` : target }]);
      }
      const text = existing.initializer.getText(source);
      return apply(code, [{ start: existing.initializer.getStart(source), end: existing.initializer.getEnd(), text: `[${text}, ${target}]` }]);
    }

    case 'retarget-transition': {
      const transition = findMachineTransition(machine.root, edit.transition);
      if (!transition) throw new Error(`No transition ${edit.transition}.`);
      state(edit.target);
      const node = nodeAtSpan(source, transition.span.start, transition.span.end);
      if (!node) throw new Error('The transition moved while it was edited.');
      const text = quote(targetString(machine, transition.source, edit.target));
      const literals = targetLiterals(node);
      if (literals.length > 1) throw new Error('This transition has several targets; edit it in code.');
      const literal = literals[0];
      if (literal) return apply(code, [{ start: literal.getStart(source), end: literal.getEnd(), text }]);
      const inner = unwrap(node);
      if (ts.isObjectLiteralExpression(inner)) return apply(code, [addProperty(code, inner, source, 'target', text)]);
      return apply(code, [{ start: node.getStart(source), end: node.getEnd(), text }]);
    }

    case 'rename-event': {
      const transition = findMachineTransition(machine.root, edit.transition);
      if (!transition || transition.kind !== 'on') throw new Error('Only an `on` transition has an event to rename.');
      if (!edit.event.trim()) throw new Error('An event needs a name.');
      const on = objectOf(objectProperty(stateNode(transition.source), 'on')?.initializer);
      const property = on ? objectProperty(on, transition.event) : null;
      if (!on || !property) throw new Error(`${transition.event} is not written as an \`on\` key.`);
      if (objectProperty(on, edit.event)) throw new Error(`${transition.source || 'The machine'} already handles ${edit.event}.`);
      return apply(code, [{ start: property.name.getStart(source), end: property.name.getEnd(), text: keyText(edit.event) }]);
    }

    case 'remove-transition': {
      const transition = findMachineTransition(machine.root, edit.transition);
      if (!transition) throw new Error(`No transition ${edit.transition}.`);
      const node = nodeAtSpan(source, transition.span.start, transition.span.end);
      if (!node) throw new Error('The transition moved while it was edited.');
      const parent = node.parent;
      if (ts.isArrayLiteralExpression(parent)) {
        if (parent.elements.length > 1) return apply(code, [removeListItem(code, node, parent.elements)]);
        return removeOwner(code, parent);
      }
      return removeOwner(code, node);
    }
  }
}

/** Remove the property a transition value is the whole of (`EVENT: …`, `always: …`, `delay: …`). */
function removeOwner(code: string, value: ts.Node): string {
  const property = value.parent;
  if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.parent)) {
    throw new Error('This transition is not written as a property; edit it in code.');
  }
  return apply(code, [removeListItem(code, property, property.parent.properties)]);
}
