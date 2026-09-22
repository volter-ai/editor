/**
 * `planComponentExtraction` — the PURE core of "Extract Component…": one
 * already-read source string in, THREE exact artifacts out — a new component
 * module, a portable CSF story beside it, and the callsite edit that replaces
 * the extracted subtree with an instance. No I/O, no hashing, no transport —
 * the same split `plan-fork-component.ts` uses, and for the same reason (the
 * dev server reads with `node:fs`; this module stays dependency-free so it is
 * probeable headlessly).
 *
 * WHAT AN EXTRACTION IS. The inverse of pasting inline: a subtree an author
 * assembled in place becomes a reusable component under `src/prefabs/` — the
 * scene/component/prefab taxonomy the template teaches — with a story so the
 * component board can mount it in isolation, and the original site becomes an
 * ordinary instance. There is deliberately NO parallel prefab format: the
 * output is a plain component file plus plain portable CSF, both of which a
 * developer could have written by hand (WORK.md's own constraint).
 *
 * IMPORTS TRAVEL; EVERYTHING ELSE REFUSES BY NAME. The subtree's free
 * identifiers (`referencedIdentifiers`, the reparent guard's R1 machinery)
 * are classified by where they bind:
 *
 *   - an IMPORT binding travels — the new module gets its own import
 *     statement, with relative specifiers re-resolved from the new file's
 *     location;
 *   - a module-level declaration (a `const`/function in the world file)
 *     REFUSES, naming the declaration and its line — chasing and copying
 *     module locals is scope creep this planner deliberately does not have
 *     (the fork records the same boundary), and a silent copy would fork the
 *     value's identity;
 *   - a binding inside an enclosing function (a hook result, a mapped
 *     variable, a prop) REFUSES with the owning function's name — the same
 *     sentence shape R1 gives a reparent that would break lexical capture;
 *   - an unresolved name (a global — `Math`) is fine as-is.
 *
 * INSERTION SEMANTICS. When the extracted root is an INTRINSIC element
 * (`<mesh>`, `<group>`), its `name`/`position`/`rotation`/`scale` attributes
 * are LIFTED to the new callsite and the component's root spreads
 * `{...props}` (typed `ThreeElements['<tag>']`, the template HeroBox's own
 * shape) — placement belongs to the instance, so a second drop of the same
 * prefab does not land inside the first. A component-tag root is carried
 * verbatim with no lift and no props parameter: its prop surface is its own.
 *
 * REFUSALS ARE NAMED — every rejection returns a sentence the author can act
 * on, and the planner refuses before anything is written.
 */

import ts from 'typescript';
import { lineColToOffset } from './oid-transform';
import { relativeImportSpecifier } from './relative-import-specifier';
import {
  bindingScopeOf,
  type JsxElementNode,
  jsxElementAt,
  owningFunctionName,
  referencedIdentifiers,
} from './reparent-guard';
import { parseAuthoringTsx } from './ts-ast';

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const MAX_FALLBACK_SUFFIX = 99;
const LIFTED_ATTRS = ['name', 'position', 'rotation', 'scale'] as const;

export interface ExtractComponentRequest {
  /** The file the subtree lives in, and its current bytes. */
  readonly sourceFile: string;
  readonly source: string;
  /** The element's `OidEntry` position (1-based line, 0-based col). */
  readonly line: number;
  readonly col: number;
  /** The preferred component name (the author's, or an instance `name`). */
  readonly nameSeed?: string | undefined;
  /** Project-relative directory the new files land in (`src/prefabs`). */
  readonly prefabDir: string;
  /** File NAMES already in that directory — collision refusals + name fallback. */
  readonly siblingFiles?: readonly string[] | undefined;
}

export interface ExtractComponentPlan {
  readonly newName: string;
  /** `Lantern.tsx` / `Lantern.stories.tsx` — caller joins onto `prefabDir`. */
  readonly componentFileName: string;
  readonly storyFileName: string;
  /** Project-relative paths, forward slashes. */
  readonly componentFile: string;
  readonly storyFile: string;
  /** Complete bytes of the two new modules. */
  readonly componentSource: string;
  readonly storySource: string;
  readonly callsiteFile: string;
  readonly callsitePrevSource: string;
  readonly callsiteNewSource: string;
  /** The specifier the callsite's new import uses. */
  readonly importSpecifier: string;
  /** The extracted root's tag, for hints. */
  readonly tag: string;
  /** History label for the CALLSITE edit (the new files are outside history). */
  readonly historyLabel: string;
}

export type ExtractComponentPlanResult =
  | { readonly ok: true; readonly plan: ExtractComponentPlan }
  | { readonly ok: false; readonly reason: string };

function refuse(reason: string): ExtractComponentPlanResult {
  return { ok: false, reason };
}

// ------------------------------------------------------------------- paths

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function directoryOf(path: string): string {
  const clean = normalizePath(path);
  const cut = clean.lastIndexOf('/');
  return cut < 0 ? '' : clean.slice(0, cut);
}

/** Resolve `./x`/`../x` against a directory, collapsing the dot segments. */
function resolveRelative(fromDir: string, specifier: string): string {
  const parts = [...fromDir.split('/').filter(Boolean)];
  for (const segment of normalizePath(specifier).split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

// ------------------------------------------------------------------- naming

function pascalCase(seed: string): string {
  const words = seed.match(/[A-Za-z0-9]+/g) ?? [];
  const joined = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
  return /^[0-9]/.test(joined) ? '' : joined;
}

/** The component name: the seed PascalCased when usable, else `Extracted<Tag>`,
 *  suffixed past any sibling module already claiming the basename. */
function pickName(
  seed: string | undefined,
  tag: string,
  siblingFiles: readonly string[],
): string | null {
  const taken = new Set(
    siblingFiles.map((f) => f.replace(/\.(stories\.)?(tsx|ts|jsx|js)$/, '').toLowerCase()),
  );
  const base =
    (seed && IDENTIFIER_RE.test(pascalCase(seed)) && pascalCase(seed)) ||
    (/^[A-Z]/.test(tag) && IDENTIFIER_RE.test(tag) && `${tag}Part`) ||
    `Extracted${pascalCase(tag) || 'Node'}`;
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i <= MAX_FALLBACK_SUFFIX; i++) {
    if (!taken.has(`${base}${i}`.toLowerCase())) return `${base}${i}`;
  }
  return null;
}

// ------------------------------------------------------------ import carrying

/** The import statement binding `name` in `sf`, rebuilt for a module living at
 *  `newFile` — or `null` when `name` is not import-bound. Only the bindings the
 *  subtree actually uses are carried, so an import of five names carries one. */
function carriedImportFor(
  sf: ts.SourceFile,
  name: string,
  callsiteFile: string,
  newFile: string,
): { specifier: string; piece: 'default' | 'namespace' | 'named' } | null {
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    let piece: 'default' | 'namespace' | 'named' | null = null;
    if (clause.name?.text === name) piece = 'default';
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === name) {
      piece = 'namespace';
    } else if (bindings && ts.isNamedImports(bindings)) {
      if (bindings.elements.some((e) => e.name.text === name)) piece = 'named';
    }
    if (!piece) continue;
    let specifier = statement.moduleSpecifier.text;
    if (specifier.startsWith('.')) {
      const absolute = resolveRelative(directoryOf(callsiteFile), specifier);
      specifier = relativeImportSpecifier(newFile, absolute);
    }
    return { specifier, piece };
  }
  return null;
}

// --------------------------------------------------------------- subtree text

function openingTagOf(node: JsxElementNode): ts.JsxOpeningElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(node) ? node.openingElement : node;
}

/** Dedent by the root's own line indent, then re-indent for the return body. */
function reindent(text: string, originalIndent: string, newIndent: string): string {
  return text
    .split('\n')
    .map((line, i) => {
      if (i === 0) return `${newIndent}${line}`;
      const stripped = line.startsWith(originalIndent) ? line.slice(originalIndent.length) : line;
      return stripped.trim() === '' ? '' : `${newIndent}${stripped}`;
    })
    .join('\n');
}

// -------------------------------------------------------------------- plan

export function planComponentExtraction(
  request: ExtractComponentRequest,
): ExtractComponentPlanResult {
  const source = request.source;
  const sf = parseAuthoringTsx(request.sourceFile, source);
  const offset = lineColToOffset(source, request.line, request.col);
  const element = jsxElementAt(sf, offset);
  if (!element) {
    return refuse(
      `${request.sourceFile}:${request.line} no longer holds a JSX element — ` +
        'the file changed since the hierarchy was indexed.',
    );
  }
  const opening = openingTagOf(element);
  const tag = opening.tagName.getText(sf);

  // R1 over the whole subtree: classify every free identifier.
  const carried = new Map<
    string,
    { specifier: string; piece: 'default' | 'namespace' | 'named' }
  >();
  for (const [name, site] of referencedIdentifiers(element)) {
    const scope = bindingScopeOf(name, element);
    if (scope === null) continue; // a global — travels as-is
    if (ts.isSourceFile(scope)) {
      const asImport = carriedImportFor(
        sf,
        name,
        normalizePath(request.sourceFile),
        `${request.prefabDir}/x.tsx`,
      );
      if (asImport) {
        carried.set(name, asImport);
        continue;
      }
      const line = sf.getLineAndCharacterOfPosition(site.getStart(sf)).line + 1;
      return refuse(
        `the subtree references \`${name}\` (line ${line}), declared in this module — ` +
          'extraction only carries imports; move the declaration to its own module first, ' +
          'or inline the value.',
      );
    }
    return refuse(
      `the subtree references \`${name}\`, bound inside ${owningFunctionName(element, sf)} — ` +
        'a value local to the enclosing component cannot travel to a new file. ' +
        'Inline it or lift it to a prop first.',
    );
  }

  // Name + collision.
  const siblings = request.siblingFiles ?? [];
  const attrs = opening.attributes.properties;
  const authoredName = attrs.find(
    (p): p is ts.JsxAttribute =>
      ts.isJsxAttribute(p) &&
      ts.isIdentifier(p.name) &&
      p.name.text === 'name' &&
      !!p.initializer &&
      ts.isStringLiteral(p.initializer),
  );
  const newName = pickName(
    request.nameSeed ?? (authoredName?.initializer as ts.StringLiteral | undefined)?.text,
    tag,
    siblings,
  );
  if (!newName) return refuse('every candidate component name is taken in the prefab folder.');

  const componentFileName = `${newName}.tsx`;
  const storyFileName = `${newName}.stories.tsx`;
  const componentFile = `${request.prefabDir}/${componentFileName}`;
  const storyFile = `${request.prefabDir}/${storyFileName}`;
  const collision = siblings.find(
    (f) =>
      f.toLowerCase() === componentFileName.toLowerCase() ||
      f.toLowerCase() === storyFileName.toLowerCase(),
  );
  if (collision) {
    return refuse(
      `${request.prefabDir}/${collision} already exists — extraction will not overwrite.`,
    );
  }

  // Root-attribute lift (intrinsic roots only): placement belongs to the instance.
  const intrinsicRoot = /^[a-z]/.test(tag);
  const lifted: string[] = [];
  let rootTagWithoutLifted: { start: number; end: number; text: string } | null = null;
  if (intrinsicRoot) {
    const removals: Array<{ start: number; end: number }> = [];
    for (const property of attrs) {
      if (!ts.isJsxAttribute(property) || !ts.isIdentifier(property.name)) continue;
      if (!(LIFTED_ATTRS as readonly string[]).includes(property.name.text)) continue;
      lifted.push(property.getText(sf));
      removals.push({ start: property.getStart(sf), end: property.getEnd() });
    }
    const tagStart = opening.getStart(sf);
    const tagEnd = opening.getEnd();
    let text = '';
    let cursor = tagStart;
    for (const removal of removals.sort((a, b) => a.start - b.start)) {
      // Take the span before the attr, trimming the whitespace that preceded it.
      text += source.slice(cursor, removal.start).replace(/[ \t\n]+$/, ' ');
      cursor = removal.end;
    }
    text += source.slice(cursor, tagEnd);
    // Consecutive removals each left one space behind; collapse the run (only
    // single-line runs — a multi-line attribute list keeps its own layout).
    text = text.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+>/g, '>');
    // Spread the instance's props last, so a callsite override wins.
    const closer = ts.isJsxSelfClosingElement(opening) ? /\s*\/>$/ : />$/;
    text = text.replace(
      closer,
      ts.isJsxSelfClosingElement(opening) ? ' {...props} />' : ' {...props}>',
    );
    rootTagWithoutLifted = { start: tagStart, end: tagEnd, text };
  }

  // The component module.
  const elementStart = element.getStart(sf);
  const elementEnd = element.getEnd();
  const lineStart = source.lastIndexOf('\n', elementStart - 1) + 1;
  const indent = /^[ \t]*/.exec(source.slice(lineStart, elementStart))?.[0] ?? '';
  let subtree = source.slice(elementStart, elementEnd);
  if (rootTagWithoutLifted) {
    subtree = rootTagWithoutLifted.text + source.slice(rootTagWithoutLifted.end, elementEnd);
  }
  const body = reindent(subtree, indent, '    ');

  const importLines = new Map<
    string,
    { defaults: string[]; named: string[]; namespaces: string[] }
  >();
  for (const [name, entry] of carried) {
    const bucket = importLines.get(entry.specifier) ?? { defaults: [], named: [], namespaces: [] };
    if (entry.piece === 'default') bucket.defaults.push(name);
    else if (entry.piece === 'namespace') bucket.namespaces.push(name);
    else bucket.named.push(name);
    importLines.set(entry.specifier, bucket);
  }
  const imports: string[] = [];
  if (intrinsicRoot) {
    imports.push(`import type { ThreeElements } from '@react-three/fiber';`);
  }
  for (const [specifier, bucket] of [...importLines.entries()].sort()) {
    for (const namespace of bucket.namespaces) {
      imports.push(`import * as ${namespace} from '${specifier}';`);
    }
    const pieces: string[] = [];
    if (bucket.defaults.length > 0) pieces.push(bucket.defaults[0]!);
    if (bucket.named.length > 0) pieces.push(`{ ${bucket.named.sort().join(', ')} }`);
    if (pieces.length > 0) imports.push(`import ${pieces.join(', ')} from '${specifier}';`);
  }

  const componentSourceFinal = `${imports.length > 0 ? `${imports.join('\n')}\n\n` : ''}export function ${newName}(${intrinsicRoot ? `props: ThreeElements['${tag}']` : ''}) {
  return (
${body}
  );
}
`;

  // The story (the template HeroBox story, transcribed).
  const title = newName.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const storySource = `import type { Meta, StoryObj } from '@storybook/react';
import { ${newName} } from './${newName}';

const meta = {
  title: '${title}',
  component: ${newName},
} satisfies Meta<typeof ${newName}>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  parameters: { vgai: { default: true } },
};
`;

  // The callsite: the subtree becomes an instance, and the import arrives.
  const importSpecifier = relativeImportSpecifier(normalizePath(request.sourceFile), componentFile);
  const instanceAttrs = lifted.length > 0 ? ` ${lifted.join(' ')}` : '';
  const instance = `<${newName}${instanceAttrs} />`;
  let callsiteNewSource = source.slice(0, elementStart) + instance + source.slice(elementEnd);
  const importStatement = `import { ${newName} } from '${importSpecifier}';\n`;
  const lastImport = [...sf.statements].reverse().find(ts.isImportDeclaration);
  const importAt = lastImport ? lastImport.getEnd() + 1 : 0;
  callsiteNewSource =
    callsiteNewSource.slice(0, importAt) + importStatement + callsiteNewSource.slice(importAt);

  return {
    ok: true,
    plan: {
      newName,
      componentFileName,
      storyFileName,
      componentFile,
      storyFile,
      componentSource: componentSourceFinal,
      storySource,
      callsiteFile: normalizePath(request.sourceFile),
      callsitePrevSource: source,
      callsiteNewSource,
      importSpecifier,
      tag,
      historyLabel: `Extract ${newName}`,
    },
  };
}
