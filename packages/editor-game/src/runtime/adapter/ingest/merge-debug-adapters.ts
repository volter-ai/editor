/**
 * ONE `DebugAdapter` out of several projections of the same mount.
 *
 * Two feeders exist today and they are peers, not layers: the game's own
 * declared system surface (`contract-debug-adapter.ts`, from
 * `window.vgaiGame.systems`) and its adapter module's observation table
 * (`observation-debug-adapter.ts`). Both project onto the ONE runtime door the
 * editor and `vgai eval` already read (`SystemAdapters.debug`), so the merge
 * belongs here rather than in a second slot — a consumer must not be able to
 * tell a name's provenance, which is the whole point of both projections.
 *
 * ## A collision REFUSES the name; it never shadows it
 *
 * When two feeders declare the same provider or command name, one of them would
 * otherwise win silently and an agent would read the wrong thing with every log
 * line still saying success. So the merged adapter:
 *
 *   - LISTS the name once (it is declared, and hiding it would be its own lie);
 *   - REFUSES to answer it with a coded `DEBUG_NAME_COLLISION` naming BOTH
 *     sources, at `state()` / `invoke()` and per-key inside `stateAll()`;
 *   - reports the collisions to the caller ({@link MergedDebugAdapters}) so the
 *     mount can say so out loud where a person will see it, instead of the
 *     refusal waiting to be discovered by whoever calls the name first.
 *
 * The refusal is per-NAME, not per-mount, deliberately: killing the mount would
 * cost a user their whole game to protect against one ambiguous read, and the
 * per-name refusal already gives the same guarantee — nothing is silently
 * shadowed — with none of the collateral.
 */

import type {
  DebugAdapter,
  DebugCommandInfo,
  TickStampedEvent,
} from '@volter/editor-project/adapter/system-adapter';
import { DebugError } from '../../debug-registry';

/** One feeder, with the words a collision message names it by. */
export interface DebugAdapterSource {
  /** How this projection is named to a reader — its provenance, in prose. */
  readonly label: string;
  /** `null` when this feeder projected nothing (the honest floor both return). */
  readonly adapter: DebugAdapter | null;
}

export interface MergedDebugAdapters {
  /** The one door, or `null` when no feeder projected anything. */
  readonly adapter: DebugAdapter | null;
  /** One sentence per colliding name, naming both sources. Empty is the norm. */
  readonly collisions: readonly string[];
}

function collisionError(name: string, labels: readonly string[]): DebugError {
  return new DebugError(
    'DEBUG_NAME_COLLISION',
    `"${name}" is declared by more than one source (${labels.join(' and ')}) — refusing to ` +
      'answer rather than picking one silently. Rename it in whichever source you own.',
    { name, sources: [...labels] },
  );
}

/** Names each feeder claims, in listing order, de-duplicated within a feeder. */
function claimedNames(
  sources: readonly DebugAdapterSource[],
  face: 'state' | 'command',
): {
  order: string[];
  labelsByName: Map<string, string[]>;
} {
  const order: string[] = [];
  const labelsByName = new Map<string, string[]>();
  for (const source of sources) {
    if (!source.adapter) continue;
    const names =
      face === 'state'
        ? source.adapter.providers().map((provider) => provider.name)
        : source.adapter.commands().map((command) => command.name);
    for (const name of new Set(names)) {
      if (!labelsByName.has(name)) {
        labelsByName.set(name, []);
        order.push(name);
      }
      labelsByName.get(name)?.push(source.label);
    }
  }
  return { order, labelsByName };
}

/**
 * Fold every projection of one mount onto a single {@link DebugAdapter}.
 *
 * `events()` concatenates, because an event ring is append-only and two rings
 * genuinely both happened — there is no name to collide on. Everything else is
 * name-keyed and therefore goes through the collision rule above.
 */
export function mergeDebugAdapters(sources: readonly DebugAdapterSource[]): MergedDebugAdapters {
  const live = sources.filter((source) => source.adapter !== null);
  if (live.length === 0) return { adapter: null, collisions: [] };
  if (live.length === 1) return { adapter: live[0]!.adapter, collisions: [] };

  const providers = claimedNames(live, 'state');
  const commands = claimedNames(live, 'command');

  const collisions: string[] = [];
  for (const [face, claimed] of [
    ['state provider', providers],
    ['command', commands],
  ] as const) {
    for (const name of claimed.order) {
      const labels = claimed.labelsByName.get(name) ?? [];
      if (labels.length > 1) {
        collisions.push(`${face} "${name}" is declared by ${labels.join(' and ')}`);
      }
    }
  }

  /** The feeder that owns `name`, or a thrown collision error when several do. */
  const ownerOf = (
    claimed: ReturnType<typeof claimedNames>,
    name: string,
    face: 'state' | 'command',
  ): DebugAdapter | null => {
    const labels = claimed.labelsByName.get(name);
    if (!labels) return null;
    if (labels.length > 1) throw collisionError(name, labels);
    return (
      live.find((source) => {
        const owned =
          face === 'state'
            ? source.adapter?.providers().some((provider) => provider.name === name)
            : source.adapter?.commands().some((command) => command.name === name);
        return owned === true;
      })?.adapter ?? null
    );
  };

  return {
    adapter: {
      providers: () =>
        live.flatMap((source) => source.adapter?.providers() ?? []).filter(uniqueByName()),

      state: (name: string): unknown => {
        const owner = ownerOf(providers, name, 'state');
        if (!owner) {
          throw new DebugError(
            'STATE_PROVIDER_NOT_FOUND',
            `No state provider named "${name}" is declared by this game.`,
            { registered: providers.order },
          );
        }
        return owner.state(name);
      },

      stateAll: (): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const name of providers.order) {
          try {
            out[name] = ownerOf(providers, name, 'state')?.state(name);
          } catch (err) {
            out[name] = { __error: String(err) };
          }
        }
        return out;
      },

      commands: (): DebugCommandInfo[] =>
        live.flatMap((source) => source.adapter?.commands() ?? []).filter(uniqueByName()),

      invoke: async (name: string, args: unknown[]): Promise<unknown> => {
        const owner = ownerOf(commands, name, 'command');
        if (!owner) {
          throw new DebugError(
            'DEBUG_COMMAND_NOT_REGISTERED',
            `No command named "${name}" is declared by this game.`,
            { registered: commands.order },
          );
        }
        return owner.invoke(name, args);
      },

      events: (sinceSeq?: number): TickStampedEvent[] =>
        live.flatMap((source) => source.adapter?.events(sinceSeq) ?? []),
    },
    collisions,
  };
}

/** Keep the FIRST listing of each name — the merged listing advertises a name
 *  once, whatever `state()`/`invoke()` then decide to do with it. */
function uniqueByName<T extends { name: string }>(): (value: T) => boolean {
  const seen = new Set<string>();
  return (value) => {
    if (seen.has(value.name)) return false;
    seen.add(value.name);
    return true;
  };
}
