export interface BoundTokenCase {
  readonly row: `token:${string}`;
  readonly tokenName: string;
  readonly lexeme: string;
  readonly baseline: string;
  readonly mutant: string;
  readonly expectedSource?: string;
  readonly deletionNeedle?: string;
  readonly validateSpan?: boolean;
}

function binary(
  row: `token:${string}`,
  lexeme: string,
  left: string,
  right: string,
): BoundTokenCase {
  return {
    row,
    tokenName: lexeme,
    lexeme,
    baseline: `func run():\n\treturn ${left} ${lexeme} ${right}\n`,
    mutant: `func run():\n\treturn ${right}\n`,
  };
}

function unary(row: `token:${string}`, lexeme: string, operand: string): BoundTokenCase {
  return {
    row,
    tokenName: lexeme,
    lexeme,
    baseline: `func run():\n\treturn ${lexeme}${operand}\n`,
    mutant: `func run():\n\treturn ${operand}\n`,
  };
}

function assignment(
  row: `token:${string}`,
  lexeme: string,
  initial: string,
  operand: string,
): BoundTokenCase {
  return {
    row,
    tokenName: lexeme,
    lexeme,
    baseline: `func run():\n\tvar value = ${initial}\n\tvalue ${lexeme} ${operand}\n\tpass\n`,
    mutant: `func run():\n\tvar value = ${initial}\n\tpass\n`,
  };
}

function paired(row: `token:${string}`, lexeme: string, expression: string): BoundTokenCase {
  return {
    row,
    tokenName: lexeme,
    lexeme,
    baseline: `var value = ${expression}\nvar marker = 0\n`,
    mutant: 'var marker = 0\n',
  };
}

const indentedBaseline = 'func run():\n\tpass\nvar marker = 0\n';
const indentedMutant = 'var marker = 0\n';

/** Valid Godot 4.7 symbol/basic/whitespace token constructs; legacy `yield` is not valid syntax. */
export const symbolTokenCases: readonly BoundTokenCase[] = [
  binary('token:AMPERSAND', '&', '3', '1'),
  binary('token:AMPERSAND_AMPERSAND', '&&', 'true', 'false'),
  assignment('token:AMPERSAND_EQUAL', '&=', '3', '1'),
  unary('token:BANG', '!', 'false'),
  binary('token:BANG_EQUAL', '!=', '1', '2'),
  paired('token:BRACE_CLOSE', '}', '{}'),
  paired('token:BRACE_OPEN', '{', '{}'),
  paired('token:BRACKET_CLOSE', ']', '[]'),
  paired('token:BRACKET_OPEN', '[', '[]'),
  binary('token:CARET', '^', '3', '1'),
  assignment('token:CARET_EQUAL', '^=', '3', '1'),
  {
    row: 'token:COLON',
    tokenName: ':',
    lexeme: ':',
    baseline: 'var value: int = 1\n',
    mutant: 'var value = 1\n',
  },
  {
    row: 'token:COMMA',
    tokenName: ',',
    lexeme: ',',
    baseline: 'var value = [1, 2]\n',
    mutant: 'var value = [1]\n',
  },
  {
    row: 'token:DEDENT',
    tokenName: 'Dedent',
    lexeme: '',
    expectedSource: '',
    deletionNeedle: 'func',
    validateSpan: false,
    baseline: indentedBaseline,
    mutant: indentedMutant,
  },
  {
    row: 'token:DOLLAR',
    tokenName: '$',
    lexeme: '$',
    baseline: 'extends Node\nfunc run():\n\tvar child = $Child\n\tpass\n',
    mutant: 'extends Node\nfunc run():\n\tpass\n',
  },
  {
    row: 'token:EQUAL',
    tokenName: '=',
    lexeme: '=',
    baseline: 'var value = 1\n',
    mutant: 'var value\n',
  },
  binary('token:EQUAL_EQUAL', '==', '1', '1'),
  {
    row: 'token:FORWARD_ARROW',
    tokenName: '->',
    lexeme: '->',
    baseline: 'func run() -> void:\n\tpass\n',
    mutant: 'func run():\n\tpass\n',
  },
  binary('token:GREATER', '>', '2', '1'),
  binary('token:GREATER_EQUAL', '>=', '2', '1'),
  binary('token:GREATER_GREATER', '>>', '4', '1'),
  assignment('token:GREATER_GREATER_EQUAL', '>>=', '4', '1'),
  {
    row: 'token:IDENTIFIER',
    tokenName: 'Identifier',
    lexeme: 'value',
    baseline: 'var value = 1\n',
    mutant: '',
  },
  {
    row: 'token:INDENT',
    tokenName: 'Indent',
    lexeme: '\t',
    expectedSource: '\t',
    deletionNeedle: '\t',
    validateSpan: false,
    baseline: indentedBaseline,
    mutant: indentedMutant,
  },
  binary('token:LESS', '<', '1', '2'),
  binary('token:LESS_EQUAL', '<=', '1', '2'),
  binary('token:LESS_LESS', '<<', '1', '2'),
  assignment('token:LESS_LESS_EQUAL', '<<=', '1', '2'),
  {
    row: 'token:LITERAL',
    tokenName: 'Literal',
    lexeme: '1',
    baseline: 'var value = 1\n',
    mutant: '',
  },
  binary('token:MINUS', '-', '4', '1'),
  assignment('token:MINUS_EQUAL', '-=', '4', '1'),
  {
    row: 'token:NEWLINE',
    tokenName: 'Newline',
    lexeme: '',
    expectedSource: '',
    deletionNeedle: '\n',
    validateSpan: false,
    baseline: 'var value = 1\n',
    mutant: '',
  },
  paired('token:PARENTHESIS_CLOSE', ')', 'Vector2()'),
  paired('token:PARENTHESIS_OPEN', '(', 'Vector2()'),
  binary('token:PERCENT', '%', '5', '2'),
  assignment('token:PERCENT_EQUAL', '%=', '5', '2'),
  {
    row: 'token:PERIOD',
    tokenName: '.',
    lexeme: '.',
    baseline: 'var value = Vector2.ZERO\nvar marker = 0\n',
    mutant: 'var marker = 0\n',
  },
  {
    row: 'token:PERIOD_PERIOD',
    tokenName: '..',
    lexeme: '..',
    baseline: 'func run():\n\tmatch {}:\n\t\t{..}:\n\t\t\tpass\n\tpass\n',
    mutant: 'func run():\n\tpass\n',
  },
  {
    row: 'token:PERIOD_PERIOD_PERIOD',
    tokenName: '...',
    lexeme: '...',
    baseline: 'func run(...values):\n\tpass\n',
    mutant: 'func run(values):\n\tpass\n',
  },
  binary('token:PIPE', '|', '2', '1'),
  assignment('token:PIPE_EQUAL', '|=', '2', '1'),
  binary('token:PIPE_PIPE', '||', 'false', 'true'),
  binary('token:PLUS', '+', '1', '2'),
  assignment('token:PLUS_EQUAL', '+=', '1', '2'),
  {
    row: 'token:SEMICOLON',
    tokenName: ';',
    lexeme: ';',
    baseline: 'func run():\n\tpass; return\n',
    mutant: 'func run():\n\tpass\n',
  },
  binary('token:SLASH', '/', '4', '2'),
  assignment('token:SLASH_EQUAL', '/=', '4', '2'),
  binary('token:STAR', '*', '2', '3'),
  assignment('token:STAR_EQUAL', '*=', '2', '3'),
  binary('token:STAR_STAR', '**', '2', '3'),
  assignment('token:STAR_STAR_EQUAL', '**=', '2', '3'),
  unary('token:TILDE', '~', '1'),
  {
    row: 'token:UNDERSCORE',
    tokenName: '_',
    lexeme: '_',
    baseline: 'func run():\n\tmatch 1:\n\t\t_:\n\t\t\tpass\n\tpass\n',
    mutant: 'func run():\n\tpass\n',
  },
];
