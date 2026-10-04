// SPDX-License-Identifier: MIT
// Copyright 2026 Volter AI, Inc.
import type { CSSProperties } from 'react';
import type { RaceState } from '../models/race-state';
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
const panel: CSSProperties = {
  position: 'absolute', padding: 'clamp(12px, 1cqw, 24px)',
  background: 'color-mix(in srgb, var(--volter-surface-media, #16252c) 90%, transparent)', color: 'var(--volter-text-inverse, #f3f2ec)',
  border: '1px solid var(--volter-border-inverse, #4f6574)', borderRadius: 'var(--volter-radius-sm, 4px)',
};

/** Pure UI: the board's stories author the same elements that Play draws. */
export function RaceHud({ lap, lapTime, lastLap, speed, fps, airborne }: RaceState) {
  return <div style={{ position: 'absolute', inset: 0, containerType: 'inline-size', pointerEvents: 'none', fontFamily: 'var(--volter-font-mono, "Geist Mono", monospace)', fontStyle: 'normal', fontSize: 'clamp(14px, 1.15cqw, 30px)' }}>
    <section aria-label="Lap timer" style={{ ...panel, top: 24, left: 64, minWidth: 'clamp(210px, 18cqw, 470px)' }}>
      <h1 style={{ margin: 0, fontSize: 'clamp(18px, 1.5cqw, 40px)', color: 'var(--volter-accent-lime, #e4f09c)' }}>CUBE CUP · LAP {lap}</h1>
      <div style={{ fontSize: 'clamp(36px, 3cqw, 80px)', marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>{time(lapTime)}</div>
      <div style={{ marginTop: 8, fontSize: 'clamp(14px, 1.15cqw, 30px)' }}>LAST {lastLap ? time(lastLap) : '—'}</div>
    </section>
    <section aria-label="Speed" style={{ ...panel, top: 24, right: 24, textAlign: 'right', minWidth: 'clamp(150px, 12cqw, 310px)' }}>
      <div style={{ fontSize: 'clamp(36px, 3cqw, 80px)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(speed)}</div>
      <div style={{ color: 'var(--volter-accent-lime, #e4f09c)' }}>km/h</div>
      {airborne && <div style={{ marginTop: 8 }}>AIR</div>}
    </section>
    <div aria-label="Driving performance" style={{ ...panel, bottom: 24, left: 64, fontSize: 'clamp(14px, 1.15cqw, 30px)' }}>
      {fps ? `${fps.toFixed(1)} fps` : 'Arrow keys / WASD'} · ESC TO STOP
    </div>
  </div>;
}
