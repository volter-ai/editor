/**
 * EDIT-TIME AUDIO (`@volter/editor-sdk/services`, a `workspace.service`
 * contribution): the first-party Three/Web Audio graph the editor inspects
 * while nothing is playing, so Stop falls back to a real adapter instead of
 * making audio disappear.
 *
 * Install-once and project-independent, like `audio-unlock.service.ts` beside
 * it — the graph is the page's, not the open project's — so this has no
 * `onProjectChange` re-install, unlike edit-time networking.
 *
 * It was `components/EditModeAudioBootstrap.tsx`, a component that rendered
 * `null` so the shell's layout could run an effect, and through it the host
 * imported `@volter/game-runtime/setup/setup-audio`, `@volter/game-runtime/audio/bus-mixer` and
 * `@volter/game-runtime/audio/pose-guard` — the engine's audio RUNTIME — into every editor
 * boot (WORK.md §The open-source launch, phase 1 unit 7).
 */
import { installEditModeAudio } from '../src/edit-mode/edit-mode-audio';

export const point = 'workspace.service';

export function start(): () => void {
  return installEditModeAudio();
}
