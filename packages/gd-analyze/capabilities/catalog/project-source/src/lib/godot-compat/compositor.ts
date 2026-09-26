import { registerGodotObjectIdentity } from './object';

export const GODOT_COMPOSITOR_EFFECT_CALLBACK_TYPE = {
  PRE_OPAQUE: 0,
  POST_OPAQUE: 1,
  POST_SKY: 2,
  PRE_TRANSPARENT: 3,
  POST_TRANSPARENT: 4,
  CALLBACK_TYPE_PRE_OPAQUE: 0,
  CALLBACK_TYPE_POST_OPAQUE: 1,
  CALLBACK_TYPE_POST_SKY: 2,
  CALLBACK_TYPE_PRE_TRANSPARENT: 3,
  CALLBACK_TYPE_POST_TRANSPARENT: 4,
  CALLBACK_TYPE_MAX: 5,
} as const;

export type GodotCompositorEffectCallbackType = 0 | 1 | 2 | 3 | 4;

export interface GodotCompositorFrameContext {
  readonly frame: number;
  readonly delta: number;
  readonly color: unknown;
  readonly depth: unknown;
  readonly motionVectors: unknown;
  readonly normalRoughness: unknown;
  readonly separateSpecular: unknown;
  readonly renderSceneBuffers: GodotRenderSceneBuffers;
  readonly renderSceneData: GodotRenderSceneData;
}

export interface GodotRenderSceneBuffers {
  readonly internalSize: { readonly x: number; readonly y: number };
  readonly targetSize: { readonly x: number; readonly y: number };
  readonly viewCount: number;
  readonly colorTexture: unknown;
  readonly depthTexture: unknown;
  readonly velocityTexture: unknown;
  getTexture(context: string, name: string): unknown;
  hasTexture(context: string, name: string): boolean;
  createTexture(context: string, name: string, dataFormat: number, usageBits: number, textureSamples: number, size: { x: number; y: number }, layers: number, mipmaps: number, unique: boolean): unknown;
  clearContext(context: string): void;
}

export interface GodotRenderSceneData {
  readonly cameraAttributes: unknown;
  readonly cameraTransform: unknown;
  readonly cameraProjection: unknown;
  readonly previousCameraTransform: unknown;
  readonly previousCameraProjection: unknown;
  readonly camProjection: unknown;
  readonly camTransform: unknown;
}

export interface GodotCompositorEffect {
  readonly __godotClass: 'CompositorEffect';
  enabled: boolean;
  effect_callback_type: GodotCompositorEffectCallbackType;
  access_resolved_color: boolean;
  access_resolved_depth: boolean;
  needs_motion_vectors: boolean;
  needs_normal_roughness: boolean;
  needs_separate_specular: boolean;
  render(context: GodotCompositorFrameContext): void | Promise<void>;
}

export interface GodotCompositor {
  readonly __godotClass: 'Compositor';
  compositor_effects: GodotCompositorEffect[];
}

interface EffectState {
  listeners: Set<(effect: GodotCompositorEffect, member: string) => void>;
  renderer: ((context: GodotCompositorFrameContext) => void | Promise<void>) | null;
}

interface CompositorState {
  listeners: Set<(compositor: GodotCompositor) => void>;
}

const EFFECT_STATE = new WeakMap<GodotCompositorEffect, EffectState>();
const COMPOSITOR_STATE = new WeakMap<GodotCompositor, CompositorState>();

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: CompositorEffect.${member} requires bool.`);
  return value;
}

function callbackType(value: unknown): GodotCompositorEffectCallbackType {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 4) {
    throw new RangeError('godot-compat: CompositorEffect.effect_callback_type requires a mode in [0, 4].');
  }
  return value as GodotCompositorEffectCallbackType;
}

function effectProperty(
  effect: GodotCompositorEffect,
  member: string,
  initial: unknown,
  normalize: (value: unknown) => unknown,
): void {
  let retained = normalize(initial);
  Object.defineProperty(effect, member, {
    enumerable: true,
    configurable: true,
    get: () => retained,
    set: (value: unknown) => {
      retained = normalize(value);
      for (const listener of EFFECT_STATE.get(effect)?.listeners ?? []) listener(effect, member);
    },
  });
}

export function createGodotCompositorEffect(
  renderer: ((context: GodotCompositorFrameContext) => void | Promise<void>) | null = null,
): GodotCompositorEffect {
  const effect = {
    __godotClass: 'CompositorEffect' as const,
    render(context: GodotCompositorFrameContext): void | Promise<void> {
      return EFFECT_STATE.get(effect)?.renderer?.(context);
    },
  } as GodotCompositorEffect;
  EFFECT_STATE.set(effect, { listeners: new Set(), renderer });
  effectProperty(effect, 'enabled', true, (value) => bool(value, 'enabled'));
  effectProperty(effect, 'effect_callback_type', 0, callbackType);
  for (const member of [
    'access_resolved_color', 'access_resolved_depth', 'needs_motion_vectors',
    'needs_normal_roughness', 'needs_separate_specular',
  ] as const) effectProperty(effect, member, false, (value) => bool(value, member));
  registerGodotObjectIdentity(effect, 'CompositorEffect');
  return effect;
}

function requireEffect(value: unknown): GodotCompositorEffect {
  if (typeof value !== 'object' || value === null || (value as { __godotClass?: unknown }).__godotClass !== 'CompositorEffect') {
    throw new TypeError('godot-compat: Compositor.compositor_effects requires CompositorEffect resources.');
  }
  return value as GodotCompositorEffect;
}

function effects(value: unknown): GodotCompositorEffect[] {
  if (!Array.isArray(value)) throw new TypeError('godot-compat: Compositor.compositor_effects requires Array[CompositorEffect].');
  return value.map(requireEffect);
}

export function createGodotCompositor(initialEffects: readonly GodotCompositorEffect[] = []): GodotCompositor {
  const compositor = { __godotClass: 'Compositor' as const } as GodotCompositor;
  let retained = effects(initialEffects);
  Object.defineProperty(compositor, 'compositor_effects', {
    enumerable: true,
    configurable: true,
    get: () => [...retained],
    set: (value: unknown) => {
      retained = effects(value);
      for (const listener of COMPOSITOR_STATE.get(compositor)?.listeners ?? []) listener(compositor);
    },
  });
  COMPOSITOR_STATE.set(compositor, { listeners: new Set() });
  registerGodotObjectIdentity(compositor, 'Compositor');
  return compositor;
}

export function setGodotCompositorEffectRenderer(
  effect: GodotCompositorEffect,
  renderer: ((context: GodotCompositorFrameContext) => void | Promise<void>) | null,
): void {
  const state = EFFECT_STATE.get(effect);
  if (state === undefined) throw new TypeError('godot-compat: renderer requires a CompositorEffect resource.');
  if (renderer !== null && typeof renderer !== 'function') {
    throw new TypeError('godot-compat: CompositorEffect renderer requires Callable or null.');
  }
  state.renderer = renderer;
}

export function watchGodotCompositorEffect(
  effect: GodotCompositorEffect,
  listener: (effect: GodotCompositorEffect, member: string) => void,
): () => void {
  const state = EFFECT_STATE.get(effect);
  if (state === undefined) throw new TypeError('godot-compat: watch requires a CompositorEffect resource.');
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function watchGodotCompositor(
  compositor: GodotCompositor,
  listener: (compositor: GodotCompositor) => void,
): () => void {
  const state = COMPOSITOR_STATE.get(compositor);
  if (state === undefined) throw new TypeError('godot-compat: watch requires a Compositor resource.');
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function getGodotCompositorEffects(compositor: GodotCompositor): GodotCompositorEffect[] {
  return compositor.compositor_effects;
}

export function setGodotCompositorEffects(compositor: GodotCompositor, value: unknown): void {
  compositor.compositor_effects = effects(value);
}

export function getGodotCompositorEffectEnabled(effect: GodotCompositorEffect): boolean { return effect.enabled; }
export function setGodotCompositorEffectEnabled(effect: GodotCompositorEffect, value: unknown): void { effect.enabled = bool(value, 'enabled'); }
export function getGodotCompositorEffectCallbackType(effect: GodotCompositorEffect): GodotCompositorEffectCallbackType { return effect.effect_callback_type; }
export function setGodotCompositorEffectCallbackType(effect: GodotCompositorEffect, value: unknown): void { effect.effect_callback_type = callbackType(value); }

export async function runGodotCompositorStage(
  compositor: GodotCompositor | null,
  stage: GodotCompositorEffectCallbackType,
  context: GodotCompositorFrameContext,
): Promise<void> {
  if (compositor === null) return;
  const type = callbackType(stage);
  for (const effect of compositor.compositor_effects) {
    if (!effect.enabled || effect.effect_callback_type !== type) continue;
    await effect.render(context);
  }
}

export function createGodotRenderSceneBuffers(input: {
  internalSize: { x: number; y: number };
  targetSize: { x: number; y: number };
  viewCount?: number;
  colorTexture?: unknown;
  depthTexture?: unknown;
  velocityTexture?: unknown;
  textures?: Map<string, unknown>;
  createTexture?: GodotRenderSceneBuffers['createTexture'];
}): GodotRenderSceneBuffers {
  const textures = input.textures ?? new Map<string, unknown>();
  const key = (context: string, name: string) => `${context}/${name}`;
  const size = (value: { x: number; y: number }) => Object.freeze({
    x: Math.max(1, Math.trunc(value.x)), y: Math.max(1, Math.trunc(value.y)),
  });
  const buffers: GodotRenderSceneBuffers = {
    internalSize: size(input.internalSize),
    targetSize: size(input.targetSize),
    viewCount: Math.max(1, Math.trunc(input.viewCount ?? 1)),
    colorTexture: input.colorTexture ?? null,
    depthTexture: input.depthTexture ?? null,
    velocityTexture: input.velocityTexture ?? null,
    getTexture(context, name) { return textures.get(key(context, name)) ?? null; },
    hasTexture(context, name) { return textures.has(key(context, name)); },
    createTexture(context, name, dataFormat, usageBits, textureSamples, textureSize, layers, mipmaps, unique) {
      if (input.createTexture === undefined) {
        throw new Error('godot-compat: RenderSceneBuffersRD.create_texture requires a native rendering-device allocator.');
      }
      const texture = input.createTexture.call(buffers, context, name, dataFormat, usageBits, textureSamples, textureSize, layers, mipmaps, unique);
      textures.set(key(context, name), texture);
      return texture;
    },
    clearContext(context) {
      const prefix = `${context}/`;
      for (const name of textures.keys()) if (name.startsWith(prefix)) textures.delete(name);
    },
  };
  registerGodotObjectIdentity(buffers, 'RenderSceneBuffersRD');
  return buffers;
}

export function createGodotRenderSceneData(input: Partial<GodotRenderSceneData> = {}): GodotRenderSceneData {
  const data = Object.freeze({
    cameraAttributes: input.cameraAttributes ?? null,
    cameraTransform: input.cameraTransform ?? null,
    cameraProjection: input.cameraProjection ?? null,
    previousCameraTransform: input.previousCameraTransform ?? null,
    previousCameraProjection: input.previousCameraProjection ?? null,
    camProjection: input.camProjection ?? input.cameraProjection ?? null,
    camTransform: input.camTransform ?? input.cameraTransform ?? null,
  });
  registerGodotObjectIdentity(data, 'RenderSceneDataRD');
  return data;
}
