/** Exhaustive proof requirements for the game→host contract. Declarations are
 * intentionally insufficient for lifecycle, navigation, commands, state, and
 * system carriers: their consumers must produce stronger receipts. */

import { defineSeamShape } from '../seam-evidence';
import type {
  VgaiGameCommand,
  VgaiGameContract,
  VgaiGameHierarchyGroup,
  VgaiGameLifecycle,
  VgaiGameScene,
  VgaiGameScenes,
  VgaiGameStateProvider,
  VgaiGameSystemAdapters,
  VgaiGameSystemEmpty,
  VgaiGameSystems,
} from './game-contract';

export const GAME_CONTRACT_SHAPE = defineSeamShape<VgaiGameContract>()({
  contractVersion: { optional: false, kind: 'value', required: 'shape' },
  root: { optional: true, kind: 'value', required: 'effect' },
  presentation: { optional: true, kind: 'value', required: 'effect' },
  world: { optional: true, kind: 'value', required: 'effect' },
  ready: { optional: true, kind: 'value', required: 'effect' },
  lifecycle: { optional: true, kind: 'value', required: 'effect' },
  scenes: { optional: true, kind: 'value', required: 'effect' },
  systems: { optional: true, kind: 'value', required: 'operation' },
});

export const GAME_LIFECYCLE_SHAPE = defineSeamShape<VgaiGameLifecycle>()({
  start: { optional: true, kind: 'function', required: 'effect' },
  pause: { optional: true, kind: 'function', required: 'effect' },
  resume: { optional: true, kind: 'function', required: 'effect' },
  dispose: { optional: true, kind: 'function', required: 'effect' },
});

export const GAME_SCENES_SHAPE = defineSeamShape<VgaiGameScenes>()({
  list: { optional: false, kind: 'function', required: 'operation' },
  current: { optional: false, kind: 'function', required: 'operation' },
  goTo: { optional: false, kind: 'function', required: 'effect' },
});

export const GAME_SCENE_SHAPE = defineSeamShape<VgaiGameScene>()({
  id: { optional: false, kind: 'value', required: 'shape' },
  label: { optional: false, kind: 'value', required: 'shape' },
});

export const GAME_COMMAND_SHAPE = defineSeamShape<VgaiGameCommand>()({
  name: { optional: false, kind: 'value', required: 'shape' },
  description: { optional: true, kind: 'value', required: 'shape' },
  argsJsonSchema: { optional: true, kind: 'value', required: 'shape' },
  run: { optional: false, kind: 'function', required: 'effect' },
});

export const GAME_STATE_PROVIDER_SHAPE = defineSeamShape<VgaiGameStateProvider>()({
  name: { optional: false, kind: 'value', required: 'shape' },
  tier: { optional: true, kind: 'value', required: 'shape' },
  read: { optional: false, kind: 'function', required: 'operation' },
});

export const GAME_HIERARCHY_GROUP_SHAPE = defineSeamShape<VgaiGameHierarchyGroup>()({
  id: { optional: false, kind: 'value', required: 'shape' },
  label: { optional: false, kind: 'value', required: 'shape' },
  count: { optional: false, kind: 'value', required: 'operation' },
});

export const GAME_SYSTEMS_SHAPE = defineSeamShape<VgaiGameSystems>()({
  commands: { optional: true, kind: 'value', required: 'operation' },
  state: { optional: true, kind: 'value', required: 'operation' },
  hierarchy: { optional: true, kind: 'function', required: 'operation' },
  systemAdapters: { optional: true, kind: 'value', required: 'operation' },
});

export const GAME_SYSTEM_ADAPTERS_SHAPE = defineSeamShape<VgaiGameSystemAdapters>()({
  physics: { optional: true, kind: 'value', required: 'effect' },
  networking: { optional: true, kind: 'value', required: 'operation' },
  navigation: { optional: true, kind: 'value', required: 'operation' },
  audio: { optional: true, kind: 'value', required: 'effect' },
  camera: { optional: true, kind: 'value', required: 'effect' },
  renderDebug: { optional: true, kind: 'value', required: 'effect' },
});

export const GAME_SYSTEM_EMPTY_SHAPE = defineSeamShape<VgaiGameSystemEmpty>()({
  present: { optional: false, kind: 'value', required: 'shape' },
  evidence: { optional: false, kind: 'value', required: 'claim' },
});
