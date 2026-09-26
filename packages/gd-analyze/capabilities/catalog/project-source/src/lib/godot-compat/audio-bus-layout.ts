/**
 * AudioBusLayout Resource semantics over the port's native Web Audio graph.
 *
 * The serialized `_bus/<index>/*` rows are decoded before this boundary. This module owns the
 * mutable Resource identity and hands the native `AudioNode` effects straight to audio-graph;
 * it does not introduce an engine-side mixer wrapper.
 */

import type { GodotAudioEffectChain } from './audio-effects';
import {
  type GodotAudioBusSpec,
  type GodotAudioGraph,
} from './audio-graph';
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceEmitChanged,
} from './resource-io';

export type GodotAudioBusNativeEffect = AudioNode | GodotAudioEffectChain;

export interface GodotAudioBusLayoutEffect {
  effect: GodotAudioBusNativeEffect;
  enabled: boolean;
}

export interface GodotAudioBusLayoutBus {
  name: string;
  volumeDb: number;
  mute: boolean;
  bypassFx: boolean;
  send: string;
  readonly effects: GodotAudioBusLayoutEffect[];
}

export interface GodotAudioBusLayout {
  readonly buses: GodotAudioBusLayoutBus[];
}

export interface GodotAudioBusLayoutInput {
  readonly name: string;
  readonly volumeDb?: number;
  readonly mute?: boolean;
  readonly bypassFx?: boolean;
  readonly send?: string;
  readonly effects?: readonly GodotAudioBusLayoutEffect[];
}

function requireDb(value: number, member: string): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value === Number.POSITIVE_INFINITY) {
    throw new Error(`AudioBusLayout.${member} requires a decibel value or -Infinity.`);
  }
  return value;
}

function requireName(value: string, member: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`AudioBusLayout.${member} requires a nonempty StringName.`);
  }
  return value;
}

function requireBus(layout: GodotAudioBusLayout, index: number, member: string): GodotAudioBusLayoutBus {
  if (!Number.isSafeInteger(index) || index < 0 || index >= layout.buses.length) {
    throw new Error(`AudioBusLayout.${member} bus index ${String(index)} is out of range.`);
  }
  return layout.buses[index]!;
}

function requireEffect(
  layout: GodotAudioBusLayout,
  busIndex: number,
  effectIndex: number,
  member: string,
): GodotAudioBusLayoutEffect {
  const effects = requireBus(layout, busIndex, member).effects;
  if (!Number.isSafeInteger(effectIndex) || effectIndex < 0 || effectIndex >= effects.length) {
    throw new Error(`AudioBusLayout.${member} effect index ${String(effectIndex)} is out of range.`);
  }
  return effects[effectIndex]!;
}

function normalizeBus(input: GodotAudioBusLayoutInput, index: number): GodotAudioBusLayoutBus {
  const name = requireName(input.name, `bus ${index} name`);
  return {
    name,
    volumeDb: requireDb(input.volumeDb ?? 0, `bus ${index} volume_db`),
    mute: input.mute ?? false,
    bypassFx: input.bypassFx ?? false,
    send: index === 0 ? '' : (input.send ?? 'Master'),
    effects: (input.effects ?? []).map((effect) => ({ ...effect })),
  };
}

function validateLayout(layout: GodotAudioBusLayout): void {
  if (layout.buses.length === 0 || layout.buses[0]?.name !== 'Master') {
    throw new Error('AudioBusLayout bus 0 must be Master.');
  }
  const names = new Set<string>();
  for (const [index, bus] of layout.buses.entries()) {
    requireName(bus.name, `bus ${index} name`);
    requireDb(bus.volumeDb, `bus ${index} volume_db`);
    if (names.has(bus.name)) throw new Error(`AudioBusLayout has duplicate bus ${JSON.stringify(bus.name)}.`);
    names.add(bus.name);
    if (index === 0 && bus.send !== '') throw new Error('AudioBusLayout Master cannot send to another bus.');
    if (index > 0 && !names.has(bus.send) && !layout.buses.some((candidate) => candidate.name === bus.send)) {
      throw new Error(`AudioBusLayout bus ${JSON.stringify(bus.name)} sends to missing bus ${JSON.stringify(bus.send)}.`);
    }
  }
}

export function createGodotAudioBusLayout(
  inputs: readonly GodotAudioBusLayoutInput[] = [{ name: 'Master' }],
): GodotAudioBusLayout {
  const layout: GodotAudioBusLayout = { buses: inputs.map(normalizeBus) };
  validateLayout(layout);
  registerGodotObjectIdentity(layout, 'AudioBusLayout');
  return bindGodotResourceProtocol(layout, {
    createDuplicate(source) {
      return createGodotAudioBusLayout(source.buses.map((bus) => ({
        name: bus.name,
        volumeDb: bus.volumeDb,
        mute: bus.mute,
        bypassFx: bus.bypassFx,
        send: bus.send,
      })));
    },
    populateDuplicate(source, target, subresources, memo) {
      for (let busIndex = 0; busIndex < source.buses.length; busIndex += 1) {
        const sourceEffects = source.buses[busIndex]!.effects;
        target.buses[busIndex]!.effects.push(...sourceEffects.map((entry) => ({
          enabled: entry.enabled,
          effect: subresources ? duplicateGodotSubresource(entry.effect, memo) : entry.effect,
        })));
      }
    },
  });
}

export const getAudioBusLayoutBusCount = (layout: GodotAudioBusLayout): number => layout.buses.length;

export function addAudioBusLayoutBus(layout: GodotAudioBusLayout, atPosition = -1): void {
  if (!Number.isSafeInteger(atPosition) || atPosition < -1 || atPosition > layout.buses.length) {
    throw new Error(`AudioBusLayout.add_bus position ${String(atPosition)} is invalid.`);
  }
  let suffix = layout.buses.length;
  const names = new Set(layout.buses.map((bus) => bus.name));
  while (names.has(`Bus ${suffix}`)) suffix += 1;
  const bus = normalizeBus({ name: `Bus ${suffix}` }, layout.buses.length);
  if (atPosition === -1 || atPosition === layout.buses.length) layout.buses.push(bus);
  else layout.buses.splice(Math.max(1, atPosition), 0, bus);
  godotResourceEmitChanged(layout);
}

export function removeAudioBusLayoutBus(layout: GodotAudioBusLayout, index: number): void {
  if (index === 0) throw new Error('AudioBusLayout cannot remove the Master bus.');
  const removed = requireBus(layout, index, 'remove_bus');
  layout.buses.splice(index, 1);
  for (const bus of layout.buses) if (bus.send === removed.name) bus.send = 'Master';
  godotResourceEmitChanged(layout);
}

export function moveAudioBusLayoutBus(layout: GodotAudioBusLayout, from: number, to: number): void {
  if (from === 0 || to === 0) throw new Error('AudioBusLayout cannot move the Master bus.');
  const bus = requireBus(layout, from, 'move_bus');
  if (!Number.isSafeInteger(to) || to < 1 || to >= layout.buses.length) {
    throw new Error(`AudioBusLayout.move_bus destination ${String(to)} is out of range.`);
  }
  if (from === to) return;
  layout.buses.splice(from, 1);
  layout.buses.splice(to, 0, bus);
  godotResourceEmitChanged(layout);
}

export function setAudioBusLayoutBusName(layout: GodotAudioBusLayout, index: number, name: string): void {
  const bus = requireBus(layout, index, 'set_bus_name');
  const next = requireName(name, 'set_bus_name');
  if (layout.buses.some((candidate, candidateIndex) => candidateIndex !== index && candidate.name === next)) {
    throw new Error(`AudioBusLayout already contains bus ${JSON.stringify(next)}.`);
  }
  if (bus.name === next) return;
  const previous = bus.name;
  bus.name = next;
  for (const candidate of layout.buses) if (candidate.send === previous) candidate.send = next;
  godotResourceEmitChanged(layout);
}

export const getAudioBusLayoutBusName = (layout: GodotAudioBusLayout, index: number): string =>
  requireBus(layout, index, 'get_bus_name').name;

export function setAudioBusLayoutBusVolumeDb(layout: GodotAudioBusLayout, index: number, volumeDb: number): void {
  const bus = requireBus(layout, index, 'set_bus_volume_db');
  const next = requireDb(volumeDb, 'set_bus_volume_db');
  if (bus.volumeDb === next) return;
  bus.volumeDb = next;
  godotResourceEmitChanged(layout);
}

export const getAudioBusLayoutBusVolumeDb = (layout: GodotAudioBusLayout, index: number): number =>
  requireBus(layout, index, 'get_bus_volume_db').volumeDb;

export function setAudioBusLayoutBusMute(layout: GodotAudioBusLayout, index: number, mute: boolean): void {
  const bus = requireBus(layout, index, 'set_bus_mute');
  if (bus.mute === mute) return;
  bus.mute = mute;
  godotResourceEmitChanged(layout);
}

export function setAudioBusLayoutBusBypassEffects(layout: GodotAudioBusLayout, index: number, bypass: boolean): void {
  const bus = requireBus(layout, index, 'set_bus_bypass_effects');
  if (bus.bypassFx === bypass) return;
  bus.bypassFx = bypass;
  godotResourceEmitChanged(layout);
}

export function setAudioBusLayoutBusSend(layout: GodotAudioBusLayout, index: number, send: string): void {
  if (index === 0) throw new Error('AudioBusLayout Master cannot send to another bus.');
  const bus = requireBus(layout, index, 'set_bus_send');
  if (!layout.buses.some((candidate) => candidate.name === send)) {
    throw new Error(`AudioBusLayout.set_bus_send cannot find bus ${JSON.stringify(send)}.`);
  }
  if (bus.send === send) return;
  bus.send = send;
  godotResourceEmitChanged(layout);
}

export function addAudioBusLayoutEffect(
  layout: GodotAudioBusLayout,
  busIndex: number,
  effect: GodotAudioBusNativeEffect,
  atPosition = -1,
): void {
  const effects = requireBus(layout, busIndex, 'add_bus_effect').effects;
  if (!Number.isSafeInteger(atPosition) || atPosition < -1 || atPosition > effects.length) {
    throw new Error(`AudioBusLayout.add_bus_effect position ${String(atPosition)} is invalid.`);
  }
  const entry = { effect, enabled: true };
  if (atPosition === -1 || atPosition === effects.length) effects.push(entry);
  else effects.splice(atPosition, 0, entry);
  godotResourceEmitChanged(layout);
}

export function removeAudioBusLayoutEffect(layout: GodotAudioBusLayout, busIndex: number, effectIndex: number): void {
  const effects = requireBus(layout, busIndex, 'remove_bus_effect').effects;
  requireEffect(layout, busIndex, effectIndex, 'remove_bus_effect');
  effects.splice(effectIndex, 1);
  godotResourceEmitChanged(layout);
}

export function setAudioBusLayoutEffectEnabled(
  layout: GodotAudioBusLayout,
  busIndex: number,
  effectIndex: number,
  enabled: boolean,
): void {
  const effect = requireEffect(layout, busIndex, effectIndex, 'set_bus_effect_enabled');
  if (effect.enabled === enabled) return;
  effect.enabled = enabled;
  godotResourceEmitChanged(layout);
}

export function audioBusLayoutSpecs(layout: GodotAudioBusLayout): readonly GodotAudioBusSpec[] {
  validateLayout(layout);
  return layout.buses.map((bus) => ({
    name: bus.name,
    volumeDb: bus.volumeDb,
    mute: bus.mute,
    send: bus.send,
  }));
}

/** Apply retained layout state directly to the native graph and return exact effect cleanups. */
export function applyGodotAudioBusLayout(graph: GodotAudioGraph, layout: GodotAudioBusLayout): () => void {
  graph.configureBuses(audioBusLayoutSpecs(layout));
  const removeEffects: (() => void)[] = [];
  for (const bus of layout.buses) {
    if (bus.bypassFx) continue;
    for (const entry of bus.effects) {
      if (entry.enabled) removeEffects.push(graph.insertBusEffect(bus.name, entry.effect));
    }
  }
  return () => {
    for (let index = removeEffects.length - 1; index >= 0; index -= 1) removeEffects[index]!();
  };
}
