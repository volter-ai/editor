/**
 * Projects a game's declared {@link VgaiGameSystemAdapters}
 * (`window.vgaiGame.systems.systemAdapters`) onto the host's ordinary
 * {@link SystemAdapters} bag — the ingest-realm counterpart of a first-party
 * world's `ctx.registerSystemAdapter`, and the sibling of
 * `contract-debug-adapter.ts` (which owns the `debug` slot).
 *
 * ## Why a projection with a verdict per slot
 *
 * The ingestion bar (docs/BRINGING-AN-EXISTING-GAME.md §The ingestion
 * checklist) admits exactly two terminal states per slot: IMPLEMENTED or
 * IMPLEMENTED-EMPTY. `SystemAdapters` alone cannot express the second — an
 * omitted key means "unsupported", which is the same shape as "nobody looked".
 * So this returns THREE lists, and the caller hands the non-`bound` ones to the
 * coverage report, where a positively-answered absence prints as terminal and an
 * unanswered slot prints as a work order.
 *
 * ## Why the shape check
 *
 * A slot that declares `{}` would otherwise register as "implemented" and light
 * up an editor panel over an object with no methods. Each slot therefore names
 * the members its interface makes REQUIRED, and a declaration missing any of
 * them is `malformed` — reported by name, never silently bound and never
 * silently dropped. This is the same honesty the anti-shim rule asks of the
 * other direction: a wrong "present" claim is as much a defect as a wrong
 * "empty" one.
 *
 * ## Why `physics` also gets a KEYING check
 *
 * The physics slot is the one whose vocabulary follows the SURFACE
 * ({@link PHYSICS_KEYING_BY_SURFACE}): a three-surface game keys by host node
 * id, a canvas-surface game by the display object it already holds. Both shapes
 * carry the same four member names, so presence-and-typeof cannot tell them
 * apart — a carrier keyed for the other surface would pass every check here and
 * then be called with values it has none of, which is the "green coverage row
 * bought with four methods that have no caller" defect this whole slot was left
 * open to avoid. So a mount that KNOWS its surface says so, and a mismatch is
 * `malformed` by name. A caller with no surface fact (`undefined`) does not
 * check — it has nothing to check against, and inventing a default would be a
 * guess wearing a verdict.
 *
 * Nothing here calls a declared method. Presence and shape only.
 */

import type {
  ContractSystemEmptySlot,
  ContractSystemMalformedSlot,
  ContractSystemSlot,
} from '@volter/editor-project/adapter/ingest/contract-system-slots';
import type { SystemAdapters } from '@volter/editor-project/adapter/system-adapter';

export type {
  ContractSystemEmptySlot,
  ContractSystemMalformedSlot,
} from '@volter/editor-project/adapter/ingest/contract-system-slots';

import type {
  VgaiGameSystemAdapters,
  VgaiGameSystemEmpty,
  VgaiGameSystems,
} from '@volter/editor-project/adapter/ingest/game-contract';
import { GAME_SYSTEM_ADAPTERS_SHAPE } from '@volter/editor-project/adapter/ingest/game-contract-seams';
import {
  AUDIO_ADAPTER_SHAPE,
  CAMERA_ADAPTER_SHAPE,
  NAVIGATION_ADAPTER_SHAPE,
  NETWORKING_ADAPTER_SHAPE,
  PHYSICS_ADAPTER_SHAPE,
  RENDER_DEBUG_ADAPTER_SHAPE,
} from '@volter/editor-project/adapter/system-seam-contract';

/** The slots a game may declare through the contract (`debug` is projected from
 *  `commands`/`state` instead — see {@link VgaiGameSystemAdapters}). */
export type { ContractSystemSlot } from '@volter/editor-project/adapter/ingest/contract-system-slots';

/**
 * The members each slot's interface makes NON-optional. A declaration missing
 * one of these cannot honour the interface, whatever else it carries.
 *
 * This table is the single place the required surface is spelled; it is checked
 * against the interfaces by the compiler at the point of use below (each list
 * is typed as keys of its own adapter), so it cannot drift into naming a member
 * that does not exist.
 */
const SYSTEM_SHAPES = {
  physics: PHYSICS_ADAPTER_SHAPE,
  networking: NETWORKING_ADAPTER_SHAPE,
  navigation: NAVIGATION_ADAPTER_SHAPE,
  audio: AUDIO_ADAPTER_SHAPE,
  camera: CAMERA_ADAPTER_SHAPE,
  renderDebug: RENDER_DEBUG_ADAPTER_SHAPE,
} as const satisfies Record<ContractSystemSlot, object>;

/**
 * The render surface a declaration is being read ON — the same three words
 * `IngestKind`/`AdapterSurface` already use, so nothing has to be declared
 * twice.
 */
export type ContractSurface = 'three' | 'canvas' | 'dom';

/**
 * THE surface→physics-vocabulary rule, stated once.
 *
 * `null` for `dom`: that surface has no physics consumer at all, so nothing
 * here can say which keying would be right for it and the check stands down
 * rather than inventing an answer.
 */
const PHYSICS_KEYING_BY_SURFACE: Readonly<Record<ContractSurface, 'node-id' | 'display' | null>> = {
  three: 'node-id',
  canvas: 'display',
  dom: null,
};

/** Fixed slot order, so two reports of the same mount are diffable line for
 *  line (the same rule the coverage report's row order follows). */
export const CONTRACT_SYSTEM_SLOTS = Object.keys(
  GAME_SYSTEM_ADAPTERS_SHAPE,
) as ContractSystemSlot[];

export interface ContractSystemAdapterProjection {
  /** Real adapters, ready to spread onto a `MountedRoot`'s `systems`. */
  readonly bound: Partial<Pick<SystemAdapters, ContractSystemSlot>>;
  /** Slots answered IMPLEMENTED-EMPTY, with the evidence. */
  readonly empty: readonly ContractSystemEmptySlot[];
  /** Slots declared but unusable — bound to nothing, reported by name. */
  readonly malformed: readonly ContractSystemMalformedSlot[];
}

const EMPTY_PROJECTION: ContractSystemAdapterProjection = {
  bound: {},
  empty: [],
  malformed: [],
};

function isEmptyRecord(value: object): value is VgaiGameSystemEmpty {
  return (value as { present?: unknown }).present === false;
}

function missingMembers(slot: ContractSystemSlot, value: object): string[] {
  const missing: string[] = [];
  for (const [member, spec] of Object.entries(
    SYSTEM_SHAPES[slot] as Readonly<Record<string, { readonly optional: boolean }>>,
  )) {
    if (spec.optional) continue;
    if (typeof (value as Record<string, unknown>)[member] !== 'function') {
      missing.push(member);
    }
  }
  return missing;
}

/**
 * The reason a declared physics carrier cannot serve `surface`, or `null` when
 * it can (including when the caller supplied no surface to check against).
 *
 * The keying a carrier actually has is its tag's own answer, and an ABSENT tag
 * IS `'node-id'` — see `PhysicsAdapter`'s comment for why the original
 * vocabulary is the untagged one.
 */
function physicsKeyingMismatch(value: object, surface: ContractSurface | undefined): string | null {
  const want = surface ? PHYSICS_KEYING_BY_SURFACE[surface] : null;
  if (want === null) return null;
  const got = (value as { keyedBy?: unknown }).keyedBy === 'display' ? 'display' : 'node-id';
  if (got === want) return null;
  return (
    `declared a ${got}-keyed physics carrier on the ${surface} surface, whose gizmo path ` +
    `addresses bodies by ${want} — the four members are all present but nothing on this lane ` +
    `can call them with values they accept (a ${surface}-surface carrier declares ` +
    `\`keyedBy: '${want}'\`)`
  );
}

/** One slot's verdict, before it is filed into the three lists. */
type SlotVerdict =
  | { readonly kind: 'skip' }
  | { readonly kind: 'bound' }
  | { readonly kind: 'empty'; readonly evidence: string }
  | { readonly kind: 'malformed'; readonly reason: string };

/**
 * THE per-slot decision, in the order the module header states: is it declared
 * at all, is it the positively-answered empty, does it carry the members its
 * interface requires, and (physics only) is it keyed for this surface.
 *
 * Split out of {@link projectContractSystemAdapters} so the projection itself
 * is a loop over verdicts — one place decides, one place files.
 */
function classifyDeclaredSlot(
  slot: ContractSystemSlot,
  value: unknown,
  surface: ContractSurface | undefined,
): SlotVerdict {
  if (value === undefined || value === null) return { kind: 'skip' };
  if (typeof value !== 'object') {
    return {
      kind: 'malformed',
      reason: `declared as ${typeof value}; expected an adapter object or { present: false, evidence }`,
    };
  }
  if (isEmptyRecord(value)) {
    const evidence = (value as VgaiGameSystemEmpty).evidence;
    // An empty claim with no evidence is exactly the "wrong empty claim" the
    // bar calls a defect — it asserts an absence nobody can re-check.
    if (typeof evidence !== 'string' || evidence.trim() === '') {
      return {
        kind: 'malformed',
        reason: 'declared `present: false` with no `evidence` string to back the absence',
      };
    }
    return { kind: 'empty', evidence };
  }
  const missing = missingMembers(slot, value);
  if (missing.length > 0) {
    return {
      kind: 'malformed',
      reason: `declared an adapter missing required member(s): ${missing.join(', ')}`,
    };
  }
  const mismatch = slot === 'physics' ? physicsKeyingMismatch(value, surface) : null;
  if (mismatch !== null) return { kind: 'malformed', reason: mismatch };
  return { kind: 'bound' };
}

/**
 * Read the declared slots and sort each into exactly one verdict. A game that
 * declared no `systemAdapters` at all projects to three empty lists — which is
 * the "nobody answered" case, and is deliberately NOT the same as declaring
 * every slot empty.
 *
 * `surface` is the mount's own surface fact when it has one; see the module
 * header for what it buys and why its absence checks nothing.
 */
export function projectContractSystemAdapters(
  systems: VgaiGameSystems | undefined | null,
  surface?: ContractSurface | undefined,
): ContractSystemAdapterProjection {
  const declared = systems?.systemAdapters;
  if (!declared) return EMPTY_PROJECTION;

  const bound: Record<string, unknown> = {};
  const empty: ContractSystemEmptySlot[] = [];
  const malformed: ContractSystemMalformedSlot[] = [];

  for (const slot of CONTRACT_SYSTEM_SLOTS) {
    const verdict = classifyDeclaredSlot(slot, declared[slot], surface);
    if (verdict.kind === 'bound') bound[slot] = declared[slot];
    else if (verdict.kind === 'empty') empty.push({ slot, evidence: verdict.evidence });
    else if (verdict.kind === 'malformed') malformed.push({ slot, reason: verdict.reason });
  }

  return {
    bound: bound as ContractSystemAdapterProjection['bound'],
    empty,
    malformed,
  };
}
