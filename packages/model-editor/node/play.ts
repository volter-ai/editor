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
    if (value !== undefined) commandArgs = { count: Number(value) };
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
  return editor.command(`volter.model-play.${verb}`, commandArgs);
}
