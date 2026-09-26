/**
 * `planCreationSiteEdit` — the PURE plan for "write this property edit
 * into the game's own source at the line that constructed the object".
 *
 * The read half: a serve-time transform stamps every direct
 * `new` in a served project module, and a host-side `WeakMap` answers "which
 * `file:line` built this live object?" (`creation-site-registry.ts`). This
 * module is the write half's decision-maker. It takes the anchor, the source
 * bytes, the value in force BEFORE the edit and the value the user produced,
 * and returns either exact new bytes or a NAMED refusal — never a guess.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT A THREE.JS SIGNATURE TABLE, AND MUST NEVER BECOME ONE
 *
 * The tempting way to write `new THREE.DirectionalLight(0xffffff, 2)` back is a
 * table saying "argument 1 of DirectionalLight is `intensity`". That table is
 * fabrication with extra steps: it is unverifiable at the edit, it is wrong for
 * every constructor nobody wrote a row for, and when it is wrong it silently
 * corrupts someone else's game. This module knows NOTHING about three.js.
 *
 * Two rules replace that knowledge, and they do different jobs. The first
 * decides WHICH literal may be written; the second decides WHETHER writing it
 * is still true. Both must hold.
 *
 *  1. NAME ADDRESSING — the only way a literal ever becomes a candidate. The
 *     SOURCE ITSELF must name the property: `sun.position.set(…)` contains the
 *     word `position`; `new THREE.MeshBasicMaterial({ opacity: 0.2 })` contains
 *     the word `opacity`. A BARE POSITIONAL ARGUMENT NAMES NOTHING AND IS NEVER
 *     A CANDIDATE, no matter what its value happens to be. `scanConstructor`'s
 *     comment carries the three real corruptions that rule was bought with.
 *
 *  2. THE BASELINE-EQUALITY BACKSTOP. A candidate may be rewritten only when
 *     its CURRENT value equals the value in force on the live object. That
 *     subsumes an unbounded amount of static analysis this module deliberately
 *     does not do:
 *       - a later `sun.position.copy(target)` we never modelled? then the
 *         literal is not what is in force, so we refuse;
 *       - the object escaped into a function that mutated it? same;
 *       - the simulation animates the value every frame? same.
 *     Its contrapositive is the honest claim this feature makes: when we DO
 *     write, the literal we replace is demonstrably the value the user was
 *     looking at, so replacing it produces what they dragged to.
 *
 * NOTE WHAT RULE 2 CANNOT DO, because an earlier revision of this file got it
 * wrong and shipped a corruption: it cannot tell a right slot from a wrong one.
 * Equality is evidence about the VALUE, never about which slot means what — and
 * when a coincidence is what put the two in agreement, the coincidence IS the
 * equality, so the backstop nods it through. That is precisely why rule 1 is a
 * gate and not a preference: rule 2 defends the write's TRUTH, and only rule 1
 * defends its TARGET.
 *
 * Everything else here — receiver resolution, the enclosing-function walk,
 * multiplicity, per-component homes — exists to FIND candidates under rule 1.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BYTE-IDENTITY ON REFUSAL. Every refusal returns `newSource === prevSource`,
 * identity-equal, and `changed: false`. A caller that writes on `changed` can
 * never be tricked into a no-op write, and the file a refused gesture touched is
 * bit-for-bit the file it started as. (`creation-site-edit.test.ts` asserts this
 * over every refusal branch — the reparent-guard precedent.)
 *
 * ONE TRANSACTION. Every rule is decided before the first byte moves, and an
 * accepted plan is ONE new whole-file string covering every component the
 * gesture touched. The caller turns that into one history transaction pairing
 * the live mutation with the source write, so undo restores both.
 */

import ts from 'typescript';
import type { CreationSite } from '@volter/editor-sdk/kit/creation-site-registry';

/** Float slack for "is this literal the value in force". Gizmo drags and the
 *  quaternion→Euler round trip both land a few ULPs off an authored decimal. */
const EPS = 1e-6;

/** What a channel's value looks like crossing this seam. Vector channels arrive
 *  as three numbers; everything else is one scalar. */
export type ChannelValue = number | boolean | string | readonly number[];

/**
 * The live sub-object that actually OWNS a property, and therefore whose
 * creation site the edit must be anchored to.
 *
 * `material.color` is the case that forces this to exist: the mesh was built by
 * `new THREE.Mesh(geometry, gridMaterial)`, but the colour lives on the
 * MATERIAL, built by its own `new THREE.MeshBasicMaterial({ color: … })`
 * elsewhere. Anchoring a colour edit to the mesh's line would look for a `color`
 * the mesh's constructor never mentions — and the only ways out of that are
 * refusing a perfectly writable edit or inventing a link. Asking the caller for
 * the material's OWN anchor is neither.
 */
export type ChannelOwner = 'self' | 'material';

export type ChannelKind =
  | 'vector3'
  | 'vector2'
  | 'euler'
  | 'color'
  | 'number'
  | 'boolean'
  | 'string';

export interface PropertyChannel {
  /** Which live object's creation site this property is anchored to. */
  readonly owner: ChannelOwner;
  /** The RECEIVER-relative member path as it is spelled in source
   *  (`position`, `intensity`, `castShadow`). */
  readonly member: string;
  readonly kind: ChannelKind;
  /**
   * Receiver-relative member paths that each hold ONE component of this channel
   * DIRECTLY, in source order — a SECOND spelling of the same storage, not a
   * second property.
   *
   * Pixi is why this exists: `Container.x` is a getter/setter over
   * `this.position.x`, so `hud.x = 16` and `hud.position.set(16, 16)` are the
   * same value written two ways, and both are ordinary idiom in an unmodified
   * game. Modelling them as two channels would be the two-parallel-lists defect
   * `IngestSourcePersistence.gate`'s comment records; modelling the alias as a
   * spelling keeps ONE channel, one baseline, and one last-writer-wins ordering
   * over every literal found either way.
   *
   * Absent for every three channel: `Object3D` has no `.x`.
   */
  readonly componentMembers?: readonly string[];
}

/**
 * The editor's inspector/transform property paths → what they are in source.
 *
 * This is a DATA table over paths the ingest adapter already reads and writes
 * (`ThreeAuthoringAdapter.inspector.properties`), not a vocabulary invented
 * here: every key is a path some existing editor surface already produces, and
 * a path absent from this table is refused by name rather than guessed at.
 */
export const CREATION_SITE_CHANNELS: Readonly<Record<string, PropertyChannel>> = {
  position: { owner: 'self', member: 'position', kind: 'vector3' },
  rotation: { owner: 'self', member: 'rotation', kind: 'euler' },
  scale: { owner: 'self', member: 'scale', kind: 'vector3' },
  visible: { owner: 'self', member: 'visible', kind: 'boolean' },
  name: { owner: 'self', member: 'name', kind: 'string' },
  'material.color': { owner: 'material', member: 'color', kind: 'color' },
  'light.color': { owner: 'self', member: 'color', kind: 'color' },
  'light.intensity': { owner: 'self', member: 'intensity', kind: 'number' },
  'light.distance': { owner: 'self', member: 'distance', kind: 'number' },
  'camera.fov': { owner: 'self', member: 'fov', kind: 'number' },
  'camera.near': { owner: 'self', member: 'near', kind: 'number' },
  'camera.far': { owner: 'self', member: 'far', kind: 'number' },
  'shadow.cast': { owner: 'self', member: 'castShadow', kind: 'boolean' },
  'shadow.receive': { owner: 'self', member: 'receiveShadow', kind: 'boolean' },
};

/**
 * The CANVAS surface's table — the same contract, a different vocabulary.
 *
 * It is a SEPARATE table rather than extra rows because the same editor path
 * means a different thing on each surface: `position` is a three-component
 * vector on a `THREE.Object3D` and a two-component one on a `PIXI.Container`,
 * and `rotation` is an Euler triple there and a scalar in radians here. Merging
 * them would need a per-row surface tag on every row, which is the same fork
 * wearing a field.
 *
 * Every key is a path the canvas adapter already produces — the three
 * `TransformChannel`s plus the reflected inspector rows
 * (`AuthoringAdapter2D.properties`) — so nothing here is a vocabulary invented
 * at the write path.
 *
 * `scale` has no `componentMembers` on purpose: Pixi has `sprite.x` but no
 * `sprite.scaleX`, so listing one would be a spelling no game can contain.
 */
export const PIXI_CREATION_SITE_CHANNELS: Readonly<Record<string, PropertyChannel>> = {
  position: { owner: 'self', member: 'position', kind: 'vector2', componentMembers: ['x', 'y'] },
  rotation: { owner: 'self', member: 'rotation', kind: 'number' },
  scale: { owner: 'self', member: 'scale', kind: 'vector2' },
  visible: { owner: 'self', member: 'visible', kind: 'boolean' },
  // The editor's `name` row is Pixi's `label` (`AuthoringAdapter2D.set` maps it).
  name: { owner: 'self', member: 'label', kind: 'string' },
  alpha: { owner: 'self', member: 'alpha', kind: 'number' },
  tint: { owner: 'self', member: 'tint', kind: 'color' },
};

/** Babylon's native imperative transform/property spellings. The editor paths
 * stay universal; only this substrate table says how those paths are written
 * in Babylon source. */
export const BABYLON_CREATION_SITE_CHANNELS: Readonly<Record<string, PropertyChannel>> = {
  position: { owner: 'self', member: 'position', kind: 'vector3' },
  rotation: { owner: 'self', member: 'rotation', kind: 'euler' },
  scale: { owner: 'self', member: 'scaling', kind: 'vector3' },
  name: { owner: 'self', member: 'name', kind: 'string' },
  visible: { owner: 'self', member: 'isVisible', kind: 'boolean' },
  visibility: { owner: 'self', member: 'visibility', kind: 'number' },
};

/** Which RENDER SURFACE's vocabulary a request speaks. Not provenance: an
 *  ingested Pixi game and a first-party canvas world answer identically here,
 *  and a three world differs because `Object3D` is a different shape. */
export type CreationSiteSurface = 'three' | 'pixi' | 'babylon';

/** Authority carried by a creation-site write. Ordinary gestures address one
 * live object; the component-default gesture deliberately addresses the source
 * site itself and therefore every object constructed there. */
export type CreationSiteWriteScope = 'instance' | 'creation-site';

/** The channel for an editor property path on one surface, or `null` when this
 *  seam has no source expression for it. */
export function channelFor(
  property: string,
  surface: CreationSiteSurface = 'three',
): PropertyChannel | null {
  const table =
    surface === 'pixi'
      ? PIXI_CREATION_SITE_CHANNELS
      : surface === 'babylon'
        ? BABYLON_CREATION_SITE_CHANNELS
        : CREATION_SITE_CHANNELS;
  return table[property] ?? null;
}

export interface CreationSiteEditRequest {
  /** The anchor the registry reported for the property's OWNING object. */
  readonly site: CreationSite;
  /**
   * How many live objects have been recorded at this anchor. `1` is the only
   * count a single-object edit may be written at — see {@link multiplicityRefusal}.
   */
  readonly instances: number;
  /** Absent means the ordinary single-object gesture. `creation-site` is used
   * only by the explicit Apply-to-component confirmation, whose UI names the
   * full affected instance count before this request exists. */
  readonly writeScope?: CreationSiteWriteScope;
  /** An editor property path — a key of the surface's channel table. */
  readonly property: string;
  /** Which surface's vocabulary {@link CreationSiteEditRequest.property} is in.
   *  Absent ⇒ `three`, which is what every caller predating the canvas lane
   *  meant. */
  readonly surface?: CreationSiteSurface;
  /** The value in force on the live object BEFORE this gesture. */
  readonly baseline: ChannelValue;
  /** The value the gesture produced. */
  readonly next: ChannelValue;
}

export interface CreationSiteEditPlan {
  readonly changed: boolean;
  readonly prevSource: string;
  /** Identity-equal to `prevSource` whenever `changed` is false. */
  readonly newSource: string;
  /** Present iff `!changed` — the named reason, per the never-fabricate rule. */
  readonly reason?: string;
  /** Present iff `changed` — a one-line description for the history label. */
  readonly wrote?: string;
}

function refuse(source: string, reason: string): CreationSiteEditPlan {
  return { changed: false, prevSource: source, newSource: source, reason };
}

/**
 * The refusal for a shared creation site, stated with the count that makes it
 * true. SimCity's `const tile = new Tile(x, y)` builds all 256 tiles from one
 * line, so a per-tile edit has nowhere honest to go: writing that line would
 * move every tile, and writing it "just for this one" is a lie about what the
 * source says. The count comes from the registry, which is the only thing that
 * knows it.
 */
export function multiplicityRefusal(instances: number): string {
  return (
    `this creation site constructs ${instances} objects; ` +
    'a per-object edit cannot be written there'
  );
}

// ───────────────────────────────────────────────────────── value normalization

type Scalar = number | boolean | string;

interface Components {
  readonly values: readonly Scalar[];
  /** `.x`/`.y`/`.z` for vector channels; `''` for a scalar channel. */
  readonly labels: readonly string[];
}

function componentsOf(kind: ChannelKind, value: ChannelValue): Components | null {
  if (kind === 'vector3' || kind === 'euler' || kind === 'vector2') {
    const arity = kind === 'vector2' ? 2 : 3;
    if (!Array.isArray(value) || value.length !== arity) return null;
    const values = value as readonly number[];
    if (values.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
    return { values, labels: arity === 2 ? ['x', 'y'] : ['x', 'y', 'z'] };
  }
  if (kind === 'number') {
    return typeof value === 'number' && Number.isFinite(value)
      ? { values: [value], labels: [''] }
      : null;
  }
  if (kind === 'boolean') {
    return typeof value === 'boolean' ? { values: [value], labels: [''] } : null;
  }
  // 'color' and 'string' both cross the seam as strings.
  return typeof value === 'string' ? { values: [value], labels: [''] } : null;
}

/** A colour as a 24-bit int, whatever notation it arrived in — the one form two
 *  colour literals can be compared in. `null` when it is not a colour at all
 *  (a named CSS colour, `new THREE.Color(…)`): unrecognized, therefore refused. */
function colorInt(value: Scalar): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const hex = value.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return Number.parseInt(hex, 16);
}

/** Is the literal currently in source the value currently in force? THE rule —
 *  see the module header. */
function sameValue(kind: ChannelKind, literal: Scalar, live: Scalar): boolean {
  if (kind === 'color') {
    const a = colorInt(literal);
    const b = colorInt(live);
    return a !== null && b !== null && a === b;
  }
  if (typeof literal === 'number' && typeof live === 'number') {
    return Math.abs(literal - live) <= EPS;
  }
  return literal === live;
}

function formatNumber(n: number): string {
  // Trim the float noise a gizmo drag carries without pretending to a precision
  // the source never had; `-0` is normalized away because `Object.is` distinguishes
  // it and no author wrote it.
  const rounded = Number(n.toFixed(6));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** Render the new value in the SAME notation the literal being replaced used —
 *  a game written in `0x` hex stays written in `0x` hex. */
function formatReplacement(kind: ChannelKind, value: Scalar, existingText: string): string | null {
  if (kind === 'color') {
    const int = colorInt(value);
    if (int === null) return null;
    if (/^0[xX]/.test(existingText)) return `0x${int.toString(16).padStart(6, '0')}`;
    const quote = existingText[0];
    if (quote === '"' || quote === "'" || quote === '`') {
      return `${quote}#${int.toString(16).padStart(6, '0')}${quote}`;
    }
    return String(int);
  }
  if (kind === 'string') {
    const quote = existingText[0] === '"' ? '"' : "'";
    return `${quote}${String(value).replace(/\\/g, '\\\\').replace(new RegExp(quote, 'g'), `\\${quote}`)}${quote}`;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return formatNumber(value);
  return null;
}

// ───────────────────────────────────────────────────────────── literal reading

interface LiteralRead {
  readonly value: Scalar;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * The literal an expression IS, or `null` when it is an expression that merely
 * has a value. A leading `-` counts (authors write `-0.04`, not `0 - 0.04`);
 * anything else — an identifier, a call, arithmetic — does not, and that `null`
 * is what becomes "the editor never overwrites an expression".
 */
function readLiteral(node: ts.Expression, sf: ts.SourceFile): LiteralRead | null {
  const start = node.getStart(sf);
  const end = node.getEnd();
  const text = node.getText(sf);
  const at = (value: Scalar): LiteralRead => ({ value, start, end, text });

  if (ts.isNumericLiteral(node)) return at(Number(node.text));
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return at(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return at(true);
  if (node.kind === ts.SyntaxKind.FalseKeyword) return at(false);
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
    if (node.operator === ts.SyntaxKind.MinusToken) return at(-Number(node.operand.text));
    if (node.operator === ts.SyntaxKind.PlusToken) return at(Number(node.operand.text));
  }
  return null;
}

// ─────────────────────────────────────────────────────────── source navigation

/** A direct constructor or factory initializer stamped by the serve transform. */
type ConstructionExpression = ts.NewExpression | ts.CallExpression;

/** The construction expression this anchor points at, or `null` when the file
 * moved under us. */
function constructionExpressionAt(
  sf: ts.SourceFile,
  offset: number,
): ConstructionExpression | null {
  let found: ConstructionExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node.getEnd() <= offset || node.getStart(sf) > offset) return;
    if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && node.getStart(sf) === offset) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/**
 * The name the constructed object is bound to, as it must be SPELLED to address
 * it again (`sun`, `this.camera`), or `null` when the construction is never
 * bound at all (`scene.add(new THREE.AmbientLight(…))`) — in which case only
 * the constructor's own arguments can hold this property.
 */
function receiverOf(node: ConstructionExpression, sf: ts.SourceFile): string | null {
  let current: ts.Node = node;
  // Step out through parentheses/`as`/`!` so `const a = (new Foo())` still binds.
  while (
    current.parent &&
    (ts.isParenthesizedExpression(current.parent) ||
      ts.isAsExpression(current.parent) ||
      ts.isNonNullExpression(current.parent))
  ) {
    current = current.parent;
  }
  const parent = current.parent;
  if (!parent) return null;
  if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
    return ts.isIdentifier(parent.name) ? parent.name.text : null;
  }
  if (ts.isPropertyDeclaration(parent) && parent.initializer === current) {
    // A class field: `camera = new THREE.OrthographicCamera(…)` is addressed as
    // `this.camera` by every statement that follows it.
    return ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name)
      ? `this.${parent.name.text}`
      : null;
  }
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === current
  ) {
    const left = parent.left;
    if (ts.isIdentifier(left) || ts.isPropertyAccessExpression(left)) return normalized(left, sf);
  }
  return null;
}

/** Source text with insignificant whitespace squeezed out, so `this . camera`
 *  and `this.camera` are the same receiver. */
function normalized(node: ts.Node, sf: ts.SourceFile): string {
  return node.getText(sf).replace(/\s+/g, '');
}

type BodyNode = ts.Block | ts.SourceFile | ts.ModuleBlock;

/** The function body (or module top level) the creation statement lives in —
 *  the scope the spec bounds the literal search to. */
function enclosingBody(node: ts.Node): BodyNode | null {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isSourceFile(current)) return current;
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isConstructorDeclaration(current) ||
      ts.isGetAccessorDeclaration(current) ||
      ts.isSetAccessorDeclaration(current)
    ) {
      const body = current.body;
      return body && ts.isBlock(body) ? body : null;
    }
    // A class field initializer's scope is the constructor's, which we cannot
    // see from here; the class body is the honest boundary.
    if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) return null;
    current = current.parent;
  }
  return null;
}

/**
 * True when `node`'s own statement sits DIRECTLY in `body` — not nested inside
 * a loop, a branch, or a callback, where source order says nothing about which
 * write is in force.
 *
 * The check is on the NEAREST enclosing statement, not on any ancestor that
 * happens to be one. A first cut climbed until an ancestor's parent was `body`
 * and accepted it if that ancestor was a statement — which is true of the `for`
 * a write is buried inside, so a per-iteration write read as top-level. That
 * bug is what the `for`-loop case in `creation-site-edit.test.ts` pins.
 */
function isTopLevelIn(node: ts.Node, body: BodyNode): boolean {
  let current: ts.Node | undefined = node;
  while (current && !ts.isStatement(current)) current = current.parent;
  return current !== undefined && current.parent === body;
}

/** A human name for the construct a nested write is buried in, for the refusal. */
function nestingKindOf(node: ts.Node, body: BodyNode): string {
  let current: ts.Node | undefined = node.parent;
  while (current && current !== body) {
    if (
      ts.isForStatement(current) ||
      ts.isForOfStatement(current) ||
      ts.isForInStatement(current)
    ) {
      return 'loop';
    }
    if (ts.isWhileStatement(current) || ts.isDoStatement(current)) return 'loop';
    if (ts.isIfStatement(current)) return 'conditional';
    if (ts.isTryStatement(current) || ts.isCatchClause(current)) return 'try block';
    if (
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current) ||
      ts.isFunctionDeclaration(current)
    ) {
      return 'nested function';
    }
    current = current.parent;
  }
  return 'nested block';
}

// ───────────────────────────────────────────────────────────── home collection

/** One literal in source that holds one component of the edited channel. */
interface Home {
  readonly component: number;
  readonly literal: LiteralRead;
  readonly line: number;
  /**
   * The span of the whole OWN statement holding this home, present exactly
   * when the home is a top-level `receiver.member[.axis] = literal;`
   * expression statement — the one shape the insertion arm writes, and
   * therefore the one shape {@link planCreationSiteRemoval} may delete to
   * restore byte-absence. Constructor literals, `.set(…)` arguments and alias
   * writes carry no statement: dropping those would rewrite the game's own
   * code, not revert an authored override.
   */
  readonly statement?: { readonly start: number; readonly end: number };
}

/**
 * A write to the channel we found but cannot rewrite — kept so the refusal can
 * name it instead of silently rewriting an earlier, dead literal.
 *
 * `component` is what keeps this from over-refusing. SimCity's
 * `grid.position.set(city.size / 2 - 0.5, -0.04, city.size / 2 - 0.5)` blocks
 * `x` and `z` and holds a perfectly good literal for `y`; a blocker without a
 * component would make the x/z expressions veto a y-only drag, which is the
 * opposite of property-by-property honesty. `null` means the blocker is about
 * the whole channel (an ambiguous constructor, a whole-channel assignment, a
 * write in a nested scope) and does veto every component.
 */
interface Blocker {
  readonly reason: string;
  readonly offset: number;
  readonly component: number | null;
}

/** Does this blocker stand in the way of `component`? */
function blocks(blocker: Blocker, component: number): boolean {
  return blocker.component === null || blocker.component === component;
}

interface Scan {
  readonly homes: readonly Home[];
  readonly blockers: readonly Blocker[];
}

function lineOf(sf: ts.SourceFile, pos: number): number {
  return ts.getLineAndCharacterOfPosition(sf, pos).line + 1;
}

/**
 * Every literal in the constructor's arguments that could hold this channel —
 * which means every NAME-ADDRESSED one, and nothing else: a key in an
 * object-literal argument matching the member
 * (`new THREE.MeshBasicMaterial({ opacity: 0.2 })`).
 *
 * NO POSITIONAL MATCHING. A bare argument is never a home, however well its
 * literal happens to agree with the value in force.
 *
 * Matching positionally — "the one argument whose literal equals the live
 * value", on the theory that agreement is evidence — corrupts source. Three
 * cases driven through this planner:
 *
 *   const player = new Player(scene, true);   // unchecking Visible wrote `false`
 *   const lamp   = new Lamp(1);               // an Intensity drag wrote the type code
 *   const npc    = new NPC('goblin');         // a rename overwrote the model key
 *
 * In each the matched argument means something else entirely and merely holds a
 * value equal to a three.js DEFAULT the source never set. The two guards this
 * module leans on are both blind to it: the ambiguity check only fires on TWO
 * matches, and the baseline-equality backstop cannot fire because THE
 * COINCIDENCE *IS* BASELINE EQUALITY. Nor is the exposure exotic — the evidence
 * a value carries is its entropy, and the values in play are `true`, `false`,
 * `0` and `1`; `visible` alone puts every object with one boolean argument at
 * risk, and it is in the inspector for every object.
 *
 * So the rule is the doctrine's: REFUSE RATHER THAN GUESS. For
 * `new THREE.DirectionalLight(0xffffff, 2)` the honest answer to an intensity
 * drag is "nothing at game.js:105 names `intensity`" — a live-only edit with a
 * named reason, which is precisely the presentation the architecture asks for.
 * Matching a slot by value is fabricating signature knowledge with extra steps:
 * sourced from a coincidence instead of from a table, but fabricated either way.
 */
function scanConstructor(
  node: ConstructionExpression,
  sf: ts.SourceFile,
  channel: PropertyChannel,
  baseline: Components,
): Scan {
  const args = node.arguments ? [...node.arguments] : [];
  const homes: Home[] = [];
  const blockers: Blocker[] = [];

  for (const arg of args) {
    if (!ts.isObjectLiteralExpression(arg)) continue;
    for (const prop of arg.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : '';
      if (key !== channel.member) continue;
      const init = prop.initializer;
      if (ts.isArrayLiteralExpression(init) && baseline.values.length === init.elements.length) {
        init.elements.forEach((element, index) => {
          const literal = readLiteral(element, sf);
          if (literal) homes.push({ component: index, literal, line: lineOf(sf, literal.start) });
          else {
            blockers.push({
              reason: expressionRefusal(channel, baseline.labels[index]!, element, sf),
              offset: element.getStart(sf),
              component: index,
            });
          }
        });
        continue;
      }
      const literal = readLiteral(init, sf);
      if (literal && baseline.values.length === 1) {
        homes.push({ component: 0, literal, line: lineOf(sf, literal.start) });
      } else {
        blockers.push({
          reason: expressionRefusal(channel, baseline.labels[0]!, init, sf),
          offset: init.getStart(sf),
          component: baseline.values.length === 1 ? 0 : null,
        });
      }
    }
  }
  // Nothing else. A BARE POSITIONAL ARGUMENT IS NEVER A HOME — see the
  // "no positional matching" note above `scanConstructor`. When the constructor
  // names nothing, this scan is empty and the caller's honest answer is
  // "nothing at <file>:<line> names <property>".
  return { homes, blockers };
}

function expressionRefusal(
  channel: PropertyChannel,
  label: string,
  node: ts.Node,
  sf: ts.SourceFile,
): string {
  const path = label ? `${channel.member}.${label}` : channel.member;
  const text = node.getText(sf).replace(/\s+/g, ' ').trim();
  return (
    `${path} is set from an expression at line ${lineOf(sf, node.getStart(sf))} ` +
    `(\`${text}\`), not a literal — the editor never overwrites an expression`
  );
}

/**
 * Every write to `<receiver>.<member>` in the creation statement's enclosing
 * function.
 *
 * Recognized as REWRITABLE: `R.m.set(a, b, c)` with the right arity, a per-axis
 * assignment `R.m.x = a`, and a whole-channel assignment `R.m = a`. Recognized
 * as a BLOCKER: any of those whose value is an expression, a compound assignment
 * (`+=`), and any write that is not at the enclosing function's top statement
 * level.
 *
 * Deliberately NOT modelled: `R.m.copy(v)`, `R.m.applyMatrix4(…)`, and every
 * other mutating three.js method. Enumerating them would be the signature table
 * this file exists to avoid, and it is unnecessary: a write we did not see moves
 * the live value away from the literal we would have rewritten, and the
 * baseline-equality check then refuses. Missing a mutator costs a refusal, never
 * a corruption.
 */
function scanReceiverWrites(
  body: BodyNode,
  sf: ts.SourceFile,
  receiver: string,
  channel: PropertyChannel,
  baseline: Components,
  afterOffset: number,
): Scan {
  const homes: Home[] = [];
  const blockers: Blocker[] = [];
  const channelPath = `${receiver}.${channel.member}`;

  const note = (node: ts.Node, reason: string, component: number | null): void => {
    blockers.push({ reason, offset: node.getStart(sf), component });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const target = node.expression;
      if (target.name.text === 'set' && normalized(target.expression, sf) === channelPath) {
        if (node.getStart(sf) < afterOffset) return;
        if (!isTopLevelIn(node, body)) {
          note(node, nestedRefusal(channelPath, sf, node, body), null);
          return;
        }
        if (node.arguments.length !== baseline.values.length) {
          note(
            node,
            `${channelPath}.set(…) at line ${lineOf(sf, node.getStart(sf))} passes ` +
              `${node.arguments.length} arguments for a ${baseline.values.length}-component ` +
              "value — the editor will not change a call's arity",
            null,
          );
          return;
        }
        node.arguments.forEach((arg, index) => {
          const literal = readLiteral(arg, sf);
          if (literal) homes.push({ component: index, literal, line: lineOf(sf, literal.start) });
          else note(arg, expressionRefusal(channel, baseline.labels[index]!, arg, sf), index);
        });
        return;
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      ts.isPropertyAccessExpression(node.left) &&
      isAssignmentOperator(node.operatorToken.kind)
    ) {
      const left = normalized(node.left, sf);
      const isWhole = left === channelPath;
      const axis = baseline.labels.indexOf(node.left.name.text);
      const isAxis =
        axis >= 0 &&
        baseline.labels[0] !== '' &&
        normalized(node.left.expression, sf) === channelPath;
      if ((isWhole || isAxis) && node.getStart(sf) >= afterOffset) {
        const component = isWhole ? 0 : axis;
        if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
          note(
            node,
            `${left} is updated in place at line ${lineOf(sf, node.getStart(sf))} ` +
              `(\`${node.getText(sf).replace(/\s+/g, ' ').trim()}\`) — the editor never rewrites a ` +
              'compound assignment',
            isWhole ? null : component,
          );
          return;
        }
        if (isWhole && baseline.values.length !== 1) {
          note(
            node,
            `${left} is assigned whole at line ${lineOf(sf, node.getStart(sf))} ` +
              `(\`${node.right.getText(sf).replace(/\s+/g, ' ').trim()}\`) — a ` +
              `${baseline.values.length}-component value has no literal to rewrite there`,
            null,
          );
          return;
        }
        if (!isTopLevelIn(node, body)) {
          note(node, nestedRefusal(left, sf, node, body), isWhole ? null : component);
          return;
        }
        const literal = readLiteral(node.right, sf);
        if (literal) {
          const statement =
            ts.isExpressionStatement(node.parent) && node.parent.expression === node
              ? { start: node.parent.getStart(sf), end: node.parent.getEnd() }
              : undefined;
          homes.push({
            component,
            literal,
            line: lineOf(sf, literal.start),
            ...(statement ? { statement } : {}),
          });
        } else {
          note(
            node.right,
            expressionRefusal(channel, baseline.labels[component]!, node.right, sf),
            component,
          );
        }
        return;
      }
    }

    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return { homes, blockers };
}

/**
 * Is this binary operator a WRITE (`=`, `+=`, `??=`, …) rather than a read?
 *
 * `scanReceiverWrites` looks for `<receiver>.<member> <op> <value>`, and without
 * this guard it read ANY binary expression whose left side is that member path
 * as a write — so `const bx = bird.x - 14` was reported as "bird.x is updated in
 * place … the editor never rewrites a compound assignment", refusing a
 * perfectly writable edit with a sentence that is not true of the line it names.
 *
 * It only became reachable with `componentMembers`: with the three channels the
 * left side is `sun.position`, and no real game does arithmetic on a `Vector3`
 * member path, so the bug sat unfired. Pixi's `bird.x` is a NUMBER, and reading
 * it in arithmetic is ordinary in every frame of every game. Found live on the
 * flappy ingest fixture, not by a test.
 */
function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function nestedRefusal(path: string, sf: ts.SourceFile, node: ts.Node, body: BodyNode): string {
  return (
    `${path} is also written at line ${lineOf(sf, node.getStart(sf))} inside a ` +
    `${nestingKindOf(node, body)} — the editor cannot know which write is in force`
  );
}

/**
 * The channel's ALIAS spellings — each `componentMembers` entry scanned as if it
 * were its own one-component channel, with the resulting homes and blockers
 * relabelled onto the component they actually hold.
 *
 * Nothing new is decided here. It re-runs {@link scanConstructor} and
 * {@link scanReceiverWrites} verbatim over a synthetic scalar channel, so
 * `hud.x = 16` is accepted, refused and worded by exactly the rules that govern
 * `hud.intensity = 16` — including the nested-scope, compound-assignment and
 * expression refusals. That reuse is the point: an alias must not become a
 * second, laxer path to the same bytes.
 */
function scanComponentAliases(
  construction: ConstructionExpression,
  sf: ts.SourceFile,
  channel: PropertyChannel,
  baseline: Components,
  receiver: string | null,
  body: BodyNode | null,
): Scan {
  const homes: Home[] = [];
  const blockers: Blocker[] = [];
  const aliases = channel.componentMembers;
  if (!aliases) return { homes, blockers };
  aliases.forEach((member, component) => {
    const value = baseline.values[component];
    if (value === undefined) return;
    const scalar: PropertyChannel = { owner: channel.owner, member, kind: 'number' };
    const one: Components = { values: [value], labels: [''] };
    const scans: Scan[] = [scanConstructor(construction, sf, scalar, one)];
    if (receiver && body) {
      scans.push(scanReceiverWrites(body, sf, receiver, scalar, one, construction.getStart(sf)));
    }
    for (const scan of scans) {
      for (const home of scan.homes) homes.push({ ...home, component });
      for (const blocker of scan.blockers) blockers.push({ ...blocker, component });
    }
  });
  return { homes, blockers };
}

// ─────────────────────────────────────────────────────────────────── the plan

/**
 * WHICH LITERAL HOLDS EACH COMPONENT of one channel at one creation site — the
 * whole of "read the source" with none of "decide the write".
 *
 * Extracted so the READ surface ({@link readCreationSiteLiteral}, which shows an
 * instance's overrides against the component default the site names) and the
 * WRITE decision ({@link planCreationSiteEdit}) cannot drift into two scanning
 * rules. Every judgement about what a literal IS stays here; every judgement
 * about whether replacing it is TRUE stays in the caller.
 */
interface SiteScan {
  readonly sf: ts.SourceFile;
  /** Component index → the literal in force for it (LAST WRITER WINS). */
  readonly chosen: ReadonlyMap<number, Home>;
  /** EVERY home found, chosen or superseded — the removal planner needs the
   *  losers too: deleting the last writer while an earlier author stands
   *  would fall back to that author's value, not to absence. */
  readonly homes: readonly Home[];
  readonly blockers: readonly Blocker[];
  /**
   * Where a per-axis assignment could be INSERTED when a component has no
   * home and no blocker: right after the statement that binds the
   * construction to `receiver`. `null` when the construction is not a
   * body-level `const x = new …` / `x = new …` — a class-field initializer
   * or an expression-position construction has no honest statement slot.
   */
  readonly insertAt: {
    readonly offset: number;
    readonly indent: string;
    readonly receiver: string;
  } | null;
}

function scanSite(
  source: string,
  site: CreationSite,
  channel: PropertyChannel,
  baseline: Components,
): SiteScan | { readonly refusal: string } {
  const sf = ts.createSourceFile(
    site.file,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKindFor(site.file),
  );
  const offset = lineColToOffset(source, site.line, site.col);
  const construction = constructionExpressionAt(sf, offset);
  if (!construction) {
    return {
      refusal:
        `${site.file}:${site.line} no longer holds a constructor or factory call — ` +
        'the file changed since the game was loaded',
    };
  }

  const scans: Scan[] = [scanConstructor(construction, sf, channel, baseline)];
  const receiver = receiverOf(construction, sf);
  const body = receiver ? enclosingBody(construction) : null;
  if (receiver && body) {
    scans.push(
      scanReceiverWrites(body, sf, receiver, channel, baseline, construction.getStart(sf)),
    );
  }
  scans.push(scanComponentAliases(construction, sf, channel, baseline, receiver, body));

  const homes = scans.flatMap((scan) => scan.homes);
  const blockers = scans.flatMap((scan) => scan.blockers);

  // LAST WRITER WINS, by source position: everything we look at is either inside
  // the `new` (which runs first) or a top-level statement of the same function
  // after it, so textual order IS execution order here — which is exactly why
  // anything nested became a blocker above rather than a candidate.
  const chosen = new Map<number, Home>();
  for (const home of [...homes].sort((a, b) => a.literal.start - b.literal.start)) {
    chosen.set(home.component, home);
  }
  return {
    sf,
    chosen,
    homes,
    blockers,
    insertAt: insertionAnchor(construction, sf, source, receiver),
  };
}

/** The insertion slot for {@link SiteScan.insertAt} — see its doc. */
function insertionAnchor(
  construction: ConstructionExpression,
  sf: ts.SourceFile,
  source: string,
  receiver: string | null,
): SiteScan['insertAt'] {
  if (!receiver) return null;
  // Walk up to the statement holding the construction — and the walk may not
  // CROSS a class, function, or property boundary on the way, because the
  // first `isStatement` hit above such a boundary is some ENCLOSING
  // declaration, not the construction's own statement. The shipped corruption
  // this refuses (measured on bubbo-bubbo): a class-property initializer
  // (`private readonly _hitContainer = new Container()`) walked up to the
  // CLASS declaration — a statement — and the insertion landed after the
  // class's closing brace as `this._hitContainer.position.y = 1.5;`, where
  // `this` is dead: the module then throws at load and the whole game stops
  // mounting. Only the construction's OWN statement — a variable statement or
  // an assignment expression statement — puts the inserted assignment in the
  // scope where the receiver is genuinely in force.
  let node: ts.Node = construction;
  while (node.parent && !ts.isStatement(node)) {
    if (ts.isClassLike(node) || ts.isFunctionLike(node) || ts.isPropertyDeclaration(node)) {
      return null;
    }
    node = node.parent;
  }
  if (!ts.isVariableStatement(node) && !ts.isExpressionStatement(node)) return null;
  const holder = node.parent;
  if (!holder || !(ts.isBlock(holder) || ts.isSourceFile(holder))) return null;
  const statementStart = node.getStart(sf);
  const lineStart = source.lastIndexOf('\n', statementStart - 1) + 1;
  const indentText = source.slice(lineStart, statementStart);
  if (!/^[ \t]*$/.test(indentText)) return null; // shares a line with other code
  return { offset: node.getEnd(), indent: indentText, receiver };
}

/** The refusal for a component with no rewritable literal, in the planner's own
 *  words: the blocker that stands in its way, or the plain absence. */
function homeRefusal(
  site: CreationSite,
  channel: PropertyChannel,
  label: string,
  blockers: readonly Blocker[],
): string {
  const path = label ? `${channel.member}.${label}` : channel.member;
  const blocker = [...blockers].sort((a, b) => b.offset - a.offset)[0];
  return (
    blocker?.reason ??
    `nothing at ${site.file}:${site.line} names ${path} — the value has no literal to rewrite`
  );
}

/** The refusal when a component with no home could only be written by INSERTION
 *  but the construction is not bound to a name at statement level. ONE spelling,
 *  shared by {@link planCreationSiteEdit} and {@link readCreationSiteLiteral},
 *  because the read's `writable` is defined as "would the planner accept?" and a
 *  paraphrase here would let the two answers drift apart. */
function insertionRefusal(site: CreationSite, channel: PropertyChannel): string {
  return (
    `nothing at ${site.file}:${site.line} names ${channel.member}, and the ` +
    'constructed object is not bound to a name at statement level — the editor has no ' +
    'honest place to write the value into this source'
  );
}

/**
 * Plan one property edit against the game's own source.
 *
 * `source` is the file's bytes as they sit on disk — the caller reads them; this
 * function does no I/O so that both the dev server and a test can drive the
 * same decision.
 */
export function planCreationSiteEdit(
  source: string,
  request: CreationSiteEditRequest,
): CreationSiteEditPlan {
  if (request.instances !== 1 && request.writeScope !== 'creation-site') {
    return refuse(source, multiplicityRefusal(request.instances));
  }
  const channel = channelFor(request.property, request.surface);
  if (!channel) {
    return refuse(source, `the editor has no source expression for "${request.property}"`);
  }
  const baseline = componentsOf(channel.kind, request.baseline);
  const next = componentsOf(channel.kind, request.next);
  if (!baseline || !next) {
    return refuse(source, `"${request.property}" did not arrive as a ${channel.kind} value`);
  }

  const changedComponents = baseline.values
    .map((value, index) => (sameValue(channel.kind, value, next.values[index]!) ? -1 : index))
    .filter((index) => index >= 0);
  if (changedComponents.length === 0) {
    return { changed: false, prevSource: source, newSource: source, reason: 'nothing changed' };
  }

  const scan = scanSite(source, request.site, channel, baseline);
  if ('refusal' in scan) return refuse(source, scan.refusal);
  const { sf, chosen, blockers, insertAt } = scan;

  const edits: Array<{ start: number; end: number; text: string }> = [];
  const insertions: Array<{ path: string; value: Scalar }> = [];
  for (const component of changedComponents) {
    const label = baseline.labels[component]!;
    const path = label ? `${channel.member}.${label}` : channel.member;
    const relevant = blockers.filter((blocker) => blocks(blocker, component));
    const home = chosen.get(component);
    if (!home) {
      // INSERTION — the one case where a write can be honest without a
      // literal to rewrite: the site names NOTHING for this component (no
      // home, and no blocker either — a blocker would mean something else
      // already computes or writes it, and inserting a second writer would
      // fight it), and the construction binds a named receiver at statement
      // level. Then a per-axis named assignment right after the construction
      // statement IS the smallest source that produces the dragged value:
      // it names the property (rule 1 by construction — we write the name),
      // it needs no library knowledge (the channel path demonstrably exists
      // on the live object the baseline was read from), and it is exactly
      // the shape `scanReceiverWrites` already recognizes — so the NEXT drag
      // rewrites this literal through the ordinary path instead of
      // inserting again. An options-bag key is deliberately NOT the target:
      // whether a constructor reads a given key is the signature table this
      // module refuses to own.
      if (relevant.length === 0) {
        insertions.push({ path, value: next.values[component]! });
        continue;
      }
      return refuse(source, homeRefusal(request.site, channel, label, relevant));
    }
    // A blocker for THIS component that runs after the home we picked means
    // something we cannot rewrite has the last word; rewriting the earlier
    // literal would be a dead edit that silently does nothing at runtime.
    const later = relevant.find((blocker) => blocker.offset > home.literal.start);
    if (later) return refuse(source, later.reason);

    // THE BACKSTOP (module header, rule 2).
    if (!sameValue(channel.kind, home.literal.value, baseline.values[component]!)) {
      return refuse(
        source,
        `the literal at ${request.site.file}:${home.line} is \`${home.literal.text}\`, but ` +
          `${path} is ${describe(baseline.values[component]!)} in the running game — ` +
          'the value is computed at runtime, so writing that literal would not produce it',
      );
    }
    const replacement = formatReplacement(channel.kind, next.values[component]!, home.literal.text);
    if (replacement === null) {
      return refuse(source, `the editor cannot express this ${channel.kind} value in source`);
    }
    edits.push({ start: home.literal.start, end: home.literal.end, text: replacement });
  }

  if (insertions.length > 0) {
    if (!insertAt) {
      return refuse(source, insertionRefusal(request.site, channel));
    }
    const lines = insertions
      .map(({ path, value }) => {
        const text =
          typeof value === 'number'
            ? formatNumber(value)
            : typeof value === 'boolean'
              ? String(value)
              : typeof value === 'string'
                ? `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
                : null;
        return text === null ? null : `\n${insertAt.indent}${insertAt.receiver}.${path} = ${text};`;
      })
      .filter((line): line is string => line !== null);
    if (lines.length !== insertions.length) {
      return refuse(source, `the editor cannot express this ${channel.kind} value in source`);
    }
    edits.push({ start: insertAt.offset, end: insertAt.offset, text: lines.join('') });
  }

  edits.sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const edit of edits) {
    out += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  out += source.slice(cursor);
  if (out === source) {
    return { changed: false, prevSource: source, newSource: source, reason: 'nothing changed' };
  }
  return {
    changed: true,
    prevSource: source,
    newSource: out,
    wrote: `${request.property} at ${request.site.file}:${edits.length === 1 ? lineOf(sf, edits[0]!.start) : request.site.line}`,
  };
}

/** A removal is a write request minus BOTH values — absence is not a value,
 *  and a shape that carried one would be a value write wearing another name
 *  (the engine's `SourceRemoveRequest` states the same rule). The channel's
 *  arity and labels are static facts of its kind, so no live reading is
 *  needed to scan for the authored statements. */
export interface CreationSiteRemovalRequest {
  readonly site: CreationSite;
  readonly instances: number;
  readonly writeScope: CreationSiteWriteScope;
  readonly property: string;
  readonly surface: CreationSiteSurface;
}

/** The channel's shape with no live value behind it — labels and arity only,
 *  which is all scanning reads (the write path's equality backstop is the one
 *  consumer of real component VALUES, and a removal never compares). */
function componentsShapeOf(kind: ChannelKind): Components {
  if (kind === 'vector3' || kind === 'euler') {
    return { values: [0, 0, 0], labels: ['x', 'y', 'z'] };
  }
  if (kind === 'vector2') return { values: [0, 0], labels: ['x', 'y'] };
  if (kind === 'number') return { values: [0], labels: [''] };
  if (kind === 'boolean') return { values: [false], labels: [''] };
  return { values: [''], labels: [''] };
}

/**
 * Plan the REMOVAL of a property's authored value from the game's own source —
 * the byte-absence door the insertion arm makes necessary: an authored
 * transform can ADD a `receiver.member.axis = value;` statement for an axis
 * the source never named, and no value write can revert an added property.
 *
 * THE ONE DELETABLE SHAPE is exactly the shape insertion writes: a whole
 * own-line, top-level `receiver.member[.axis] = <literal>;` expression
 * statement ({@link Home.statement}). Everything else refuses in its own
 * words — a constructor literal or `.set(…)` argument is the game's own code
 * (deleting it would change the construction, not drop an override), a
 * blocker's expression is something the game computes, and a statement
 * sharing its line with other code cannot be deleted without taking that code
 * with it. A component the source never names is simply already absent.
 *
 * Deletion removes the statement's line whole — the preceding newline through
 * the statement's trailing semicolon and any same-line whitespace — which is
 * the byte-exact inverse of what insertion appended.
 */
export function planCreationSiteRemoval(
  source: string,
  request: CreationSiteRemovalRequest,
): CreationSiteEditPlan {
  if (request.instances !== 1 && request.writeScope !== 'creation-site') {
    return refuse(source, multiplicityRefusal(request.instances));
  }
  const channel = channelFor(request.property, request.surface);
  if (!channel) {
    return refuse(source, `the editor has no source expression for "${request.property}"`);
  }
  const baseline = componentsShapeOf(channel.kind);
  const scan = scanSite(source, request.site, channel, baseline);
  if ('refusal' in scan) return refuse(source, scan.refusal);
  const { sf, chosen, homes, blockers } = scan;

  const statements: Array<{ start: number; end: number }> = [];
  for (let component = 0; component < baseline.values.length; component++) {
    const home = chosen.get(component);
    const relevant = blockers.filter((blocker) => blocks(blocker, component));
    if (!home) {
      // No rewritable home, but something still MENTIONS this component — an
      // expression, a compound assignment, a constructor shape the scanner
      // cannot read. That is not absence, and deleting cannot make it absence,
      // so the refusal is the blocker's own description. With no blocker
      // either, nothing names this component and there is nothing to do.
      const blocker = [...relevant].sort((a, b) => b.offset - a.offset)[0];
      if (blocker) return refuse(source, blocker.reason);
      continue;
    }
    const label = baseline.labels[component]!;
    const path = label ? `${channel.member}.${label}` : channel.member;
    if (!home.statement) {
      return refuse(
        source,
        `${path} is authored at ${request.site.file}:${home.line} inside the construction ` +
          'itself (a constructor literal, a `.set(…)` argument, or an alias write) — that is ' +
          "the game's own code, not a removable own-line assignment, so the editor will not " +
          'delete it',
      );
    }
    // A blocker AFTER the chosen home means something unremovable has the last
    // word; deleting the earlier statement would not produce absence.
    const later = relevant.find((blocker) => blocker.offset > home.statement!.start);
    if (later) return refuse(source, later.reason);
    // A second author for the same component: deleting the last writer would
    // fall back to the earlier author's value, not to absence.
    const earlier = homes.find((other) => other.component === component && other !== home);
    if (earlier) {
      return refuse(
        source,
        `${path} is authored more than once (line ${earlier.line} and line ${home.line}) — ` +
          `deleting the last writer would fall back to line ${earlier.line}'s value, ` +
          'not to absence',
      );
    }
    statements.push(home.statement);
  }

  if (statements.length === 0) {
    return {
      changed: false,
      prevSource: source,
      newSource: source,
      reason:
        `nothing at ${request.site.file}:${request.site.line} authors ${channel.member} as an ` +
        'own-line assignment — the value is already absent from the source',
    };
  }

  // Deduplicate (a whole-channel statement can be chosen by several
  // components) and delete, verifying each statement owns its line.
  const spans = [...new Map(statements.map((s) => [s.start, s])).values()].sort(
    (a, b) => a.start - b.start,
  );
  let out = '';
  let cursor = 0;
  for (const span of spans) {
    const lineStart = source.lastIndexOf('\n', span.start - 1) + 1;
    if (!/^[ \t]*$/.test(source.slice(lineStart, span.start))) {
      return refuse(
        source,
        `the assignment at ${request.site.file}:${lineOf(sf, span.start)} shares its line with ` +
          "other code — deleting the line would take the game's own code with it",
      );
    }
    let lineEnd = source.indexOf('\n', span.end);
    if (lineEnd === -1) lineEnd = source.length;
    if (!/^[ \t]*$/.test(source.slice(span.end, lineEnd))) {
      return refuse(
        source,
        `the assignment at ${request.site.file}:${lineOf(sf, span.start)} shares its line with ` +
          "other code — deleting the line would take the game's own code with it",
      );
    }
    // Delete the preceding newline through the line's end (the byte-exact
    // inverse of insertion's `\n<indent><stmt>;`); at the file's first line
    // delete through the trailing newline instead.
    const deleteStart = lineStart === 0 ? 0 : lineStart - 1;
    const deleteEnd = lineStart === 0 ? Math.min(lineEnd + 1, source.length) : lineEnd;
    out += source.slice(cursor, deleteStart);
    cursor = deleteEnd;
  }
  out += source.slice(cursor);
  if (out === source) {
    return { changed: false, prevSource: source, newSource: source, reason: 'nothing changed' };
  }
  return {
    changed: true,
    prevSource: source,
    newSource: out,
    wrote: `${request.property} removed at ${request.site.file}:${lineOf(sf, spans[0]!.start)}`,
  };
}

function describe(value: Scalar): string {
  return typeof value === 'number' ? formatNumber(value) : String(value);
}

// ───────────────────────────────────────────────── the read: what the site says

/**
 * ONE property, at one creation site, READ rather than written — what the
 * construction statement says the value is, so a surface can show the live
 * object's value as an OVERRIDE of it.
 *
 * `live` is the value in force. Its shape decides the channel's arity, exactly
 * as {@link CreationSiteEditRequest.baseline} does, so a caller cannot ask this
 * question in a vocabulary the write path would reject.
 */
export interface CreationSiteLiteralRequest {
  readonly site: CreationSite;
  /** How many objects the anchor constructed — a shared site is unwritable for
   *  an ordinary instance edit and writable only for the explicit
   *  creation-site-default gesture that names the full count. */
  readonly instances: number;
  /** Which write the `writable` verdict is answering for. */
  readonly writeScope?: CreationSiteWriteScope;
  readonly property: string;
  readonly surface?: CreationSiteSurface;
  readonly live: ChannelValue;
}

/**
 * What the site says, and whether it could be made to say something else.
 *
 * `literal` is normalized into the CALLER's own notation (a `0xff00ff` colour
 * literal comes back as `#ff00ff`, because that is the form the editor's colour
 * rows read and write), so a caller can put it straight back on the live object
 * without knowing how the game happened to spell it.
 */
export interface CreationSiteLiteralReport {
  /** The value the construction site names, or `null` when it names none. */
  readonly literal: ChannelValue | null;
  /** The literal's own source text (per component, comma-joined) — the string a
   *  surface shows as "the component default". */
  readonly text?: string;
  /** Would {@link planCreationSiteEdit} accept a write of a new value here? */
  readonly writable: boolean;
  /** Present iff `!writable` — the planner's own words, never a paraphrase. */
  readonly reason?: string;
}

/** Put one literal back in the caller's own notation (see {@link
 *  CreationSiteLiteralReport.literal}). */
function normalizeLiteral(kind: ChannelKind, value: Scalar): Scalar | null {
  if (kind !== 'color') return value;
  const int = colorInt(value);
  return int === null ? null : `#${int.toString(16).padStart(6, '0')}`;
}

export function readCreationSiteLiteral(
  source: string,
  request: CreationSiteLiteralRequest,
): CreationSiteLiteralReport {
  const channel = channelFor(request.property, request.surface);
  if (!channel) {
    return {
      literal: null,
      writable: false,
      reason: `the editor has no source expression for "${request.property}"`,
    };
  }
  const live = componentsOf(channel.kind, request.live);
  if (!live) {
    return {
      literal: null,
      writable: false,
      reason: `"${request.property}" did not arrive as a ${channel.kind} value`,
    };
  }
  const scan = scanSite(source, request.site, channel, live);
  if ('refusal' in scan) {
    return { literal: null, writable: false, reason: scan.refusal };
  }

  const values: Scalar[] = [];
  const texts: string[] = [];
  // A component with NO literal ends the read literal-less (there is no default
  // to show) — unless the planner would refuse it outright, ending the read
  // with that refusal. One that merely cannot be REWRITTEN does neither: the
  // first such reason is kept and the values are still reported. That is the
  // difference between "we cannot show you the default" and "we can show it
  // but cannot change it".
  let refusal: string | null = null;
  let insertable = false;
  for (let component = 0; component < live.values.length; component++) {
    const relevant = scan.blockers.filter((blocker) => blocks(blocker, component));
    const home = scan.chosen.get(component);
    if (!home) {
      // MIRROR THE PLANNER's homeless arm exactly (`writable` is defined as
      // "would planCreationSiteEdit accept a write here?"): with a blocker the
      // write refuses; unblocked and unbound it refuses in the insertion arm's
      // own words; unblocked with an insertion anchor it WRITES — by inserting
      // a named assignment — so this report must say writable even though the
      // site names no default to show (`literal` stays null for the property,
      // which is the truth: an insertable value has no source default). The
      // scan continues, because a LATER component's blocker still refuses the
      // whole write and this report must say so.
      if (relevant.length > 0) {
        return {
          literal: null,
          writable: false,
          reason: homeRefusal(request.site, channel, live.labels[component]!, relevant),
        };
      }
      if (!scan.insertAt) {
        return { literal: null, writable: false, reason: insertionRefusal(request.site, channel) };
      }
      insertable = true;
      continue;
    }
    const normalized = normalizeLiteral(channel.kind, home.literal.value);
    if (normalized === null) {
      return {
        literal: null,
        writable: false,
        reason:
          `the literal at ${request.site.file}:${home.line} is \`${home.literal.text}\`, which ` +
          `the editor cannot read as a ${channel.kind}`,
      };
    }
    values.push(normalized);
    texts.push(home.literal.text);
    const later = relevant.find((blocker) => blocker.offset > home.literal.start);
    if (later) refusal ??= later.reason;
  }
  if (request.instances !== 1 && request.writeScope !== 'creation-site') {
    refusal ??= multiplicityRefusal(request.instances);
  }

  if (insertable) {
    // At least one component would be written by insertion, so the site names
    // no complete default — `literal` is null (nothing honest to show), while
    // `writable` still answers for the whole write.
    return {
      literal: null,
      writable: refusal === null,
      ...(refusal === null ? {} : { reason: refusal }),
    };
  }

  const literal: ChannelValue =
    live.values.length > 1 ? (values as readonly number[]) : (values[0] as Scalar);
  return {
    literal,
    text: texts.join(', '),
    writable: refusal === null,
    ...(refusal === null ? {} : { reason: refusal }),
  };
}

function scriptKindFor(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (file.endsWith('.ts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

/** The offset of a 1-based line and 0-based column in `code`. */
function lineColToOffset(code: string, line: number, col: number): number {
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
