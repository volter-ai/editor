/**
 * `planComponentFork` — the PURE core of H7 "Fork Component…": two already-read
 * source strings in, two exact edits out. No I/O, no hashing, no transport — the
 * same split `plan-source-edit.ts` uses, and for the same reason (the dev server
 * reads with `node:fs`; this module stays dependency-free so the plan is
 * readable on its own).
 *
 * WHAT A FORK IS. H7's translation of Unity's Unpack into a source world:
 * customizing ONE instance beyond the component's prop surface means COPYING the
 * component and retargeting that callsite — never flattening the definition's
 * JSX into the parent (a refactor no React developer performs, and the thing
 * H7 rejects permanently). Mechanically: one new file plus one changed tag.
 *
 * WHY THE WHOLE MODULE IS COPIED. The copy has to COMPILE. A definition's
 * dependencies are module-level: imports, helper functions, constants, types,
 * the props interface. Copying the module wholesale carries all of them, and —
 * because the copy lands as a SIBLING of the original — every relative import
 * specifier inside it still resolves unchanged. Selective extraction (copy the
 * function, chase what it references) is the scope-analysis machinery the
 * reparent spec owns; this action deliberately does not have it. The price is
 * that non-component exports are duplicated across the two modules. That is
 * accepted for v1: nothing imports the new module except the one retargeted
 * callsite, so a duplicate export is inert.
 *
 * WHY IT IS NOT "for this instance". The menu item is `Fork Component…`, not
 * "Fork for this instance": a callsite that lives inside a component rendered
 * many times retargets EVERY render of that callsite. One callsite is the unit
 * of this edit, and one callsite is not always one on-screen object.
 *
 * REFUSALS ARE NAMED. Every rejection returns a sentence the author can act on
 * (doctrine rule 2 — "refusal is visible and named"), and the planner refuses
 * BEFORE anything is written; the caller writes only a plan it has in hand.
 */

import ts from 'typescript';
import { lineColToOffset } from './oid-transform';
import { relativeImportSpecifier } from './relative-import-specifier';
import { hasModifier, parseAuthoringTsx } from './ts-ast';

/** A valid JS identifier — the gate the instance's `name` prop must pass to
 *  become the fork's component name. */
const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `<Tag>Fork`, `<Tag>Fork2` … up to this suffix before the planner gives up. */
const MAX_FALLBACK_SUFFIX = 99;

const SOURCE_EXTENSION_RE = /\.(tsx|ts|jsx|js)$/;

export interface ForkComponentRequest {
  /** The file the instance is USED in, and its current bytes. */
  readonly callsiteFile: string;
  readonly callsiteSource: string;
  /** The callsite element's `OidEntry` position (1-based line, 0-based col). */
  readonly callsiteLine: number;
  readonly callsiteCol: number;
  /** The file the component is WRITTEN in, and its current bytes. */
  readonly definitionFile: string;
  readonly definitionSource: string;
  /** The component name as spelled AT THE CALLSITE (`OidEntry.tag`). */
  readonly tag: string;
  /** The instance's `name` prop — the preferred seed for the fork's name. */
  readonly nameSeed?: string | undefined;
  /**
   * File NAMES (not paths) already in the definition file's directory. Two
   * jobs: the cheap "is this export name taken" probe H7 asks for (a module's
   * basename is a good enough proxy for the component it exports, and this
   * planner is not allowed to read the directory itself), and the hard
   * file-collision refusal.
   */
  readonly siblingFiles?: readonly string[] | undefined;
}

export interface ForkComponentPlan {
  /** The forked component's name inside the copy, and at the retargeted tag. */
  readonly newName: string;
  /** `EnemyBravo.tsx` — the caller joins it onto the definition's directory. */
  readonly newFileName: string;
  /** The new module's path, normalized to forward slashes. */
  readonly newFile: string;
  /** The complete bytes of the new module (the copy, renamed). */
  readonly newFileSource: string;
  readonly callsiteFile: string;
  readonly callsitePrevSource: string;
  readonly callsiteNewSource: string;
  /** The specifier written into the callsite's new import. */
  readonly importSpecifier: string;
  /** The component name as it was spelled at the callsite before the fork. */
  readonly tag: string;
  /** The history label for the CALLSITE edit (the new file is outside history). */
  readonly historyLabel: string;
}

export type ForkComponentPlanResult =
  | { readonly ok: true; readonly plan: ForkComponentPlan }
  | { readonly ok: false; readonly reason: string };

function refuse(reason: string): ForkComponentPlanResult {
  return { ok: false, reason };
}

// ------------------------------------------------------------------- paths

/** Forward-slash form; a Windows path from the OID index normalizes here. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function directoryOf(path: string): string {
  const clean = normalizePath(path);
  const cut = clean.lastIndexOf('/');
  return cut < 0 ? '' : clean.slice(0, cut);
}

/** `siblingOf('src/Enemy.tsx', 'Fork.tsx')` → `src/Fork.tsx`; a bare filename
 *  (no directory at all) stays bare rather than becoming root-absolute. */
function siblingOf(path: string, fileName: string): string {
  const dir = directoryOf(path);
  return dir ? `${dir}/${fileName}` : fileName;
}

// -------------------------------------------------------------- declarations

interface ComponentDeclaration {
  readonly exported: boolean;
  readonly isDefault: boolean;
}

/**
 * The component's own declaration in its module — a function declaration or a
 * `const` bound to an arrow/function expression, the same two shapes
 * `oid-transform.ts`'s `componentDefinitions` recognizes as a component. A
 * `memo(...)`/`forwardRef(...)` wrapper is deliberately NOT matched: the fork
 * would have to guess where the name lives, and a named refusal beats a guess.
 */
function declarationOf(sf: ts.SourceFile, name: string): ComponentDeclaration | null {
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name && statement.body) {
      return {
        exported: hasModifier(statement, ts.SyntaxKind.ExportKeyword),
        isDefault: hasModifier(statement, ts.SyntaxKind.DefaultKeyword),
      };
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name &&
        declaration.initializer &&
        (ts.isArrowFunction(declaration.initializer) ||
          ts.isFunctionExpression(declaration.initializer))
      ) {
        return {
          exported: hasModifier(statement, ts.SyntaxKind.ExportKeyword),
          isDefault: false,
        };
      }
    }
  }
  return null;
}

/** How the copy will EXPORT the renamed component — which decides whether the
 *  callsite gets a named or a default import. `null` means it is not exported
 *  at all, which the fork refuses (the retargeted callsite could not import
 *  it). */
function exportFormOf(
  sf: ts.SourceFile,
  name: string,
  declaration: ComponentDeclaration,
): 'named' | 'default' | null {
  if (declaration.isDefault) return 'default';
  if (declaration.exported) return 'named';
  for (const statement of sf.statements) {
    const form = exportStatementForm(statement, name);
    if (form) return form;
  }
  return null;
}

/** `export default Enemy;` / `export { Enemy }` / `export { Enemy as default }`. */
function exportStatementForm(statement: ts.Statement, name: string): 'named' | 'default' | null {
  if (ts.isExportAssignment(statement)) {
    const isDefault =
      statement.isExportEquals !== true &&
      ts.isIdentifier(statement.expression) &&
      statement.expression.text === name;
    return isDefault ? 'default' : null;
  }
  if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier) return null;
  const clause = statement.exportClause;
  if (!clause || !ts.isNamedExports(clause)) return null;
  for (const element of clause.elements) {
    if ((element.propertyName ?? element.name).text !== name) continue;
    return element.name.text === 'default' ? 'default' : 'named';
  }
  return null;
}

/** Every binding this module introduces at the top level — imports included.
 *  The fork's name must collide with none of them, in either file. */
function topLevelNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sf.statements) {
    for (const name of statementNames(statement)) names.add(name);
  }
  return names;
}

function statementNames(statement: ts.Statement): string[] {
  if (ts.isImportDeclaration(statement)) return importedNames(statement);
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) =>
      boundNames(declaration.name),
    );
  }
  if (!NAMED_DECLARATION_KINDS.has(statement.kind)) return [];
  const named = (statement as { name?: ts.Identifier }).name;
  return named ? [named.text] : [];
}

function boundNames(node: ts.BindingName): string[] {
  if (ts.isIdentifier(node)) return [node.text];
  return node.elements.flatMap((element) =>
    ts.isBindingElement(element) ? boundNames(element.name) : [],
  );
}

const NAMED_DECLARATION_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
]);

function importedNames(statement: ts.ImportDeclaration): string[] {
  const clause = statement.importClause;
  if (!clause) return [];
  const names = clause.name ? [clause.name.text] : [];
  const bindings = clause.namedBindings;
  if (!bindings) return names;
  if (ts.isNamespaceImport(bindings)) return [...names, bindings.name.text];
  return [...names, ...bindings.elements.map((element) => element.name.text)];
}

/** The name the definition module actually declares for the tag spelled at the
 *  callsite. Usually the same string; an aliased (`import { Enemy as Foe }`) or
 *  default import makes them differ, and renaming the wrong one would produce a
 *  copy that does not compile. */
function resolveDeclaredName(
  definitionSf: ts.SourceFile,
  callsiteSf: ts.SourceFile,
  tag: string,
): string | null {
  if (declarationOf(definitionSf, tag)) return tag;
  const imported = importedOrigin(callsiteSf, tag);
  if (!imported) return null;
  const original = imported === 'default' ? defaultExportName(definitionSf) : imported;
  return original && declarationOf(definitionSf, original) ? original : null;
}

/** What the callsite's `tag` binding is imported AS: the exporting module's own
 *  name for it, or the sentinel `'default'`. `null` when it is not imported. */
function importedOrigin(callsiteSf: ts.SourceFile, tag: string): string | null {
  for (const statement of callsiteSf.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const clause = statement.importClause;
    if (clause.name?.text === tag) return 'default';
    const bindings = clause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.name.text === tag) return (element.propertyName ?? element.name).text;
    }
  }
  return null;
}

function defaultExportName(sf: ts.SourceFile): string | null {
  for (const statement of sf.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
    ) {
      return statement.name.text;
    }
    if (
      ts.isExportAssignment(statement) &&
      statement.isExportEquals !== true &&
      ts.isIdentifier(statement.expression)
    ) {
      return statement.expression.text;
    }
  }
  return null;
}

// -------------------------------------------------------------------- naming

/** `patrol guard 2` → `PatrolGuard2`; `""`/`"2fast"` → `null` (not an
 *  identifier, so the caller falls back to `<Tag>Fork`). */
export function pascalCaseIdentifier(seed: string | undefined): string | null {
  if (!seed) return null;
  const parts = seed.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length === 0) return null;
  const joined = parts.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join('');
  if (!IDENTIFIER_RE.test(joined)) return null;
  if (!/^[A-Z]/.test(joined)) return null;
  return joined;
}

/**
 * The fork's name: the instance's `name` prop when it is usable and free,
 * otherwise `<Tag>Fork`, `<Tag>Fork2`, … `null` when even the fallback series
 * is exhausted (99 forks of one component in one directory).
 */
export function pickForkName(
  tag: string,
  seed: string | undefined,
  taken: ReadonlySet<string>,
): string | null {
  const fromSeed = pascalCaseIdentifier(seed);
  if (fromSeed && !taken.has(fromSeed)) return fromSeed;
  for (let suffix = 1; suffix <= MAX_FALLBACK_SUFFIX; suffix += 1) {
    const candidate = `${tag}Fork${suffix === 1 ? '' : suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

// --------------------------------------------------------------- the rename

interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function applyReplacements(source: string, replacements: readonly Replacement[]): string {
  let out = source;
  for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, replacement.start) + replacement.text + out.slice(replacement.end);
  }
  return out;
}

/**
 * Rename every reference to `name` in this module — AST-driven, never a regex.
 *
 * Renamed: the declaration, ordinary references, self-recursive JSX usage
 * (`<Enemy>` inside `Enemy`'s own body), `export { Enemy }`, `export default
 * Enemy`, type positions such as `typeof Enemy`. NOT renamed: anything that
 * merely SPELLS the same text in a non-reference position — a property access
 * (`registry.Enemy`), an object-literal key, a JSX attribute name, a
 * destructuring property name, a member of a type. The props type
 * (`EnemyProps`) is a different identifier and is deliberately untouched: H7
 * renames the component, nothing else.
 *
 * A shorthand property (`{ Enemy }`) is EXPANDED to `{ Enemy: EnemyBravo }`
 * rather than renamed, because renaming it silently changes the key.
 *
 * Known v1 limit, recorded rather than hidden: an inner scope that re-declares
 * the same name would have its references renamed too. Detecting that needs a
 * scope walk this action does not carry, and a component module shadowing its
 * own component name is not a shape we have seen.
 */
export function renameComponentInModule(
  file: string,
  source: string,
  name: string,
  newName: string,
): string {
  const sf = parseAuthoringTsx(file, source);
  const replacements: Replacement[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name) {
      const parent = node.parent as ts.Node | undefined;
      if (parent && ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
        replacements.push({
          start: node.getStart(sf),
          end: node.getEnd(),
          text: `${name}: ${newName}`,
        });
      } else if (isReferencePosition(node, parent)) {
        replacements.push({ start: node.getStart(sf), end: node.getEnd(), text: newName });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return applyReplacements(source, replacements);
}

/** Parents whose `name` child is a KEY, not a reference to a binding. */
const NAME_IS_A_KEY_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.PropertyAccessExpression,
  ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.JsxAttribute,
  ts.SyntaxKind.PropertySignature,
  ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.EnumMember,
]);

function isReferencePosition(node: ts.Identifier, parent: ts.Node | undefined): boolean {
  if (!parent) return true;
  if (ts.isQualifiedName(parent)) return parent.right !== node;
  if (ts.isBindingElement(parent)) return parent.propertyName !== node;
  if (!NAME_IS_A_KEY_KINDS.has(parent.kind)) return true;
  return (parent as { name?: ts.Node }).name !== node;
}

// ------------------------------------------------------------ callsite edit

interface ImportStyle {
  readonly quote: string;
  readonly semi: boolean;
  readonly extension: string;
  /** Offset the new import statement is inserted at, and what follows it. */
  readonly insertAt: number;
  readonly leading: string;
  readonly trailing: string;
}

/** Match the file's own import spelling rather than imposing one — the fork's
 *  line should be indistinguishable from the ones already there. */
function importStyleOf(sf: ts.SourceFile, source: string): ImportStyle {
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const last = imports[imports.length - 1];
  const first = imports[0];
  let quote = "'";
  let extension = '';
  if (first) {
    const specifierStart = first.moduleSpecifier.getStart(sf);
    if (source[specifierStart] === '"') quote = '"';
  }
  for (const declaration of imports) {
    if (!ts.isStringLiteral(declaration.moduleSpecifier)) continue;
    const text = declaration.moduleSpecifier.text;
    if (!text.startsWith('.')) continue;
    const match = SOURCE_EXTENSION_RE.exec(text);
    if (match) extension = match[0];
    break;
  }
  const semi = last ? source.slice(0, last.getEnd()).trimEnd().endsWith(';') : true;
  if (last) {
    return { quote, semi, extension, insertAt: last.getEnd(), leading: '\n', trailing: '' };
  }
  // No imports at all: the file's very top is the only position that cannot
  // detach a doc comment from the statement it documents.
  return { quote, semi, extension, insertAt: 0, leading: '', trailing: '\n' };
}

function jsxAtOffset(
  sf: ts.SourceFile,
  offset: number,
): ts.JsxOpeningElement | ts.JsxSelfClosingElement | null {
  let found: ts.JsxOpeningElement | ts.JsxSelfClosingElement | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.getStart(sf) === offset
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}

// ------------------------------------------------------------------- the plan

/**
 * The refusals that need no parsing at all: what the tag IS, and where the
 * definition lives relative to the callsite.
 *
 * The same-file case is a real and deliberate limit. A component declared in the
 * world file itself cannot be forked by copying its module, because the copy
 * would carry the callsite too; extracting just the declaration is the selective
 * scope analysis this action refuses to grow. So it says so, and names the fix.
 */
function refusedByShape(tag: string, callsiteFile: string, definitionFile: string): string | null {
  if (!/^[A-Z]/.test(tag)) {
    return `<${tag}> is a native element, not a component instance — there is no definition to fork.`;
  }
  if (tag.includes('.')) {
    return `<${tag}> is a namespaced tag; fork can only copy a component declared as a plain module export.`;
  }
  if (normalizePath(callsiteFile) === normalizePath(definitionFile)) {
    return (
      `<${tag}> is declared in the same file as this callsite. Fork copies the component's whole ` +
      'module, and copying this file would duplicate the callsite too — move the component into ' +
      'its own module first.'
    );
  }
  return null;
}

/**
 * Plan a fork: parse both files, validate everything, and return the exact
 * bytes of BOTH edits. Nothing here writes; the caller writes the new file
 * first and the callsite second (see the route handler), so a failure after the
 * new file lands leaves an inert module nothing imports.
 */
export function planComponentFork(request: ForkComponentRequest): ForkComponentPlanResult {
  const { tag, callsiteFile, callsiteSource, definitionFile, definitionSource } = request;

  const shapeRefusal = refusedByShape(tag, callsiteFile, definitionFile);
  if (shapeRefusal) return refuse(shapeRefusal);

  const callsiteSf = parseAuthoringTsx(callsiteFile, callsiteSource);
  const definitionSf = parseAuthoringTsx(definitionFile, definitionSource);

  // The callsite must still BE the tag the menu was built from. An index that
  // is one edit stale would otherwise retarget an innocent neighbouring tag.
  const offset = lineColToOffset(callsiteSource, request.callsiteLine, request.callsiteCol);
  const opening = jsxAtOffset(callsiteSf, offset);
  if (!opening || opening.tagName.getText(callsiteSf) !== tag) {
    return refuse(
      `The callsite at ${callsiteFile}:${request.callsiteLine} is no longer <${tag}> — the source ` +
        'changed under the editor. Reselect the instance and try again.',
    );
  }

  const declaredName = resolveDeclaredName(definitionSf, callsiteSf, tag);
  const declaration = declaredName ? declarationOf(definitionSf, declaredName) : null;
  if (!declaredName || !declaration) {
    return refuse(
      `Could not find the declaration of <${tag}> in ${definitionFile}. Fork copies a component ` +
        'written as a function declaration or a const arrow function; this one is neither.',
    );
  }
  const exportForm = exportFormOf(definitionSf, declaredName, declaration);
  if (!exportForm) {
    return refuse(
      `<${tag}> is not exported from ${definitionFile}, so a forked copy could not be imported here.`,
    );
  }

  const siblings = request.siblingFiles ?? [];
  const taken = new Set<string>([
    ...topLevelNames(callsiteSf),
    ...topLevelNames(definitionSf),
    // H7's "any export of the target directory's modules you can cheaply
    // check": a module's basename is the proxy — this planner may not read a
    // directory, and reading every sibling's exports is not cheap.
    ...siblings.map((name) => name.replace(SOURCE_EXTENSION_RE, '')),
    tag,
    declaredName,
  ]);
  const newName = pickForkName(tag, request.nameSeed, taken);
  if (!newName) {
    return refuse(
      `Could not find a free name for a fork of <${tag}> — every candidate through ` +
        `${tag}Fork${MAX_FALLBACK_SUFFIX} is already taken.`,
    );
  }

  const newFileName = `${newName}.tsx`;
  const collision = siblings.find((name) => name.toLowerCase() === newFileName.toLowerCase());
  if (collision) {
    return refuse(
      `${siblingOf(definitionFile, collision)} already exists — fork will not overwrite a file.`,
    );
  }

  const newFile = siblingOf(definitionFile, newFileName);
  const newFileSource = renameComponentInModule(newFile, definitionSource, declaredName, newName);

  const style = importStyleOf(callsiteSf, callsiteSource);
  const importSpecifier = relativeImportSpecifier(callsiteFile, newFile);
  const clause = exportForm === 'default' ? newName : `{ ${newName} }`;
  const importText = `import ${clause} from ${style.quote}${importSpecifier}${style.quote}${
    style.semi ? ';' : ''
  }`;

  // The OLD import may now be unused. It is left alone ON PURPOSE: pruning an
  // import is lint's job (Biome reports it, and the same component may still be
  // used by another tag in this file), and a fork that silently deleted a line
  // it was not asked about would be a second, invisible edit.
  const replacements: Replacement[] = [
    {
      start: opening.tagName.getStart(callsiteSf),
      end: opening.tagName.getEnd(),
      text: newName,
    },
    {
      start: style.insertAt,
      end: style.insertAt,
      text: `${style.leading}${importText}${style.trailing}`,
    },
  ];
  const parent = opening.parent as ts.Node | undefined;
  if (parent && ts.isJsxElement(parent) && parent.openingElement === opening) {
    replacements.push({
      start: parent.closingElement.tagName.getStart(callsiteSf),
      end: parent.closingElement.tagName.getEnd(),
      text: newName,
    });
  }

  return {
    ok: true,
    plan: {
      newName,
      newFileName,
      newFile,
      newFileSource,
      callsiteFile,
      callsitePrevSource: callsiteSource,
      callsiteNewSource: applyReplacements(callsiteSource, replacements),
      importSpecifier,
      tag,
      historyLabel: `Fork ${tag} → ${newName}`,
    },
  };
}
