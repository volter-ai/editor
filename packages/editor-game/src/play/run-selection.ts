/**
 * WHAT PLAY RUNS BESIDE THE HOST: the run configuration the person chose (kept per checkout in the
 * project-local document, the way an IDE remembers its launch configuration), started before the
 * game mounts and stopped with it. One module, so the Play button and the relayed `play` verb start
 * the same thing — a multiplayer game's `play + server` brings its room server up either way.
 */

import { editorHost } from '@volter/editor-sdk/host';
import {
  type ConfigurationStatus,
  listConfigurations,
  startConfiguration,
  stopConfiguration,
} from '../host/api/configurations';
import { setDesiredExtraInstances } from './play-mode';

/** The implicit configuration: mount every root in the host. */
export const PLAY_CONFIGURATION = 'play';
const RUN_SELECTION_SECTION = 'runSelection';

/** The configuration the person picked, or null when they have not. */
export function chosenRunConfiguration(): string | null {
  return editorHost().projectLocalState.read<string>(RUN_SELECTION_SECTION) ?? null;
}

export function chooseRunConfiguration(id: string): void {
  editorHost().projectLocalState.write(RUN_SELECTION_SECTION, id);
}

/**
 * What Play starts: the person's pick, else the first declared compound that runs the host
 * (`play + server`), as an IDE opens on its first launch configuration; a project with none plays
 * alone.
 */
export function selectedRunConfiguration(
  declared: readonly ConfigurationStatus[],
  chosen: string | null = chosenRunConfiguration(),
): string {
  return (
    chosen ??
    declared.find((c) => c.role === 'run' && c.kind === 'compound' && c.run?.includes(PLAY_CONFIGURATION))?.id ??
    PLAY_CONFIGURATION
  );
}

export type RunStart =
  | { readonly ok: true; readonly started: string | null }
  | { readonly ok: false; readonly title: string; readonly detail: string };

let running: string | null = null;

/** Start the selected configuration's processes (nothing for bare `play`), and say whether Play may
 *  go on. */
export async function startSelectedRunConfiguration(): Promise<RunStart> {
  const declared = await listConfigurations().catch(() => [] as ConfigurationStatus[]);
  const id = selectedRunConfiguration(declared);
  const selected = declared.find((c) => c.id === id);
  if (!selected || id === PLAY_CONFIGURATION) return { ok: true, started: null };
  let outcome: Awaited<ReturnType<typeof startConfiguration>>;
  try {
    outcome = await startConfiguration(selected.id);
  } catch (error) {
    return { ok: false, title: `Run "${selected.id}"`, detail: error instanceof Error ? error.message : String(error) };
  }
  if (!outcome.ready) {
    return {
      ok: false,
      title: `Run "${selected.id}" is not ready`,
      detail: Object.entries(outcome.logs)
        .map(([name, lines]) => `${name}: ${lines.slice(-3).join(' | ') || 'no output'}`)
        .join('\n'),
    };
  }
  if (selected.kind === 'compound' && selected.instances != null) {
    setDesiredExtraInstances(Math.max(0, selected.instances - 1));
  }
  running = selected.id;
  return { ok: true, started: selected.id };
}

/** Stop what the last Play started beside the host. */
export async function stopStartedRunConfiguration(): Promise<void> {
  const id = running;
  running = null;
  if (!id) return;
  await stopConfiguration(id).catch((error: unknown) =>
    editorHost().notify({
      tone: 'error',
      title: `Stop "${id}"`,
      detail: error instanceof Error ? error.message : String(error),
    }),
  );
}
