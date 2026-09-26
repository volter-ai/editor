import { Container, Filter } from 'pixi.js';
import { bindGodotMaterial, duplicateGodotMaterial } from './material';
import { godotResourceChangedSignal, godotResourceEmitChanged } from './resource-io';
import { GodotShaderMaterial, setShaderParameter } from './shader-material';

/** Godot 3.6/4.7 `CanvasItemMaterial::BlendMode`, in source enum order. */
export const CANVAS_ITEM_BLEND_MODE = {
  MIX: 0,
  ADD: 1,
  SUB: 2,
  MUL: 3,
  PREMULT_ALPHA: 4,
  DISABLED: 5,
} as const;

/** Godot 3.6/4.7 `CanvasItemMaterial::LightMode`, in source enum order. */
export const CANVAS_ITEM_LIGHT_MODE = {
  NORMAL: 0,
  UNSHADED: 1,
  LIGHT_ONLY: 2,
} as const;

export interface GodotCanvasItemMaterialOptions {
  readonly blendMode?: number;
  readonly lightMode?: number;
  readonly particlesAnimation?: boolean;
  readonly particlesAnimHFrames?: number;
  readonly particlesAnimVFrames?: number;
  readonly particlesAnimLoop?: boolean;
}

export interface GodotCanvasItemMaterialState {
  blendMode: number;
  lightMode: number;
  particlesAnimation: boolean;
  particlesAnimHFrames: number;
  particlesAnimVFrames: number;
  particlesAnimLoop: boolean;
}

const canvasItemMaterialBrand = Symbol('GodotCanvasItemMaterial');

/**
 * Resource identity for Godot's generated canvas-item shader family. The retained Pixi node stays
 * the entity; this object is only the shared authored Resource two CanvasItems may both reference.
 */
export class GodotCanvasItemMaterial {
  readonly [canvasItemMaterialBrand] = true;
  private readonly stateValue: GodotCanvasItemMaterialState;
  private readonly consumers = new Set<Container>();

  constructor(options: GodotCanvasItemMaterialOptions = {}) {
    this.stateValue = {
      blendMode: blendMode(options.blendMode ?? CANVAS_ITEM_BLEND_MODE.MIX),
      lightMode: lightMode(options.lightMode ?? CANVAS_ITEM_LIGHT_MODE.NORMAL),
      particlesAnimation: boolean(options.particlesAnimation ?? false, 'particles_animation'),
      particlesAnimHFrames: frames(options.particlesAnimHFrames ?? 1, 'particles_anim_h_frames'),
      particlesAnimVFrames: frames(options.particlesAnimVFrames ?? 1, 'particles_anim_v_frames'),
      particlesAnimLoop: boolean(options.particlesAnimLoop ?? false, 'particles_anim_loop'),
    };
    bindGodotMaterial<GodotCanvasItemMaterial>(this, {}, 'CanvasItemMaterial', {
      createDuplicate: (source) => new GodotCanvasItemMaterial(source.state),
    });
  }

  get state(): Readonly<GodotCanvasItemMaterialState> {
    return this.stateValue;
  }

  get blend_mode(): number { return getCanvasItemMaterialBlendMode(this); }
  set blend_mode(value: number) { setCanvasItemMaterialBlendMode(this, value); }
  get light_mode(): number { return getCanvasItemMaterialLightMode(this); }
  set light_mode(value: number) { setCanvasItemMaterialLightMode(this, value); }
  get particles_animation(): boolean { return getCanvasItemMaterialParticlesAnimation(this); }
  set particles_animation(value: boolean) { setCanvasItemMaterialParticlesAnimation(this, value); }
  get particles_anim_h_frames(): number { return getCanvasItemMaterialParticlesHFrames(this); }
  set particles_anim_h_frames(value: number) { setCanvasItemMaterialParticlesHFrames(this, value); }
  get particles_anim_v_frames(): number { return getCanvasItemMaterialParticlesVFrames(this); }
  set particles_anim_v_frames(value: number) { setCanvasItemMaterialParticlesVFrames(this, value); }
  get particles_anim_loop(): boolean { return getCanvasItemMaterialParticlesLoop(this); }
  set particles_anim_loop(value: boolean) { setCanvasItemMaterialParticlesLoop(this, value); }

  set_blend_mode(value: number): void { this.blend_mode = value; }
  get_blend_mode(): number { return this.blend_mode; }
  set_light_mode(value: number): void { this.light_mode = value; }
  get_light_mode(): number { return this.light_mode; }
  set_particles_animation(value: boolean): void { this.particles_animation = value; }
  get_particles_animation(): boolean { return this.particles_animation; }
  set_particles_anim_h_frames(value: number): void { this.particles_anim_h_frames = value; }
  get_particles_anim_h_frames(): number { return this.particles_anim_h_frames; }
  set_particles_anim_v_frames(value: number): void { this.particles_anim_v_frames = value; }
  get_particles_anim_v_frames(): number { return this.particles_anim_v_frames; }
  set_particles_anim_loop(value: boolean): void { this.particles_anim_loop = value; }
  get_particles_anim_loop(): boolean { return this.particles_anim_loop; }

  bind(node: Container): void {
    applyCanvasItemMaterial(node, this.stateValue);
    this.consumers.add(node);
  }

  unbind(node: Container): void {
    this.consumers.delete(node);
  }

  sync(): void {
    for (const node of this.consumers) applyCanvasItemMaterial(node, this.stateValue);
  }

  update(changes: Partial<GodotCanvasItemMaterialState>): void {
    const next: GodotCanvasItemMaterialState = {
      blendMode: changes.blendMode === undefined ? this.stateValue.blendMode : blendMode(changes.blendMode),
      lightMode: changes.lightMode === undefined ? this.stateValue.lightMode : lightMode(changes.lightMode),
      particlesAnimation: changes.particlesAnimation === undefined ? this.stateValue.particlesAnimation : boolean(changes.particlesAnimation, 'particles_animation'),
      particlesAnimHFrames: changes.particlesAnimHFrames === undefined ? this.stateValue.particlesAnimHFrames : frames(changes.particlesAnimHFrames, 'particles_anim_h_frames'),
      particlesAnimVFrames: changes.particlesAnimVFrames === undefined ? this.stateValue.particlesAnimVFrames : frames(changes.particlesAnimVFrames, 'particles_anim_v_frames'),
      particlesAnimLoop: changes.particlesAnimLoop === undefined ? this.stateValue.particlesAnimLoop : boolean(changes.particlesAnimLoop, 'particles_anim_loop'),
    };
    for (const node of this.consumers) assertCanvasItemMaterialApplicable(next, node);
    const previous = { ...this.stateValue };
    Object.assign(this.stateValue, next);
    try {
      this.sync();
    } catch (error) {
      Object.assign(this.stateValue, previous);
      this.sync();
      throw error;
    }
    godotResourceEmitChanged(this);
  }

  duplicate(deep = false): GodotCanvasItemMaterial {
    return duplicateGodotMaterial<GodotCanvasItemMaterial>(
      this,
      (material) =>
        new GodotCanvasItemMaterial({
          blendMode: material.state.blendMode,
          lightMode: material.state.lightMode,
          particlesAnimation: material.state.particlesAnimation,
          particlesAnimHFrames: material.state.particlesAnimHFrames,
          particlesAnimVFrames: material.state.particlesAnimVFrames,
          particlesAnimLoop: material.state.particlesAnimLoop,
        }),
      deep,
      'CanvasItemMaterial',
    );
  }

  onChanged(listener: () => void): () => void {
    const connection = godotResourceChangedSignal(this).connect(listener);
    return () => connection.disconnect();
  }
}

export type GodotCanvasMaterial = GodotCanvasItemMaterial | GodotShaderMaterial;

const canvasItemMaterials = new WeakMap<Container, GodotCanvasMaterial>();
const canvasItemNativeFilters = new WeakMap<Container, Filter>();
type ParticleMaterialConsumer = (state: Readonly<GodotCanvasItemMaterialState> | null) => void;
const particleMaterialConsumers = new WeakMap<Container, ParticleMaterialConsumer>();

/**
 * Lets a native Pixi particle surface consume CanvasItemMaterial's INSTANCE_CUSTOM atlas state.
 * Ordinary CanvasItems remain unable to claim particle animation; the ownership is registered by
 * the retained ParticleContainer itself and disappears with that binding.
 */
export function registerCanvasItemParticleMaterialConsumer(
  node: Container,
  consume: ParticleMaterialConsumer,
): () => void {
  if (particleMaterialConsumers.has(node)) {
    throw new Error('CanvasItem already has a retained native particle-material consumer.');
  }
  particleMaterialConsumers.set(node, consume);
  const material = canvasItemMaterials.get(node);
  if (material instanceof GodotCanvasItemMaterial) applyCanvasItemMaterial(node, material.state);
  return () => {
    if (particleMaterialConsumers.get(node) === consume) particleMaterialConsumers.delete(node);
  };
}

/** The retained Pixi ShaderMaterial filter for a CanvasItem, when one is assigned. */
export function getCanvasItemShaderFilter(node: Container): Filter | null {
  return canvasItemNativeFilters.get(node) ?? null;
}

function blendMode(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 5) {
    throw new RangeError(`CanvasItemMaterial.blend_mode must be an integer from 0 through 5; got ${value}.`);
  }
  return value;
}

function lightMode(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 2) {
    throw new RangeError(`CanvasItemMaterial.light_mode must be an integer from 0 through 2; got ${value}.`);
  }
  return value;
}

function frames(value: number, member: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`CanvasItemMaterial.${member} must be a positive integer; got ${value}.`);
  }
  return value;
}

function boolean(value: boolean, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`CanvasItemMaterial.${member} must be bool.`);
  return value;
}

function assertCanvasItemMaterialApplicable(
  state: Readonly<GodotCanvasItemMaterialState>,
  node?: Container,
): void {
  // NORMAL/UNSHADED/LIGHT_ONLY are consumed by canvas-light-2d's retained native filter path.
  if (state.particlesAnimation && (node === undefined || !particleMaterialConsumers.has(node))) {
    throw new Error(
      'CanvasItemMaterial.particles_animation requires INSTANCE_CUSTOM-driven particle UV animation.',
    );
  }
  if (state.blendMode === CANVAS_ITEM_BLEND_MODE.SUB) {
    throw new Error(
      'CanvasItemMaterial.blend_mode SUB requires reverse-subtract SRC_ALPHA/ONE; Pixi subtract is a different advanced blend filter.',
    );
  }
  if (state.blendMode === CANVAS_ITEM_BLEND_MODE.MUL) {
    throw new Error(
      'CanvasItemMaterial.blend_mode MUL requires DST_COLOR/ZERO with DST_ALPHA/ZERO alpha.',
    );
  }
  if (state.blendMode === CANVAS_ITEM_BLEND_MODE.DISABLED) {
    throw new Error(
      'CanvasItemMaterial.blend_mode DISABLED requires an unblended ONE/ZERO attachment; Pixi none is ZERO/ZERO.',
    );
  }
}

function applyCanvasItemMaterial(
  node: Container,
  state: Readonly<GodotCanvasItemMaterialState>,
): void {
  assertCanvasItemMaterialApplicable(state, node);
  particleMaterialConsumers.get(node)?.(state);
  switch (state.blendMode) {
    case CANVAS_ITEM_BLEND_MODE.MIX:
      // Pixi's `-npm` spelling means the SOURCE is not pre-multiplied: SRC_ALPHA,
      // ONE_MINUS_SRC_ALPHA, exactly Godot canvas blend_mix.
      node.blendMode = 'normal-npm';
      return;
    case CANVAS_ITEM_BLEND_MODE.ADD:
      node.blendMode = 'add-npm';
      return;
    case CANVAS_ITEM_BLEND_MODE.PREMULT_ALPHA:
      node.blendMode = 'normal';
      return;
    case CANVAS_ITEM_BLEND_MODE.SUB:
    case CANVAS_ITEM_BLEND_MODE.MUL:
    case CANVAS_ITEM_BLEND_MODE.DISABLED:
      return;
  }
}

export function createGodotCanvasItemMaterial(
  options: GodotCanvasItemMaterialOptions = {},
): GodotCanvasItemMaterial {
  return new GodotCanvasItemMaterial(options);
}

export function isGodotCanvasItemMaterial(value: unknown): value is GodotCanvasItemMaterial {
  return (
    typeof value === 'object' &&
    value !== null &&
    canvasItemMaterialBrand in value
  );
}

export function getCanvasItemMaterial(node: Container): GodotCanvasMaterial | null {
  return canvasItemMaterials.get(node) ?? null;
}

/**
 * Resolve Godot 3's indexed `CanvasItem:material:shader_param/<name>` property chain against the
 * resource currently retained by the CanvasItem. AnimationPlayer caches the reached Resource but
 * still mutates ShaderMaterial's dynamic property; keeping that lookup here preserves later
 * material assignment and shared-resource identity without teaching translation how Pixi uniforms
 * are stored.
 */
export function setCanvasItemShaderParameter(
  node: Container,
  name: string,
  value: unknown,
): void {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('CanvasItem.material shader parameter requires a nonempty name.');
  }
  const material = canvasItemMaterials.get(node);
  if (material === undefined) {
    throw new Error(`CanvasItem.material is null; shader_param/${name} cannot be assigned.`);
  }
  if (!(material instanceof GodotShaderMaterial)) {
    throw new TypeError(
      `CanvasItem.material:shader_param/${name} requires ShaderMaterial, got CanvasItemMaterial.`,
    );
  }
  if (material.shader === null) {
    throw new Error(`CanvasItem ShaderMaterial has no Shader; shader_param/${name} cannot be assigned.`);
  }
  if (!material.hasShaderParameter(name)) {
    throw new Error(`CanvasItem ShaderMaterial has no declared shader parameter ${name}.`);
  }
  setShaderParameter(material, name, value);
}

/**
 * Godot canvas light mode for either material family. ShaderMaterial carries the same ordered
 * render-mode values as CanvasItemMaterial: `unshaded` and `light_only` write one enum slot, so the
 * last authored mode wins exactly as the renderer's mode-action walk does.
 */
export function getGodotCanvasMaterialLightMode(material: GodotCanvasMaterial | null): number {
  if (material instanceof GodotCanvasItemMaterial) return material.state.lightMode;
  if (!(material instanceof GodotShaderMaterial) || material.shader === null) {
    return CANVAS_ITEM_LIGHT_MODE.NORMAL;
  }
  let mode: number = CANVAS_ITEM_LIGHT_MODE.NORMAL;
  for (const authored of material.shader.getRenderModes()) {
    if (authored === 'unshaded') mode = CANVAS_ITEM_LIGHT_MODE.UNSHADED;
    else if (authored === 'light_only') mode = CANVAS_ITEM_LIGHT_MODE.LIGHT_ONLY;
  }
  return mode;
}

export function setCanvasItemMaterial(node: Container, material: GodotCanvasMaterial | null): void {
  const previous = canvasItemMaterials.get(node);
  if (material === previous) return;
  if (
    material !== null &&
    !(material instanceof GodotCanvasItemMaterial) &&
    !(material instanceof GodotShaderMaterial)
  ) {
    throw new TypeError('CanvasItem.material must be a CanvasItemMaterial, ShaderMaterial, or null.');
  }
  let nextFilter: Filter | undefined;
  if (material instanceof GodotCanvasItemMaterial) {
    assertCanvasItemMaterialApplicable(material.state, node);
  } else if (material instanceof GodotShaderMaterial) {
    nextFilter = material.createPixiMaterial();
  }
  if (previous instanceof GodotCanvasItemMaterial) previous.unbind(node);
  if (previous instanceof GodotCanvasItemMaterial && !(material instanceof GodotCanvasItemMaterial)) {
    particleMaterialConsumers.get(node)?.(null);
  }
  const previousFilter = canvasItemNativeFilters.get(node);
  if (previousFilter !== undefined) {
    node.filters = (node.filters ?? []).filter((one) => one !== previousFilter);
    previous instanceof GodotShaderMaterial && previous.releaseNative(previousFilter);
    previousFilter.destroy();
    canvasItemNativeFilters.delete(node);
  }
  if (material === null) {
    canvasItemMaterials.delete(node);
    node.blendMode = 'normal';
    return;
  }
  canvasItemMaterials.set(node, material);
  if (material instanceof GodotCanvasItemMaterial) {
    material.bind(node);
    return;
  }
  const filter = nextFilter!;
  canvasItemNativeFilters.set(node, filter);
  node.filters = [...(node.filters ?? []), filter];
}

export function setCanvasItemMaterialBlendMode(
  material: GodotCanvasItemMaterial,
  value: number,
): void {
  material.update({ blendMode: blendMode(value) });
}

export function getCanvasItemMaterialBlendMode(material: GodotCanvasItemMaterial): number {
  return material.state.blendMode;
}

export function setCanvasItemMaterialLightMode(
  material: GodotCanvasItemMaterial,
  value: number,
): void {
  material.update({ lightMode: lightMode(value) });
}

export function getCanvasItemMaterialLightMode(material: GodotCanvasItemMaterial): number {
  return material.state.lightMode;
}

export function setCanvasItemMaterialParticlesAnimation(
  material: GodotCanvasItemMaterial,
  value: boolean,
): void {
  material.update({ particlesAnimation: boolean(value, 'particles_animation') });
}

export function getCanvasItemMaterialParticlesAnimation(material: GodotCanvasItemMaterial): boolean {
  return material.state.particlesAnimation;
}

export function setCanvasItemMaterialParticlesHFrames(
  material: GodotCanvasItemMaterial,
  value: number,
): void {
  material.update({ particlesAnimHFrames: frames(value, 'particles_anim_h_frames') });
}

export function getCanvasItemMaterialParticlesHFrames(material: GodotCanvasItemMaterial): number {
  return material.state.particlesAnimHFrames;
}

export function setCanvasItemMaterialParticlesVFrames(
  material: GodotCanvasItemMaterial,
  value: number,
): void {
  material.update({ particlesAnimVFrames: frames(value, 'particles_anim_v_frames') });
}

export function getCanvasItemMaterialParticlesVFrames(material: GodotCanvasItemMaterial): number {
  return material.state.particlesAnimVFrames;
}

export function setCanvasItemMaterialParticlesLoop(
  material: GodotCanvasItemMaterial,
  value: boolean,
): void {
  material.update({ particlesAnimLoop: boolean(value, 'particles_anim_loop') });
}

export function getCanvasItemMaterialParticlesLoop(material: GodotCanvasItemMaterial): boolean {
  return material.state.particlesAnimLoop;
}

export function releaseCanvasItemMaterial(node: Container): void {
  setCanvasItemMaterial(node, null);
}
