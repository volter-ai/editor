/**
 * OID instrumentation (C1/C2) — the visual-edit "stamp every JSX element with a
 * stable source id" trick, ported to vgai using the TypeScript compiler API
 * (vgai has `typescript`; it does NOT have @babel/*). Hand-authored React UI
 * component source is transformed at build/dev time to carry a `data-oid` on every
 * JSX element, and an OID -> {file,line,col,component,tag} index is built so the
 * editor can map a clicked element back to its exact source location.
 *
 * Stability (C1): unlike visual-edit's line:col key (which shifts every id below an
 * edit), we key by a CONTENT signature `component:tag:nthOccurrence`, so an edit on
 * an unrelated line keeps existing ids stable. The `data-oid` lives ONLY in the
 * transformed output, never on disk (the writer edits the original source instead).
 */
import ts from 'typescript';
import {
  environmentBindingsByElement,
  type R3fEnvironmentBinding,
} from './r3f-environment-binding';
import { jointBindingsByElement, type R3fJointBinding } from './r3f-joint-binding';
import { lodBindingsByElement, type R3fLodBinding } from './r3f-lod-binding';
import { particleBindingsByElement, type R3fParticleBinding } from './r3f-particle-binding';
import { physicsBindingsByElement, type R3fPhysicsBinding } from './r3f-physics-binding';
import { parseAuthoringTsx, refIdentifier } from './ts-ast';

export type {
  R3fEnvironmentBinding,
  R3fEnvironmentNumberBinding,
  R3fEnvironmentStringBinding,
} from './r3f-environment-binding';
export type {
  R3fJointBinding,
  R3fJointHook,
  R3fJointLiteral,
  R3fJointLiteralRange,
} from './r3f-joint-binding';
export type { R3fLodBinding, R3fLodNumberBinding } from './r3f-lod-binding';
export type {
  QuarksEmitterShape,
  R3fParticleBinding,
  R3fParticleNumberBinding,
} from './r3f-particle-binding';
export type { PhysicsChannel, R3fPhysicsBinding } from './r3f-physics-binding';

export interface OidEntry {
  file: string;
  line: number; // 1-based
  col: number; // 0-based (matches ts char)
  component: string | null;
  tag: string;
  /**
   * R3F-only, source-proven authoring contract for a LOCAL custom component
   * callsite. `undefined` means the component definition is not in this file
   * (usually an import), so the editor must retain its conservative fallback.
   *
   * A single native root plus forwarded standard group props is ordinary R3F,
   * not a vgai wrapper. Recording it here lets the editor safely ADD an absent
   * transform prop at the callsite: the source analyser has proven where that
   * prop lands. An empty `transformProps` list is an equally useful result —
   * the local component exists, but exposes no writable spatial channel.
   */
  r3fAuthoring?: R3fComponentContract;
  /**
   * The props the tag's component DECLARES — resolved server-side through the
   * TypeScript type checker (`component-prop-types.ts`) and shipped here so
   * the editor can inspect a node by its declared surface rather than by the
   * attributes someone happened to write. Absent for a native tag, or when the
   * definition could not be resolved; the editor then falls back to reading
   * the authored attributes alone.
   */
  props?: ComponentPropSpec[];
  /**
   * True once the server-side declared-prop resolver has ANSWERED for this
   * tag — present even when the answer was "no props". Distinguishes "the
   * declaration rung has not landed yet" (the resolver's cold ts.Program
   * takes seconds and enrichment is async) from "the resolver looked and
   * found nothing": the inspector's no-declaration warning is honest only in
   * the second state. Measured on racing-game: the doctor's sweep inspected
   * before the cold program answered, the fallback warned once-per-key, and
   * the session ledger held six "No declaration covers" rows for props the
   * resolver demonstrably types (`allowSleep:boolean`, `broadphase:enum`, …).
   */
  propsResolved?: true;
  /** Props physically authored on this JSX callsite. Unlike {@link props},
   * which describes the component declaration, this is the byte-level answer
   * needed by instance editing: an override exists only when the attribute is
   * present here, and applying it to the component is safe only when its source
   * value is a literal. */
  authoredProps?: Array<{
    name: string;
    valueText: string;
    literal: boolean;
  }>;
  /**
   * The R3F authorability diagnostics that pertain to THIS element, attached
   * server-side by `currentOidIndex` so they ride the exact same
   * `/__ui-source/index` payload (and therefore the exact same freshness) as
   * every other source-derived field on this entry. Absent when there are
   * none.
   *
   * Two kinds land here, both selected by `fileDiagnosticJoin`:
   * the diagnostic recorded AT this element (an R3F004 "has no name" on this
   * very callsite), and the ones recorded against the component whose body
   * lexically contains it (R3F002/R3F003/R3F005 — `component` matches). The
   * second is what carries a definition-side warning out to the rows that
   * INSTANTIATE that component: an instance's boundary object also carries its
   * definition-root oid, so the client reads both entries. See
   * `r3f-diagnostic-index.ts`.
   */
  diagnostics?: R3fAuthoringDiagnostic[];
  /**
   * The oid of the JSX element that lexically ENCLOSES this one, in the same
   * file. Recorded because a wrapper tag does not always become its own node:
   * `<RigidBody>` from `@react-three/rapier` never forwards the editor's stamp
   * to the Object3D it renders, so it has no live object to select — yet its
   * props (`type`, `gravityScale`, colliders) are exactly the configuration an
   * author expects to find on the thing inside it. This chain is what lets the
   * inspector attribute a collapsed wrapper's props to the node it wraps.
   */
  parentOid?: string;
  /**
   * The PHYSICS BODY that owns this element's transform, when a simulation
   * binding attached one to its ref (`r3f-physics-binding.ts`).
   *
   * Present ⇒ this element's own `position`/`rotation`/`scale` props are dead
   * on arrival: the body writes the object's matrix every frame from ITS OWN
   * spawn, so a write here produces source that contradicts the running world.
   * Every writer reads it as a refusal that can name the binding, and the
   * component contract reads its `forwarded` channels as real forwarding —
   * which is what routes the write to the callsite literal the hook reads.
   */
  physicsBinding?: R3fPhysicsBinding;
  /** Native Rapier joint hooks that name this `<RigidBody ref={…}>` as one
   * endpoint. Hook parameters remain the project's TSX source of truth. */
  jointBindings?: readonly R3fJointBinding[];
  /** Native three.quarks shape construction bound to this emitter primitive. */
  particleBinding?: R3fParticleBinding;
  /** Drei Detailed is a source projection of the native THREE.LOD it creates. */
  lodBinding?: R3fLodBinding;
  /** Native Fiber scene attachment (`background` or `fog`). */
  environmentBinding?: R3fEnvironmentBinding;
}

/**
 * One R3F authoring-convention warning.
 *
 * DECLARED HERE, not in its producer. `r3f-project-contracts.ts` computes
 * these (and re-exports this type for its existing importers), but that module
 * imports `node:fs` — while this one is deliberately dependency-free so a
 * PAGE can import it. Since a diagnostic now travels ON an `OidEntry` (see its
 * `diagnostics` field), the TYPE has to live on the browser-safe side of that
 * line even though the ANALYSIS does not.
 */
export interface R3fAuthoringDiagnostic {
  code: 'R3F002' | 'R3F003' | 'R3F004' | 'R3F005';
  severity: 'warning';
  file: string;
  /** 1-based, and computed from `node.getStart()` — the SAME position basis
   *  `OidEntry.line`/`col` use, which is what makes an exact positional join
   *  between the two sound rather than approximate. */
  line: number;
  col: number;
  /** The component the warning is ABOUT: the definition it names (R3F002/3/5)
   *  or the tag at the offending callsite (R3F004). */
  component: string;
  message: string;
}

/**
 * A prop as DECLARED by a component, independent of any callsite. Lives here
 * beside `OidEntry` because it travels on it; it is PRODUCED by
 * `component-prop-types.ts` (server-side, needs a `ts.Program`) and CONSUMED
 * by the editor's authoring adapters.
 */
export interface ComponentPropSpec {
  name: string;
  /** Inspector widget implied by the declared type; `null` when no widget
   *  honestly represents it (the consumer falls back to the attribute text). */
  type: 'string' | 'number' | 'boolean' | 'enum' | 'vec3' | 'json' | null;
  /** Allowed values, for a union of string literals. */
  options?: Array<string | number>;
  /** Declared `?:`, or given a default by the component's destructuring. */
  optional: boolean;
  /** The default's source text (`1.55`, `'raider'`, `defaultSpawn()`). */
  defaultText?: string;
  /** The default as a value, when the default is a literal. */
  defaultValue?: string | number | boolean | number[];
  /** The prop's jsdoc, as one line. */
  doc?: string;
}

function literalJsxExpression(expression: ts.Expression | undefined): boolean {
  if (!expression) return false;
  if (
    ts.isStringLiteral(expression) ||
    ts.isNumericLiteral(expression) ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return true;
  }
  if (!ts.isArrayLiteralExpression(expression)) return false;
  return expression.elements.every(
    (element) =>
      ts.isNumericLiteral(element) ||
      (ts.isPrefixUnaryExpression(element) &&
        element.operator === ts.SyntaxKind.MinusToken &&
        ts.isNumericLiteral(element.operand)),
  );
}

function authoredPropsOf(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile,
): NonNullable<OidEntry['authoredProps']> {
  return node.attributes.properties.flatMap((property) => {
    if (!ts.isJsxAttribute(property)) return [];
    const name = property.name.getText(sourceFile);
    const initializer = property.initializer;
    if (!initializer) return [{ name, valueText: 'true', literal: true }];
    if (ts.isStringLiteral(initializer)) {
      return [{ name, valueText: initializer.getText(sourceFile), literal: true }];
    }
    if (!ts.isJsxExpression(initializer)) return [];
    return [
      {
        name,
        valueText: initializer.expression?.getText(sourceFile) ?? '',
        literal: literalJsxExpression(initializer.expression),
      },
    ];
  });
}

/** Persistent oid store: signature -> oid (kept stable across re-transforms). */
export class OidStore {
  private bySig = new Map<string, string>();
  private counter = 0;
  readonly index = new Map<string, OidEntry>();

  getOrCreate(sig: string): string {
    let oid = this.bySig.get(sig);
    if (!oid) {
      this.counter += 1;
      oid = `o${this.counter.toString(36)}${hash(sig).toString(36)}`;
      this.bySig.set(sig, oid);
    }
    return oid;
  }

  /** Clear index entries for a file before re-transforming it. */
  clearFile(file: string): void {
    for (const [oid, e] of this.index) if (e.file === file) this.index.delete(oid);
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

interface SourceEdit {
  pos: number;
  end?: number;
  text: string;
}

export type R3fTransformProp = 'position' | 'rotation' | 'scale';

export interface R3fComponentContract {
  root: 'single' | 'multiple' | 'non-spatial' | 'unknown';
  rootTag?: string;
  transformProps: R3fTransformProp[];
  /** The callsite's native `visible` prop is proven to reach the single
   * Object3D root. Omitted is deliberately false/unknown, so an editor never
   * writes a decorative prop that the component silently ignores. */
  visibleProp?: true;
  /**
   * The component's own source says the SIMULATION owns this transform: it
   * neither accepts nor spreads a transform prop, and it writes its root's
   * `position`/`rotation`/`quaternion`/`scale` through a ref every frame
   * inside `useFrame`.
   *
   * Present (and only ever `true`) when both halves hold, so a contract that
   * predates the distinction compares equal to one that has no opinion.
   *
   * This is a DECLARATION OF NON-AUTHORABILITY, never of authorability:
   * `transformProps` stays empty, so every writer path
   * (`transformEditability`) still refuses the edit — with an honest reason
   * instead of "does not forward position". What it buys is silence from the
   * convention diagnostics whose premise it falsifies (R3F002 asks the
   * component to forward an authored transform the simulation would overwrite
   * on the next tick; R3F005 warns that runtime motion fights an editor
   * transform that cannot exist here).
   */
  simulationOwnedTransform?: boolean;
  /**
   * The subset of {@link transformProps} this component forwards to a PHYSICS
   * BODY BINDING rather than to its native root — the channels whose callsite
   * literal is read by a `useBox(…)`-family hook (`r3f-physics-binding.ts`).
   *
   * The write is exactly as real as any other forwarded prop, which is why
   * these are IN `transformProps`; what this field adds is WHY it is real, and
   * that fact has a consequence no other prop has: a body re-spawns from this
   * literal and then owns the node's matrix, so the authored value must survive
   * the re-settle after a remount. That is the `physics-binding`
   * {@link WriteAnchorKind}'s own contract, and this is the source fact the
   * planner reads to classify an anchor as one.
   *
   * Absent (never `[]`) when nothing is forwarded to a binding, so a contract
   * that predates the distinction compares equal to one that has no opinion —
   * the same rule `simulationOwnedTransform` above follows, and one the
   * fixed-point loop in `collectR3fComponentContracts` depends on.
   */
  bodyForwarded?: R3fTransformProp[];
}

const R3F_TRANSFORM_PROPS = ['position', 'rotation', 'scale'] as const;

/**
 * Contracts for components vgai does NOT own, keyed by package specifier and
 * export name. The project resolver reads a local component's contract out of
 * its own source; an installed package has no source to walk from the browser
 * tier and no reason to expect one, so the few whose native root is part of the
 * package's documented public API are recorded here instead.
 *
 * Deliberately tiny and hand-audited. Everything absent from this table stays
 * conservative (`root: 'unknown'`), because guessing at a dependency's scene
 * ownership is how an editor writes a prop the library silently ignores.
 *
 * `@react-three/rapier`'s `<RigidBody>` renders one host `object3D` and passes
 * `position`/`rotation`/`scale` straight to it — the body's initial transform is
 * read back off that object, and rapier scales the colliders it owns by the
 * object's world scale — so a transform written at the callsite lands exactly
 * where the editor claims it does.
 *
 * `rootTag` is `group`, not `object3D`, because the tag is proved against the
 * CALLER's props type: `typeAllowsStandardRootProps` looks for the literal text
 * `ThreeElements['<rootTag>']`, and a component forwarding to a RigidBody types
 * its props as `ThreeElements['group'] & …` — the ordinary R3F spelling for "a
 * spatial container". `object3D` would match no real caller.
 */
const BUILTIN_R3F_CONTRACTS: Readonly<
  Record<string, Readonly<Record<string, R3fComponentContract>>>
> = {
  '@react-three/rapier': {
    RigidBody: { root: 'single', rootTag: 'group', transformProps: [...R3F_TRANSFORM_PROPS] },
  },
};

/**
 * Package prop types that are themselves a proved native-root prop surface.
 * Kept beside the component contract because both facts come from the same
 * hand-audited public API. This lets ordinary wrappers preserve the package's
 * own type (`Omit<RigidBodyProps, ...>`) without pretending every imported
 * type is spatial.
 */
const BUILTIN_R3F_ROOT_PROP_TYPES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  '@react-three/rapier': { RigidBodyProps: 'group' },
};

/** Local imported type binding → native root tag it proves. */
function builtinRootPropTypes(sf: ts.SourceFile): Map<string, string> {
  const bound = new Map<string, string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const known = BUILTIN_R3F_ROOT_PROP_TYPES[statement.moduleSpecifier.text];
    const bindings = statement.importClause?.namedBindings;
    if (!known || !bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      const rootTag = known[importedName];
      if (rootTag) bound.set(element.name.text, rootTag);
    }
  }
  return bound;
}

/** True for a contract that came from the table above rather than from source.
 *  Identity, not shape: a project-local definition that SHADOWS an imported
 *  binding produces its own freshly analysed object, so it is never mistaken
 *  for the package's. */
export function isBuiltinR3fContract(contract: R3fComponentContract | undefined): boolean {
  if (!contract) return false;
  return Object.values(BUILTIN_R3F_CONTRACTS).some((exports) =>
    Object.values(exports).includes(contract),
  );
}

/** The built-in contract for one named export of an external package, if any. */
export function builtinR3fContract(
  specifier: string,
  exportName: string,
): R3fComponentContract | undefined {
  return BUILTIN_R3F_CONTRACTS[specifier]?.[exportName];
}

/** The local bindings ONE import declaration takes from the built-in table.
 *  Keyed by the LOCAL name, so `import { RigidBody as RB }` registers `RB`. */
export function builtinR3fContractsOfImport(
  declaration: ts.ImportDeclaration,
): Map<string, R3fComponentContract> {
  const bound = new Map<string, R3fComponentContract>();
  if (!ts.isStringLiteral(declaration.moduleSpecifier)) return bound;
  const bindings = declaration.importClause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return bound;
  for (const element of bindings.elements) {
    const contract = builtinR3fContract(
      declaration.moduleSpecifier.text,
      element.propertyName?.text ?? element.name.text,
    );
    if (contract) bound.set(element.name.text, contract);
  }
  return bound;
}

/** Every built-in contract one module's imports bring into scope. The browser
 *  tier has no filesystem to resolve project-local imports from, so this is the
 *  whole of the contract knowledge available to it. */
export function builtinR3fContractsForSource(
  code: string,
  file: string,
): Map<string, R3fComponentContract> {
  const sf = parseAuthoringTsx(file, code);
  const contracts = new Map<string, R3fComponentContract>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    for (const [name, contract] of builtinR3fContractsOfImport(statement)) {
      contracts.set(name, contract);
    }
  }
  return contracts;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function returnedExpression(body: ts.ConciseBody): ts.Expression | undefined {
  if (!ts.isBlock(body)) return unwrapExpression(body);
  const returns = body.statements.filter(ts.isReturnStatement);
  if (returns.length !== 1 || !returns[0]?.expression) return undefined;
  return unwrapExpression(returns[0].expression);
}

/**
 * A type alias and the file it was written in.
 *
 * These travel together because `ts.Node.getText(sf)` reads the node's
 * position range out of the SOURCE TEXT it is handed: give it another file's
 * `SourceFile` and it returns whatever characters happen to sit at those
 * offsets. An alias resolved across a module boundary is exactly that case.
 */
export interface R3fTypeAlias {
  readonly type: ts.TypeNode;
  readonly sf: ts.SourceFile;
}

/** The `export type X = …` declarations of one module, for importers. */
export function exportedR3fTypeAliases(sf: ts.SourceFile): Map<string, R3fTypeAlias> {
  const aliases = new Map<string, R3fTypeAlias>();
  for (const statement of sf.statements) {
    if (!ts.isTypeAliasDeclaration(statement)) continue;
    if (!ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    aliases.set(statement.name.text, { type: statement.type, sf });
  }
  return aliases;
}

function textIncludesBuiltinRootProps(
  text: string,
  rootTag: string,
  builtinPropTypes: ReadonlyMap<string, string>,
): boolean {
  for (const [name, knownRootTag] of builtinPropTypes) {
    if (knownRootTag === rootTag && new RegExp(`\\b${name}\\b`).test(text)) return true;
  }
  return false;
}

function typeAllowsStandardRootProps(
  type: ts.TypeNode | undefined,
  rootTag: string,
  sf: ts.SourceFile,
  typeAliases: ReadonlyMap<string, R3fTypeAlias>,
  builtinPropTypes: ReadonlyMap<string, string>,
  seen = new Set<string>(),
): boolean {
  if (!type) return false;
  const text = type.getText(sf);
  const escapedRootTag = rootTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\bThreeElements\\s*\\[\\s*['"]${escapedRootTag}['"]\\s*\\]`).test(text))
    return true;
  if (textIncludesBuiltinRootProps(text, rootTag, builtinPropTypes)) return true;
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const name = type.typeName.text;
    if (seen.has(name)) return false;
    const alias = typeAliases.get(name);
    if (!alias) return false;
    seen.add(name);
    return typeAllowsStandardRootProps(
      alias.type,
      rootTag,
      alias.sf,
      typeAliases,
      builtinPropTypes,
      seen,
    );
  }
  for (const [name, alias] of typeAliases) {
    if (seen.has(name) || !new RegExp(`\\b${name}\\b`).test(text)) continue;
    const nextSeen = new Set(seen).add(name);
    if (
      typeAllowsStandardRootProps(
        alias.type,
        rootTag,
        alias.sf,
        typeAliases,
        builtinPropTypes,
        nextSeen,
      )
    )
      return true;
  }
  return false;
}

function spatialRootOpening(expression: ts.Expression): ts.JsxOpeningLikeElement | undefined {
  if (ts.isJsxSelfClosingElement(expression)) return expression;
  if (!ts.isJsxElement(expression)) return undefined;
  return expression.openingElement;
}

type FragmentRootCardinality = 0 | 1 | 'multiple' | 'unknown';

function combineFragmentRootCardinality(
  left: FragmentRootCardinality,
  right: FragmentRootCardinality,
): FragmentRootCardinality {
  if (left === 'multiple' || right === 'multiple') return 'multiple';
  if (left === 'unknown' || right === 'unknown') return 'unknown';
  return left + right >= 2 ? 'multiple' : ((left + right) as 0 | 1);
}

function jsxRootCardinality(
  element: ts.JsxElement | ts.JsxSelfClosingElement,
  sf: ts.SourceFile,
  knownContracts: ReadonlyMap<string, R3fComponentContract>,
): FragmentRootCardinality {
  const opening = ts.isJsxElement(element) ? element.openingElement : element;
  const tag = opening.tagName.getText(sf);
  if (!/^[A-Z]/.test(tag)) return isNonSpatialNativeTag(tag) ? 0 : 1;
  const delegated = knownContracts.get(tag);
  if (!delegated || delegated.root === 'unknown') return 'unknown';
  if (delegated.root === 'non-spatial') return 0;
  return delegated.root === 'multiple' ? 'multiple' : 1;
}

function mappedRootCardinality(
  expression: ts.CallExpression,
  sf: ts.SourceFile,
  knownContracts: ReadonlyMap<string, R3fComponentContract>,
): FragmentRootCardinality | undefined {
  if (
    !ts.isPropertyAccessExpression(expression.expression) ||
    expression.expression.name.text !== 'map'
  ) {
    return undefined;
  }
  const callback = expression.arguments[0];
  if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
    return 'unknown';
  }
  const returned = returnedExpression(callback.body);
  if (!returned) return 'unknown';
  const item = expressionRootCardinality(returned, sf, knownContracts);
  // A map can emit any number of its item. It remains non-spatial only when
  // the item is proved non-spatial; every spatial item makes a plural result
  // possible, which is precisely the non-integral component shape R3F003
  // reports.
  return item === 0 ? 0 : item === 'unknown' ? 'unknown' : 'multiple';
}

function expressionRootCardinality(
  expression: ts.Expression,
  sf: ts.SourceFile,
  knownContracts: ReadonlyMap<string, R3fComponentContract>,
): FragmentRootCardinality {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.kind === ts.SyntaxKind.NullKeyword) return 0;
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return 0;
  if (ts.isJsxFragment(unwrapped)) {
    return fragmentRootCardinality(unwrapped, sf, knownContracts);
  }
  if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped)) {
    return jsxRootCardinality(unwrapped, sf, knownContracts);
  }
  if (ts.isCallExpression(unwrapped)) {
    return mappedRootCardinality(unwrapped, sf, knownContracts) ?? 'unknown';
  }
  return 'unknown';
}

function jsxChildRootCardinality(
  child: ts.JsxChild,
  sf: ts.SourceFile,
  knownContracts: ReadonlyMap<string, R3fComponentContract>,
): FragmentRootCardinality {
  if (ts.isJsxText(child)) return child.text.trim() === '' ? 0 : 'unknown';
  if (ts.isJsxExpression(child)) {
    return child.expression ? expressionRootCardinality(child.expression, sf, knownContracts) : 0;
  }
  if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
    return jsxRootCardinality(child, sf, knownContracts);
  }
  if (ts.isJsxFragment(child)) return fragmentRootCardinality(child, sf, knownContracts);
  return 'unknown';
}

function fragmentRootCardinality(
  fragment: ts.JsxFragment,
  sf: ts.SourceFile,
  knownContracts: ReadonlyMap<string, R3fComponentContract>,
): FragmentRootCardinality {
  let result: FragmentRootCardinality = 0;
  for (const child of fragment.children) {
    result = combineFragmentRootCardinality(
      result,
      jsxChildRootCardinality(child, sf, knownContracts),
    );
  }
  return result;
}

function fragmentComponentContract(
  fragment: ts.JsxFragment,
  sf: ts.SourceFile,
  knownContracts: ReadonlyMap<string, R3fComponentContract>,
): R3fComponentContract {
  const cardinality = fragmentRootCardinality(fragment, sf, knownContracts);
  if (cardinality === 0) return { root: 'non-spatial', transformProps: [] };
  if (cardinality === 'multiple') return { root: 'multiple', transformProps: [] };
  // A fragment with one proved spatial child, or an unresolved child, has no
  // fragment object of its own through which transform props can be proved to
  // flow. Keep it conservative without falsely claiming several roots.
  return { root: 'unknown', transformProps: [] };
}

/**
 * Native R3F tags that are NOT `Object3D`s.
 *
 * R3F's host namespace is all of three's constructors, not just the scene
 * graph: materials, geometries and buffer attributes are elements too, and
 * they mount by `attach` onto a parent rather than by taking a place in the
 * hierarchy. They have no `position`, no `rotation`, no `scale`, and they are
 * never a hierarchy row.
 *
 * A component whose single root is one of these is a perfectly ordinary R3F
 * idiom — a shared material helper returning `<meshStandardMaterial …/>` is
 * about as common as R3F code gets — and it must not be read as an
 * unauthorable spatial instance. R3F002 would demand it forward transform
 * channels the element does not have (there is no `position` prop on a
 * material to accept), and R3F004 would ask for a `name` "so its instance is
 * recognizable in the hierarchy" when nothing about it ever appears there.
 * Both are unactionable by construction, which is precisely the failure the
 * `simulationOwnedTransform` and keyed-list-item carve-outs already exist to
 * prevent elsewhere in these rules.
 *
 * Recognized by suffix because three's naming is regular here and the set is
 * open — every release adds materials and geometries, and an exhaustive list
 * would silently rot into false positives again. The three exact names are the
 * scene-level attachables that carry no suffix.
 */
function isNonSpatialNativeTag(tag: string): boolean {
  if (/^[A-Z]/.test(tag)) return false;
  return (
    /(Material|Geometry|Attribute)$/.test(tag) ||
    tag === 'fog' ||
    tag === 'fogExp2' ||
    tag === 'color'
  );
}

interface R3fPropForwarding {
  standardRootProps: boolean;
  wholePropsName?: string;
  restPropsName?: string;
  localBindingByProp: Map<R3fObjectProp, string>;
}

type R3fObjectProp = R3fTransformProp | 'visible';

function isR3fTransformProp(value: string): value is R3fTransformProp {
  return (R3F_TRANSFORM_PROPS as readonly string[]).includes(value);
}

function isR3fObjectProp(value: string): value is R3fObjectProp {
  return isR3fTransformProp(value) || value === 'visible';
}

function propForwarding(
  first: ts.ParameterDeclaration | undefined,
  rootTag: string,
  sf: ts.SourceFile,
  typeAliases: ReadonlyMap<string, R3fTypeAlias>,
  builtinPropTypes: ReadonlyMap<string, string>,
): R3fPropForwarding {
  const result: R3fPropForwarding = {
    standardRootProps: typeAllowsStandardRootProps(
      first?.type,
      rootTag,
      sf,
      typeAliases,
      builtinPropTypes,
    ),
    localBindingByProp: new Map(),
  };
  if (!first) return result;
  if (ts.isIdentifier(first.name)) {
    result.wholePropsName = first.name.text;
    return result;
  }
  if (!ts.isObjectBindingPattern(first.name)) return result;
  for (const element of first.name.elements) {
    if (element.dotDotDotToken && ts.isIdentifier(element.name)) {
      result.restPropsName = element.name.text;
      continue;
    }
    if (!ts.isIdentifier(element.name)) continue;
    const authoredName = element.propertyName?.getText(sf) ?? element.name.text;
    if (isR3fObjectProp(authoredName)) {
      result.localBindingByProp.set(authoredName, element.name.text);
    }
  }
  return result;
}

/**
 * Is this parameter's type spelled AS another component's props — the guard
 * wrapper's `Parameters<typeof Body>[0]` / `ComponentProps<typeof Body>`?
 *
 * Deliberately a spelling test and not a type check: this analyzer holds no
 * checker, and the one thing it needs to know is that the wrapper's props ARE
 * the delegate's, which the spelling states outright.
 */
function typeIsDelegateProps(
  type: ts.TypeNode | undefined,
  delegateTag: string,
  sf: ts.SourceFile,
): boolean {
  if (!type) return false;
  const text = type.getText(sf).replace(/\s+/g, '');
  const tag = delegateTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^(React\\.)?(Parameters<typeof${tag}>\\[0\\]|ComponentProps(WithoutRef|WithRef)?<typeof${tag}>)`,
  ).test(text);
}

function spreadForwardsAll(
  property: ts.JsxSpreadAttribute,
  forwarding: R3fPropForwarding,
): boolean {
  if (!forwarding.standardRootProps || !ts.isIdentifier(property.expression)) return false;
  return (
    property.expression.text === forwarding.wholePropsName ||
    property.expression.text === forwarding.restPropsName
  );
}

function attributeForwardsObjectProp(
  property: ts.JsxAttribute,
  forwarding: R3fPropForwarding,
  sf: ts.SourceFile,
): R3fObjectProp | undefined {
  const propName = property.name.getText(sf);
  if (!isR3fObjectProp(propName)) return undefined;
  if (!property.initializer || !ts.isJsxExpression(property.initializer)) return undefined;
  const value = property.initializer.expression;
  if (!value) return undefined;
  const localName = forwarding.localBindingByProp.get(propName);
  if (localName && ts.isIdentifier(value) && value.text === localName) return propName;
  if (
    forwarding.wholePropsName &&
    ts.isPropertyAccessExpression(value) &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === forwarding.wholePropsName &&
    value.name.text === propName
  ) {
    return propName;
  }
  return undefined;
}

function forwardedObjectProps(
  opening: ts.JsxOpeningLikeElement,
  forwarding: R3fPropForwarding,
  sf: ts.SourceFile,
): R3fObjectProp[] {
  const forwarded = new Set<R3fObjectProp>();
  for (const property of opening.attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      if (spreadForwardsAll(property, forwarding)) {
        for (const channel of R3F_TRANSFORM_PROPS) forwarded.add(channel);
        forwarded.add('visible');
      }
      continue;
    }
    const prop = attributeForwardsObjectProp(property, forwarding, sf);
    if (prop) forwarded.add(prop);
  }
  const ordered: readonly R3fObjectProp[] = [...R3F_TRANSFORM_PROPS, 'visible'];
  return ordered.filter((prop) => forwarded.has(prop));
}

/**
 * A ref whose `.current` transform is written inside a `useFrame` body — the
 * source-visible mark of runtime-driven motion.
 *
 * Optional chaining is part of the pattern, not an edge case: `useRef<
 * THREE.Group>(null)` types `.current` as nullable, so `body.current?.position
 * .copy(…)` is the ordinary spelling and `body.current.position.copy(…)` the
 * non-null-asserted one. Both must read the same.
 */
const RUNTIME_MOTION_MUTATION_RE =
  /\b([A-Za-z_$][\w$]*)\.current\??\.(?:position|rotation|quaternion|scale)(?:\??\.[xyzw]+)?\s*(?:[+\-*/]?=|\??\.(?:set|setScalar|copy|add|sub|multiply|lerp|slerp|fromArray)\s*\()/g;

/**
 * The refs any `useFrame` callback in `scope` drives every frame.
 *
 * Deliberately a regex over the callback's text rather than a resolved
 * dataflow analysis — the same honesty budget the rest of this module's source
 * evidence holds to, and the single derivation BOTH readers use (the contract
 * below, and R3F005 in `r3f-project-contracts.ts`) so the two can never
 * disagree about whether one component drives its own root.
 */
export function runtimeMotionRefs(scope: ts.Node, sf: ts.SourceFile): Set<string> {
  const refs = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && /(^|\.)useFrame$/.test(node.expression.getText(sf))) {
      for (const match of node.getText(sf).matchAll(RUNTIME_MOTION_MUTATION_RE)) {
        refs.add(match[1]!);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return refs;
}

/** `{ simulationOwnedTransform: true }` when this root's transform is written
 *  by the runtime and by nothing else — see the field's own doc. Only when
 *  NOTHING is forwarded: a component that forwards a channel and then animates
 *  it is the genuine conflict R3F005 exists for, not a simulation-owned
 *  instance. */
function simulationOwnership(
  opening: ts.JsxOpeningLikeElement,
  transformProps: readonly R3fTransformProp[],
  motionRefs: ReadonlySet<string>,
): { simulationOwnedTransform?: true } {
  if (transformProps.length > 0) return {};
  const rootRef = refIdentifier(opening);
  return rootRef && motionRefs.has(rootRef) ? { simulationOwnedTransform: true } : {};
}

function componentContract(
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
  body: ts.ConciseBody,
  sf: ts.SourceFile,
  typeAliases: ReadonlyMap<string, R3fTypeAlias>,
  builtinPropTypes: ReadonlyMap<string, string>,
  knownContracts: ReadonlyMap<string, R3fComponentContract>,
  motionRefs: ReadonlySet<string>,
  physicsBindings: ReadonlyMap<ts.JsxOpeningLikeElement, R3fPhysicsBinding>,
): R3fComponentContract {
  const expression = returnedExpression(body);
  if (!expression) return { root: 'unknown', transformProps: [] };
  if (expression.kind === ts.SyntaxKind.NullKeyword)
    return { root: 'non-spatial', transformProps: [] };
  if (ts.isJsxFragment(expression))
    return fragmentComponentContract(expression, sf, knownContracts);
  if (!ts.isJsxElement(expression) && !ts.isJsxSelfClosingElement(expression)) {
    return { root: 'unknown', transformProps: [] };
  }

  const opening = spatialRootOpening(expression);
  if (!opening) return { root: 'unknown', transformProps: [] };
  const rootTag = opening.tagName.getText(sf);
  // A material/geometry/attribute root is not a spatial instance at all — see
  // `isNonSpatialNativeTag`. Classified here rather than suppressed at each
  // rule, so every rule that keys off `root === 'single'` gets it at once.
  if (isNonSpatialNativeTag(rootTag)) return { root: 'non-spatial', transformProps: [] };
  const delegated = /^[A-Z]/.test(rootTag) ? knownContracts.get(rootTag) : undefined;
  if (/^[A-Z]/.test(rootTag) && !delegated) return { root: 'unknown', transformProps: [] };
  if (delegated && delegated.root !== 'single') return delegated;
  const nativeRootTag = delegated?.rootTag ?? rootTag;
  // A channel this component hands to the PHYSICS BINDING that places its root
  // is forwarded exactly as truly as one written onto the root's own tag — the
  // body is what puts the object in the world, so the callsite literal the hook
  // reads IS this instance's placement (`r3f-physics-binding.ts`). Without this
  // the contract said `Ramp` "does not forward position to its native root"
  // and refused `<Ramp position={[2, -1, 168.55]} />`, the one literal in the
  // whole chain that actually places the ramp.
  const rootBinding = physicsBindings.get(opening);
  // A channel the component's OWN `useFrame` drives through the body's api is
  // NOT forwarded in any sense a write can rely on: the hook may read the
  // callsite literal at spawn, but the per-frame driver has the last word and
  // the authored value is dead on the next tick (racing-game's `Train` — a
  // Kinematic body re-posed from its animated group every frame; the doctor's
  // settle leg measured the authored spawn discarded, digit for digit). Those
  // channels leave the forwarded set here, and the component is classified
  // simulation-owned below, so a callsite write refuses with the sentence
  // that names the real owner instead of persisting a literal that lies.
  const apiDriven = (rootBinding?.apiDriven ?? []) as readonly string[];
  const toBinding = ((rootBinding?.forwarded ?? []) as readonly string[]).filter(
    (channel) => !apiDriven.includes(channel),
  );
  const declared = propForwarding(parameters[0], nativeRootTag, sf, typeAliases, builtinPropTypes);
  // A GUARD WRAPPER spells its props AS the component it delegates to —
  // `props: Parameters<typeof WeaponModelBody>[0]` — and spreads them whole.
  // `typeAllowsStandardRootProps` reads type TEXT and aliases, so that spelling
  // reads as "accepts no root props" and the wrapper was reported as forwarding
  // nothing: first-person's `WeaponModel` (the hook-free discriminator check in
  // front of `WeaponModelBody` that its own header documents, bought by runhuman
  // pass 97) drew a permanent R3F002 telling the author to forward
  // position/rotation/scale it already forwards, all three, through `{...props}`.
  // The delegate's contract is resolved just above, so a wrapper whose props are
  // SPELLED as the delegate's accepts exactly what the delegate accepts.
  const forwarding =
    !declared.standardRootProps &&
    delegated &&
    typeIsDelegateProps(parameters[0]?.type, rootTag, sf)
      ? { ...declared, standardRootProps: true }
      : declared;
  const toTag = forwardedObjectProps(opening, forwarding, sf);
  const ownForwarding = R3F_TRANSFORM_PROPS.filter(
    (channel) => toTag.includes(channel) || toBinding.includes(channel),
  );
  const transformProps = delegated
    ? ownForwarding.filter((channel) => delegated.transformProps.includes(channel))
    : ownForwarding;
  const forwardsVisible =
    toTag.includes('visible') && (!delegated || delegated.visibleProp === true);

  // A built-in package contract may only ADD authorability. A component that
  // returns an external component while forwarding no transform channel to it
  // is exactly as opaque as it was before the table existed — reading the
  // package's root as its own would claim a native root the component never
  // routes anything to, and turn a silent unknown into a "does not forward"
  // warning about source the author cannot act on.
  if (isBuiltinR3fContract(delegated) && transformProps.length === 0) {
    return { root: 'unknown', transformProps: [] };
  }

  // WHICH of the forwarded channels a BODY reads, kept because the answer
  // changes what an authored write has to survive (see `bodyForwarded`).
  const bodyForwarded = transformProps.filter((channel) => toBinding.includes(channel));

  return {
    root: 'single',
    rootTag: nativeRootTag,
    transformProps,
    ...(bodyForwarded.length > 0 ? { bodyForwarded } : {}),
    ...(forwardsVisible ? { visibleProp: true as const } : {}),
    ...simulationOwnership(opening, transformProps, motionRefs),
    // The api-driven case (see `apiDriven` above): the component drives its
    // body every frame, so its instances are placed by the simulation exactly
    // as `runtimeMotionRefs`'s direct-ref case is.
    ...(apiDriven.length > 0 ? { simulationOwnedTransform: true as const } : {}),
  };
}

interface R3fComponentDefinition {
  name: string;
  parameters: ts.NodeArray<ts.ParameterDeclaration>;
  body: ts.ConciseBody;
}

function componentDefinitions(statement: ts.Statement): R3fComponentDefinition[] {
  if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
    return /^[A-Z]/.test(statement.name.text)
      ? [{ name: statement.name.text, parameters: statement.parameters, body: statement.body }]
      : [];
  }
  if (!ts.isVariableStatement(statement)) return [];
  return statement.declarationList.declarations.flatMap((declaration) => {
    if (
      !ts.isIdentifier(declaration.name) ||
      !/^[A-Z]/.test(declaration.name.text) ||
      !declaration.initializer ||
      (!ts.isArrowFunction(declaration.initializer) &&
        !ts.isFunctionExpression(declaration.initializer))
    ) {
      return [];
    }
    return [
      {
        name: declaration.name.text,
        parameters: declaration.initializer.parameters,
        body: declaration.initializer.body,
      },
    ];
  });
}

function collectR3fComponentContracts(
  sf: ts.SourceFile,
  importedContracts: ReadonlyMap<string, R3fComponentContract> = new Map(),
  importedTypeAliases: ReadonlyMap<string, R3fTypeAlias> = new Map(),
): Map<string, R3fComponentContract> {
  // Imported first, so a local declaration of the same name shadows it exactly
  // as JavaScript lexical scope does — the same rule `importedContracts`
  // already follows for components.
  const aliases = new Map<string, R3fTypeAlias>(importedTypeAliases);
  for (const statement of sf.statements) {
    if (ts.isTypeAliasDeclaration(statement))
      aliases.set(statement.name.text, { type: statement.type, sf });
  }
  const builtins = builtinRootPropTypes(sf);

  const definitions = sf.statements.flatMap(componentDefinitions);
  const motionRefs = runtimeMotionRefs(sf, sf);
  const physicsBindings = physicsBindingsByElement(sf);
  const contracts = new Map(importedContracts);
  // Components commonly delegate their native root to another local component.
  // Resolve that ordinary React composition to a fixed point rather than
  // requiring definition order or an authoring-specific wrapper.
  for (let pass = 0; pass <= definitions.length; pass += 1) {
    let changed = false;
    for (const definition of definitions) {
      const next = componentContract(
        definition.parameters,
        definition.body,
        sf,
        aliases,
        builtins,
        contracts,
        motionRefs,
        physicsBindings,
      );
      const previous = contracts.get(definition.name);
      if (JSON.stringify(previous) !== JSON.stringify(next)) {
        contracts.set(definition.name, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return contracts;
}

/** Analyze the component bindings visible in one R3F module. Imported
 * bindings are supplied by the project resolver; local definitions override
 * them exactly as JavaScript lexical scope does. */
export function analyzeR3fComponentContracts(
  code: string,
  file: string,
  importedContracts: ReadonlyMap<string, R3fComponentContract> = new Map(),
  importedTypeAliases: ReadonlyMap<string, R3fTypeAlias> = new Map(),
): Map<string, R3fComponentContract> {
  const sf = parseAuthoringTsx(file, code);
  return collectR3fComponentContracts(sf, importedContracts, importedTypeAliases);
}

/**
 * Mirrors `@volter/editor-project/adapter/adapter-surface`'s `AdapterSurface` vocabulary
 * (`'three' | 'canvas' | 'dom'`) as a bare literal union rather than
 * importing it: this module is deliberately dependency-free (see the module
 * doc comment above `OidEntry`) so a page with no bundler alias resolution can
 * import it too. Every caller
 * that already carries the real `AdapterSurface` (e.g. `binding-resolver.ts`)
 * may pass it here directly; the two types are structurally identical.
 */
export type DeclaredRootSurface = 'three' | 'canvas' | 'dom';

/**
 * Intrinsic (lowercase-initial) JSX tags that exist ONLY in react-three-fiber's
 * reconciler — there is no HTML or SVG element with any of these names.
 *
 * DIAGNOSTIC EVIDENCE ONLY. This does not classify a file's dialect and must
 * not be made to: which region a file belongs to is decided by declaration and
 * import reach (`file-region-resolver.ts`), because that is a fact the game's
 * author states or the host EXECUTES, while a tag list is a guess about a file
 * whose imports it cannot see. What the scan is still for is telling an author
 * what the editor OBSERVED: the `OID003`/`OID004` messages in
 * `server/project-root-surface.ts` name the tags a file renders, and `OID004` —
 * a file rendering both dialects' intrinsics, which one attribute cannot serve
 * — is nothing BUT this observation.
 *
 * Deliberately CONSERVATIVE: every entry is checked against the HTML and SVG
 * element sets, so nothing here can be a DOM tag. `line`, `points`, `sprite`,
 * `audio`, `color` and `fog` are all real R3F intrinsics but are EXCLUDED from
 * this list where SVG/HTML also spells them (`<line>`, `<audio>`) — the list is
 * evidence, not a catalogue, and a wrong entry would flip a genuine DOM file.
 * `[a-z][A-Za-z]*(Geometry|Material)` covers the whole geometry/material family
 * (`boxGeometry`, `meshStandardMaterial`, `shaderMaterial`, …) without naming
 * each one; the leading lowercase class is what keeps it from matching a
 * CUSTOM component (`<MyMaterial>`), which is a callsite, not an intrinsic.
 */
const R3F_ONLY_INTRINSIC_RE =
  /<(mesh|instancedMesh|batchedMesh|skinnedMesh|group|primitive|lineSegments|bufferGeometry|bufferAttribute|instancedBufferAttribute|[a-z][A-Za-z]*Geometry|[a-z][A-Za-z]*Material|ambientLight|directionalLight|pointLight|spotLight|hemisphereLight|rectAreaLight|perspectiveCamera|orthographicCamera|axesHelper|gridHelper|boxHelper)[\s/>]/g;

/**
 * The mirror image: intrinsic tags that exist ONLY in the react-dom
 * reconciler.
 *
 * DIAGNOSTIC EVIDENCE ONLY, on the same terms as the R3F list above: it
 * classifies no file. What a file renders is reported (`OID003`/`OID004` in
 * `server/project-root-surface.ts`); which region a file BELONGS to is a
 * declaration or a reach, never a property of its bytes. Excludes every name R3F also spells as an intrinsic
 * (`line`, `points`, `sprite`, `audio`, `color`, `fog`, `path`, `circle`), so
 * a hit here is unambiguous.
 */
const DOM_ONLY_INTRINSIC_RE =
  /<(div|span|p|button|section|header|footer|nav|main|aside|form|input|textarea|select|option|label|table|thead|tbody|tr|td|th|img|iframe|br|hr|strong|em|pre|code|canvas|ul|ol|li|h[1-6])[\s/>]/g;

/**
 * What ONE file's own bytes say about which reconciler its JSX targets.
 *
 * DIAGNOSTIC EVIDENCE ONLY — it decides no attribute anywhere. What a file
 * renders is REPORTED (`server/project-root-surface.ts`'s `OID003`/`OID004`);
 * which region it belongs to is a declaration or a reach, never a property of
 * its bytes.
 *
 * Deliberately a cheap regex scan, not an AST walk, because it runs in a
 * `transform` hook on every project `.tsx`. COMMENTS are
 * stripped first (see {@link stripCommentsForScan}) so prose that merely
 * NAMES a tag cannot count as rendering it; a mention inside a string still
 * matches, which is deliberate — import specifiers ARE strings.
 */
export interface SourceDialectEvidence {
  /** Imports the R3F reconciler, or the upstreamed `@vgai/game-runtime/world3d-react` bridge. */
  reconcilerImport: boolean;
  /** Distinct R3F-only intrinsic tags this file renders. */
  r3fOnlyTags: string[];
  /** Distinct DOM-only intrinsic tags this file renders. */
  domOnlyTags: string[];
}

function distinctTags(code: string, pattern: RegExp): string[] {
  const found = new Set<string>();
  for (const match of code.matchAll(pattern)) if (match[1]) found.add(match[1]);
  return [...found];
}

/**
 * Drop line and block comments before the dialect scan, copying string
 * literals through untouched. The shipped case that bought this: the starter
 * dev-tools JSDoc names its command shape `cheat.<group>.<label>` — `group`
 * is an R3F-only intrinsic and `label` a DOM-only one, so ONE comment line
 * made a fresh scaffold boot with a dialect-mixing diagnostic about a file
 * with no JSX in it. A diagnostic channel agents are told to trust cannot
 * cry wolf over prose.
 *
 * Single pass, no AST — the transform-hook perf bar stands. Known residual
 * imprecision, accepted: a regex literal containing `//` or `/*` is misread
 * as a comment and drops the rest of itself — which degrades toward "no
 * evidence" (the safe default), never toward a fabricated tag.
 */
function stripCommentsForScan(code: string): string {
  const kept: string[] = [];
  let i = 0;
  while (i < code.length) {
    const ch = code[i]!;
    const next = code[i + 1];
    if (ch === '/' && (next === '/' || next === '*')) {
      // A space, not nothing: gluing a block comment's neighbors could mint
      // a token that was never in the source.
      if (next === '*') kept.push(' ');
      i = commentEnd(code, i, next);
    } else if (ch === "'" || ch === '"' || ch === '`') {
      const end = stringLiteralEnd(code, i);
      kept.push(code.slice(i, end));
      i = end;
    } else {
      kept.push(ch);
      i += 1;
    }
  }
  return kept.join('');
}

/** End index (exclusive) of the comment opening at `start` — a `//` comment
 *  stops BEFORE its newline (the newline stays in the scanned text). */
function commentEnd(code: string, start: number, kind: '/' | '*'): number {
  if (kind === '/') {
    const newline = code.indexOf('\n', start + 2);
    return newline === -1 ? code.length : newline;
  }
  const close = code.indexOf('*/', start + 2);
  return close === -1 ? code.length : close + 2;
}

/** End index (exclusive) of the string literal opening at `start`, honoring
 *  backslash escapes; an unterminated literal runs to the end of the file. */
function stringLiteralEnd(code: string, start: number): number {
  const quote = code[start]!;
  let i = start + 1;
  while (i < code.length) {
    const ch = code[i]!;
    if (ch === '\\') i += 2;
    else if (ch === quote) return i + 1;
    else i += 1;
  }
  return code.length;
}

/** Scan one file's source for self-contained evidence of its JSX dialect. */
export function sourceDialectEvidence(code: string): SourceDialectEvidence {
  const scanned = stripCommentsForScan(code);
  return {
    reconcilerImport:
      scanned.includes('@react-three/fiber') ||
      scanned.includes('@vgai/game-runtime/world3d-react'),
    r3fOnlyTags: distinctTags(scanned, R3F_ONLY_INTRINSIC_RE),
    domOnlyTags: distinctTags(scanned, DOM_ONLY_INTRINSIC_RE),
  };
}

/** True when a file's own bytes prove it authors for the R3F reconciler. */
export function sourceProvesR3f(evidence: SourceDialectEvidence): boolean {
  return evidence.reconcilerImport || evidence.r3fOnlyTags.length > 0;
}

/**
 * THE SOURCE-ID ATTRIBUTE for one file, decided by its REGION and nothing else.
 *
 * 1. **The region (authoritative).** `surface` is the answer
 *    `file-region-resolver.ts` gave for THIS file — a declaration the game
 *    made (a region `include` glob, a region `mounts` entry, or the manifest
 *    root whose `entry` this file is) or the region whose import closure
 *    reaches it. `'three'` stamps `userData-oid`; `'canvas'`/`'dom'` stamp
 *    `data-oid`. It is resolved from OUTSIDE the file, exactly where the fact
 *    lives, which is what makes it right for a world whose entry
 *    default-exports a component and imports NEITHER `@react-three/fiber` nor
 *    `@vgai/game-runtime/world3d-react` (legal: R3F's global JSX-intrinsics augmentation,
 *    or an entry composed entirely of already-typed child components, needs no
 *    import in THIS file). Every call site threads it from a context that
 *    resolved it per file: `binding-resolver.ts`'s per-surface resolvers, the
 *    browser bundle's own per-file resolution
 *    (`browser-transpile.ts`), and the dev server's
 *    `server/project-root-surface.ts` — shared with `classifyProjectHotUpdate`,
 *    the HMR half of this same decision, so the two cannot drift apart by hand.
 *
 * 2. **The DEFAULT.** When `surface` is `undefined` — no region placed the
 *    file (an ad-hoc file with no `vgai.project.json` above it, or a module no
 *    region's import closure reaches and none declares) — the answer is
 *    `data-oid`, the documented default, and the CALLER says so out loud
 *    (`server/project-root-surface.ts`'s `OID001`/`OID002`). There is
 *    deliberately no source-text rung: a probe over a file's own bytes answered
 *    for a file it could not place, silently, and being wrong that way is
 *    indistinguishable from being right. Zero inference (ARCHITECTURE-CORE
 *    §The editor protocol) makes the fix a declaration — an `include` glob or
 *    a `mounts` entry in `vgai.adapter.ts` — not a better heuristic.
 *
 * Nothing about a file's own bytes outranks the region — not even a file that
 * renders THREE host elements while its region says `dom`. That disagreement is
 * FATAL rather than noisy (`data-oid` on a THREE object pierces inside fiber,
 * writes `object.data`, and throws on the next apply), which is exactly why it
 * is reported at full volume as declared-vs-measured DRIFT
 * (`server/project-root-surface.ts`'s `OID003`) and repaired by fixing the
 * declaration. A stamp derived from the bytes instead would make the
 * declaration untestable, which is how a wrong one stays invisible.
 *
 * Lives HERE, beside the transform it parameterizes, rather than in
 * `vite-plugin-ui-oid.ts` (which re-exports it for its existing callers):
 * a caller in a page reaches the same `transformSource`, and that path cannot
 * import a `node:fs`-bearing module.
 */
export function oidAttributeForSurface(
  declaredSurface?: DeclaredRootSurface,
): 'data-oid' | 'userData-oid' {
  return declaredSurface === 'three' ? 'userData-oid' : 'data-oid';
}

/** Options for {@link transformSource}. */
export interface TransformSourceOptions {
  /**
   * The attribute name stamped on every JSX element (default `data-oid`).
   * R3F-dialect files (spike W1) pass `userData-oid` instead:
   * react-three-fiber's dashed-prop piercing writes `object.userData.oid`
   * on the constructed Object3D at reconcile time — zero runtime cost, and
   * the editor's R3F authoring adapter reads it back off the live scene
   * graph. The OID→{file,line,col} index is attribute-agnostic (keyed by
   * oid only), so every `/__ui-source/*` endpoint works unchanged for
   * either dialect.
   */
  attribute?: string;
  /** Contracts for ordinary project-local imported component bindings. */
  importedR3fContracts?: ReadonlyMap<string, R3fComponentContract>;
  /** The prop-shape type aliases those same imports bring into scope. A
   *  project that writes its canonical prop shape once and imports it is
   *  otherwise read as forwarding nothing. */
  importedR3fTypeAliases?: ReadonlyMap<string, R3fTypeAlias>;
  /** The file is mounted by @pixi/react. Local component callsites propagate
   * their OID onto the component's first native Pixi host, exactly as R3F
   * does with userData, but through ordinary data-* constructor fields. */
  canvasComponents?: boolean;
}

/**
 * The local names bound to drei's `<Html>` in this file — the ONE seam where a
 * three-surface file renders through **react-dom** instead of the R3F
 * reconciler. `<Html>` creates a real `<div>`, mounts a `createRoot` on it and
 * renders its children there, so every host element inside it is a DOM element
 * and the R3F-pierced identity props this transform stamps on host elements
 * (`userData-oid`, `userData-authoringInstance`, `userData-authoringLabel`,
 * and the `userData={{}}` seed) have nowhere to land.
 *
 * Measured: the starter template's own `BotHud` — screen-pinned dev chrome
 * built on `<Html>`, the documented way to put DOM in a Three world — logged
 * FOUR `React does not recognize the \`userData-…\` prop on a DOM element`
 * errors on every bot run, one per stamped prop. Inside an `<Html>` subtree we
 * therefore stamp `data-oid`, byte-for-byte what a `dom` root gets.
 *
 * Lexical by design: this reads the subtree written in THIS file, which is the
 * whole extent the transform can see. A component defined elsewhere and
 * rendered inside `<Html>` is transformed by its own pass against its own
 * declared surface.
 */
function dreiHtmlLocalNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    if (specifier !== '@react-three/drei' && !specifier.startsWith('@react-three/drei/')) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === 'Html')
        names.add(element.name.text);
    }
  }
  return names;
}

/**
 * Local JSX names bound by an import from an INSTALLED PACKAGE — every
 * specifier that is not relative (`./x`, `../x`), which is exactly the line
 * `r3f-project-contracts.ts`'s `resolveRelativeModule` already draws between
 * "source this editor walks" and "a dependency it never guesses about".
 *
 * Why the callsite stamp must skip them: `__vgaiOid`/`__vgaiLabel` are a
 * CONTRACT BETWEEN TWO HALVES OF THIS TRANSFORM. The callsite half writes
 * them; the only thing that ever reads them is the callee half —
 * `componentInstanceExpressions` destructuring them out of the component's own
 * parameters and re-emitting them as `userData-authoringInstance` on that
 * component's host elements. Nothing anywhere reads them off a React instance
 * or a DOM node. A package module is never served through this transform, so
 * the callee half never runs for it: the props have no reader by construction,
 * and the only thing they can still do is escape.
 *
 * And they do. Measured on the vendored `racing-game` ingest: `App.tsx` is a
 * MIXED file (an R3F `Scene` and a DOM `Hud` in one module, so the file's one
 * dialect is `userData-oid`), and its `<Canvas>` — `@react-three/fiber`'s own,
 * which spreads its rest props onto the `<div>` it wraps the canvas in — put
 * `__vgaiOid` and `__vgaiLabel` straight into the DOM, for two permanent
 * `React does not recognize the \`__vgaiOid\` prop on a DOM element` errors on
 * every mount of a real game. Nothing was lost by not stamping it, because
 * nothing was reading it.
 *
 * The one package component that DOES carry editor identity earns it through
 * the hand-audited contract table instead (`BUILTIN_R3F_CONTRACTS`), which
 * describes the native root the package forwards to — a claim about a specific
 * package's public API, never a guess made at a callsite.
 */
function packageImportedLocalNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (statement.moduleSpecifier.text.startsWith('.')) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) names.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      names.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) names.add(element.name.text);
  }
  return names;
}

/** Drei cameras forward these props to their native Three camera. */
function dreiCameraLocalNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const cameras = ['PerspectiveCamera', 'OrthographicCamera'];
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const specifier = statement.moduleSpecifier.text;
    if (
      specifier !== '@react-three/drei' &&
      !cameras.some((name) => specifier === `@react-three/drei/core/${name}`)
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      for (const camera of cameras) names.add(`${bindings.name.text}.${camera}`);
    } else if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (cameras.includes(element.propertyName?.text ?? element.name.text))
          names.add(element.name.text);
      }
    }
  }
  return names;
}

/**
 * Component-shaped JSX names bound by a function PARAMETER — the second way a
 * tag's callee is unknowable at transform time, and the same hazard as
 * {@link packageImportedLocalNames} for exactly the same reason.
 *
 * `__vgaiOid`/`__vgaiLabel` are a contract between two halves of this
 * transform: the callsite half writes them, the callee half destructures them
 * out of the component's own parameters. A tag bound to a parameter names
 * WHATEVER the caller passed, so this module cannot know whether the callee
 * half ever ran for it — and where it did not, the props' only remaining
 * behaviour is to escape into the DOM through any rest-prop spread.
 *
 * MEASURED on the vendored `racing-game` ingest, against the SERVED modules:
 * `useToggle.tsx`'s `<ToggledComponent {...props} />` (its `ToggledComponent`
 * is a parameter — drei's `Stats`/`OrbitControls`, cannon's `Debug`, or a
 * project component, depending on the call) and every R3F `*.stories.tsx`
 * decorator's `<Story />`. Two standing
 * `React does not recognize the \`__vgaiOid\` prop on a DOM element` errors on
 * every run of the acceptance portfolio.
 *
 * Nothing is lost by not stamping, and identity actually IMPROVES: a forwarder
 * spreads the caller's own props first, so the oid the REAL callsite wrote
 * (`<ToggledMap/>` in `App.tsx`) now reaches the wrapped component instead of
 * being overwritten by a literal naming the forwarder's own line.
 *
 * Scope is the whole file rather than lexical scope on purpose: a name that is
 * a parameter ANYWHERE in a module is not a stable component identity to stamp
 * against, and a per-scope walk would buy precision this decision does not use.
 */
function parameterBoundLocalNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const addBinding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      if (/^[A-Z]/.test(name.text)) names.add(name.text);
      return;
    }
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) addBinding(element.name);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) {
      for (const parameter of node.parameters) addBinding(parameter.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

/** JSX spellings that resolve to React's transparent Fragment. A Fragment is
 * composition, not a host node: it accepts only key/children, has no runtime
 * element to select, and must never receive an OID prop. */
function reactFragmentNames(sf: ts.SourceFile): Set<string> {
  const names = new Set(['Fragment', 'React.Fragment']);
  for (const statement of sf.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'react'
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.name) names.add(`${clause.name.text}.Fragment`);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      names.add(`${bindings.name.text}.Fragment`);
    } else if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if ((element.propertyName?.text ?? element.name.text) === 'Fragment') {
          names.add(element.name.text);
        }
      }
    }
  }
  return names;
}

/**
 * Transform source: insert `data-oid="…"` (or `opts.attribute="…"`) on every
 * JSX element and register the index. In the R3F dialect, a custom component
 * callsite receives editor-only props whose values are propagated onto the
 * component's existing host Object3Ds. Every transformed project component,
 * on every surface, consumes those props at its parameter boundary so a
 * cross-surface component or ordinary `{...props}` spread cannot forward them
 * into game DOM. That preserves per-instance source identity without inserting
 * a wrapper into the native tree. Returns the transformed code + index entries.
 */
export function transformSource(
  code: string,
  file: string,
  store: OidStore,
  opts?: TransformSourceOptions,
): { code: string; entries: OidEntry[] } {
  const sf = parseAuthoringTsx(file, code);
  store.clearFile(file);
  const attribute = opts?.attribute ?? 'data-oid';
  const projectsComponentInstances =
    attribute === 'userData-oid' || opts?.canvasComponents === true;
  const sourceEdits: SourceEdit[] = [];
  const entries: OidEntry[] = [];
  const r3fComponentContracts =
    attribute === 'userData-oid'
      ? collectR3fComponentContracts(sf, opts?.importedR3fContracts, opts?.importedR3fTypeAliases)
      : new Map();
  const physicsBindings =
    attribute === 'userData-oid'
      ? physicsBindingsByElement(sf)
      : new Map<ts.JsxOpeningLikeElement, R3fPhysicsBinding>();
  const jointBindings =
    attribute === 'userData-oid'
      ? jointBindingsByElement(sf)
      : new Map<ts.JsxOpeningLikeElement, readonly R3fJointBinding[]>();
  const particleBindings =
    attribute === 'userData-oid'
      ? particleBindingsByElement(sf)
      : new Map<ts.JsxOpeningLikeElement, R3fParticleBinding>();
  const lodBindings =
    attribute === 'userData-oid'
      ? lodBindingsByElement(sf)
      : new Map<ts.JsxOpeningLikeElement, R3fLodBinding>();
  const environmentBindings =
    attribute === 'userData-oid'
      ? environmentBindingsByElement(sf)
      : new Map<ts.JsxOpeningLikeElement, R3fEnvironmentBinding>();
  const componentStack: Array<{
    name: string;
    instanceExpression: string;
    labelExpression: string;
  }> = [];
  // per (component:tag) occurrence counters for stable signatures
  const occ = new Map<string, number>();

  const componentInstanceExpressions = (
    parameters: ts.NodeArray<ts.ParameterDeclaration>,
  ): { instanceExpression: string; labelExpression: string } => {
    const first = parameters[0];
    if (!first) {
      // Default the whole binding. Isolation/preview/bake call a stamped
      // export as a factory (`MainScene()` / `WOOD()`) with no args; a
      // required destructure of `undefined` is `Cannot destructure property
      // '__vgaiOid'`. React still passes `{}` at a real callsite.
      sourceEdits.push({ pos: parameters.pos, text: '{ __vgaiOid, __vgaiLabel } = {}' });
      return { instanceExpression: '__vgaiOid', labelExpression: '__vgaiLabel' };
    }
    if (ts.isObjectBindingPattern(first.name)) {
      sourceEdits.push({
        pos: first.name.getStart(sf) + 1,
        text: '__vgaiOid, __vgaiLabel, ',
      });
      // After the WHOLE parameter, including a type annotation:
      // `({ name, ...props }: T)` must become `({ __vgaiOid, …, name, ...props }: T = {})`.
      // Inserting at the binding's end produced `} = {}: T`, which is not
      // TypeScript and broke every typed scene export the look verb imports.
      if (!first.initializer) {
        sourceEdits.push({ pos: first.getEnd(), text: ' = {}' });
      }
      return { instanceExpression: '__vgaiOid', labelExpression: '__vgaiLabel' };
    }
    if (ts.isIdentifier(first.name) && !first.dotDotDotToken) {
      // Preserve the authored identifier as the REST binding. Code below the
      // parameter continues to read `props`, but it now sees only game props:
      // `function Card(props: Props)` becomes
      // `function Card({ __vgaiOid, __vgaiLabel, ...props }: Props)`.
      // Remove an optional marker while replacing the identifier; a binding
      // pattern cannot itself be optional, so its equivalent is a `{}` default.
      sourceEdits.push({
        pos: first.name.getStart(sf),
        end: first.questionToken?.end ?? first.name.getEnd(),
        text: `{ __vgaiOid, __vgaiLabel, ...${first.name.text} }`,
      });
      if (!first.initializer) {
        sourceEdits.push({ pos: first.getEnd(), text: ' = {}' });
      }
      return { instanceExpression: '__vgaiOid', labelExpression: '__vgaiLabel' };
    }
    return { instanceExpression: '__vgaiOid', labelExpression: '__vgaiLabel' };
  };

  const pushComponent = (
    name: string | undefined,
    parameters: ts.NodeArray<ts.ParameterDeclaration> | undefined,
  ): boolean => {
    if (!name || !/^[A-Z]/.test(name) || !parameters) return false;
    // Component membership participates in the stable OID signature on every
    // JSX dialect. Three/Canvas callsites inject the transport props, while
    // every project component consumes them: a component declared on a DOM
    // mount can therefore be called safely from a Three-region module without
    // leaking editor metadata through its own rest props.
    componentStack.push({ name, ...componentInstanceExpressions(parameters) });
    return true;
  };

  /** Local names of drei's `<Html>`, and how deep inside one we currently are —
   *  see {@link dreiHtmlLocalNames}. Only meaningful in the R3F dialect; a
   *  `data-oid` file already stamps what a DOM subtree wants. */
  const dreiHtmlNames = attribute === 'userData-oid' ? dreiHtmlLocalNames(sf) : new Set<string>();
  const dreiCameraNames =
    attribute === 'userData-oid' ? dreiCameraLocalNames(sf) : new Set<string>();
  /** Tags bound to an installed package — see {@link packageImportedLocalNames}.
   *  Only meaningful in the R3F dialect: `data-oid` is a legal DOM attribute
   *  and a package that spreads it renders it harmlessly. */
  const packageNames = projectsComponentInstances
    ? packageImportedLocalNames(sf)
    : new Set<string>();
  /** Tags bound to a function parameter — see {@link parameterBoundLocalNames}.
   *  Same dialect gating and same reason as `packageNames`: only the transport
   *  props can escape, and `data-oid` is a legal DOM attribute. */
  const parameterNames = projectsComponentInstances
    ? parameterBoundLocalNames(sf)
    : new Set<string>();
  const fragmentNames = reactFragmentNames(sf);
  let domSubtreeDepth = 0;

  /** Oids of the JSX elements lexically enclosing the node being visited. */
  const jsxStack: string[] = [];
  /** Opening tag -> its oid, so the enclosing `JsxElement` can push it before
   *  descending into the children that tag wraps. */
  const openedOid = new Map<ts.JsxOpeningElement, string>();

  const visit = (node: ts.Node): void => {
    let pushed = false;
    if (ts.isFunctionDeclaration(node) && node.name)
      pushed = pushComponent(node.name.text, node.parameters);
    else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      pushed = pushComponent(node.name.text, node.initializer.parameters);
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (fragmentNames.has(tag)) {
        ts.forEachChild(node, visit);
        if (pushed) componentStack.pop();
        return;
      }
      const componentContext = componentStack[componentStack.length - 1];
      const component = componentContext?.name ?? null;
      const sigBase = `${file}:${component}:${tag}`;
      const n = occ.get(sigBase) ?? 0;
      occ.set(sigBase, n + 1);
      const sig = `${sigBase}:${n}`;
      const oid = store.getOrCreate(sig);
      // Inside a drei `<Html>` the reconciler is react-dom, not fiber — see
      // `dreiHtmlLocalNames`. Everything below reads this, not `attribute`.
      const elementAttribute = domSubtreeDepth > 0 ? 'data-oid' : attribute;
      const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      const localContract =
        elementAttribute === 'userData-oid' && /^[A-Z]/.test(tag)
          ? r3fComponentContracts.get(tag)
          : undefined;
      const entry: OidEntry = {
        file,
        line: line + 1,
        col: character,
        component,
        tag,
        authoredProps: authoredPropsOf(node, sf),
        ...(localContract ? { r3fAuthoring: localContract } : {}),
        ...(physicsBindings.has(node) ? { physicsBinding: physicsBindings.get(node)! } : {}),
        ...(jointBindings.has(node) ? { jointBindings: jointBindings.get(node)! } : {}),
        ...(particleBindings.has(node) ? { particleBinding: particleBindings.get(node)! } : {}),
        ...(lodBindings.has(node) ? { lodBinding: lodBindings.get(node)! } : {}),
        ...(environmentBindings.has(node)
          ? { environmentBinding: environmentBindings.get(node)! }
          : {}),
        ...(jsxStack.length > 0 ? { parentOid: jsxStack[jsxStack.length - 1]! } : {}),
      };
      store.index.set(oid, entry);
      entries.push(entry);
      if (ts.isJsxOpeningElement(node)) openedOid.set(node, oid);
      const isProjectCustomComponent =
        (elementAttribute === 'userData-oid' || opts?.canvasComponents === true) &&
        /^[A-Z]/.test(tag);
      if (isProjectCustomComponent) {
        const element = ts.isJsxOpeningElement(node) ? node.parent : node;
        if (ts.isJsxElement(element) || ts.isJsxSelfClosingElement(element)) {
          // An installed package's module never passes through this transform,
          // so the callee half of the `__vgaiOid` contract never runs for it and
          // the props can only escape (into the DOM, via any package component
          // that spreads its rest props onto a host element). The callsite is
          // still INDEXED above — the source entry, its parent and its contract
          // are unchanged; only the unreadable runtime prop is withheld. See
          // {@link packageImportedLocalNames}.
          if (packageNames.has(tag.split('.')[0] ?? tag)) {
            // Detailed and the two Drei cameras spread their remaining props
            // onto a native Three host, where the ordinary R3F OID belongs.
            if (lodBindings.has(node) || dreiCameraNames.has(tag)) {
              sourceEdits.push({ pos: node.attributes.end, text: ` userData-oid="${oid}"` });
            }
            ts.forEachChild(node, visit);
            if (pushed) componentStack.pop();
            return;
          }
          // A tag bound to a PARAMETER names whatever the caller passed, so the
          // callee half may never have run for it either — same withholding,
          // same reason, and the callsite stays indexed. See
          // {@link parameterBoundLocalNames}.
          if (parameterNames.has(tag.split('.')[0] ?? tag)) {
            ts.forEachChild(node, visit);
            if (pushed) componentStack.pop();
            return;
          }
          const authoredName = node.attributes.properties.find(
            (property): property is ts.JsxAttribute =>
              ts.isJsxAttribute(property) && property.name.getText(sf) === 'name',
          );
          const label =
            authoredName?.initializer && ts.isStringLiteral(authoredName.initializer)
              ? authoredName.initializer.text
              : tag;
          const labelAttribute =
            authoredName?.initializer && ts.isJsxExpression(authoredName.initializer)
              ? `__vgaiLabel={${authoredName.initializer.expression?.getText(sf) ?? JSON.stringify(tag)}}`
              : `__vgaiLabel=${JSON.stringify(label)}`;
          sourceEdits.push({
            pos: node.attributes.end,
            text: ` __vgaiOid="${oid}" ${labelAttribute}`,
          });
        }
      } else {
        // Host elements carry their identity directly.
        // Append after authored attributes. In R3F, an authored `userData={{…}}`
        // replaces the whole object at its position in prop order; putting the
        // pierced editor keys last prevents that prop from erasing identity.
        sourceEdits.push({ pos: node.attributes.end, text: ` ${elementAttribute}="${oid}"` });
        if (elementAttribute === 'userData-oid' && componentContext) {
          sourceEdits.push({
            pos: node.attributes.end,
            text:
              ` userData-authoringInstance={${componentContext.instanceExpression}}` +
              ` userData-authoringLabel={${componentContext.labelExpression}}` +
              ` userData-authoringComponent=${JSON.stringify(componentContext.name)}`,
          });
        } else if (opts?.canvasComponents === true && componentContext) {
          sourceEdits.push({
            pos: node.attributes.end,
            text:
              ` data-authoring-instance={${componentContext.instanceExpression}}` +
              ` data-authoring-label={${componentContext.labelExpression}}` +
              ` data-authoring-component=${JSON.stringify(componentContext.name)}`,
          });
        }
        if (
          elementAttribute === 'userData-oid' &&
          // NEVER on `<primitive>`. Its object is the GAME's, constructed before
          // React ever sees it, and `userData={{}}` REPLACES that object's own
          // `userData` wholesale — measured: a root carrying
          // `markComponentRoot(node, 'Stage')` from its constructor came out of
          // mount with nothing but the three editor keys, so every hierarchy
          // mark a class-owned root sets was destroyed by the editor's own
          // serve-time transform. An adopted object always HAS a `userData`
          // (three sets one on every Object3D/geometry/material), which is
          // precisely why the initializer below is unnecessary here and
          // destructive. That initializer's real subjects are the resources R3F
          // itself constructs.
          tag !== 'primitive' &&
          !node.attributes.properties.some(
            (property) => ts.isJsxAttribute(property) && property.name.getText(sf) === 'userData',
          )
        ) {
          // Some valid R3F host resources (for example BufferAttribute) do not
          // start with a `userData` object. Current Fiber deliberately refuses
          // to pierce `userData-*` through an undefined parent, so initialize
          // it before the editor metadata props are applied.
          sourceEdits.push({ pos: node.attributes.end, text: ' userData={{}}' });
        }
      }
    }

    // A `<Tag>…</Tag>` pair encloses its children, but in the AST the opening
    // tag is their SIBLING — so walk it FIRST (which mints its oid), then push
    // that oid while descending into the children it wraps. Doing this in the
    // generic `forEachChild` tail would read the oid before it exists.
    if (ts.isJsxElement(node)) {
      visit(node.openingElement);
      const enclosingOid = openedOid.get(node.openingElement);
      if (enclosingOid !== undefined) jsxStack.push(enclosingOid);
      // `<Html>` ITSELF stays an R3F callsite (drei mounts a `<group>` for it);
      // only what it wraps is DOM.
      const opensDomSubtree = dreiHtmlNames.has(node.openingElement.tagName.getText(sf));
      if (opensDomSubtree) domSubtreeDepth++;
      for (const child of node.children) visit(child);
      if (opensDomSubtree) domSubtreeDepth--;
      if (enclosingOid !== undefined) jsxStack.pop();
      visit(node.closingElement);
      if (pushed) componentStack.pop();
      return;
    }

    ts.forEachChild(node, visit);
    if (pushed) componentStack.pop();
  };
  visit(sf);

  // Apply edits back-to-front so every offset stays relative to source bytes.
  sourceEdits.sort((a, b) => b.pos - a.pos);
  let out = code;
  for (const edit of sourceEdits) {
    out = out.slice(0, edit.pos) + edit.text + out.slice(edit.end ?? edit.pos);
  }
  return { code: out, entries };
}

/** 1-based line + 0-based col -> absolute char offset in `code`. */
export function lineColToOffset(code: string, line: number, col: number): number {
  let offset = 0;
  let cur = 1;
  while (cur < line) {
    const nl = code.indexOf('\n', offset);
    if (nl === -1) return code.length;
    offset = nl + 1;
    cur += 1;
  }
  return offset + col;
}
