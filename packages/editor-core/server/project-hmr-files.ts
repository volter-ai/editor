import path from 'node:path';
import { isEditorLanePath } from '@volter/editor-sdk/session/tool-contribution-convention';
import ts from 'typescript';
import type { ImportersOf } from './project-root-surface';
import { resolveOidSurface } from './project-root-surface';

export type ProjectHotUpdateKind =
  | 'outside'
  | 'stock-data'
  | 'react'
  | 'r3f-refresh'
  | 'r3f-entry'
  | 'tool'
  | 'restart'
  | 'ignore';

/** Only locally proven component exports earn stock Fast Refresh. A wrong
 * positive can reload the whole editor. Parse all declarations (including
 * inline/indented exports), and never infer a component from an uppercase
 * value, an arbitrary factory call, or an uninspected re-export.
 */
export function reactRefreshBoundaryExports(source: string): readonly string[] | null {
  const file = ts.createSourceFile(
    'boundary.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const bindings = new Map<string, ts.Node>();
  const reactWrappers = new Set<string>();
  const reactNamespaces = new Set<string>();
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name)
      bindings.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer)
          bindings.set(declaration.name.text, declaration.initializer);
      }
    }
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === 'react'
    ) {
      const clause = statement.importClause;
      if (clause?.name) reactNamespaces.add(clause.name.text);
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings))
        reactNamespaces.add(clause.namedBindings.name.text);
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const binding of clause.namedBindings.elements) {
          if (['memo', 'forwardRef'].includes((binding.propertyName ?? binding.name).text))
            reactWrappers.add(binding.name.text);
        }
      }
    }
  }
  const component = (node: ts.Node, seen = new Set<string>()): boolean => {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node))
      return !node.name || /^[A-Z]/.test(node.name.text);
    if (ts.isArrowFunction(node)) return true;
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return component(node.expression, seen);
    if (ts.isIdentifier(node)) {
      if (seen.has(node.text) || !/^[A-Z]/.test(node.text)) return false;
      const binding = bindings.get(node.text);
      seen.add(node.text);
      return binding !== undefined && component(binding, seen);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const wrapper = ts.isIdentifier(callee)
        ? reactWrappers.has(callee.text)
        : ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          reactNamespaces.has(callee.expression.text) &&
          ['memo', 'forwardRef'].includes(callee.name.text);
      return wrapper && node.arguments[0] !== undefined && component(node.arguments[0], seen);
    }
    return false;
  };
  const exports: string[] = [];
  for (const statement of file.statements) {
    if (ts.isExportAssignment(statement)) {
      if (
        statement.isExportEquals ||
        ts.isArrowFunction(statement.expression) ||
        !component(statement.expression)
      )
        return null;
      exports.push('default');
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      if (
        statement.moduleSpecifier ||
        !statement.exportClause ||
        !ts.isNamedExports(statement.exportClause)
      )
        return null;
      for (const spec of statement.exportClause.elements) {
        if (spec.isTypeOnly) continue;
        if (spec.name.text !== 'default' && !/^[A-Z]/.test(spec.name.text)) return null;
        if (!component(spec.propertyName ?? spec.name)) return null;
        exports.push(spec.name.text);
      }
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue;
    if (ts.isFunctionDeclaration(statement)) {
      if (!statement.name || !/^[A-Z]/.test(statement.name.text)) return null;
      exports.push(
        modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
          ? 'default'
          : statement.name.text,
      );
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name) ||
          !/^[A-Z]/.test(declaration.name.text) ||
          !declaration.initializer ||
          !component(declaration.initializer)
        )
          return null;
        exports.push(declaration.name.text);
      }
    } else return null;
  }
  return exports.length ? exports.sort() : null;
}

export function isReactRefreshBoundary(source: string): boolean {
  return reactRefreshBoundaryExports(source) !== null;
}

/**
 * Classify a Vite watcher update for the editor's project-script HMR seam.
 *
 * Only modules below the project's `src/` directory are game code. Build
 * output, tests, one-off scripts, and dependency caches may also contain
 * JavaScript, but importing them into the live game is both surprising and
 * unsafe (a project build used to make the editor import `dist/assets/*`).
 */
export function classifyProjectHotUpdate(
  file: string,
  projectRoot: string,
  source = '',
  importersOf?: ImportersOf,
): ProjectHotUpdateKind {
  const normalizedFile = file.replaceAll('\\', '/');
  const normalizedRoot = projectRoot.replaceAll('\\', '/').replace(/\/$/, '');
  const relative = path.posix.relative(normalizedRoot, normalizedFile);

  if (relative === '' || relative === '..' || relative.startsWith('../')) {
    // A repo-vendored game's source (`vendor/games/<id>/…`) is the OPEN
    // GAME's own code even though it lives outside the project folder — the
    // project's ingest root maps to it. Classifying it `outside` handed it to
    // STOCK Vite HMR, whose unbounded propagation re-stamped ~33 editor
    // modules per creation-site write (the write route writes these files),
    // fanned an HMR update at the tab, and split editor singletons
    // (`play-mode.ts`'s game container) so every ▶ after a write refused —
    // measured on bubbo-bubbo, 2026-08-21. `restart` is the honest kind: the
    // ingest world re-derives from source on its next mount, and the
    // swallowed-HMR path stamps the module graph with the editor-chrome
    // boundary instead of letting stock HMR walk into the editor.
    if (normalizedFile.includes('/vendor/games/') && /\.(ts|tsx|js|jsx)$/.test(normalizedFile)) {
      return 'restart';
    }
    return 'outside';
  }
  if (relative === 'vgai.project.json') return 'restart';
  if (!relative.startsWith('src/')) return 'ignore';
  if (/\.data\.json$/.test(relative)) return 'stock-data';
  if (!/\.(ts|tsx|js|jsx)$/.test(relative)) return 'ignore';
  // Project-tool definitions, surfaces, documents, and their local helpers
  // are editor tooling. They remount through the tool contribution store's
  // own cache-busted import, never through game restart or React Refresh.
  if (isEditorLanePath(relative)) return 'tool';
  // R3F is a React renderer: a component-only module can refresh without
  // replacing its scene. Mixed component/data exports still need the editor's
  // remount boundary, because React Refresh cannot safely accept them.
  //
  // `resolveOidSurface` — the SAME single decision the source-authoring integration's serving plugin
  // OID-stamping transform stamps with, not a separate copy kept in lockstep
  // by hand. It decides from the manifest when this exact file is a root's
  // `entry`, from the live import graph when it's reachable from exactly one
  // root's `entry` (`importersOf`, when the caller has one — see
  // `dev.ts`/`packaged.ts`'s `handleHotUpdate`), and otherwise from the file's
  // own dialect evidence (a direct `@react-three/fiber` import, OR an R3F-only
  // intrinsic tag like
  // `<mesh>`). Reading its ATTRIBUTE rather than its surface is what keeps the
  // two halves identical by construction: a file stamped `userData-oid` is, by
  // definition, an R3F module. Its export shape decides whether the renderer
  // can refresh or needs the design-session remount.
  if (/\.(tsx|jsx)$/.test(relative)) {
    if (resolveOidSurface(file, source, importersOf).attribute === 'userData-oid')
      return isReactRefreshBoundary(source) ? 'r3f-refresh' : 'r3f-entry';
    // Stock Fast Refresh ONLY when the module provably is a Fast Refresh
    // boundary. Anything else the editor owns (swallow + stamp the module
    // graph + `vgai:restart-required`), because letting Vite propagate a
    // project module that is not a boundary full-reloads the editor page and
    // silently destroys the running game — see `isReactRefreshBoundary`.
    return isReactRefreshBoundary(source) ? 'react' : 'restart';
  }
  return 'restart';
}
