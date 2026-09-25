/**
 * ONE predicate for "is this object the outermost node of a component
 * instance?", shared by every reader of the OID convention.
 *
 * ## Why this exists
 *
 * the source-authoring integration's serving plugin transform stamps `userData.authoringInstance` (the
 * CALLSITE oid) on **every host element inside a component definition**, not
 * just on the one the component returns — that is what lets a click on a mesh
 * deep inside `<Coin/>` resolve to the `<Coin/>` callsite, and what lets a
 * gizzmo drag rewrite the callsite's own props.
 *
 * So `authoringInstance !== undefined` answers "which instance does this node
 * BELONG to", and it is the wrong question to ask when you mean "is this node
 * that instance's root". Reading it as the latter is what made the hierarchy
 * print `Stage` on every one of `Stage`'s interior nodes and type all of them
 * `component`: `WorldEnvironment`, `GridMap` and `Coins` all carry `Stage`'s
 * stamp, because they are all inside `Stage`'s definition.
 *
 * The boundary question has a structural answer that needs no extra stamp: an
 * instance's root is the node whose `authoringInstance` its PARENT does not
 * share. A component that returns several spatial roots (R3F003) therefore has
 * several — which is exactly what that warning is about, and not something this
 * predicate should hide.
 */

import { getUserData } from '@volter/editor-threejs/ecs/user-data';
import type * as THREE from 'three';

/**
 * True when `object` is the outermost node of one component instance — the row
 * that should print the component's label and read as `role: 'component'`.
 *
 * False for an interior host element of that same instance (it belongs to the
 * instance but is not its boundary) and for any node the transform never
 * stamped.
 */
export function isComponentInstanceRoot(object: THREE.Object3D | null | undefined): boolean {
  return instanceCallsiteOid(object) !== undefined;
}

/**
 * WHICH INSTANCE this node belongs to — the raw `authoringInstance` stamp,
 * read in exactly one place.
 *
 * Deliberately NOT the same question as {@link isComponentInstanceRoot} (see
 * this module's header): every host element inside a component definition
 * carries it, so it groups a subtree and never bounds one. Callers that want
 * "same instance?" (the constraint stack's own-parts walk, the adapter's owner
 * chain) want THIS; callers that want "is this the instance's row" want the
 * predicate above.
 */
export function instanceStampOf(object: THREE.Object3D | null | undefined): string | undefined {
  const instance = getUserData(object, 'authoringInstance');
  return typeof instance === 'string' && instance ? instance : undefined;
}

/**
 * The element's OWN definition-side oid — where this JSX element is WRITTEN, as
 * opposed to the callsite that instantiated whatever renders it.
 *
 * `oid` is stamped by the source-authoring integration's serving plugin on every host element, so it is
 * present on a component's root element and on each of its interior ones alike.
 * It is NOT an address: at an instance root the address is the callsite
 * ({@link authoringOidOf}). Read it when the DEFINITION is the subject —
 * "Fork Component…" copying the component, or the occurrence rule below asking
 * which definition element a live object renders.
 */
export function ownOidOf(
  /** An `Object3D`, or a MATERIAL — fiber can pierce a stamp onto a
   *  `<meshStandardMaterial userData-oid=…>` child element, and a material
   *  carries `userData` without being a scene-graph node, so that stamp is its
   *  only handle. Structural, so both pass without this module knowing which. */
  stamped: { readonly userData?: Record<string, unknown> } | null | undefined,
): string | undefined {
  const own = stamped?.userData?.['oid'];
  return typeof own === 'string' && own ? own : undefined;
}

/** The callsite oid `object` is the ROOT of, or `undefined`. */
function instanceCallsiteOid(object: THREE.Object3D | null | undefined): string | undefined {
  const instance = instanceStampOf(object);
  if (instance === undefined) return undefined;
  return getUserData(object?.parent, 'authoringInstance') === instance ? undefined : instance;
}

/** A third-party R3F component cannot be instrumented inside its package, but
 * many ecosystem components forward unknown props to their native host root.
 * The editor-injected callsite prop therefore lands directly on the resulting
 * Object3D (Drei cameras are the canonical example). It is a callsite address,
 * not the object's definition-side `userData.oid`. */
function forwardedCallsiteOid(object: THREE.Object3D | null | undefined): string | undefined {
  const forwarded = (object as (THREE.Object3D & { __vgaiOid?: unknown }) | null | undefined)
    ?.__vgaiOid;
  return typeof forwarded === 'string' && forwarded ? forwarded : undefined;
}

/**
 * THE OCCURRENCE CONVENTION — one source address, several live objects.
 *
 * A single JSX element can render more than once (a `.map()` over 44 spawn
 * points instantiates ONE `<Coin/>` callsite 44 times), and a component's
 * interior element can be reparented out of its instance's subtree so that it,
 * too, resolves to the callsite oid. Either way the adapters' walks meet the
 * same oid twice, and both mint the same shape of id: the first one seen in
 * depth-first order keeps the bare address, later ones get `#1`, `#2`, ….
 *
 * The suffix is spelled HERE and nowhere else. It was previously written out at
 * four sites — two minting walks (`projection/three.ts`,
 * `R3fSourceAuthoringAdapter.indexGraph`), one authority check, and one
 * presence report that stripped it back off with `split('#')[0]` — which is how
 * a convention becomes four conventions.
 */
export function occurrenceId(baseId: string, occurrence: number): string {
  return occurrence === 0 ? baseId : `${baseId}#${occurrence}`;
}

/** True for `…#1`, `…#2` — an id that is NOT its address's first occurrence. */
export function isOccurrenceId(id: string): boolean {
  return id.includes('#');
}

/** `id` with any occurrence suffix removed — the address all its occurrences share. */
export function withoutOccurrence(id: string): string {
  const hash = id.indexOf('#');
  return hash < 0 ? id : id.slice(0, hash);
}

/**
 * Whether two live objects are renders of THE SAME JSX element.
 *
 * This is the CAPABILITY question behind an occurrence id, and it is the whole
 * reason the two causes above must not be treated alike. N objects that share
 * one callsite AND render one definition element are N renders of one element;
 * the element is the unit of edit, so a literal prop on it is honestly
 * writable and moving one moves all — which is exactly what the source says. A
 * reparented interior element renders a DIFFERENT definition element, merely
 * addressed by the callsite it escaped from, so writing that callsite's props
 * would edit the instance instead of the object under the pointer.
 *
 * Both objects having no own oid counts as the same element: an unstamped pair
 * is a component with several spatial roots (R3F003), which the callsite's own
 * authoring contract already refuses on better grounds than a guess here.
 */
export function rendersSameSourceElement(
  a: THREE.Object3D | null | undefined,
  b: THREE.Object3D | null | undefined,
): boolean {
  return ownOidOf(a) === ownOidOf(b);
}

/**
 * The oid that ADDRESSES `object` in source — the key every id, source
 * location and prop write resolves through.
 *
 * At an instance ROOT it is the CALLSITE oid, because that is where the author
 * put this instance and where a gizmo drag must land: moving `Coin1` rewrites
 * `<Coin name='Coin1' position={…}/>` in the parent scene, not the shared
 * `<Coin/>` definition every coin renders from.
 *
 * ANYWHERE ELSE it is the element's OWN definition oid. An interior host
 * element of a component carries the instance stamp too (that is how a click
 * on it resolves to the instance), but the stamp is not its address: reading
 * it as one gave every interior node of `Stage` the id
 * `r3f:<world>:<Stage's callsite>#N` — a position among `Stage`'s stamped
 * elements rather than a name — and pointed each one's source location and
 * prop writes at the `<Stage/>` callsite instead of at itself.
 */
export function authoringOidOf(object: THREE.Object3D | null | undefined): string | undefined {
  return instanceCallsiteOid(object) ?? forwardedCallsiteOid(object) ?? ownOidOf(object);
}
