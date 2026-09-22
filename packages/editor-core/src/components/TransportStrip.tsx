/**
 * THE TRANSPORT, DRAWN — the one look every stage gets over its own transport
 * (WORK.md §The stage transport and the animation door, Step 5).
 *
 * It draws nothing until a subject is attached, so a stage with nothing to
 * show at a time costs an empty render and no chrome. Blender's Timeline is a
 * SECOND look over the same handle, not a replacement for this one: an origin
 * decides which subjects attach, never which transport drives them.
 *
 * IT HOLDS NO TIME OF ITS OWN. Every value here is read from the snapshot on
 * each notification — there is no local playhead state to drift, and no clock
 * in this file. `validate-import-bans.mjs`'s `private-clocks` row scans this
 * path for `requestAnimationFrame`/`performance.now` for exactly that reason.
 *
 * WHILE THE WORLD DRIVES (Play), it goes read-only and SAYS SO. A disabled
 * button with no reason is the failure this avoids: the refusal the transport
 * would throw is the sentence shown instead.
 */

import {
  EditorIcon,
  editorIcons,
  IconButton,
  Text,
  TextInput,
  themeVars,
} from '@volter/editor-sdk/widgets';
import { useCallback, useSyncExternalStore } from 'react';
import type { StageTransport } from '../animation/stage-transport';

/** The speeds the strip offers. Not a free number field: a speed is a viewing
 *  choice with a few useful values, and a text box invites 0.37. */
const SPEEDS = [0.25, 0.5, 1, 2] as const;

function formatSeconds(seconds: number, fps: number): string {
  const frame = Math.round(seconds * fps);
  return `${seconds.toFixed(2)}s · f${frame}`;
}

export function TransportStrip({ transport }: { transport: StageTransport | null }) {
  const snapshot = useSyncExternalStore(
    useCallback(
      (listener: () => void) => (transport ? transport.subscribe(listener) : () => {}),
      [transport],
    ),
    useCallback(() => transport?.snapshot() ?? null, [transport]),
  );

  if (!transport || !snapshot || snapshot.activeSubject === null) return null;

  const driven = snapshot.driver === 'world';
  const playing = snapshot.playbackState === 'playing';
  const { start, end, fps, loop } = snapshot.range;
  const active = snapshot.subjects.find((s) => s.id === snapshot.activeSubject);
  // Two different pickers, and they are not the same question: SUBJECTS are
  // the several things this stage can show at a time, CLIPS are the several
  // animations one subject has. A Blender action is a subject with no clips.
  const subjects = snapshot.subjects.length > 1 ? snapshot.subjects : null;
  const clips = transport.activeClips();

  return (
    <section
      aria-label="Transport"
      data-testid="stage-transport-strip"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--vgai-space-2)',
        padding: 'var(--vgai-space-1) var(--vgai-space-3)',
        borderTop: `var(--vgai-stroke-resting) solid ${themeVars.boundary.default}`,
        background: themeVars.surface.raised,
      }}
    >
      <IconButton
        size="compact"
        aria-label={playing ? 'Pause' : 'Play'}
        disabled={driven}
        onClick={() => (playing ? transport.pause() : transport.play())}
      >
        <EditorIcon icon={playing ? editorIcons.transport.pause : editorIcons.transport.play} />
      </IconButton>
      <IconButton
        size="compact"
        aria-label="Stop"
        disabled={driven}
        onClick={() => transport.stop()}
      >
        <EditorIcon icon={editorIcons.transport.stop} />
      </IconButton>

      <TextInput
        aria-label="Playhead"
        type="range"
        min={start}
        max={end}
        step={1 / fps}
        value={snapshot.time}
        disabled={driven}
        onChange={(event) => transport.seek(Number(event.target.value))}
        style={{ flex: 1 }}
      />

      <Text as="span" variant="caption">
        {formatSeconds(snapshot.time, fps)}
      </Text>

      {subjects ? (
        <select
          aria-label="Subject"
          value={snapshot.activeSubject}
          disabled={driven}
          onChange={(event) => transport.setActiveSubject(event.target.value)}
        >
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.label}
            </option>
          ))}
        </select>
      ) : null}

      {clips ? (
        <select
          aria-label="Clip"
          disabled={driven}
          onChange={(event) => transport.setActiveClip(event.target.value)}
        >
          {clips.map((clip) => (
            <option key={clip.id} value={clip.id}>
              {clip.label}
            </option>
          ))}
        </select>
      ) : null}

      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--vgai-space-1)' }}>
        <input
          type="checkbox"
          checked={loop}
          disabled={driven}
          onChange={(event) => transport.setLoop(event.target.checked)}
        />
        <Text as="span" variant="caption">
          Loop
        </Text>
      </label>

      <select
        aria-label="Speed"
        value={String(snapshot.timeScale)}
        disabled={driven}
        onChange={(event) => transport.setTimeScale(Number(event.target.value))}
      >
        {SPEEDS.map((speed) => (
          <option key={speed} value={String(speed)}>
            {speed}×
          </option>
        ))}
      </select>

      {driven ? (
        // The refusal the write verbs would throw, shown instead of a disabled
        // control with no reason.
        <Text as="span" variant="caption">
          The world is driving time (Play); pause the game to scrub
        </Text>
      ) : active ? (
        <Text as="span" variant="caption">
          {active.label}
        </Text>
      ) : null}
    </section>
  );
}
