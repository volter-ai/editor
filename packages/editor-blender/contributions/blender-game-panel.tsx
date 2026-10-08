/**
 * THE GAME PANEL — what the bottom area shows in GAME mode (`../src/play-mode.ts`), in place of
 * the Timeline (owner, 2026-10-06: "In game mode, the bottom panel is replaced with a game
 * version of something like that. Perhaps that's where the 'autoplay' controls and info will
 * live instead").
 *
 * ## One Play, here
 *
 * The confusion it ends was two Plays on one screen: the header's (the play script) and the
 * Timeline's (the file's animation). A mode now chooses which one is shown. In Animation mode the
 * Timeline's transport is the one shown; in Game mode this panel's Play is, and the Timeline is
 * not mounted. A game started in Game mode keeps running in Animation mode. The 3D viewport's header carries neither (`blender-header-menus.tsx`
 * is its menus alone). Escape still stops a game, from the stage, as before.
 *
 * ## The Game | Animation switch is the bottom area's own
 *
 * Switching modes swaps this area and nothing else, so the switch stands at the leading edge of
 * the area's header row, in place of its title — in this panel and in the Timeline alike
 * ({@link PlayModeSwitch}), so the person switches back from whichever one is showing. It is
 * drawn only when a Play tool is installed and a model is on screen; otherwise there is nothing
 * to switch and the Timeline keeps its title.
 *
 * ## It is tall enough to read
 *
 * Blender's Timeline strip (`model.layout.ts`'s measured 0.0719 — 63 px of an 880-px column)
 * showed this panel's play log as one clipped line. So Game mode asks the area for
 * {@link GAME_PANEL_RATIO} (`setWorkspaceAreaRatio`, by the bottom area's document) and Animation
 * mode gives Blender's back: each switch stands the area up at its mode's size, as a workspace
 * switch does, and the sash stays the person's in between.
 *
 * ## What it drives is the Play tool's own run
 *
 * Every control here is a call on the Play tool's door (`DocumentPlayExtension` and its
 * `transport`, `@volter/editor-sdk/kit/document-play-extension`), the same calls the runner
 * reads every frame (`@volter/editor-model-play`'s `model-play.ts`), so Pause freezes the
 * simulation itself — the `dt` the script is handed — and the clock drawn here is that
 * simulation's: the seconds the script was given and the updates it ran. The verbs below are
 * the same calls behind command ids (`volter.model-play.<verb>`), which is how an agent drives
 * exactly what the person does: `cyclotron play pause`, or
 * `await editor.command('volter.model-play.pause')` under `eval`.
 *
 * ## Autoplay is the editor's switch, and the person always wins
 *
 * A game offers its bot (`play.autoplay(controller)` in its play script); whether the bot drives
 * is this panel's toggle (or `volter.model-play.autoplay`), never a game key, and it is off at
 * every Play and Restart. A person's key or pointer in the game turns it off on the spot (the
 * Play tool's runner does that), so the driver line reads "You're driving" and stays so until
 * someone switches the bot on again. A game offers its bot only once its play script runs, so
 * the panel SAYS when there is none to switch: stopped, "available once the game is running"
 * (and pressing Autoplay then arms it for the next start); running, "No autoplay — this game
 * doesn't provide a bot". `play state` carries the same reason as `autoplay.why`.
 *
 * ## The play log, live
 *
 * The right of the panel is the run's play log as it is written (the Play tool's `log` door):
 * the newest entries of this document, newest at the bottom, filtered by kind. It follows the
 * newest entry until the person scrolls up to read, and follows again once they scroll back to
 * the bottom.
 *
 * ## It is drawn as the Timeline is
 *
 * Same area, same header band, the same widget table (`blender-timeline-geometry.ts`), so the
 * bottom of the screen changes its job and not its family. The pressed speed cell takes the
 * playhead's blue, which is Blender's own selected-widget colour in the same theme.
 */
import { blenderSkin } from './blender-runtime-skin';
import { registerViewVerbs } from '@volter/editor-sdk/views';
import {
  type DocumentPlayAutoplay,
  type DocumentPlayClock,
  type DocumentPlayExtension,
  type DocumentPlayLog,
  type DocumentPlayTransport,
  documentPlayExtension,
  subscribeDocumentPlayExtensions,
} from '@volter/editor-sdk/kit/document-play-extension';
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  type ModelPlayMode,
  modelDocumentSource,
  modelPlayMode,
  playModeOf,
  playModeVersion,
  servedModelDocument,
  setChosenPlayMode,
  subscribePlayMode,
} from '../src/play-mode';
import { HEADER_HEIGHT, TIMELINE_CHROME, TIMELINE_THEME } from './blender-timeline-geometry';

/**
 * THE GAME PANEL'S SHARE OF THE COLUMN, asked of the bottom area in Game mode. A 1000-px window
 * gives the centre column about 935 px, and 0.2 of it is 187: the 26-px header, the status
 * band's padding, the log's own row (one widget, 20 px) and seven 12-px log lines at their
 * 1.45 line height with room to spare. Taller windows show more lines; the sash still moves.
 */
export const GAME_PANEL_RATIO = 0.2;

const STILL: DocumentPlayClock = { time: 0, tick: 0, paused: false, speed: 1 };
const NO_BOT: DocumentPlayAutoplay = { on: false, available: false, by: null };

function extension(): DocumentPlayExtension | null {
  return documentPlayExtension('model');
}

/**
 * FLIP A DOCUMENT BETWEEN GAME AND ANIMATION. A running game keeps running when Animation is
 * chosen: the animation editors then show what it animates. The file's animation playing in the
 * Timeline when Game is chosen is paused (Game has no Timeline transport).
 */
export function switchPlayMode(documentId: string, mode: ModelPlayMode): void {
  if (mode === 'game' && blenderSkin.transport?.snapshot().playbackState === 'playing') blenderSkin.transport.pause();
  setChosenPlayMode(documentId, mode);
}

// ---------------------------------------------------------------------------------------------
// THE VERBS — `volter.model-play.<verb>`, the panel's controls behind command ids.
// ---------------------------------------------------------------------------------------------

/** Which document a verb acts on: the one it names, else the model document on screen. */
function verbDocument(args: Record<string, unknown> | undefined): string {
  const named = args?.['document'];
  if (typeof named === 'string' && named !== '') return named;
  const served = servedModelDocument();
  if (served === null) throw new Error('No model document is open; open one, or name it with `document`.');
  return served;
}

function verbExtension(): DocumentPlayExtension & { transport: NonNullable<DocumentPlayExtension['transport']> } {
  const found = extension();
  if (found === null)
    throw new Error('This project has no Play tool: `cyclotron add-play` adds @volter/editor-model-play.');
  if (found.transport === undefined)
    throw new Error('The installed Play tool has no pause, step, speed or restart; update @volter/editor-model-play.');
  return found as DocumentPlayExtension & { transport: NonNullable<DocumentPlayExtension['transport']> };
}

/** THE ONE REPORT every verb answers with — what the panel draws, as data. A control's effect
 *  lands on the next drawn frame (a step runs there), so read `state` again to see it. */
function gameState(documentId: string): unknown {
  const found = extension();
  const blend = modelDocumentSource(documentId);
  return {
    document: documentId,
    mode: modelPlayMode(documentId),
    playing: found?.playing(documentId) ?? false,
    script: blend === undefined || found?.scriptPath === undefined ? null : {
      path: found.scriptPath(blend),
      exists: found.hasScript?.(blend) ?? null,
    },
    clock: found?.transport?.clock(documentId) ?? STILL,
    speeds: found?.transport?.speeds ?? [],
    autoplay: autoplayState(documentId),
  };
}

/** Who drives a playing game: the bot while autoplay is on; the person once their key or pointer
 *  has reached the game this run; otherwise nobody — the game runs on no input. A tool that
 *  predates `person` cannot say, and counts autoplay off as the person driving, as it always did. */
function driverOf(playing: boolean, autoplay: DocumentPlayAutoplay): 'bot' | 'person' | 'none' | null {
  if (!playing) return null;
  if (autoplay.on) return 'bot';
  return autoplay.person === false ? 'none' : 'person';
}

/** The bot's switch and who drives (`driverOf`), null when nothing plays. `by` is who made the
 *  last change (`takeover`: a person's key or pointer; `limit`: the run's seconds spent); `state`
 *  what the bot says it is doing; `why` says why there is no bot to switch, null when there is one. */
function autoplayState(documentId: string): unknown {
  const found = extension();
  const autoplay = found?.transport?.autoplay?.(documentId) ?? NO_BOT;
  const playing = found?.playing(documentId) ?? false;
  const why = autoplayWhy(playing, found?.transport?.clock(documentId) ?? STILL, autoplay);
  return { ...autoplay, driver: driverOf(playing, autoplay), why };
}

/**
 * WHY THERE IS NO BOT TO SWITCH ON: `not-running` while stopped or still starting (a game offers
 * its bot only once its play script runs), `no-bot` once it runs without one, null when it offers
 * one. A tool that predates `running` counts a playing run without a failure as running.
 */
function autoplayUnavailable(playing: boolean, clock: DocumentPlayClock, autoplay: DocumentPlayAutoplay): 'not-running' | 'no-bot' | null {
  if (autoplay.available) return null;
  return playing && (clock.running ?? !clock.failure) ? 'no-bot' : 'not-running';
}

/** {@link autoplayUnavailable} as the CLI says it. */
function autoplayWhy(playing: boolean, clock: DocumentPlayClock, autoplay: DocumentPlayAutoplay): string | null {
  switch (autoplayUnavailable(playing, clock, autoplay)) {
    case null: return null;
    case 'no-bot': return 'No autoplay — this game doesn’t provide a bot: its play script registers none with play.autoplay(controller).';
    case 'not-running': return !playing
      ? 'Autoplay is available once the game is running, and nothing is playing; `play` starts it.'
      : `Autoplay is available once the game is running, and it is not running yet${clock.failure ? `: ${clock.failure}` : '.'}`;
  }
}

function requirePlaying(documentId: string, verb: string): void {
  if (!verbExtension().playing(documentId))
    throw new Error(`Nothing is playing in ${documentId}, so there is nothing to ${verb}; \`play\` starts it.`);
}

registerViewVerbs({
  view: 'model-play',
  title: 'Game',
  verbs: [
    { id: 'state', run: (args) => gameState(verbDocument(args)) },
    {
      id: 'mode',
      run: (args) => {
        const documentId = verbDocument(args);
        const mode = args?.['mode'] ?? args?.['to'];
        if (mode !== undefined) {
          const asked = playModeOf(mode);
          if (asked === null) throw new Error(`mode is \`game\` or \`animation\`; got ${String(mode)}.`);
          switchPlayMode(documentId, asked);
        }
        return gameState(documentId);
      },
    },
    {
      id: 'game-mode',
      title: 'Game: Switch to Game Mode',
      run: (args) => { const documentId = verbDocument(args); switchPlayMode(documentId, 'game'); return gameState(documentId); },
    },
    {
      id: 'animation-mode',
      title: 'Game: Switch to Animation Mode',
      run: (args) => { const documentId = verbDocument(args); switchPlayMode(documentId, 'animation'); return gameState(documentId); },
    },
    {
      // PLAY IS GAME MODE'S CONTROL, so asking for it puts the document in Game mode: the person
      // then sees the panel that owns the run an agent started.
      id: 'play',
      title: 'Game: Play',
      run: (args) => {
        const documentId = verbDocument(args);
        const found = verbExtension();
        if (modelPlayMode(documentId) !== 'game') switchPlayMode(documentId, 'game');
        if (!found.playing(documentId)) found.setPlaying(documentId, true);
        return gameState(documentId);
      },
    },
    {
      id: 'stop',
      title: 'Game: Stop',
      run: (args) => {
        const documentId = verbDocument(args);
        verbExtension().setPlaying(documentId, false);
        return gameState(documentId);
      },
    },
    {
      id: 'pause',
      title: 'Game: Pause',
      run: (args) => {
        const documentId = verbDocument(args);
        requirePlaying(documentId, 'pause');
        verbExtension().transport.setPaused(documentId, true);
        return gameState(documentId);
      },
    },
    {
      id: 'resume',
      title: 'Game: Resume',
      run: (args) => {
        const documentId = verbDocument(args);
        requirePlaying(documentId, 'resume');
        verbExtension().transport.setPaused(documentId, false);
        return gameState(documentId);
      },
    },
    {
      // `count` steps queue and run one per drawn frame, so each is seen.
      id: 'step',
      title: 'Game: Step One Tick',
      run: (args) => {
        const documentId = verbDocument(args);
        requirePlaying(documentId, 'step');
        const { transport } = verbExtension();
        if (!transport.clock(documentId).paused) throw new Error('step runs one tick of a PAUSED game; `pause` first.');
        const raw = args?.['count'];
        const count = raw === undefined ? 1 : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : typeof raw === 'number' ? raw : Number.NaN;
        if (!Number.isInteger(count) || count < 1 || count > 600) throw new Error(`step's \`count\` is a whole number from 1 to 600; got ${JSON.stringify(raw)}.`);
        for (let index = 0; index < count; index++) transport.step(documentId);
        return gameState(documentId);
      },
    },
    {
      id: 'speed',
      run: (args) => {
        const documentId = verbDocument(args);
        const { transport } = verbExtension();
        const raw = args?.['speed'] ?? args?.['to'];
        const speed = typeof raw === 'string' ? Number(raw.replace(/x$/i, '')) : Number(raw);
        if (!transport.speeds.includes(speed))
          throw new Error(`speed is one of ${transport.speeds.join(', ')} (simulation seconds per real second); got ${JSON.stringify(raw)}.`);
        transport.setSpeed(documentId, speed);
        return gameState(documentId);
      },
    },
    {
      // THE EDITOR'S AUTOPLAY SWITCH: on drives one of the game's bot behaviours (`play.autoplay`)
      // for at most `for` simulation seconds, off hands the game back to the person. Off at every
      // Play and Restart. `behavior` is required when the bot offers several.
      id: 'autoplay',
      run: (args) => {
        const documentId = verbDocument(args);
        const raw = args?.['on'];
        const on = raw === true || raw === 'on' || raw === 'true' ? true
          : raw === false || raw === 'off' || raw === 'false' ? false : undefined;
        if (on === undefined) throw new Error(`autoplay's \`on\` is true or false (\`play autoplay on|off\`); got ${String(raw)}.`);
        const behavior = typeof args?.['behavior'] === 'string' && args['behavior'] !== '' ? args['behavior'] : null;
        const rawLimit = args?.['for'] ?? args?.['limit'];
        const limit = rawLimit === undefined || rawLimit === null ? null : Number(rawLimit);
        if (limit !== null && !(Number.isFinite(limit) && limit > 0))
          throw new Error(`autoplay's \`for\` is a positive number of simulation seconds; got ${JSON.stringify(rawLimit)}.`);
        const found = verbExtension();
        const { transport } = found;
        if (transport.setAutoplay === undefined)
          throw new Error('The installed Play tool has no autoplay; update @volter/editor-model-play.');
        // Refused with the reason, stopped or no bot, as `play state`'s `autoplay.why` gives it.
        const why = on ? autoplayWhy(found.playing(documentId), transport.clock(documentId), transport.autoplay?.(documentId) ?? NO_BOT) : null;
        if (why !== null) throw new Error(why);
        transport.setAutoplay(documentId, on, 'cli', on ? { behavior, limit } : undefined);
        return gameState(documentId);
      },
    },
    {
      id: 'restart',
      title: 'Game: Restart',
      run: (args) => {
        const documentId = verbDocument(args);
        const found = verbExtension();
        if (modelPlayMode(documentId) !== 'game') switchPlayMode(documentId, 'game');
        found.transport.restart(documentId);
        return gameState(documentId);
      },
    },
  ],
});

// ---------------------------------------------------------------------------------------------
// THE PANEL
// ---------------------------------------------------------------------------------------------

/** A panel button keeps the keyboard where it was. Focus left on a button would turn the
 *  player's next Space — a jump, in most games — into a second click on Pause. */
const keepFocus = (event: MouseEvent): void => event.preventDefault();

/** A 12-px mark in the widget's ink, the way the Timeline header draws its transport. */
function mark(path: string): ReactNode {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true">
      <path d={path} fill={TIMELINE_CHROME.widgetText} />
    </svg>
  );
}
const MARKS = {
  play: 'M3 2l7 4-7 4z',
  stop: 'M2.5 2.5h7v7h-7z',
  pause: 'M3 2h2v8H3zM7 2h2v8H7z',
  step: 'M10 2H8.5v8H10zM2.5 2v8L7.5 6z',
  restart: 'M6 1.5V0l3 2.25-3 2.25V3a3 3 0 1 0 3 3h1.5A4.5 4.5 0 1 1 6 1.5z',
} as const;

function GameButton({ label, testId, disabled, pressed, wide, onClick, children }: {
  readonly label: string;
  readonly testId: string;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly wide?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  const unit = TIMELINE_CHROME.unit;
  return (
    <button
      type="button"
      data-testid={testId}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={keepFocus}
      onClick={onClick}
      style={{
        minWidth: unit,
        height: unit,
        padding: wide ? '0 6px' : 0,
        border: `1px solid ${TIMELINE_CHROME.widgetOutline}`,
        background: pressed ? TIMELINE_THEME.playhead : TIMELINE_CHROME.widget,
        color: TIMELINE_CHROME.widgetText,
        font: 'inherit',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

/**
 * GAME | MOVIE, at the leading edge of the bottom area's header row, in the Game panel and the
 * Timeline alike (the head of this file says why it is here). Two joined cells with the current
 * one lit in the playhead's blue — the same widgets as the transport beside it, at the same
 * height, so it reads as one of this row's controls and not a smaller one. It serves the model
 * document the bottom area serves. With no Play tool installed, or no model on screen, there is
 * nothing to switch, and the row keeps its `title` instead.
 */
export function PlayModeSwitch({ title }: { readonly title: string }) {
  useSyncExternalStore(subscribePlayMode, playModeVersion, playModeVersion);
  const found = useSyncExternalStore(subscribeDocumentPlayExtensions, extension, () => null);
  const documentId = servedModelDocument();
  if (found === null || documentId === null) return <span style={{ color: TIMELINE_CHROME.text }}>{title}</span>;
  const mode = modelPlayMode(documentId);
  const cell = (value: ModelPlayMode, label: string, tip: string) => (
    <GameButton
      testId={`model-play-mode-${value}`}
      label={tip}
      pressed={mode === value}
      wide
      onClick={() => switchPlayMode(documentId, value)}
    >
      {label}
    </GameButton>
  );
  return (
    <div role="group" aria-label="Game or Animation" data-testid="model-play-mode" style={{ display: 'flex' }}>
      {cell('game', 'Game', 'Game: this area is the Game panel, with Play, pause, step, speed, restart and autoplay')}
      {cell('animation', 'Animation', 'Animation: this area is Blender’s animation editors (Timeline, Action Editor, NLA); a running game keeps running and they show what it animates')}
    </div>
  );
}

/** Simulation seconds as a clock reads them: `m:ss.ss`, hours only when there are some. */
function clockText(seconds: number): string {
  const whole = Math.floor(seconds / 60);
  const rest = (seconds - whole * 60).toFixed(2).padStart(5, '0');
  if (whole < 60) return `${whole}:${rest}`;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}:${rest}`;
}

function speedText(speed: number): string {
  return `${speed}×`;
}

export function BlenderGamePanel() {
  useSyncExternalStore(subscribePlayMode, playModeVersion, playModeVersion);
  const documentId = servedModelDocument();
  const found = useSyncExternalStore(subscribeDocumentPlayExtensions, extension, () => null);
  const transport = found?.transport;
  const playing = documentId !== null && (found?.playing(documentId) ?? false);
  const subscribeClock = useCallback(
    (listener: () => void) => transport?.subscribeClock(listener) ?? (() => {}),
    [transport],
  );
  const clock = useSyncExternalStore(
    subscribeClock,
    () => (documentId !== null && transport ? transport.clock(documentId) : STILL),
    () => STILL,
  );
  // Its changes are announced with the clock's.
  const autoplay = useSyncExternalStore(
    subscribeClock,
    () => (documentId !== null && transport?.autoplay ? transport.autoplay(documentId) : NO_BOT),
    () => NO_BOT,
  );
  const blend = documentId === null ? undefined : modelDocumentSource(documentId);
  const scriptPath = blend === undefined ? null : (found?.scriptPath?.(blend) ?? null);
  const scriptExists = blend === undefined ? null : (found?.hasScript?.(blend) ?? null);
  const canPlay = documentId !== null && found !== null;
  const status = documentId === null
    ? 'No model document is open.'
    : scriptExists === false && scriptPath !== null
      ? `No play script yet — Play runs ${scriptPath}. \`cyclotron add-play\` adds an example.`
      : playing && clock.failure
        // The run plays but no game runs (`DocumentPlayClock.failure`): say so, not "Playing".
        ? `Not running — ${clock.failure.replace(/\.$/, '')}. Restart (or save the script) to retry, or Stop.`
        : playing
        ? `${clock.paused ? 'Paused' : 'Playing'} ${scriptPath ?? ''}`.trim()
        : scriptPath === null ? 'Stopped.' : `Stopped · Play runs ${scriptPath}`;
  return (
    <div
      data-testid="blender-game-panel"
      data-playing={playing || undefined}
      data-paused={(playing && clock.paused) || undefined}
      data-failed={(playing && Boolean(clock.failure)) || undefined}
      style={{
        // Filled from the host box, as the Timeline is and for the reason its own comment gives.
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: TIMELINE_THEME.back,
        color: TIMELINE_CHROME.text,
        font: '11px Inter, system-ui, sans-serif',
      }}
    >
      <div
        style={{
          height: HEADER_HEIGHT,
          flex: `0 0 ${HEADER_HEIGHT}px`,
          display: 'flex',
          alignItems: 'center',
          gap: TIMELINE_CHROME.headerGap,
          padding: TIMELINE_CHROME.headerPadding,
          background: TIMELINE_THEME.header,
          borderBottom: `1px solid ${TIMELINE_CHROME.rule}`,
        }}
      >
        <PlayModeSwitch title="Game" />
        {/* THE TRANSPORT IN THE MIDDLE, between two spacers, where the Timeline centres its own. */}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex' }} role="group" aria-label="Game transport">
          <GameButton
            testId="model-play-button"
            label={playing ? 'Stop playing (Escape)' : 'Play this model’s script'}
            pressed={playing}
            wide
            disabled={!canPlay}
            // The run's state NOW, not the render's: a game can stop between the two (Escape, an
            // agent's `stop`, a failed script), and a toggle read from a stale render does nothing.
            onClick={() => { if (documentId !== null && found) found.setPlaying(documentId, !found.playing(documentId)); }}
          >
            {mark(playing ? MARKS.stop : MARKS.play)}
            {playing ? 'Stop' : 'Play'}
          </GameButton>
          {transport && (
            <>
              <GameButton
                testId="model-play-pause"
                label={clock.paused ? 'Resume' : 'Pause'}
                pressed={playing && clock.paused}
                disabled={!playing}
                onClick={() => { if (documentId !== null) transport.setPaused(documentId, !transport.clock(documentId).paused); }}
              >
                {mark(clock.paused ? MARKS.play : MARKS.pause)}
              </GameButton>
              <GameButton
                testId="model-play-step"
                label="Step one tick (while paused)"
                disabled={!playing || !clock.paused}
                onClick={() => { if (documentId !== null) transport.step(documentId); }}
              >
                {mark(MARKS.step)}
              </GameButton>
              <GameButton
                testId="model-play-restart"
                label="Restart on a fresh copy of the model"
                disabled={!playing}
                onClick={() => { if (documentId !== null) transport.restart(documentId); }}
              >
                {mark(MARKS.restart)}
              </GameButton>
            </>
          )}
        </div>
        {transport && (
          <div style={{ display: 'flex' }} role="group" aria-label="Game speed">
            {transport.speeds.map((speed) => (
              <GameButton
                key={speed}
                testId={`model-play-speed-${speed}`}
                label={`Speed ${speedText(speed)}`}
                pressed={clock.speed === speed}
                wide
                disabled={documentId === null}
                onClick={() => { if (documentId !== null) transport.setSpeed(documentId, speed); }}
              >
                {speedText(speed)}
              </GameButton>
            ))}
          </div>
        )}
        <div style={{ flex: 1 }} />
        {/* THE CLOCK IS THE SIMULATION'S: the seconds the script was handed and the updates it
            ran. It stands still while paused and runs at the speed. */}
        <span
          data-testid="model-play-clock"
          style={{ color: TIMELINE_CHROME.widgetText, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
        >
          {clockText(clock.time)} · tick {clock.tick}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'stretch',
          gap: TIMELINE_CHROME.headerGap,
          padding: TIMELINE_CHROME.statusPadding,
          overflow: 'hidden',
        }}
      >
        <div style={{ flex: '0 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span data-testid="model-play-status" title={status} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {status}
          </span>
          {transport?.autoplay && documentId !== null && (
            <AutoplayControl documentId={documentId} playing={playing} clock={clock} autoplay={autoplay} transport={transport} />
          )}
        </div>
        {found?.log && documentId !== null && <PlayLogView documentId={documentId} log={found.log} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// AUTOPLAY AND THE PLAY LOG
// ---------------------------------------------------------------------------------------------

function AutoplayControl({ documentId, playing, clock, autoplay, transport }: {
  readonly documentId: string;
  readonly playing: boolean;
  readonly clock: DocumentPlayClock;
  readonly autoplay: DocumentPlayAutoplay;
  readonly transport: DocumentPlayTransport;
}) {
  const unavailable = autoplayUnavailable(playing, clock, autoplay);
  const armed = autoplay.armed === true;
  // STOPPED, the button ARMS: the next start switches the bot on once its script offers one.
  const canArm = !playing && transport.armAutoplay !== undefined;
  const label = unavailable === 'no-bot'
    ? 'This game provides no bot: its play script registers none with play.autoplay(controller)'
    : unavailable === 'not-running'
      ? canArm
        ? armed ? 'Autoplay is armed for the next Play; press to disarm' : 'Turn autoplay on as soon as the game is running (if it offers a bot)'
        : 'Autoplay is available once the game is running'
      : autoplay.on ? 'Stop autoplay and drive yourself' : 'Let the game’s bot drive (any key or click in the game takes over)';
  // SAID, NOT ONLY HOVERED: why there is nothing to switch.
  const note = unavailable === 'no-bot'
    ? 'No autoplay — this game doesn’t provide a bot'
    : unavailable === 'not-running'
      ? armed ? 'Armed — turns on once the game is running' : 'Available once the game is running'
      : null;
  // THE BEHAVIOUR TO RUN, when the bot offers several: chosen here, as `play autoplay on <behaviour>`
  // names it. Shown with the one driving (or armed) selected, else the bot's first.
  const behaviors = autoplay.behaviors ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const behavior = autoplay.on || armed ? autoplay.behavior ?? null : picked !== null && behaviors.includes(picked) ? picked : behaviors[0] ?? null;
  const driver = driverOf(playing, autoplay);
  // Said while nobody drives; once the person's input reaches the game, the driver line says they are.
  const limitNote = driver !== 'none' ? null
    : autoplay.by === 'limit' && autoplay.limit ? `Autoplay stopped at its ${Math.round(autoplay.limit)} s limit`
    // An arm the start could not take says why, rather than leaving the person to wonder.
    : autoplay.refused ? `Autoplay didn’t start: ${autoplay.refused}` : null;
  const botLine = [autoplay.behavior, autoplay.state].filter(Boolean).join(' — ');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: TIMELINE_CHROME.headerGap, minWidth: 0 }}>
      {behaviors.length > 1 && (
        <select
          data-testid="model-play-autoplay-behavior"
          title="The bot behaviour Autoplay runs"
          value={behavior ?? ''}
          disabled={autoplay.on}
          onChange={(event) => setPicked(event.target.value)}
          style={{ background: TIMELINE_CHROME.widget, color: TIMELINE_CHROME.widgetText, border: 'none', borderRadius: TIMELINE_CHROME.widgetRadius, font: 'inherit', minWidth: 0 }}
        >
          {behaviors.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      )}
      {/* The tooltip lives on a wrapper too: a disabled button is the one that most needs it. */}
      <span title={label} style={{ display: 'inline-flex' }}>
      {/* KEEP THE KEYBOARD OFF THIS BUTTON (`GameButton`'s `keepFocus`). Left focused, a person
          taking over with Space — a key the game hears, which turns autoplay off — would also
          click this button and turn autoplay straight back on. */}
      <GameButton
        testId="model-play-autoplay"
        label={label}
        pressed={autoplay.on || armed}
        wide
        disabled={canArm ? false : !playing || !autoplay.available || transport.setAutoplay === undefined}
        // The switch's state NOW, as the transport's buttons read theirs: a takeover can land
        // between the render and the click.
        onClick={() => {
          const now = transport.autoplay?.(documentId) ?? NO_BOT;
          if (!(extension()?.playing(documentId) ?? false)) transport.armAutoplay?.(documentId, !now.armed, { behavior });
          else transport.setAutoplay?.(documentId, !now.on, 'panel', now.on ? undefined : { behavior });
        }}
      >
        Autoplay
      </GameButton>
      </span>
      {note !== null ? (
        <span data-testid="model-play-autoplay-note" data-reason={unavailable ?? undefined} style={{ color: TIMELINE_CHROME.widgetText, minWidth: 0 }}>
          {note}
        </span>
      ) : playing && (
        // WHO DRIVES, AND WHAT THE BOT SAYS IT IS DOING: "Bot driving · win — heading to nest 2".
        // Nobody drives a game that runs on no input; the person only once their input reached it.
        <span
          data-testid="model-play-driver"
          data-driver={driver ?? undefined}
          title={autoplay.state ? `The bot: ${autoplay.state}` : undefined}
          style={{ color: autoplay.on ? TIMELINE_THEME.playhead : TIMELINE_CHROME.widgetText, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}
        >
          {driver === 'bot' ? `Bot driving${botLine ? ` · ${botLine}` : ''}`
            : limitNote ? `${limitNote}${autoplay.state ? ` — ${autoplay.state}` : ''}`
            : driver === 'person' ? 'You’re driving' : 'Nobody’s driving'}
        </span>
      )}
    </div>
  );
}

/** Enough to read back what just happened; the whole log is `cyclotron play-log`. */
const LOG_LINES = 200;

function factsText(facts: Record<string, unknown> | undefined): string {
  if (facts === undefined) return '';
  try { return JSON.stringify(facts); } catch { return ''; }
}

function PlayLogView({ documentId, log }: { readonly documentId: string; readonly log: DocumentPlayLog }) {
  const [kind, setKind] = useState('');
  // Writes land several to a frame; the view redraws at most once per drawn frame.
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    let frame = 0;
    const stop = log.subscribe(() => {
      if (frame === 0) frame = requestAnimationFrame(() => { frame = 0; redraw(); });
    });
    return () => { stop(); cancelAnimationFrame(frame); };
  }, [log]);
  const tail = log.tail(documentId, LOG_LINES, kind === '' ? undefined : kind);
  const list = useRef<HTMLDivElement>(null);
  // Follows the newest entry until the person scrolls up; back at the bottom, it follows again.
  const following = useRef(true);
  useLayoutEffect(() => {
    const element = list.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  });
  const newest = tail.entries.at(-1)?.seq;
  return (
    <div data-testid="model-play-log" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: TIMELINE_CHROME.headerGap }}>
        <span>Play log</span>
        <select
          data-testid="model-play-log-kind"
          aria-label="Show entries of kind"
          value={kind}
          // Blurred once chosen, so the player's next arrow key moves the game, not this list.
          onChange={(event) => { setKind(event.target.value); event.target.blur(); }}
          style={{
            height: TIMELINE_CHROME.unit,
            background: TIMELINE_CHROME.widget,
            color: TIMELINE_CHROME.widgetText,
            border: `1px solid ${TIMELINE_CHROME.widgetOutline}`,
            font: 'inherit',
          }}
        >
          <option value="">All kinds</option>
          {[...new Set([...tail.kinds, ...(kind === '' ? [] : [kind])])].map((one) => <option key={one} value={one}>{one}</option>)}
        </select>
        <span style={{ color: TIMELINE_CHROME.widgetText }}>
          {tail.total === 0 ? 'Nothing logged yet' : `${tail.total} written${tail.total > LOG_LINES ? ` · newest ${LOG_LINES} shown` : ''}`}
        </span>
      </div>
      <div
        ref={list}
        data-testid="model-play-log-entries"
        data-newest={newest}
        onScroll={(event) => {
          const element = event.currentTarget;
          following.current = element.scrollTop + element.clientHeight >= element.scrollHeight - 4;
        }}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          font: '12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          background: TIMELINE_THEME.header,
          border: `1px solid ${TIMELINE_CHROME.rule}`,
          padding: '2px 6px',
        }}
      >
        {tail.entries.map((entry) => (
          <div
            key={entry.seq}
            data-kind={entry.kind}
            style={{ display: 'flex', gap: 10, whiteSpace: 'nowrap', color: entry.source === 'play' ? TIMELINE_CHROME.widgetText : TIMELINE_CHROME.text }}
          >
            <span style={{ flex: '0 0 auto', fontVariantNumeric: 'tabular-nums' }}>{clockText(entry.simT)}</span>
            <span style={{ flex: '0 0 auto' }}>{entry.kind}</span>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} title={factsText(entry.facts)}>{factsText(entry.facts)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
