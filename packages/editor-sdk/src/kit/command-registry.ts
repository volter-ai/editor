/**
 * CONTRIBUTED COMMANDS — the registry behind `@volter/editor-sdk/commands`.
 * `command-listener.ts` asks here before its own table, so a package's verb
 * is answered by the package's handler with the host's relay, ack and
 * status-derivation machinery unchanged around it. The rows are also what the
 * loader reports to the server (`/__editor/contributed-commands`), which
 * sizes its wait per verb from them.
 */
import type {
  CommandContribution,
  CommandDerivedRefresh,
  CommandSpec,
  ContributedCommandRow,
} from '@volter/editor-sdk/commands';
import {
  DEFAULT_RELAY_COMMAND_TIMEOUT_MS,
  isRelayCommandType,
} from '@volter/editor-sdk/session/command-table';

interface Registered {
  readonly entryPath: string;
  readonly spec: CommandSpec;
}
const registered = new Map<string, Registered>();

/**
 * Register a contribution's commands. Every type is checked before any is
 * claimed, so a module with one bad row registers nothing. Returns the
 * unregister.
 */
export function registerContributedCommands(
  entryPath: string,
  commands: CommandContribution['commands'],
): () => void {
  const types = Object.keys(commands);
  for (const type of types) {
    if (isRelayCommandType(type))
      throw new Error(`command "${type}" is the editor's own; a contribution cannot redefine it.`);
    const other = registered.get(type);
    if (other) throw new Error(`command "${type}" is already contributed by ${other.entryPath}.`);
    const spec = commands[type];
    if (typeof spec?.handle !== 'function')
      throw new Error(`command "${type}" must carry a \`handle\` function.`);
    if (spec.timeoutMs !== undefined && !(Number.isFinite(spec.timeoutMs) && spec.timeoutMs > 0))
      throw new Error(`command "${type}" has a timeoutMs that is not a positive number.`);
  }
  for (const type of types) registered.set(type, { entryPath, spec: commands[type]! });
  return () => {
    for (const type of types)
      if (registered.get(type)?.entryPath === entryPath) registered.delete(type);
  };
}

export function contributedCommand(type: unknown): CommandSpec | null {
  return typeof type === 'string' ? (registered.get(type)?.spec ?? null) : null;
}


export function contributedCommandDerivedRefresh(type: unknown): CommandDerivedRefresh | null {
  const spec = contributedCommand(type);
  return spec ? (spec.derivedRefresh ?? 'always') : null;
}

/** Every registered row, as reported to the server. */
export function contributedCommandRows(): ContributedCommandRow[] {
  return [...registered.entries()].map(([type, { spec }]) => ({
    type,
    timeoutMs: spec.timeoutMs ?? DEFAULT_RELAY_COMMAND_TIMEOUT_MS,
    derivedRefresh: spec.derivedRefresh ?? 'always',
  }));
}
