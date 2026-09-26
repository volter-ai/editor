/** Thin R3F lifecycle mount for copied Godot post-processing compat. */

import { useFrame, useThree } from '@react-three/fiber';
import {
  applyWorldRendererConfig,
  type WorldRendererConfig,
} from '@volter/threejs-runtime/adapter/renderer-config';
import { EffectComposer } from 'postprocessing';
import { useEffect, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  addExactGodotEnvironmentPasses,
  type GodotPostEffectConfig,
} from '../godot-compat/environment-post-processing';

export type { WorldRendererConfig } from '@volter/threejs-runtime/adapter/renderer-config';
export type {
  GodotColorAdjustments,
  GodotGlowConfig,
  GodotPostEffectConfig,
} from '../godot-compat/environment-post-processing';

/** Shared R3F apply/restore lifecycle; generated worlds own only the authored config literal. */
export function GodotRendererPipeline({ config }: { readonly config: WorldRendererConfig }): null {
  const renderer = useThree((state) => state.gl);
  useEffect(() => applyWorldRendererConfig(THREE, renderer, config), [config, renderer]);
  return null;
}

export function GodotPostProcessing({ effect }: { readonly effect: GodotPostEffectConfig }): null {
  const renderer = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const composer = useRef<EffectComposer | null>(null);

  useLayoutEffect(() => {
    if (typeof renderer.getSize !== 'function') return;
    const previousAutoClear = renderer.autoClear;
    const next = new EffectComposer(renderer, { multisampling: 0 });
    addExactGodotEnvironmentPasses(next, scene, camera, effect);
    next.setSize(size.width, size.height);
    composer.current = next;
    return () => {
      if (composer.current === next) composer.current = null;
      next.dispose();
      renderer.autoClear = previousAutoClear;
    };
  }, [renderer, scene, camera, effect]);

  useEffect(() => {
    composer.current?.setSize(size.width, size.height);
  }, [size.width, size.height]);

  useFrame((_state, delta) => composer.current?.render(delta), 1);
  return null;
}
