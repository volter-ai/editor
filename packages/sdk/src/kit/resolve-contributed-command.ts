import type { CommandSpec } from '@volter/sdk/commands';
import { isRelayCommandType } from '@volter/sdk/session/command-table';
import { contributedCommand } from '@volter/sdk/kit/command-registry';

/** A listener can attach before the presentation-deferred contribution pass.
 * A requested package command needs that pass now; absence is only meaningful
 * after the current project's contributions have finished installing. */
export async function resolveContributedCommand(type: unknown): Promise<CommandSpec | null> {
  const found = contributedCommand(type);
  if (found || typeof type !== 'string' || isRelayCommandType(type)) return found;
  await (await import('@volter/sdk/kit/initial-project')).projectBootstrapSettled();
  await (await import('@volter/sdk/kit/tool-loader')).refreshProjectToolContributions();
  return contributedCommand(type);
}
