/**
 * BUILD PROGRESS (`workspace.status`) — the compact status-bar item for the
 * running build: `Building <target>…`, then complete or failed. Nothing at
 * all while idle, so the strip carries no row for a build nobody started.
 */

import { useSyncExternalStore } from 'react';
import {
  buildSessionVersion,
  getBuildSession,
  subscribeBuildSession,
} from '../src/build/build-session';

export const point = 'workspace.status';
export const title = 'Build Progress';
export const align = 'left';
export const order = 30;

export default function BuildProgressStatus() {
  useSyncExternalStore(subscribeBuildSession, buildSessionVersion, buildSessionVersion);
  const session = getBuildSession();
  if (session.phase === 'idle') return null;
  if (session.phase === 'building') {
    return (
      <span
        className="vgai-status-copy"
        data-testid="status-build-progress"
        data-build-phase="building"
        data-status-tone="accent"
      >
        Building {session.target}…
      </span>
    );
  }
  return (
    <span
      className="vgai-status-copy"
      data-testid="status-build-progress"
      data-build-phase={session.result?.ok ? 'complete' : 'failed'}
      data-status-tone={session.result?.ok ? 'success' : 'danger'}
    >
      {session.result?.ok ? 'Build complete' : 'Build failed'}
    </span>
  );
}
