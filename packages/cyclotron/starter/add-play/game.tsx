// SPDX-License-Identifier: MIT
// Copyright 2026 Volter AI, Inc.

/** The game's DOM root (the manifest's `ui` root), drawn over Play from what the play script publishes. */
import { useSyncExternalStore } from 'react';
import { getGameState, subscribeGameState } from '../models/game-state';

export default function GameUI() {
  const state = useSyncExternalStore(subscribeGameState, getGameState, getGameState);
  return (
    <div style={{ position: 'absolute', left: 16, top: 16, padding: '8px 12px', borderRadius: 8, background: '#000000aa', color: 'white', font: '600 13px system-ui, sans-serif', pointerEvents: 'none' }}>
      x {state.x.toFixed(1)} m · y {state.y.toFixed(1)} m · jumps {state.jumps}
      <div style={{ marginTop: 4, fontWeight: 400, opacity: 0.8 }}>Arrows or WASD move · Space jumps</div>
    </div>
  );
}
