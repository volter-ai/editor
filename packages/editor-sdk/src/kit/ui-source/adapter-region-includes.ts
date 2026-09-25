import ts from 'typescript';

/**
 * A SYNCHRONOUS, source-only read of what a project's `vgai.adapter.ts`
 * declares about which files belong to which SURFACE: each region's `include`
 * globs, and the additional surfaces it `mounts` — stated either as parameters
 * layered onto the `'manifest-roots'` rule (`regionIncludes`, what every
 * first-party project uses) or inside an explicit `regions` list (the
 * full-replacement form). Pure — the dev server adds
 * the filesystem and a cache (`server/adapter-region-includes.ts`); the
 * browser-hosted Content index reads the same file through its storage backend.
 *
 * WHY A STATIC READ AND NOT AN IMPORT. The adapter module's contract
 * (`@volter/editor-project/adapter/adapter-module`, ARCHITECTURE-CORE §The editor protocol) is
 * that its TOP LEVEL is "a STATICALLY EVALUABLE BINDING TABLE, readable without
 * booting the game" — plain data, closures only inside `observation[].answer`.
 * This module takes the contract at its word for the one consumer that cannot
 * take any other route: the OID stamping transform runs in a Vite `transform`
 * hook, synchronously, per project `.tsx`, long before any browser-tier adapter
 * load has happened (and in `vite build`, where none ever will). The same
 * placement test ARCHITECTURE-CORE applies to manifest-vs-adapter fields —
 * "readable WITHOUT EVALUATING ANY MODULE … e.g. Vite config time" — is what
 * makes a static read of a statically-evaluable table the right instrument here
 * rather than a second declaration home.
 *
 * It reads those properties and reads them literally. Anything it cannot read
 * literally is reported as {@link AdapterRegionIncludes.unreadable} — never
 * silently treated as "no includes", because a silently dropped declaration is
 * indistinguishable from a declaration that worked, which is the whole failure
 * class this rung exists to end. `packages/editor/src/project-adapter.ts` (the
 * real loader, which IMPORTS the module) stays the validation authority: this
 * read never accepts anything that loader would reject, it only declines to
 * answer.
 */

/** One ADDITIONAL mounted surface a region declares — see
 *  `@volter/editor-project/adapter/adapter-module`'s `AdapterRegion.mounts`. */
export interface AdapterRegionMountDeclaration {
  readonly surface: 'three' | 'canvas' | 'dom';
  readonly include: readonly string[];
}

/** Region id -> the `include` globs it declares, and the additional surfaces it
 *  mounts. */
export interface AdapterRegionIncludes {
  readonly byRegionId: ReadonlyMap<string, readonly string[]>;
  /** Region id -> the surfaces it mounts BESIDE its manifest root's own
   *  adapter, each with the files that render on it. Read here for the same
   *  reason `include` is: it is the one place a root's second surface can be
   *  stated, and every OID/HMR/Content reader answers from the same table. */
  readonly mountsByRegionId: ReadonlyMap<string, readonly AdapterRegionMountDeclaration[]>;
  /**
   * `true` when the file HAS a `regions` binding this static read could not
   * evaluate (a spread, an imported constant, a computed value). The caller
   * reports it; it never reads as "declares nothing".
   */
  readonly unreadable: boolean;
}

export const EMPTY_REGION_INCLUDES: AdapterRegionIncludes = {
  byRegionId: new Map(),
  mountsByRegionId: new Map(),
  unreadable: false,
};

const UNREADABLE_REGION_INCLUDES: AdapterRegionIncludes = {
  byRegionId: new Map(),
  mountsByRegionId: new Map(),
  unreadable: true,
};

/** The game's adapter module lives beside `vgai.project.json`, by contract. */
export const ADAPTER_MODULE_FILENAME = 'vgai.adapter.ts';

function stringLiteralOf(node: ts.Node | undefined): string | undefined {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function stringArrayOf(node: ts.Node | undefined): string[] | undefined {
  if (!node || !ts.isArrayLiteralExpression(node)) return undefined;
  const out: string[] = [];
  for (const element of node.elements) {
    const value = stringLiteralOf(element);
    if (value === undefined) return undefined;
    out.push(value);
  }
  return out;
}

function propertyOf(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const member of object.properties) {
    if (!ts.isPropertyAssignment(member)) continue;
    const key = ts.isIdentifier(member.name)
      ? member.name.text
      : (stringLiteralOf(member.name) ?? null);
    if (key === name) return member.initializer;
  }
  return undefined;
}

/**
 * What the module's default export gives this reader.
 *
 * The three outcomes are deliberately distinct, because two of them used to
 * collapse into one and that collapse WAS a silent hole: `export default def`
 * (a hoisted `const def = defineAdapter({…})`) and `defineAdapter(config)`
 * both evaluate fine in `project-adapter.ts` — which validates the exported
 * VALUE — while this reader saw "not a readable literal" and answered "no
 * includes, nothing to report". The loader would honor an `include` this tier
 * had silently dropped, which is exactly the disagreement the module docblock
 * promises cannot happen. Both are now `'unreadable'`.
 */
type DefinitionRead =
  /** A statically readable argument object (possibly with no `regions`). */
  | { readonly kind: 'literal'; readonly literal: ts.ObjectLiteralExpression }
  /** A zero-argument call — `nativeAdapter()`. The legitimate empty. */
  | { readonly kind: 'empty' }
  /** No default export at all: nothing here worth flagging; the loader is the
   *  validation authority and an absent adapter is the native default. */
  | { readonly kind: 'absent' }
  /** A default export this reader cannot evaluate but the loader can. */
  | { readonly kind: 'unreadable' };

function readDefinition(source: ts.SourceFile): DefinitionRead {
  for (const statement of source.statements) {
    if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;
    const call = statement.expression;
    if (!ts.isCallExpression(call)) return { kind: 'unreadable' };
    const arg = call.arguments[0];
    if (arg === undefined) return { kind: 'empty' };
    return ts.isObjectLiteralExpression(arg)
      ? { kind: 'literal', literal: arg }
      : { kind: 'unreadable' };
  }
  return { kind: 'absent' };
}

/** Read `regions[].include` out of one adapter source. Pure — the fs half is
 *  `server/adapter-region-includes.ts`, so this is directly testable, and
 *  `adapter-region-includes-conformance.test.ts` pins it against what
 *  `parseAdapterDefinition` yields from EVALUATING the same source. */
export function parseAdapterRegionIncludes(code: string): AdapterRegionIncludes {
  const source = ts.createSourceFile('vgai.adapter.ts', code, ts.ScriptTarget.Latest, true);
  const definition = readDefinition(source);
  if (definition.kind === 'unreadable') return UNREADABLE_REGION_INCLUDES;
  if (definition.kind !== 'literal') return EMPTY_REGION_INCLUDES;
  const regions = propertyOf(definition.literal, 'regions');
  const overlay = propertyOf(definition.literal, 'regionIncludes');
  const listed = regions !== undefined && !ts.isStringLiteralLike(regions);
  // The two forms may not be combined — `defineAdapter` rejects that pairing by
  // name, so the module never loads. This tier declines to answer rather than
  // reporting half of an invalid table.
  if (listed && overlay !== undefined) return UNREADABLE_REGION_INCLUDES;
  // Absent, or the `'manifest-roots'` RULE: the derivation runs, and the
  // declared PARAMETERS beside it are what a native project states (decision,
  // 2026-08-17). Neither present is a real answer — pure reach — not a gap.
  if (!listed) return overlay ? layeredIncludes(overlay) : EMPTY_REGION_INCLUDES;
  if (!ts.isArrayLiteralExpression(regions)) return UNREADABLE_REGION_INCLUDES;

  const byRegionId = new Map<string, readonly string[]>();
  const mountsByRegionId = new Map<string, readonly AdapterRegionMountDeclaration[]>();
  for (const element of regions.elements) {
    if (!ts.isObjectLiteralExpression(element)) return UNREADABLE_REGION_INCLUDES;
    const id = stringLiteralOf(propertyOf(element, 'id'));
    if (id === undefined) return UNREADABLE_REGION_INCLUDES;
    const include = propertyOf(element, 'include');
    if (include !== undefined) {
      const globs = stringArrayOf(include);
      if (globs === undefined) return UNREADABLE_REGION_INCLUDES;
      byRegionId.set(id, globs);
    }
    const mounts = propertyOf(element, 'mounts');
    if (mounts === undefined) continue;
    const declared = mountArrayOf(mounts);
    if (declared === undefined) return UNREADABLE_REGION_INCLUDES;
    mountsByRegionId.set(id, declared);
  }
  return { byRegionId, mountsByRegionId, unreadable: false };
}

/**
 * Read the LAYERED form: `regionIncludes`, the per-region parameters the
 * `'manifest-roots'` rule takes (`@volter/editor-project/adapter/adapter-module`'s
 * {@link AdapterDefinition.regionIncludes}, decision 2026-08-17).
 *
 * Statically readable BY CONSTRUCTION — it is an object literal of object
 * literals of string arrays, sitting beside the `regions` string in the same
 * argument object — which is exactly why the decision put the parameters here
 * rather than behind a builder call. Anything that is NOT that literal shape
 * (a spread, an imported table, a computed key) is `unreadable`, on the same
 * terms as every other shape this reader declines: the loader would honor it,
 * so silence about it would be the drift this module exists to prevent.
 */
function layeredIncludes(node: ts.Expression): AdapterRegionIncludes {
  if (!ts.isObjectLiteralExpression(node)) return UNREADABLE_REGION_INCLUDES;
  const byRegionId = new Map<string, readonly string[]>();
  const mountsByRegionId = new Map<string, readonly AdapterRegionMountDeclaration[]>();
  for (const member of node.properties) {
    if (!ts.isPropertyAssignment(member)) return UNREADABLE_REGION_INCLUDES;
    const id = ts.isIdentifier(member.name) ? member.name.text : stringLiteralOf(member.name);
    const overlay = overlayOf(member.initializer);
    if (id === undefined || overlay === undefined) return UNREADABLE_REGION_INCLUDES;
    if (overlay.include) byRegionId.set(id, overlay.include);
    if (overlay.mounts) mountsByRegionId.set(id, overlay.mounts);
  }
  return { byRegionId, mountsByRegionId, unreadable: false };
}

/** One `regionIncludes` entry, read literally. `undefined` for anything this
 *  reader cannot evaluate — never a partial answer. */
function overlayOf(
  node: ts.Expression,
): { include?: string[]; mounts?: AdapterRegionMountDeclaration[] } | undefined {
  if (!ts.isObjectLiteralExpression(node)) return undefined;
  const includeNode = propertyOf(node, 'include');
  const include = includeNode === undefined ? undefined : stringArrayOf(includeNode);
  if (includeNode !== undefined && include === undefined) return undefined;
  const mountsNode = propertyOf(node, 'mounts');
  const mounts = mountsNode === undefined ? undefined : mountArrayOf(mountsNode);
  if (mountsNode !== undefined && mounts === undefined) return undefined;
  return { ...(include ? { include } : {}), ...(mounts ? { mounts } : {}) };
}

/** Read a region's `mounts` array literally. `undefined` — not an empty list —
 *  for anything this reader cannot evaluate, so the caller reports it rather
 *  than silently dropping a surface the real loader will honor. */
function mountArrayOf(node: ts.Expression): AdapterRegionMountDeclaration[] | undefined {
  if (!ts.isArrayLiteralExpression(node)) return undefined;
  const out: AdapterRegionMountDeclaration[] = [];
  for (const element of node.elements) {
    if (!ts.isObjectLiteralExpression(element)) return undefined;
    const surface = stringLiteralOf(propertyOf(element, 'surface'));
    if (surface !== 'three' && surface !== 'canvas' && surface !== 'dom') return undefined;
    const include = propertyOf(element, 'include');
    if (include === undefined) return undefined;
    const globs = stringArrayOf(include);
    if (globs === undefined || globs.length === 0) return undefined;
    out.push({ surface, include: globs });
  }
  return out;
}
