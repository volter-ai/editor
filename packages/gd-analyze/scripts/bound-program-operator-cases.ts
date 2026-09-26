export interface BoundOperatorCase {
  readonly row: `operator:${string}`;
  readonly nodeKind: 'ASSIGNMENT' | 'BINARY_OPERATOR';
  readonly operation: string;
  readonly lexeme: string;
  readonly baseline: string;
  readonly mutant: string;
}

function binary(operation: string, lexeme: string, left: string, right: string): BoundOperatorCase {
  return {
    row: `operator:${operation}`,
    nodeKind: 'BINARY_OPERATOR',
    operation,
    lexeme,
    baseline: `var probe = ${left} ${lexeme} ${right}\n`,
    mutant: `var probe = ${right}\n`,
  };
}

function assignment(operation: string, lexeme: string): BoundOperatorCase {
  return {
    row: `operator:${operation}`,
    nodeKind: 'ASSIGNMENT',
    operation,
    lexeme,
    baseline: `func run():\n\tvar value = 4\n\tvalue ${lexeme} 1\n`,
    mutant: 'func run():\n\tvar value = 4\n',
  };
}

export const operatorCases: readonly BoundOperatorCase[] = [
  binary('OP_ADDITION', '+', '1', '2'),
  binary('OP_BIT_AND', '&', '3', '1'),
  binary('OP_BIT_LEFT_SHIFT', '<<', '1', '2'),
  binary('OP_BIT_OR', '|', '2', '1'),
  binary('OP_BIT_RIGHT_SHIFT', '>>', '4', '1'),
  assignment('OP_BIT_SHIFT_LEFT', '<<='),
  assignment('OP_BIT_SHIFT_RIGHT', '>>='),
  binary('OP_BIT_XOR', '^', '3', '1'),
  binary('OP_COMP_EQUAL', '==', '1', '1'),
  binary('OP_COMP_GREATER', '>', '2', '1'),
  binary('OP_COMP_GREATER_EQUAL', '>=', '2', '1'),
  binary('OP_COMP_LESS', '<', '1', '2'),
  binary('OP_COMP_LESS_EQUAL', '<=', '1', '2'),
  binary('OP_COMP_NOT_EQUAL', '!=', '1', '2'),
  binary('OP_CONTENT_TEST', 'in', '"a"', '"abc"'),
  binary('OP_DIVISION', '/', '4.0', '2.0'),
  binary('OP_LOGIC_AND', 'and', 'true', 'false'),
  binary('OP_LOGIC_OR', 'or', 'false', 'true'),
  binary('OP_MODULO', '%', '5', '2'),
  binary('OP_MULTIPLICATION', '*', '2', '3'),
  assignment('OP_NONE', '='),
  binary('OP_POWER', '**', '2', '3'),
  binary('OP_SUBTRACTION', '-', '4', '1'),
];
