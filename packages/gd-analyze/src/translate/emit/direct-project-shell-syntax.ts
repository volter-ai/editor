import {
  TARGET_TS_SYNTAX_VERSION,
  type TargetTsExpression,
  type TargetTsObjectProperty,
  type TargetTsSourceFile,
  type TargetTsStatement,
  type TargetTsType,
} from '../code/target-ts-syntax';

const id = (name: string): TargetTsExpression => ({ kind: 'identifier-expression', name });
const lit = (value: string | number | boolean | null): TargetTsExpression => ({
  kind: 'literal-expression',
  value,
});
const prop = (object: TargetTsExpression, property: string): TargetTsExpression => ({
  kind: 'property-expression',
  object,
  property,
});
const call = (
  callee: TargetTsExpression,
  args: readonly TargetTsExpression[] = [],
): TargetTsExpression => ({ kind: 'call-expression', callee, arguments: args });
const object = (properties: readonly TargetTsObjectProperty[]): TargetTsExpression => ({
  kind: 'object-expression',
  properties,
});
const array = (elements: readonly TargetTsExpression[]): TargetTsExpression => ({
  kind: 'array-expression',
  elements,
});
const refType = (name: string, args: readonly TargetTsType[] = []): TargetTsType => ({
  kind: 'type-reference',
  name,
  arguments: args,
});
const expression = (value: TargetTsExpression): TargetTsStatement => ({
  kind: 'expression-statement',
  expression: value,
});
const ifStatement = (
  condition: TargetTsExpression,
  body: readonly TargetTsStatement[],
): TargetTsStatement => ({
  kind: 'if-statement',
  condition,
  // biome-ignore lint/suspicious/noThenProperty: `then` is the closed TargetTs grammar field.
  then: body,
});
const sourceFile = (
  sourcePath: string,
  statements: readonly TargetTsStatement[],
): TargetTsSourceFile => ({ syntaxVersion: TARGET_TS_SYNTAX_VERSION, sourcePath, statements });

function mainImports(): readonly TargetTsStatement[] {
  const mountModule = '@volter/game-runtime/runtime/mount-game';
  return [
    {
      kind: 'import-statement',
      module: mountModule,
      namedBindings: [{ imported: 'ManifestHost', local: 'ManifestHost' }],
      typeOnly: true,
    },
    {
      kind: 'import-statement',
      module: mountModule,
      namedBindings: [
        { imported: 'isAdapterRegistered', local: 'isAdapterRegistered' },
        { imported: 'mountGameFromManifest', local: 'mountGameFromManifest' },
        { imported: 'registerAdapter', local: 'registerAdapter' },
      ],
    },
    {
      kind: 'import-statement',
      module: '@volter/game-runtime/world3d-react',
      namedBindings: [{ imported: 'r3fRootFactory', local: 'r3fRootFactory' }],
    },
    {
      kind: 'import-statement',
      module: '../vgai.project.json',
      defaultBinding: 'manifest',
      namedBindings: [],
    },
    {
      kind: 'import-statement',
      module: './world',
      defaultBinding: 'World',
      namedBindings: [],
    },
  ];
}

function hostExpression(): TargetTsExpression {
  return object([
    { key: 'container', value: id('container') },
    {
      key: 'loadEntryModule',
      value: {
        kind: 'arrow-expression',
        async: true,
        parameters: [{ name: 'entry' }],
        body: [
          ifStatement(
            {
              kind: 'binary-expression',
              operator: '!==',
              left: id('entry'),
              right: lit('src/world.tsx'),
            },
            [
              {
                kind: 'throw-statement',
                expression: {
                  kind: 'new-expression',
                  callee: id('Error'),
                  arguments: [lit('unplanned root entry')],
                },
              },
            ],
          ),
          {
            kind: 'return-statement',
            expression: { kind: 'element-expression', object: id('entries'), index: id('entry') },
          },
        ],
      },
    },
  ]);
}

function mainBody(): readonly TargetTsStatement[] {
  return [
    expression({
      kind: 'assignment-expression',
      operator: '=',
      target: prop(id('document'), 'title'),
      value: prop(id('manifest'), 'name'),
    }),
    {
      kind: 'variable-statement',
      declaration: 'const',
      name: 'container',
      initializer: call(prop(id('document'), 'getElementById'), [lit('game-canvas')]),
    },
    ifStatement(
      {
        kind: 'binary-expression',
        operator: '===',
        left: id('container'),
        right: lit(null),
      },
      [
        {
          kind: 'throw-statement',
          expression: {
            kind: 'new-expression',
            callee: id('Error'),
            arguments: [lit('index.html has no #game-canvas host')],
          },
        },
      ],
    ),
    {
      kind: 'variable-statement',
      declaration: 'const',
      name: 'entries',
      initializer: object([
        { key: 'src/world.tsx', value: object([{ key: 'default', value: id('World') }]) },
      ]),
    },
    {
      kind: 'variable-statement',
      declaration: 'const',
      name: 'host',
      type: refType('ManifestHost'),
      initializer: hostExpression(),
    },
    {
      kind: 'variable-statement',
      declaration: 'const',
      name: 'session',
      initializer: {
        kind: 'await-expression',
        expression: call(id('mountGameFromManifest'), [id('manifest'), id('host')]),
      },
    },
    {
      kind: 'variable-statement',
      declaration: 'const',
      name: 'resize',
      type: {
        kind: 'function-type',
        parameters: [],
        result: { kind: 'keyword-type', keyword: 'void' },
      },
      initializer: {
        kind: 'arrow-expression',
        parameters: [],
        body: call(prop(id('session'), 'resize'), [
          prop(id('window'), 'innerWidth'),
          prop(id('window'), 'innerHeight'),
        ]),
      },
    },
    expression(call(id('resize'))),
    expression(call(prop(id('window'), 'addEventListener'), [lit('resize'), id('resize')])),
  ];
}

/** Emitter-owned structured host entrypoint; no target source text exists before emission. */
export function directMainSyntax(): TargetTsSourceFile {
  return sourceFile('src/main.ts', [
    ...mainImports(),
    ifStatement(
      {
        kind: 'unary-expression',
        operator: '!',
        operand: call(id('isAdapterRegistered'), [lit('three')]),
      },
      [expression(call(id('registerAdapter'), [lit('three'), id('r3fRootFactory')]))],
    ),
    {
      kind: 'function-statement',
      name: 'main',
      modifiers: ['async'],
      parameters: [],
      result: refType('Promise', [{ kind: 'keyword-type', keyword: 'void' }]),
      body: mainBody(),
    },
    expression({
      kind: 'unary-expression',
      operator: 'void',
      operand: call(prop(call(id('main')), 'catch'), [
        {
          kind: 'arrow-expression',
          parameters: [{ name: 'error', type: { kind: 'keyword-type', keyword: 'unknown' } }],
          body: call(prop(id('console'), 'error'), [id('error')]),
        },
      ]),
    }),
  ]);
}

/** Structured Vite host configuration; printing is owned solely by emit. */
export function directViteConfigSyntax(): TargetTsSourceFile {
  return sourceFile('vite.config.ts', [
    {
      kind: 'import-statement',
      module: 'vite',
      namedBindings: [{ imported: 'defineConfig', local: 'defineConfig' }],
    },
    {
      kind: 'export-default-statement',
      expression: call(id('defineConfig'), [
        object([
          { key: 'esbuild', value: object([{ key: 'jsx', value: lit('automatic') }]) },
          {
            key: 'resolve',
            value: object([
              {
                key: 'dedupe',
                value: array(['react', 'react-dom', 'three', '@react-three/fiber'].map(lit)),
              },
            ]),
          },
          {
            key: 'optimizeDeps',
            value: object([
              {
                key: 'include',
                value: array(
                  ['react', 'react-dom', 'react/jsx-runtime', 'three', '@react-three/fiber'].map(
                    lit,
                  ),
                ),
              },
              {
                key: 'exclude',
                value: array([lit('@volter/game-runtime/runtime/mount-game')]),
              },
            ]),
          },
          {
            key: 'server',
            value: object([
              { key: 'port', value: lit(5180) },
              { key: 'strictPort', value: lit(true) },
            ]),
          },
          {
            key: 'build',
            value: object([
              { key: 'target', value: lit('es2022') },
              { key: 'chunkSizeWarningLimit', value: lit(2304) },
            ]),
          },
        ]),
      ]),
    },
  ]);
}
