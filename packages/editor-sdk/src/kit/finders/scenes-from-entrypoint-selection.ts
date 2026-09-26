/**
 * FINDER — scenes from the entrypoint's active-scene selection.
 *
 * ARCHITECTURE-CORE §The editor protocol, "Zero inference": discovery may be a
 * LIBRARY, and this is one. It only ever runs because an adapter SELECTED it
 * (`{ finder: 'scenesFromEntrypointSelection', … }`); the engine never runs a
 * finder nobody selected, which `packages/engine/test/finder-import-boundary.test.ts`
 * enforces mechanically rather than by policy.
 *
 * Why the ENTRYPOINT and not a folder: it is a LOAD-BEARING source — a
 * reference the game itself executes. The review test is "would the game break
 * if this fact lied?", and here it would: change the entrypoint's selection
 * table and the game changes with it. A `src/scenes/` convention can drift
 * silently; this cannot.
 *
 * Two answers, and the difference is declared rather than sniffed:
 *   - the adapter names a `selection` identifier ⇒ read that module-level
 *     table and answer one entry per key, each reachable through it — plus
 *     WHICH key the entrypoint indexes it with right now (`scenes[activeScene]`
 *     → `const activeScene = 'main'`), marked `reach.active`. That reference is
 *     load-bearing for the same reason the table is: the running world renders
 *     exactly that key's composition, which is why the host can treat the
 *     active entry as the region's own standing document rather than a second
 *     tab beside it;
 *   - the adapter names none ⇒ the entrypoint mounts ONE composition, and the
 *     answer is the single-scene DEGENERATE table: the region's own
 *     composition, opened by mounting the region.
 *
 * ON `typescript`: this module parses the entrypoint's own TSX with the
 * TypeScript compiler API — the same parser `packages/editor/src/ui-source/
 * oid-transform.ts` and `packages/editor/src/asset-workflow/project-content.ts`
 * already use for exactly this kind of question (vgai has `typescript`; it does
 * NOT have @babel/*). It is a HOST-SIDE-ONLY dependency: finders are importable
 * only by the adapter loader, `adapter-module.ts` imports nothing from this
 * directory, and a game's `vgai.adapter.ts` therefore never pulls a parser into
 * its own bundle.
 */

import {
  indexingIdentifier,
  propertyKey,
  selectionTable,
} from '@volter/editor-sdk/session/entrypoint-selection-readers';
import type {
  DocumentEntry,
  SceneSource,
  ScenesFromEntrypointSelectionParams,
} from '@volter/editor-project/adapter/adapter-module';
import { EXPORTED_COMPOSITION_REGIONS } from '@volter/editor-project/adapter/adapter-module';
import type { FinderResult } from '@volter/editor-project/adapter/finders/finder-result';
import ts from 'typescript';

/** One region's entrypoint, as the host reads it off the manifest + disk. */
export interface EntrypointSource {
  /** The region (== manifest root) id. */
  readonly regionId: string;
  /** Project-relative path of the root's `entry` module. */
  readonly path: string;
  /** The module's bytes; `null` when they could not be read. */
  readonly source: string | null;
}

export interface ScenesFromEntrypointSelectionInput {
  /**
   * Every region the host mounts from an exported composition (a root with an
   * `entry`), in manifest order.
   */
  readonly entrypoints: readonly EntrypointSource[];
  /**
   * Resolve one of the entrypoint's own import specifiers to a project-relative
   * path. Supplied by the host because extension/index resolution is a
   * filesystem question and this function is pure. Absent, or answering `null`,
   * means the produced entry carries no `source` — an honest omission rather
   * than a guessed path.
   */
  readonly resolveModule?: (specifier: string, fromPath: string) => string | null;
}

/** Strip the directory and extension from a project-relative path. */
function basename(path: string): string {
  const file = path.replaceAll('\\', '/').split('/').pop() ?? path;
  return file.replace(/\.[jt]sx?$/, '');
}

function parse(path: string, source: string): ts.SourceFile {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/**
 * The name the module's own default export carries — the game's own word for
 * this composition, so the editor's tab reads `World`, not `world.tsx`.
 * `undefined` when the default export is anonymous or absent.
 */
function defaultExportName(sf: ts.SourceFile): string | undefined {
  for (const statement of sf.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const expression = statement.expression;
      if (ts.isIdentifier(expression)) return expression.text;
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const isDefault = modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (!isDefault) continue;
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      return statement.name?.text;
    }
  }
  return undefined;
}

/** Local identifier -> the import it came from. */
interface ImportedBinding {
  readonly specifier: string;
  /** The exported name this binding reads; `undefined` for a default import. */
  readonly exported?: string;
}

function recordClauseBindings(
  clause: ts.ImportClause,
  specifier: string,
  bindings: Map<string, ImportedBinding>,
): void {
  if (clause.name) bindings.set(clause.name.text, { specifier });
  const named = clause.namedBindings;
  if (!named || !ts.isNamedImports(named)) return;
  for (const element of named.elements) {
    bindings.set(element.name.text, {
      specifier,
      exported: (element.propertyName ?? element.name).text,
    });
  }
}

function importedBindings(sf: ts.SourceFile): Map<string, ImportedBinding> {
  const bindings = new Map<string, ImportedBinding>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    recordClauseBindings(statement.importClause, statement.moduleSpecifier.text, bindings);
  }
  return bindings;
}

/**
 * The string a module-level `const <name> = '…'` binds, or `undefined`.
 *
 * `const` and a STRING LITERAL are both required: a `let` can be reassigned and
 * a computed initializer is not a fact the source states, so neither can be
 * reported as the key the game executes. A type annotation
 * (`const activeScene: keyof typeof scenes = 'main'`) is irrelevant here — the
 * initializer is what runs.
 */
function moduleLevelString(sf: ts.SourceFile, name: string): string | undefined {
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      const initializer = declaration.initializer;
      if (initializer && ts.isStringLiteral(initializer)) return initializer.text;
      return undefined;
    }
  }
  return undefined;
}

/**
 * WHICH key the entrypoint mounts at its slot right now, read off the source
 * the game itself executes.
 *
 * Every failure is a NOTE and answers `undefined`: an unread active key costs
 * a retitle, while a guessed one would open the wrong composition as the
 * region's own document.
 */
function activeSelectionKey(
  entrypoint: EntrypointSource,
  sf: ts.SourceFile,
  selection: string,
  keys: readonly string[],
  notes: string[],
): string | undefined {
  const identifier = indexingIdentifier(sf, selection);
  if (identifier === undefined) {
    notes.push(
      `scenesFromEntrypointSelection: ${entrypoint.path} never indexes \`${selection}\`, so ` +
        'which of its compositions the entrypoint mounts is not stated in the source and no ' +
        'entry is settled as the active one.',
    );
    return undefined;
  }
  if (identifier === null) {
    notes.push(
      `scenesFromEntrypointSelection: ${entrypoint.path} indexes \`${selection}\` with ` +
        'something other than one single identifier, so the key it mounts cannot be read ' +
        'statically.',
    );
    return undefined;
  }
  const key = moduleLevelString(sf, identifier);
  if (key === undefined) {
    notes.push(
      `scenesFromEntrypointSelection: ${entrypoint.path} indexes \`${selection}\` with ` +
        `\`${identifier}\`, which is not a module-level \`const\` bound to a string literal, ` +
        'so the key it mounts cannot be read statically.',
    );
    return undefined;
  }
  if (!keys.includes(key)) {
    notes.push(
      `scenesFromEntrypointSelection: ${entrypoint.path} mounts \`${selection}\` under ` +
        `"${key}", which is not a key of that table. The entrypoint and its own selection ` +
        'table disagree.',
    );
    return undefined;
  }
  return key;
}

/** The identifier a selection entry's value names, if it names one at all. */
function propertyIdentifier(property: ts.ObjectLiteralElementLike): string | undefined {
  if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
  if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer)) {
    return property.initializer.text;
  }
  return undefined;
}

function sourceFor(
  binding: ImportedBinding | undefined,
  fromPath: string,
  resolveModule: ScenesFromEntrypointSelectionInput['resolveModule'],
): SceneSource | undefined {
  if (!binding || !resolveModule) return undefined;
  const path = resolveModule(binding.specifier, fromPath);
  if (!path) return undefined;
  return binding.exported === undefined ? { path } : { path, export: binding.exported };
}

/**
 * Which entrypoints this selection targets.
 *
 * The RULE form is every exported-composition region. A named region with no
 * matching entrypoint becomes a note, not a silent omission.
 */
function targetedEntrypoints(
  params: ScenesFromEntrypointSelectionParams,
  entrypoints: readonly EntrypointSource[],
  notes: string[],
): EntrypointSource[] {
  if (params.regions === EXPORTED_COMPOSITION_REGIONS) {
    return [...entrypoints];
  }
  const found: EntrypointSource[] = [];
  for (const regionId of params.regions) {
    const match = entrypoints.find((entry) => entry.regionId === regionId);
    if (match) found.push(match);
    else {
      notes.push(
        `scenesFromEntrypointSelection: region "${regionId}" is selected but the project ` +
          'declares no root with that id and an entry.',
      );
    }
  }
  return found;
}

/** DEGENERATE: the entrypoint mounts one composition, and mounting the region
 *  IS opening it. Labelled by the module's own default export — the game's own
 *  word for this composition. */
function degenerateEntry(entrypoint: EntrypointSource, sf: ts.SourceFile): DocumentEntry {
  return {
    id: entrypoint.regionId,
    label: defaultExportName(sf) ?? basename(entrypoint.path),
    kind: 'scene',
    region: entrypoint.regionId,
    authorable: true,
    reach: { kind: 'root-mount' },
    source: { path: entrypoint.path },
    finder: 'scenesFromEntrypointSelection',
  };
}

/**
 * One entry per key of the entrypoint's own selection table, plus WHICH of
 * them the entrypoint currently mounts at the slot (`active`).
 */
function selectionEntries(
  entrypoint: EntrypointSource,
  sf: ts.SourceFile,
  selection: string,
  resolveModule: ScenesFromEntrypointSelectionInput['resolveModule'],
  notes: string[],
): { entries: DocumentEntry[]; active: string | undefined } {
  const table = selectionTable(sf, selection);
  if (!table) {
    notes.push(
      `scenesFromEntrypointSelection: ${entrypoint.path} declares no module-level ` +
        `\`const ${selection} = { … }\` selection table. Nothing is assumed in its ` +
        'place — fix the adapter’s `selection` or the entrypoint.',
    );
    return { entries: [], active: undefined };
  }

  const bindings = importedBindings(sf);
  const keys: string[] = [];
  const built: { key: string; label: string; source: SceneSource | undefined }[] = [];
  for (const property of table.properties) {
    const key = propertyKey(property);
    if (key === undefined) {
      notes.push(
        `scenesFromEntrypointSelection: ${entrypoint.path}'s \`${selection}\` has an ` +
          'entry whose key is computed, so it cannot be named statically.',
      );
      continue;
    }
    const identifier = propertyIdentifier(property);
    keys.push(key);
    built.push({
      key,
      label: identifier ?? key,
      source: sourceFor(
        identifier ? bindings.get(identifier) : undefined,
        entrypoint.path,
        resolveModule,
      ),
    });
  }

  const active = activeSelectionKey(entrypoint, sf, selection, keys, notes);
  const entries = built.map(({ key, label, source }) => ({
    id: key,
    label,
    kind: 'scene' as const,
    region: entrypoint.regionId,
    authorable: true,
    reach: {
      kind: 'entrypoint-selection' as const,
      selection,
      key,
      ...(key === active ? { active: true } : {}),
    },
    ...(source ? { source } : {}),
    finder: 'scenesFromEntrypointSelection' as const,
  }));
  return { entries, active };
}

/**
 * Answer the scene table this finder's selection describes.
 *
 * Pure: every input is passed in, nothing is read from disk, and an
 * unanswerable question becomes a NOTE rather than a fabricated entry.
 */
export function scenesFromEntrypointSelection(
  params: ScenesFromEntrypointSelectionParams,
  input: ScenesFromEntrypointSelectionInput,
): FinderResult {
  const notes: string[] = [];
  const entries: DocumentEntry[] = [];
  const active: string[] = [];

  for (const entrypoint of targetedEntrypoints(params, input.entrypoints, notes)) {
    if (entrypoint.source === null) {
      notes.push(
        `scenesFromEntrypointSelection: could not read ${entrypoint.path} (region ` +
          `"${entrypoint.regionId}"), so its scenes are unknown — not empty.`,
      );
      continue;
    }
    const sf = parse(entrypoint.path, entrypoint.source);
    if (params.selection === undefined) {
      entries.push(degenerateEntry(entrypoint, sf));
      continue;
    }
    const found = selectionEntries(entrypoint, sf, params.selection, input.resolveModule, notes);
    entries.push(...found.entries);
    if (found.active !== undefined) active.push(found.active);
  }

  // The ACTIVE key settles the default outright: the entrypoint states which
  // composition it mounts, so this is the finder READING an answer rather than
  // choosing between candidates. Failing that, one candidate settles it; two or
  // more is a choice, and a choice belongs to the adapter author.
  const settled =
    active.length === 1 ? active[0] : entries.length === 1 ? entries[0]?.id : undefined;
  return settled !== undefined ? { entries, default: settled, notes } : { entries, notes };
}
