/**
 * Merge declared region `include` globs into a project's own `vgai.adapter.ts`.
 *
 * WHY THIS EXISTS (measured on a cold fox run, 2026-08-29). `vgai add mesh`
 * copies `src/lib/mesh/ground-projection.tsx` — a real R3F component — into the
 * project, and a fresh project's console then went RED at boot:
 *
 *   [ui-oid] OID001: …/src/lib/mesh/ground-projection.tsx is inside the project
 *   … but no region reaches it and none declares it … Declaring this file is
 *   not optional cleanup — the running game breaks without it.
 *
 * The diagnostic is right, and the repair it names is a DECLARATION in
 * `vgai.adapter.ts`. Nothing performed that declaration: the template's adapter
 * hand-lists `src/lib/reflections/**` and `src/lib/static-batch/**` because
 * someone typed them, and every capability added afterwards was a fresh silent
 * gap. This is the same defect `assetPacks` already closed on the binary side —
 * a capability's SOURCE can be copied, but the declaration that makes the copy
 * work cannot ride in `files` — so it gets the same answer: the catalog entry
 * declares it, `addCapabilities` merges it into the project's own file.
 *
 * WHY A TEXT SPLICE AND NOT A REWRITE. `vgai.adapter.ts` is project-owned
 * source with the project's comments in it, and the adapter contract requires
 * its top level to stay a STATICALLY EVALUABLE binding table
 * (`@volter/editor-project/adapter/adapter-module`). So this locates the exact array with the
 * TypeScript AST — the same read `packages/editor/src/ui-source/
 * adapter-region-includes.ts` performs — and inserts the missing string
 * literals there, touching nothing else. Anything it cannot locate literally is
 * reported as `unreadable`, never guessed at: a silently dropped declaration is
 * indistinguishable from one that worked, which is the failure class the whole
 * region lane exists to end.
 *
 * ADD-ONLY and idempotent, like every other capability merge: a glob the
 * project already declares is left exactly as the project has it.
 */

import ts from 'typescript';

export interface RegionIncludeAddition {
  /** Manifest root id whose derived region owns these files. */
  readonly rootId: string;
  /** Project-relative globs to declare on it. */
  readonly globs: readonly string[];
}

export type RegionIncludeMerge =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'merged'; readonly text: string; readonly added: readonly string[] }
  /** The adapter source is not the literal shape this splice can edit. The
   *  caller reports `reason` together with the declaration to add by hand. */
  | { readonly kind: 'unreadable'; readonly reason: string };

/** A replacement of `[start, end)` — a range so an insertion can also absorb
 *  the whitespace that sat before a closing bracket. */
interface Splice {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * Quote a string the way this file already quotes them. The repo writes single
 * quotes; a project that writes doubles keeps them. Only the two ASCII quote
 * characters are ever produced, and a value containing the chosen quote falls
 * back to `JSON.stringify`.
 */
function quoteLike(source: string, sample: ts.Node | undefined): (value: string) => string {
  const double = sample !== undefined && source[sample.getStart()] === '"';
  return (value: string) => (double || value.includes("'") ? JSON.stringify(value) : `'${value}'`);
}

function stringLiteralOf(node: ts.Node | undefined): string | undefined {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function propertyOf(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  for (const member of object.properties) {
    if (!ts.isPropertyAssignment(member)) continue;
    const key = ts.isIdentifier(member.name) ? member.name.text : stringLiteralOf(member.name);
    if (key === name) return member;
  }
  return undefined;
}

/** The `defineAdapter({…})` / `nativeAdapter({…})` argument object, or why not. */
function definitionObject(
  source: ts.SourceFile,
): { object: ts.ObjectLiteralExpression } | { reason: string } {
  for (const statement of source.statements) {
    if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;
    const call = statement.expression;
    if (!ts.isCallExpression(call)) {
      return { reason: 'its default export is not a direct `defineAdapter({…})` call' };
    }
    const arg = call.arguments[0];
    if (arg === undefined) {
      // `nativeAdapter()` — the legitimate empty. There is no object literal to
      // splice into, and inventing one would rewrite the file's shape.
      return { reason: 'its default export takes no argument object to declare into' };
    }
    if (!ts.isObjectLiteralExpression(arg)) {
      return { reason: 'its default export is not called with an object literal' };
    }
    return { object: arg };
  }
  return { reason: 'it has no default export' };
}

/** The whitespace run at the start of the line containing `position`. */
function indentAt(text: string, position: number): string {
  const lineStart = text.lastIndexOf('\n', position - 1) + 1;
  const match = /^[ \t]*/.exec(text.slice(lineStart, position));
  return match?.[0] ?? '';
}

/**
 * Insert string literals into an existing array literal, before its `]`.
 * Indentation copies the array's LAST element, so the result looks like the
 * lines it joins whatever the project's style is.
 */
function appendToArray(
  text: string,
  array: ts.ArrayLiteralExpression,
  globs: readonly string[],
): Splice {
  const last = array.elements[array.elements.length - 1];
  const closing = array.getEnd() - 1;
  const inner = last ? indentAt(text, last.getStart()) : `${indentAt(text, array.getStart())}  `;
  const quote = quoteLike(text, last);
  const body = globs.map((glob) => `${inner}${quote(glob)},`).join('\n');
  // Start just past the last element (and its trailing comma, if it has one),
  // absorbing the whitespace that sat before `]` so nothing is left dangling.
  const start = text.slice(0, closing).replace(/\s+$/, '').length;
  const needsComma = last !== undefined && text[start - 1] !== ',';
  return {
    start,
    end: closing,
    text: `${needsComma ? ',' : ''}\n${body}\n${indentAt(text, array.getStart())}`,
  };
}

/** Insert a new property as the LAST member of an object literal. */
function appendProperty(
  text: string,
  object: ts.ObjectLiteralExpression,
  property: (indent: string) => string,
): Splice {
  const last = object.properties[object.properties.length - 1];
  const closing = object.getEnd() - 1;
  const outer = indentAt(text, object.getStart());
  const inner = last ? indentAt(text, last.getStart()) : `${outer}  `;
  const start = text.slice(0, closing).replace(/\s+$/, '').length;
  const needsComma = last !== undefined && text[start - 1] !== ',';
  return { start, end: closing, text: `${needsComma ? ',' : ''}\n${property(inner)}\n${outer}` };
}

/** Render a whole `<rootId>: { include: [...] },` entry at `indent`. */
function regionEntryText(
  indent: string,
  addition: RegionIncludeAddition,
  quote: (value: string) => string,
): string {
  const globs = addition.globs.map((glob) => `${indent}    ${quote(glob)},`).join('\n');
  const key = /^[A-Za-z_$][\w$]*$/.test(addition.rootId) ? addition.rootId : quote(addition.rootId);
  return `${indent}${key}: {\n${indent}  include: [\n${globs}\n${indent}  ],\n${indent}},`;
}

/**
 * Declare `additions` in `source`. Returns the new text, or `unchanged` when
 * every glob is already declared, or `unreadable` with the reason.
 */
export function mergeAdapterRegionIncludes(
  source: string,
  additions: readonly RegionIncludeAddition[],
): RegionIncludeMerge {
  if (additions.length === 0) return { kind: 'unchanged' };
  const parsed = ts.createSourceFile('vgai.adapter.ts', source, ts.ScriptTarget.Latest, true);
  const definition = definitionObject(parsed);
  if ('reason' in definition) return { kind: 'unreadable', reason: definition.reason };

  // The two forms may not be combined (`defineAdapter` rejects the pairing by
  // name), so an explicit `regions` LIST is a different declaration home and
  // this splice declines rather than writing into a table it did not read.
  const listed = propertyOf(definition.object, 'regions');
  if (listed && !ts.isStringLiteralLike(listed.initializer)) {
    return {
      kind: 'unreadable',
      reason: 'it states an explicit `regions` list, whose entries carry their own `include`',
    };
  }

  const splices: Splice[] = [];
  const added: string[] = [];
  const overlay = propertyOf(definition.object, 'regionIncludes');
  const quote = quoteLike(source, undefined);

  if (!overlay) {
    for (const addition of additions) added.push(...addition.globs);
    splices.push(
      appendProperty(source, definition.object, (indent) => {
        const entries = additions
          .map((addition) => regionEntryText(`${indent}  `, addition, quote))
          .join('\n');
        return `${indent}regionIncludes: {\n${entries}\n${indent}},`;
      }),
    );
  } else {
    if (!ts.isObjectLiteralExpression(overlay.initializer)) {
      return { kind: 'unreadable', reason: '`regionIncludes` is not an object literal' };
    }
    const table = overlay.initializer;
    for (const addition of additions) {
      const entry = propertyOf(table, addition.rootId);
      if (!entry) {
        added.push(...addition.globs);
        splices.push(
          appendProperty(source, table, (indent) => regionEntryText(indent, addition, quote)),
        );
        continue;
      }
      if (!ts.isObjectLiteralExpression(entry.initializer)) {
        return {
          kind: 'unreadable',
          reason: `\`regionIncludes.${addition.rootId}\` is not an object literal`,
        };
      }
      const include = propertyOf(entry.initializer, 'include');
      if (!include) {
        added.push(...addition.globs);
        splices.push(
          appendProperty(source, entry.initializer, (indent) => {
            const globs = addition.globs.map((glob) => `${indent}  ${quote(glob)},`).join('\n');
            return `${indent}include: [\n${globs}\n${indent}],`;
          }),
        );
        continue;
      }
      if (!ts.isArrayLiteralExpression(include.initializer)) {
        return {
          kind: 'unreadable',
          reason: `\`regionIncludes.${addition.rootId}.include\` is not an array literal`,
        };
      }
      const declared = new Set(
        include.initializer.elements.map((element) => stringLiteralOf(element)),
      );
      if (declared.has(undefined)) {
        return {
          kind: 'unreadable',
          reason: `\`regionIncludes.${addition.rootId}.include\` holds something other than string literals`,
        };
      }
      const missing = addition.globs.filter((glob) => !declared.has(glob));
      if (missing.length === 0) continue;
      added.push(...missing);
      splices.push(appendToArray(source, include.initializer, missing));
    }
  }

  if (splices.length === 0) return { kind: 'unchanged' };
  // Apply back-to-front so earlier offsets stay valid.
  let text = source;
  for (const splice of [...splices].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, splice.start) + splice.text + text.slice(splice.end);
  }
  return { kind: 'merged', text, added };
}
