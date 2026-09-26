/**
 * Two evaluators of one shader function over sample inputs, each in binary32 as a GPU computes:
 * - `evaluateGodotShaderTree` walks the tree the pinned Godot shader frontend exported (its types,
 *   operators and resolved names), the reference;
 * - `evaluateGlsl` parses and runs the GLSL text the lowering printed (`shader-glsl.ts`).
 * The shader proof compares them per sample: a lowering that reorders operands, drops a swizzle,
 * misprints a constant or maps a built-in wrongly disagrees. Both carry the subset the lowering
 * carries (scalars and vectors, their operators, constructors, swizzles, the common built-in
 * functions, texture lookups through the caller's samplers, `if` and `return`); anything else
 * throws by name.
 */
import type { GodotShaderNode, GodotShaderScalar, GodotShaderTree } from '../godot-frontend/bound-shader';

export type ShaderValue = number | boolean | readonly number[];
/** A sampler: its lookup at a coordinate, an RGBA vector. */
export type ShaderSampler = (coordinate: readonly number[]) => readonly number[];

const f32 = Math.fround;

function components(value: ShaderValue): readonly number[] {
  if (typeof value === 'boolean') return [value ? 1 : 0];
  return typeof value === 'number' ? [value] : value;
}

/** A component-wise operation, a scalar operand broadcast. */
function zip(a: ShaderValue, b: ShaderValue, fn: (x: number, y: number) => number): ShaderValue {
  const x = components(a);
  const y = components(b);
  const n = Math.max(x.length, y.length);
  const out = Array.from({ length: n }, (_, i) => f32(fn(x.length === 1 ? (x[0] as number) : (x[i] as number), y.length === 1 ? (y[0] as number) : (y[i] as number))));
  return n === 1 && typeof a === 'number' && typeof b === 'number' ? (out[0] as number) : out;
}

function map(a: ShaderValue, fn: (x: number) => number): ShaderValue {
  if (typeof a === 'number') return f32(fn(a));
  return components(a).map((x) => f32(fn(x)));
}

const SWIZZLE: Readonly<Record<string, number>> = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3, s: 0, t: 1, p: 2, q: 3 };

function swizzle(value: ShaderValue, name: string): ShaderValue {
  const c = components(value);
  const picked = [...name].map((letter) => {
    const index = SWIZZLE[letter];
    if (index === undefined || index >= c.length) throw new Error(`the swizzle .${name} is not carried`);
    return c[index] as number;
  });
  return picked.length === 1 ? (picked[0] as number) : picked;
}

function assignSwizzle(target: ShaderValue, name: string, value: ShaderValue): ShaderValue {
  const out = [...components(target)];
  const v = components(value);
  [...name].forEach((letter, i) => {
    const index = SWIZZLE[letter];
    if (index === undefined) throw new Error(`the swizzle .${name} is not carried`);
    out[index] = v.length === 1 ? (v[0] as number) : (v[i] as number);
  });
  return out;
}

const dot = (a: ShaderValue, b: ShaderValue): number => {
  const x = components(a);
  const y = components(b);
  let sum = 0;
  x.forEach((value, i) => {
    sum = f32(sum + f32(value * (y[i] as number)));
  });
  return sum;
};

/** The built-in functions both evaluators share, by GLSL (and Godot) name. */
function builtin(name: string, args: readonly ShaderValue[], samplers: ReadonlyMap<unknown, ShaderSampler>, samplerOf: (arg: ShaderValue) => ShaderSampler | undefined): ShaderValue {
  const a = args[0] as ShaderValue;
  const b = args[1] as ShaderValue;
  const c = args[2] as ShaderValue;
  switch (name) {
    case 'texture': {
      void samplers;
      const sampler = samplerOf(a);
      if (sampler === undefined) throw new Error('texture() of an unknown sampler');
      return sampler(components(b)).map(f32);
    }
    case 'abs':
      return map(a, Math.abs);
    case 'sqrt':
      return map(a, Math.sqrt);
    case 'sin':
      return map(a, Math.sin);
    case 'cos':
      return map(a, Math.cos);
    case 'exp':
      return map(a, Math.exp);
    case 'floor':
      return map(a, Math.floor);
    case 'fract':
      return map(a, (x) => x - Math.floor(x));
    case 'pow':
      return zip(a, b, (x, y) => x ** y);
    case 'min':
      return zip(a, b, Math.min);
    case 'max':
      return zip(a, b, Math.max);
    case 'clamp':
      return zip(zip(a, b, Math.max), c, Math.min);
    case 'mix': {
      const t = components(c);
      const x = components(a);
      const y = components(b);
      const out = x.map((value, i) => {
        const w = t.length === 1 ? (t[0] as number) : (t[i] as number);
        return f32(value + f32(f32((y[i] as number) - value) * w));
      });
      return typeof a === 'number' ? (out[0] as number) : out;
    }
    case 'step':
      return zip(a, b, (edge, x) => (x < edge ? 0 : 1));
    case 'dot':
      return dot(a, b);
    case 'length':
      return f32(Math.sqrt(dot(a, a)));
    case 'normalize': {
      const length = f32(Math.sqrt(dot(a, a)));
      return map(a, (x) => x / length);
    }
    case 'cross': {
      const [x1, y1, z1] = components(a) as [number, number, number];
      const [x2, y2, z2] = components(b) as [number, number, number];
      return [f32(f32(y1 * z2) - f32(z1 * y2)), f32(f32(z1 * x2) - f32(x1 * z2)), f32(f32(x1 * y2) - f32(y1 * x2))];
    }
    default:
      throw new Error(`the built-in function ${name} is not evaluated`);
  }
}

function construct(type: string, args: readonly ShaderValue[]): ShaderValue {
  const flat = args.flatMap(components);
  const size = { float: 1, vec2: 2, vec3: 3, vec4: 4, int: 1, bool: 1 }[type];
  if (size === undefined) throw new Error(`the ${type} constructor is not evaluated`);
  if (type === 'bool') return flat[0] !== 0;
  const filled = flat.length === 1 && size > 1 ? Array.from({ length: size }, () => flat[0] as number) : flat.slice(0, size);
  const out = type === 'int' ? filled.map(Math.trunc) : filled.map(f32);
  return size === 1 ? (out[0] as number) : out;
}

function binary(op: string, a: ShaderValue, b: ShaderValue): ShaderValue {
  switch (op) {
    case '+':
      return zip(a, b, (x, y) => x + y);
    case '-':
      return zip(a, b, (x, y) => x - y);
    case '*':
      return zip(a, b, (x, y) => x * y);
    case '/':
      return zip(a, b, (x, y) => x / y);
    case '<':
      return (a as number) < (b as number);
    case '<=':
      return (a as number) <= (b as number);
    case '>':
      return (a as number) > (b as number);
    case '>=':
      return (a as number) >= (b as number);
    case '==':
      return components(a).every((value, i) => value === components(b)[i]);
    case '!=':
      return !components(a).every((value, i) => value === components(b)[i]);
    case '&&':
      return Boolean(a) && Boolean(b);
    case '||':
      return Boolean(a) || Boolean(b);
    default:
      throw new Error(`the ${op} operator is not evaluated`);
  }
}

function scalar(value: GodotShaderScalar): number | boolean {
  if ('bool' in value) return value.bool;
  if ('int' in value) return value.int;
  if ('uint' in value) return value.uint;
  return value.float;
}

/** Godot operator ids to their spelling here (`ShaderLanguage::Operator`). */
const GODOT_BINARY: Readonly<Record<number, string>> = { 0: '==', 1: '!=', 2: '<', 3: '<=', 4: '>', 5: '>=', 6: '&&', 7: '||', 10: '+', 11: '-', 12: '*', 13: '/' };
const GODOT_ASSIGN: Readonly<Record<number, string>> = { 17: '', 18: '+', 19: '-', 20: '*', 21: '/' };

class Return {
  constructor(readonly value: ShaderValue | undefined) {}
}

/**
 * The entry function of Godot's tree run once with `builtins` set (and read back after) and the
 * uniforms' values; samplers are uniforms whose value is a `ShaderSampler`.
 */
export function evaluateGodotShaderTree(
  tree: GodotShaderTree,
  entry: string,
  builtins: Map<string, ShaderValue>,
  uniforms: ReadonlyMap<string, ShaderValue | ShaderSampler>,
): void {
  const fn = tree.functions.find((candidate) => candidate.name === entry)?.function;
  if (fn === null || fn === undefined || fn.kind !== 'FUNCTION' || fn.body === null) throw new Error(`the tree has no ${entry}()`);
  let locals = new Map<string, ShaderValue>();
  const user = new Map(tree.functions.flatMap((candidate) => (candidate.function?.kind === 'FUNCTION' ? [[candidate.name, candidate.function] as const] : [])));
  const callUser = (name: string, args: readonly ShaderValue[]): ShaderValue => {
    const callee = user.get(name) as Extract<GodotShaderNode, { kind: 'FUNCTION' }>;
    const saved = locals;
    locals = new Map(callee.arguments.map((argument, index) => [argument.name, args[index] as ShaderValue] as const));
    try {
      run(callee.body as GodotShaderNode);
      return 0;
    } catch (error) {
      if (error instanceof Return) return error.value ?? 0;
      throw error;
    } finally {
      locals = saved;
    }
  };
  const samplerOf = (value: ShaderValue): ShaderSampler | undefined => (typeof value === 'function' ? (value as ShaderSampler) : undefined);
  const read = (node: GodotShaderNode): ShaderValue => {
    switch (node.kind) {
      case 'CONSTANT':
        return node.values.length === 1 ? scalar(node.values[0] as GodotShaderScalar) : node.values.map((value) => scalar(value) as number);
      case 'VARIABLE': {
        if (node.local) return locals.get(node.name) as ShaderValue;
        if (uniforms.has(node.name)) return uniforms.get(node.name) as ShaderValue;
        const value = builtins.get(node.name);
        if (value === undefined) throw new Error(`the built-in ${node.name} has no sample value`);
        return value;
      }
      case 'MEMBER':
        return swizzle(read(node.owner as GodotShaderNode), node.name);
      case 'OPERATOR': {
        const args = node.arguments;
        const binaryOp = GODOT_BINARY[node.op];
        if (binaryOp !== undefined) return binary(binaryOp, read(args[0] as GodotShaderNode), read(args[1] as GodotShaderNode));
        const assign = GODOT_ASSIGN[node.op];
        if (assign !== undefined) {
          const target = args[0] as GodotShaderNode;
          const value = assign === '' ? read(args[1] as GodotShaderNode) : binary(assign, read(target), read(args[1] as GodotShaderNode));
          write(target, value);
          return value;
        }
        switch (node.op) {
          case 9:
            return map(read(args[0] as GodotShaderNode), (x) => -x);
          case 8:
            return !read(args[0] as GodotShaderNode);
          case 34:
            return read(args[0] as GodotShaderNode) ? read(args[1] as GodotShaderNode) : read(args[2] as GodotShaderNode);
          case 39: {
            const callee = args[0] as GodotShaderNode;
            if (callee.kind !== 'VARIABLE') throw new Error('a constructor without its type');
            return construct(callee.name, args.slice(1).map(read));
          }
          case 38: {
            const callee = args[0] as GodotShaderNode;
            if (callee.kind !== 'VARIABLE') throw new Error('a call without its function');
            if (user.has(callee.name)) return callUser(callee.name, args.slice(1).map(read));
            return builtin(callee.name, args.slice(1).map(read), new Map(), samplerOf);
          }
          default:
            throw new Error(`the ${node.opText} operator is not evaluated`);
        }
      }
      default:
        throw new Error(`a ${node.kind} expression is not evaluated`);
    }
  };
  const write = (target: GodotShaderNode, value: ShaderValue): void => {
    if (target.kind === 'VARIABLE') {
      if (target.local) locals.set(target.name, value);
      else builtins.set(target.name, value);
      return;
    }
    if (target.kind === 'MEMBER' && target.owner !== null) {
      write(target.owner, assignSwizzle(read(target.owner), target.name, value));
      return;
    }
    throw new Error(`a write to a ${target.kind} is not evaluated`);
  };
  const run = (node: GodotShaderNode): void => {
    switch (node.kind) {
      case 'BLOCK':
        for (const statement of node.statements) run(statement);
        return;
      case 'VARIABLE_DECLARATION':
        for (const declaration of node.declarations) {
          const initializer = declaration.initializer[0];
          locals.set(declaration.name, initializer === undefined ? 0 : read(initializer));
        }
        return;
      case 'CONTROL_FLOW':
        if (node.flowOp === 0) {
          const branch = read(node.expressions[0] as GodotShaderNode) ? node.blocks[0] : node.blocks[1];
          if (branch !== undefined) run(branch);
          return;
        }
        if (node.flowOp === 1) throw new Return(node.expressions[0] === undefined ? undefined : read(node.expressions[0]));
        throw new Error(`the flow operation ${String(node.flowOp)} is not evaluated`);
      default:
        read(node);
    }
  };
  try {
    run(fn.body);
  } catch (error) {
    if (!(error instanceof Return)) throw error;
  }
}

// --- The GLSL text.

type Token = { readonly kind: 'number' | 'name' | 'symbol'; readonly text: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s*(?:(\d+\.\d*(?:[eE][-+]?\d+)?|\d+[eE][-+]?\d+|\d+u?|\.\d+(?:[eE][-+]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(\+=|-=|\*=|\/=|==|!=|<=|>=|&&|\|\||\+\+|--|[-+*/%<>=!?:;,.(){}[\]]))/y;
  let at = 0;
  while (at < source.length) {
    if (/^\s*$/.test(source.slice(at))) break;
    pattern.lastIndex = at;
    const match = pattern.exec(source);
    if (match === null) throw new Error(`GLSL text not evaluated at ${source.slice(at, at + 20)}`);
    at = pattern.lastIndex;
    if (match[1] !== undefined) tokens.push({ kind: 'number', text: match[1] });
    else if (match[2] !== undefined) tokens.push({ kind: 'name', text: match[2] });
    else tokens.push({ kind: 'symbol', text: match[3] as string });
  }
  return tokens;
}

const TYPES = new Set(['float', 'vec2', 'vec3', 'vec4', 'int', 'bool']);
const PRECEDENCE: Readonly<Record<string, number>> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6 };

/**
 * The statements of a lowered function body run once, reading and writing `variables` (the mapped
 * built-ins, the uniforms by their GLSL names); a sampler is a variable whose value is a
 * `ShaderSampler`.
 */
export function evaluateGlsl(body: string, variables: Map<string, ShaderValue | ShaderSampler>): void {
  const tokens = tokenize(body);
  let at = 0;
  const peek = (): Token | undefined => tokens[at];
  const take = (text?: string): Token => {
    const token = tokens[at];
    if (token === undefined || (text !== undefined && token.text !== text)) throw new Error(`GLSL: expected ${text ?? 'a token'} at ${token?.text ?? 'end'}`);
    at += 1;
    return token;
  };
  const samplerOf = (value: ShaderValue): ShaderSampler | undefined => (typeof value === 'function' ? (value as ShaderSampler) : undefined);
  // An expression parsed to a thunk with a write-back for assignable places.
  interface Place {
    readonly read: () => ShaderValue;
    readonly write?: ((value: ShaderValue) => void) | undefined;
  }
  const primary = (): Place => {
    const token = take();
    let place: Place;
    if (token.kind === 'number') {
      const value = token.text.endsWith('u') ? Number(token.text.slice(0, -1)) : Number(token.text);
      const isFloat = /[.eE]/.test(token.text);
      place = { read: () => (isFloat ? f32(value) : value) };
    } else if (token.text === '(') {
      const inner = expression();
      if (peek()?.text === '?') {
        take('?');
        const whenTrue = expression();
        take(':');
        const whenFalse = expression();
        take(')');
        place = { read: () => (inner.read() ? whenTrue.read() : whenFalse.read()) };
      } else {
        take(')');
        place = inner;
      }
    } else if (token.text === '-' || token.text === '!') {
      const operand = unary();
      place = token.text === '-' ? { read: () => map(operand.read(), (x) => -x) } : { read: () => !operand.read() };
    } else if (token.text === 'true' || token.text === 'false') {
      const value = token.text === 'true';
      place = { read: () => value };
    } else if (token.kind === 'name' && peek()?.text === '(') {
      take('(');
      const args: Place[] = [];
      while (peek()?.text !== ')') {
        args.push(expression());
        if (peek()?.text === ',') take(',');
      }
      take(')');
      const name = token.text;
      place = TYPES.has(name)
        ? { read: () => construct(name, args.map((arg) => arg.read())) }
        : functions.has(name)
          ? { read: () => callFunction(name, args.map((arg) => arg.read())) }
          : { read: () => builtin(name, args.map((arg) => arg.read()), new Map(), samplerOf) };
    } else if (token.kind === 'name') {
      const name = token.text;
      place = {
        read: () => {
          if (!variables.has(name)) throw new Error(`GLSL: ${name} has no value`);
          return variables.get(name) as ShaderValue;
        },
        write: (value) => {
          variables.set(name, value);
        },
      };
    } else {
      throw new Error(`GLSL: ${token.text} is not an expression`);
    }
    while (peek()?.text === '.') {
      take('.');
      const name = take().text;
      const owner = place;
      place = {
        read: () => swizzle(owner.read(), name),
        write: owner.write === undefined ? undefined : (value) => owner.write?.(assignSwizzle(owner.read(), name, value)),
      };
    }
    return place;
  };
  const unary = (): Place => primary();
  const binaryAt = (minimum: number): Place => {
    let left = unary();
    for (;;) {
      const op = peek()?.text ?? '';
      const precedence = PRECEDENCE[op];
      if (precedence === undefined || precedence < minimum) return left;
      take();
      const right = binaryAt(precedence + 1);
      const l = left;
      left = { read: () => binary(op, l.read(), right.read()) };
    }
  };
  const expression = (): Place => binaryAt(1);
  class Returned {
    constructor(readonly value: ShaderValue | undefined) {}
  }
  /** The printed helper functions: their parameters and the token range of their bodies. */
  const functions = new Map<string, { readonly parameters: readonly string[]; readonly start: number; readonly end: number }>();
  const statement = (): void => {
    const token = peek();
    if (token === undefined) return;
    if (token.text === '{') {
      take('{');
      while (peek()?.text !== '}') statement();
      take('}');
      return;
    }
    if (token.text === 'const') take('const');
    if (token.kind === 'name' && TYPES.has(token.text) && tokens[at + 1]?.kind === 'name') {
      take();
      const name = take().text;
      if (peek()?.text === '=') {
        take('=');
        variables.set(name, expression().read());
      } else {
        variables.set(name, 0);
      }
      take(';');
      return;
    }
    if (token.text === 'if') {
      take('if');
      take('(');
      const condition = expression().read();
      take(')');
      const start = at;
      const skip = (): void => {
        // A braced block, skipped unrun.
        take('{');
        let depth = 1;
        while (depth > 0) {
          const next = take().text;
          if (next === '{') depth += 1;
          if (next === '}') depth -= 1;
        }
      };
      if (condition) statement();
      else skip();
      void start;
      if (peek()?.text === 'else') {
        take('else');
        if (condition) skip();
        else statement();
      }
      return;
    }
    if (token.text === 'return') {
      take('return');
      const value = peek()?.text === ';' ? undefined : expression().read();
      take(';');
      throw new Returned(value);
    }
    const target = expression();
    const op = peek()?.text;
    if (op === '=' || op === '+=' || op === '-=' || op === '*=' || op === '/=') {
      take();
      const value = expression().read();
      if (target.write === undefined) throw new Error('GLSL: an assignment to an unassignable place');
      target.write(op === '=' ? value : binary(op.slice(0, 1), target.read(), value));
    } else {
      target.read();
    }
    take(';');
  };
  const callFunction = (name: string, args: readonly ShaderValue[]): ShaderValue => {
    const fn = functions.get(name) as { readonly parameters: readonly string[]; readonly start: number; readonly end: number };
    const saved = new Map(variables);
    const resume = at;
    fn.parameters.forEach((parameter, index) => variables.set(parameter, args[index] as ShaderValue));
    at = fn.start;
    try {
      while (at < fn.end) statement();
      return 0;
    } catch (error) {
      if (error instanceof Returned) return error.value ?? 0;
      throw error;
    } finally {
      at = resume;
      variables.clear();
      for (const [key, value] of saved) variables.set(key, value);
    }
  };
  // Helper function definitions (`float godot_f_band(float godot_l_v, …) { … }`) come first.
  while (tokens[at]?.kind === 'name' && TYPES_AND_VOID.has(tokens[at]?.text ?? '') && tokens[at + 1]?.kind === 'name' && tokens[at + 2]?.text === '(') {
    take();
    const name = take().text;
    take('(');
    const parameters: string[] = [];
    while (peek()?.text !== ')') {
      take();
      parameters.push(take().text);
      if (peek()?.text === ',') take(',');
    }
    take(')');
    take('{');
    const start = at;
    let depth = 1;
    while (depth > 0) {
      const next = take().text;
      if (next === '{') depth += 1;
      if (next === '}') depth -= 1;
    }
    functions.set(name, { parameters, start, end: at - 1 });
  }
  try {
    while (at < tokens.length) statement();
  } catch (error) {
    if (!(error instanceof Returned)) throw error;
  }
}

const TYPES_AND_VOID = new Set(['void', 'float', 'vec2', 'vec3', 'vec4', 'int', 'bool']);
