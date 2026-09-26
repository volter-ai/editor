/**
 * THE SOURCE-AUTHORING CONTRACT — the types that cross between the kit's source-write
 * client and a source-authoring integration's routes (`/__ui-source/*`): an authored
 * element's identity (`OidEntry`), what its component declares (`ComponentPropSpec`,
 * `R3fComponentContract` and its channel bindings), and the source-edit wire shapes.
 * Types only; the integration that stamps and writes source implements them.
 */

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
  /** Imports the R3F reconciler. */
  reconcilerImport: boolean;
  /** Distinct R3F-only intrinsic tags this file renders. */
  r3fOnlyTags: string[];
  /** Distinct DOM-only intrinsic tags this file renders. */
  domOnlyTags: string[];
}
export interface R3fEnvironmentNumberBinding {
  readonly value: number;
  readonly start: number;
  readonly end: number;
}
export interface R3fEnvironmentStringBinding {
  readonly value: string;
  readonly start: number;
  readonly end: number;
  readonly quote: "'" | '"' | '`';
}
export type R3fEnvironmentBinding =
  | {
      readonly kind: 'background-color';
      readonly color?: R3fEnvironmentStringBinding;
    }
  | {
      readonly kind: 'fog';
      readonly color?: R3fEnvironmentStringBinding;
      readonly near?: R3fEnvironmentNumberBinding;
      readonly far?: R3fEnvironmentNumberBinding;
    }
  | {
      readonly kind: 'fog-exp2';
      readonly color?: R3fEnvironmentStringBinding;
      readonly density?: R3fEnvironmentNumberBinding;
    };
export type R3fJointHook =
  | 'useFixedJoint'
  | 'useSphericalJoint'
  | 'useRevoluteJoint'
  | 'usePrismaticJoint'
  | 'useRopeJoint'
  | 'useSpringJoint';
export type R3fJointLiteral = number | boolean | readonly R3fJointLiteral[];
export type R3fJointLiteralRange =
  | { readonly start: number; readonly end: number }
  | readonly R3fJointLiteralRange[];
export interface R3fJointBinding {
  readonly hook: R3fJointHook;
  readonly line: number;
  readonly col: number;
  readonly body1Ref: string;
  readonly body2Ref: string;
  readonly endpoint: 0 | 1;
  readonly params?: readonly R3fJointLiteral[];
  /** Exact leaf token ranges, shape-identical to `params`. Writers change only
   * the numeric/boolean token they own, preserving formatting and comments. */
  readonly paramRanges?: readonly R3fJointLiteralRange[];
}
export interface R3fLodNumberBinding {
  readonly value: number;
  readonly start: number;
  readonly end: number;
}
export interface R3fLodBinding {
  readonly line: number;
  readonly col: number;
  readonly distances?: readonly R3fLodNumberBinding[];
  readonly hysteresis?: R3fLodNumberBinding;
}
export type QuarksEmitterShape =
  | 'point'
  | 'sphere'
  | 'hemisphere'
  | 'cone'
  | 'circle'
  | 'donut'
  | 'rectangle'
  | 'grid';
export interface R3fParticleNumberBinding {
  readonly value: number;
  readonly start: number;
  readonly end: number;
}
export interface R3fParticleBinding {
  readonly system: string;
  readonly shape: QuarksEmitterShape;
  readonly constructor: string;
  readonly line: number;
  readonly col: number;
  readonly fields: Readonly<Record<string, R3fParticleNumberBinding>>;
}
export type PhysicsChannel = 'position' | 'rotation' | 'scale';
/**
 * The body binding that owns one element's transform.
 *
 * JSON-shaped on purpose: it rides an `OidEntry` over `/__ui-source/index` to
 * the page, so it holds no `ts.Node`.
 */
export interface R3fPhysicsBinding {
  /** The local name of the hook that created the body (`useBox`). */
  hook: string;
  /** 1-based line of the hook call, in the element's own file. */
  line: number;
  /** Channels whose spawn the hook takes from the component's own props — the
   *  write belongs at this component's CALLSITE. */
  forwarded: PhysicsChannel[];
  /** Channels the hook spells as an inline literal in its own argument. There
   *  is no write anchor for those; a refusal names them. */
  literal: PhysicsChannel[];
  /**
   * Channels the component's OWN `useFrame` drives through the hook's api
   * (`api.position.set(...)`) — the spawn is not the last word for these, so
   * a callsite literal cannot hold: the game re-poses the body every frame
   * (measured on racing-game's `Train`, a Kinematic body driven from its
   * animated group — the doctor's settle leg read the authored spawn back as
   * the old pose, digit for digit). Absent (never `[]`) when nothing drives
   * the api, so an older recorded binding compares equal to one with no
   * opinion — same rule as `bodyForwarded`'s absence.
   */
  apiDriven?: PhysicsChannel[];
}
export type ReparentChannel = 'position' | 'rotation' | 'scale';
/**
 * The new LOCAL transform channels that preserve the element's world transform under
 * the destination parent — computed by the caller, which is the only side that knows
 * the live parents (R2). Absent channels are left exactly as authored.
 */
export interface ReparentRebase {
  readonly position?: readonly number[] | undefined;
  readonly rotation?: readonly number[] | undefined;
  readonly scale?: readonly number[] | undefined;
  /** Channels whose native source spelling is scalar even when the live
   * decomposition is carried as a one-value tuple (Pixi rotation). */
  readonly scalarChannels?: readonly ReparentChannel[] | undefined;
}
/**
 * What only the LIVE scene knows about a `reparent`, carried on the request so the
 * pure planner (`reparent-guard.ts`) can decide R2/R3 without a scene of its own.
 *
 * Every field is optional and every one of them can only make the plan MORE strict:
 * the planner's source-derivable rules (scope safety, children slot, literal-vs-
 * dynamic) run identically whether or not a caller supplies them, so a client that
 * knows nothing still gets a sound refusal rather than a silent corruption.
 */
export interface StructReparentContext {
  /** The new LOCAL transform that preserves the element's world transform under the
   *  destination — the caller computed it from the two live parents (R2). */
  rebase?: ReparentRebase;
  /** Live objects the destination oid resolves to; >1 is refused with the count (R3). */
  destinationInstances?: number;
  /** Live objects the moved element's oid resolves to; >1 warns and is allowed (R3). */
  sourceInstances?: number;
}
export type SourceEditRequest =
  /** `value` is a NUMBER for a numeric CSS property, and that is load-bearing:
   *  the writer emits a bare `12` (which React px-ifies at render) rather than
   *  the quoted `'12'` the CSSOM rejects. `null` is the REMOVAL sentinel. */
  | { kind: 'style'; oid: string; prop: string; value: string | number | null }
  | { kind: 'css'; file: string; selector: string; prop: string; value: string; media?: string }
  | { kind: 'text'; oid: string; text: string }
  | {
      kind: 'prop';
      oid: string;
      prop: string;
      /** `null` is the REMOVAL sentinel — the same shape `style` uses (D-A3);
       *  it routes to `removePropAttribute` instead of a value write. */
      value: string | null;
      addIfMissing?: boolean;
      allowShapeUpgrade?: boolean;
    }
  | {
      /** Replace a literal default in the component declaration containing
       * `oid`. The component name comes from the OID index, never the caller. */
      kind: 'component-default';
      oid: string;
      prop: string;
      value: string;
    }
  | ({
      kind: 'struct';
      oid: string;
      op: string;
      targetOid?: string;
      parentOid?: string;
      wrapperTag?: string;
      /** Optional multi-line JSX snippet for `create`/`create-sibling` — see
       *  `insertChildElement` / `insertSiblingElement`. */
      snippet?: string;
      /** A named import the inserted `snippet` needs (its tag is a component).
       *  Applied to the SAME file in the same plan, so the insert and the import
       *  it depends on are one write and one undo entry — see `ensureNamedImport`. */
      ensureImport?: { name: string; module: string; kind?: 'default' | 'named' };
      /** `duplicate` only — what the copy should differ in (`writer.ts` `DuplicateRewrite`). */
      duplicate?: DuplicateRewrite;
    } & StructReparentContext)
  | { kind: 'struct-many'; oids: readonly string[]; op: string; wrapperTag?: string };
export interface PreparedSourceEdit {
  readonly changed: boolean;
  readonly file?: string;
  readonly resourcePath?: string;
  readonly prevSource?: string;
  readonly newSource?: string;
  readonly prevSha?: string;
  readonly newSha?: string;
  readonly result: Record<string, unknown>;
}
/** What a lane may ask {@link duplicateElement} to change on the COPY — the
 *  three lane's "a duplicate is visibly a second thing": a fresh `name` (only
 *  when the original carries a literal one — never invented) and a literal
 *  `position` nudged by `positionOffset` (added when absent, since an absent
 *  position IS the origin; left alone when dynamic). */
export interface DuplicateRewrite {
  name?: string;
  positionOffset?: readonly [number, number, number];
}
