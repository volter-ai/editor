/**
 * The OID half of the canvas authoring surface's IDENTITY axis
 * (`@vgai/game-runtime/pixi/authoring`'s {@link CanvasIdentity}) — what a row is called
 * when the display tree was authored as first-party `@pixi/react` TSX, and the
 * resolution from such an id back to the source tag it addresses.
 *
 * Pure: no Pixi mount, no network, so both halves are unit-testable directly
 * (`packages/editor/test/pixi-source-identity.test.ts`). The structural half of
 * the same axis is `STRUCTURAL_CANVAS_IDENTITY`, in the engine beside the walk
 * it parameterizes.
 *
 * ## Where the address comes from (MEASURED, not assumed)
 *
 * A canvas `.tsx` is stamped `data-oid` by the same transform every dom file
 * gets (`ui-source/oid-transform.ts`'s `oidAttributeForSurface`: a `canvas`
 * declared surface returns `data-oid`). `@pixi/react` hands every unrecognized
 * prop to the Pixi class CONSTRUCTOR (`createInstance` → `new
 * PixiComponent(pixiProps)`), and Pixi assigns its options onto the instance —
 * so the stamp lands on the live `Container` under its own literal key,
 * `container['data-oid']`.
 *
 * That is a fact about `@pixi/react`, not about this repo, and it is pinned by
 * a real mount rather than reasoned about: `packages/editor/test/
 * pixi-oid-stamp.test.tsx` mounts the real reconciler and asserts it. (The
 * plausible-looking alternative — that the dash is PIERCED to `container.oid`
 * the way fiber pierces `userData-oid` — is what this module was first written
 * against, and the mount test is what caught it: every row silently fell back
 * to a structural path.) {@link readContainerOid} is the ONE place that
 * knows.
 *
 * Ids follow the three lane's `r3f:<worldId>:<oid>` precedent
 * (`r3f-source-authoring-adapter.ts`) with a `pixi:` prefix, and they exist for
 * that lane's reason: an oid signature is stable across a remount, so
 * selection survives one.
 */

import type { CanvasIdentity } from '@vgai/game-runtime/pixi/authoring';
import type { Container } from 'pixi.js';
import { occurrenceId } from './component-instance-root';

const PREFIX = 'pixi';

/** The live field the `data-oid` JSX prop becomes — see this module's header.
 *  Spelled once, here. */
const OID_FIELD = 'data-oid';
const INSTANCE_FIELD = 'data-authoring-instance';
const INSTANCE_LABEL_FIELD = 'data-authoring-label';
const INSTANCE_COMPONENT_FIELD = 'data-authoring-component';

/**
 * The oid `@pixi/react` landed on a live display object, or `undefined`.
 *
 * Deliberately structural (`typeof === 'string'`): a game's own container
 * subclass may declare an unrelated `oid` field, and a non-string one is not
 * an address.
 */
export function readContainerOid(object: unknown): string | undefined {
  if (!object || typeof object !== 'object') return undefined;
  const value = (object as Record<string, unknown>)[OID_FIELD];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringField(object: unknown, field: string): string | undefined {
  if (!object || typeof object !== 'object') return undefined;
  const value = (object as Record<string, unknown>)[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function readContainerAuthoringInstance(object: unknown): string | undefined {
  return stringField(object, INSTANCE_FIELD);
}

export function readContainerAuthoringLabel(object: unknown): string | undefined {
  return stringField(object, INSTANCE_LABEL_FIELD);
}

export function readContainerAuthoringComponent(object: unknown): string | undefined {
  return stringField(object, INSTANCE_COMPONENT_FIELD);
}

/** The first native Pixi host emitted by a component instance. */
export function isCanvasComponentInstanceRoot(object: Container): boolean {
  const instance = readContainerAuthoringInstance(object);
  if (!instance) return false;
  return readContainerAuthoringInstance(object.parent) !== instance;
}

/** Callsite OID for a component root, otherwise the element's own OID. */
export function authoringOidForContainer(object: Container): string | undefined {
  return isCanvasComponentInstanceRoot(object)
    ? readContainerAuthoringInstance(object)
    : readContainerOid(object);
}

/** `pixi:<worldId>:<oid>`, with `#n` for every occurrence past the first. */
export function pixiOidId(worldId: string, oid: string, occurrence = 0): string {
  return occurrenceId(`${PREFIX}:${worldId}:${oid}`, occurrence);
}

/** The address for a node the source never stamped — an object the game built
 *  imperatively, or a library's internal child. Structural, so it is stable
 *  for as long as the tree's shape is. */
export function pixiPathId(worldId: string, path: readonly number[]): string {
  return `${PREFIX}:${worldId}:@${path.join('.')}`;
}

/** The oid an id addresses, or `null` for a path id / an id minted for a
 *  DIFFERENT world. Never guesses. */
export function oidOfPixiId(worldId: string, id: string): string | null {
  const head = `${PREFIX}:${worldId}:`;
  if (!id.startsWith(head)) return null;
  const rest = id.slice(head.length);
  if (rest.startsWith('@')) return null;
  const hash = rest.indexOf('#');
  const oid = hash < 0 ? rest : rest.slice(0, hash);
  return oid.length > 0 ? oid : null;
}

/**
 * The identity a FIRST-PARTY canvas root supplies to the shared walk.
 *
 * A repeated callsite (`sim.grunts.map(…)` renders one JSX element ninety
 * times) resolves ninety live objects to one oid; they are disambiguated with
 * the same `#n` occurrence suffix the three lane uses, counted per walk — which
 * is what {@link CanvasIdentity.beginWalk} exists for.
 */
export function createOidCanvasIdentity(worldId: string): CanvasIdentity {
  let occurrences = new Map<string, number>();
  return {
    beginWalk: () => {
      occurrences = new Map();
    },
    idFor: (object: Container, path: readonly number[]): string => {
      const oid = authoringOidForContainer(object);
      if (oid === undefined) return pixiPathId(worldId, path);
      const n = occurrences.get(oid) ?? 0;
      occurrences.set(oid, n + 1);
      return pixiOidId(worldId, oid, n);
    },
  };
}
