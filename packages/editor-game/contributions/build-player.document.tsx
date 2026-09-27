/**
 * BUILD PLAYER (`workspace.document`) — the project's last build, run as a
 * player runs it: its own `dist/`, served by the editor server, in a frame
 * with nothing of the editor inside it. Build Profiles' Build And Run opens
 * it, as Unity's Build And Run launches the player and Godot's Web export
 * runs in a browser; each run reloads the frame.
 *
 * What the build prints reaches the editor's console, prefixed
 * `[Build Player]`, as a Godot export run with remote debug reports into the
 * editor's debugger: its console calls, and its uncaught errors.
 */

import type { ToolContributionProps } from '@volter/editor-sdk/contributions';
import { useSyncExternalStore } from 'react';
import { BUILD_PLAYER_URL, buildRunCount, subscribeBuildRuns } from '../src/build/build-session';

export const point = 'workspace.document';
export const title = 'Build Player';

const FORWARDED = ['log', 'info', 'warn', 'error'] as const;

const HOOKED = Symbol('build-player-output');

/** Hook the player's document once it exists: the build's module scripts run
 *  before `load`, after its HTML is parsed and while their bundle is fetched,
 *  so the frame is watched from insertion until its document is the build's. */
function watchFrame(frame: HTMLIFrameElement | null): void {
  if (!frame) return;
  const tick = () => {
    if (!frame.isConnected) return;
    const player = frame.contentWindow as (Window & typeof globalThis & { [HOOKED]?: true }) | null;
    if (player?.location.pathname === new URL(BUILD_PLAYER_URL, location.href).pathname) {
      if (!player[HOOKED]) forwardOutput(player);
      if (player.document.readyState === 'complete') return;
    }
    setTimeout(tick, 0);
  };
  tick();
}

function forwardOutput(player: Window & typeof globalThis & { [HOOKED]?: true }): void {
  player[HOOKED] = true;
  for (const level of FORWARDED) {
    const own = player.console[level].bind(player.console);
    player.console[level] = (...args: unknown[]) => {
      own(...args);
      console[level]('[Build Player]', ...args);
    };
  }
  player.addEventListener('error', (event) => {
    console.error('[Build Player] Uncaught', event.error ?? event.message);
  });
  player.addEventListener('unhandledrejection', (event) => {
    console.error('[Build Player] Unhandled rejection', event.reason);
  });
  console.info(`[Build Player] Running ${player.document.title || 'the build'}`);
}

export default function BuildPlayerDocument(_props: ToolContributionProps) {
  const run = useSyncExternalStore(subscribeBuildRuns, buildRunCount);
  return (
    <iframe
      key={run}
      title="Build Player"
      data-build-player={run}
      src={`${BUILD_PLAYER_URL}?run=${run}`}
      ref={watchFrame}
      style={{ width: '100%', height: '100%', border: 0, display: 'block', background: '#000' }}
    />
  );
}
