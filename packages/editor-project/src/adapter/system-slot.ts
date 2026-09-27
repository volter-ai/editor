/**
 * `createSystemSlot` — THE implementation of the declared-slot façade, the
 * seam between a STATIC `systems` declaration and a LIVE adapter that only
 * exists once the world tree is mounted.
 *
 * WHY IT EXISTS. An entry declares its systems statically
 * (`export const systems = { networking: networkingSystem() }`), while the
 * thing being declared — a joined Colyseus room, a baked navmesh, a mounted
 * `<Physics>`, a cutscene's camera ownership — is built inside the world tree,
 * later, and may be replaced (reconnect, remount, hot restart) or go away
 * (stop). The slot is a stable object the host installs at mount and holds
 * forever; every call forwards to whatever is attached right now.
 *
 * ── THE HONESTY RULE, STATED IN ONE PLACE ───────────────────────────────────
 * This is why the pattern is centralized: five hand-rolled copies disagreed
 * about it, and each disagreement was found by a separate review.
 *
 *  - An **action** with no live target REFUSES BY NAME
 *    (`<name>: <unattachedMessage>`). Never a silent no-op — a caller that
 *    told the game to DO something must learn that it did not happen. An
 *    action against a live adapter that lacks the member refuses the same
 *    way, naming the member.
 *  - A **read** answers its declared HONEST EMPTY — `'disconnected'`, `[]`,
 *    `null`, `false`. That is not a fabrication: it is the truth of the
 *    not-attached state, in the same vocabulary the editor's own edit-mode
 *    adapters use. Reads are also the only kind safe to call from a per-frame
 *    debug draw, which is why a throw into a rAF loop is never the answer.
 *  - An **optional** member MIRRORS THE LIVE ADAPTER'S PRESENCE: absent while
 *    unattached, and absent afterwards when the live adapter itself does not
 *    provide it. Presence IS the consume-by-presence protocol's signal, so
 *    the slot may never invent it. Each presence read CAPTURES the adapter it
 *    saw and forwards to that same instance, so a detach between the read and
 *    the call answers as the adapter the caller was handed rather than a
 *    mid-flight swap.
 *  - A **subscribe** member SURVIVES REATTACHMENT: listeners live on the
 *    slot, never on the instance, and the slot re-binds its own single
 *    subscription on every attach/detach. A panel that subscribed once to the
 *    stable slot object is therefore never left holding a disposed system, and
 *    it is notified when the live half appears or disappears.
 *  - A member the config DOES NOT LIST does not exist on the slot at all.
 *    That is how the anti-shim rule spells omission — e.g. `PhysicsAdapter`'s
 *    `debugDraw`/`contactPoints` over `@react-three/rapier`, whose debug line
 *    segments live inside the fiber tree and expose no handle. Absence is a
 *    capability answer; a stub is a lie.
 *
 * ── RESOURCE OWNERSHIP ──────────────────────────────────────────────────────
 * OWNER: whoever built the live adapter (the hook, the bridge component). The
 * slot owns only the POINTER to it plus its own listener set and its own
 * subscription to the live half. SHARERS: every reader of the declared
 * system — editor inspectors, instruments. TEARDOWN: the function `attach`
 * returns, and nothing else. It is IDENTITY-GUARDED — it clears only while
 * the same instance is still attached, so a replace-then-teardown-the-old
 * ordering cannot detach the new one — and detaching never disposes the
 * adapter, because the slot did not create it.
 *
 * Static declarations shared across mounts must use `declareScopedSystem`.
 * The adapter supplies an opaque mount scope and the host resolves the declaration
 * once per root. A slot then belongs to that evaluation, never to the page.
 *
 * NOT A WRAPPER. The slot's members have the adapter interface's own exact
 * signatures and hand back the implementation's own values; nothing stands
 * between a caller and the live library object.
 */

import type { VgaiGameSystemEmpty } from './ingest/game-contract';

/**
 * `absent(reason)` — THE WHOLE-SLOT counterpart of the four per-member policies
 * above, and the fifth line of the same honesty rule.
 *
 * The four policies answer "this slot exists but nothing is attached yet". This
 * one answers a different question entirely: **this game will never have that
 * subsystem, and here is what was searched.** A slot simply left out of the
 * `systems` table cannot say that — an omitted key means "unsupported", which is
 * the same shape as "nobody looked", and the coverage report has to file it as a
 * work order forever. Declaring the absence turns an UNANSWERED row into a
 * terminal one.
 *
 * ```ts
 * export const systems = {
 *   navigation: createNavigationAdapter(navigation),
 *   networking: absent('single-player: no Colyseus client anywhere in `src/`'),
 * };
 * ```
 *
 * ## It is a CONSTRUCTOR for the shape that already exists, not a second one
 *
 * The returned value IS `VgaiGameSystemEmpty` — the plain
 * `{ present: false, evidence }` record an INGESTED game declares on
 * `window.vgaiGame.systems.systemAdapters`, validated by the same single
 * projection (`ingest/contract-system-adapters.ts`). There is one shape law, not
 * two: a foreign game cannot import this helper and must stay able to write the
 * record by hand, so nothing here may brand the runtime value. What the helper
 * buys a FIRST-PARTY author is the reason-quality check moved to the call site —
 * our own code failing its own contract fails fast, where an ingested game's
 * same mistake is filed as a `malformed` verdict for its coverage report.
 *
 * ## It is a MARKER, never a stub adapter
 *
 * Do not answer an absent slot with an adapter whose methods return zeros. A
 * `getConnectionState()` of `'disconnected'` on a game with no transport implies
 * a connection that could exist; that is the fabrication the anti-shim rule
 * forbids. The absence is STATED, and the host installs nothing for it.
 *
 * @param reason What was searched and what was found, in the game's own source
 *   terms. "no netcode anywhere in `src/`" is a finished answer a reviewer can
 *   re-run; "not implemented yet" is a plan, and is rejected here.
 */
export function absent(reason: string): VgaiGameSystemEmpty {
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new Error(
      'absent(): an absence needs evidence — say what was searched and what was found ' +
        '(e.g. "no Colyseus client anywhere in `src/`"), so a reviewer can re-run it. ' +
        'An unevidenced absence asserts something nobody can re-check.',
    );
  }
  return { present: false, evidence: reason };
}

/** Any adapter member. `never[]` args make the conditional match contravariantly. */
type AnyFn = (...args: never[]) => unknown;

/** The declared member's return type, used to type a `read`'s honest empty. */
type MemberReturn<F> = NonNullable<F> extends (...args: never[]) => infer R ? R : never;

/**
 * The per-member policy. There are exactly four, and every member of every
 * declared slot in the repo is one of them — see the honesty rule above.
 */
export type SystemSlotMemberSpec<F> =
  | { readonly kind: 'action' }
  | { readonly kind: 'read'; readonly empty: MemberReturn<F> }
  | { readonly kind: 'subscribe' }
  | { readonly kind: 'optional' };

/** The keys of `T` whose values are callable (data properties are not slottable). */
type FunctionMemberKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends AnyFn ? K : never;
}[keyof T];

/** Per-member policies. A member left out is left OFF the slot entirely. */
export type SystemSlotMembers<T> = {
  readonly [K in FunctionMemberKeys<T>]?: SystemSlotMemberSpec<T[K]>;
};

export interface SystemSlotConfig<T extends object> {
  /**
   * The slot's own name, used as the prefix of every refusal so a stack-less
   * error still names the seam (`'networkingSystem'`).
   */
  readonly name: string;
  /**
   * The rest of an action's refusal while nothing is attached — the DOMAIN
   * half of the message, naming what has not happened yet ("the world is not
   * playing, or the navmesh has not finished building").
   */
  readonly unattachedMessage: string;
  readonly members: SystemSlotMembers<T>;
}

export interface SystemSlot<T extends object> {
  /**
   * Publish `live` as the slot's target. Returns the ONE detach path, which
   * is identity-guarded: it clears only while `live` is still the attached
   * instance, and never disposes it.
   */
  attach(live: T): () => void;
  /** The stable declared object. Hand THIS to the entry's `systems` map. */
  readonly slot: T;
}

export function createSystemSlot<T extends object>(config: SystemSlotConfig<T>): SystemSlot<T> {
  const { name, unattachedMessage, members } = config;

  let live: T | null = null;
  /** Subscribers to the stable slot object; they outlive any one live instance. */
  const listeners = new Set<() => void>();
  /** The slot's own single subscription to whatever is attached. */
  let liveUnsubscribe: (() => void) | null = null;
  let subscribeMember: string | null = null;

  const asRecord = (value: object): Record<string, unknown> =>
    value as unknown as Record<string, unknown>;

  const liveMember = (member: string): AnyFn | undefined => {
    if (!live) return undefined;
    const value = asRecord(live)[member];
    return typeof value === 'function' ? (value as AnyFn) : undefined;
  };

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const bindLive = (): void => {
    liveUnsubscribe?.();
    liveUnsubscribe = null;
    if (!live || subscribeMember === null || listeners.size === 0) return;
    const subscribe = liveMember(subscribeMember);
    if (!subscribe) return;
    const result = subscribe.call(live, notify as never);
    liveUnsubscribe = typeof result === 'function' ? (result as () => void) : null;
  };

  const target: Record<string, unknown> = {};

  const declared = Object.entries(members) as [string, SystemSlotMemberSpec<unknown>][];
  for (const [member, spec] of declared) {
    switch (spec.kind) {
      case 'action': {
        // Refuse by name, twice over: no live adapter at all, or a live
        // adapter that does not carry this member (only ever a foreign
        // replacement — the blessed implementations carry all of theirs).
        target[member] = (...args: never[]): unknown => {
          if (!live) throw new Error(`${name}: ${unattachedMessage}`);
          const fn = liveMember(member);
          if (!fn) throw new Error(`${name}: the live adapter has no ${member}().`);
          return fn.apply(live, args);
        };
        break;
      }
      case 'read': {
        const { empty } = spec;
        target[member] = (...args: never[]): unknown => {
          const current = live;
          const fn = liveMember(member);
          const value = fn ? fn.apply(current, args) : undefined;
          return value ?? empty;
        };
        break;
      }
      case 'subscribe': {
        if (subscribeMember !== null) {
          throw new Error(
            `${name}: a slot declares at most one 'subscribe' member (${subscribeMember} and ${member}).`,
          );
        }
        subscribeMember = member;
        target[member] = (listener: () => void): (() => void) => {
          listeners.add(listener);
          bindLive();
          return () => {
            listeners.delete(listener);
            bindLive();
          };
        };
        break;
      }
      case 'optional': {
        Object.defineProperty(target, member, {
          enumerable: true,
          configurable: true,
          get(): AnyFn | undefined {
            const current = live;
            const fn = liveMember(member);
            if (!fn) return undefined;
            return (...args: never[]): unknown => fn.apply(current, args);
          },
        });
        break;
      }
    }
  }

  const attach = (next: T): (() => void) => {
    live = next;
    bindLive();
    notify();
    return () => {
      if (live !== next) return;
      live = null;
      bindLive();
      notify();
    };
  };

  // THE ONE CAST. `exactOptionalPropertyTypes` forbids an optional member
  // whose getter can yield `undefined`, but that is precisely the honest
  // shape here — the getter IS how presence mirrors the live adapter — and a
  // reflectively built object cannot be typed structurally anyway. Callers
  // see exactly the absent/present behavior the adapter interface documents.
  return { attach, slot: target as T };
}

/** Optional mount binding for a static system declaration. The contract knows
 * only an opaque identity; the implementing adapter owns its native scope. */
const scopedSystems = new WeakMap<object, (scope: object) => object>();

export function declareScopedSystem<T extends object>(
  declaration: T,
  bind: (scope: object) => T,
): T {
  scopedSystems.set(declaration, bind);
  return declaration;
}

/** Ordinary, already-bound adapters retain their exact identity. */
export function bindScopedSystem<T extends object>(declaration: T, scope: object): T {
  const bind = scopedSystems.get(declaration);
  return bind ? (bind(scope) as T) : declaration;
}
