/**
 * Declared-prop resolution for a custom R3F component — what the inspector
 * shows for a `<Enemy …>` node.
 *
 * WHY THIS EXISTS. The inspector used to describe a node purely by the
 * attributes physically written in its JSX tag: a prop nobody typed was
 * invisible, and its widget was guessed from the raw attribute text, so
 * `variant="sharpshooter"` read as free text even though the component
 * declares a two-value union. That is backwards from every mainstream engine —
 * Unity/Godot/Unreal show a component's whole declared surface at its defaults
 * and treat the authored values as the subset you have overridden.
 *
 * HOW IT PARSES, and why not the way the neighbours do. Two different
 * questions need two different tools:
 *
 *   - WHICH props belong to this component is SYNTACTIC. It is the members the
 *     author literally wrote in the props type. `ThreeElements['group'] & {…}`
 *     contributes only the `{…}`; the forwarded native surface is hundreds of
 *     three.js props the author did not author. So this walks the type node's
 *     own AST and only descends into declarations that live in the project.
 *
 *   - WHAT TYPE each prop has is SEMANTIC, and is exactly the job of the
 *     TypeScript type checker. `variant: EnemyVariant` where
 *     `EnemyVariant = keyof typeof ENEMY_MODEL_PATHS` resolves to
 *     `'raider' | 'sharpshooter'` with no grammar written here at all.
 *
 * The sibling analysers in `oid-transform.ts` answer their (narrower) type
 * question by regexing `TypeNode.getText()`, which is why they only recognize
 * `ThreeElements['group']` spelled that one way. Do not copy that here: a
 * checker was always the right instrument for reading types, and this module
 * pays the one-time cost of a real program to get it.
 *
 * COST. A `ts.LanguageService` over the project's own tsconfig — ~1.7s and
 * ~2.4k files cold for a shipped example, then warm and incremental. It is
 * built lazily on the first inspector query and reused; only project files are
 * version-stamped, so an ordinary edit re-checks without a rebuild.
 *
 * SERVER-SIDE ONLY: this imports `typescript` and `node:fs` and is used from
 * `vite-plugin-ui-oid.ts`. The editor bundle receives the RESULT on the OID
 * index entry — it never parses TypeScript itself.
 */
import { statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import type { ComponentPropSpec } from '@volter/editor-sdk/source-authoring';

export type { ComponentPropSpec };

// ------------------------------------------------------------- declarations

/** The props parameter of a component declaration, however it is spelled. */
function componentParameterOf(declaration: ts.Declaration): ts.ParameterDeclaration | null {
  if (ts.isFunctionDeclaration(declaration)) return declaration.parameters[0] ?? null;
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    const init = declaration.initializer;
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
      return init.parameters[0] ?? null;
  }
  return null;
}

function componentParameter(
  sf: ts.SourceFile,
  componentName: string,
): ts.ParameterDeclaration | null {
  let found: ts.ParameterDeclaration | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    const name = ts.isFunctionDeclaration(node)
      ? node.name?.text
      : ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
        ? node.name.text
        : undefined;
    if (name === componentName) found = componentParameterOf(node as ts.Declaration);
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Any `<Tag …>` element in the file — a location the checker can resolve both
 *  the binding AND the accepted props from, without this module resolving
 *  modules or unwrapping component wrappers itself. */
function jsxTag(sf: ts.SourceFile, tagName: string): ts.JsxOpeningLikeElement | null {
  let found: ts.JsxOpeningLikeElement | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === tagName
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** The declaration a JSX tag identifier names, following import aliases. A
 *  barrel file is two hops (`import {Bot}` → `export {Bot} from './Bot'`), so
 *  unwrap until the symbol is the definition itself. */
function componentDeclaration(
  identifier: ts.JsxTagNameExpression,
  checker: ts.TypeChecker,
): ts.Declaration | null {
  let symbol = checker.getSymbolAtLocation(identifier);
  for (let hop = 0; symbol && symbol.flags & ts.SymbolFlags.Alias && hop < 8; hop += 1) {
    const next = checker.getAliasedSymbol(symbol);
    if (next === symbol) break;
    symbol = next;
  }
  return symbol?.valueDeclaration ?? symbol?.declarations?.[0] ?? null;
}

/** Fallback props type when the JSX attributes have no contextual type (a
 *  component the checker could not type). Reads the declaration's own
 *  parameter, which covers a plain function component. */
function contextlessPropsType(
  declaration: ts.Declaration,
  checker: ts.TypeChecker,
): ts.Type | null {
  const parameter = componentParameterOf(declaration);
  return parameter?.type ? checker.getTypeAtLocation(parameter.type) : null;
}

/**
 * Which package a declaration belongs to — the nearest `node_modules/<pkg>`
 * segment, or `PROJECT` for the project's own source. This is the unit of
 * "who owns this prop".
 */
const PROJECT = '(project)';
const NODE_MODULES_PKG_RE = /node_modules\/((?:@[^/]+\/)?[^/]+)\//;

function packageOfFile(fileName: string): string {
  return NODE_MODULES_PKG_RE.exec(fileName)?.[1] ?? PROJECT;
}

function packageOfDeclaration(node: ts.Node): string {
  return packageOfFile(node.getSourceFile().fileName);
}

/**
 * The props a component itself declares, as symbols.
 *
 * The checker resolves the whole props type — intersections, `extends`,
 * imported aliases, `Omit<…>`, forwardRef wrappers, anything — and then each
 * property is filtered by WHERE IT WAS DECLARED, against the package the
 * COMPONENT itself is defined in.
 *
 * That symmetry is the whole rule, and it reads correctly in both directions:
 *
 *   - `Enemy` lives in the project, so its own props are the project-declared
 *     ones. The ~86 members arriving from `ThreeElements['group']` are the
 *     FORWARDED native surface — three.js', not the author's config.
 *   - `RigidBody` lives in `@react-three/rapier`, so ITS own props are rapier's
 *     48 (`type`, `gravityScale`, `ccd`, …). A library component used as a tag
 *     is configured entirely through the props its own package declares.
 *   - `PerspectiveCamera` lives in `@react-three/drei`, and the rule yields
 *     exactly drei's six additions (`makeDefault`, `manual`, `frames`, …) over
 *     the three.js camera surface it forwards.
 *
 * Filtering on declaration site rather than on the shape of the written type
 * expression is what makes this robust: there is no grammar of "ways to spell a
 * props type" to keep up with.
 */
function ownProps(
  propsType: ts.Type,
  homePackage: string,
): Array<{ symbol: ts.Symbol; declaration: ts.Declaration }> {
  const own: Array<{ symbol: ts.Symbol; declaration: ts.Declaration }> = [];
  for (const symbol of propsType.getProperties()) {
    // ANY home-package declaration counts. A prop the author redeclares over
    // the forwarded surface (`name: string` alongside `ThreeElements['group']`)
    // has two declarations, and the library's may well come first.
    const declaration = symbol.declarations?.find(
      (candidate) => packageOfDeclaration(candidate) === homePackage,
    );
    if (declaration) own.push({ symbol, declaration });
  }
  return own;
}

// ------------------------------------------------------------------ widgets

/** Map a checked type onto an inspector widget, or null when none is honest. */
function widgetForType(
  type: ts.Type,
  checker: ts.TypeChecker,
): { type: ComponentPropSpec['type']; options?: Array<string | number> } {
  const bare = checker.getNonNullableType(type);
  // `boolean` is itself the union `true | false` — settle it before unions.
  if (bare.flags & ts.TypeFlags.BooleanLike) return { type: 'boolean' };
  if (bare.isUnion()) {
    const members = bare.types.filter((member) => !(member.flags & ts.TypeFlags.Undefined));
    if (members.length && members.every((member) => member.isStringLiteral())) {
      return {
        type: 'enum',
        options: members.map((member) => (member as ts.StringLiteralType).value),
      };
    }
    if (members.length && members.every((member) => member.isNumberLiteral())) {
      return {
        type: 'enum',
        options: members.map((member) => (member as ts.NumberLiteralType).value),
      };
    }
    if (members.length === 1) return widgetForType(members[0]!, checker);
    // A mixed union has no single widget that tells the truth about it.
    return { type: null };
  }
  if (bare.flags & ts.TypeFlags.StringLike) return { type: 'string' };
  if (bare.flags & ts.TypeFlags.NumberLike) return { type: 'number' };
  const sequenceLength = numericSequenceLength(bare, checker);
  if (sequenceLength === 3) return { type: 'vec3' };
  if (sequenceLength !== null) return { type: 'json' };
  return { type: null };
}

/** Tuple length, or -1 for an open numeric array; null when not numeric. */
function numericSequenceLength(type: ts.Type, checker: ts.TypeChecker): number | null {
  const isNumeric = (member: ts.Type): boolean =>
    Boolean(checker.getNonNullableType(member).flags & ts.TypeFlags.NumberLike);
  if (checker.isTupleType(type)) {
    const args = checker.getTypeArguments(type as ts.TypeReference);
    return args.length > 0 && args.every(isNumeric) ? args.length : null;
  }
  if (checker.isArrayType(type)) {
    const element = checker.getTypeArguments(type as ts.TypeReference)[0];
    return element && isNumeric(element) ? -1 : null;
  }
  return null;
}

// ----------------------------------------------------------------- defaults

/** The literal a default initializer denotes, or undefined when it is an
 *  expression (a call, arithmetic, an identifier) with no static value. */
function literalValue(node: ts.Expression): ComponentPropSpec['defaultValue'] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const operand = literalValue(node.operand);
    return typeof operand === 'number' ? -operand : undefined;
  }
  if (ts.isArrayLiteralExpression(node)) {
    const values = node.elements.map(literalValue);
    return values.every((value) => typeof value === 'number') ? (values as number[]) : undefined;
  }
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node))
    return literalValue(node.expression);
  return undefined;
}

interface Destructuring {
  /** Prop names in the order the component destructures them. */
  order: string[];
  defaults: Map<string, ts.Expression>;
}

function destructuring(parameter: ts.ParameterDeclaration, sf: ts.SourceFile): Destructuring {
  const order: string[] = [];
  const defaults = new Map<string, ts.Expression>();
  if (!ts.isObjectBindingPattern(parameter.name)) return { order, defaults };
  for (const element of parameter.name.elements) {
    if (element.dotDotDotToken) continue;
    const name = element.propertyName?.getText(sf) ?? element.name.getText(sf);
    order.push(name);
    if (element.initializer) defaults.set(name, element.initializer);
  }
  return { order, defaults };
}

function docOf(symbol: ts.Symbol, checker: ts.TypeChecker): string | undefined {
  const prose = ts
    .displayPartsToString(symbol.getDocumentationComment(checker))
    .replace(/\s+/g, ' ')
    .trim();
  return prose || undefined;
}

function declaredSpec(
  symbol: ts.Symbol,
  declaration: ts.Declaration,
  checker: ts.TypeChecker,
  defaults: ReadonlyMap<string, ts.Expression>,
): ComponentPropSpec {
  const name = symbol.getName();
  const widget = widgetForType(checker.getTypeOfSymbolAtLocation(symbol, declaration), checker);
  const doc = docOf(symbol, checker);
  return {
    name,
    type: widget.type,
    ...(widget.options ? { options: widget.options } : {}),
    optional: Boolean(symbol.flags & ts.SymbolFlags.Optional) || defaults.has(name),
    ...(doc ? { doc } : {}),
  };
}

function withDefault(
  spec: ComponentPropSpec,
  initializer: ts.Expression | undefined,
  sf: ts.SourceFile,
): ComponentPropSpec {
  if (!initializer) return spec;
  const value = literalValue(initializer);
  return {
    ...spec,
    defaultText: initializer.getText(sf),
    ...(value === undefined ? {} : { defaultValue: value }),
  };
}

/** Destructured props first, in the order the component itself reads them —
 *  that ordering is the author's own emphasis, and matches the source. */
function orderedByDestructuring(
  specs: Map<string, ComponentPropSpec>,
  order: readonly string[],
): ComponentPropSpec[] {
  const ordered: ComponentPropSpec[] = [];
  for (const name of order) {
    const spec = specs.get(name);
    if (spec) {
      ordered.push(spec);
      specs.delete(name);
    }
  }
  return [...ordered, ...specs.values()];
}

// ---------------------------------------------------------------- resolver

/**
 * A reusable TypeScript program over one project, answering "what props does
 * this component declare?". Build one per project root and keep it — the cold
 * program is the expensive part, subsequent queries are incremental.
 */
export class ComponentPropResolver {
  private readonly service: ts.LanguageService;
  private readonly rootFiles: string[];
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json');
    const parsed = configPath
      ? ts.parseJsonConfigFileContent(
          ts.readConfigFile(configPath, ts.sys.readFile).config,
          ts.sys,
          dirname(configPath),
        )
      : { fileNames: [], options: {} as ts.CompilerOptions };
    this.rootFiles = parsed.fileNames;
    const options: ts.CompilerOptions = {
      ...parsed.options,
      // Types are all this asks for; emitting or reporting errors is not its job.
      noEmit: true,
      skipLibCheck: true,
      jsx: parsed.options.jsx ?? ts.JsxEmit.ReactJSX,
    };
    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => this.rootFiles,
      getScriptVersion: (fileName) => this.versionOf(fileName),
      getScriptSnapshot: (fileName) => {
        const text = ts.sys.readFile(fileName);
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
      },
      getCurrentDirectory: () => projectRoot,
      getCompilationSettings: () => options,
      getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
      ...(ts.sys.realpath ? { realpath: ts.sys.realpath } : {}),
    };
    this.service = ts.createLanguageService(host, ts.createDocumentRegistry());
  }

  /** Only project sources are re-stamped: a dependency's `.d.ts` does not
   *  change under a running editor, and stat-ing thousands of them per query
   *  would cost more than the answer is worth. */
  private versionOf(fileName: string): string {
    if (fileName.includes('/node_modules/')) return '1';
    if (!fileName.startsWith(this.projectRoot)) return '1';
    try {
      return String(statSync(fileName).mtimeMs);
    } catch {
      return '0';
    }
  }

  /** Make a file known to the program even if the tsconfig did not list it. */
  private ensureRoot(file: string): void {
    const absolute = resolve(this.projectRoot, file);
    if (!this.rootFiles.includes(absolute)) this.rootFiles.push(absolute);
  }

  /**
   * The props `componentName` declares, as defined in `file`. Returns an empty
   * list when the component or its props type cannot be found — never a guess.
   */
  propsFor(file: string, componentName: string): ComponentPropSpec[] {
    const context = this.context(file);
    if (!context) return [];
    const parameter = componentParameter(context.sf, componentName);
    if (!parameter?.type) return [];
    return this.specsFor(
      context.checker.getTypeAtLocation(parameter.type),
      packageOfDeclaration(parameter),
      parameter,
      context.checker,
    );
  }

  /**
   * The props behind a JSX tag USED in `callsiteFile` — `<Enemy …>` in a world
   * whose `Enemy` is imported from anywhere. The tag identifier is resolved
   * through the checker, so aliased imports, re-exports and barrel files all
   * land on the real definition without a module-resolution guess here.
   */
  propsForTag(callsiteFile: string, tagName: string): ComponentPropSpec[] {
    const context = this.context(callsiteFile);
    if (!context) return [];
    const tag = jsxTag(context.sf, tagName);
    if (!tag) return [];
    const declaration = componentDeclaration(tag.tagName, context.checker);
    if (!declaration) return [];
    // The props a TAG accepts, asked of the element itself. This is what makes
    // `forwardRef`/`memo` components work: `<RigidBody>` is a
    // `ForwardRefExoticComponent` value with no parameter to read, but the JSX
    // attributes still have a contextual type.
    const propsType =
      context.checker.getContextualType(tag.attributes) ??
      contextlessPropsType(declaration, context.checker);
    if (!propsType) return [];
    // Defaults live in the destructuring, so they are only available when the
    // definition is an ordinary function we can see the parameter of.
    const parameter = componentParameterOf(declaration);
    return this.specsFor(propsType, packageOfDeclaration(declaration), parameter, context.checker);
  }

  private context(file: string): { sf: ts.SourceFile; checker: ts.TypeChecker } | null {
    this.ensureRoot(file);
    const program = this.service.getProgram();
    const sf = program?.getSourceFile(resolve(this.projectRoot, file));
    return program && sf ? { sf, checker: program.getTypeChecker() } : null;
  }

  private specsFor(
    propsType: ts.Type,
    homePackage: string,
    parameter: ts.ParameterDeclaration | null,
    checker: ts.TypeChecker,
  ): ComponentPropSpec[] {
    const sf = parameter?.getSourceFile();
    const { order, defaults } = parameter
      ? destructuring(parameter, parameter.getSourceFile())
      : { order: [] as string[], defaults: new Map<string, ts.Expression>() };

    const specs = new Map<string, ComponentPropSpec>();
    for (const { symbol, declaration } of ownProps(propsType, homePackage)) {
      specs.set(symbol.getName(), declaredSpec(symbol, declaration, checker, defaults));
    }
    // A prop the component DESTRUCTURES is a prop it reads, whatever package
    // its type was declared in — so membership is settled and only the type is
    // left, which is the checker's job (this module's own split, see the
    // header). `ownProps`' package filter answers "which of the hundreds of
    // FORWARDED members did this author write?"; it must not also decide
    // whether a prop the author literally named has a knowable type.
    //
    // MEASURED on the racing ingest: `<Physics allowSleep broadphase
    // defaultContactMaterial>` and `<Vehicle angularVelocity>` are all read by
    // their component's own destructuring while being declared in
    // `@pmndrs/cannon-worker-api` — a different package from the component's
    // — so every one arrived typeless and the inspector fell through to
    // guessing the widget from the attribute TEXT (`allowSleep` → `boolean` by
    // luck; `broadphase` → free-text `string` where the declaration is a
    // two-value union; `angularVelocity` → `string` where it is a Triplet).
    //
    // `getTypeOfSymbol`, not `getTypeOfSymbolAtLocation`: a `Pick<>`-mapped
    // member has NO declaration to pass as the location (measured — `Vehicle`'s
    // `angularVelocity` reports `declarations.length === 0`), which is also why
    // `declaredSpec` cannot be reused here. A prop with no reachable type stays
    // `null`, and the inspector's loud text-guess fallback still covers it.
    for (const name of order) {
      if (specs.has(name)) continue;
      const symbol = propsType.getProperty(name);
      if (!symbol) {
        specs.set(name, { name, type: null, optional: defaults.has(name) });
        continue;
      }
      const widget = widgetForType(checker.getTypeOfSymbol(symbol), checker);
      const doc = docOf(symbol, checker);
      specs.set(name, {
        name,
        type: widget.type,
        ...(widget.options ? { options: widget.options } : {}),
        optional: Boolean(symbol.flags & ts.SymbolFlags.Optional) || defaults.has(name),
        ...(doc ? { doc } : {}),
      });
    }
    if (sf) {
      for (const [name, spec] of specs) specs.set(name, withDefault(spec, defaults.get(name), sf));
    }
    return orderedByDestructuring(specs, order);
  }

  dispose(): void {
    this.service.dispose();
  }
}
