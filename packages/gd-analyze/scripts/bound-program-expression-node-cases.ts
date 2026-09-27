export interface BoundExpressionNodeCase {
  readonly row: `ast:${string}`;
  readonly kind: string;
  readonly targetSource: string;
  readonly baseline: string;
  readonly mutant: string;
  readonly extraFiles?: Readonly<Record<string, string>>;
}

export const expressionNodeCases: readonly BoundExpressionNodeCase[] = [
  {
    row: 'ast:ARRAY',
    kind: 'ARRAY',
    targetSource: '[1, 2]',
    baseline: 'var probe = [1, 2]\n',
    mutant: '',
  },
  {
    row: 'ast:ASSIGNMENT',
    kind: 'ASSIGNMENT',
    targetSource: 'probe = 2',
    baseline: 'func run():\n\tvar probe = 1\n\tprobe = 2\n',
    mutant: 'func run():\n\tvar probe = 1\n',
  },
  {
    row: 'ast:AWAIT',
    kind: 'AWAIT',
    targetSource: 'await get_tree().process_frame',
    baseline: 'extends Node\nfunc run():\n\tawait get_tree().process_frame\n\treturn\n',
    mutant: 'extends Node\nfunc run():\n\treturn\n',
  },
  {
    row: 'ast:BINARY_OPERATOR',
    kind: 'BINARY_OPERATOR',
    targetSource: '1 + 2',
    baseline: 'var probe = 1 + 2\n',
    mutant: '',
  },
  {
    row: 'ast:CALL',
    kind: 'CALL',
    targetSource: 'abs(-1)',
    baseline: 'var probe = abs(-1)\n',
    mutant: '',
  },
  {
    row: 'ast:DICTIONARY',
    kind: 'DICTIONARY',
    targetSource: '{"answer": 42}',
    baseline: 'var probe = {"answer": 42}\n',
    mutant: '',
  },
  {
    row: 'ast:GET_NODE',
    kind: 'GET_NODE',
    targetSource: '$Child',
    baseline: 'extends Node\n@onready var probe = $Child\n',
    mutant: 'extends Node\n',
  },
  {
    row: 'ast:IDENTIFIER',
    kind: 'IDENTIFIER',
    targetSource: 'source',
    baseline: 'var source = 1\nvar probe = source\n',
    mutant: 'var source = 1\n',
  },
  {
    row: 'ast:LAMBDA',
    kind: 'LAMBDA',
    targetSource: 'func():\n\treturn 1\n',
    baseline: 'var probe = func():\n\treturn 1\n',
    mutant: '',
  },
  {
    row: 'ast:LITERAL',
    kind: 'LITERAL',
    targetSource: '42',
    baseline: 'var probe = 42\n',
    mutant: '',
  },
  {
    row: 'ast:PRELOAD',
    kind: 'PRELOAD',
    targetSource: 'preload("res://target.gd")',
    baseline: 'var probe = preload("res://target.gd")\n',
    mutant: '',
    extraFiles: { 'target.gd': 'extends RefCounted\n' },
  },
  {
    row: 'ast:SELF',
    kind: 'SELF',
    targetSource: 'self',
    baseline: 'extends Node\nfunc run():\n\tvar probe = self\n\treturn\n',
    mutant: 'extends Node\nfunc run():\n\treturn\n',
  },
  {
    row: 'ast:SUBSCRIPT',
    kind: 'SUBSCRIPT',
    targetSource: '[1, 2][0]',
    baseline: 'var probe = [1, 2][0]\n',
    mutant: '',
  },
  {
    row: 'ast:TERNARY_OPERATOR',
    kind: 'TERNARY_OPERATOR',
    targetSource: '1 if true else 2',
    baseline: 'var probe = 1 if true else 2\n',
    mutant: '',
  },
  {
    row: 'ast:UNARY_OPERATOR',
    kind: 'UNARY_OPERATOR',
    targetSource: '-source',
    baseline: 'var source = 1\nvar probe = -source\n',
    mutant: 'var source = 1\n',
  },
];
