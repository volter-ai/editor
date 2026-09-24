import { HeaderTelemetry } from '../host/components/HeaderTelemetry';
import { PlayBar } from '../play-bar/PlayBar';
/**
 * THE GAME DOCUMENT's CONTENT AND TOOLBAR — what the host's live document
 * (`workspace:game`) draws while a runtime is live. Registered through
 * `workspace.liveDocument.register` by `contributions/game-document.service.ts`.
 *
 * It moved out of `components/CenterDocuments.tsx` when Play left the host
 * (WORK.md §The workbench, P3b). `ResolutionPicker` stayed behind — the
 * host's story documents read it — so it is reached through the `@editor/*`
 * alias, like every other editor internal this document still holds.
 */

import { ResolutionPicker } from '../host/components/ResolutionPicker';
import { useEditorStore } from '@volter/editor-core/editor-runtime';
import { getCurrentProject, onProjectChange } from '@volter/editor-core/project-manager';
import type { LiveDocumentContentProps } from '@volter/editor-sdk/host';
import {
  AnchoredMenu,
  Button,
  DisclosureIcon,
  MenuItem,
  themeVars,
} from '@volter/editor-sdk/widgets';
import { useRef, useState, useSyncExternalStore } from 'react';
import { crowdDebugEnabled, setCrowdDebugEnabled } from './crowd-debug';
import { DevicePresetPicker } from './DevicePresetPicker';
import {
  devicePreviewVersion,
  FIT_PRESET_ID,
  setDevicePreset,
  subscribeDevicePreview,
} from './device-preview';
import { GameCaptureFrameButton } from './GameCaptureFrameButton';
import { GamePanel } from './GamePanel';
import {
  applyGameDevicePreset,
  displayedGameResolution,
  gameDocumentResolution,
  gameDocumentScale,
  gameResolutionOptions,
  gameViewVersion,
  notifyGameView,
  setGameDocumentResolution,
  subscribeGameView,
} from './game-view-store';
import { InstanceInspectorPicker } from './InstanceInspectorPicker';
import { physicsDebugEnabled, setPhysicsDebugEnabled } from './physics-debug';

function GameDebugMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div style={{ position: 'relative' }}>
      <Button
        ref={ref}
        type="button"
        variant="outline"
        size="compact"
        data-testid="game-debug-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'vgai-game-debug-menu' : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span>Debug</span>
        <DisclosureIcon direction="down" />
      </Button>
      {open && (
        <AnchoredMenu
          id="vgai-game-debug-menu"
          anchorRef={ref}
          gap={3}
          onDismiss={() => setOpen(false)}
          style={{
            minWidth: 190,
          }}
        >
          <MenuItem
            onClick={() => {
              setCrowdDebugEnabled(!crowdDebugEnabled());
              notifyGameView();
            }}
          >
            {crowdDebugEnabled() ? '✓ ' : '  '}Crowd debug draw
          </MenuItem>
          <MenuItem
            onClick={() => {
              setPhysicsDebugEnabled(!physicsDebugEnabled());
              notifyGameView();
            }}
          >
            {physicsDebugEnabled() ? '✓ ' : '  '}Physics debug draw
          </MenuItem>
        </AnchoredMenu>
      )}
    </div>
  );
}

/**
 * The Game document's LOCAL toolbar (§7.1 toolbar contribution, drawn in the
 * document's own header strip while it is active): resolution picker + mute — the V4 remainder deferred from W1.
 * The global header keeps the launcher; running-session transport and telemetry belong here.
 */
export function GameDocumentToolbar(_props: LiveDocumentContentProps) {
  const project = useSyncExternalStore(onProjectChange, getCurrentProject);
  const store = useEditorStore();
  useSyncExternalStore(store.subscribe, store.getShellSnapshot ?? store.getSnapshot);
  useSyncExternalStore(subscribeGameView, gameViewVersion);
  useSyncExternalStore(subscribeDevicePreview, devicePreviewVersion);
  return (
    <div
      data-testid="game-doc-toolbar"
      style={{
        display: 'grid',
        alignItems: 'center',
        gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
        width: '100%',
        gap: 6,
        padding: '2px 8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, overflow: 'auto' }}>
        <InstanceInspectorPicker />
        <DevicePresetPicker
          onPresetChange={(preset) => {
            applyGameDevicePreset(preset);
            notifyGameView();
          }}
        />
        <ResolutionPicker
          resolution={displayedGameResolution(gameDocumentResolution(), project?.config.resolution)}
          options={gameResolutionOptions(project?.config.resolution)}
          onResolutionChange={(resolution) => {
            // A plain resolution pick is a deliberate exit from device
            // emulation: keep the chosen dimensions, drop DPR/safe-area/touch.
            setDevicePreset(FIT_PRESET_ID);
            setGameDocumentResolution(resolution);
          }}
          scale={gameDocumentScale()}
          title="Change game resolution"
        />
        <GameDebugMenu />
        {/* F11: capture one rendered frame into the Frame debugger.
          Play-gated; honestly disabled when the world registered no
          render-debug adapter (headless/non-real-context). Lives in the
          toolbar (not floating over the panel) so it tiles with the rest of
          the chrome when paused Play reveals the editor. */}
        {store.playState !== 'stopped' && <GameCaptureFrameButton />}
      </div>
      <PlayBar placement="runtime" />
      <div style={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0 }}>
        <HeaderTelemetry />
      </div>
    </div>
  );
}

/** The Game document's content host. It exists only while a runtime is live —
 *  see this file's header. */
export function GameDocumentContent(_props: LiveDocumentContentProps) {
  const store = useEditorStore();
  useSyncExternalStore(store.subscribe, store.getShellSnapshot ?? store.getSnapshot);
  const isPlaying = store.playState !== 'stopped';
  return (
    <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <GamePanel
        style={{
          flex: 1,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: 'auto',
          // L-20 — playing/paused edge treatment from the shared themeVars.semantic.success/themeVars.semantic.warning
          // tokens (same "healthy"/"attention" semantic SaveStatus uses).
          ...(store.playState === 'playing'
            ? { outline: `2px solid ${themeVars.semantic.success}`, outlineOffset: -2 }
            : isPlaying
              ? { outline: `2px solid ${themeVars.semantic.warning}`, outlineOffset: -2 }
              : {}),
        }}
      />
      {store.playState === 'paused' && (
        // THE EDITOR PAUSED THE GAME, AND SAYS SO ON THE GAME. Escape belongs
        // to play-mode while playing (pause on Escape), so a player who
        // pressed it — once to free the mouse, once more by habit — froze the
        // game with input gated off while the game's own card still read
        // PRESS ENTER TO REDEPLOY; two testers in a row reported "Enter ain't
        // working" from exactly that sequence (runhuman passes 124, 125). The
        // yellow outline alone did not read as "paused". This label sits over
        // the game and points at the one control that resumes it.
        <div
          data-testid="game-paused-notice"
          style={{
            position: 'absolute',
            left: '50%',
            top: 12,
            transform: 'translateX(-50%)',
            padding: '6px 12px',
            borderRadius: 6,
            background: 'rgba(0,0,0,.72)',
            color: themeVars.content.primary,
            fontSize: 12,
            letterSpacing: '.04em',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          Paused by the editor — press ▶ Play to resume (Escape pauses)
        </div>
      )}
    </div>
  );
}
