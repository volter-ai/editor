/**
 * The page's Controls (`src/ui.tsx`, docs/GODOT.md "UI is React DOM"): the `tunnel-rat` tunnel the
 * scenes send their Controls through (`ui.In`, inside `<GodotControls>`), and the `dom` root the
 * manifest mounts over the world, which renders them (`ui.Out`) in an overlay laid out at the
 * project's 2D size and stretched to the page as the project stretches its 2D (`GodotStretch`).
 */
import { TARGET_TS_SYNTAX_VERSION, type TargetTsSourceFile } from '../code/target-ts-syntax';

export function emitDirectGodotUiSyntax(): TargetTsSourceFile {
  return {
    syntaxVersion: TARGET_TS_SYNTAX_VERSION,
    sourcePath: 'src/ui.tsx',
    statements: [
      { kind: 'import-statement', module: 'tunnel-rat', defaultBinding: 'tunnel', namedBindings: [] },
      { kind: 'import-statement', module: './lib/godot-compat/godot-controls', namedBindings: [{ imported: 'GodotStretch', local: 'GodotStretch' }] },
      {
        kind: 'variable-statement',
        declaration: 'const',
        name: 'ui',
        modifiers: ['export'],
        initializer: { kind: 'call-expression', callee: { kind: 'identifier-expression', name: 'tunnel' }, arguments: [] },
      },
      {
        kind: 'function-statement',
        name: 'Ui',
        modifiers: ['export', 'default'],
        parameters: [],
        body: [
          {
            kind: 'return-statement',
            expression: {
              kind: 'jsx-element-expression',
              tag: 'GodotStretch',
              attributes: [],
              children: [{ kind: 'jsx-element-child', tag: 'ui.Out', attributes: [], children: [] }],
            },
          },
        ],
      },
    ],
  };
}
