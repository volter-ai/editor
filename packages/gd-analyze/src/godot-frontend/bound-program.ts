import { godotSourceAuthority } from './source-authority';

export const GODOT_BOUND_PROGRAM_PROTOCOL = 'vgai.godot-bound-program' as const;
export const GODOT_BOUND_PROGRAM_VERSION = 9 as const;
export const GODOT_4_7_SOURCE_TREE_SHA256 =
  'b25d23ca60d7a9e99c2cccda9a5a1b2e736e6d0f79a8411d6647dafd4693cbec' as const;
export const GODOT_4_7_SOURCE_ARCHIVE_SHA256 =
  'b3d705612228c09083d55a89ed3ea7381e6181387ecfdb74fd5cf9733b28eee6' as const;

export interface GodotBoundProgramIdentity {
  readonly sourceRevision: string;
  readonly sourceTreeSha256: string;
  readonly sourceArchiveSha256: string;
  readonly exporterSourceSha256: string;
  readonly executableSha256: string;
  readonly buildOptions: string;
}

export type GodotBoundVariant =
  | { readonly kind: 'nil' }
  | { readonly kind: 'bool'; readonly value: boolean }
  | { readonly kind: 'int' | 'float' | 'string' | 'string-name'; readonly value: string }
  | { readonly kind: 'array'; readonly value: readonly GodotBoundVariant[] }
  | {
      readonly kind: 'dictionary';
      readonly value: readonly {
        readonly key: GodotBoundVariant;
        readonly value: GodotBoundVariant;
      }[];
    }
  | { readonly kind: 'opaque'; readonly type: string; readonly text: string };

export interface GodotBoundDatatype {
  readonly kind: string;
  readonly typeSource: string;
  readonly constant: boolean;
  readonly readOnly: boolean;
  readonly metaType: boolean;
  readonly pseudoType: boolean;
  readonly coroutine: boolean;
  readonly display: string;
  readonly builtinType: string;
  readonly nativeType: string;
  readonly enumType: string;
  readonly scriptPath: string;
  readonly className: string;
  readonly containerTypes: readonly GodotBoundDatatype[];
  readonly enumValues: readonly { readonly name: string; readonly value: string }[];
}

export interface GodotBoundNodeBase {
  readonly id: number;
  readonly kind: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly datatype: GodotBoundDatatype;
  readonly annotations: readonly number[];
}

export interface GodotBoundAnnotationNode extends GodotBoundNodeBase {
  readonly kind: 'ANNOTATION';
  readonly name: string;
  readonly resolved: boolean;
  readonly applied: boolean;
  readonly arguments: readonly number[];
  readonly resolvedArguments: readonly GodotBoundVariant[];
}

export interface GodotBoundArrayNode extends GodotBoundNodeBase {
  readonly kind: 'ARRAY';
  readonly elements: readonly number[];
}

export interface GodotBoundAssertNode extends GodotBoundNodeBase {
  readonly kind: 'ASSERT';
  readonly condition: number;
  readonly message: number;
}

export interface GodotBoundEmptyStatementNode extends GodotBoundNodeBase {
  readonly kind: 'BREAK' | 'BREAKPOINT' | 'CONTINUE' | 'PASS';
}

export interface GodotBoundForNode extends GodotBoundNodeBase {
  readonly kind: 'FOR';
  readonly variable: number;
  readonly datatypeSpecifier: number;
  readonly useConversionAssign: boolean;
  readonly list: number;
  readonly loop: number;
}

export interface GodotBoundIfNode extends GodotBoundNodeBase {
  readonly kind: 'IF';
  readonly condition: number;
  readonly trueBlock: number;
  readonly falseBlock: number;
}

export interface GodotBoundMatchNode extends GodotBoundNodeBase {
  readonly kind: 'MATCH';
  readonly test: number;
  readonly branches: readonly number[];
}

export interface GodotBoundMatchBranchNode extends GodotBoundNodeBase {
  readonly kind: 'MATCH_BRANCH';
  readonly patterns: readonly number[];
  readonly block: number;
  readonly hasWildcard: boolean;
  readonly guardBody: number;
}

export interface GodotBoundPatternNode extends GodotBoundNodeBase {
  readonly kind: 'PATTERN';
  readonly patternType: string;
  readonly literal: number;
  readonly expression: number;
  readonly bind: number;
  readonly array: readonly number[];
  readonly restUsed: boolean;
  readonly dictionary: readonly { readonly key: number; readonly valuePattern: number }[];
  readonly binds: readonly { readonly name: string; readonly identifier: number }[];
}

export interface GodotBoundWhileNode extends GodotBoundNodeBase {
  readonly kind: 'WHILE';
  readonly condition: number;
  readonly loop: number;
}

export interface GodotBoundAwaitNode extends GodotBoundNodeBase {
  readonly kind: 'AWAIT';
  readonly toAwait: number;
}

export interface GodotBoundCallNode extends GodotBoundNodeBase {
  readonly kind: 'CALL';
  readonly callee: number;
  readonly arguments: readonly number[];
  readonly functionName: string;
  readonly super: boolean;
  readonly static: boolean;
  readonly compilerTarget: GodotBoundCallTarget;
}

export interface GodotBoundCallTarget {
  readonly kind:
    | 'unresolved'
    | 'builtin-constructor'
    | 'variant-utility'
    | 'gdscript-utility'
    | 'super'
    | 'native-method'
    | 'script-self'
    | 'script-class'
    | 'builtin-static'
    | 'native-static'
    | 'dynamic'
    | 'builtin-member';
  readonly owner: string;
  readonly member: string;
  readonly signatureHash: number;
}

export interface GodotBoundCastNode extends GodotBoundNodeBase {
  readonly kind: 'CAST';
  readonly operand: number;
  readonly castType: number;
}

export interface GodotBoundDictionaryNode extends GodotBoundNodeBase {
  readonly kind: 'DICTIONARY';
  readonly elements: readonly { readonly key: number; readonly value: number }[];
  readonly style: string;
}

export interface GodotBoundGetNodeNode extends GodotBoundNodeBase {
  readonly kind: 'GET_NODE';
  readonly fullPath: string;
  readonly useDollar: boolean;
}

export interface GodotBoundLambdaNode extends GodotBoundNodeBase {
  readonly kind: 'LAMBDA';
  readonly function: number;
  readonly captures: readonly number[];
  readonly useSelf: boolean;
}

export interface GodotBoundPreloadNode extends GodotBoundNodeBase {
  readonly kind: 'PRELOAD';
  readonly path: number;
  readonly resolvedPath: string;
}

export interface GodotBoundReturnNode extends GodotBoundNodeBase {
  readonly kind: 'RETURN';
  readonly returnValue: number;
  readonly voidReturn: boolean;
  readonly useConversion: boolean;
}

export interface GodotBoundSelfNode extends GodotBoundNodeBase {
  readonly kind: 'SELF';
}

export interface GodotBoundSubscriptNode extends GodotBoundNodeBase {
  readonly kind: 'SUBSCRIPT';
  readonly base: number;
  readonly index: number;
  readonly attribute: number;
  readonly isAttribute: boolean;
}

export interface GodotBoundTernaryOperatorNode extends GodotBoundNodeBase {
  readonly kind: 'TERNARY_OPERATOR';
  readonly condition: number;
  readonly trueExpression: number;
  readonly falseExpression: number;
}

export interface GodotBoundTypeNode extends GodotBoundNodeBase {
  readonly kind: 'TYPE';
  readonly typeChain: readonly number[];
  readonly containerTypes: readonly number[];
}

export interface GodotBoundTypeTestNode extends GodotBoundNodeBase {
  readonly kind: 'TYPE_TEST';
  readonly operand: number;
  readonly testType: number;
  readonly testDatatype: GodotBoundDatatype;
}

export interface GodotBoundUnaryOperatorNode extends GodotBoundNodeBase {
  readonly kind: 'UNARY_OPERATOR';
  readonly operation: string;
  readonly variantOperator: string;
  readonly variantOperatorId: number;
  readonly operand: number;
}

export interface GodotBoundClassNode extends GodotBoundNodeBase {
  readonly kind: 'CLASS';
  readonly identifier: number;
  readonly fqcn: string;
  readonly abstract: boolean;
  readonly extendsPath: string;
  readonly extends: readonly number[];
  readonly iconPath: string;
  readonly members: readonly number[];
}

export interface GodotBoundAssignmentNode extends GodotBoundNodeBase {
  readonly kind: 'ASSIGNMENT';
  readonly operation: string;
  readonly variantOperator: string;
  readonly variantOperatorId: number;
  readonly assignee: number;
  readonly assignedValue: number;
  readonly useConversionAssign: boolean;
}

export interface GodotBoundBinaryOperatorNode extends GodotBoundNodeBase {
  readonly kind: 'BINARY_OPERATOR';
  readonly operation: string;
  readonly variantOperator: string;
  readonly variantOperatorId: number;
  readonly leftOperand: number;
  readonly rightOperand: number;
}

export interface GodotBoundEnumNode extends GodotBoundNodeBase {
  readonly kind: 'ENUM';
  readonly identifier: number;
  readonly dictionary: GodotBoundVariant;
  readonly values: readonly {
    readonly identifier: number;
    readonly customValue: number;
    readonly index: number;
    readonly resolved: boolean;
    readonly value: string;
    readonly line: number;
    readonly startColumn: number;
    readonly endColumn: number;
  }[];
}

export interface GodotBoundConstantNode extends GodotBoundNodeBase {
  readonly kind: 'CONSTANT';
  readonly identifier: number;
  readonly initializer: number;
  readonly datatypeSpecifier: number;
  readonly inferDatatype: boolean;
}

export interface GodotBoundIdentifierNode extends GodotBoundNodeBase {
  readonly kind: 'IDENTIFIER';
  readonly name: string;
  readonly source: string;
  readonly usages: number;
}

export interface GodotBoundLiteralNode extends GodotBoundNodeBase {
  readonly kind: 'LITERAL';
  readonly value: GodotBoundVariant;
  readonly constant: boolean;
  readonly reduced: boolean;
  readonly reducedValue: GodotBoundVariant;
}

export interface GodotBoundFunctionNode extends GodotBoundNodeBase {
  readonly kind: 'FUNCTION';
  readonly identifier: number;
  readonly parameters: readonly number[];
  readonly restParameter: number;
  readonly returnType: number;
  readonly body: number;
  readonly abstract: boolean;
  readonly static: boolean;
  readonly coroutine: boolean;
}

export interface GodotBoundParameterNode extends GodotBoundNodeBase {
  readonly kind: 'PARAMETER';
  readonly identifier: number;
  readonly initializer: number;
  readonly datatypeSpecifier: number;
  readonly inferDatatype: boolean;
}

export interface GodotBoundSuiteNode extends GodotBoundNodeBase {
  readonly kind: 'SUITE';
  readonly statements: readonly number[];
}

export interface GodotBoundSignalNode extends GodotBoundNodeBase {
  readonly kind: 'SIGNAL';
  readonly identifier: number;
  readonly parameters: readonly number[];
}

export interface GodotBoundVariableNode extends GodotBoundNodeBase {
  readonly kind: 'VARIABLE';
  readonly identifier: number;
  readonly initializer: number;
  readonly datatypeSpecifier: number;
  readonly inferDatatype: boolean;
  readonly static: boolean;
  readonly exported: boolean;
  readonly onready: boolean;
  readonly propertyStyle: string;
  readonly setter: number;
  readonly setterParameter: number;
  readonly getter: number;
}

export type GodotBoundNode =
  | GodotBoundAnnotationNode
  | GodotBoundArrayNode
  | GodotBoundAssertNode
  | GodotBoundAssignmentNode
  | GodotBoundAwaitNode
  | GodotBoundBinaryOperatorNode
  | GodotBoundCallNode
  | GodotBoundCastNode
  | GodotBoundClassNode
  | GodotBoundConstantNode
  | GodotBoundEmptyStatementNode
  | GodotBoundDictionaryNode
  | GodotBoundEnumNode
  | GodotBoundForNode
  | GodotBoundFunctionNode
  | GodotBoundGetNodeNode
  | GodotBoundIdentifierNode
  | GodotBoundIfNode
  | GodotBoundLambdaNode
  | GodotBoundLiteralNode
  | GodotBoundMatchBranchNode
  | GodotBoundMatchNode
  | GodotBoundPatternNode
  | GodotBoundParameterNode
  | GodotBoundPreloadNode
  | GodotBoundReturnNode
  | GodotBoundSelfNode
  | GodotBoundSignalNode
  | GodotBoundSubscriptNode
  | GodotBoundSuiteNode
  | GodotBoundTernaryOperatorNode
  | GodotBoundTypeNode
  | GodotBoundTypeTestNode
  | GodotBoundUnaryOperatorNode
  | GodotBoundVariableNode
  | GodotBoundWhileNode;

export interface GodotBoundScript {
  readonly resPath: string;
  readonly sourceSha256: string;
  readonly tokens: readonly {
    readonly type: string;
    readonly typeId: number;
    readonly source: string;
    readonly literal: GodotBoundVariant;
    readonly startLine: number;
    readonly startColumn: number;
    readonly endLine: number;
    readonly endColumn: number;
  }[];
  readonly parse: GodotFrontendPhase;
  readonly analysis: GodotFrontendPhase;
  readonly compile: GodotCompilerPhase;
  readonly rootNodeId: number;
  readonly nodes: readonly GodotBoundNode[];
  readonly tool: boolean;
}

export interface GodotFrontendPhase {
  readonly ok: boolean;
  readonly errorCode: number;
  readonly diagnostics: readonly GodotFrontendDiagnostic[];
}

export interface GodotFrontendDiagnostic {
  readonly message: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export interface GodotCompilerPhase {
  readonly ok: boolean;
  readonly errorCode: number;
  readonly message: string;
  readonly line: number;
  readonly column: number;
  readonly functions: readonly {
    readonly name: string;
    readonly source: string;
    readonly static: boolean;
    readonly vararg: boolean;
    readonly argumentCount: number;
    readonly maxStackSize: number;
  }[];
}

export interface GodotBoundProgram {
  readonly protocol: typeof GODOT_BOUND_PROGRAM_PROTOCOL;
  readonly protocolVersion: typeof GODOT_BOUND_PROGRAM_VERSION;
  readonly authority: GodotBoundProgramIdentity;
  readonly engine: {
    readonly major: 4;
    readonly minor: number;
    readonly patch: number;
    readonly status: string;
    readonly build: string;
    readonly reportedRevision: string;
    readonly string: string;
  };
  readonly scripts: readonly GodotBoundScript[];
}

type ObjectValue = Record<string, unknown>;

function object(value: unknown, at: string): ObjectValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${at} must be an object`);
  }
  return value as ObjectValue;
}

function exactKeys(value: ObjectValue, keys: readonly string[], at: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${at} keys are ${actual.join(', ')}, expected ${expected.join(', ')}`);
  }
}

function string(value: unknown, at: string): string {
  if (typeof value !== 'string') throw new Error(`${at} must be a string`);
  return value;
}

function boolean(value: unknown, at: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${at} must be a boolean`);
  return value;
}

function integer(value: unknown, at: string): number {
  if (!Number.isInteger(value)) throw new Error(`${at} must be an integer`);
  return value as number;
}

function array(value: unknown, at: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${at} must be an array`);
  return value;
}

function sha256(value: unknown, at: string): string {
  const result = string(value, at);
  if (!/^[0-9a-f]{64}$/.test(result)) throw new Error(`${at} must be a lowercase SHA-256`);
  return result;
}

const CALL_TARGET_KINDS = new Set<GodotBoundCallTarget['kind']>([
  'unresolved',
  'builtin-constructor',
  'variant-utility',
  'gdscript-utility',
  'super',
  'native-method',
  'script-self',
  'script-class',
  'builtin-static',
  'native-static',
  'dynamic',
  'builtin-member',
]);

function callTarget(value: unknown, at: string): GodotBoundCallTarget {
  const row = object(value, at);
  exactKeys(row, ['kind', 'owner', 'member', 'signatureHash'], at);
  const kind = string(row['kind'], `${at}.kind`);
  if (!CALL_TARGET_KINDS.has(kind as GodotBoundCallTarget['kind'])) {
    throw new Error(`${at}.kind is unsupported: ${kind}`);
  }
  const signatureHash = integer(row['signatureHash'], `${at}.signatureHash`);
  if (signatureHash < 0 || signatureHash > 0xffff_ffff) {
    throw new Error(`${at}.signatureHash is outside uint32 range`);
  }
  return {
    kind: kind as GodotBoundCallTarget['kind'],
    owner: string(row['owner'], `${at}.owner`),
    member: string(row['member'], `${at}.member`),
    signatureHash,
  };
}

function boundVariant(value: unknown, at: string): GodotBoundVariant {
  const row = object(value, at);
  const kind = string(row['kind'], `${at}.kind`);
  if (kind === 'nil') {
    exactKeys(row, ['kind'], at);
    return { kind };
  }
  if (kind === 'bool') {
    exactKeys(row, ['kind', 'value'], at);
    return { kind, value: boolean(row['value'], `${at}.value`) };
  }
  if (kind === 'int' || kind === 'float' || kind === 'string' || kind === 'string-name') {
    exactKeys(row, ['kind', 'value'], at);
    return { kind, value: string(row['value'], `${at}.value`) };
  }
  if (kind === 'array') {
    exactKeys(row, ['kind', 'value'], at);
    return {
      kind,
      value: array(row['value'], `${at}.value`).map((entry, index) =>
        boundVariant(entry, `${at}.value[${index}]`),
      ),
    };
  }
  if (kind === 'dictionary') {
    exactKeys(row, ['kind', 'value'], at);
    return {
      kind,
      value: array(row['value'], `${at}.value`).map((entry, index) => {
        const pair = object(entry, `${at}.value[${index}]`);
        exactKeys(pair, ['key', 'value'], `${at}.value[${index}]`);
        return {
          key: boundVariant(pair['key'], `${at}.value[${index}].key`),
          value: boundVariant(pair['value'], `${at}.value[${index}].value`),
        };
      }),
    };
  }
  if (kind === 'opaque') {
    exactKeys(row, ['kind', 'type', 'text'], at);
    return {
      kind,
      type: string(row['type'], `${at}.type`),
      text: string(row['text'], `${at}.text`),
    };
  }
  throw new Error(`${at}.kind is unsupported: ${kind}`);
}

function datatype(value: unknown, at: string): GodotBoundDatatype {
  const row = object(value, at);
  exactKeys(
    row,
    [
      'kind',
      'typeSource',
      'constant',
      'readOnly',
      'metaType',
      'pseudoType',
      'coroutine',
      'display',
      'builtinType',
      'nativeType',
      'enumType',
      'scriptPath',
      'className',
      'containerTypes',
      'enumValues',
    ],
    at,
  );
  return {
    kind: string(row['kind'], `${at}.kind`),
    typeSource: string(row['typeSource'], `${at}.typeSource`),
    constant: boolean(row['constant'], `${at}.constant`),
    readOnly: boolean(row['readOnly'], `${at}.readOnly`),
    metaType: boolean(row['metaType'], `${at}.metaType`),
    pseudoType: boolean(row['pseudoType'], `${at}.pseudoType`),
    coroutine: boolean(row['coroutine'], `${at}.coroutine`),
    display: string(row['display'], `${at}.display`),
    builtinType: string(row['builtinType'], `${at}.builtinType`),
    nativeType: string(row['nativeType'], `${at}.nativeType`),
    enumType: string(row['enumType'], `${at}.enumType`),
    scriptPath: string(row['scriptPath'], `${at}.scriptPath`),
    className: string(row['className'], `${at}.className`),
    containerTypes: array(row['containerTypes'], `${at}.containerTypes`).map((entry, index) =>
      datatype(entry, `${at}.containerTypes[${index}]`),
    ),
    enumValues: array(row['enumValues'], `${at}.enumValues`).map((entry, index) => {
      const item = object(entry, `${at}.enumValues[${index}]`);
      exactKeys(item, ['name', 'value'], `${at}.enumValues[${index}]`);
      return {
        name: string(item['name'], `${at}.enumValues[${index}].name`),
        value: string(item['value'], `${at}.enumValues[${index}].value`),
      };
    }),
  };
}

function nodeBase(row: ObjectValue, at: string): GodotBoundNodeBase {
  return {
    id: integer(row['id'], `${at}.id`),
    kind: string(row['kind'], `${at}.kind`),
    startLine: integer(row['startLine'], `${at}.startLine`),
    startColumn: integer(row['startColumn'], `${at}.startColumn`),
    endLine: integer(row['endLine'], `${at}.endLine`),
    endColumn: integer(row['endColumn'], `${at}.endColumn`),
    datatype: datatype(row['datatype'], `${at}.datatype`),
    annotations: array(row['annotations'], `${at}.annotations`).map((id, index) =>
      integer(id, `${at}.annotations[${index}]`),
    ),
  };
}

const BASE_NODE_KEYS = [
  'id',
  'kind',
  'startLine',
  'startColumn',
  'endLine',
  'endColumn',
  'datatype',
  'annotations',
] as const;

// One strict decoder owns the complete tagged union so no partially decoded node can escape.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: exhaustive trust-boundary decoder
function boundNode(value: unknown, at: string): GodotBoundNode {
  const row = object(value, at);
  const base = nodeBase(row, at);
  if (base.kind === 'ARRAY') {
    exactKeys(row, [...BASE_NODE_KEYS, 'elements'], at);
    return {
      ...base,
      kind: 'ARRAY',
      elements: array(row['elements'], `${at}.elements`).map((id, index) =>
        integer(id, `${at}.elements[${index}]`),
      ),
    };
  }
  if (base.kind === 'ASSERT') {
    exactKeys(row, [...BASE_NODE_KEYS, 'condition', 'message'], at);
    return {
      ...base,
      kind: 'ASSERT',
      condition: integer(row['condition'], `${at}.condition`),
      message: integer(row['message'], `${at}.message`),
    };
  }
  if (base.kind === 'CLASS') {
    exactKeys(
      row,
      [
        ...BASE_NODE_KEYS,
        'identifier',
        'fqcn',
        'abstract',
        'extendsPath',
        'extends',
        'iconPath',
        'members',
      ],
      at,
    );
    return {
      ...base,
      kind: 'CLASS',
      identifier: integer(row['identifier'], `${at}.identifier`),
      fqcn: string(row['fqcn'], `${at}.fqcn`),
      abstract: boolean(row['abstract'], `${at}.abstract`),
      extendsPath: string(row['extendsPath'], `${at}.extendsPath`),
      extends: array(row['extends'], `${at}.extends`).map((id, index) =>
        integer(id, `${at}.extends[${index}]`),
      ),
      iconPath: string(row['iconPath'], `${at}.iconPath`),
      members: array(row['members'], `${at}.members`).map((id, index) =>
        integer(id, `${at}.members[${index}]`),
      ),
    };
  }
  if (base.kind === 'CONSTANT') {
    exactKeys(
      row,
      [...BASE_NODE_KEYS, 'identifier', 'initializer', 'datatypeSpecifier', 'inferDatatype'],
      at,
    );
    return {
      ...base,
      kind: 'CONSTANT',
      identifier: integer(row['identifier'], `${at}.identifier`),
      initializer: integer(row['initializer'], `${at}.initializer`),
      datatypeSpecifier: integer(row['datatypeSpecifier'], `${at}.datatypeSpecifier`),
      inferDatatype: boolean(row['inferDatatype'], `${at}.inferDatatype`),
    };
  }
  if (base.kind === 'ASSIGNMENT') {
    exactKeys(
      row,
      [
        ...BASE_NODE_KEYS,
        'operation',
        'variantOperator',
        'variantOperatorId',
        'assignee',
        'assignedValue',
        'useConversionAssign',
      ],
      at,
    );
    return {
      ...base,
      kind: 'ASSIGNMENT',
      operation: string(row['operation'], `${at}.operation`),
      variantOperator: string(row['variantOperator'], `${at}.variantOperator`),
      variantOperatorId: integer(row['variantOperatorId'], `${at}.variantOperatorId`),
      assignee: integer(row['assignee'], `${at}.assignee`),
      assignedValue: integer(row['assignedValue'], `${at}.assignedValue`),
      useConversionAssign: boolean(row['useConversionAssign'], `${at}.useConversionAssign`),
    };
  }
  if (base.kind === 'AWAIT') {
    exactKeys(row, [...BASE_NODE_KEYS, 'toAwait'], at);
    return { ...base, kind: 'AWAIT', toAwait: integer(row['toAwait'], `${at}.toAwait`) };
  }
  if (base.kind === 'BINARY_OPERATOR') {
    exactKeys(
      row,
      [
        ...BASE_NODE_KEYS,
        'operation',
        'variantOperator',
        'variantOperatorId',
        'leftOperand',
        'rightOperand',
      ],
      at,
    );
    return {
      ...base,
      kind: 'BINARY_OPERATOR',
      operation: string(row['operation'], `${at}.operation`),
      variantOperator: string(row['variantOperator'], `${at}.variantOperator`),
      variantOperatorId: integer(row['variantOperatorId'], `${at}.variantOperatorId`),
      leftOperand: integer(row['leftOperand'], `${at}.leftOperand`),
      rightOperand: integer(row['rightOperand'], `${at}.rightOperand`),
    };
  }
  if (base.kind === 'CALL') {
    exactKeys(
      row,
      [
        ...BASE_NODE_KEYS,
        'callee',
        'arguments',
        'functionName',
        'super',
        'static',
        'compilerTarget',
      ],
      at,
    );
    return {
      ...base,
      kind: 'CALL',
      callee: integer(row['callee'], `${at}.callee`),
      arguments: array(row['arguments'], `${at}.arguments`).map((id, index) =>
        integer(id, `${at}.arguments[${index}]`),
      ),
      functionName: string(row['functionName'], `${at}.functionName`),
      super: boolean(row['super'], `${at}.super`),
      static: boolean(row['static'], `${at}.static`),
      compilerTarget: callTarget(row['compilerTarget'], `${at}.compilerTarget`),
    };
  }
  if (base.kind === 'CAST') {
    exactKeys(row, [...BASE_NODE_KEYS, 'operand', 'castType'], at);
    return {
      ...base,
      kind: 'CAST',
      operand: integer(row['operand'], `${at}.operand`),
      castType: integer(row['castType'], `${at}.castType`),
    };
  }
  if (
    base.kind === 'BREAK' ||
    base.kind === 'BREAKPOINT' ||
    base.kind === 'CONTINUE' ||
    base.kind === 'PASS'
  ) {
    exactKeys(row, BASE_NODE_KEYS, at);
    return { ...base, kind: base.kind };
  }
  if (base.kind === 'ANNOTATION') {
    exactKeys(
      row,
      [...BASE_NODE_KEYS, 'name', 'resolved', 'applied', 'arguments', 'resolvedArguments'],
      at,
    );
    return {
      ...base,
      kind: 'ANNOTATION',
      name: string(row['name'], `${at}.name`),
      resolved: boolean(row['resolved'], `${at}.resolved`),
      applied: boolean(row['applied'], `${at}.applied`),
      arguments: array(row['arguments'], `${at}.arguments`).map((id, index) =>
        integer(id, `${at}.arguments[${index}]`),
      ),
      resolvedArguments: array(row['resolvedArguments'], `${at}.resolvedArguments`).map(
        (entry, index) => boundVariant(entry, `${at}.resolvedArguments[${index}]`),
      ),
    };
  }
  if (base.kind === 'ENUM') {
    exactKeys(row, [...BASE_NODE_KEYS, 'identifier', 'dictionary', 'values'], at);
    return {
      ...base,
      kind: 'ENUM',
      identifier: integer(row['identifier'], `${at}.identifier`),
      dictionary: boundVariant(row['dictionary'], `${at}.dictionary`),
      values: array(row['values'], `${at}.values`).map((entry, index) => {
        const item = object(entry, `${at}.values[${index}]`);
        exactKeys(
          item,
          [
            'identifier',
            'customValue',
            'index',
            'resolved',
            'value',
            'line',
            'startColumn',
            'endColumn',
          ],
          `${at}.values[${index}]`,
        );
        return {
          identifier: integer(item['identifier'], `${at}.values[${index}].identifier`),
          customValue: integer(item['customValue'], `${at}.values[${index}].customValue`),
          index: integer(item['index'], `${at}.values[${index}].index`),
          resolved: boolean(item['resolved'], `${at}.values[${index}].resolved`),
          value: string(item['value'], `${at}.values[${index}].value`),
          line: integer(item['line'], `${at}.values[${index}].line`),
          startColumn: integer(item['startColumn'], `${at}.values[${index}].startColumn`),
          endColumn: integer(item['endColumn'], `${at}.values[${index}].endColumn`),
        };
      }),
    };
  }
  if (base.kind === 'DICTIONARY') {
    exactKeys(row, [...BASE_NODE_KEYS, 'elements', 'style'], at);
    return {
      ...base,
      kind: 'DICTIONARY',
      elements: array(row['elements'], `${at}.elements`).map((entry, index) => {
        const pair = object(entry, `${at}.elements[${index}]`);
        exactKeys(pair, ['key', 'value'], `${at}.elements[${index}]`);
        return {
          key: integer(pair['key'], `${at}.elements[${index}].key`),
          value: integer(pair['value'], `${at}.elements[${index}].value`),
        };
      }),
      style: string(row['style'], `${at}.style`),
    };
  }
  if (base.kind === 'FUNCTION') {
    exactKeys(
      row,
      [
        ...BASE_NODE_KEYS,
        'identifier',
        'parameters',
        'restParameter',
        'returnType',
        'body',
        'abstract',
        'static',
        'coroutine',
      ],
      at,
    );
    return {
      ...base,
      kind: 'FUNCTION',
      identifier: integer(row['identifier'], `${at}.identifier`),
      parameters: array(row['parameters'], `${at}.parameters`).map((id, index) =>
        integer(id, `${at}.parameters[${index}]`),
      ),
      restParameter: integer(row['restParameter'], `${at}.restParameter`),
      returnType: integer(row['returnType'], `${at}.returnType`),
      body: integer(row['body'], `${at}.body`),
      abstract: boolean(row['abstract'], `${at}.abstract`),
      static: boolean(row['static'], `${at}.static`),
      coroutine: boolean(row['coroutine'], `${at}.coroutine`),
    };
  }
  if (base.kind === 'PARAMETER') {
    exactKeys(
      row,
      [...BASE_NODE_KEYS, 'identifier', 'initializer', 'datatypeSpecifier', 'inferDatatype'],
      at,
    );
    return {
      ...base,
      kind: 'PARAMETER',
      identifier: integer(row['identifier'], `${at}.identifier`),
      initializer: integer(row['initializer'], `${at}.initializer`),
      datatypeSpecifier: integer(row['datatypeSpecifier'], `${at}.datatypeSpecifier`),
      inferDatatype: boolean(row['inferDatatype'], `${at}.inferDatatype`),
    };
  }
  if (base.kind === 'FOR') {
    exactKeys(
      row,
      [...BASE_NODE_KEYS, 'variable', 'datatypeSpecifier', 'useConversionAssign', 'list', 'loop'],
      at,
    );
    return {
      ...base,
      kind: 'FOR',
      variable: integer(row['variable'], `${at}.variable`),
      datatypeSpecifier: integer(row['datatypeSpecifier'], `${at}.datatypeSpecifier`),
      useConversionAssign: boolean(row['useConversionAssign'], `${at}.useConversionAssign`),
      list: integer(row['list'], `${at}.list`),
      loop: integer(row['loop'], `${at}.loop`),
    };
  }
  if (base.kind === 'GET_NODE') {
    exactKeys(row, [...BASE_NODE_KEYS, 'fullPath', 'useDollar'], at);
    return {
      ...base,
      kind: 'GET_NODE',
      fullPath: string(row['fullPath'], `${at}.fullPath`),
      useDollar: boolean(row['useDollar'], `${at}.useDollar`),
    };
  }
  if (base.kind === 'IDENTIFIER') {
    exactKeys(row, [...BASE_NODE_KEYS, 'name', 'source', 'usages'], at);
    return {
      ...base,
      kind: 'IDENTIFIER',
      name: string(row['name'], `${at}.name`),
      source: string(row['source'], `${at}.source`),
      usages: integer(row['usages'], `${at}.usages`),
    };
  }
  if (base.kind === 'IF') {
    exactKeys(row, [...BASE_NODE_KEYS, 'condition', 'trueBlock', 'falseBlock'], at);
    return {
      ...base,
      kind: 'IF',
      condition: integer(row['condition'], `${at}.condition`),
      trueBlock: integer(row['trueBlock'], `${at}.trueBlock`),
      falseBlock: integer(row['falseBlock'], `${at}.falseBlock`),
    };
  }
  if (base.kind === 'LAMBDA') {
    exactKeys(row, [...BASE_NODE_KEYS, 'function', 'captures', 'useSelf'], at);
    return {
      ...base,
      kind: 'LAMBDA',
      function: integer(row['function'], `${at}.function`),
      captures: array(row['captures'], `${at}.captures`).map((id, index) =>
        integer(id, `${at}.captures[${index}]`),
      ),
      useSelf: boolean(row['useSelf'], `${at}.useSelf`),
    };
  }
  if (base.kind === 'LITERAL') {
    exactKeys(row, [...BASE_NODE_KEYS, 'value', 'constant', 'reduced', 'reducedValue'], at);
    return {
      ...base,
      kind: 'LITERAL',
      value: boundVariant(row['value'], `${at}.value`),
      constant: boolean(row['constant'], `${at}.constant`),
      reduced: boolean(row['reduced'], `${at}.reduced`),
      reducedValue: boundVariant(row['reducedValue'], `${at}.reducedValue`),
    };
  }
  if (base.kind === 'MATCH') {
    exactKeys(row, [...BASE_NODE_KEYS, 'test', 'branches'], at);
    return {
      ...base,
      kind: 'MATCH',
      test: integer(row['test'], `${at}.test`),
      branches: array(row['branches'], `${at}.branches`).map((id, index) =>
        integer(id, `${at}.branches[${index}]`),
      ),
    };
  }
  if (base.kind === 'MATCH_BRANCH') {
    exactKeys(row, [...BASE_NODE_KEYS, 'patterns', 'block', 'hasWildcard', 'guardBody'], at);
    return {
      ...base,
      kind: 'MATCH_BRANCH',
      patterns: array(row['patterns'], `${at}.patterns`).map((id, index) =>
        integer(id, `${at}.patterns[${index}]`),
      ),
      block: integer(row['block'], `${at}.block`),
      hasWildcard: boolean(row['hasWildcard'], `${at}.hasWildcard`),
      guardBody: integer(row['guardBody'], `${at}.guardBody`),
    };
  }
  if (base.kind === 'PATTERN') {
    exactKeys(
      row,
      [
        ...BASE_NODE_KEYS,
        'patternType',
        'literal',
        'expression',
        'bind',
        'array',
        'restUsed',
        'dictionary',
        'binds',
      ],
      at,
    );
    return {
      ...base,
      kind: 'PATTERN',
      patternType: string(row['patternType'], `${at}.patternType`),
      literal: integer(row['literal'], `${at}.literal`),
      expression: integer(row['expression'], `${at}.expression`),
      bind: integer(row['bind'], `${at}.bind`),
      array: array(row['array'], `${at}.array`).map((id, index) =>
        integer(id, `${at}.array[${index}]`),
      ),
      restUsed: boolean(row['restUsed'], `${at}.restUsed`),
      dictionary: array(row['dictionary'], `${at}.dictionary`).map((entry, index) => {
        const pair = object(entry, `${at}.dictionary[${index}]`);
        exactKeys(pair, ['key', 'valuePattern'], `${at}.dictionary[${index}]`);
        return {
          key: integer(pair['key'], `${at}.dictionary[${index}].key`),
          valuePattern: integer(pair['valuePattern'], `${at}.dictionary[${index}].valuePattern`),
        };
      }),
      binds: array(row['binds'], `${at}.binds`).map((entry, index) => {
        const bind = object(entry, `${at}.binds[${index}]`);
        exactKeys(bind, ['name', 'identifier'], `${at}.binds[${index}]`);
        return {
          name: string(bind['name'], `${at}.binds[${index}].name`),
          identifier: integer(bind['identifier'], `${at}.binds[${index}].identifier`),
        };
      }),
    };
  }
  if (base.kind === 'PRELOAD') {
    exactKeys(row, [...BASE_NODE_KEYS, 'path', 'resolvedPath'], at);
    return {
      ...base,
      kind: 'PRELOAD',
      path: integer(row['path'], `${at}.path`),
      resolvedPath: string(row['resolvedPath'], `${at}.resolvedPath`),
    };
  }
  if (base.kind === 'RETURN') {
    exactKeys(row, [...BASE_NODE_KEYS, 'returnValue', 'voidReturn', 'useConversion'], at);
    return {
      ...base,
      kind: 'RETURN',
      returnValue: integer(row['returnValue'], `${at}.returnValue`),
      voidReturn: boolean(row['voidReturn'], `${at}.voidReturn`),
      useConversion: boolean(row['useConversion'], `${at}.useConversion`),
    };
  }
  if (base.kind === 'SELF') {
    exactKeys(row, BASE_NODE_KEYS, at);
    return { ...base, kind: 'SELF' };
  }
  if (base.kind === 'SUBSCRIPT') {
    exactKeys(row, [...BASE_NODE_KEYS, 'base', 'index', 'attribute', 'isAttribute'], at);
    return {
      ...base,
      kind: 'SUBSCRIPT',
      base: integer(row['base'], `${at}.base`),
      index: integer(row['index'], `${at}.index`),
      attribute: integer(row['attribute'], `${at}.attribute`),
      isAttribute: boolean(row['isAttribute'], `${at}.isAttribute`),
    };
  }
  if (base.kind === 'SIGNAL') {
    exactKeys(row, [...BASE_NODE_KEYS, 'identifier', 'parameters'], at);
    return {
      ...base,
      kind: 'SIGNAL',
      identifier: integer(row['identifier'], `${at}.identifier`),
      parameters: array(row['parameters'], `${at}.parameters`).map((id, index) =>
        integer(id, `${at}.parameters[${index}]`),
      ),
    };
  }
  if (base.kind === 'SUITE') {
    exactKeys(row, [...BASE_NODE_KEYS, 'statements'], at);
    return {
      ...base,
      kind: 'SUITE',
      statements: array(row['statements'], `${at}.statements`).map((id, index) =>
        integer(id, `${at}.statements[${index}]`),
      ),
    };
  }
  if (base.kind === 'TERNARY_OPERATOR') {
    exactKeys(row, [...BASE_NODE_KEYS, 'condition', 'trueExpression', 'falseExpression'], at);
    return {
      ...base,
      kind: 'TERNARY_OPERATOR',
      condition: integer(row['condition'], `${at}.condition`),
      trueExpression: integer(row['trueExpression'], `${at}.trueExpression`),
      falseExpression: integer(row['falseExpression'], `${at}.falseExpression`),
    };
  }
  if (base.kind === 'TYPE') {
    exactKeys(row, [...BASE_NODE_KEYS, 'typeChain', 'containerTypes'], at);
    return {
      ...base,
      kind: 'TYPE',
      typeChain: array(row['typeChain'], `${at}.typeChain`).map((id, index) =>
        integer(id, `${at}.typeChain[${index}]`),
      ),
      containerTypes: array(row['containerTypes'], `${at}.containerTypes`).map((id, index) =>
        integer(id, `${at}.containerTypes[${index}]`),
      ),
    };
  }
  if (base.kind === 'TYPE_TEST') {
    exactKeys(row, [...BASE_NODE_KEYS, 'operand', 'testType', 'testDatatype'], at);
    return {
      ...base,
      kind: 'TYPE_TEST',
      operand: integer(row['operand'], `${at}.operand`),
      testType: integer(row['testType'], `${at}.testType`),
      testDatatype: datatype(row['testDatatype'], `${at}.testDatatype`),
    };
  }
  if (base.kind === 'UNARY_OPERATOR') {
    exactKeys(
      row,
      [...BASE_NODE_KEYS, 'operation', 'variantOperator', 'variantOperatorId', 'operand'],
      at,
    );
    return {
      ...base,
      kind: 'UNARY_OPERATOR',
      operation: string(row['operation'], `${at}.operation`),
      variantOperator: string(row['variantOperator'], `${at}.variantOperator`),
      variantOperatorId: integer(row['variantOperatorId'], `${at}.variantOperatorId`),
      operand: integer(row['operand'], `${at}.operand`),
    };
  }
  if (base.kind === 'VARIABLE') {
    exactKeys(
      row,
      [
        ...BASE_NODE_KEYS,
        'identifier',
        'initializer',
        'datatypeSpecifier',
        'inferDatatype',
        'static',
        'exported',
        'onready',
        'propertyStyle',
        'setter',
        'setterParameter',
        'getter',
      ],
      at,
    );
    return {
      ...base,
      kind: 'VARIABLE',
      identifier: integer(row['identifier'], `${at}.identifier`),
      initializer: integer(row['initializer'], `${at}.initializer`),
      datatypeSpecifier: integer(row['datatypeSpecifier'], `${at}.datatypeSpecifier`),
      inferDatatype: boolean(row['inferDatatype'], `${at}.inferDatatype`),
      static: boolean(row['static'], `${at}.static`),
      exported: boolean(row['exported'], `${at}.exported`),
      onready: boolean(row['onready'], `${at}.onready`),
      propertyStyle: string(row['propertyStyle'], `${at}.propertyStyle`),
      setter: integer(row['setter'], `${at}.setter`),
      setterParameter: integer(row['setterParameter'], `${at}.setterParameter`),
      getter: integer(row['getter'], `${at}.getter`),
    };
  }
  if (base.kind === 'WHILE') {
    exactKeys(row, [...BASE_NODE_KEYS, 'condition', 'loop'], at);
    return {
      ...base,
      kind: 'WHILE',
      condition: integer(row['condition'], `${at}.condition`),
      loop: integer(row['loop'], `${at}.loop`),
    };
  }
  throw new Error(`${at}.kind is not implemented by the bound-program protocol: ${base.kind}`);
}

function diagnostic(value: unknown, at: string): GodotFrontendDiagnostic {
  const row = object(value, at);
  exactKeys(row, ['message', 'startLine', 'startColumn', 'endLine', 'endColumn'], at);
  return {
    message: string(row['message'], `${at}.message`),
    startLine: integer(row['startLine'], `${at}.startLine`),
    startColumn: integer(row['startColumn'], `${at}.startColumn`),
    endLine: integer(row['endLine'], `${at}.endLine`),
    endColumn: integer(row['endColumn'], `${at}.endColumn`),
  };
}

function frontendPhase(value: unknown, at: string): GodotFrontendPhase {
  const row = object(value, at);
  exactKeys(row, ['ok', 'errorCode', 'diagnostics'], at);
  return {
    ok: boolean(row['ok'], `${at}.ok`),
    errorCode: integer(row['errorCode'], `${at}.errorCode`),
    diagnostics: array(row['diagnostics'], `${at}.diagnostics`).map((entry, index) =>
      diagnostic(entry, `${at}.diagnostics[${index}]`),
    ),
  };
}

function compilerPhase(value: unknown, at: string): GodotCompilerPhase {
  const row = object(value, at);
  exactKeys(row, ['ok', 'errorCode', 'message', 'line', 'column', 'functions'], at);
  return {
    ok: boolean(row['ok'], `${at}.ok`),
    errorCode: integer(row['errorCode'], `${at}.errorCode`),
    message: string(row['message'], `${at}.message`),
    line: integer(row['line'], `${at}.line`),
    column: integer(row['column'], `${at}.column`),
    functions: array(row['functions'], `${at}.functions`).map((entry, index) => {
      const item = object(entry, `${at}.functions[${index}]`);
      exactKeys(
        item,
        ['name', 'source', 'static', 'vararg', 'argumentCount', 'maxStackSize'],
        `${at}.functions[${index}]`,
      );
      return {
        name: string(item['name'], `${at}.functions[${index}].name`),
        source: string(item['source'], `${at}.functions[${index}].source`),
        static: boolean(item['static'], `${at}.functions[${index}].static`),
        vararg: boolean(item['vararg'], `${at}.functions[${index}].vararg`),
        argumentCount: integer(item['argumentCount'], `${at}.functions[${index}].argumentCount`),
        maxStackSize: integer(item['maxStackSize'], `${at}.functions[${index}].maxStackSize`),
      };
    }),
  };
}

function assertFrontendPhaseAccepted(
  resPath: string,
  name: 'parse' | 'analysis',
  phase: GodotFrontendPhase,
): void {
  if (phase.ok) return;
  const detail = phase.diagnostics
    .map((entry) => `${entry.startLine}:${entry.startColumn} ${entry.message}`)
    .join('; ');
  throw new Error(
    `${resPath}: official ${name} phase failed (${phase.errorCode})${detail === '' ? '' : `: ${detail}`}`,
  );
}

function boundScript(value: unknown, at: string): GodotBoundScript {
  const row = object(value, at);
  exactKeys(
    row,
    [
      'resPath',
      'sourceSha256',
      'tokens',
      'parse',
      'analysis',
      'compile',
      'rootNodeId',
      'nodes',
      'tool',
    ],
    at,
  );
  const resPath = string(row['resPath'], `${at}.resPath`);
  if (!resPath.startsWith('res://') || !resPath.endsWith('.gd')) {
    throw new Error(`${at}.resPath is invalid: ${resPath}`);
  }
  const nodes = array(row['nodes'], `${at}.nodes`).map((entry, index) =>
    boundNode(entry, `${at}.nodes[${index}]`),
  );
  for (const [index, node] of nodes.entries()) {
    if (node.id !== index) throw new Error(`${at}.nodes[${index}].id is ${node.id}`);
  }
  const parse = frontendPhase(row['parse'], `${at}.parse`);
  const analysis = frontendPhase(row['analysis'], `${at}.analysis`);
  const compile = compilerPhase(row['compile'], `${at}.compile`);
  assertFrontendPhaseAccepted(resPath, 'parse', parse);
  assertFrontendPhaseAccepted(resPath, 'analysis', analysis);
  if (!compile.ok) {
    throw new Error(
      `${resPath}:${compile.line}:${compile.column}: official compile phase failed ` +
        `(${compile.errorCode}): ${compile.message}`,
    );
  }
  for (const node of nodes) {
    if (node.kind === 'CALL' && node.compilerTarget.kind === 'unresolved') {
      throw new Error(
        `${at}.nodes[${String(node.id)}].compilerTarget was not selected by the official compiler`,
      );
    }
  }
  return {
    resPath,
    sourceSha256: sha256(row['sourceSha256'], `${at}.sourceSha256`),
    tokens: array(row['tokens'], `${at}.tokens`).map((entry, index) => {
      const token = object(entry, `${at}.tokens[${index}]`);
      exactKeys(
        token,
        ['type', 'typeId', 'source', 'literal', 'startLine', 'startColumn', 'endLine', 'endColumn'],
        `${at}.tokens[${index}]`,
      );
      return {
        type: string(token['type'], `${at}.tokens[${index}].type`),
        typeId: integer(token['typeId'], `${at}.tokens[${index}].typeId`),
        source: string(token['source'], `${at}.tokens[${index}].source`),
        literal: boundVariant(token['literal'], `${at}.tokens[${index}].literal`),
        startLine: integer(token['startLine'], `${at}.tokens[${index}].startLine`),
        startColumn: integer(token['startColumn'], `${at}.tokens[${index}].startColumn`),
        endLine: integer(token['endLine'], `${at}.tokens[${index}].endLine`),
        endColumn: integer(token['endColumn'], `${at}.tokens[${index}].endColumn`),
      };
    }),
    parse,
    analysis,
    compile,
    rootNodeId: integer(row['rootNodeId'], `${at}.rootNodeId`),
    nodes,
    tool: boolean(row['tool'], `${at}.tool`),
  };
}

export function decodeGodotBoundProgram(
  value: unknown,
  expected: {
    readonly exporterSourceSha256: string;
    readonly executableSha256: string;
  },
): GodotBoundProgram {
  const root = object(value, 'Godot bound program');
  exactKeys(
    root,
    ['protocol', 'protocolVersion', 'authority', 'engine', 'scripts'],
    'Godot bound program',
  );
  if (root['protocol'] !== GODOT_BOUND_PROGRAM_PROTOCOL) {
    throw new Error(`Godot bound program protocol is ${String(root['protocol'])}`);
  }
  if (root['protocolVersion'] !== GODOT_BOUND_PROGRAM_VERSION) {
    throw new Error(`Godot bound program version is ${String(root['protocolVersion'])}`);
  }
  const authority = object(root['authority'], 'Godot bound program.authority');
  exactKeys(
    authority,
    [
      'sourceRevision',
      'sourceTreeSha256',
      'sourceArchiveSha256',
      'exporterSourceSha256',
      'executableSha256',
      'buildOptions',
    ],
    'Godot bound program.authority',
  );
  const identity: GodotBoundProgramIdentity = {
    sourceRevision: string(authority['sourceRevision'], 'authority.sourceRevision'),
    sourceTreeSha256: sha256(authority['sourceTreeSha256'], 'authority.sourceTreeSha256'),
    sourceArchiveSha256: sha256(authority['sourceArchiveSha256'], 'authority.sourceArchiveSha256'),
    exporterSourceSha256: sha256(
      authority['exporterSourceSha256'],
      'authority.exporterSourceSha256',
    ),
    executableSha256: sha256(authority['executableSha256'], 'authority.executableSha256'),
    buildOptions: string(authority['buildOptions'], 'authority.buildOptions'),
  };
  const source = godotSourceAuthority(4);
  const mismatches: string[] = [];
  if (identity.sourceRevision !== source.revision) mismatches.push('source revision');
  if (identity.sourceTreeSha256 !== GODOT_4_7_SOURCE_TREE_SHA256) mismatches.push('source tree');
  if (identity.sourceArchiveSha256 !== GODOT_4_7_SOURCE_ARCHIVE_SHA256)
    mismatches.push('source archive');
  if (identity.exporterSourceSha256 !== expected.exporterSourceSha256)
    mismatches.push('exporter source');
  if (identity.executableSha256 !== expected.executableSha256) mismatches.push('executable');
  if (mismatches.length > 0) {
    throw new Error(`Godot bound program authority mismatch: ${mismatches.join(', ')}`);
  }
  const engine = object(root['engine'], 'Godot bound program.engine');
  exactKeys(
    engine,
    ['major', 'minor', 'patch', 'status', 'build', 'reportedRevision', 'string'],
    'Godot bound program.engine',
  );
  if (engine['major'] !== 4)
    throw new Error(`Godot bound program engine major is ${String(engine['major'])}`);
  return {
    protocol: GODOT_BOUND_PROGRAM_PROTOCOL,
    protocolVersion: GODOT_BOUND_PROGRAM_VERSION,
    authority: identity,
    engine: {
      major: 4,
      minor: integer(engine['minor'], 'engine.minor'),
      patch: integer(engine['patch'], 'engine.patch'),
      status: string(engine['status'], 'engine.status'),
      build: string(engine['build'], 'engine.build'),
      reportedRevision: string(engine['reportedRevision'], 'engine.reportedRevision'),
      string: string(engine['string'], 'engine.string'),
    },
    scripts: array(root['scripts'], 'Godot bound program.scripts').map((entry, index) =>
      boundScript(entry, `Godot bound program.scripts[${index}]`),
    ),
  };
}
