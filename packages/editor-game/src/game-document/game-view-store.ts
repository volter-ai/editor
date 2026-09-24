/**
 * THE GAME DOCUMENT'S SHARED VIEW STATE — resolution and scale, read by the
 * document's CONTENT (which owns the canvas resize/scale math) and written by
 * its document-local TOOLBAR (the resolution/device pickers). A tiny
 * module-scope store in the house `useSyncExternalStore` shape, session-scoped.
 *
 * It moved out of the host with the Game document itself (WORK.md §The
 * workbench, P3b); `ResolutionPicker` stayed behind because the host's story
 * documents read it, so it is reached through the `@editor/*` alias.
 */

import { RESOLUTIONS, type Resolution } from '../host/components/ResolutionPicker';
import { type DevicePreset, setDevicePreset } from './device-preview';

// --- Game document view state (W2, inventory row V4) -----------------------
// Resolution/scale are shared between the Game document's CONTENT (which
// owns the canvas resize/scale math) and its document-local TOOLBAR (which
// hosts the picker + mute, §6.3 "Game mute/resolution controls appear only
// in the Game document") — a tiny module-scope store in the house
// `useSyncExternalStore` shape, session-scoped like the old GamePanel state.

let _gameResolution: Resolution = { label: 'Fill', width: null, height: null };
let _gameScale = 1;
let _gameViewVersion = 0;
const _gameViewListeners = new Set<() => void>();

export function notifyGameView(): void {
  _gameViewVersion++;
  for (const fn of _gameViewListeners) fn();
}

export function subscribeGameView(fn: () => void): () => void {
  _gameViewListeners.add(fn);
  return () => {
    _gameViewListeners.delete(fn);
  };
}

export const gameViewVersion = () => _gameViewVersion;

/** The Game document's current resolution selection (exported for tests). */
export function gameDocumentResolution(): Resolution {
  return _gameResolution;
}

/** Set the Game document's resolution (exported for tests). */
export function setGameDocumentResolution(resolution: Resolution): void {
  _gameResolution = resolution;
  notifyGameView();
}

/** What the toolbar's resolution button SHOWS. The presentation precedence
 *  lives in `resolvePresentedSize`; this is its display twin: an explicit
 *  pick (device preset / resolution) already carries its numbers, but when
 *  the store still says Fill and the project declares a `resolution`, the
 *  declared size is what is actually on screen — so it is what the bar must
 *  say. (Exported for tests.) */
export function displayedGameResolution(
  picked: Resolution,
  declared: { width: number; height: number } | undefined,
): Resolution {
  if (picked.width !== null || !declared) return picked;
  return {
    label: `Project — ${declared.width}×${declared.height}`,
    width: declared.width,
    height: declared.height,
  };
}

/** Menu entries for the Game toolbar's picker. With a declared resolution,
 *  "Fill" is unreachable by design (`resolvePresentedSize` puts the declared
 *  size back the moment nothing else is picked), so offering it would be a
 *  lie — the declared entry stands in its place. */
export function gameResolutionOptions(
  declared: { width: number; height: number } | undefined,
): Resolution[] {
  if (!declared) return RESOLUTIONS;
  return [
    displayedGameResolution({ label: 'Fill', width: null, height: null }, declared),
    ...RESOLUTIONS.filter((r) => r.width !== null),
  ];
}

/** One entry point for "a device preset was chosen" (dropdown pick AND
 *  per-project restore): the device-preview store takes the preset (DPR,
 *  safe-area, touch policy) and the shared game-resolution store takes its
 *  CSS resolution, so the existing GamePanel letterbox/scale path applies. */
export function applyGameDevicePreset(preset: DevicePreset): void {
  setDevicePreset(preset.id);
  setGameDocumentResolution(
    preset.width === null || preset.height === null
      ? { label: 'Fill', width: null, height: null }
      : { label: preset.label, width: preset.width, height: preset.height },
  );
}

export function setGameScale(scale: number): void {
  if (scale === _gameScale) return;
  _gameScale = scale;
  notifyGameView();
}

/** The scale the content last fitted the game at — what the toolbar's
 *  percentage readout shows. */
export function gameDocumentScale(): number {
  return _gameScale;
}
