/**
 * `ensureNamedImport` — make a named import available in a module, idempotently.
 *
 * Why this is not in `writer.ts`: that file is deliberately parser-free ("pure
 * string ops", see its header), and an import list is the one region of a source
 * file where a scan-based guess is genuinely unsafe — a string, a comment, or a
 * type-only clause all look like the thing being matched. This is a real parse.
 *
 * The one caller is the `create`/`create-sibling` struct op
 * (`plan-source-edit.ts`): an inserted element whose tag is a COMPONENT is broken
 * source until its import exists, so the import rides the same plan (and therefore
 * the same single history transaction) as the insert itself.
 */

import * as ts from 'typescript';
import { parseAuthoringTsx } from './ts-ast';
import type { StructEditResult } from './writer';

/** Insert `name` into the module's named imports from `moduleSpecifier`, adding
 *  the whole import statement when the module is not imported yet. Already
 *  present ⇒ `changed: false` with the code untouched (the idempotent case every
 *  drop after the first takes). */
export function ensureNamedImport(
  code: string,
  name: string,
  moduleSpecifier: string,
): StructEditResult {
  const sf = parseAuthoringTsx('module.tsx', code);
  const imports = sf.statements.filter(ts.isImportDeclaration);

  for (const declaration of imports) {
    if (!ts.isStringLiteral(declaration.moduleSpecifier)) continue;
    if (declaration.moduleSpecifier.text !== moduleSpecifier) continue;
    // A type-only import of the same module cannot host a VALUE import; leave it
    // alone and let the new-statement path below add a separate one.
    if (declaration.importClause?.isTypeOnly) continue;
    const bindings = declaration.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    if (bindings.elements.some((element) => element.name.text === name)) {
      return { code, changed: false };
    }
    // Keep the clause alphabetical — the order every formatter in this repo's
    // toolchain writes, so an inserted name does not read as a stray.
    const after = bindings.elements.find((element) => element.name.text > name);
    if (after) {
      const at = after.getStart(sf);
      return { code: `${code.slice(0, at)}${name}, ${code.slice(at)}`, changed: true };
    }
    const last = bindings.elements[bindings.elements.length - 1];
    const at = last ? last.getEnd() : bindings.getEnd() - 1;
    const separator = last ? ', ' : '';
    return { code: `${code.slice(0, at)}${separator}${name}${code.slice(at)}`, changed: true };
  }

  const statement = `import { ${name} } from ${quoteOf(sf, code)}${moduleSpecifier}${quoteOf(sf, code)}${semicolonOf(imports, code)}`;
  const lastImport = imports[imports.length - 1];
  if (!lastImport) return { code: `${statement}\n${code}`, changed: true };
  const at = lastImport.getEnd();
  return { code: `${code.slice(0, at)}\n${statement}${code.slice(at)}`, changed: true };
}

/** Ensure either ecosystem-native import spelling. Component discovery knows
 * whether a project component is a default or named export; preserving that
 * fact avoids inventing a registry or wrapper merely to place it. */
export function ensureValueImport(
  code: string,
  name: string,
  moduleSpecifier: string,
  kind: 'default' | 'named' = 'named',
): StructEditResult {
  if (kind === 'named') return ensureNamedImport(code, name, moduleSpecifier);
  const sf = parseAuthoringTsx('module.tsx', code);
  const imports = sf.statements.filter(ts.isImportDeclaration);
  for (const declaration of imports) {
    if (!importsFrom(declaration, moduleSpecifier)) continue;
    const defaultBinding = defaultBindingStatus(declaration.importClause, name);
    if (defaultBinding === 'same') return { code, changed: false };
    // A module may have only one default binding per import declaration. If
    // this file already chose another local name, import the same ecosystem
    // value through standard ESM's named-default spelling instead of emitting
    // a second default clause.
    if (defaultBinding === 'different') {
      const statement = `import { default as ${name} } from ${quoteOf(sf, code)}${moduleSpecifier}${quoteOf(sf, code)}${semicolonOf(imports, code)}`;
      const at = declaration.getEnd();
      return { code: `${code.slice(0, at)}\n${statement}${code.slice(at)}`, changed: true };
    }
  }
  const statement = `import ${name} from ${quoteOf(sf, code)}${moduleSpecifier}${quoteOf(sf, code)}${semicolonOf(imports, code)}`;
  const lastImport = imports[imports.length - 1];
  if (!lastImport) return { code: `${statement}\n${code}`, changed: true };
  const at = lastImport.getEnd();
  return { code: `${code.slice(0, at)}\n${statement}${code.slice(at)}`, changed: true };
}

function importsFrom(declaration: ts.ImportDeclaration, moduleSpecifier: string): boolean {
  return (
    ts.isStringLiteral(declaration.moduleSpecifier) &&
    declaration.moduleSpecifier.text === moduleSpecifier
  );
}

function defaultBindingStatus(
  clause: ts.ImportClause | undefined,
  name: string,
): 'same' | 'different' | 'absent' {
  if (!clause || clause.isTypeOnly) return 'absent';
  if (clause.name?.text === name) return 'same';
  const named = clause.namedBindings;
  if (
    named &&
    ts.isNamedImports(named) &&
    named.elements.some(
      (element) => element.propertyName?.text === 'default' && element.name.text === name,
    )
  ) {
    return 'same';
  }
  return clause.name ? 'different' : 'absent';
}

/** Match the file's own import spelling rather than imposing one. */
function quoteOf(sf: ts.SourceFile, code: string): string {
  const first = sf.statements.find(ts.isImportDeclaration);
  if (!first) return "'";
  return code[first.moduleSpecifier.getStart(sf)] === '"' ? '"' : "'";
}

function semicolonOf(imports: readonly ts.ImportDeclaration[], code: string): string {
  const last = imports[imports.length - 1];
  if (!last) return ';';
  return code.slice(0, last.getEnd()).trimEnd().endsWith(';') ? ';' : '';
}
