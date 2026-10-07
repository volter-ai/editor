// SPDX-License-Identifier: MIT
// Copyright 2026 Volter AI, Inc.
import { useSyncExternalStore } from 'react';
import { getRaceState, subscribeRaceState } from '../models/race-state';
import { RaceHud } from './race-hud';

export default function GameUI() {
  const state = useSyncExternalStore(subscribeRaceState, getRaceState, getRaceState);
  return <RaceHud {...state} />;
}
