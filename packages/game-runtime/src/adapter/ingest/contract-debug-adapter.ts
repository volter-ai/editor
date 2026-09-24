/**
 * Projects a game's DECLARED system surface (`window.vgaiGame.systems`, see
 * `game-contract.ts`) onto the host's existing {@link DebugAdapter} — the one
 * seam `game.commands()` / `game.state()` / `game.providers()` already read
 * through for first-party content (`command-listener.ts`'s
 * `dispatchBridgeMethod` → `getActiveSystems().debug`).
 *
 * Why a projection rather than a second door: an agent driving an ingested
 * game must not have to learn a parallel vocabulary. A first-party game
 * registers verbs with `ctx.debug.registerCommand`; an ingested game declares
 * them in its entry shim. Both arrive at the SAME `DebugAdapter`, so every
 * consumer downstream — the CLI's `vgai eval`, `@vgai/e2e`'s `GameClient`, the
 * editor's Debug Console and State Watch panels — works unchanged and unaware
 * of the provenance.
 *
 * What this deliberately does NOT do:
 * - **Validate arguments.** The first-party path validates against a declared
 *   Zod tuple; a shim beside a foreign game is plain JS and has none. A verb
 *   validates itself and throws its own error, which surfaces wrapped as
 *   `DEBUG_COMMAND_FAILED` — the host never invents a schema to check against.
 * - **Fabricate an event ring.** There is no tick loop behind an ingested
 *   game's declarations, so `events()` is empty. That is accurate (nothing was
 *   emitted), not a stub standing in for a missing feature.
 */

import type { VgaiGameSystems } from '@volter/editor-project/adapter/ingest/game-contract';
import type {
  DebugAdapter,
  DebugCommandInfo,
  TickStampedEvent,
} from '@volter/editor-project/adapter/system-adapter';
import { DebugError } from '../../runtime/debug-registry';

/**
 * Build a {@link DebugAdapter} over a declared system surface, or `null` when
 * the game declared no verbs and no state. `null` is the honest floor: the
 * bridge then reports `DEBUG_ADAPTER_UNAVAILABLE` exactly as it did before,
 * rather than serving an empty adapter that reads as "this game has no state"
 * when the truth is "this game declared nothing".
 */
export function createContractDebugAdapter(
  systems: VgaiGameSystems | undefined | null,
): DebugAdapter | null {
  const commandList = systems?.commands ?? [];
  const providerList = systems?.state ?? [];
  if (commandList.length === 0 && providerList.length === 0) return null;

  // Snapshot into name-keyed maps once. A later duplicate shadows an earlier
  // one and the listing de-duplicates with it, so `commands()` can never
  // advertise a name `invoke()` would resolve differently.
  const byCommand = new Map(commandList.map((c) => [c.name, c]));
  const byProvider = new Map(providerList.map((p) => [p.name, p]));

  return {
    providers: () =>
      [...byProvider.values()].map((p) => ({ name: p.name, tier: p.tier ?? 'observable' })),

    state: (name: string): unknown => {
      const provider = byProvider.get(name);
      if (!provider) {
        throw new DebugError(
          'STATE_PROVIDER_NOT_FOUND',
          `No state provider named "${name}" is declared by this game.`,
          { registered: [...byProvider.keys()] },
        );
      }
      return provider.read();
    },

    stateAll: (): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [name, provider] of byProvider) {
        // One throwing provider must not cost the caller every other reading —
        // the same per-key isolation the first-party registry gives.
        try {
          out[name] = provider.read();
        } catch (err) {
          out[name] = { __error: String(err) };
        }
      }
      return out;
    },

    commands: (): DebugCommandInfo[] =>
      [...byCommand.values()].map((c) => ({
        name: c.name,
        description: c.description,
        argsJsonSchema: c.argsJsonSchema,
        // An ingested game runs entirely in the browser realm the host mounted
        // it in; there is no server leg for its verbs to route to.
        locus: 'client' as const,
      })),

    invoke: async (name: string, args: unknown[]): Promise<unknown> => {
      const command = byCommand.get(name);
      if (!command) {
        throw new DebugError(
          'DEBUG_COMMAND_NOT_REGISTERED',
          `No command named "${name}" is declared by this game.`,
          { registered: [...byCommand.keys()] },
        );
      }
      try {
        return await command.run(...args);
      } catch (err) {
        throw new DebugError('DEBUG_COMMAND_FAILED', `Command "${name}" threw: ${String(err)}`, {
          name,
        });
      }
    },

    events: (): TickStampedEvent[] => [],
  };
}
