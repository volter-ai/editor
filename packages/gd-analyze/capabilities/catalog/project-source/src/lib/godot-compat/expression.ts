/** Godot Expression's scalar/container intersection, evaluated without JavaScript eval. */

import { godotGlobalCall } from './gdscript-builtins';
import { godotArrayCall } from './array';
import { godotDictionaryCall } from './dictionary-protocol';
import { godotObjectCall, godotObjectGet, registerGodotObjectIdentity } from './object';
import { godotStringCall, godotStringOperator } from './string';
import { godotDictionary } from './variant';

type TokenKind = 'number' | 'string' | 'name' | 'input' | 'operator' | 'eof';
interface Token { readonly kind: TokenKind; readonly text: string; readonly value?: unknown; }

type Expr =
  | { readonly kind: 'literal'; readonly value: unknown }
  | { readonly kind: 'name'; readonly name: string }
  | { readonly kind: 'input'; readonly index: number }
  | { readonly kind: 'array'; readonly values: readonly Expr[] }
  | { readonly kind: 'dictionary'; readonly entries: readonly (readonly [Expr, Expr])[] }
  | { readonly kind: 'unary'; readonly operator: string; readonly value: Expr }
  | { readonly kind: 'binary'; readonly operator: string; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'conditional'; readonly condition: Expr; readonly yes: Expr; readonly no: Expr }
  | { readonly kind: 'member'; readonly owner: Expr; readonly name: string }
  | { readonly kind: 'index'; readonly owner: Expr; readonly index: Expr }
  | { readonly kind: 'call'; readonly callee: Expr; readonly args: readonly Expr[] };

class ExpressionTokenizer {
  private index = 0;
  constructor(private readonly source: string) {}

  next(): Token {
    while (/\s/.test(this.source[this.index] ?? '')) this.index += 1;
    if (this.index >= this.source.length) return { kind: 'eof', text: '' };
    const start = this.index;
    const character = this.source[this.index] as string;
    if (character === '$') {
      const match = /^\$(\d+)/.exec(this.source.slice(this.index));
      if (match === null) throw new Error(`Expected numeric input index after $ at ${start}.`);
      const inputIndex = Number(match[1]);
      if (!Number.isSafeInteger(inputIndex)) throw new Error(`Expression input index ${match[1]} exceeds translated integer range.`);
      this.index += match[0].length;
      return { kind: 'input', text: match[0], value: inputIndex };
    }
    if (/\d/.test(character) || (character === '.' && /\d/.test(this.source[this.index + 1] ?? ''))) {
      const match = /^(?:0x[\da-fA-F]+|0b[01]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(this.source.slice(this.index));
      if (match === null) throw new Error(`Invalid number at ${start}.`);
      this.index += match[0].length;
      const text = match[0];
      return { kind: 'number', text, value: text.startsWith('0x') ? Number.parseInt(text.slice(2), 16) : text.startsWith('0b') ? Number.parseInt(text.slice(2), 2) : Number(text) };
    }
    if (character === '"' || character === "'") {
      const quote = character;
      this.index += 1;
      let value = '';
      while (this.index < this.source.length) {
        const one = this.source[this.index++] as string;
        if (one === quote) return { kind: 'string', text: this.source.slice(start, this.index), value };
        if (one !== '\\') { value += one; continue; }
        const escaped = this.source[this.index++] as string;
        const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', a: '\x07', '\\': '\\', '"': '"', "'": "'" };
        if (simple[escaped] !== undefined) value += simple[escaped];
        else if (escaped === 'u') {
          const hex = this.source.slice(this.index, this.index + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error(`Invalid Unicode escape at ${this.index}.`);
          value += String.fromCharCode(Number.parseInt(hex, 16));
          this.index += 4;
        } else throw new Error(`Unsupported string escape \\${escaped}.`);
      }
      throw new Error(`Unterminated string at ${start}.`);
    }
    if (/[A-Za-z_]/.test(character)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.source.slice(this.index)) as RegExpExecArray;
      this.index += match[0].length;
      const text = match[0];
      if (text === 'not') {
        const tail = /^(\s+)in\b/.exec(this.source.slice(this.index));
        if (tail !== null) {
          this.index += tail[0].length;
          return { kind: 'operator', text: 'not in' };
        }
      }
      return { kind: ['and', 'or', 'not', 'in', 'if', 'else'].includes(text) ? 'operator' : 'name', text };
    }
    for (const operator of ['**', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>']) {
      if (this.source.startsWith(operator, this.index)) {
        this.index += operator.length;
        return { kind: 'operator', text: operator };
      }
    }
    if ('+-*/%<>&|^~!()[]{},.:'.includes(character)) {
      this.index += 1;
      return { kind: 'operator', text: character };
    }
    throw new Error(`Unsupported token ${JSON.stringify(character)} at ${start}.`);
  }
}

class ExpressionParser {
  private current: Token;
  constructor(source: string) {
    this.tokens = new ExpressionTokenizer(source);
    this.current = this.tokens.next();
  }
  private readonly tokens: ExpressionTokenizer;

  parse(): Expr {
    const expression = this.expression(0);
    if (this.current.kind !== 'eof') throw new Error(`Unexpected ${this.current.text}.`);
    return expression;
  }

  private expression(minimum: number): Expr {
    let left = this.prefix();
    left = this.postfix(left);
    while (true) {
      if (this.current.text === 'if' && minimum <= 0) {
        this.advance();
        const condition = this.expression(0);
        this.expect('else');
        left = { kind: 'conditional', condition, yes: left, no: this.expression(0) };
        continue;
      }
      const precedence = this.precedence(this.current.text);
      if (precedence < minimum) break;
      const operator = this.current.text;
      this.advance();
      const right = this.expression(precedence + (operator === '**' ? 0 : 1));
      left = { kind: 'binary', operator, left, right };
    }
    return left;
  }

  private prefix(): Expr {
    const token = this.current;
    if (token.text === '!' || token.text === 'not') {
      this.advance();
      return { kind: 'unary', operator: token.text, value: this.expression(3) };
    }
    if (['+', '-', '~'].includes(token.text)) {
      this.advance();
      return { kind: 'unary', operator: token.text, value: this.expression(12) };
    }
    if (token.kind === 'number' || token.kind === 'string') {
      this.advance();
      return { kind: 'literal', value: token.value };
    }
    if (token.kind === 'name') {
      this.advance();
      if (token.text === 'true') return { kind: 'literal', value: true };
      if (token.text === 'false') return { kind: 'literal', value: false };
      if (token.text === 'null' || token.text === 'nil') return { kind: 'literal', value: null };
      if (token.text === 'PI') return { kind: 'literal', value: Math.PI };
      if (token.text === 'TAU') return { kind: 'literal', value: Math.PI * 2 };
      if (token.text === 'INF') return { kind: 'literal', value: Number.POSITIVE_INFINITY };
      if (token.text === 'NAN') return { kind: 'literal', value: Number.NaN };
      return { kind: 'name', name: token.text };
    }
    if (token.kind === 'input') {
      this.advance();
      return { kind: 'input', index: Number(token.value) };
    }
    if (token.text === '(') {
      this.advance();
      const value = this.expression(0);
      this.expect(')');
      return value;
    }
    if (token.text === '[') {
      this.advance();
      const values: Expr[] = [];
      while (this.current.text !== ']') {
        values.push(this.expression(0));
        if (this.current.text !== ',') break;
        this.advance();
      }
      this.expect(']');
      return { kind: 'array', values };
    }
    if (token.text === '{') {
      this.advance();
      const entries: Array<readonly [Expr, Expr]> = [];
      while (this.current.text !== '}') {
        const key = this.expression(0);
        this.expect(':');
        entries.push([key, this.expression(0)]);
        if (this.current.text !== ',') break;
        this.advance();
      }
      this.expect('}');
      return { kind: 'dictionary', entries };
    }
    throw new Error(`Expected expression, got ${token.text || 'end of input'}.`);
  }

  private postfix(initial: Expr): Expr {
    let value = initial;
    while (true) {
      if (this.current.text === '.') {
        this.advance();
        if (this.current.kind !== 'name') throw new Error('Expected member name after dot.');
        value = { kind: 'member', owner: value, name: this.current.text };
        this.advance();
      } else if (this.current.text === '[') {
        this.advance();
        const index = this.expression(0);
        this.expect(']');
        value = { kind: 'index', owner: value, index };
      } else if (this.current.text === '(') {
        this.advance();
        const args: Expr[] = [];
        while (!this.at(')')) {
          args.push(this.expression(0));
          if (!this.at(',')) break;
          this.advance();
        }
        this.expect(')');
        value = { kind: 'call', callee: value, args };
      } else break;
    }
    return value;
  }

  private precedence(operator: string): number {
    return ({ or: 1, '||': 1, and: 2, '&&': 2, in: 4, 'not in': 4, '==': 4, '!=': 4, '<': 4, '<=': 4, '>': 4, '>=': 4, '|': 6, '^': 7, '&': 8, '<<': 9, '>>': 9, '+': 10, '-': 10, '*': 11, '/': 11, '%': 11, '**': 13 } as Record<string, number>)[operator] ?? -1;
  }
  private expect(value: string): void {
    if (this.current.text !== value) throw new Error(`Expected ${value}, got ${this.current.text || 'end of input'}.`);
    this.advance();
  }
  private at(value: string): boolean { return this.current.text === value; }
  private advance(): void { this.current = this.tokens.next(); }
}

interface EvalContext {
  readonly inputs: ReadonlyMap<string, unknown>;
  readonly indexedInputs: readonly unknown[];
  readonly declaredInputs: ReadonlySet<string>;
  readonly base: unknown;
  readonly constOnly: boolean;
}

const numeric = (value: unknown): number => {
  if (typeof value !== 'number') throw new TypeError(`Expression expected numeric value, received ${typeof value}.`);
  return value;
};

function evaluate(node: Expr, context: EvalContext): unknown {
  switch (node.kind) {
    case 'literal': return node.value;
    case 'input': {
      if (node.index < 0 || node.index >= context.indexedInputs.length) throw new Error(`Invalid input ${node.index} (not passed) in expression.`);
      return context.indexedInputs[node.index];
    }
    case 'array': return node.values.map((value) => evaluate(value, context));
    case 'dictionary': return godotDictionary(node.entries.map(([key, value]) => [evaluate(key, context), evaluate(value, context)]));
    case 'name': {
      if (node.name === 'self') {
        if (context.base === null || context.base === undefined) throw new Error("self can't be used because instance is null (not passed)");
        return context.base;
      }
      if (context.inputs.has(node.name)) return context.inputs.get(node.name);
      if (context.declaredInputs.has(node.name)) throw new Error(`Input '${node.name}' was not passed to Expression.execute.`);
      if (context.base !== null && context.base !== undefined) return godotObjectGet(context.base, node.name);
      throw new Error(`Unknown input '${node.name}'.`);
    }
    case 'member': return godotObjectGet(evaluate(node.owner, context), node.name);
    case 'index': {
      const owner = evaluate(node.owner, context);
      const index = evaluate(node.index, context) as PropertyKey;
      if (Array.isArray(owner)) {
        const position = exactIndex(index, owner.length);
        return owner[position];
      }
      if (typeof owner === 'string') {
        const points = [...owner];
        const position = exactIndex(index, points.length);
        return points[position];
      }
      if (owner instanceof Map) return owner.get(index);
      if (typeof owner === 'object' && owner !== null) return Reflect.get(owner, index);
      throw new Error('Expression index requires Array, Dictionary, String, or Object.');
    }
    case 'unary': {
      const value = evaluate(node.value, context);
      if (node.operator === '-' || node.operator === '+') return node.operator === '-' ? -numeric(value) : numeric(value);
      if (node.operator === '~') return integerResult(~integer(value), '~');
      return !value;
    }
    case 'conditional': return evaluate(node.condition, context) ? evaluate(node.yes, context) : evaluate(node.no, context);
    case 'binary': return binary(node.operator, evaluate(node.left, context), () => evaluate(node.right, context));
    case 'call': {
      const args = node.args.map((value) => evaluate(value, context));
      if (node.callee.kind === 'name') {
        if (context.inputs.has(node.callee.name)) {
          const callable = context.inputs.get(node.callee.name);
          if (typeof callable !== 'function') throw new Error(`${node.callee.name} is not callable.`);
          if (context.constOnly) throw new Error(`Expression const_calls_only cannot prove input Callable '${node.callee.name}' const.`);
          return callable(...args);
        }
        if (context.declaredInputs.has(node.callee.name)) throw new Error(`Input '${node.callee.name}' was not passed to Expression.execute.`);
        try { return godotGlobalCall(node.callee.name, args); } catch (error) {
          if (!(error instanceof Error) || error.message !== `godot-compat: unsupported @GDScript.${node.callee.name}`) throw error;
          if (context.constOnly) throw new Error(`Expression const_calls_only cannot prove base method '${node.callee.name}' const.`);
          if (context.base !== null && context.base !== undefined) return godotObjectCall(context.base, [node.callee.name, ...args]);
          throw error;
        }
      }
      if (node.callee.kind === 'member') {
        return expressionMethodCall(evaluate(node.callee.owner, context), node.callee.name, args, context.constOnly);
      }
      const callable = evaluate(node.callee, context);
      if (typeof callable !== 'function') throw new Error('Expression value is not callable.');
      if (context.constOnly) throw new Error('Expression const_calls_only cannot prove Callable value const.');
      return callable(...args);
    }
  }
}

const CONST_ARRAY_METHODS = new Set([
  'size', 'empty', 'is_empty', 'hash', 'get', 'front', 'back', 'has', 'count', 'find', 'rfind',
  'bsearch', 'bsearch_custom', 'max', 'min', 'duplicate', 'slice', 'all', 'any', 'reduce', 'map',
  'filter', 'is_read_only', 'is_typed', 'is_same_typed', 'get_typed_builtin',
  'get_typed_class_name', 'get_typed_script',
]);
const CONST_DICTIONARY_METHODS = new Set([
  'size', 'empty', 'is_empty', 'has', 'has_all', 'find_key', 'get', 'keys', 'values', 'duplicate',
  'merged', 'hash', 'recursive_equal', 'is_read_only', 'is_typed', 'is_typed_key',
  'is_typed_value', 'is_same_typed', 'is_same_typed_key', 'is_same_typed_value',
  'get_typed_key_builtin', 'get_typed_value_builtin', 'get_typed_key_class_name',
  'get_typed_value_class_name', 'get_typed_key_script', 'get_typed_value_script',
]);

function expressionMethodCall(owner: unknown, method: string, args: readonly unknown[], constOnly: boolean): unknown {
  if (Array.isArray(owner)) {
    if (constOnly && !CONST_ARRAY_METHODS.has(method)) throw new Error(`Expression const_calls_only rejected non-const Array.${method}.`);
    return godotArrayCall(method, owner, args);
  }
  if (owner instanceof Map) {
    if (constOnly && !CONST_DICTIONARY_METHODS.has(method)) throw new Error(`Expression const_calls_only rejected non-const Dictionary.${method}.`);
    return godotDictionaryCall(owner, method, args);
  }
  if (typeof owner === 'string') return godotStringCall(method, owner, args);
  if (constOnly) throw new Error(`Expression const_calls_only cannot prove method '${method}' const.`);
  return godotObjectCall(owner, [method, ...args]);
}

function binary(operator: string, left: unknown, right: () => unknown): unknown {
  if (operator === 'and' || operator === '&&') return Boolean(left) && Boolean(right());
  if (operator === 'or' || operator === '||') return Boolean(left) || Boolean(right());
  const value = right();
  switch (operator) {
    case '+':
      if (typeof left === 'string' && typeof value === 'string') return left + value;
      if (Array.isArray(left) && Array.isArray(value)) return [...left, ...value];
      return numeric(left) + numeric(value);
    case '-': return numeric(left) - numeric(value);
    case '*': return numeric(left) * numeric(value);
    case '/': return numeric(left) / numeric(value);
    case '%': return typeof left === 'string' ? godotStringOperator('%', left, value) : numeric(left) % numeric(value);
    case '**': return numeric(left) ** numeric(value);
    case '<<': return integerBinary(left, value, (a, b) => a << b, '<<');
    case '>>': return integerBinary(left, value, (a, b) => a >> b, '>>');
    case '&': return integerBinary(left, value, (a, b) => a & b, '&');
    case '|': return integerBinary(left, value, (a, b) => a | b, '|');
    case '^': return integerBinary(left, value, (a, b) => a ^ b, '^');
    case '==': return variantEqual(left, value);
    case '!=': return !variantEqual(left, value);
    case '<': return ordered(left, value, (a, b) => a < b);
    case '<=': return ordered(left, value, (a, b) => a <= b);
    case '>': return ordered(left, value, (a, b) => a > b);
    case '>=': return ordered(left, value, (a, b) => a >= b);
    case 'in': return contains(value, left);
    case 'not in': return !contains(value, left);
    default: throw new Error(`Unsupported Expression operator ${operator}.`);
  }
}

function ordered(left: unknown, right: unknown, compare: (a: number | string, b: number | string) => boolean): boolean {
  if (typeof left === 'number' && typeof right === 'number') return compare(left, right);
  if (typeof left === 'string' && typeof right === 'string') return compare(left, right);
  throw new TypeError(`Expression comparison requires two numbers or two strings, received ${typeof left} and ${typeof right}.`);
}

function variantEqual(left: unknown, right: unknown, depth = 0): boolean {
  if (left === right) return true;
  if (depth > 64) throw new RangeError('Expression equality nesting exceeds translated Variant limit.');
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => variantEqual(value, right[index], depth + 1));
  }
  if (left instanceof Map && right instanceof Map) {
    if (left.size !== right.size) return false;
    const remaining = [...right.entries()];
    return [...left.entries()].every(([key, value]) => {
      const index = remaining.findIndex(([candidate]) => variantEqual(key, candidate, depth + 1));
      if (index < 0 || !variantEqual(value, remaining[index]?.[1], depth + 1)) return false;
      remaining.splice(index, 1);
      return true;
    });
  }
  return false;
}

function contains(container: unknown, value: unknown): boolean {
  if (Array.isArray(container)) return container.some((entry) => variantEqual(entry, value));
  if (typeof container === 'string') return typeof value === 'string' && container.includes(value);
  if (container instanceof Map) return [...container.keys()].some((entry) => variantEqual(entry, value));
  if (typeof container === 'object' && container !== null && (typeof value === 'string' || typeof value === 'number' || typeof value === 'symbol')) return Reflect.has(container, value);
  return false;
}

function exactIndex(value: PropertyKey, length: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('Expression index must be an integer.');
  const position = value < 0 ? length + value : value;
  if (position < 0 || position >= length) throw new RangeError(`Expression index ${value} is out of bounds.`);
  return position;
}

function integer(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('Expression bitwise operands must be exact integers.');
  return BigInt(value);
}

function integerResult(value: bigint, operator: string): number {
  if (value < -(1n << 63n) || value > (1n << 63n) - 1n) throw new RangeError(`Expression ${operator} result exceeds Godot int64.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new RangeError(`Expression ${operator} result exceeds translated safe-integer range.`);
  return number;
}

function integerBinary(left: unknown, right: unknown, operation: (a: bigint, b: bigint) => bigint, operator: string): number {
  const a = integer(left);
  const b = integer(right);
  if ((operator === '<<' || operator === '>>') && (b < 0n || b >= 64n)) throw new RangeError(`Expression ${operator} shift must be in [0, 63].`);
  return integerResult(operation(a, b), operator);
}

export class GodotExpression {
  private root: Expr | null = null;
  private names: string[] = [];
  private error = '';
  private executeFailed = false;
  constructor() { registerGodotObjectIdentity(this, 'Expression'); }

  parse(expression: string, inputNames: readonly string[] = []): number {
    this.root = null;
    this.error = '';
    this.names = [...inputNames];
    if (new Set(this.names).size !== this.names.length || this.names.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) {
      this.error = 'Expression input names must be unique identifiers.';
      return 43;
    }
    try {
      this.root = new ExpressionParser(expression).parse();
      return 0;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      return 43;
    }
  }

  execute(inputs: readonly unknown[] = [], baseInstance: unknown = null, showError = true, constCallsOnly = false): unknown {
    if (this.root === null) {
      this.error = this.error || 'Expression must parse successfully before execute.';
      if (showError) console.error(`There was previously a parse error: ${this.error}.`);
      return null;
    }
    this.executeFailed = false;
    const values = new Map<string, unknown>();
    this.names.forEach((name, index) => {
      if (index < inputs.length) values.set(name, inputs[index]);
    });
    try {
      return evaluate(this.root, {
        inputs: values,
        indexedInputs: inputs,
        declaredInputs: new Set(this.names),
        base: baseInstance,
        constOnly: constCallsOnly,
      });
    } catch (error) {
      this.executeFailed = true;
      this.error = error instanceof Error ? error.message : String(error);
      if (showError) console.error(this.error);
      return null;
    }
  }

  has_execute_failed(): boolean { return this.executeFailed; }
  get_error_text(): string { return this.error; }
}

export function createGodotExpression(): GodotExpression { return new GodotExpression(); }
