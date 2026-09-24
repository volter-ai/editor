/**
 * The page-level audio services of a RUNNING game (`@volter/editor-sdk/services`,
 * a `workspace.service` contribution): the host-level AudioContext unlock —
 * a game's own unlock listeners go through the realm's gated re-dispatch,
 * which is not the trusted gesture stack browsers require — and the Web
 * Audio pose guard's editor diagnostic. Both are page-wide and idempotent;
 * neither matters to a project that plays nothing.
 */
import { installAudioPoseGuard } from '../src/services/audio-pose-guard';
import { installGameAudioUnlock } from '../src/services/game-audio-unlock';

export const point = 'workspace.service';

export function start(): void {
  installGameAudioUnlock();
  installAudioPoseGuard();
}
