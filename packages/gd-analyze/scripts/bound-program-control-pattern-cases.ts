export interface BoundControlPatternCase {
  readonly row: `ast:${string}` | `pattern:${string}`;
  readonly kind: string;
  readonly patternType?: string;
  readonly targetSource: string;
  readonly baseline: string;
  readonly mutant: string;
}

const EMPTY_FUNCTION = 'func run(value):\n\treturn\n';

function matchCase(
  row: BoundControlPatternCase['row'],
  targetSource: string,
  pattern: string,
  patternType?: string,
): BoundControlPatternCase {
  return {
    row,
    kind: row === 'ast:MATCH' ? 'MATCH' : row === 'ast:MATCH_BRANCH' ? 'MATCH_BRANCH' : 'PATTERN',
    ...(patternType === undefined ? {} : { patternType }),
    targetSource,
    baseline: `func run(value):\n\tmatch value:\n\t\t${pattern}:\n\t\t\tpass\n\treturn\n`,
    mutant: EMPTY_FUNCTION,
  };
}

export const controlPatternCases: readonly BoundControlPatternCase[] = [
  {
    row: 'ast:ASSERT',
    kind: 'ASSERT',
    targetSource: 'assert(true)',
    baseline: 'func run():\n\tassert(true)\n\treturn\n',
    mutant: 'func run():\n\treturn\n',
  },
  {
    row: 'ast:BREAK',
    kind: 'BREAK',
    targetSource: 'break',
    baseline: 'func run():\n\twhile true:\n\t\tbreak\n\t\tpass\n',
    mutant: 'func run():\n\twhile true:\n\t\tpass\n',
  },
  {
    row: 'ast:BREAKPOINT',
    kind: 'BREAKPOINT',
    targetSource: 'breakpoint',
    baseline: 'func run():\n\tbreakpoint\n\treturn\n',
    mutant: 'func run():\n\treturn\n',
  },
  {
    row: 'ast:CONTINUE',
    kind: 'CONTINUE',
    targetSource: 'continue',
    baseline: 'func run():\n\tfor value in [1]:\n\t\tcontinue\n\t\tpass\n',
    mutant: 'func run():\n\tfor value in [1]:\n\t\tpass\n',
  },
  {
    row: 'ast:FOR',
    kind: 'FOR',
    targetSource: 'for value in [1]:\n\t\tpass\n',
    baseline: 'func run():\n\tfor value in [1]:\n\t\tpass\n\treturn\n',
    mutant: 'func run():\n\treturn\n',
  },
  {
    row: 'ast:IF',
    kind: 'IF',
    targetSource: 'if true:\n\t\tpass\n',
    baseline: 'func run():\n\tif true:\n\t\tpass\n\treturn\n',
    mutant: 'func run():\n\treturn\n',
  },
  matchCase('ast:MATCH', 'match value:\n\t\t_:\n\t\t\tpass\n', '_'),
  matchCase('ast:MATCH_BRANCH', '1:\n\t\t\tpass\n', '1'),
  {
    row: 'ast:PASS',
    kind: 'PASS',
    targetSource: 'pass',
    baseline: 'func run():\n\tpass\n\treturn\n',
    mutant: 'func run():\n\treturn\n',
  },
  matchCase('ast:PATTERN', '_', '_', 'PT_WILDCARD'),
  {
    row: 'ast:RETURN',
    kind: 'RETURN',
    targetSource: 'return',
    baseline: 'func run():\n\treturn\n\tpass\n',
    mutant: 'func run():\n\tpass\n',
  },
  {
    row: 'ast:SUITE',
    kind: 'SUITE',
    targetSource: 'return\n',
    baseline: 'func run():\n\treturn\n',
    mutant: '',
  },
  {
    row: 'ast:WHILE',
    kind: 'WHILE',
    targetSource: 'while true:\n\t\tpass\n',
    baseline: 'func run():\n\twhile true:\n\t\tpass\n\treturn\n',
    mutant: 'func run():\n\treturn\n',
  },
  matchCase('pattern:PT_ARRAY', '[1, ..]', '[1, ..]', 'PT_ARRAY'),
  matchCase('pattern:PT_BIND', 'var captured', 'var captured', 'PT_BIND'),
  matchCase(
    'pattern:PT_DICTIONARY',
    '{"key": var captured, ..}',
    '{"key": var captured, ..}',
    'PT_DICTIONARY',
  ),
  {
    ...matchCase('pattern:PT_EXPRESSION', 'TARGET', 'TARGET', 'PT_EXPRESSION'),
    baseline:
      'const TARGET = 1\nfunc run(value):\n\tmatch value:\n\t\tTARGET:\n\t\t\tpass\n\treturn\n',
    mutant: 'const TARGET = 1\nfunc run(value):\n\treturn\n',
  },
  matchCase('pattern:PT_LITERAL', '1', '1', 'PT_LITERAL'),
  matchCase('pattern:PT_REST', '..', '[1, ..]', 'PT_REST'),
  matchCase('pattern:PT_WILDCARD', '_', '_', 'PT_WILDCARD'),
];
