/**
 * Projects an ADAPTER's declared observation slots
 * (`AdapterDefinition.observation`, `adapter/adapter-module.ts`) onto the host's
 * existing {@link DebugAdapter} — the one seam `game.providers()` /
 * `game.state()` / `game.commands()` already read through
 * (`command-listener.ts`'s `dispatchBridgeMethod` → `getActiveSystems().debug`).
 *
 * This is the SIBLING of `contract-debug-adapter.ts` and deliberately the same
 * shape: a projection rather than a second door. The two differ only in WHO
 * declared the surface — the game itself, on `window.vgaiGame.systems`, or the
 * game's adapter module beside it — and a consumer downstream must not be able
 * to tell them apart. `merge-debug-adapters.ts` is what folds both onto the one
 * slot.
 *
 * ## What `game` is
 *
 * The host's to hand over, and for an INGEST mount it is the REALM the game's
 * own modules ran in. That is not a convenience: an ingest mount runs the game
 * in the editor's own realm (`game-contract.ts`'s `readGameContract` says so —
 * "the realm every ingest mount runs the game's modules in, where the game and
 * the host share one global"), a vendored bundle's adapter is HOST-realm by the
 * placement rule, and the only handles such a game publishes are the ones on
 * that realm — its runtime's own public registry, or a host-build seam beside
 * it. Handing the realm is therefore handing the game everything it actually
 * exposes; handing anything narrower would make the adapter reach for `window`
 * itself, which is the same read with the provenance hidden.
 *
 * ## The two-state rule, kept
 *
 * Declaring a slot and answering it are separate facts. A declaration with NO
 * `answer` is still listed and refuses BY NAME when read — never omitted,
 * because omitting it would report "the game has no such state" when the truth
 * is "the table declared it and nothing binds it yet". Same for a throwing
 * `answer`: it propagates (exactly as a first-party provider's does), and only
 * `stateAll()` isolates it per key.
 *
 * ## What this deliberately does NOT do
 *
 * - **Validate arguments.** A declared command's `answer` receives the invoked
 *   argument list after the game handle; there is no Zod tuple beside a foreign
 *   game, so a verb validates itself and throws its own error, surfaced wrapped
 *   as `DEBUG_COMMAND_FAILED`. Identical to the contract projection's stance.
 * - **Fabricate an event ring.** Nothing emits behind a declaration, so
 *   `events()` is empty — accurate, not a stub.
 */

import type { ObservationDeclaration } from '@volter/editor-project/adapter/adapter-module';
import type {
  DebugAdapter,
  DebugCommandInfo,
  TickStampedEvent,
} from '@volter/editor-project/adapter/system-adapter';
import { DebugError } from '../../runtime/debug-registry';

/**
 * An adapter-declared read is DERIVED by the host-side table from the game's own
 * handles — which is precisely what `assisted` means in the tier vocabulary
 * (`game-contract.ts`: "`observable` is a value the game already computes,
 * `assisted` is one the shim derives"). Reporting `observable` would claim the
 * game itself publishes the value.
 */
const DECLARED_TIER = 'assisted' as const;

function unanswered(id: string, kind: string): DebugError {
  return new DebugError(
    'OBSERVATION_UNANSWERED',
    `Observation "${id}" (${kind}) is declared by this game's adapter with no \`answer\` — ` +
      'the slot exists and nothing binds it yet, which is not the same as the game having none.',
    { id, kind },
  );
}

/**
 * Build a {@link DebugAdapter} over an adapter's observation declarations, or
 * `null` when it declares none. `null` is the honest floor — the same one
 * `createContractDebugAdapter` returns — so a game that declared nothing keeps
 * reporting `DEBUG_ADAPTER_UNAVAILABLE` rather than serving an empty adapter
 * that reads as "this game has no state".
 */
export function createObservationDebugAdapter(
  declarations: readonly ObservationDeclaration[] | undefined | null,
  game: unknown,
): DebugAdapter | null {
  const all = declarations ?? [];
  if (all.length === 0) return null;

  // Snapshot into id-keyed maps once, exactly as the contract projection does:
  // a later duplicate shadows an earlier one and the listing de-duplicates with
  // it, so a listed id can never resolve differently than it reads.
  const byProvider = new Map(all.filter((d) => d.kind === 'state').map((d) => [d.id, d]));
  const byCommand = new Map(all.filter((d) => d.kind === 'command').map((d) => [d.id, d]));

  return {
    providers: () => [...byProvider.keys()].map((name) => ({ name, tier: DECLARED_TIER })),

    state: (name: string): unknown => {
      const declaration = byProvider.get(name);
      if (!declaration) {
        throw new DebugError(
          'STATE_PROVIDER_NOT_FOUND',
          `No state provider named "${name}" is declared by this game's adapter.`,
          { registered: [...byProvider.keys()] },
        );
      }
      if (!declaration.answer) throw unanswered(name, 'state');
      return declaration.answer(game);
    },

    stateAll: (): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [name, declaration] of byProvider) {
        // One throwing declaration must not cost the caller every other
        // reading — the same per-key isolation the first-party registry gives.
        try {
          out[name] = declaration.answer
            ? declaration.answer(game)
            : (() => {
                throw unanswered(name, 'state');
              })();
        } catch (err) {
          out[name] = { __error: String(err) };
        }
      }
      return out;
    },

    commands: (): DebugCommandInfo[] =>
      [...byCommand.keys()].map((name) => ({
        name,
        // An ingested game runs entirely in the browser realm the host mounted
        // it in; there is no server leg for its verbs to route to.
        locus: byCommand.get(name)?.locus ?? ('client' as const),
      })),

    invoke: async (name: string, args: unknown[]): Promise<unknown> => {
      const declaration = byCommand.get(name);
      if (!declaration) {
        throw new DebugError(
          'DEBUG_COMMAND_NOT_REGISTERED',
          `No command named "${name}" is declared by this game's adapter.`,
          { registered: [...byCommand.keys()] },
        );
      }
      if (!declaration.answer) throw unanswered(name, 'command');
      try {
        // The game handle first, then the invoked argument list — a declared
        // verb is a function OF the mounted game, which is the whole reason
        // `answer` takes one.
        return await (declaration.answer as (game: unknown, ...rest: unknown[]) => unknown)(
          game,
          ...args,
        );
      } catch (err) {
        throw new DebugError('DEBUG_COMMAND_FAILED', `Command "${name}" threw: ${String(err)}`, {
          name,
        });
      }
    },

    events: (): TickStampedEvent[] => [],
  };
}
