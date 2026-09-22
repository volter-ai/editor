/**
 * Serve-time rewrite of an entrypoint's swap-slot key.
 *
 * The scenes finder (`adapter/finders/scenes-from-entrypoint-selection.ts`)
 * READS the same facts this module WRITES: a module-level `const <selection>
 * = { … }` table, indexed by one identifier whose own module-level `const`
 * is a string literal (`const activeScene = 'main'`). This is not an
 * extraction of that finder — the finder stays the adapter-selected discovery
 * algorithm, import-banned everywhere except the adapter loader. The rewrite
 * is a host-owned mount parameter: play remounts the same entrypoint with a
 * different declared key, without a new adapter slot and without mutating
 * the file on disk.
 *
 * `typescript` is the same parser the finder already uses. This module is
 * host-side only — a game's `vgai.adapter.ts` must not import it.
 */

import ts from 'typescript';
import { indexingIdentifier, propertyKey, selectionTable } from './entrypoint-selection-readers';

export type EntrypointSelectionRewrite =
  | { readonly ok: true; readonly source: string; readonly changed: boolean }
  | { readonly ok: false; readonly reason: string };

function parse(path: string, source: string): ts.SourceFile {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function tableKeys(table: ts.ObjectLiteralExpression): string[] {
  const keys: string[] = [];
  for (const property of table.properties) {
    const key = propertyKey(property);
    if (key !== undefined) keys.push(key);
  }
  return keys;
}

function moduleLevelStringLiteral(sf: ts.SourceFile, name: string): ts.StringLiteral | undefined {
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      const initializer = declaration.initializer;
      if (initializer && ts.isStringLiteral(initializer)) return initializer;
      return undefined;
    }
  }
  return undefined;
}

/**
 * Rewrite the entrypoint so its swap slot mounts `key` instead of the
 * source-declared occupant.
 *
 * Fails (never guesses) when the source is not the template's shape: no
 * table, a key the table does not declare, or an index that is not a
 * module-level `const` string. A no-op rewrite (`key` already at the slot)
 * is still `ok` — remounting the same key is a real restart.
 */
export function rewriteEntrypointSelectionKey(
  source: string,
  path: string,
  selection: string,
  key: string,
): EntrypointSelectionRewrite {
  const sf = parse(path, source);
  const table = selectionTable(sf, selection);
  if (!table) {
    return {
      ok: false,
      reason:
        `${path} declares no module-level \`const ${selection} = { … }\` selection table, ` +
        'so the host cannot remount it at another key.',
    };
  }
  const keys = tableKeys(table);
  if (!keys.includes(key)) {
    return {
      ok: false,
      reason:
        `"${key}" is not a key of ${path}'s \`${selection}\` table ` +
        `(known: ${keys.length > 0 ? keys.join(', ') : 'none'}).`,
    };
  }
  const identifier = indexingIdentifier(sf, selection);
  if (identifier === undefined) {
    return {
      ok: false,
      reason: `${path} never indexes \`${selection}\`, so there is no slot key to rewrite.`,
    };
  }
  if (identifier === null) {
    return {
      ok: false,
      reason:
        `${path} indexes \`${selection}\` with something other than one single identifier, ` +
        'so the host cannot rewrite the key it mounts.',
    };
  }
  const literal = moduleLevelStringLiteral(sf, identifier);
  if (!literal) {
    return {
      ok: false,
      reason:
        `${path} indexes \`${selection}\` with \`${identifier}\`, which is not a ` +
        'module-level `const` bound to a string literal — the running game cannot be ' +
        'sent to another key by rewriting the slot.',
    };
  }
  if (literal.text === key) return { ok: true, source, changed: false };
  const start = literal.getStart(sf);
  const end = literal.getEnd();
  const quote = source[start] ?? "'";
  return {
    ok: true,
    source: `${source.slice(0, start)}${quote}${key}${quote}${source.slice(end)}`,
    changed: true,
  };
}
