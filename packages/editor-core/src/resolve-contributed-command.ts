import type { CommandSpec } from '@volter/editor-sdk/commands';
import { isRelayCommandType } from '@volter/editor-sdk/session/command-table';
import { contributedCommand } from '@volter/editor-sdk/kit/command-registry';

/** A listener can attach before the presentation-deferred contribution pass.
 * A requested package command needs that pass now; absence is only meaningful
 * after the current project's contributions have finished installing. */
export async function resolveContributedCommand(type: unknown): Promise<CommandSpec | null> {
  const found = contributedCommand(type);
  if (found || typeof type !== 'string' || isRelayCommandType(type)) return found;
  await (await import('./initial-project')).projectBootstrapSettled();
  await (await import('./tool-loader')).refreshProjectToolContributions();
  return contributedCommand(type);
}
