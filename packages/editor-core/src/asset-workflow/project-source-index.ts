/**
 * THE PROJECT'S SOURCE INDEX — what React/R3F components a project's own TSX
 * declares, and which REGION each file belongs to.
 *
 * Split out of `project-content.ts` (2026-09-18, WORK.md §The open-source
 * launch phase 1 unit 9) for the reason `canvas-board-actions.ts` already
 * states about itself: keeping a subject separate from the estate it reads
 * means opening the editor does not initialize that estate to answer a
 * different question. The Content browser panel imports its SIBLING half for
 * five presentation helpers, and that one import carried this half's
 * TypeScript-AST work — `ui-source/oid-transform.ts` (1,811 lines), the five
 * R3F prop-contract bindings, `ui-source/ts-ast.ts` and
 * `ui-source/adapter-region-includes.ts`, EIGHT files — into every editor boot,
 * a `models` build that indexes no R3F source included.
 *
 * Nothing in the eager shell calls anything here. Every caller is either a
 * SCAN (`server/project-components.ts`, `server/routes/project-source.ts`,
 * `api/assets.ts` and `browser-transpile.ts`, the last two already through
 * `await import()`) or a story module reached after a project opens. The two
 * halves still share the `ProjectComponentEntry` shape, which is a TYPE and
 * costs no closure.
 */

import ts from 'typescript';
import { MANIFEST_FILENAME } from '@volter/editor-project/manifest/filename';
import { resolveRelativeSpecifier } from '../resolve-relative-specifier';
import type { StorageBackend } from '../storage/types';
import {
  ADAPTER_MODULE_FILENAME,
  parseAdapterRegionIncludes,
} from '../ui-source/adapter-region-includes';
import type { ImportersOf, RegionBinding, RegionSurface } from '../ui-source/file-region-resolver';
import { resolveFileRegion } from '../ui-source/file-region-resolver';
import {
  analyzeR3fComponentContracts,
  builtinR3fContractsForSource,
} from '../ui-source/oid-transform';
import type { ProjectComponentEntry } from './project-content';

const PROJECT_SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]sx)$/i;
const SKIPPED_SOURCE_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.vgai',
  'tools',
]);

function hasModifier(statement: ts.Statement, kind: ts.SyntaxKind): boolean {
  return Boolean(
    ts.canHaveModifiers(statement) &&
      ts.getModifiers(statement)?.some((modifier) => modifier.kind === kind),
  );
}

function declarationBindings(statement: ts.Statement): string[] {
  if (ts.isFunctionDeclaration(statement) && statement.name) return [statement.name.text];
  if (!ts.isVariableStatement(statement)) return [];
  return statement.declarationList.declarations.flatMap((declaration) =>
    ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
  );
}

function exportClauseBindings(statement: ts.Statement): string[] {
  if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
    return [statement.expression.text];
  }
  if (!ts.isExportDeclaration(statement) || !statement.exportClause) return [];
  if (!ts.isNamedExports(statement.exportClause)) return [];
  return statement.exportClause.elements.map(
    (element) => (element.propertyName ?? element.name).text,
  );
}

function exportedBindings(sourceFile: ts.SourceFile): Set<string> {
  return new Set(
    sourceFile.statements.flatMap((statement) => [
      ...exportClauseBindings(statement),
      ...(hasModifier(statement, ts.SyntaxKind.ExportKeyword) ||
      hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
        ? declarationBindings(statement)
        : []),
    ]),
  );
}

function defaultExportBindings(sourceFile: ts.SourceFile): Set<string> {
  return new Set(
    sourceFile.statements.flatMap((statement) =>
      hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
        ? declarationBindings(statement)
        : ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)
          ? [statement.expression.text]
          : [],
    ),
  );
}

interface ComponentSourceInfo {
  line: number;
  body: ts.ConciseBody;
}

function componentSourceInfo(sourceFile: ts.SourceFile): Map<string, ComponentSourceInfo> {
  const result = new Map<string, ComponentSourceInfo>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      result.set(statement.name.text, {
        line:
          sourceFile.getLineAndCharacterOfPosition(statement.name.getStart(sourceFile)).line + 1,
        body: statement.body,
      });
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        !declaration.initializer ||
        (!ts.isArrowFunction(declaration.initializer) &&
          !ts.isFunctionExpression(declaration.initializer))
      ) {
        continue;
      }
      result.set(declaration.name.text, {
        line:
          sourceFile.getLineAndCharacterOfPosition(declaration.name.getStart(sourceFile)).line + 1,
        body: declaration.initializer.body,
      });
    }
  }
  return result;
}

function isInsideCollection(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isStatement(current)) {
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      (current.expression.name.text === 'map' || current.expression.name.text === 'flatMap')
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function componentSourceUses(
  sourceFile: ts.SourceFile,
): Map<string, { count: number; collection: boolean }> {
  const result = new Map<string, { count: number; collection: boolean }>();
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText();
      if (/^[A-Z][A-Za-z0-9_$]*$/.test(name)) {
        const previous = result.get(name) ?? { count: 0, collection: false };
        result.set(name, {
          count: previous.count + 1,
          collection: previous.collection || isInsideCollection(node),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

/** Discover top-level visual React/R3F component definitions in one module.
 * This is a source index, not prefab inference: Content joins these definitions
 * to portable CSF and admits only components a story explicitly declares.
 *
 * `surface` is the file's REGION, resolved by the one shared resolver
 * (`../ui-source/file-region-resolver.ts`) from the project's declarations and
 * import reach — see {@link projectFileSurfaces}. It is a parameter and not
 * something derived here, because a single file cannot see what reaches it: the
 * `@react-three/fiber` / `@pixi/react` / DOM-tag scans that used to decide it
 * grouped Content by whichever library a file happened to name, so a project
 * that centralized its imports had its components filed under `unknown`.
 * `'unknown'` now means exactly one thing — the resolver could not place this
 * file — which is a real state Content can show rather than a guess it made. */
export function discoverComponentsInSource(
  source: string,
  path: string,
  surface: RegionSurface | 'unknown' = 'unknown',
): ProjectComponentEntry[] {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const exported = exportedBindings(sourceFile);
  const defaultExports = defaultExportBindings(sourceFile);
  const contracts = [
    ...analyzeR3fComponentContracts(source, path, builtinR3fContractsForSource(source, path)),
  ];
  const sourceInfo = componentSourceInfo(sourceFile);
  const sourceUses = componentSourceUses(sourceFile);
  return contracts
    .filter(([name]) => sourceInfo.has(name))
    .map(([name, contract]) => {
      return {
        name,
        path,
        line: sourceInfo.get(name)!.line,
        exported: exported.has(name),
        defaultExport: defaultExports.has(name),
        declaredInRootEntry: false,
        sourceUseCount: sourceUses.get(name)?.count ?? 0,
        sourceCollectionUse: sourceUses.get(name)?.collection ?? false,
        surface,
        contentKind: contract.rootTag?.toLowerCase() === 'svg' ? 'image' : 'component',
        contract,
      };
    });
}

/** One indexed source file, project-relative path plus its bytes. */
export interface IndexedProjectSource {
  readonly path: string;
  readonly source: string;
}

/** A project's regions in the resolver's vocabulary, plus each one's entry. */
export interface ProjectRegionEntry extends RegionBinding {
  /** Project-relative entry path, or `undefined` for an entry-less root. */
  readonly entry?: string;
}

/** Resolve a relative import specifier against the indexed file set. Extension
 *  and index resolution is a filesystem question and the resolver is pure, so
 *  it is answered here from a REAL index rather than by guessing an extension
 *  onto a path — the same shape `project-adapter.ts`'s `makeResolveModule` uses. */
function resolveRelativeImport(
  specifier: string,
  fromPath: string,
  paths: ReadonlySet<string>,
): string | undefined {
  return resolveRelativeSpecifier(specifier, fromPath, paths) ?? undefined;
}

/** Every project-local module `source` imports or re-exports from. */
function importedPaths(source: string, path: string, paths: ReadonlySet<string>): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  for (const statement of file.statements) {
    const specifier =
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : undefined;
    if (specifier === undefined) continue;
    const resolved = resolveRelativeImport(specifier, path, paths);
    if (resolved !== undefined) out.push(resolved);
  }
  return out;
}

/**
 * The one region answer for every indexed file, through the shared resolver.
 *
 * Content has no live Vite module graph, so it builds the same seam from the
 * sources it already read: the import edges are INVERTED into an `ImportersOf`
 * and handed to `resolveFileRegion`, which then applies exactly the precedence
 * every other site gets — a region's declared `include` glob, then a root
 * entry, then reach. A file no region reaches stays `'unknown'`, which Content
 * shows as its own state.
 */
export function projectFileSurfaces(
  files: readonly IndexedProjectSource[],
  regions: readonly ProjectRegionEntry[],
): Map<string, RegionSurface> {
  const paths = new Set(files.map((file) => file.path));
  const importers = new Map<string, Set<string>>();
  for (const file of files) {
    for (const imported of importedPaths(file.source, file.path, paths)) {
      const bucket = importers.get(imported);
      if (bucket) bucket.add(file.path);
      else importers.set(imported, new Set([file.path]));
    }
  }
  const importersOf: ImportersOf = (id) => importers.get(id);
  const byEntry = new Map<string, RegionBinding>();
  for (const region of regions) {
    if (region.entry !== undefined) byEntry.set(region.entry.replace(/^\.\//, ''), region);
  }
  const surfaces = new Map<string, RegionSurface>();
  for (const file of files) {
    const answer = resolveFileRegion({
      file: file.path,
      projectRelative: file.path,
      regions,
      regionOfEntry: (candidate) => byEntry.get(candidate),
      importersOf,
    });
    if (answer.surface !== undefined) surfaces.set(file.path, answer.surface);
  }
  return surfaces;
}

/** A root's `adapter` field reduced to a surface — the bare-string shorthand or
 *  the `{ module | ingest, surface }` object forms. Never throws on a malformed
 *  shape; the manifest loader is the validation authority. */
function rootSurface(adapter: unknown): RegionSurface | undefined {
  const value =
    typeof adapter === 'string' ? adapter : (adapter as { surface?: unknown } | null)?.surface;
  return value === 'three' || value === 'canvas' || value === 'dom' ? value : undefined;
}

/**
 * A project's regions, PLUS what reading them lost.
 *
 * `unreadable` is carried rather than dropped because dropping it is the exact
 * failure this whole rung retired: an adapter whose `regions` binding this
 * reader cannot evaluate statically still has its `include` globs honored by
 * the real loader (`project-adapter.ts`, which evaluates the module), so a
 * silent "read fine" here would mean the two readers disagree with nobody told.
 * Every caller reports it in whatever channel it owns.
 *
 * It is the REASON SENTENCE, not a bare flag, because the causes are genuinely
 * different — an unreadable `regions` binding, an unreadable manifest, a failed
 * read of either — and the warning that reaches a terminal has to name the one
 * that happened rather than the one that is most common.
 */
export interface ProjectRegions {
  readonly regions: readonly ProjectRegionEntry[];
  /** `null` when nothing was lost; otherwise what was, in one sentence. */
  readonly unreadable: string | null;
}

/** What an unreadable `regions` binding costs, and how to write one that reads. */
const UNREADABLE_ADAPTER_REGIONS =
  `${ADAPTER_MODULE_FILENAME} declares a \`regions\` binding that cannot be read statically, so ` +
  'any `include` globs in it were NOT consulted when grouping this project’s components — files ' +
  'those globs claim will show their reach-derived surface, or `unknown`. Write the regions as an ' +
  'array of object literals passed directly to defineAdapter({…}), with literal `id` and ' +
  '`include` values.';

/** One sentence for a read that threw, naming the file and the failure. */
function readFailure(filename: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return (
    `${filename} could not be read (${detail}), so this project's regions were resolved without ` +
    'it. This is NOT the absent-file case — an absent file is a declaration, a failed read is a ' +
    'gap — and the surfaces below may disagree with what the real loader computes.'
  );
}

/**
 * The project's regions as the resolver reads them: the manifest's roots joined
 * to whatever `include` globs its `vgai.adapter.ts` declares for them.
 *
 * ABSENT AND UNREADABLE ARE DIFFERENT ANSWERS, and only the reader knows which
 * one its backend just gave — Node rejects ENOENT, a `StorageBackend` rejects
 * for a missing path too, and neither rejection distinguishes itself from a
 * permissions error or a corrupt handle. So the callbacks say it in the return
 * type: resolve `null` for "this file is not there" (a missing adapter is the
 * DECLARED native default — pure reach — exactly as an absent
 * `vgai.adapter.ts` means `nativeAdapter()`), and REJECT for a read that
 * failed. A rejection used to be swallowed into the same empty string as an
 * absent file, which reported the loss as a declaration.
 */
export async function projectRegionEntries(
  readManifest: () => Promise<string | null>,
  readAdapter: () => Promise<string | null>,
): Promise<ProjectRegions> {
  let manifest: string | null;
  try {
    manifest = await readManifest();
  } catch (error) {
    return { regions: [], unreadable: readFailure(MANIFEST_FILENAME, error) };
  }
  if (manifest === null) {
    return {
      regions: [],
      unreadable: `${MANIFEST_FILENAME} is absent, so this project declares no regions at all and every file falls to its reach-derived surface, or \`unknown\`.`,
    };
  }
  let adapter: string | null;
  try {
    adapter = await readAdapter();
  } catch (error) {
    // The manifest still yields the roots; only the `include` globs are lost.
    return {
      regions: projectRegionEntriesFromSources(manifest, '').regions,
      unreadable: readFailure(ADAPTER_MODULE_FILENAME, error),
    };
  }
  return projectRegionEntriesFromSources(manifest, adapter ?? '');
}

/**
 * The SYNCHRONOUS half of {@link projectRegionEntries}, for readers that
 * already hold both files' bytes — the project-side `check-idioms` scanner is
 * one, and its R3F floor rule needs the region answer or it silently analyzes
 * nothing. One implementation, two entry shapes; never two parsers.
 */
export function projectRegionEntriesFromSources(
  manifestSource: string,
  adapterSource: string,
): ProjectRegions {
  let roots: Array<{ id?: unknown; entry?: unknown; adapter?: unknown }> = [];
  try {
    roots = (JSON.parse(manifestSource) as { roots?: typeof roots }).roots ?? [];
  } catch (error) {
    // A manifest whose bytes are here but do not parse is a LOSS, not a project
    // that declares no regions — the loader reads the same file through the real
    // schema and gets roots this index will not have.
    return { regions: [], unreadable: readFailure(MANIFEST_FILENAME, error) };
  }
  const declared = parseAdapterRegionIncludes(adapterSource);
  const includes = declared.byRegionId;
  const regions = roots.flatMap((root) => {
    const id = typeof root.id === 'string' ? root.id : undefined;
    const surface = rootSurface(root.adapter);
    if (id === undefined || surface === undefined) return [];
    const include = includes.get(id);
    const mounts = declared.mountsByRegionId.get(id);
    return [
      {
        id,
        surface,
        ...(typeof root.entry === 'string' ? { entry: root.entry } : {}),
        ...(include ? { include } : {}),
        ...(mounts?.length ? { mounts } : {}),
      },
    ];
  });
  return { regions, unreadable: declared.unreadable ? UNREADABLE_ADAPTER_REGIONS : null };
}

/**
 * Say out loud what reading this project's regions lost, so the `include` globs
 * the real loader WILL honor are not silently missing from this index.
 *
 * `console.warn` on purpose: it is the same instrument `reportOidSurfaceDiagnostics`
 * already uses for the OID lane's own version of this message, so the dev
 * server's terminal and the hosted editor's console both get it without a
 * second channel. Warn-once per project AND reason — a component index rebuilds
 * on every project change, so a per-rebuild repeat is noise, but a DIFFERENT
 * loss on the same project is news and must not be swallowed by the first one.
 */
const reportedUnreadableRegions = new Set<string>();
export function reportUnreadableRegions(projectLabel: string, reason: string): void {
  const key = `${projectLabel}\n${reason}`;
  if (reportedUnreadableRegions.has(key)) return;
  reportedUnreadableRegions.add(key);
  // biome-ignore lint/suspicious/noConsole: this warning IS the function (see its docblock)
  console.warn(`[project-content] ${projectLabel}: ${reason}`);
}

/**
 * The {@link projectRegionEntries} reader contract over a {@link StorageBackend}:
 * ABSENT resolves `null`, every other failure rejects. `read` rejects for both,
 * so `exists` is what separates them — the backend's own answer, not a guess
 * from the error's shape.
 */
export async function readOptionalFromBackend(
  backend: StorageBackend,
  path: string,
): Promise<string | null> {
  try {
    return await backend.read(path);
  } catch (error) {
    if (await backend.exists(path)) throw error;
    return null;
  }
}

/** Browser-hosted equivalent of the server component index. */
export async function discoverProjectComponentsFromStorage(
  backend: StorageBackend,
): Promise<ProjectComponentEntry[]> {
  const pending = ['src'];
  const files: string[] = [];
  while (pending.length > 0 && files.length < 512) {
    const directory = pending.shift()!;
    const entries = await backend.list(directory).catch(() => []);
    for (const entry of entries) {
      if (entry.type === 'dir') {
        if (!SKIPPED_SOURCE_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) {
          pending.push(entry.path);
        }
      } else if (PROJECT_SOURCE_EXTENSIONS.test(entry.path)) {
        files.push(entry.path);
      }
    }
  }
  const sources = (
    await Promise.all(
      files.map((path) =>
        backend
          .read(path)
          .then((source): IndexedProjectSource[] => [{ path, source }])
          .catch(() => []),
      ),
    )
  ).flat();
  const { regions, unreadable } = await projectRegionEntries(
    () => readOptionalFromBackend(backend, MANIFEST_FILENAME),
    () => readOptionalFromBackend(backend, ADAPTER_MODULE_FILENAME),
  );
  if (unreadable) reportUnreadableRegions(backend.id, unreadable);
  const surfaces = projectFileSurfaces(sources, regions);
  const discovered = sources.flatMap((file) =>
    discoverComponentsInSource(file.source, file.path, surfaces.get(file.path) ?? 'unknown'),
  );
  const rootEntries = await projectRootEntries(() => backend.read(MANIFEST_FILENAME));
  return omitRootDocumentComponents(discovered, rootEntries).sort(compareProjectComponents);
}

export async function projectRootEntries(
  readManifest: () => Promise<string>,
): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(await readManifest()) as { roots?: Array<{ entry?: unknown }> };
    return new Set(
      (parsed.roots ?? []).flatMap((root) =>
        typeof root.entry === 'string' ? [root.entry.replace(/^\.\//, '')] : [],
      ),
    );
  } catch {
    return new Set();
  }
}

export function omitRootDocumentComponents(
  components: readonly ProjectComponentEntry[],
  rootEntries: ReadonlySet<string>,
): ProjectComponentEntry[] {
  return components.flatMap((component) => {
    const declaredInRootEntry = rootEntries.has(component.path.replace(/^\.\//, ''));
    if (component.defaultExport && declaredInRootEntry) return [];
    return [{ ...component, declaredInRootEntry }];
  });
}

export function compareProjectComponents(
  left: ProjectComponentEntry,
  right: ProjectComponentEntry,
): number {
  if (left.exported !== right.exported) return left.exported ? -1 : 1;
  return left.name.localeCompare(right.name) || left.path.localeCompare(right.path);
}
