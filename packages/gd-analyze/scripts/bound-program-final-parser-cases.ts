export interface FinalPositiveParserCase {
  readonly row: 'ast:CAST' | 'ast:CLASS' | 'ast:TYPE_TEST';
  readonly kind: 'CAST' | 'CLASS' | 'TYPE_TEST';
  readonly targetSource: string;
  readonly baseline: string;
  readonly mutant: string;
}

export const finalPositiveParserCases: readonly FinalPositiveParserCase[] = [
  {
    row: 'ast:CAST',
    kind: 'CAST',
    targetSource: 'value as Object',
    baseline: 'func run(value):\n\tvar probe = value as Object\n\treturn\n',
    mutant: 'func run(value):\n\treturn\n',
  },
  {
    row: 'ast:CLASS',
    kind: 'CLASS',
    targetSource: 'class Nested:\n\tvar value = 1\n',
    baseline: 'class Nested:\n\tvar value = 1\n',
    mutant: '',
  },
  {
    row: 'ast:TYPE_TEST',
    kind: 'TYPE_TEST',
    targetSource: 'value is Object',
    baseline: 'func run(value):\n\tvar probe = value is Object\n\treturn\n',
    mutant: 'func run(value):\n\treturn\n',
  },
];

export const yieldBaseline = 'extends SceneTree\nfunc _init():\n\tyield()\n\tquit()\n';
export const yieldMutant = 'extends SceneTree\nfunc _init():\n\tquit()\n';

export const noneBaseline = 'var probe = 1\n';
export const noneMutant = '';
