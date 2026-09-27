/**
 * A `.gdshader` as the pinned Godot's own shader frontend reads it: `ShaderPreprocessor`, then
 * `ShaderLanguage::compile` over the server's `ShaderTypes` for the shader's mode (as
 * `Shader::set_code` and `ShaderCompiler::compile` run them), its parsed and type-checked tree
 * exported node by node by the bound exporter (`shader_frontend_exporter.cpp`). Every type, operator
 * and resolved name here is the official parser's; a float constant is its exact binary32 bits.
 */

/** A data type as `ShaderLanguage::DataType` and its name (`vec3`, `samplerCube`). */
export interface GodotShaderType {
  readonly id: number;
  readonly name: string;
  readonly struct: string;
  readonly arraySize: number;
}

/** A constant scalar, by its type's scalar kind. */
export type GodotShaderScalar =
  | { readonly bool: boolean }
  | { readonly int: number }
  | { readonly uint: number }
  | { readonly float: number };

interface NodeBase {
  readonly datatype: GodotShaderType;
}

export type GodotShaderNode =
  | (NodeBase & {
      readonly kind: 'OPERATOR';
      readonly op: number;
      readonly opText: string;
      readonly arguments: readonly GodotShaderNode[];
      readonly values: readonly GodotShaderScalar[];
    })
  | (NodeBase & { readonly kind: 'VARIABLE'; readonly name: string; readonly rname: string; readonly const: boolean; readonly local: boolean })
  | (NodeBase & {
      readonly kind: 'VARIABLE_DECLARATION';
      readonly precision: string;
      readonly declared: GodotShaderType;
      readonly const: boolean;
      readonly declarations: readonly {
        readonly name: string;
        readonly size: number;
        readonly sizeExpression: GodotShaderNode | null;
        readonly initializer: readonly GodotShaderNode[];
        readonly singleExpression: boolean;
      }[];
    })
  | (NodeBase & {
      readonly kind: 'CONSTANT';
      readonly values: readonly GodotShaderScalar[];
      readonly arrayDeclarations: readonly { readonly name: string; readonly size: number; readonly initializer: readonly GodotShaderNode[] }[];
    })
  | (NodeBase & {
      readonly kind: 'BLOCK';
      readonly blockType: number;
      readonly singleStatement: boolean;
      readonly commaBetweenStatements: boolean;
      readonly statements: readonly GodotShaderNode[];
    })
  | (NodeBase & {
      readonly kind: 'CONTROL_FLOW';
      readonly flowOp: number;
      readonly expressions: readonly GodotShaderNode[];
      readonly blocks: readonly GodotShaderNode[];
    })
  | (NodeBase & {
      readonly kind: 'MEMBER';
      readonly basetype: GodotShaderType;
      readonly name: string;
      readonly owner: GodotShaderNode | null;
      readonly indexExpression: GodotShaderNode | null;
      readonly assignExpression: GodotShaderNode | null;
      readonly callExpression: GodotShaderNode | null;
      readonly swizzleDuplicates: boolean;
    })
  | (NodeBase & {
      readonly kind: 'ARRAY';
      readonly name: string;
      readonly local: boolean;
      readonly const: boolean;
      readonly indexExpression: GodotShaderNode | null;
      readonly callExpression: GodotShaderNode | null;
      readonly assignExpression: GodotShaderNode | null;
    })
  | (NodeBase & { readonly kind: 'ARRAY_CONSTRUCT'; readonly initializer: readonly GodotShaderNode[] })
  | (NodeBase & { readonly kind: 'STRUCT'; readonly members: readonly GodotShaderNode[] })
  | (NodeBase & {
      readonly kind: 'FUNCTION';
      readonly name: string;
      readonly rname: string;
      readonly returnType: GodotShaderType;
      readonly arguments: readonly { readonly name: string; readonly type: GodotShaderType; readonly qualifier: number; readonly const: boolean }[];
      readonly body: GodotShaderNode | null;
      readonly canDiscard: boolean;
    });

export interface GodotShaderUniform {
  readonly name: string;
  readonly type: GodotShaderType;
  readonly order: number;
  readonly textureOrder: number;
  readonly scope: number;
  readonly hint: number;
  readonly hintName: string;
  readonly useColor: boolean;
  readonly filter: number;
  readonly repeat: number;
  readonly hintRange: readonly [number, number, number];
  readonly default: readonly GodotShaderScalar[];
  readonly group: string;
}

export interface GodotShaderTree {
  readonly renderModes: readonly string[];
  readonly uniforms: readonly GodotShaderUniform[];
  readonly varyings: readonly { readonly name: string; readonly type: GodotShaderType; readonly stage: number; readonly interpolation: number }[];
  readonly constants: readonly { readonly name: string; readonly type: GodotShaderType; readonly initializer: GodotShaderNode | null }[];
  readonly structs: readonly { readonly name: string; readonly struct: GodotShaderNode | null }[];
  readonly functions: readonly { readonly name: string; readonly callable: boolean; readonly function: GodotShaderNode | null }[];
}

/** One exported shader file: its tree, or the official frontend's refusal. */
export type GodotBoundShader =
  | {
      readonly path: string;
      readonly sourceSha256: string;
      readonly ok: true;
      readonly preprocessed: string;
      readonly shaderType: string;
      readonly tree: GodotShaderTree;
    }
  | {
      readonly path: string;
      readonly sourceSha256: string;
      readonly ok: false;
      readonly stage: string;
      readonly message: string;
      readonly shaderType?: string;
      readonly preprocessed?: string;
      readonly line?: number;
    };

/**
 * A shader an engine material class generates for itself (`sky_material.cpp` `_update_shader`),
 * captured from the server as that class built it and read by the same frontend as a `.gdshader`.
 * `variant` names the properties that select which of the class's shaders it is.
 */
export type GodotBoundEngineShader = GodotBoundShader & {
  readonly materialClass: string;
  readonly variant: Readonly<Record<string, boolean>>;
};

type Row = Record<string, unknown>;

function row(value: unknown, at: string): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${at} must be an object`);
  return value as Row;
}
function list(value: unknown, at: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${at} must be an array`);
  return value;
}
function text(value: unknown, at: string): string {
  if (typeof value !== 'string') throw new Error(`${at} must be a string`);
  return value;
}
function integer(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${at} must be an integer`);
  return value;
}
function flag(value: unknown, at: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${at} must be a boolean`);
  return value;
}

/** A binary32 float from its bits. */
function floatFromBits(bits: number): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, bits >>> 0);
  return view.getFloat32(0);
}

function scalar(value: unknown, at: string): GodotShaderScalar {
  const r = row(value, at);
  if ('bool' in r) return { bool: flag(r['bool'], `${at}.bool`) };
  if ('int' in r) return { int: integer(r['int'], `${at}.int`) };
  if ('uint' in r) return { uint: integer(r['uint'], `${at}.uint`) };
  if ('floatBits' in r) return { float: floatFromBits(integer(r['floatBits'], `${at}.floatBits`)) };
  throw new Error(`${at} is not a shader scalar`);
}

function type(value: unknown, at: string): GodotShaderType {
  const r = row(value, at);
  return { id: integer(r['id'], `${at}.id`), name: text(r['name'], `${at}.name`), struct: text(r['struct'], `${at}.struct`), arraySize: integer(r['arraySize'], `${at}.arraySize`) };
}

function maybeNode(value: unknown, at: string): GodotShaderNode | null {
  return value === null || value === undefined ? null : node(value, at);
}

function nodes(value: unknown, at: string): readonly GodotShaderNode[] {
  return list(value, at).map((entry, index) => node(entry, `${at}[${index}]`));
}

function node(value: unknown, at: string): GodotShaderNode {
  const r = row(value, at);
  const kind = text(r['kind'], `${at}.kind`);
  const datatype = type(r['datatype'], `${at}.datatype`);
  switch (kind) {
    case 'OPERATOR':
      return {
        kind,
        datatype,
        op: integer(r['op'], `${at}.op`),
        opText: text(r['opText'], `${at}.opText`),
        arguments: nodes(r['arguments'], `${at}.arguments`),
        values: list(r['values'], `${at}.values`).map((entry, index) => scalar(entry, `${at}.values[${index}]`)),
      };
    case 'VARIABLE':
      return { kind, datatype, name: text(r['name'], `${at}.name`), rname: text(r['rname'], `${at}.rname`), const: flag(r['const'], `${at}.const`), local: flag(r['local'], `${at}.local`) };
    case 'VARIABLE_DECLARATION':
      return {
        kind,
        datatype,
        precision: text(r['precision'], `${at}.precision`),
        declared: type(r['declared'], `${at}.declared`),
        const: flag(r['const'], `${at}.const`),
        declarations: list(r['declarations'], `${at}.declarations`).map((entry, index) => {
          const d = row(entry, `${at}.declarations[${index}]`);
          return {
            name: text(d['name'], `${at}.declarations[${index}].name`),
            size: integer(d['size'], `${at}.declarations[${index}].size`),
            sizeExpression: maybeNode(d['sizeExpression'], `${at}.declarations[${index}].sizeExpression`),
            initializer: nodes(d['initializer'], `${at}.declarations[${index}].initializer`),
            singleExpression: flag(d['singleExpression'], `${at}.declarations[${index}].singleExpression`),
          };
        }),
      };
    case 'CONSTANT':
      return {
        kind,
        datatype,
        values: list(r['values'], `${at}.values`).map((entry, index) => scalar(entry, `${at}.values[${index}]`)),
        arrayDeclarations: list(r['arrayDeclarations'], `${at}.arrayDeclarations`).map((entry, index) => {
          const d = row(entry, `${at}.arrayDeclarations[${index}]`);
          return { name: text(d['name'], `${at}.name`), size: integer(d['size'], `${at}.size`), initializer: nodes(d['initializer'], `${at}.initializer`) };
        }),
      };
    case 'BLOCK':
      return {
        kind,
        datatype,
        blockType: integer(r['blockType'], `${at}.blockType`),
        singleStatement: flag(r['singleStatement'], `${at}.singleStatement`),
        commaBetweenStatements: flag(r['commaBetweenStatements'], `${at}.commaBetweenStatements`),
        statements: nodes(r['statements'], `${at}.statements`),
      };
    case 'CONTROL_FLOW':
      return { kind, datatype, flowOp: integer(r['flowOp'], `${at}.flowOp`), expressions: nodes(r['expressions'], `${at}.expressions`), blocks: nodes(r['blocks'], `${at}.blocks`) };
    case 'MEMBER':
      return {
        kind,
        datatype,
        basetype: type(r['basetype'], `${at}.basetype`),
        name: text(r['name'], `${at}.name`),
        owner: maybeNode(r['owner'], `${at}.owner`),
        indexExpression: maybeNode(r['indexExpression'], `${at}.indexExpression`),
        assignExpression: maybeNode(r['assignExpression'], `${at}.assignExpression`),
        callExpression: maybeNode(r['callExpression'], `${at}.callExpression`),
        swizzleDuplicates: flag(r['swizzleDuplicates'], `${at}.swizzleDuplicates`),
      };
    case 'ARRAY':
      return {
        kind,
        datatype,
        name: text(r['name'], `${at}.name`),
        local: flag(r['local'], `${at}.local`),
        const: flag(r['const'], `${at}.const`),
        indexExpression: maybeNode(r['indexExpression'], `${at}.indexExpression`),
        callExpression: maybeNode(r['callExpression'], `${at}.callExpression`),
        assignExpression: maybeNode(r['assignExpression'], `${at}.assignExpression`),
      };
    case 'ARRAY_CONSTRUCT':
      return { kind, datatype, initializer: nodes(r['initializer'], `${at}.initializer`) };
    case 'STRUCT':
      return { kind, datatype, members: nodes(r['members'], `${at}.members`) };
    case 'FUNCTION':
      return {
        kind,
        datatype,
        name: text(r['name'], `${at}.name`),
        rname: text(r['rname'], `${at}.rname`),
        returnType: type(r['returnType'], `${at}.returnType`),
        arguments: list(r['arguments'], `${at}.arguments`).map((entry, index) => {
          const a = row(entry, `${at}.arguments[${index}]`);
          return { name: text(a['name'], `${at}.name`), type: type(a['type'], `${at}.type`), qualifier: integer(a['qualifier'], `${at}.qualifier`), const: flag(a['const'], `${at}.const`) };
        }),
        body: maybeNode(r['body'], `${at}.body`),
        canDiscard: flag(r['canDiscard'], `${at}.canDiscard`),
      };
    default:
      throw new Error(`${at}: shader node kind ${kind} is not exported`);
  }
}

function tree(value: unknown, at: string): GodotShaderTree {
  const r = row(value, at);
  return {
    renderModes: list(r['renderModes'], `${at}.renderModes`).map((entry, index) => text(entry, `${at}.renderModes[${index}]`)),
    uniforms: list(r['uniforms'], `${at}.uniforms`).map((entry, index) => {
      const u = row(entry, `${at}.uniforms[${index}]`);
      const range = list(u['hintRangeBits'], `${at}.hintRangeBits`).map((bits) => floatFromBits(integer(bits, `${at}.hintRangeBits`)));
      return {
        name: text(u['name'], `${at}.name`),
        type: type(u['type'], `${at}.type`),
        order: integer(u['order'], `${at}.order`),
        textureOrder: integer(u['textureOrder'], `${at}.textureOrder`),
        scope: integer(u['scope'], `${at}.scope`),
        hint: integer(u['hint'], `${at}.hint`),
        hintName: text(u['hintName'], `${at}.hintName`),
        useColor: flag(u['useColor'], `${at}.useColor`),
        filter: integer(u['filter'], `${at}.filter`),
        repeat: integer(u['repeat'], `${at}.repeat`),
        hintRange: [range[0] ?? 0, range[1] ?? 1, range[2] ?? 0.001],
        default: list(u['default'], `${at}.default`).map((entry2, index2) => scalar(entry2, `${at}.default[${index2}]`)),
        group: text(u['group'], `${at}.group`),
      };
    }),
    varyings: list(r['varyings'], `${at}.varyings`).map((entry) => {
      const v = row(entry, `${at}.varyings`);
      return { name: text(v['name'], `${at}.name`), type: type(v['type'], `${at}.type`), stage: integer(v['stage'], `${at}.stage`), interpolation: integer(v['interpolation'], `${at}.interpolation`) };
    }),
    constants: list(r['constants'], `${at}.constants`).map((entry) => {
      const c = row(entry, `${at}.constants`);
      return { name: text(c['name'], `${at}.name`), type: type(c['type'], `${at}.type`), initializer: maybeNode(c['initializer'], `${at}.initializer`) };
    }),
    structs: list(r['structs'], `${at}.structs`).map((entry) => {
      const s = row(entry, `${at}.structs`);
      return { name: text(s['name'], `${at}.name`), struct: maybeNode(s['struct'], `${at}.struct`) };
    }),
    functions: list(r['functions'], `${at}.functions`).map((entry) => {
      const f = row(entry, `${at}.functions`);
      return { name: text(f['name'], `${at}.name`), callable: flag(f['callable'], `${at}.callable`), function: maybeNode(f['function'], `${at}.function`) };
    }),
  };
}

/** One exported `.gdshader` row of the bound program. */
export function decodeGodotBoundShader(value: unknown, at: string): GodotBoundShader {
  const r = row(value, at);
  const path = text(r['path'], `${at}.path`);
  const sourceSha256 = text(r['sourceSha256'], `${at}.sourceSha256`);
  if (r['ok'] === true) {
    return { path, sourceSha256, ok: true, preprocessed: text(r['preprocessed'], `${at}.preprocessed`), shaderType: text(r['shaderType'], `${at}.shaderType`), tree: tree(r['tree'], `${at}.tree`) };
  }
  return {
    path,
    sourceSha256,
    ok: false,
    stage: text(r['stage'], `${at}.stage`),
    message: text(r['message'], `${at}.message`),
    ...(typeof r['shaderType'] === 'string' ? { shaderType: r['shaderType'] } : {}),
    ...(typeof r['preprocessed'] === 'string' ? { preprocessed: r['preprocessed'] } : {}),
    ...(typeof r['line'] === 'number' ? { line: r['line'] } : {}),
  };
}

/** One engine material shader row of the bound program. */
export function decodeGodotBoundEngineShader(value: unknown, at: string): GodotBoundEngineShader {
  const r = row(value, at);
  const variant = row(r['variant'], `${at}.variant`);
  return {
    ...decodeGodotBoundShader(value, at),
    materialClass: text(r['materialClass'], `${at}.materialClass`),
    variant: Object.fromEntries(
      Object.entries(variant).map(([key, entry]) => [key, flag(entry, `${at}.variant.${key}`)]),
    ),
  };
}
