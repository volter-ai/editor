/**
 * The game→host contract: ONE pre-defined interface an external game may
 * declare on `window.vgaiGame` to let the editor work with it like native
 * content. Capabilities are by PRESENCE — every field is optional, and a game
 * that declares nothing runs exactly as before (doctrine: adaptation enables
 * editor features; it never bends a game around host internals). This file is
 * the single source of truth for the contract's shape — host code reads it
 * through {@link readGameContract} instead of ad-hoc `window` casts, so the
 * spec and the implementation cannot drift apart.
 *
 * Relationship to the native engine: first-party content implements the SAME
 * conceptual surface (mount root, lifecycle, loop gating) through
 * `RootAdapter`/`MountedThreeRoot` — the native engine is the premade 100%
 * implementation of this contract. An ingested game climbs the same ladder
 * endpoint by endpoint: capture infers what it can (the scene), the game
 * declares what inference can't reach (its DOM root, its session lifecycle).
 */

import type {
  AudioAdapter,
  CameraAdapter,
  NavigationAdapter,
  NetworkingAdapter,
  PhysicsCarrier,
  RenderDebugAdapter,
} from '../system-adapter';
import { GAME_SCENES_SHAPE } from './game-contract-seams';

/**
 * Session lifecycle endpoints. Declaring `start` means "I support cold
 * mount": when the host sets `window.__vgaiMountCold` before the game's entry
 * executes, the game may defer its session side-effects (backend connections,
 * narrative, audio) and render a quiet, inspectable scene; the host calls
 * `start()` — at most once per mount — when the user presses ▶. Declaring
 * `pause`/`resume` means the game can genuinely freeze/unfreeze itself. They
 * are one indivisible pair: the ingest adapter binds that pair as its mounted
 * lifecycle control, or binds its outside-in loop gate when neither is
 * declared. Host consumers see only the bound control; they never mix one
 * declared half with a fallback half.
 */
export interface VgaiGameLifecycle {
  start?(): void;
  pause?(): void;
  resume?(): void;
  /**
   * END this session: unmount the game's root, stop its frame loop, release
   * what its boot created. The host calls it FIRST at ingest teardown, before
   * its own reclamation — the game's own way out always outranks the host's.
   *
   * Why this slot exists (measured on racing-game): a self-booting R3F game's
   * fiber loop is not the host's to stop — the game never calls
   * `renderer.setAnimationLoop` (the loop-gate's own warning says it cannot
   * hold it) and fiber is a shared bare dependency the realm scheduler does
   * not wrap — so after teardown the DEAD mount's `useFrame` kept ticking
   * against React-nulled refs, one `TypeError` per frame (~490 per walk)
   * until the page reloaded. Only the code that created the root can end it,
   * and for a vendored game that code is the host-added entry shim, which
   * publishes the unmount for the contract shim to declare here.
   *
   * A game that declares nothing keeps today's behavior — host-side
   * reclamation only, with its loop's ungovernability remaining the
   * loop-gate's named standing warning. A CANVAS ingest whose module-scope
   * `Application` survives teardown BY DESIGN (the warm-remount contract —
   * see `resolve-three.ts`'s `remountEpochs` doc) simply does not declare it.
   */
  dispose?(): void;
}

/** One of the game's own scenes, as {@link VgaiGameScenes} lists it. `id` is the
 *  game's OWN identifier for it — the string `current()` reports and `goTo()`
 *  takes — and `label` is what a person reads. */
export interface VgaiGameScene {
  id: string;
  label: string;
}

/**
 * The game's SCENES: the whole-world states it swaps between — screens, levels,
 * rooms — named by the game itself.
 *
 * A multi-screen game's screens ARE its scenes, and the editor already has a
 * vocabulary for "the design-time states a world can be put into": stories.
 * So this is projected onto the ordinary `StoriesProvider`
 * (`adapter/authoring.ts`) by the host's canvas ingest mount
 * (`packages/editor/src/authoring/contract-scenes-stories.ts`), WORLD-LEVEL —
 * the same scope the react world adapter's stories have — so the inspector's
 * story picker lists a game's screens and switching one runs the game's own
 * navigation call. Nothing else is invented: there is no host-side scene model,
 * no ordering rule, and no "no scene" state.
 *
 * Presence-only, like the rest of this contract. A game that declares nothing
 * here reports no stories provider at all — a named absence in the coverage
 * report, never an empty picker.
 */
export interface VgaiGameScenes {
  /** Every scene a player can be sent to right now, in the game's own order. */
  list(): VgaiGameScene[];
  /** The scene the game currently has up, by its own id; `null` when it has
   *  none yet (a game whose entry has not resolved, a boot screen the game does
   *  not name). */
  current(): string | null;
  /** Put the game in that scene the way the game's OWN navigation does. May be
   *  async — a scene commonly loads its own assets first — and the host awaits
   *  whatever it returns before reporting the switch. */
  goTo(id: string): Promise<unknown> | unknown;
}

/**
 * One invokable verb the game exposes. Deliberately the SAME listing shape a
 * first-party game gets from `ctx.debug.registerCommand`
 * (`DebugCommandInfo`/`DebugAdapter.invoke` in `adapter/system-adapter.ts`) —
 * an ingested game's verbs must enumerate through `game.commands()` and run
 * through `game.command(...)` with no second vocabulary for agents to learn.
 *
 * `run` receives the positional argument list exactly as invoked. There is no
 * host-side validation: the contract is plain JS declared beside a foreign
 * game, so it cannot carry a Zod tuple the way `registerCommand` does.
 * `argsJsonSchema` is therefore DOCUMENTATION for listing surfaces, not a
 * gate — a verb validates its own arguments and throws its own errors.
 */
export interface VgaiGameCommand {
  name: string;
  description?: string;
  /** JSON-Schema projection of the argument list, when the game declares one. */
  argsJsonSchema?: unknown;
  run(...args: unknown[]): unknown | Promise<unknown>;
}

/**
 * One named, JSON-serializable state read — the `ctx.debug.registerStateProvider`
 * shape. `tier` carries the same meaning as the first-party one: `observable`
 * is a value the game already computes, `assisted` is one the shim derives.
 */
export interface VgaiGameStateProvider {
  name: string;
  tier?: 'observable' | 'assisted';
  read(): unknown;
}

/**
 * One top-level semantic hierarchy group from the game's OWN model. `count`
 * is recomputed by the game when the host reads the hierarchy; it is not
 * inferred from render objects. The editor presents these rows beside the
 * captured render tree, so a system-driven game can say what its content is
 * without pretending its scene graph is authored truth.
 */
export interface VgaiGameHierarchyGroup {
  id: string;
  label: string;
  count: number;
}

/**
 * Synchronous read plus an optional game-owned invalidation signal. The
 * editor never polls or guesses when a game's model changed; a dynamic game
 * subscribes its ordinary authoring hierarchy to the same truth it reads.
 */
export interface VgaiGameHierarchyProvider {
  (): VgaiGameHierarchyGroup[];
  subscribe?(listener: () => void): () => void;
}

/**
 * The game's SYSTEM surface: what its content actually IS, as opposed to how
 * it renders. An ingested game's content is not always its scene graph — in a
 * system-driven game the authorable content lives in the game's own model and
 * is reached through the game's own verbs, which `root`/`lifecycle` could not
 * express.
 *
 * Every member is read by a concrete consumer: commands/state are projected
 * by `adapter/ingest/contract-debug-adapter.ts` onto the host's ordinary
 * `DebugAdapter` (`adapter/system-adapter.ts`), while `hierarchy` is projected
 * by the editor onto the ordinary `AuthoringAdapter.hierarchy` surface. Thus
 * `game.commands()`/`game.state()` reach an ingested game through the same
 * bridge first-party content uses, with no second vocabulary for agents to
 * learn. That is deliberate scope: this
 * interface describes what a foreign game's entry shim may declare, so every
 * member here is a promise the host must already keep. A member nothing reads
 * would be a shim author implementing a hook that is never called.
 */
export interface VgaiGameSystems {
  /** Verbs, enumerated by `game.commands()` and run by `game.command(...)`. */
  commands?: VgaiGameCommand[];
  /** State reads, enumerated by `game.providers()` and read by `game.state(...)`. */
  state?: VgaiGameStateProvider[];
  /** Semantic hierarchy groups from the game's own model, recomputed on read. */
  hierarchy?: VgaiGameHierarchyProvider;
  /**
   * The game's own {@link SystemAdapters} slots — the ingest-realm equivalent
   * of a first-party world's `ctx.registerSystemAdapter`. Read and projected by
   * `contract-system-adapters.ts` onto the mounted root's `systems` bag, so an
   * ingested game's physics/audio/navigation/networking reach the editor's
   * ordinary panels through the SAME registry a native world publishes to.
   */
  systemAdapters?: VgaiGameSystemAdapters;
}

/**
 * A slot's IMPLEMENTED-EMPTY answer: "this game genuinely has no X", carried
 * with the source-level evidence that establishes it.
 *
 * This exists because `SystemAdapters` is capability-by-PRESENCE, and presence
 * has only two values while the ingestion bar (docs/BRINGING-AN-EXISTING-GAME.md
 * §The ingestion checklist) has three inputs: bound, positively-absent, and
 * not-yet-answered. Omitting a slot cannot tell the last two apart — an editor
 * reading a bare absence cannot know whether anyone ever looked. Declaring this
 * record says someone looked, says what they found, and turns a work-order row
 * into a terminal one.
 *
 * It is deliberately NOT an adapter whose methods return zeros: a
 * `getConnectionState()` of `'disconnected'` on a game with no transport at all
 * is a fabrication (it implies a connection that could exist), which the
 * anti-shim rule forbids. The absence is stated, never simulated.
 */
export interface VgaiGameSystemEmpty {
  /** Always `false` — the discriminant that separates this from an adapter. */
  present: false;
  /**
   * Why the slot is empty, in SOURCE terms: what was searched and what was
   * found. "no netcode anywhere in `src/`" is a finished answer; "not
   * implemented yet" is not one, and a reviewer reading this field is meant to
   * be able to re-run the search.
   */
  evidence: string;
}

/**
 * The declarable `SystemAdapters` slots, each either a real implementation or a
 * positively-answered {@link VgaiGameSystemEmpty}.
 *
 * `debug` is deliberately NOT here: it is already the projection of
 * `commands`/`state` above (`contract-debug-adapter.ts`), and a second door onto
 * the same slot would let a game declare two different debug planes with no rule
 * for which wins.
 */
export interface VgaiGameSystemAdapters {
  /**
   * In the SURFACE'S OWN vocabulary: a three-surface game declares the node-id
   * keyed `PhysicsAdapter`, a canvas-surface game the display-object keyed
   * `PhysicsAdapter2D` (`keyedBy: 'display'` — the tag is what makes the two
   * tellable apart, and `contract-system-adapters.ts` reports a carrier keyed
   * for the wrong surface as MALFORMED by name rather than binding a shape
   * nothing on that lane can call).
   */
  physics?: PhysicsCarrier | VgaiGameSystemEmpty;
  networking?: NetworkingAdapter | VgaiGameSystemEmpty;
  navigation?: NavigationAdapter | VgaiGameSystemEmpty;
  audio?: AudioAdapter | VgaiGameSystemEmpty;
  camera?: CameraAdapter | VgaiGameSystemEmpty;
  renderDebug?: RenderDebugAdapter | VgaiGameSystemEmpty;
}

/**
 * The game's own READINESS signal — "my world is built; what you see now is
 * the game".
 *
 * A host-mounted (exported-composition) root needs none of this: the host runs
 * the mount, so mount completion IS readiness and the host answers the question
 * itself. A SELF-BOOTING game owns its own boot, and the host has no way to see
 * the end of it — which is why every reader used to measure instead: poll the
 * draw count, watch `scene.children.length` stop growing, wait a fixed window.
 * Each of those is a guess at a fact the game's author can state, which is
 * exactly the shape zero inference names (ARCHITECTURE-CORE §The editor
 * protocol), so the fix is this declaration slot rather than a better poll.
 *
 * Either form is legal, because both are how games already write it: a promise
 * the game resolves when its boot finishes, or a function returning one (a
 * callback that resolves/returns when ready). The host normalizes both through
 * {@link readGameReady} and awaits exactly once per mount.
 *
 * Declaring nothing is a supported, first-class answer: the measured waits
 * remain as the documented fallback. What changes is that they stop being
 * SILENT — a root with no declaration reports `source: 'measured'` wherever
 * readiness is reported, so "nobody stated it" is a visible fact rather than
 * an invisible default.
 */
export type VgaiGameReady = Promise<unknown> | (() => Promise<unknown> | unknown);

export interface VgaiGameContract {
  /** Bump only on breaking shape changes; additive endpoints keep version 1. */
  contractVersion: 1;
  /**
   * The element that OWNS the game's whole DOM (canvas + HUD + overlay
   * portals). The host adopts it wholesale into the game pane, so DOM-hybrid
   * games keep their UI instead of stranding it at page level. The host
   * verifies it actually contains the captured canvas before adopting.
   */
  root?: HTMLElement;
  /**
   * The canvas the game PRESENTS on — the one whose pixels are "what the game
   * looks like".
   *
   * `root` above answers a different question (which element owns the game's
   * whole DOM), and a game routinely has more than one canvas inside it: an
   * offscreen buffer it composites from, a minimap, a 2D overlay. The host's
   * standing answer was "the first `<canvas>` in DOM order", which is a guess
   * about authoring order, and the game's author knows the real answer.
   *
   * Declaring nothing keeps the measured answer, reported as `measured` (see
   * `packages/editor/src/presentation-surface.ts`, the one reader).
   */
  presentation?: HTMLCanvasElement;
  /**
   * The game's own WORLD — the `THREE.Scene` the editor should adopt.
   *
   * Without it the host adopts whichever scene renders first that it did not
   * draw itself (`scene-capture.ts`), which is a good measured default and a
   * permanent, silent commitment: a splash screen, a shadow pre-pass or a
   * render-to-texture warm-up that draws one frame earlier is adopted as the
   * game forever. Declaring this makes the choice the game's, not a race's.
   *
   * Typed `object` rather than `THREE.Scene` on purpose — this file is the
   * contract's shape and imports no renderer library; the host checks
   * structurally (`isScene`) in {@link readGameWorld}.
   */
  world?: object;
  /** The game's own readiness signal — see {@link VgaiGameReady}. */
  ready?: VgaiGameReady;
  lifecycle?: VgaiGameLifecycle;
  /**
   * The game's own scenes. Absent means "this game declared no scene surface" —
   * the mount then supplies no stories provider at all, and the coverage report
   * says so by name.
   */
  scenes?: VgaiGameScenes;
  /**
   * The game's own systems. Absent means "this game declared no system
   * surface" — every dependent editor surface then shows a named absence, not
   * an empty pretend-palette.
   */
  systems?: VgaiGameSystems;
}

/**
 * Read the declared contract, if any. The `contractVersion` gate is the
 * forward-compatibility hinge: a future v2 game on a v1 host is ignored
 * (pre-contract fallbacks apply) rather than half-interpreted.
 *
 * `scope` is the REALM to read from, and defaults to this module's own
 * `window` — the realm every ingest mount runs the game's modules in, where the
 * game and the host share one global. It is a parameter at all because the
 * contract is a property of the realm the game runs in, never of the realm that
 * happens to be asking.
 */
export function readGameContract(
  scope: Window | null | undefined = typeof window === 'undefined' ? null : window,
): VgaiGameContract | null {
  const declared = (scope as unknown as { vgaiGame?: VgaiGameContract } | null | undefined)
    ?.vgaiGame;
  if (!declared || declared.contractVersion !== 1) return null;
  return declared;
}

/** What {@link readGameScenes} found. Both fields `null` ⇒ the game declared no
 *  scene surface at all, which is a different answer from declaring an unusable
 *  one (the same distinction `contract-system-adapters.ts` draws between an
 *  omitted slot and a malformed one). */
export interface GameScenesReading {
  /** The callable surface, or `null` when nothing usable was declared. */
  readonly scenes: VgaiGameScenes | null;
  /** Why a DECLARED surface was refused, in the words the host prints. */
  readonly malformed: string | null;
}

/** The endpoints a scene surface must carry: every one of them is called by the
 *  projection, so a declaration missing any cannot be honoured. */
const SCENES_REQUIRED_MEMBERS = Object.entries(GAME_SCENES_SHAPE)
  .filter(([, spec]) => !spec.optional)
  .map(([member]) => member as keyof VgaiGameScenes);

/**
 * Read the declared {@link VgaiGameScenes}, refusing a malformed one BY NAME.
 *
 * The shape check is the same honesty `projectContractSystemAdapters` applies to
 * a declared system slot: a `scenes: {}` would otherwise register as a
 * capability and light up a story picker over an object with no methods. Nothing
 * here CALLS a declared endpoint — presence and type only.
 */
export function readGameScenes(contract: VgaiGameContract | null | undefined): GameScenesReading {
  const declared: unknown = contract?.scenes;
  if (declared === undefined || declared === null) return { scenes: null, malformed: null };
  if (typeof declared !== 'object') {
    return {
      scenes: null,
      malformed: `declared as ${typeof declared}; expected an object with list(), current() and goTo()`,
    };
  }
  const missing = SCENES_REQUIRED_MEMBERS.filter(
    (member) => typeof (declared as Record<string, unknown>)[member] !== 'function',
  );
  if (missing.length > 0) {
    return {
      scenes: null,
      malformed: `declared a scenes surface missing required member(s): ${missing.join(', ')}`,
    };
  }
  return { scenes: declared as VgaiGameScenes, malformed: null };
}

/** What {@link readGameReady} found. `ready: null` with `malformed: null` ⇒ the
 *  game declared no readiness signal, which is a different answer from
 *  declaring an unusable one — the same distinction {@link readGameScenes}
 *  draws, and the reason the readiness facet can report `declared` vs
 *  `measured` honestly instead of collapsing both into "not ready yet". */
export interface GameReadyReading {
  /** The normalized signal: awaiting it once resolves when the game says it is
   *  ready. `null` when nothing usable was declared. */
  readonly ready: (() => Promise<unknown>) | null;
  /** Why a DECLARED signal was refused, in the words the host prints. */
  readonly malformed: string | null;
}

/**
 * Read the declared {@link VgaiGameReady}, refusing a malformed one BY NAME.
 *
 * Both legal forms normalize to one call: a promise is wrapped, a function is
 * invoked lazily (once, when the host asks — which in the ingest mount is only
 * AFTER the first captured render, so a `ready` that itself triggers the boot
 * would deadlock the capture window; games self-boot on this lane),
 * and whatever the function returns is coerced through `Promise.resolve` —
 * a synchronous return means "already ready", which is a real declaration.
 *
 * A rejected/throwing signal is NOT swallowed here: the host awaits it and its
 * failure is what separates "crashed before ready" from "never became ready"
 * in the mount-failure report (`mount-readiness.ts`).
 */
export function readGameReady(contract: VgaiGameContract | null | undefined): GameReadyReading {
  const declared: unknown = contract?.ready;
  if (declared === undefined || declared === null) return { ready: null, malformed: null };
  if (typeof declared === 'function') {
    const fn = declared as () => unknown;
    return { ready: () => Promise.resolve(fn()), malformed: null };
  }
  if (typeof (declared as { then?: unknown }).then === 'function') {
    const thenable = declared as Promise<unknown>;
    return { ready: () => Promise.resolve(thenable), malformed: null };
  }
  return {
    ready: null,
    malformed: `declared \`ready\` as ${typeof declared}; expected a promise or a function returning one`,
  };
}

/** What {@link readGameWorld} found — same two-field honesty as
 *  {@link readGameScenes}. */
export interface GameWorldReading {
  readonly world: object | null;
  readonly malformed: string | null;
}

/**
 * Read the declared {@link VgaiGameContract.world}, refusing a malformed one BY
 * NAME.
 *
 * STRUCTURAL (`isScene === true`), for two reasons: this file imports no
 * renderer library, and an `instanceof THREE.Scene` across the realm the game
 * runs in is exactly the check that silently answers `false` for a good scene —
 * turning a correct declaration into an unexplained fall-back to first-render.
 */
export function readGameWorld(contract: VgaiGameContract | null | undefined): GameWorldReading {
  const declared: unknown = contract?.world;
  if (declared === undefined || declared === null) return { world: null, malformed: null };
  if (typeof declared !== 'object' || (declared as { isScene?: unknown }).isScene !== true) {
    return {
      world: null,
      malformed: `declared \`world\` as ${typeof declared}; expected the game's own THREE.Scene`,
    };
  }
  return { world: declared as object, malformed: null };
}

/** What {@link readGamePresentation} found — same two-field honesty as
 *  {@link readGameScenes}. */
export interface GamePresentationReading {
  readonly canvas: HTMLCanvasElement | null;
  readonly malformed: string | null;
}

/**
 * Read the declared {@link VgaiGameContract.presentation} canvas, refusing a
 * malformed one BY NAME.
 *
 * The shape check is STRUCTURAL (`tagName === 'CANVAS'` plus a `getContext`),
 * not `instanceof`: the contract is read out of the realm the game runs in, and
 * a realm-crossing `instanceof` is exactly the check that silently answers
 * `false` for a perfectly good element. A wrong declaration must be refused by
 * name, never by accident.
 */
export function readGamePresentation(
  contract: VgaiGameContract | null | undefined,
): GamePresentationReading {
  const declared: unknown = contract?.presentation;
  if (declared === undefined || declared === null) return { canvas: null, malformed: null };
  const el = declared as { tagName?: unknown; getContext?: unknown };
  if (typeof el !== 'object' || el.tagName !== 'CANVAS' || typeof el.getContext !== 'function') {
    return {
      canvas: null,
      malformed: `declared \`presentation\` as ${
        typeof declared === 'object'
          ? String((el as { tagName?: unknown }).tagName ?? 'object')
          : typeof declared
      }; expected the game's own <canvas> element`,
    };
  }
  return { canvas: declared as HTMLCanvasElement, malformed: null };
}
