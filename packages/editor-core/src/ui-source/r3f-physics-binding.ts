/**
 * WHERE A PHYSICS-OWNED NODE IS ACTUALLY PLACED — the source fact that says an
 * element's transform is written by a body rather than by the element's own
 * JSX, and which artifact owns that body's SPAWN.
 *
 * ## The measured defect
 *
 * `@react-three/cannon` drives a node by writing its MATRIX:
 * `object.matrixAutoUpdate = false; object.matrix.copy(compose(p, q, ONE))`
 * (`node_modules/@react-three/cannon/dist/index.js`'s `apply`). Two consequences,
 * both of which the editor got wrong before this module existed:
 *
 *  - The node's own `position`/`rotation`/`scale` JSX props are DEAD. Writing
 *    one produces a file that says the object is somewhere it will never be:
 *    the body re-spawns from the hook's argument and overwrites the matrix on
 *    the next frame. Measured on the racing-game ingest — a moved chassis wrote
 *    its leaf element and the remount re-spawned at the binding's
 *    `[-110, 0.75, 220]`, digit for digit.
 *  - `scale` goes with them: `apply` composes with a fixed `(1,1,1)`, so a
 *    cannon body erases its node's scale as surely as its position.
 *
 * The transform is therefore owned by the BINDING — the `useBox(…)` /
 * `useCompoundBody(…)` call that attached the body to this element's ref — and
 * an honest editor writes where the binding reads, or refuses by name.
 *
 * ## Where the binding reads, measured rather than assumed
 *
 * Over the whole vendored cannon corpus (`vendor/games/racing-game`: `Chassis`,
 * `Wheel`, `Ramp`, `Train`, `Goal`, `Heightmap`, `BoundingBox`) **not one hook
 * argument carries an inline position literal.** Every binding takes its spawn
 * from the component's OWN PROPS — `useBox(() => ({ …props }))`, or the
 * shorthand `useBox(() => ({ args, position, rotation }))` over a destructured
 * prop — so the literal that places the body is the one at the component's
 * CALLSITE (`<Ramp position={[2, -1, 168.55]} />`, `App.tsx:57`). That is the
 * prop literal the write routes to, and the ordinary JSX prop writer already
 * reaches it; what was missing was a contract that admits the forwarding is
 * real, which is `forwarded` below.
 *
 * `literal` is the other shape — a spawn spelled at the hook itself. It is
 * recorded so a refusal can NAME it (`position is owned by useBox at
 * Ramp.tsx:8`) rather than pretending the element's own prop is writable. No
 * writer for it ships: a hook argument is not a JSX element, it has no oid, and
 * building an address for a shape with zero occurrences in the corpus would be
 * a writer with no caller.
 *
 * ## Why this is a SOURCE analysis and not the runtime flag
 *
 * `matrixAutoUpdate === false` is a true runtime tell for cannon, and a useless
 * one for routing: it says a driver owns the node, never WHERE the driver reads
 * its spawn. It is also not general — `@react-three/rapier` writes
 * `object.position.copy(…)`/`object.quaternion.copy(…)` and leaves
 * `matrixAutoUpdate` alone, so the flag misses rapier entirely while the source
 * says plainly that `<RigidBody position={…}>` is the spawn (which is why the
 * built-in rapier contract in `oid-transform.ts` already routes it correctly).
 * The binding is a fact about the file; the write anchor has to be too.
 *
 * Nothing here is a general "physics abstraction": it recognizes ONE package's
 * body hooks by import specifier, the same hand-audited way
 * `BUILTIN_R3F_CONTRACTS` recognizes `<RigidBody>`, because guessing at an
 * unknown library's ownership is how an editor writes props a library ignores.
 */

import ts from 'typescript';
import { enclosingScope, refIdentifier } from './ts-ast';

import type { PhysicsChannel, R3fPhysicsBinding } from '@volter/editor-sdk/source-authoring';
export type { PhysicsChannel, R3fPhysicsBinding } from '@volter/editor-sdk/source-authoring';

/** What an element carrying a binding looks like to a writer. Structural rather
 *  than the whole `OidEntry`, so this stays the browser-safe half. */
export interface PhysicsBoundElement {
  readonly file: string;
  readonly physicsBinding?: R3fPhysicsBinding | undefined;
  /** The callsite half of the same fact: the component this element
   *  instantiates hands `channel` to a body binding inside itself, so the
   *  literal written HERE is the spawn the simulation reads
   *  (`oid-transform.ts`'s `bodyForwarded`). */
  readonly r3fAuthoring?: { readonly bodyForwarded?: readonly string[] | undefined } | undefined;
}

/**
 * Is this element's `channel` PLACED BY A SIMULATED BODY — the fact that makes
 * an edit here a `physics-binding` write rather than an ordinary `source-prop`
 * one, in `WriteAnchorKind`'s vocabulary (`@volter/editor-project/adapter`'s `authoring.ts`).
 *
 * Two shapes, and both are the same question ("does a body read this value?")
 * asked of the two places a body can be attached, which is why they answer from
 * one function rather than one per lane:
 *
 *  - the element carries the binding itself (`<mesh ref={ref}>` whose ref a
 *    `useBox` bound) — its own props are dead on arrival, so the write is
 *    refused, and the KIND still says which lane owns the value;
 *  - the element is a CALLSITE whose component hands the channel to a binding
 *    inside it (`<Ramp position={…}/>`, `<CitadelTower position={…}/>`) — the
 *    literal a body actually spawns from, and the WRITABLE case. This is the
 *    one whose authored value has to survive the re-settle, which is the whole
 *    reason `physics-binding` is a kind of its own.
 *
 * Deliberately beside {@link physicsRefusal}: the refusal names who owns the
 * placement and this names the lane, and two derivations of "who owns this
 * placement" living in different files is exactly how a subject came to be
 * classified in one lane while its edit travelled another.
 */
export function bodyPlacedChannel(
  element: PhysicsBoundElement | undefined,
  channel: string,
): boolean {
  if (channel !== 'position' && channel !== 'rotation' && channel !== 'scale') return false;
  if (element?.physicsBinding) return true;
  return element?.r3fAuthoring?.bodyForwarded?.includes(channel) === true;
}

/**
 * WHY a write to this element's own `channel` would be lost — `null` when no
 * body owns it, which is the ordinary case.
 *
 * ONE derivation, read by both writers (the first-party R3F source lane's
 * `transformEditability` and the ingest lane's `oid-source-persistence`), so
 * the two can never disagree about who owns a placement. Each sentence names
 * the binding and where to go instead; "does not forward position" would send
 * an author to add a prop the body would ignore.
 */
export function physicsRefusal(
  element: PhysicsBoundElement | undefined,
  channel: string,
): string | null {
  const binding = element?.physicsBinding;
  if (!binding) return null;
  if (channel !== 'position' && channel !== 'rotation' && channel !== 'scale') return null;
  const at = `${element!.file.split('/').pop() ?? element!.file}:${binding.line}`;
  const owned = `${channel} is owned by ${binding.hook} at ${at}`;
  if ((binding.forwarded as readonly string[]).includes(channel)) {
    return `${owned}, which reads this component's own ${channel} prop — write it where the instance is placed, not on this element`;
  }
  if ((binding.literal as readonly string[]).includes(channel)) {
    return `${owned} — the body spawns from that hook's own argument, and a hook argument has no write anchor`;
  }
  // Including `scale`, always: the body re-composes the node's matrix with a
  // fixed unit scale (`@react-three/cannon`'s `apply`), so a scale written here
  // is erased on the next frame exactly like a position.
  return `${owned} — this node is placed by the simulation, so a ${channel} written here is overwritten on the next frame`;
}

/**
 * `@react-three/cannon`'s body hooks — every hook that attaches a simulated
 * body to a ref and thereafter writes that object's matrix.
 *
 * `useRaycastVehicle` is here even though its argument names no transform: it
 * binds a ref whose matrix the simulation owns just the same, so an element it
 * binds must be refused rather than written.
 */
const CANNON_BODY_HOOKS = new Set([
  'useBox',
  'useCompoundBody',
  'useConvexPolyhedron',
  'useCylinder',
  'useHeightfield',
  'useParticle',
  'usePlane',
  'useRaycastVehicle',
  'useSphere',
  'useTrimesh',
]);

const PHYSICS_PACKAGES = new Set(['@react-three/cannon']);

/** A cannon body hook's LOCAL name (an `import { useBox as box }` keeps working)
 *  → the imported hook name. */
function bodyHookNames(sf: ts.SourceFile): Map<string, string> {
  const names = new Map<string, string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (!PHYSICS_PACKAGES.has(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (CANNON_BODY_HOOKS.has(imported)) names.set(element.name.text, imported);
    }
  }
  return names;
}

/** The names the enclosing function's FIRST parameter binds — i.e. the props an
 *  identifier inside the body could be forwarding. `whole` is the props object
 *  itself (`props` in `(props) => …`, or a `...rest`). */
interface PropScope {
  readonly whole: Set<string>;
  readonly named: Set<string>;
}

function propScopeOf(parameters: ts.NodeArray<ts.ParameterDeclaration> | undefined): PropScope {
  const whole = new Set<string>();
  const named = new Set<string>();
  const first = parameters?.[0];
  if (!first) return { whole, named };
  if (ts.isIdentifier(first.name)) {
    whole.add(first.name.text);
    return { whole, named };
  }
  if (!ts.isObjectBindingPattern(first.name)) return { whole, named };
  for (const element of first.name.elements) {
    if (!ts.isIdentifier(element.name)) continue;
    if (element.dotDotDotToken) whole.add(element.name.text);
    else named.add(element.name.text);
  }
  return { whole, named };
}

function isPhysicsChannel(name: string): name is PhysicsChannel {
  return name === 'position' || name === 'rotation' || name === 'scale';
}

/** The object literal a body hook's first argument evaluates to — the hook takes
 *  either `() => ({…})` or a bare `{…}`. */
function bodyArgumentObject(call: ts.CallExpression): ts.ObjectLiteralExpression | undefined {
  const first = call.arguments[0];
  if (!first) return undefined;
  if (ts.isObjectLiteralExpression(first)) return first;
  if (!ts.isArrowFunction(first) && !ts.isFunctionExpression(first)) return undefined;
  const body = first.body;
  if (ts.isParenthesizedExpression(body) && ts.isObjectLiteralExpression(body.expression)) {
    return body.expression;
  }
  if (ts.isObjectLiteralExpression(body)) return body;
  if (!ts.isBlock(body)) return undefined;
  for (const statement of body.statements) {
    if (
      ts.isReturnStatement(statement) &&
      statement.expression &&
      ts.isObjectLiteralExpression(statement.expression)
    ) {
      return statement.expression;
    }
  }
  return undefined;
}

function isVec3Literal(expression: ts.Expression): boolean {
  if (!ts.isArrayLiteralExpression(expression) || expression.elements.length !== 3) return false;
  return expression.elements.every((element) => {
    const inner = ts.isPrefixUnaryExpression(element) ? element.operand : element;
    return ts.isNumericLiteral(inner);
  });
}

/** Does this expression read one of the enclosing component's own props? */
function readsProp(expression: ts.Expression, scope: PropScope, channel: PhysicsChannel): boolean {
  if (ts.isIdentifier(expression)) return scope.named.has(expression.text);
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    scope.whole.has(expression.expression.text) &&
    expression.name.text === channel
  );
}

/**
 * How each channel's spawn is spelled in one hook argument.
 *
 * LAST WINS, the way an object literal actually evaluates: `{ position: […],
 * ...props }` is placed by `props`, and `{ ...props, position: […] }` by the
 * literal. Getting that backwards would name the wrong owner in a refusal.
 */
type ChannelOwner = 'forwarded' | 'literal' | 'expression';

/**
 * What ONE property of a hook argument says about placement.
 *
 * A whole-props spread carries every placement prop the caller passed —
 * `scale` deliberately NOT among them: no cannon body reads a scale, and
 * `apply` composes with a fixed `(1,1,1)`, so claiming the caller's `scale`
 * reaches the body would be the exact lie this module exists to stop.
 */
function propertyOwnership(
  property: ts.ObjectLiteralElementLike,
  scope: PropScope,
): ReadonlyArray<readonly [PhysicsChannel, ChannelOwner]> {
  if (ts.isSpreadAssignment(property)) {
    const spreadsProps =
      ts.isIdentifier(property.expression) && scope.whole.has(property.expression.text);
    return spreadsProps
      ? ([
          ['position', 'forwarded'],
          ['rotation', 'forwarded'],
        ] as const)
      : [];
  }
  if (ts.isShorthandPropertyAssignment(property)) {
    const name = property.name.text;
    if (!isPhysicsChannel(name)) return [];
    return [[name, scope.named.has(name) ? 'forwarded' : 'expression']];
  }
  if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) return [];
  const name = property.name.text;
  if (!isPhysicsChannel(name)) return [];
  if (isVec3Literal(property.initializer)) return [[name, 'literal']];
  return [[name, readsProp(property.initializer, scope, name) ? 'forwarded' : 'expression']];
}

function channelOwnership(
  literalObject: ts.ObjectLiteralExpression,
  scope: PropScope,
): { forwarded: PhysicsChannel[]; literal: PhysicsChannel[] } {
  const owner = new Map<PhysicsChannel, ChannelOwner>();
  for (const property of literalObject.properties) {
    for (const [channel, kind] of propertyOwnership(property, scope)) owner.set(channel, kind);
  }
  const pick = (kind: ChannelOwner): PhysicsChannel[] =>
    [...owner.entries()].filter(([, value]) => value === kind).map(([channel]) => channel);
  return { forwarded: pick('forwarded'), literal: pick('literal') };
}

/**
 * The ref identifier a body hook binds — either the ref it was HANDED
 * (`useBox(fn, ref)`, the forwardRef spelling) or the one it HANDS BACK
 * (`const [ref] = useBox(fn)`, the plain spelling). Both occur in the vendored
 * corpus and they are the same binding.
 */
/** The API identifier a body hook's tuple hands back (`const [, api] = useBox(…)`),
 *  or null when the call does not destructure one. */
function boundApiName(call: ts.CallExpression): string | null {
  const declaration = call.parent;
  if (!ts.isVariableDeclaration(declaration) || !ts.isArrayBindingPattern(declaration.name)) {
    return null;
  }
  const second = declaration.name.elements[1];
  if (second && ts.isBindingElement(second) && ts.isIdentifier(second.name)) {
    return second.name.text;
  }
  return null;
}

/**
 * Channels `scope`'s own `useFrame` callbacks drive through `api` — the same
 * regex-over-callback-text honesty budget `oid-transform.ts`'s
 * `runtimeMotionRefs` holds to, and only INSIDE `useFrame`: a one-time
 * `api.position.set` in an effect is a legitimate re-pose, while a per-frame
 * one makes every authored spawn a dead value.
 */
function apiDrivenChannels(
  scope: ts.Node | null,
  sf: ts.SourceFile,
  api: string,
): PhysicsChannel[] {
  if (!scope) return [];
  const found = new Set<PhysicsChannel>();
  const re = new RegExp(
    `\\b${api.replace(/[$]/g, '\\$&')}\\.(position|rotation|scale)\\.(?:set|copy)\\s*\\(`,
    'g',
  );
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && /(^|\.)useFrame$/.test(node.expression.getText(sf))) {
      for (const match of node.getText(sf).matchAll(re)) {
        found.add(match[1] as PhysicsChannel);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return [...found];
}

function boundRefName(call: ts.CallExpression): string | null {
  const declaration = call.parent;
  if (ts.isVariableDeclaration(declaration) && ts.isArrayBindingPattern(declaration.name)) {
    const first = declaration.name.elements[0];
    if (first && ts.isBindingElement(first) && ts.isIdentifier(first.name)) return first.name.text;
  }
  const handed = call.arguments[1];
  if (handed && ts.isIdentifier(handed)) return handed.text;
  // `useBox(fn, useRef<Mesh>(null))` hands the hook a fresh ref and takes the
  // same object back through the tuple, which the destructuring above already
  // named. Anything else has no name this file can join a `ref={…}` against.
  return null;
}

/**
 * Every JSX element in `sf` whose ref a physics body binds, mapped to the
 * binding that owns its transform.
 *
 * Keyed by the OPENING element so both readers join on the same node: the
 * component-contract analysis (which asks about a component's root) and the
 * stamping transform (which asks about each element it stamps).
 */
export function physicsBindingsByElement(
  sf: ts.SourceFile,
): Map<ts.JsxOpeningLikeElement, R3fPhysicsBinding> {
  const hooks = bodyHookNames(sf);
  const bindings = new Map<ts.JsxOpeningLikeElement, R3fPhysicsBinding>();
  if (hooks.size === 0) return bindings;

  /** scope → (ref name → binding). A ref is joined only INSIDE the scope that
   *  bound it: two components may each call their ref `ref`. */
  const byScope = new Map<ts.Node | null, Map<string, R3fPhysicsBinding>>();

  const record = (call: ts.CallExpression, hook: string): void => {
    const refName = boundRefName(call);
    if (!refName) return;
    const scope = enclosingScope(call);
    const argument = bodyArgumentObject(call);
    const ownership = argument
      ? channelOwnership(argument, propScopeOf(scope?.parameters))
      : { forwarded: [], literal: [] };
    const { line } = sf.getLineAndCharacterOfPosition(call.getStart(sf));
    const api = boundApiName(call);
    const driven = api ? apiDrivenChannels(scope, sf, api) : [];
    const scoped = byScope.get(scope) ?? new Map<string, R3fPhysicsBinding>();
    scoped.set(refName, {
      hook,
      line: line + 1,
      ...ownership,
      ...(driven.length > 0 ? { apiDriven: driven } : {}),
    });
    byScope.set(scope, scoped);
  };

  const collect = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const hook = hooks.get(node.expression.text);
      if (hook) record(node, hook);
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);
  if (byScope.size === 0) return bindings;

  /** Walk OUT through enclosing scopes: a ref bound in the component body is
   *  often used by JSX nested inside a callback (`.map(…)`), whose scope key is
   *  the callback rather than the component. */
  const bindingFor = (node: ts.JsxOpeningLikeElement): R3fPhysicsBinding | undefined => {
    const refName = refIdentifier(node);
    if (!refName) return undefined;
    let scope: ts.Node | null = enclosingScope(node);
    for (;;) {
      const binding = byScope.get(scope)?.get(refName);
      if (binding) return binding;
      if (scope === null) return undefined;
      scope = enclosingScope(scope);
    }
  };

  const join = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const binding = bindingFor(node);
      if (binding) bindings.set(node, binding);
    }
    ts.forEachChild(node, join);
  };
  join(sf);
  return bindings;
}
