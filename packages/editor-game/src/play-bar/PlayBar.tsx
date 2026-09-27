import { type ConfigurationStatus, listConfigurations } from '../host/api/configurations';
import {
  chooseRunConfiguration,
  chosenRunConfiguration,
  PLAY_CONFIGURATION,
  selectedRunConfiguration,
  startSelectedRunConfiguration,
  stopStartedRunConfiguration,
} from '../play/run-selection';
import { isGameplayExportActive, subscribeGameplayExport } from '@volter/editor-sdk/kit/gameplay-export-state';
import { PLAY_CONTROL_TEST_ID } from '../host/play-control-hook';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import { editorHost } from '@volter/editor-sdk/host';
import {
  AnchoredMenu,
  Button,
  EditorIcon,
  editorIcons,
  IconButton,
  Inline,
  MenuItem,
  Text,
  ToolbarDivider,
} from '@volter/editor-sdk/widgets';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isIngestActive } from '../ingest/active-ingest';
import { deferredIngestPlayActive } from '../ingest/deferred-ingest-play';
import { getIngestPlayControl } from '../ingest/ingest-play-control';
import {
  enterPlayMode,
  exitPlayMode,
  getRestartRequiredReason,
  pausePlayMode,
  resumePlayMode,
  stepPlayMode,
  subscribeRestartRequired,
} from '../play/play-mode';
import { InstanceCountPicker } from './PlayerCountPicker';

export { type Resolution, ResolutionPicker } from '../host/components/ResolutionPicker';

export interface PlayBarViewProps {
  readonly placement?: 'launcher' | 'runtime';
  readonly exporting?: boolean;
  readonly state: 'stopped' | 'playing' | 'paused';
  readonly restartReason?: string | null | undefined;
  readonly playEditRegime?: 'ephemeral' | null | undefined;
  readonly onPlay: () => void;
  readonly onPause: () => void;
  readonly onStep: () => void;
  readonly onRestart: () => void;
  readonly onStop: () => void;
  /** The Instances picker is a PARAMETER of a compound configuration that
   *  declares it (ARCHITECTURE-CORE §The project model); absent otherwise. */
  readonly instances?: number | null | undefined;
  /** The picker over the project's run configurations, when it declares any. */
  readonly picker?: React.ReactNode;
  readonly options?: React.ReactNode;
}

function SaveRegimeIndicator({ regime }: { regime: 'ephemeral' | null }) {
  if (!regime) return null;
  const label = 'Play edits are temporary unless explicitly committed to source.';
  return (
    <span
      role="img"
      aria-label={label}
      className="vgai-play-edit-regime"
      data-testid="play-edit-regime"
      data-regime={regime}
      title={label}
    >
      <EditorIcon icon={editorIcons.status.warning} size="sm" />
    </span>
  );
}

function TransportButton({
  label,
  icon,
  onClick,
  title = label,
  disabled = false,
  pressed,
  variant = 'ghost',
  testId,
}: {
  label: string;
  icon: IconDefinition;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  pressed?: boolean;
  variant?: 'primary' | 'ghost';
  testId?: string;
}) {
  return (
    <IconButton
      aria-label={label}
      aria-pressed={pressed}
      data-testid={testId}
      disabled={disabled}
      size="comfortable"
      variant={variant}
      // A transport button never KEEPS the keyboard: after Play the next
      // Space or Enter must reach the game, not re-activate this button and
      // stop the session (runhuman pass 145; traced on production build 70).
      onClick={(event) => {
        event.currentTarget.blur();
        onClick();
      }}
      title={title}
    >
      <EditorIcon icon={icon} size="md" />
    </IconButton>
  );
}

/** Store-free production transport shared by the connected app and bounded hosts. */
export function PlayBarView({
  state,
  exporting = false,
  restartReason = null,
  playEditRegime = null,
  onPlay,
  onPause,
  onStep,
  onRestart,
  onStop,
  instances = null,
  picker = null,
  options = null,
  placement = 'launcher',
}: PlayBarViewProps) {
  const active = state !== 'stopped';
  const paused = state === 'paused';
  if (placement === 'runtime' && !active) return null;
  return (
    <Inline
      role="toolbar"
      aria-label="Game transport"
      className="vgai-playbar"
      gap={2}
      align="center"
    >
      {placement === 'launcher' && (
        <>
          {picker}
          {options}
          {/* Runtime cardinality sits beside transport, like the local-client
          settings in established game editors — for a compound that declares it. */}
          {instances !== null && <InstanceCountPicker />}
          <TransportButton
            label="Play"
            title={active ? 'Exit Play mode' : 'Play (run game)'}
            icon={editorIcons.transport.play}
            pressed={active}
            testId={PLAY_CONTROL_TEST_ID}
            onClick={onPlay}
          />
        </>
      )}
      {placement === 'runtime' && (
        <>
          <TransportButton
            label="Pause"
            title={paused ? 'Resume' : 'Pause'}
            icon={editorIcons.transport.pause}
            disabled={!active || exporting}
            pressed={paused}
            onClick={onPause}
          />
          <TransportButton
            label="Step one frame"
            icon={editorIcons.transport.step}
            disabled={!paused || exporting}
            onClick={onStep}
          />
          <ToolbarDivider />
          <TransportButton
            label="Restart Game"
            icon={editorIcons.transport.restart}
            disabled={!active || exporting}
            variant={restartReason ? 'primary' : 'ghost'}
            testId="restart-game"
            onClick={onRestart}
            title={
              restartReason ??
              'Restart game (dispose and remount every root without reloading the editor)'
            }
          />
          <TransportButton
            label="Stop"
            icon={editorIcons.transport.stop}
            disabled={!active}
            onClick={onStop}
          />
          {active && (
            <>
              <ToolbarDivider />
              <SaveRegimeIndicator regime={playEditRegime} />
            </>
          )}
        </>
      )}
    </Inline>
  );
}

/** The global launcher and the live Game document's transport share session actions. */
export function PlayBar({ placement = 'launcher' }: { placement?: 'launcher' | 'runtime' }) {
  const exporting = useSyncExternalStore(subscribeGameplayExport, isGameplayExportActive);
  const { session } = editorHost();
  useSyncExternalStore(session.subscribe, session.version, session.version);
  const state = session.playState();
  const restartReason = useSyncExternalStore(
    subscribeRestartRequired,
    getRestartRequiredReason,
    getRestartRequiredReason,
  );
  // F17/F21: ingest sessions get a real play surface instead of a silent
  // no-op. Mounts are cold (getIngestPlayControl's doc comment); ▶ starts or
  // resumes the ingested game's own loop/session, ⏸ freezes it.
  const [, forceIngestRender] = useState(0);
  const run = useRunConfigurations();
  const ingest = isIngestActive() ? getIngestPlayControl() : null;
  if (ingest) {
    return (
      <Inline
        role="toolbar"
        aria-label="Game transport"
        className="vgai-playbar"
        gap={2}
        align="center"
      >
        <TransportButton
          label={
            placement === 'runtime'
              ? ingest.playing
                ? 'Pause ingested game'
                : 'Resume ingested game'
              : 'Run ingested game'
          }
          title={ingest.playing ? 'Pause ingested game' : 'Run ingested game'}
          icon={ingest.playing ? editorIcons.transport.pause : editorIcons.transport.play}
          pressed={ingest.playing}
          // S-6: the SAME hook the native transport carries — this surface's
          // label differs, and callers must not have to know that.
          testId={PLAY_CONTROL_TEST_ID}
          onClick={() => {
            if (ingest.playing) ingest.pause();
            else ingest.play();
            forceIngestRender((value) => value + 1);
          }}
        />
        {/* Stop exists only where it can honestly END something. A boot-mounted
            ingest IS the open document, so there is nothing to stop (that is why
            ⏹ maps to pause on the relay — `ingest/ingest-play-commands.ts`). A
            root that declares its own world component mounted this game BECAUSE
            Play started (`ingest/deferred-ingest-play.ts`), so ⏹ tears the run
            down and hands the surface back to the design-time Scene. */}
        {placement === 'runtime' && deferredIngestPlayActive() && (
          <TransportButton
            label="Stop"
            title="Stop the game and return to the scene"
            icon={editorIcons.transport.stop}
            onClick={() => exitPlayMode()}
          />
        )}
        {/* Step exists only where the serve-time loop gate MEASURED
            control of this game's frames — offering it otherwise would be a
            button that cannot do what it says. */}
        {placement === 'runtime' && ingest.canStep && (
          <TransportButton
            label="Step ingested game"
            title="Advance the ingested game one frame"
            icon={editorIcons.transport.step}
            onClick={() => {
              ingest.step();
              forceIngestRender((value) => value + 1);
            }}
          />
        )}
      </Inline>
    );
  }

  const selected = run.configurations.find((c) => c.id === run.selectedId) ?? null;
  const instances = selected?.kind === 'compound' ? (selected.instances ?? null) : null;
  const play = async () => {
    const start = await startSelectedRunConfiguration();
    if (!start.ok) {
      editorHost().notify({ tone: 'error', title: start.title, detail: start.detail });
      return;
    }
    if (start.started) void run.refresh();
    await enterPlayMode();
  };
  const stop = () => {
    exitPlayMode();
    void stopStartedRunConfiguration().then(() => run.refresh());
  };
  return (
    <PlayBarView
      placement={placement}
      exporting={exporting}
      state={state}
      restartReason={restartReason}
      playEditRegime={session.playEditRegime()}
      instances={instances}
      options={<PlayOptions />}
      picker={
        run.configurations.length > 1 ? (
          <RunPicker run={run} disabled={state !== 'stopped'} />
        ) : null
      }
      onPlay={() => {
        if (state !== 'stopped') stop();
        else void play();
      }}
      onPause={() => {
        if (state === 'paused') resumePlayMode();
        else pausePlayMode();
      }}
      onStep={() => stepPlayMode()}
      onRestart={() => void play()}
      onStop={() => stop()}
    />
  );
}

/** A user preference, carried by the workbench settings like every other editor choice. */
function PlayOptions() {
  const { settings } = editorHost();
  const keepPanelsVisible = useSyncExternalStore(
    settings.subscribe,
    () => settings.get('vgai.play.keepPanelsVisible') === true,
  );
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton
        ref={anchor}
        aria-label="Play options"
        title="Play options"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        <EditorIcon icon={faChevronDown} />
      </IconButton>
      {open && (
        <AnchoredMenu anchorRef={anchor} onDismiss={() => setOpen(false)}>
          <MenuItem
            role="menuitemcheckbox"
            aria-checked={keepPanelsVisible}
            onSelect={() => {
              settings.set('vgai.play.keepPanelsVisible', !keepPanelsVisible);
              setOpen(false);
            }}
          >
            Keep panels visible during Play
          </MenuItem>
        </AnchoredMenu>
      )}
    </>
  );
}

/** The implicit configuration: mount every root in the host. */
const PLAY_ID = PLAY_CONFIGURATION;

interface RunState {
  readonly configurations: readonly ConfigurationStatus[];
  readonly selectedId: string;
  readonly select: (id: string) => void;
  readonly refresh: () => Promise<void>;
}

/** The project's declared configurations (plus the implicit `play`), their
 *  status, and the selection — kept per checkout in the project-local
 *  document, the way an IDE remembers the chosen launch configuration. */
function useRunConfigurations(): RunState {
  const [declared, setDeclared] = useState<readonly ConfigurationStatus[]>([]);
  const [chosenId, setChosenId] = useState<string | null>(chosenRunConfiguration);
  const refresh = useCallback(async () => {
    const list = await listConfigurations().catch(() => []);
    setDeclared(list);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const configurations = useMemo<readonly ConfigurationStatus[]>(
    () => [
      {
        id: PLAY_ID,
        kind: PLAY_ID,
        role: 'run',
        describe: 'Mount every root in the host',
        status: 'stopped',
      },
      ...declared.filter((c) => c.role === 'run'),
    ],
    [declared],
  );
  const selectedId = selectedRunConfiguration(declared, chosenId);
  const select = useCallback((id: string) => {
    setChosenId(id);
    chooseRunConfiguration(id);
  }, []);
  return { configurations, selectedId, select, refresh };
}

function RunPicker({ run, disabled }: { readonly run: RunState; readonly disabled: boolean }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const selected = run.configurations.find((c) => c.id === run.selectedId);
  const label = selected?.id === PLAY_ID ? 'Play' : (selected?.id ?? 'Play');
  return (
    <div className="vgai-playbar-popover-anchor">
      <Button
        ref={ref}
        variant="ghost"
        size="compact"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'vgai-run-configuration-menu' : undefined}
        data-testid="run-configuration-picker"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        title="Which configuration Play starts (the manifest's run-role configurations)"
      >
        <Text variant="code">{label}</Text>
        <EditorIcon icon={faChevronDown} size="sm" />
      </Button>
      {open && (
        <AnchoredMenu
          id="vgai-run-configuration-menu"
          anchorRef={ref}
          align="start"
          gap={4}
          onDismiss={() => setOpen(false)}
        >
          {run.configurations.map((configuration) => (
            <MenuItem
              key={configuration.id}
              role="menuitemradio"
              aria-checked={configuration.id === run.selectedId}
              data-testid={`run-configuration-${configuration.id}`}
              title={configuration.describe ?? undefined}
              onSelect={() => {
                run.select(configuration.id);
                setOpen(false);
              }}
            >
              {configuration.id === PLAY_ID
                ? 'Play'
                : `${configuration.id} · ${configuration.kind}`}
              {configuration.status === 'running' ? ' ●' : ''}
            </MenuItem>
          ))}
        </AnchoredMenu>
      )}
    </div>
  );
}
