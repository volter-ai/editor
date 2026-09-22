/**
 * Project-local R3F component contract discovery.
 *
 * This deliberately follows ordinary TypeScript/React modules instead of
 * asking game source to register components with vgai. Relative imports,
 * named/default exports, aliases, and re-exports are enough for the editor to
 * understand the shared-component shape coding models normally produce.
 * External packages remain conservative: vgai never guesses at their runtime
 * scene ownership.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import ts from 'typescript';
import {
  isBuiltinR3fContract,
  type R3fAuthoringDiagnostic,
  type R3fComponentContract,
  type R3fTypeAlias,
  runtimeMotionRefs,
} from './oid-transform';
import {
  type ContractHost,
  type ModuleAnalysis,
  ProjectContractResolver,
} from './r3f-contract-resolver';
import { parseAuthoringTsx } from './ts-ast';

/** Re-exported from its declaration site. The type moved to `oid-transform.ts`
 *  (browser-safe, no `node:fs`) when H5 made a diagnostic travel on an
 *  `OidEntry`; this module still PRODUCES them, and remains the import site
 *  every existing caller already uses. */
export type { R3fAuthoringDiagnostic };

/**
 * THE ON-DISK HALF OF THE WALK, CACHED ACROSS CALLS — stamped by the file's
 * own bytes, so it still "naturally tracks the latest bytes on disk without a
 * cache invalidation protocol" (the property the fresh-resolver-per-call rule
 * below exists to keep), while no longer re-deriving the same unchanged module
 * once per importer.
 *
 * WHY IT HAD TO EXIST. `uiOidPlugin`'s `transform` builds one resolver per
 * MODULE TRANSFORM (`vite-plugin-ui-oid.ts`, `importedR3fContracts(code,
 * clean)`), and each resolver walks that module's whole transitive
 * RELATIVE-import closure with `ts.createSourceFile`. The per-resolver cache
 * therefore only ever helped inside one file's walk and was thrown away
 * immediately after, so a project's shared modules were re-parsed once per
 * importer — quadratic in the shared-component fan-in, and invisible on a
 * small project. Measured on an imported 3D FPS project port (528 source files,
 * ~200 project modules served during one editor boot), V8 CPU profile of the
 * dev server across the whole ready -> page-bound window: **46.9s of 72.7s
 * sampled (64.5%) inside `typescript.js`**, entered from here and from
 * `oid-transform.ts`. The server's event loop was blocked ~80-90% of every
 * 5s bucket for two minutes, which is why a static `editor-mark.svg` took
 * 38s to serve and the browser's own module waterfall could not start.
 *
 * THE STAMP IS TAKEN TWICE, AROUND THE READ. A single stat cannot tell a
 * concurrent save from a quiet file: stat-then-read caches new bytes under an
 * old stamp, read-then-stat caches old bytes under a new one, and either way
 * the entry is stale FOREVER because its stamp looks current. Only a
 * before/after pair that AGREES proves nothing was written across the read;
 * a disagreeing pair is simply not cached (the analysis is still returned).
 */
const analysisByFile = new Map<string, { stamp: string; analysis: ModuleAnalysis }>();
/** Bound: a dev session may open many projects, and nothing else evicts. */
const MAX_CACHED_ANALYSES = 4096;

function fileStamp(file: string): string | null {
  try {
    const stat = statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

/** The dev server's host: `node:fs` reads, `node:path` joins, and the
 *  stamp-checked shared cache described above. */
const nodeContractHost: ContractHost = {
  read(file) {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  },
  exists: (file) => existsSync(file),
  resolve: (fromFile, specifier) => resolve(dirname(fromFile), specifier),
  extname: (file) => extname(file),
  join: (base, name) => resolve(base, name),
  analyzeFileCached(file, analyze) {
    const shared = analysisByFile.get(file);
    const before = fileStamp(file);
    if (shared && before !== null && shared.stamp === before) return shared.analysis;
    const analysis = analyze();
    // Only a stamp that is unchanged ACROSS the read describes these bytes.
    if (before !== null && fileStamp(file) === before) {
      if (analysisByFile.size >= MAX_CACHED_ANALYSES) analysisByFile.clear();
      analysisByFile.set(file, { stamp: before, analysis });
    }
    return analysis;
  },
};

function newResolver(): ProjectContractResolver {
  return new ProjectContractResolver(nodeContractHost);
}

/** Resolve the contracts of component identifiers imported into one source
 * module. A fresh resolver per call makes save/HMR behavior naturally track
 * the latest bytes on disk without a cache invalidation protocol; the walk's
 * on-disk half reuses {@link analysisByFile}, which keeps that property by
 * stamping every entry with the bytes it was derived from. */
export function importedR3fContracts(
  code: string,
  file: string,
): Map<string, R3fComponentContract> {
  return newResolver().importedForSource(code, file);
}

/** The prop-shape type aliases one module's relative imports bring into
 * scope, under their local names — the alias half of `importedR3fContracts`,
 * and the other input `transformSource` needs to read a shared prop shape. */
export function importedR3fTypeAliases(code: string, file: string): Map<string, R3fTypeAlias> {
  return newResolver().typeAliasesForSource(code, file);
}

/** All local and imported component bindings visible to one module. Used by
 * the live index endpoint to refresh metadata after a shared component HMRs. */
export function visibleR3fContracts(code: string, file: string): Map<string, R3fComponentContract> {
  return newResolver().analyzeSource(code, file).visible;
}

/**
 * The component a `default` export names, when the export is
 * `export default World` or `export default function World() {…}`.
 *
 * A three root's entry module default-exports its component (D26,
 * `r3fRootFactory`) — the same contract dom roots use. That component IS the
 * adapter root, so the single-spatial-root rule must not fire on it: a world
 * legitimately returns a fragment of lights, scenery and players.
 */
function defaultExportedComponent(sf: ts.SourceFile): string | null {
  let name: string | null = null;
  const visit = (node: ts.Node): void => {
    if (name) return;
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      if (ts.isIdentifier(node.expression)) name = node.expression.text;
    } else if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
    ) {
      name = node.name.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return name;
}

function locationOf(sf: ts.SourceFile, node: ts.Node): { line: number; col: number } {
  const location = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { line: location.line + 1, col: location.character };
}

function componentNameOfFunction(node: ts.SignatureDeclaration): string | null {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  const parent = node.parent;
  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) ? parent.name.text : null;
}

/** Return the component whose direct return value is `element`; nested visual
 * children intentionally return null. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this is a bounded parent-chain type dispatcher over TypeScript syntax.
function returnedRootComponent(element: ts.JsxElement | ts.JsxSelfClosingElement): string | null {
  let cursor: ts.Node | undefined = element.parent;
  while (cursor) {
    if (ts.isJsxElement(cursor) || ts.isJsxFragment(cursor)) return null;
    if (ts.isReturnStatement(cursor)) {
      let owner: ts.Node | undefined = cursor.parent;
      while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;
      return owner && ts.isFunctionLike(owner) ? componentNameOfFunction(owner) : null;
    }
    if (ts.isArrowFunction(cursor) && cursor.body === element) {
      return componentNameOfFunction(cursor);
    }
    if (ts.isFunctionLike(cursor)) return null;
    cursor = cursor.parent;
  }
  return null;
}

/**
 * R3F002's subject: a component with one native root that does not route every
 * authored transform channel to it.
 *
 * A simulation-owned root is NOT that (FX-9/PD-11). The component's own source
 * already says who writes the transform — it takes no transform prop and drives
 * its root ref every frame — so asking it to "keep instances movable" asks for
 * an authored placement the next tick overwrites. The warning was permanent and
 * unactionable on exactly the components (prey, projectiles, anything mapped
 * over simulation state) it fired on most.
 */
function needsForwardedTransforms(
  contract: R3fComponentContract | undefined,
): contract is R3fComponentContract {
  return (
    contract?.root === 'single' &&
    contract.transformProps.length < 3 &&
    !contract.simulationOwnedTransform
  );
}

/**
 * True when this callsite is one item of a rendered list — inside a `.map(…)`
 * callback and carrying React's own `key`.
 *
 * R3F004 asks for a `name` so an instance is recognizable in the hierarchy. A
 * keyed list item is generated from data, not hand-placed: a literal `name`
 * would give every item the SAME row label (worse than none), and the honest
 * name is derived per item — `name={`rabbit-${i}`}`, which R3F004 already
 * accepts, since it asks for the prop and never for a literal. Warning when the
 * author has not derived one turns a suggestion into permanent noise on
 * legitimate code, so a keyed map instance is left alone.
 */
function isKeyedListItem(
  element: ts.JsxElement | ts.JsxSelfClosingElement,
  opening: ts.JsxOpeningLikeElement,
  sf: ts.SourceFile,
): boolean {
  const keyed = opening.attributes.properties.some(
    (property) => ts.isJsxAttribute(property) && property.name.getText(sf) === 'key',
  );
  if (!keyed) return false;
  for (let cursor: ts.Node | undefined = element.parent; cursor; cursor = cursor.parent) {
    if (
      ts.isCallExpression(cursor) &&
      ts.isPropertyAccessExpression(cursor.expression) &&
      cursor.expression.name.text === 'map'
    ) {
      return true;
    }
  }
  return false;
}

export interface R3fAuthoringDiagnosticsOptions {
  /**
   * The caller has RESOLVED this file's region and it is a `three` one —
   * `server/project-root-surface.ts`'s `resolveOidSurface`, which reads the
   * region's declared `include` globs, the manifest's root entries, and live
   * import reach. Absent or `false` means the caller resolved something else,
   * or resolved nothing, and this analyzer stays silent.
   *
   * It USED to default to a source-text sniff — does this file's text name
   * `@react-three/fiber`? — and that sniff is the reason a project could not
   * centralize its R3F imports: a terminal whose 138 components take their
   * prop shape from one shared `prefab.ts` and otherwise render nothing but
   * intrinsic `<group>`/`<mesh>` tags had 12 files pass it and 126 SILENTLY
   * SKIPPED, reported as no findings. Silence that cannot be distinguished
   * from a clean bill of health is the worst thing an analyzer can produce,
   * and reach answers all 138 because reach does not care where a project
   * keeps its imports.
   *
   * Refusing to answer without a resolved surface is not a smaller analyzer,
   * it is an honest one: a project's DOM regions run through here too
   * (`project-validation.ts` validates every source file, whatever its
   * adapter), and every rule below would fire on a `<div>`-rooted component —
   * R3F002 would tell it to forward `position`. A caller with no region answer
   * has an AMBIGUOUS file, which `resolveOidSurface` already reports as
   * `OID001`/`OID002` with the declaration that fixes it.
   */
  knownThreeSurface?: boolean;
}

/** Convention diagnostics for ordinary R3F source. These are warnings, not a
 * validity gate: every valid R3F program still runs, while the editor explains
 * why a component would be only partially authorable. */
export function r3fAuthoringDiagnostics(
  code: string,
  file: string,
  opts?: R3fAuthoringDiagnosticsOptions,
): R3fAuthoringDiagnostic[] {
  if (!opts?.knownThreeSurface) return [];
  const analysis = newResolver().analyzeSource(code, file);
  const sf = parseAuthoringTsx(file, code);
  const diagnostics: R3fAuthoringDiagnostic[] = [];
  const diagnosedDefinitions = new Set<string>();
  const diagnosedMultiRoots = new Set<string>();
  const diagnosedMotionRoots = new Set<string>();
  // `export default World` IS the adapter root (D26 — the one entry shape).
  const adapterRootComponents = new Set<string>();
  const defaultExport = defaultExportedComponent(sf);
  if (defaultExport) adapterRootComponents.add(defaultExport);
  const motionRefs = runtimeMotionRefs(sf, sf);

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one read-only AST walk keeps the related authoring convention diagnostics on one traversal.
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      /^[A-Z]/.test(node.name.text) &&
      !adapterRootComponents.has(node.name.text)
    ) {
      const contract = analysis.visible.get(node.name.text);
      if (contract?.root === 'multiple') {
        diagnosedMultiRoots.add(node.name.text);
        diagnostics.push({
          code: 'R3F003',
          severity: 'warning',
          file,
          ...locationOf(sf, node.name),
          component: node.name.text,
          message: `${node.name.text} returns multiple spatial roots. Wrap them in one ordinary group so the instance has integral selection, grouping, and transform semantics.`,
        });
      }
      if (needsForwardedTransforms(contract)) {
        diagnosedDefinitions.add(node.name.text);
        const missing = ['position', 'rotation', 'scale'].filter(
          (channel) =>
            !contract.transformProps.includes(channel as 'position' | 'rotation' | 'scale'),
        );
        diagnostics.push({
          code: 'R3F002',
          severity: 'warning',
          file,
          ...locationOf(sf, node.name),
          component: node.name.text,
          message: `${node.name.text} does not forward ${missing.join(', ')} to its ${contract.rootTag ?? 'native'} root. Accept and spread the matching ThreeElements props to keep instances movable.`,
        });
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /^[A-Z]/.test(node.name.text) &&
      !adapterRootComponents.has(node.name.text)
    ) {
      const contract = analysis.visible.get(node.name.text);
      if (!diagnosedMultiRoots.has(node.name.text) && contract?.root === 'multiple') {
        diagnosedMultiRoots.add(node.name.text);
        diagnostics.push({
          code: 'R3F003',
          severity: 'warning',
          file,
          ...locationOf(sf, node.name),
          component: node.name.text,
          message: `${node.name.text} returns multiple spatial roots. Wrap them in one ordinary group so the instance has integral selection, grouping, and transform semantics.`,
        });
      }
      if (!diagnosedDefinitions.has(node.name.text) && needsForwardedTransforms(contract)) {
        const missing = ['position', 'rotation', 'scale'].filter(
          (channel) =>
            !contract.transformProps.includes(channel as 'position' | 'rotation' | 'scale'),
        );
        diagnostics.push({
          code: 'R3F002',
          severity: 'warning',
          file,
          ...locationOf(sf, node.name),
          component: node.name.text,
          message: `${node.name.text} does not forward ${missing.join(', ')} to its ${contract.rootTag ?? 'native'} root. Accept and spread the matching ThreeElements props to keep instances movable.`,
        });
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      const contract = analysis.visible.get(tag);
      const element = ts.isJsxOpeningElement(node) ? node.parent : node;
      // A `name` the analyzer can SEE, or one it cannot prove absent. A spread
      // of an opaque props object (`<EnemyBody {...props} />`) carries whatever
      // the caller passed, `name` included — which is the whole point of a
      // guard wrapper that re-renders its own props — so claiming the element
      // "has no name" states as fact something this analyzer cannot read. An
      // object LITERAL spread is readable, so it is still checked.
      const hasName = node.attributes.properties.some((property) => {
        if (ts.isJsxAttribute(property)) return property.name.getText(sf) === 'name';
        if (ts.isJsxSpreadAttribute(property)) {
          if (!ts.isObjectLiteralExpression(property.expression)) return true;
          return property.expression.properties.some(
            (member) => member.name !== undefined && member.name.getText(sf) === 'name',
          );
        }
        return false;
      });
      const ref = node.attributes.properties.find(
        (property) => ts.isJsxAttribute(property) && property.name.getText(sf) === 'ref',
      );
      const refExpression =
        ref &&
        ts.isJsxAttribute(ref) &&
        ref.initializer &&
        ts.isJsxExpression(ref.initializer) &&
        ref.initializer.expression &&
        ts.isIdentifier(ref.initializer.expression)
          ? ref.initializer.expression
          : null;
      const rootComponent = returnedRootComponent(element);
      if (
        rootComponent &&
        !adapterRootComponents.has(rootComponent) &&
        refExpression &&
        motionRefs.has(refExpression.text) &&
        // Nothing to fight over: this component exposes no authorable
        // transform, so there is no editor value for the runtime to overwrite.
        !analysis.visible.get(rootComponent)?.simulationOwnedTransform &&
        !diagnosedMotionRoots.has(rootComponent)
      ) {
        diagnosedMotionRoots.add(rootComponent);
        diagnostics.push({
          code: 'R3F005',
          severity: 'warning',
          file,
          ...locationOf(sf, refExpression),
          component: rootComponent,
          message: `${rootComponent} animates its authored outer root through useFrame. Keep the outer root stable and animate an inner child so editor transforms do not fight runtime motion.`,
        });
      }
      if (
        /^[A-Z]/.test(tag) &&
        contract?.root === 'single' &&
        // A package component vgai knows only through the built-in table is not
        // a hierarchy row of its own — `<RigidBody>` never receives the editor's
        // stamp, so its props are attributed to the node it wraps
        // (`collapsedWrappersOf`). Naming it would name nothing.
        !isBuiltinR3fContract(contract) &&
        !hasName &&
        !isKeyedListItem(element, node, sf)
      ) {
        diagnostics.push({
          code: 'R3F004',
          severity: 'warning',
          file,
          ...locationOf(sf, node),
          component: tag,
          message: `${tag} has no name. Add the ordinary R3F name prop so its instance is recognizable in the hierarchy.`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return diagnostics;
}
