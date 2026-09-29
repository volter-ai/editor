/**
 * A Godot shader's tree (the pinned frontend's, `bound-shader.ts`) lowered to GLSL ES 3.0 for three:
 * the uniforms, the helper functions and the entry function's body, every expression fully
 * parenthesized. Names are the shader's own under fixed prefixes (`godot_u_` uniforms, `godot_l_`
 * locals and parameters, `godot_f_` functions); a built-in is what the caller maps it to for the
 * shader's mode (`sky`: `sky-material.ts`); GLSL's own functions keep their names, which Godot's
 * shading language shares. A construct this lowering does not carry refuses by name.
 */
import type { GodotBoundShader, GodotShaderNode, GodotShaderScalar, GodotShaderUniform } from '../../godot-frontend/bound-shader';

/** `ShaderLanguage::Operator` (`servers/rendering/shader_language.h:262`). */
const OP = {
  EQUAL: 0,
  NOT_EQUAL: 1,
  LESS: 2,
  LESS_EQUAL: 3,
  GREATER: 4,
  GREATER_EQUAL: 5,
  AND: 6,
  OR: 7,
  NOT: 8,
  NEGATE: 9,
  ADD: 10,
  SUB: 11,
  MUL: 12,
  DIV: 13,
  MOD: 14,
  SHIFT_LEFT: 15,
  SHIFT_RIGHT: 16,
  ASSIGN: 17,
  ASSIGN_ADD: 18,
  ASSIGN_SUB: 19,
  ASSIGN_MUL: 20,
  ASSIGN_DIV: 21,
  ASSIGN_MOD: 22,
  ASSIGN_SHIFT_LEFT: 23,
  ASSIGN_SHIFT_RIGHT: 24,
  ASSIGN_BIT_AND: 25,
  ASSIGN_BIT_OR: 26,
  ASSIGN_BIT_XOR: 27,
  BIT_AND: 28,
  BIT_OR: 29,
  BIT_XOR: 30,
  BIT_INVERT: 31,
  INCREMENT: 32,
  DECREMENT: 33,
  SELECT_IF: 34,
  POST_INCREMENT: 36,
  POST_DECREMENT: 37,
  CALL: 38,
  CONSTRUCT: 39,
  STRUCT: 40,
  INDEX: 41,
  EMPTY: 42,
} as const;

/** The GLSL spelling of each binary and assigning operator. */
const BINARY: Readonly<Record<number, string>> = {
  [OP.EQUAL]: '==',
  [OP.NOT_EQUAL]: '!=',
  [OP.LESS]: '<',
  [OP.LESS_EQUAL]: '<=',
  [OP.GREATER]: '>',
  [OP.GREATER_EQUAL]: '>=',
  [OP.AND]: '&&',
  [OP.OR]: '||',
  [OP.ADD]: '+',
  [OP.SUB]: '-',
  [OP.MUL]: '*',
  [OP.DIV]: '/',
  [OP.MOD]: '%',
  [OP.SHIFT_LEFT]: '<<',
  [OP.SHIFT_RIGHT]: '>>',
  [OP.BIT_AND]: '&',
  [OP.BIT_OR]: '|',
  [OP.BIT_XOR]: '^',
  [OP.ASSIGN]: '=',
  [OP.ASSIGN_ADD]: '+=',
  [OP.ASSIGN_SUB]: '-=',
  [OP.ASSIGN_MUL]: '*=',
  [OP.ASSIGN_DIV]: '/=',
  [OP.ASSIGN_MOD]: '%=',
  [OP.ASSIGN_SHIFT_LEFT]: '<<=',
  [OP.ASSIGN_SHIFT_RIGHT]: '>>=',
  [OP.ASSIGN_BIT_AND]: '&=',
  [OP.ASSIGN_BIT_OR]: '|=',
  [OP.ASSIGN_BIT_XOR]: '^=',
};
const ASSIGNING = new Set<number>([OP.ASSIGN, OP.ASSIGN_ADD, OP.ASSIGN_SUB, OP.ASSIGN_MUL, OP.ASSIGN_DIV, OP.ASSIGN_MOD, OP.ASSIGN_SHIFT_LEFT, OP.ASSIGN_SHIFT_RIGHT, OP.ASSIGN_BIT_AND, OP.ASSIGN_BIT_OR, OP.ASSIGN_BIT_XOR]);
const PREFIX: Readonly<Record<number, string>> = { [OP.NOT]: '!', [OP.NEGATE]: '-', [OP.BIT_INVERT]: '~', [OP.INCREMENT]: '++', [OP.DECREMENT]: '--' };
const POSTFIX: Readonly<Record<number, string>> = { [OP.POST_INCREMENT]: '++', [OP.POST_DECREMENT]: '--' };

/** `ShaderLanguage::FlowOperation` (`shader_language.h:309`). */
const FLOW = { IF: 0, RETURN: 1, FOR: 2, WHILE: 3, DO: 4, BREAK: 5, SWITCH: 6, CASE: 7, DEFAULT: 8, CONTINUE: 9, DISCARD: 10 } as const;

/** The GLSL types a lowered shader may name: Godot's scalar, vector, matrix and sampler types. */
const GLSL_TYPES = new Set([
  'void',
  'bool',
  'bvec2',
  'bvec3',
  'bvec4',
  'int',
  'ivec2',
  'ivec3',
  'ivec4',
  'uint',
  'uvec2',
  'uvec3',
  'uvec4',
  'float',
  'vec2',
  'vec3',
  'vec4',
  'mat2',
  'mat3',
  'mat4',
  'sampler2D',
  'isampler2D',
  'usampler2D',
  'sampler2DArray',
  'isampler2DArray',
  'usampler2DArray',
  'sampler3D',
  'isampler3D',
  'usampler3D',
  'samplerCube',
]);

/** How the caller writes the shader mode's built-ins, by Godot name (`EYEDIR`). */
export type GodotShaderBuiltins = Readonly<Record<string, string>>;

export interface LoweredGodotShader {
  /** `uniform <type> godot_u_<name>;` for each uniform, in Godot's order. */
  readonly uniforms: readonly { readonly name: string; readonly glsl: string; readonly declaration: string; readonly uniform: GodotShaderUniform }[];
  /** The shader's own functions other than the entry, in declaration order. */
  readonly functions: string;
  /** The entry function's body statements. */
  readonly entry: string;
  /** The built-ins the shader reads or writes. */
  readonly builtins: ReadonlySet<string>;
  /** `varying <type> godot_v_<name>;` for each varying, declared in both stages. */
  readonly varyings: string;
}

class Refused extends Error {}

/** A binary32 float literal GLSL reads back as the same float. */
export function glslFloat(value: number): string {
  if (!Number.isFinite(value)) throw new Refused(`the float constant ${String(value)} has no GLSL literal`);
  for (let digits = 1; digits <= 17; digits += 1) {
    const text = value.toPrecision(digits);
    if (Math.fround(Number(text)) === Math.fround(value)) {
      const plain = Number(text).toString();
      return /[.eE]/.test(plain) ? (plain.includes('e') && !plain.includes('.') ? plain.replace('e', '.0e') : plain) : `${plain}.0`;
    }
  }
  return value.toString();
}

function scalarText(value: GodotShaderScalar): string {
  if ('bool' in value) return value.bool ? 'true' : 'false';
  if ('int' in value) return String(value.int);
  if ('uint' in value) return `${String(value.uint)}u`;
  return glslFloat(value.float);
}

/**
 * The shader lowered with `builtins` naming its mode's built-ins and `entry` naming the function
 * the mode runs (`sky`, `fragment`), or the construct it does not carry.
 */
export function lowerGodotShader(shader: GodotBoundShader, builtins: GodotShaderBuiltins, entry: string, otherEntries: readonly string[] = []): LoweredGodotShader | string {
  if (!shader.ok) return `${shader.path}: the official shader frontend refused it (${shader.stage}: ${shader.message})`;
  const tree = shader.tree;
  if (tree.structs.length > 0) return `${shader.path}: shader structs are not lowered`;
  const used = new Set<string>();
  const uniformNames = new Set(tree.uniforms.map((uniform) => uniform.name));
  const constantNames = new Set(tree.constants.map((constant) => constant.name));
  const varyingNames = new Set(tree.varyings.map((varying) => varying.name));
  const functionNames = new Set(tree.functions.map((entry2) => entry2.name));
  const type = (name: string): string => {
    if (!GLSL_TYPES.has(name)) throw new Refused(`the ${name} type is not lowered`);
    return name;
  };
  const expression = (node: GodotShaderNode): string => {
    switch (node.kind) {
      case 'CONSTANT': {
        if (node.values.length === 1) return scalarText(node.values[0] as GodotShaderScalar);
        return `${type(node.datatype.name)}(${node.values.map(scalarText).join(', ')})`;
      }
      case 'VARIABLE': {
        if (node.local) return `godot_l_${node.name}`;
        if (uniformNames.has(node.name)) return `godot_u_${node.name}`;
        if (constantNames.has(node.name)) return `godot_c_${node.name}`;
        if (varyingNames.has(node.name)) return `godot_v_${node.name}`;
        const builtin = builtins[node.name];
        if (builtin === undefined) throw new Refused(`the built-in ${node.name} is not carried`);
        used.add(node.name);
        return builtin;
      }
      case 'MEMBER': {
        if (node.owner === null) throw new Refused('a member without its owner');
        if (node.callExpression !== null || node.assignExpression !== null) throw new Refused(`the member ${node.name}'s call or assignment is not lowered`);
        const base = `${expression(node.owner)}.${node.name}`;
        return node.indexExpression === null ? base : `${base}[${expression(node.indexExpression)}]`;
      }
      case 'OPERATOR':
        return operator(node);
      // A local array's element, or its `length()`.
      case 'ARRAY': {
        if (!node.local) throw new Refused(`the ${node.name} array is not lowered`);
        if (node.assignExpression !== null) throw new Refused(`the ${node.name} array's assignment is not lowered`);
        const base = `godot_l_${node.name}`;
        if (node.callExpression !== null) return `${base}.length()`;
        return node.indexExpression === null ? base : `${base}[${expression(node.indexExpression)}]`;
      }
      // `{a, b, c}` or `float[3](a, b, c)`: GLSL's array constructor.
      case 'ARRAY_CONSTRUCT':
        return `${type(node.datatype.name)}[${String(node.initializer.length)}](${node.initializer.map(expression).join(', ')})`;
      default:
        throw new Refused(`a ${node.kind} expression is not lowered`);
    }
  };
  const operator = (node: Extract<GodotShaderNode, { kind: 'OPERATOR' }>): string => {
    const args = node.arguments;
    const arg = (index: number): GodotShaderNode => {
      const found = args[index];
      if (found === undefined) throw new Refused(`the ${node.opText} operator lacks argument ${String(index)}`);
      return found;
    };
    const binary = BINARY[node.op];
    if (binary !== undefined) return ASSIGNING.has(node.op) ? `${expression(arg(0))} ${binary} ${expression(arg(1))}` : `(${expression(arg(0))} ${binary} ${expression(arg(1))})`;
    const prefix = PREFIX[node.op];
    if (prefix !== undefined) return `(${prefix}${expression(arg(0))})`;
    const postfix = POSTFIX[node.op];
    if (postfix !== undefined) return `(${expression(arg(0))}${postfix})`;
    switch (node.op) {
      case OP.SELECT_IF:
        return `(${expression(arg(0))} ? ${expression(arg(1))} : ${expression(arg(2))})`;
      case OP.INDEX:
        return `${expression(arg(0))}[${expression(arg(1))}]`;
      case OP.CONSTRUCT: {
        const callee = arg(0);
        if (callee.kind !== 'VARIABLE') throw new Refused('a constructor without its type');
        return `${type(callee.name)}(${args.slice(1).map(expression).join(', ')})`;
      }
      case OP.CALL: {
        const callee = arg(0);
        if (callee.kind !== 'VARIABLE') throw new Refused('a call without its function');
        const name = functionNames.has(callee.name) ? `godot_f_${callee.name}` : callee.name;
        if (!functionNames.has(callee.name) && !/^[a-zA-Z][a-zA-Z0-9]*$/.test(callee.name)) throw new Refused(`the ${callee.name} function is not lowered`);
        return `${name}(${args.slice(1).map(expression).join(', ')})`;
      }
      case OP.EMPTY:
        return '';
      default:
        throw new Refused(`the ${node.opText} operator (${String(node.op)}) is not lowered`);
    }
  };
  const statement = (node: GodotShaderNode, indent: string): string => {
    switch (node.kind) {
      case 'VARIABLE_DECLARATION':
        return node.declarations
          .map((declaration) => {
            const declared = type(node.declared.name);
            if (declaration.size > 0 || declaration.sizeExpression !== null) {
              // A local array: `float w[8] = float[8](…)` (GLSL ES 3.0), from its `{…}` list or its one array expression.
              const size = declaration.sizeExpression === null ? String(declaration.size) : expression(declaration.sizeExpression);
              const list = declaration.singleExpression ? undefined : declaration.initializer;
              const single = declaration.singleExpression ? declaration.initializer[0] : undefined;
              const value = list !== undefined && list.length > 0 ? `${declared}[${size}](${list.map(expression).join(', ')})` : single === undefined ? undefined : expression(single);
              return `${indent}${node.const ? 'const ' : ''}${declared} godot_l_${declaration.name}[${size}]${value === undefined ? '' : ` = ${value}`};`;
            }
            const initializer = declaration.initializer[0];
            return `${indent}${node.const ? 'const ' : ''}${declared} godot_l_${declaration.name}${initializer === undefined ? '' : ` = ${expression(initializer)}`};`;
          })
          .join('\n');
      case 'BLOCK':
        return `${indent}{\n${block(node, `${indent}\t`)}\n${indent}}`;
      case 'CONTROL_FLOW': {
        const expr = (index: number): string => {
          const found = node.expressions[index];
          return found === undefined ? '' : expression(found);
        };
        const body = (index: number): string => {
          const found = node.blocks[index];
          if (found === undefined || found.kind !== 'BLOCK') throw new Refused('a control flow without its block');
          return `{\n${block(found, `${indent}\t`)}\n${indent}}`;
        };
        switch (node.flowOp) {
          case FLOW.IF:
            return `${indent}if (${expr(0)}) ${body(0)}${node.blocks.length > 1 ? ` else ${body(1)}` : ''}`;
          case FLOW.FOR: {
            // `for (init; condition; step) body`: its four blocks (`ShaderLanguage::_parse_block`,
            // `shader_language.cpp:8796`), each of the first three one statement.
            const part = (index: number): string => {
              const found = node.blocks[index];
              if (found === undefined || found.kind !== 'BLOCK') throw new Refused('a for loop without its blocks');
              return found.statements.map((entry2) => statement(entry2, '').replace(/;$/u, '')).join(', ');
            };
            return `${indent}for (${part(0)}; ${part(1)}; ${part(2)}) ${body(3)}`;
          }
          case FLOW.RETURN:
            return `${indent}return${node.expressions.length > 0 ? ` ${expr(0)}` : ''};`;
          case FLOW.WHILE:
            return `${indent}while (${expr(0)}) ${body(0)}`;
          case FLOW.DO:
            return `${indent}do ${body(0)} while (${expr(0)});`;
          case FLOW.BREAK:
            return `${indent}break;`;
          case FLOW.CONTINUE:
            return `${indent}continue;`;
          case FLOW.DISCARD:
            return `${indent}discard;`;
          default:
            throw new Refused(`the flow operation ${String(node.flowOp)} is not lowered`);
        }
      }
      default:
        return `${indent}${expression(node)};`;
    }
  };
  const block = (node: Extract<GodotShaderNode, { kind: 'BLOCK' }>, indent: string): string => node.statements.map((entry2) => statement(entry2, indent)).join('\n');
  try {
    const uniforms = tree.uniforms.map((uniform) => {
      if (uniform.scope !== 0) throw new Refused(`the ${uniform.name} uniform's scope is not lowered`);
      if (uniform.type.arraySize > 0) throw new Refused(`the ${uniform.name} uniform array is not lowered`);
      const glsl = `godot_u_${uniform.name}`;
      return { name: uniform.name, glsl, declaration: `uniform ${type(uniform.type.name)} ${glsl};`, uniform };
    });
    let entryBody: string | undefined;
    // The global constants first, in declaration order: `const <type> godot_c_<name> = <value>;`.
    const functions: string[] = tree.constants.map((constant) => {
      if (constant.type.arraySize > 0 || constant.initializer === null) throw new Refused(`the ${constant.name} constant is not lowered`);
      return `const ${type(constant.type.name)} godot_c_${constant.name} = ${expression(constant.initializer)};`;
    });
    for (const { name, function: fn } of tree.functions) {
      if (fn === null || fn.kind !== 'FUNCTION' || fn.body === null || fn.body.kind !== 'BLOCK') throw new Refused(`the ${name} function has no body`);
      if (name === entry) {
        entryBody = block(fn.body, '\t');
        continue;
      }
      // Another stage's entry (`vertex()` while lowering `fragment()`) is lowered with its own stage.
      if (otherEntries.includes(name)) continue;
      const parameters = fn.arguments.map((argument) => {
        if (argument.qualifier !== 0) throw new Refused(`the ${name} function's out/inout parameters are not lowered`);
        return `${type(argument.type.name)} godot_l_${argument.name}`;
      });
      functions.push(`${type(fn.returnType.name)} godot_f_${name}(${parameters.join(', ')}) {\n${block(fn.body, '\t')}\n}`);
    }
    if (entryBody === undefined) return `${shader.path}: the shader has no ${entry}() function`;
    const varyings = tree.varyings.map((varying) => {
      if (varying.type.arraySize > 0) throw new Refused(`the ${varying.name} varying array is not lowered`);
      return `varying ${type(varying.type.name)} godot_v_${varying.name};`;
    });
    return { uniforms, functions: functions.join('\n\n'), entry: entryBody, builtins: used, varyings: varyings.join('\n') };
  } catch (error) {
    if (error instanceof Refused) return `${shader.path}: ${error.message}`;
    throw error;
  }
}
