/**
 * `play <verb>` — DRIVE THE GAME PANEL from the shell: the same Play, Pause, Step, Speed and
 * Restart the person clicks in Game mode, through the same calls.
 *
 * Nothing here is a second implementation. Each verb is one command,
 * `volter.model-play.<verb>`, which the Game panel's own package publishes as a view verb
 * (`@volter/editor-blender`'s `blender-game-panel.tsx`) over the Play tool's run
 * (`@volter/editor-model-play`), so an agent pausing a game and a person pausing it are the same
 * call, and `eval` reaches it as `await editor.command('volter.model-play.pause')`. Every verb
 * prints the panel's state afterwards; a control lands on the next drawn frame, so `play state`
 * again reads its effect (a step's tick, a resumed clock).
 *
 * The verbs act on the model document on screen, or the one `--document <id>` names (the same
 * id `play-log --document` takes). Speed takes the panel's own steps — 0.25, 0.5,
 * 1, 2, 4 — written bare or with an `x`. `play autoplay on|off` is the panel's Autoplay toggle:
 * on lets the game's own bot (`play.autoplay` in its play script) drive until a person presses a
 * key or clicks in the game; it is off at every Play and Restart.
 */
import { connect } from '@volter/editor-live';

export const PLAY_USAGE = 'play [state] | play play|stop|pause|resume|restart | play step [count] | play speed <0.25|0.5|1|2|4> | play mode [game|movie] | play autoplay on|off  [--document <id>]';

const BARE = new Set(['state', 'play', 'stop', 'pause', 'resume', 'restart']);

export async function play(args: readonly string[], document?: string): Promise<unknown> {
  const [verb = 'state', value, ...rest] = args;
  const usage = (): never => { throw new Error(`Usage: volter-model-editor ${PLAY_USAGE}`); };
  if (rest.length > 0) usage();
  let commandArgs: Record<string, unknown> | undefined;
  if (BARE.has(verb)) {
    if (value !== undefined) usage();
  } else if (verb === 'step') {
    // Passed as typed: the verb parses it, and names what it was given when it is not a count.
    if (value !== undefined) commandArgs = { count: value };
  } else if (verb === 'speed') {
    if (value === undefined) usage();
    commandArgs = { speed: value };
  } else if (verb === 'autoplay') {
    if (value !== 'on' && value !== 'off') usage();
    commandArgs = { on: value === 'on' };
  } else if (verb === 'mode') {
    if (value !== undefined) commandArgs = { mode: value };
  } else usage();
  if (document !== undefined) commandArgs = { ...commandArgs, document };
  const { editor } = await connect();
  const answer = await editor.command(`volter.model-play.${verb}`, commandArgs);
  if (verb !== 'play' && verb !== 'restart') return answer;
  return startedOrRefused(answer, (args) => editor.command('volter.model-play.state', args));
}

/** How long `play play` / `play restart` wait for the game to start: a cold rendered stage
 *  compiles its shaders on the first draw, which takes seconds, never this long. */
const START_BUDGET_MS = 30_000;

interface PlayState {
  readonly document?: string;
  readonly playing?: boolean;
  readonly clock?: { readonly failure?: string | null; readonly running?: boolean };
}

/**
 * A PLAY THAT DID NOT START IS A FAILED COMMAND. The verb answers the moment Play is switched
 * on, and the game starts frames later, so until 2026-10-06 `play play` printed `playing: true`
 * and exited 0 for a script that never started — the reason only a toast in the tab and a line
 * in the play log. So the run is read until it says: `running` (the game's first update ran),
 * or `failure` (why not), or Play went off. A refusal exits 1 with the reason and where to read
 * more. A tool that predates `running` can only be read for a failure.
 */
async function startedOrRefused(first: unknown, state: (args: Record<string, unknown>) => Promise<unknown>): Promise<unknown> {
  let current = first as PlayState;
  const documentId = current.document;
  const args = documentId === undefined ? {} : { document: documentId };
  const knowsRunning = typeof current.clock?.running === 'boolean';
  const deadline = Date.now() + (knowsRunning ? START_BUDGET_MS : 3_000);
  for (;;) {
    const failure = current.clock?.failure;
    if (typeof failure === 'string' && failure !== '')
      throw new Error(
        `Play did not start: ${failure}\n` +
          `The play log has the entry: volter-model-editor play-log --kind script-error${documentId ? ` --document ${documentId}` : ''}`,
      );
    if (current.playing === false) throw new Error('Play switched itself off before a game started; `volter-model-editor console` says why.');
    if (current.clock?.running === true || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
    current = (await state(args)) as PlayState;
  }
  if (knowsRunning && current.clock?.running !== true)
    throw new Error(
      `Play is on, but no game has started after ${START_BUDGET_MS / 1000}s and nothing has said why. ` +
        '`volter-model-editor play state` reads it again; `volter-model-editor console` has what the tab reported.',
    );
  return current;
}
