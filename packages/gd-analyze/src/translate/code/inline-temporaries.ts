/**
 * Values read as written (GODOT.md step 4): a single-use temporary is inlined, so `__godot_value_N`
 * appears only where evaluation order needs a statement.
 *
 * Lowering settles every child that carries statements into a `const` temporary, in GDScript's
 * evaluation order. This pass folds a temporary back into the statement right after it when doing
 * so keeps that order: the temporary is read once, in that statement, and everything the statement
 * evaluates before the read is a literal, `this`, a stable local, or pure operator work over them —
 * nothing the temporary's initializer could change and nothing that could change it. Folding runs
 * backwards, so a chain of temporaries consumed in the order they were defined collapses into one
 * expression, and a temporary defined out of JavaScript's order (GDScript evaluates a call's
 * receiver before its arguments) stays a statement. Never into a branch that may not run: a
 * conditional's arms, a short-circuit's right side, a loop's condition, an arrow's body.
 *
 * A temporary read several times in that statement folds into each read when its initializer
 * gives the same value evaluated again (`reevaluable`: a node's entity, a field) and nothing with
 * an effect runs between two reads: `camera.position.y = …` reads `camera` once in GDScript and
 * as `Node3D_set_position(godot_node_entity(this.camera), …(Node3D_get_position(godot_node_entity(this.camera)) …))`
 * here, the same node both times.
 */

import type { TargetTsClassMember, TargetTsExpression, TargetTsJsxChild, TargetTsSourceFile, TargetTsStatement } from './target-ts-syntax';

/** The names `OfficialBoundLoweringContext.temporary()` gives. */
const TEMPORARY = /^__godot_value_\d+$/;

/** `dirty`: on a find, whether an evaluation with an effect ran after the read (`Fold.repeat`). */
type Found = { readonly status: 'found' | 'clean' | 'blocked'; readonly value: TargetTsExpression; readonly dirty?: boolean };

/** Every identifier an expression or statement reads or writes, by name. */
function countIn(node: TargetTsExpression | TargetTsStatement | TargetTsClassMember, name: string): number {
  let count = 0;
  visit(node, (entry) => {
    if (entry.kind === 'identifier-expression' && entry.name === name) count += 1;
  });
  return count;
}

type Node = TargetTsExpression | TargetTsStatement | TargetTsClassMember;

/** Calls `onExpression` for every expression under `node`, arrows' bodies included. */
function visit(node: Node, onExpression: (entry: TargetTsExpression) => void): void {
  const expressions = (list: readonly (TargetTsExpression | undefined)[]) => {
    for (const entry of list) if (entry !== undefined) visit(entry, onExpression);
  };
  const statements = (list: readonly TargetTsStatement[] | undefined) => {
    for (const entry of list ?? []) visit(entry, onExpression);
  };
  switch (node.kind) {
    case 'field-member':
      return expressions([node.initializer]);
    case 'method-member':
    case 'constructor-member':
      expressions(node.parameters.map((parameter) => parameter.initializer));
      return statements(node.body);
    case 'getter-member':
      return statements(node.body);
    case 'setter-member':
      expressions([node.parameter.initializer]);
      return statements(node.body);
    case 'import-statement':
    case 'break-statement':
    case 'continue-statement':
    case 'empty-statement':
      return;
    case 'destructure-statement':
      return expressions([node.initializer]);
    case 'variable-statement':
      return expressions([node.initializer]);
    case 'function-statement':
      expressions(node.parameters.map((parameter) => parameter.initializer));
      return statements(node.body);
    case 'class-statement':
      expressions([node.extends]);
      for (const member of node.members) visit(member, onExpression);
      return;
    case 'expression-statement':
    case 'export-default-statement':
    case 'throw-statement':
      return expressions([node.expression]);
    case 'return-statement':
      return expressions([node.expression]);
    case 'if-statement':
      expressions([node.condition]);
      statements(node.then);
      return statements(node.else);
    case 'while-statement':
      expressions([node.condition]);
      return statements(node.body);
    case 'for-statement':
      expressions([node.initializer, node.condition, node.update]);
      return statements(node.body);
    case 'for-of-statement':
      expressions([node.iterable]);
      return statements(node.body);
    case 'block-statement':
      return statements(node.body);
    case 'try-statement':
      statements(node.body);
      return statements(node.handler);
    default:
      break;
  }
  onExpression(node);
  switch (node.kind) {
    case 'identifier-expression':
    case 'this-expression':
    case 'literal-expression':
    case 'undefined-expression':
      return;
    case 'array-expression':
      return expressions(node.elements);
    case 'object-expression':
      return expressions(node.properties.map((property) => property.value));
    case 'property-expression':
      return expressions([node.object]);
    case 'element-expression':
      return expressions([node.object, node.index]);
    case 'postfix-update-expression':
    case 'unary-expression':
      return expressions([node.operand]);
    case 'call-expression':
    case 'new-expression':
      return expressions([node.callee, ...node.arguments]);
    case 'binary-expression':
      return expressions([node.left, node.right]);
    case 'assignment-expression':
      return expressions([node.target, node.value]);
    case 'conditional-expression':
      return expressions([node.condition, node.whenTrue, node.whenFalse]);
    case 'await-expression':
    case 'parenthesized-expression':
    case 'as-expression':
    case 'non-null-expression':
      return expressions([node.expression]);
    case 'arrow-expression':
      expressions(node.parameters.map((parameter) => parameter.initializer));
      if (Array.isArray(node.body)) statements(node.body as readonly TargetTsStatement[]);
      else expressions([node.body as TargetTsExpression]);
      return;
    case 'jsx-element-expression':
    case 'jsx-fragment-expression': {
      const children = (list: readonly TargetTsJsxChild[]): void => {
        for (const child of list) {
          if (child.kind === 'jsx-expression-child') visit(child.value, onExpression);
          else if (child.kind === 'jsx-element-child') {
            expressions(child.attributes.flatMap((attribute) => (attribute.kind === 'jsx-string-attribute' ? [] : [attribute.value])));
            children(child.children);
          }
        }
      };
      if (node.kind === 'jsx-element-expression') expressions(node.attributes.flatMap((attribute) => (attribute.kind === 'jsx-string-attribute' ? [] : [attribute.value])));
      children(node.children);
      return;
    }
    default:
      return node satisfies never;
  }
}

/** The statements directly nested in a statement's bodies (a class's members' too). */
function nestedStatements(statement: TargetTsStatement): readonly TargetTsStatement[] {
  switch (statement.kind) {
    case 'function-statement':
    case 'while-statement':
    case 'for-statement':
    case 'for-of-statement':
    case 'block-statement':
      return statement.body;
    case 'if-statement':
      return [...statement.then, ...(statement.else ?? [])];
    case 'try-statement':
      return [...statement.body, ...statement.handler];
    case 'class-statement':
      return statement.members.flatMap((member) => ('body' in member ? member.body : []));
    default:
      return [];
  }
}

/**
 * The names any arrow or function statement in the file assigns, and the module's own `let`s: a
 * call can change them, so no read of one moves.
 */
function namesArrowsAssign(file: TargetTsSourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  const assigned = (entry: TargetTsExpression) => {
    const target = entry.kind === 'assignment-expression' ? entry.target : entry.kind === 'postfix-update-expression' ? entry.operand : undefined;
    if (target?.kind === 'identifier-expression') names.add(target.name);
  };
  const inArrows = (entry: TargetTsExpression) => {
    if (entry.kind === 'arrow-expression') visit(entry, assigned);
  };
  const functions = (statement: TargetTsStatement) => {
    if (statement.kind === 'function-statement') visit(statement, assigned);
    for (const nested of nestedStatements(statement)) functions(nested);
  };
  for (const statement of file.statements) {
    visit(statement, inArrows);
    functions(statement);
    // A module-level `let` is the module's state: any call may change it.
    if (statement.kind === 'variable-statement' && statement.declaration === 'let') names.add(statement.name);
  }
  return names;
}

/** Whether anything under the statement assigns the name. */
function assignsName(statement: TargetTsStatement, name: string): boolean {
  let found = false;
  visit(statement, (entry) => {
    const target = entry.kind === 'assignment-expression' ? entry.target : entry.kind === 'postfix-update-expression' ? entry.operand : undefined;
    if (target?.kind === 'identifier-expression' && target.name === name) found = true;
  });
  return found;
}

/** Whether the expression assigns anything. */
function assigns(value: TargetTsExpression): boolean {
  let found = false;
  visit(value, (entry) => {
    if (entry.kind === 'assignment-expression' || entry.kind === 'postfix-update-expression') found = true;
  });
  return found;
}

interface Scope {
  /** Identifiers a call may change (`namesArrowsAssign`). */
  readonly unstable: ReadonlySet<string>;
  /** The enclosing class's `readonly` fields, outside its constructor: `this.<field>` never changes. */
  readonly readonlyOfThis: ReadonlySet<string>;
}

const readonlyFields = (members: readonly TargetTsClassMember[]): ReadonlySet<string> =>
  new Set(members.flatMap((member) => (member.kind === 'field-member' && member.modifiers?.includes('readonly') && !member.modifiers.includes('static') ? [member.name] : [])));

interface Fold {
  readonly name: string;
  readonly value: TargetTsExpression;
  /** Whether a local identifier read before the temporary's may stay before its initializer. */
  readonly stable: (name: string) => boolean;
  /** An initializer that reads nothing any evaluation could change: it may move past anything. */
  readonly constant: boolean;
  readonly readonlyOfThis: ReadonlySet<string>;
  /**
   * Every read is replaced (a `reevaluable` initializer): the first as a single read is, each
   * later one only with nothing that has an effect evaluated since the one before it.
   */
  readonly repeat?: boolean;
}

/**
 * Whether evaluating the value again gives the same value while nothing with an effect runs in
 * between: `this`, locals, property reads on them, and the entity lookup (`godot_node_entity`).
 */
function reevaluable(value: TargetTsExpression): boolean {
  switch (value.kind) {
    case 'this-expression':
    case 'identifier-expression':
      return true;
    case 'property-expression':
      return !value.optional && reevaluable(value.object);
    case 'parenthesized-expression':
    case 'as-expression':
    case 'non-null-expression':
      return reevaluable(value.expression);
    case 'call-expression':
      return value.callee.kind === 'identifier-expression' && value.callee.name === 'godot_node_entity' && value.arguments.length === 1 && reevaluable(value.arguments[0] as TargetTsExpression);
    default:
      return false;
  }
}

/**
 * Whether evaluating the value has no effect and reads nothing an evaluation could change: literals,
 * `this`, the class's readonly fields, locals `stable` holds, and operators over them.
 */
function stateless(value: TargetTsExpression, stable: (name: string) => boolean, readonlyOfThis: ReadonlySet<string>): boolean {
  const inner = (entry: TargetTsExpression) => stateless(entry, stable, readonlyOfThis);
  switch (value.kind) {
    case 'literal-expression':
    case 'undefined-expression':
    case 'this-expression':
      return true;
    case 'identifier-expression':
      return stable(value.name);
    case 'property-expression':
      return value.object.kind === 'this-expression' && !value.optional && readonlyOfThis.has(value.property);
    case 'unary-expression':
      return value.operator !== 'void' && inner(value.operand);
    case 'binary-expression':
      return value.operator !== 'in' && value.operator !== 'instanceof' && inner(value.left) && inner(value.right);
    case 'parenthesized-expression':
    case 'as-expression':
    case 'non-null-expression':
      return inner(value.expression);
    default:
      return false;
  }
}

/** `value` with the temporary's one read replaced, when every evaluation before it is clean. */
function fold(value: TargetTsExpression, into: Fold): Found {
  const clean = (entry: TargetTsExpression): Found => ({ status: 'clean', value: entry });
  const blocked: Found = { status: 'blocked', value };
  /** The children, in evaluation order, folded; `rebuild` gets them back when one held the read. */
  const inOrder = (children: readonly TargetTsExpression[], rebuild: (children: TargetTsExpression[]) => TargetTsExpression, own: 'clean' | 'blocked'): Found => {
    if (into.constant) own = 'clean';
    if (into.repeat === true) return inOrderRepeated(children, rebuild, own);
    for (const [index, child] of children.entries()) {
      const result = fold(child, into);
      if (result.status === 'blocked') return blocked;
      if (result.status === 'found') {
        const next = [...children];
        next[index] = result.value;
        return { status: 'found', value: rebuild(next) };
      }
    }
    return own === 'clean' ? clean(value) : blocked;
  };
  /** `inOrder` replacing every read: the first reached cleanly, no effect between two. */
  const inOrderRepeated = (children: readonly TargetTsExpression[], rebuild: (children: TargetTsExpression[]) => TargetTsExpression, own: 'clean' | 'blocked'): Found => {
    const next = [...children];
    let found = false;
    let dirty = false;
    for (const [index, child] of children.entries()) {
      const result = fold(child, into);
      if (result.status === 'found') {
        if (found && dirty) return blocked;
        found = true;
        dirty = result.dirty === true;
        next[index] = result.value;
      } else if (result.status === 'blocked') {
        if (!found || countIn(child, into.name) > 0) return blocked;
        dirty = true;
      }
    }
    if (found) return { status: 'found', value: rebuild(next), dirty: dirty || own === 'blocked' };
    return own === 'clean' ? clean(value) : blocked;
  };
  /** A part that may not run: it may hold nothing that reads or changes state before the fold. */
  const conditional = (entry: TargetTsExpression): boolean => fold(entry, into).status === 'clean';
  switch (value.kind) {
    case 'identifier-expression':
      if (value.name === into.name) return { status: 'found', value: into.value };
      return into.constant || into.stable(value.name) ? clean(value) : blocked;
    case 'this-expression':
    case 'literal-expression':
    case 'undefined-expression':
      return clean(value);
    case 'array-expression':
      return inOrder(value.elements, (elements) => ({ ...value, elements }), 'clean');
    case 'object-expression':
      return inOrder(
        value.properties.map((property) => property.value),
        (values) => ({ ...value, properties: value.properties.map((property, index) => ({ ...property, value: values[index] as TargetTsExpression })) }),
        'clean',
      );
    case 'property-expression':
      if (value.object.kind === 'this-expression' && !value.optional && into.readonlyOfThis.has(value.property)) return clean(value);
      return inOrder([value.object], ([object]) => ({ ...value, object: object as TargetTsExpression }), 'blocked');
    case 'element-expression':
      return inOrder([value.object, value.index], ([object, index]) => ({ ...value, object: object as TargetTsExpression, index: index as TargetTsExpression }), 'blocked');
    case 'call-expression':
    case 'new-expression':
      // A member read called through a temporary is called with no receiver: folding it back
      // would make the call a method call on the object.
      if (value.callee.kind === 'identifier-expression' && value.callee.name === into.name && memberRead(into.value)) return blocked;
      return inOrder([value.callee, ...value.arguments], ([callee, ...args]) => ({ ...value, callee: callee as TargetTsExpression, arguments: args }), 'blocked');
    case 'unary-expression':
      return inOrder([value.operand], ([operand]) => ({ ...value, operand: operand as TargetTsExpression }), 'clean');
    case 'binary-expression': {
      if (value.operator === '&&' || value.operator === '||' || value.operator === '??') {
        const left = fold(value.left, into);
        if (left.status === 'found' && into.repeat === true && countIn(value.right, into.name) > 0) return blocked;
        if (left.status === 'found') return { status: 'found', value: { ...value, left: left.value }, dirty: left.dirty === true || !conditional(value.right) };
        return left.status === 'clean' && conditional(value.right) ? clean(value) : blocked;
      }
      return inOrder([value.left, value.right], ([left, right]) => ({ ...value, left: left as TargetTsExpression, right: right as TargetTsExpression }), 'clean');
    }
    case 'assignment-expression': {
      // `x = v` evaluates nothing before `v`; `x op= v` reads `x` first; `o.p = v` evaluates `o`
      // (and an index) first, and `o.p op= v` reads `o.p` too.
      const target = value.target;
      const compound = value.operator !== '=';
      if (target.kind === 'identifier-expression') {
        if (target.name === into.name || (compound && !into.stable(target.name))) return blocked;
        return inOrder([value.value], ([next]) => ({ ...value, value: next as TargetTsExpression }), 'blocked');
      }
      if ((target.kind !== 'property-expression' && target.kind !== 'element-expression') || compound) return blocked;
      const parts = target.kind === 'property-expression' ? [target.object] : [target.object, target.index];
      return inOrder(
        [...parts, value.value],
        (next) => {
          const folded = next[next.length - 1] as TargetTsExpression;
          const rebuilt =
            target.kind === 'property-expression'
              ? { ...target, object: next[0] as TargetTsExpression }
              : { ...target, object: next[0] as TargetTsExpression, index: next[1] as TargetTsExpression };
          return { ...value, target: rebuilt, value: folded };
        },
        'blocked',
      );
    }
    case 'conditional-expression': {
      const condition = fold(value.condition, into);
      if (condition.status === 'found' && into.repeat === true && countIn(value.whenTrue, into.name) + countIn(value.whenFalse, into.name) > 0) return blocked;
      if (condition.status === 'found') return { status: 'found', value: { ...value, condition: condition.value }, dirty: condition.dirty === true || !conditional(value.whenTrue) || !conditional(value.whenFalse) };
      return condition.status === 'clean' && conditional(value.whenTrue) && conditional(value.whenFalse) ? clean(value) : blocked;
    }
    case 'parenthesized-expression':
    case 'as-expression':
    case 'non-null-expression':
      return inOrder([value.expression], ([expression]) => ({ ...value, expression: expression as TargetTsExpression }), 'clean');
    case 'arrow-expression':
      // Making a closure evaluates nothing; its body runs later, so the read may not move there.
      return countIn(value, into.name) === 0 ? clean(value) : blocked;
    case 'await-expression':
      return inOrder([value.expression], ([expression]) => ({ ...value, expression: expression as TargetTsExpression }), 'blocked');
    case 'postfix-update-expression':
    case 'jsx-element-expression':
    case 'jsx-fragment-expression':
      return blocked;
    default:
      return value satisfies never;
  }
}

/** Whether the value is a property or element read, through any parentheses or type assertions. */
function memberRead(value: TargetTsExpression): boolean {
  if (value.kind === 'parenthesized-expression' || value.kind === 'as-expression' || value.kind === 'non-null-expression') return memberRead(value.expression);
  return value.kind === 'property-expression' || value.kind === 'element-expression';
}

/** The statement with the temporary folded into what it evaluates first, or undefined. */
function foldInto(statement: TargetTsStatement, into: Fold): TargetTsStatement | undefined {
  const at = (value: TargetTsExpression, rebuild: (value: TargetTsExpression) => TargetTsStatement) => {
    const result = fold(value, into);
    return result.status === 'found' ? rebuild(result.value) : undefined;
  };
  switch (statement.kind) {
    case 'expression-statement':
    case 'export-default-statement':
    case 'throw-statement':
      return at(statement.expression, (expression) => ({ ...statement, expression }));
    case 'return-statement':
      return statement.expression === undefined ? undefined : at(statement.expression, (expression) => ({ ...statement, expression }));
    case 'variable-statement':
      return statement.initializer === undefined ? undefined : at(statement.initializer, (initializer) => ({ ...statement, initializer }));
    case 'destructure-statement':
      return at(statement.initializer, (initializer) => ({ ...statement, initializer }));
    case 'if-statement':
      return at(statement.condition, (condition) => ({ ...statement, condition }));
    case 'for-of-statement':
      // The loop's binding is in its dead zone while the iterable is evaluated.
      if (countIn(into.value, statement.binding) > 0) return undefined;
      return at(statement.iterable, (iterable) => ({ ...statement, iterable }));
    default:
      return undefined;
  }
}

/** A `const` temporary the lowering settled, as its name and initializer. */
function temporaryOf(statement: TargetTsStatement | undefined): { readonly name: string; readonly value: TargetTsExpression } | undefined {
  if (statement?.kind !== 'variable-statement' || statement.declaration !== 'const') return undefined;
  if (statement.initializer === undefined || statement.type !== undefined || statement.modifiers !== undefined) return undefined;
  return TEMPORARY.test(statement.name) ? { name: statement.name, value: statement.initializer } : undefined;
}

function inlineList(list: readonly TargetTsStatement[], scope: Scope): TargetTsStatement[] {
  const out: TargetTsStatement[] = [];
  for (const [index, original] of list.entries()) {
    let statement = inlineStatement(original, scope);
    while (true) {
      const temporary = temporaryOf(out[out.length - 1]);
      if (temporary === undefined) break;
      const reads = countIn(statement, temporary.name);
      const repeat = reads > 1 && reevaluable(temporary.value);
      if (reads !== 1 && !repeat) break;
      if (list.slice(index + 1).some((later) => countIn(later, temporary.name) > 0)) break;
      const mutates = assigns(temporary.value);
      const stable = (name: string) => !mutates && !scope.unstable.has(name);
      const folded = foldInto(statement, {
        ...temporary,
        stable,
        // Stable reads stay good wherever they move, unless the statement assigns one of them.
        constant: !repeat && stateless(temporary.value, (name) => stable(name) && !assignsName(statement, name), scope.readonlyOfThis),
        readonlyOfThis: scope.readonlyOfThis,
        repeat,
      });
      if (folded === undefined || countIn(folded, temporary.name) > 0) break;
      out.pop();
      statement = folded;
    }
    out.push(statement);
  }
  return out;
}

/** Every expression's arrows' statement bodies inlined too. */
function inlineExpression(value: TargetTsExpression, scope: Scope): TargetTsExpression {
  const map = (entry: TargetTsExpression) => inlineExpression(entry, scope);
  switch (value.kind) {
    case 'identifier-expression':
    case 'this-expression':
    case 'literal-expression':
    case 'undefined-expression':
    case 'jsx-element-expression':
    case 'jsx-fragment-expression':
      return value;
    case 'array-expression':
      return { ...value, elements: value.elements.map(map) };
    case 'object-expression':
      return { ...value, properties: value.properties.map((property) => ({ ...property, value: map(property.value) })) };
    case 'property-expression':
      return { ...value, object: map(value.object) };
    case 'element-expression':
      return { ...value, object: map(value.object), index: map(value.index) };
    case 'postfix-update-expression':
    case 'unary-expression':
      return { ...value, operand: map(value.operand) };
    case 'call-expression':
    case 'new-expression':
      return { ...value, callee: map(value.callee), arguments: value.arguments.map(map) };
    case 'binary-expression':
      return { ...value, left: map(value.left), right: map(value.right) };
    case 'assignment-expression':
      return { ...value, target: map(value.target), value: map(value.value) };
    case 'conditional-expression':
      return { ...value, condition: map(value.condition), whenTrue: map(value.whenTrue), whenFalse: map(value.whenFalse) };
    case 'await-expression':
    case 'parenthesized-expression':
    case 'as-expression':
    case 'non-null-expression':
      return { ...value, expression: map(value.expression) };
    case 'arrow-expression': {
      // Inside an arrow only its own locals are stable: an outer one may change between its calls
      // or across an `await` in it.
      const inner = { ...scope, unstable: new Set([...scope.unstable, ...outerNames(value)]) };
      return {
        ...value,
        body: Array.isArray(value.body) ? inlineList(value.body as readonly TargetTsStatement[], inner) : inlineExpression(value.body as TargetTsExpression, inner),
      };
    }
    default:
      return value satisfies never;
  }
}

/** The identifiers an arrow reads or writes that it does not declare. */
function outerNames(arrow: Extract<TargetTsExpression, { kind: 'arrow-expression' }>): ReadonlySet<string> {
  const declared = new Set(arrow.parameters.map((parameter) => parameter.name));
  const declare = (list: readonly TargetTsStatement[]): void => {
    for (const statement of list) {
      if (statement.kind === 'variable-statement' || statement.kind === 'function-statement' || statement.kind === 'class-statement') declared.add(statement.name);
      if (statement.kind === 'destructure-statement') for (const name of [...statement.names, ...(statement.rest === undefined ? [] : [statement.rest])]) declared.add(name);
      if (statement.kind === 'for-statement' || statement.kind === 'for-of-statement') declared.add(statement.binding);
      if (statement.kind === 'try-statement') declared.add(statement.binding);
      declare(nestedStatements(statement));
    }
  };
  if (Array.isArray(arrow.body)) declare(arrow.body as readonly TargetTsStatement[]);
  const outer = new Set<string>();
  visit(arrow, (entry) => {
    if (entry.kind === 'identifier-expression' && !declared.has(entry.name)) outer.add(entry.name);
  });
  return outer;
}

function inlineMember(member: TargetTsClassMember, scope: Scope, fields: ReadonlySet<string>): TargetTsClassMember {
  switch (member.kind) {
    case 'field-member':
      return member.initializer === undefined ? member : { ...member, initializer: inlineExpression(member.initializer, scope) };
    case 'constructor-member':
      return { ...member, body: inlineList(member.body, scope) };
    case 'method-member':
    case 'getter-member':
    case 'setter-member':
      return { ...member, body: inlineList(member.body, { ...scope, readonlyOfThis: member.modifiers?.includes('static') ? new Set() : fields }) };
    default:
      return member satisfies never;
  }
}

function inlineStatement(statement: TargetTsStatement, scope: Scope): TargetTsStatement {
  const list = (entries: readonly TargetTsStatement[]) => inlineList(entries, scope);
  const map = (entry: TargetTsExpression) => inlineExpression(entry, scope);
  switch (statement.kind) {
    case 'import-statement':
    case 'break-statement':
    case 'continue-statement':
    case 'empty-statement':
      return statement;
    case 'destructure-statement':
      return { ...statement, initializer: map(statement.initializer) };
    case 'variable-statement':
      return statement.initializer === undefined ? statement : { ...statement, initializer: map(statement.initializer) };
    case 'function-statement':
      return { ...statement, body: list(statement.body) };
    case 'class-statement':
      return { ...statement, members: statement.members.map((member) => inlineMember(member, { ...scope, readonlyOfThis: new Set() }, readonlyFields(statement.members))) };
    case 'expression-statement':
    case 'export-default-statement':
    case 'throw-statement':
      return { ...statement, expression: map(statement.expression) };
    case 'return-statement':
      return statement.expression === undefined ? statement : { ...statement, expression: map(statement.expression) };
    case 'if-statement':
      return { ...statement, condition: map(statement.condition), then: list(statement.then), ...(statement.else === undefined ? {} : { else: list(statement.else) }) };
    case 'while-statement':
      return { ...statement, condition: map(statement.condition), body: list(statement.body) };
    case 'for-statement':
      return { ...statement, initializer: map(statement.initializer), condition: map(statement.condition), update: map(statement.update), body: list(statement.body) };
    case 'for-of-statement':
      return { ...statement, iterable: map(statement.iterable), body: list(statement.body) };
    case 'block-statement':
      return { ...statement, body: list(statement.body) };
    case 'try-statement':
      return { ...statement, body: list(statement.body), handler: list(statement.handler) };
    default:
      return statement satisfies never;
  }
}

/** The file with each single-use temporary folded where evaluation order allows it. */
export function inlineSingleUseTemporaries(file: TargetTsSourceFile): TargetTsSourceFile {
  return { ...file, statements: inlineList(file.statements, { unstable: namesArrowsAssign(file), readonlyOfThis: new Set() }) };
}
