/**
 * The project-contract RESOLVER, host-neutral: how one module's relative
 * imports are followed to the component contracts and prop-shape type aliases
 * they bring into scope. Pure TypeScript AST work over a {@link ContractHost}
 * that supplies the three things a file system used to — read a file, test
 * for one, join a relative specifier — so the walk itself is independent of
 * WHERE the sources are read from. The dev server supplies them with
 * `node:fs` and a stamp-checked cache (`r3f-project-contracts.ts`); any other
 * reader supplies its own, and gets the same contracts rather than a second
 * answer ("HeroBox does not expose a scale prop" while the dev server wrote
 * it — one editor, two answers — is what this split exists to prevent).
 */

import ts from 'typescript';
import {
  analyzeR3fComponentContracts,
  builtinR3fContractsOfImport,
  type ComponentPropSpec,
  exportedR3fTypeAliases,
  type R3fComponentContract,
  type R3fTypeAlias,
} from './oid-transform';
import { localComponentPropSpecs } from './syntactic-prop-specs';
import { hasModifier, parseAuthoringTsx } from './ts-ast';

export interface ModuleAnalysis {
  visible: Map<string, R3fComponentContract>;
  exported: Map<string, R3fComponentContract>;
  /** This module's own `export type X = …` declarations, for its importers. */
  exportedTypeAliases: Map<string, R3fTypeAlias>;
  /** Syntactic declared-prop specs per exported component
   *  (`syntactic-prop-specs.ts`) — the checker-free surface attached to OID
   *  entries so override detection and Apply-to-Component gate on facts
   *  instead of an absent `ts.Program`. */
  exportedProps: Map<string, ComponentPropSpec[]>;
}

export const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'] as const;

/** What a resolver needs from its host. Paths are whatever vocabulary the host
 *  speaks (absolute on the server, project-relative in storage); the resolver
 *  only passes them back. */
export interface ContractHost {
  /** The file's text, or null when it cannot be read. */
  read(file: string): string | null;
  exists(file: string): boolean;
  /** `dirname(fromFile)` joined with a relative specifier, normalized. */
  resolve(fromFile: string, specifier: string): string;
  extname(file: string): string;
  /** `<base>/<name>` — the `index.*` candidate under a directory specifier. */
  join(base: string, name: string): string;
  /** Optional shared cache around one file's analysis (the server's
   *  stamp-checked map). Called with a thunk so the host decides whether to
   *  run it; a host without one analyzes every time within one resolver. */
  analyzeFileCached?(file: string, analyze: () => ModuleAnalysis): ModuleAnalysis;
}

function resolveRelativeModule(
  host: ContractHost,
  fromFile: string,
  specifier: string,
): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = host.resolve(fromFile, specifier);
  const candidates = host.extname(base)
    ? [base]
    : [
        ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
        ...SOURCE_EXTENSIONS.map((extension) => host.join(base, `index${extension}`)),
      ];
  return candidates.find((candidate) => host.exists(candidate)) ?? null;
}

/** The project-local module a `import { … } from './x'` statement names, with
 *  its binding elements — or null when the statement is not one of those. */
function relativeNamedImport(
  host: ContractHost,
  statement: ts.Statement,
  file: string,
): { target: string; elements: readonly ts.ImportSpecifier[] } | null {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
    return null;
  }
  const target = resolveRelativeModule(host, file, statement.moduleSpecifier.text);
  const bindings = statement.importClause?.namedBindings;
  if (!target || !bindings || !ts.isNamedImports(bindings)) return null;
  return { target, elements: bindings.elements };
}

export class ProjectContractResolver {
  private readonly cache = new Map<string, ModuleAnalysis>();
  private readonly visiting = new Set<string>();

  constructor(private readonly host: ContractHost) {}

  importedForSource(code: string, file: string): Map<string, R3fComponentContract> {
    return this.importedBindings(parseAuthoringTsx(file, code), file);
  }

  typeAliasesForSource(code: string, file: string): Map<string, R3fTypeAlias> {
    return this.importedTypeAliases(parseAuthoringTsx(file, code), file);
  }

  /**
   * Declared-prop specs for every component a file's JSX can name — its own
   * top-level components plus its relative imports (a local declaration
   * shadows an import, the language's own rule). This is what the hosted
   * stamping hook attaches to OID entries in place of the dev server's
   * checker-resolved specs.
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one bounded import-declaration pass, the same dispatch importedBindings carries.
  propSpecsForSource(code: string, file: string): Map<string, ComponentPropSpec[]> {
    const sf = parseAuthoringTsx(file, code);
    const specs = new Map<string, ComponentPropSpec[]>();
    for (const statement of sf.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !statement.importClause
      ) {
        continue;
      }
      const target = resolveRelativeModule(this.host, file, statement.moduleSpecifier.text);
      if (!target) continue;
      const exported = this.analyzeFile(target).exportedProps;
      const defaultName = statement.importClause.name?.text;
      const defaultSpecs = exported.get('default');
      if (defaultName && defaultSpecs) specs.set(defaultName, defaultSpecs);
      const bindings = statement.importClause.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const element of bindings.elements) {
        const imported = exported.get(element.propertyName?.text ?? element.name.text);
        if (imported) specs.set(element.name.text, imported);
      }
    }
    for (const [name, local] of localComponentPropSpecs(sf, this.importedTypeAliases(sf, file))) {
      specs.set(name, local);
    }
    return specs;
  }

  analyzeSource(code: string, file: string): ModuleAnalysis {
    const sf = parseAuthoringTsx(file, code);
    const imported = this.importedBindings(sf, file);
    // `analyzeR3fComponentContracts` re-parses `code`, so the aliases below
    // must be resolved against the file each was WRITTEN in, not against this
    // one — that pairing is what `R3fTypeAlias` carries.
    const visible = analyzeR3fComponentContracts(
      code,
      file,
      imported,
      this.importedTypeAliases(sf, file),
    );
    const props = localComponentPropSpecs(sf, this.importedTypeAliases(sf, file));
    return {
      visible,
      exported: this.exportsOf(sf, file, visible, (target) => this.analyzeFile(target).exported),
      exportedTypeAliases: exportedR3fTypeAliases(sf),
      exportedProps: this.exportsOf(
        sf,
        file,
        props,
        (target) => this.analyzeFile(target).exportedProps,
      ),
    };
  }

  private analyzeFile(file: string): ModuleAnalysis {
    const cached = this.cache.get(file);
    if (cached) return cached;
    if (this.visiting.has(file)) {
      return {
        visible: new Map(),
        exported: new Map(),
        exportedTypeAliases: new Map(),
        exportedProps: new Map(),
      };
    }
    this.visiting.add(file);
    try {
      const analyze = (): ModuleAnalysis => {
        const source = this.host.read(file);
        return source === null
          ? {
              visible: new Map(),
              exported: new Map(),
              exportedTypeAliases: new Map(),
              exportedProps: new Map(),
            }
          : this.analyzeSource(source, file);
      };
      const analysis = this.host.analyzeFileCached
        ? this.host.analyzeFileCached(file, analyze)
        : analyze();
      this.cache.set(file, analysis);
      return analysis;
    } finally {
      this.visiting.delete(file);
    }
  }

  /**
   * The prop-shape type aliases one module imports, under their local names.
   *
   * The component-contract walk above already follows relative imports; this
   * is the same walk for the OTHER thing a shared module exports. Without it,
   * `typeAllowsStandardRootProps` stopped at the file boundary, so a project
   * that declares its canonical prop shape once — the thing the authoring
   * convention is asking for — read as forwarding nothing, and every prefab
   * annotated with it drew a permanent R3F002 telling it to do what it was
   * already doing.
   *
   * Only relative specifiers resolve. An installed package's `.d.ts` is not
   * source this walk can trust, and the built-in prop-type table is how a
   * package surface earns recognition instead.
   */
  private importedTypeAliases(sf: ts.SourceFile, file: string): Map<string, R3fTypeAlias> {
    const aliases = new Map<string, R3fTypeAlias>();
    for (const statement of sf.statements) {
      const named = relativeNamedImport(this.host, statement, file);
      if (!named) continue;
      const exported = this.analyzeFile(named.target).exportedTypeAliases;
      for (const element of named.elements) {
        const alias = exported.get(element.propertyName?.text ?? element.name.text);
        if (alias) aliases.set(element.name.text, alias);
      }
    }
    return aliases;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one bounded import-declaration pass keeps alias/default/named binding resolution together.
  private importedBindings(sf: ts.SourceFile, file: string): Map<string, R3fComponentContract> {
    const imported = new Map<string, R3fComponentContract>();
    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      const target = resolveRelativeModule(this.host, file, statement.moduleSpecifier.text);
      if (!target) {
        // An installed package has no source here to walk. It contributes a
        // contract only when the hand-audited built-in table names it; every
        // other external binding stays conservative.
        for (const [name, contract] of builtinR3fContractsOfImport(statement)) {
          imported.set(name, contract);
        }
        continue;
      }
      if (!statement.importClause) continue;
      const exported = this.analyzeFile(target).exported;
      const defaultName = statement.importClause.name?.text;
      const defaultContract = exported.get('default');
      if (defaultName && defaultContract) imported.set(defaultName, defaultContract);
      const bindings = statement.importClause.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const element of bindings.elements) {
        const contract = exported.get(element.propertyName?.text ?? element.name.text);
        if (contract) imported.set(element.name.text, contract);
      }
    }
    return imported;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this is a bounded TypeScript export-syntax dispatcher, not application control flow.
  private exportsOf<T>(
    sf: ts.SourceFile,
    file: string,
    visible: ReadonlyMap<string, T>,
    moduleExports: (target: string) => ReadonlyMap<string, T>,
  ): Map<string, T> {
    const exported = new Map<string, T>();
    for (const statement of sf.statements) {
      if (
        (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
        statement.name &&
        hasModifier(statement, ts.SyntaxKind.ExportKeyword)
      ) {
        const contract = visible.get(statement.name.text);
        if (contract) {
          exported.set(
            hasModifier(statement, ts.SyntaxKind.DefaultKeyword) ? 'default' : statement.name.text,
            contract,
          );
        }
      }
      if (
        ts.isVariableStatement(statement) &&
        hasModifier(statement, ts.SyntaxKind.ExportKeyword)
      ) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name)) continue;
          const contract = visible.get(declaration.name.text);
          if (contract) exported.set(declaration.name.text, contract);
        }
      }
      if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
        const contract = visible.get(statement.expression.text);
        if (contract) exported.set('default', contract);
      }
      if (!ts.isExportDeclaration(statement)) continue;
      const target =
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? resolveRelativeModule(this.host, file, statement.moduleSpecifier.text)
          : null;
      // A BARREL (`export * from './Ramp'`) re-exports every name, and dropping
      // it dropped the whole contract: racing-game reaches every one of its
      // components through `src/models/index.ts`, so `<Ramp/>`, `<Train/>` and
      // `<Vehicle/>` all read as "definition not in this file" and refused
      // every transform write at their callsites. `export *` skips `default` by
      // the language's own rule.
      if (!statement.exportClause) {
        if (!target) continue;
        for (const [name, contract] of moduleExports(target)) {
          if (name !== 'default') exported.set(name, contract);
        }
        continue;
      }
      const sourceContracts = target ? moduleExports(target) : visible;
      if (!ts.isNamedExports(statement.exportClause)) continue;
      for (const element of statement.exportClause.elements) {
        const sourceName = element.propertyName?.text ?? element.name.text;
        const contract = sourceContracts.get(sourceName);
        if (contract) exported.set(element.name.text, contract);
      }
    }
    return exported;
  }
}
