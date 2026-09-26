/** Surface-native schedulers for the port's input frame bracket. */
import { useTick } from '@pixi/react';
import { useFrame } from '@react-three/fiber';
import { UPDATE_PRIORITY } from 'pixi.js';
import { useEffect } from 'react';
import { ensureGodotInputMap, frameInput } from './runtime';

export interface GodotInputRigProps {
  readonly mapUrl?: string;
}

function useInputMap(mapUrl?: string): void {
  useEffect(() => ensureGodotInputMap(mapUrl), [mapUrl]);
}

/** R3F runs subscribers in ascending priority; this precedes translated `_process` at -1. */
export function GodotThreeInputRig({ mapUrl }: GodotInputRigProps = {}): null {
  useInputMap(mapUrl);
  useFrame(frameInput, -200);
  return null;
}

/** Pixi runs higher ticker priorities first; INTERACTION precedes the translated NORMAL tick. */
export function GodotCanvasInputRig({ mapUrl }: GodotInputRigProps = {}): null {
  useInputMap(mapUrl);
  useTick({ priority: UPDATE_PRIORITY.INTERACTION, callback: frameInput });
  return null;
}
