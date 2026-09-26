/**
 * Versioned, data-only TypeScript/TSX syntax produced by Godot code lowering.
 *
 * This is deliberately not TypeScript's compiler object graph. Lowering owns names, evaluation
 * order, bindings and requirements; the emitter owns only the exhaustive one-to-one conversion
 * from these immutable values to TypeScript factory nodes. There is no raw-source or custom node.
 */
export const TARGET_TS_SYNTAX_VERSION = 4 as const;

export interface TargetTsSpan {
  readonly sourcePath: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export interface TargetTsSourceFile {
  readonly syntaxVersion: typeof TARGET_TS_SYNTAX_VERSION;
  readonly sourcePath: string;
  readonly statements: readonly TargetTsStatement[];
}

export type TargetTsModifier = 'export' | 'default' | 'async' | 'static' | 'readonly' | 'private';

export type TargetTsType =
  | {
      readonly kind: 'keyword-type';
      readonly keyword:
        | 'any'
        | 'boolean'
        | 'never'
        | 'number'
        | 'object'
        | 'string'
        | 'unknown'
        | 'void';
    }
  | {
      readonly kind: 'type-reference';
      readonly name: string;
      readonly arguments: readonly TargetTsType[];
    }
  | { readonly kind: 'array-type'; readonly element: TargetTsType }
  | {
      readonly kind: 'indexed-access-type';
      readonly object: TargetTsType;
      readonly index: TargetTsType;
    }
  | { readonly kind: 'tuple-type'; readonly elements: readonly TargetTsType[] }
  | { readonly kind: 'union-type'; readonly members: readonly TargetTsType[] }
  | { readonly kind: 'intersection-type'; readonly members: readonly TargetTsType[] }
  | {
      readonly kind: 'object-type';
      readonly properties: readonly {
        readonly name: string;
        readonly type: TargetTsType;
        readonly readonly?: true;
        readonly optional?: true;
      }[];
    }
  | { readonly kind: 'literal-type'; readonly value: string | number | boolean | null }
  | {
      readonly kind: 'function-type';
      readonly parameters: readonly TargetTsParameter[];
      readonly result: TargetTsType;
    };

export interface TargetTsParameter {
  readonly name: string;
  readonly type?: TargetTsType;
  readonly initializer?: TargetTsExpression;
  readonly rest?: true;
}

export interface TargetTsObjectProperty {
  readonly key: string | number;
  readonly value: TargetTsExpression;
}

export interface TargetTsImportBinding {
  readonly imported: string;
  readonly local: string;
}

export interface TargetTsClassMemberBase {
  readonly modifiers?: readonly TargetTsModifier[];
  readonly span?: TargetTsSpan;
}

export type TargetTsClassMember =
  | (TargetTsClassMemberBase & {
      readonly kind: 'field-member';
      readonly name: string;
      readonly type?: TargetTsType;
      readonly initializer?: TargetTsExpression;
      readonly definite?: true;
    })
  | (TargetTsClassMemberBase & {
      readonly kind: 'method-member';
      readonly name: string;
      readonly parameters: readonly TargetTsParameter[];
      readonly result?: TargetTsType;
      readonly body: readonly TargetTsStatement[];
    })
  | (TargetTsClassMemberBase & {
      readonly kind: 'constructor-member';
      readonly parameters: readonly TargetTsParameter[];
      readonly body: readonly TargetTsStatement[];
    })
  | (TargetTsClassMemberBase & {
      readonly kind: 'getter-member';
      readonly name: string;
      readonly result?: TargetTsType;
      readonly body: readonly TargetTsStatement[];
    })
  | (TargetTsClassMemberBase & {
      readonly kind: 'setter-member';
      readonly name: string;
      readonly parameter: TargetTsParameter;
      readonly body: readonly TargetTsStatement[];
    });

export interface TargetTsStatementBase {
  readonly span?: TargetTsSpan;
}

export type TargetTsStatement =
  | (TargetTsStatementBase & {
      readonly kind: 'import-statement';
      readonly module: string;
      readonly defaultBinding?: string;
      readonly namespaceBinding?: string;
      readonly namedBindings: readonly TargetTsImportBinding[];
      readonly typeOnly?: true;
    })
  | (TargetTsStatementBase & {
      readonly kind: 'variable-statement';
      readonly declaration: 'const' | 'let';
      readonly name: string;
      readonly type?: TargetTsType;
      readonly initializer?: TargetTsExpression;
      readonly modifiers?: readonly TargetTsModifier[];
    })
  | (TargetTsStatementBase & {
      readonly kind: 'function-statement';
      readonly name: string;
      readonly parameters: readonly TargetTsParameter[];
      readonly result?: TargetTsType;
      readonly body: readonly TargetTsStatement[];
      readonly modifiers?: readonly TargetTsModifier[];
    })
  | (TargetTsStatementBase & {
      readonly kind: 'class-statement';
      readonly name: string;
      readonly extends?: TargetTsExpression;
      readonly members: readonly TargetTsClassMember[];
      readonly modifiers?: readonly TargetTsModifier[];
    })
  | (TargetTsStatementBase & {
      readonly kind: 'expression-statement';
      readonly expression: TargetTsExpression;
    })
  | (TargetTsStatementBase & {
      readonly kind: 'export-default-statement';
      readonly expression: TargetTsExpression;
    })
  | (TargetTsStatementBase & {
      readonly kind: 'return-statement';
      readonly expression?: TargetTsExpression;
    })
  | (TargetTsStatementBase & {
      readonly kind: 'throw-statement';
      readonly expression: TargetTsExpression;
    })
  | (TargetTsStatementBase & {
      readonly kind: 'if-statement';
      readonly condition: TargetTsExpression;
      readonly then: readonly TargetTsStatement[];
      readonly else?: readonly TargetTsStatement[];
    })
  | (TargetTsStatementBase & {
      readonly kind: 'while-statement';
      readonly condition: TargetTsExpression;
      readonly body: readonly TargetTsStatement[];
    })
  | (TargetTsStatementBase & {
      readonly kind: 'for-of-statement';
      readonly binding: string;
      readonly iterable: TargetTsExpression;
      readonly body: readonly TargetTsStatement[];
    })
  | (TargetTsStatementBase & {
      readonly kind: 'block-statement';
      readonly body: readonly TargetTsStatement[];
    })
  | (TargetTsStatementBase & { readonly kind: 'break-statement' })
  | (TargetTsStatementBase & { readonly kind: 'continue-statement' })
  | (TargetTsStatementBase & { readonly kind: 'empty-statement' });

export type TargetTsUnaryOperator = '!' | '+' | '-' | '~' | 'typeof' | 'void';
export type TargetTsBinaryOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '**'
  | '&&'
  | '||'
  | '??'
  | '==='
  | '!=='
  | '<'
  | '<='
  | '>'
  | '>='
  | '&'
  | '|'
  | '^'
  | '<<'
  | '>>'
  | '>>>'
  | 'in'
  | 'instanceof';
export type TargetTsAssignmentOperator =
  | '='
  | '+='
  | '-='
  | '*='
  | '/='
  | '%='
  | '**='
  | '&&='
  | '||='
  | '??='
  | '&='
  | '|='
  | '^='
  | '<<='
  | '>>='
  | '>>>=';

export interface TargetTsExpressionBase {
  readonly span?: TargetTsSpan;
}

export interface TargetTsJsxElementShape {
  readonly tag: string;
  readonly attributes: readonly TargetTsJsxAttribute[];
  readonly children: readonly TargetTsJsxChild[];
}

export type TargetTsExpression =
  | (TargetTsExpressionBase & { readonly kind: 'identifier-expression'; readonly name: string })
  | (TargetTsExpressionBase & { readonly kind: 'this-expression' })
  | (TargetTsExpressionBase & {
      readonly kind: 'literal-expression';
      readonly value: string | number | boolean | null;
    })
  | (TargetTsExpressionBase & { readonly kind: 'undefined-expression' })
  | (TargetTsExpressionBase & {
      readonly kind: 'array-expression';
      readonly elements: readonly TargetTsExpression[];
    })
  | (TargetTsExpressionBase & {
      readonly kind: 'object-expression';
      readonly properties: readonly TargetTsObjectProperty[];
    })
  | (TargetTsExpressionBase & {
      readonly kind: 'property-expression';
      readonly object: TargetTsExpression;
      readonly property: string;
    })
  | (TargetTsExpressionBase & {
      readonly kind: 'element-expression';
      readonly object: TargetTsExpression;
      readonly index: TargetTsExpression;
    })
  | (TargetTsExpressionBase & {
      readonly kind: 'call-expression';
      readonly callee: TargetTsExpression;
      readonly arguments: readonly TargetTsExpression[];
      readonly typeArguments?: readonly TargetTsType[];
    })
  | (TargetTsExpressionBase & {
      readonly kind: 'new-expression';
      readonly callee: TargetTsExpression;
      readonly arguments: readonly TargetTsExpression[];
      readonly typeArguments?: readonly TargetTsType[];
    })
  | (TargetTsExpressionBase & {
      readonly kind: 'unary-expression';
      readonly operator: TargetTsUnaryOperator;
      readonly operand: TargetTsExpression;
    })
  | (TargetTsExpressionBase & {
      readonly kind: 'binary-expression';
      readonly operator: TargetTsBinaryOperator;
      readonly left: TargetTsExpression;
      readonly right: TargetTsExpression;
    })
  | (TargetTsExpressionBase & {
      readonly kind: 'assignment-expression';
      readonly operator: TargetTsAssignmentOperator;
      readonly target: TargetTsExpression;
      readonly value: TargetTsExpression;
    })
  | (TargetTsExpressionBase & {
      readonly kind: 'conditional-expression';
      readonly condition: TargetTsExpression;
      readonly whenTrue: TargetTsExpression;
      readonly whenFalse: TargetTsExpression;
    })
  | (TargetTsExpressionBase & {
      readonly kind: 'await-expression';
      readonly expression: TargetTsExpression;
    })
  | (TargetTsExpressionBase & {
      readonly kind: 'arrow-expression';
      readonly parameters: readonly TargetTsParameter[];
      readonly body: TargetTsExpression | readonly TargetTsStatement[];
      readonly async?: true;
    })
  | (TargetTsExpressionBase & {
      readonly kind: 'parenthesized-expression';
      readonly expression: TargetTsExpression;
    })
  | (TargetTsExpressionBase & {
      readonly kind: 'as-expression';
      readonly expression: TargetTsExpression;
      readonly type: TargetTsType;
    })
  | (TargetTsExpressionBase & TargetTsJsxElementShape & { readonly kind: 'jsx-element-expression' })
  | (TargetTsExpressionBase & {
      readonly kind: 'jsx-fragment-expression';
      readonly children: readonly TargetTsJsxChild[];
    });

export type TargetTsJsxAttribute =
  | { readonly kind: 'jsx-string-attribute'; readonly name: string; readonly value: string }
  | {
      readonly kind: 'jsx-expression-attribute';
      readonly name: string;
      readonly value: TargetTsExpression;
    }
  | { readonly kind: 'jsx-spread-attribute'; readonly value: TargetTsExpression };

export type TargetTsJsxChild =
  | { readonly kind: 'jsx-text-child'; readonly text: string }
  | { readonly kind: 'jsx-expression-child'; readonly value: TargetTsExpression }
  | (TargetTsJsxElementShape & { readonly kind: 'jsx-element-child' });

export interface LoweredTargetTsExpression<Requirement> {
  readonly before: readonly TargetTsStatement[];
  readonly value: TargetTsExpression;
  readonly after: readonly TargetTsStatement[];
  readonly requirements: readonly Requirement[];
}
