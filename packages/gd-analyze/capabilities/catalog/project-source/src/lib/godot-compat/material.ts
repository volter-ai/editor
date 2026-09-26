import type { Material, Object3D } from 'three';
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  bindGodotResourcePath,
  duplicateGodotSubresource,
  getGodotResourceLocalToScene,
  godotResourceDuplicate,
  godotResourceEmitChanged,
  setGodotResourceLocalToScene,
} from './resource-io';

/**
 * Pinned Godot 4.7 `scene/resources/material.h`: every renderable Material shares one signed
 * priority range, one next-pass link and Resource's local-to-scene bit. Godot 3.6 exposes the same
 * priority/next-pass pair with the same -128..127 bounds. Backend materials remain Three/Pixi
 * objects; this record is only the Godot protocol attached to those real objects.
 */
export const GODOT_MATERIAL_RENDER_PRIORITY_MIN = -128;
export const GODOT_MATERIAL_RENDER_PRIORITY_MAX = 127;

export interface GodotMaterialState<TNative> {
  readonly native: TNative;
  renderPriority: number;
  nextPass: GodotMaterialState<object> | null;
}

/** Material-subclass fields layered on top of Resource's cycle-safe duplicate protocol. */
export interface GodotMaterialDuplicateProtocol<TNative extends object> {
  /** Construct a shallow native copy. Material metadata and next_pass are filled centrally. */
  createDuplicate(
    source: TNative,
    subresources: boolean,
    memo: Map<object, object>,
  ): TNative;
  /** Copy additional Resource-valued fields after the source/copy pair enters the cycle memo. */
  populateDuplicate?(
    source: TNative,
    target: TNative,
    subresources: boolean,
    memo: Map<object, object>,
  ): void;
  setupLocalToScene?(material: TNative, scene: unknown): void;
}

const materialStates = new WeakMap<object, GodotMaterialState<unknown>>();
const materialDuplicateProtocols = new WeakMap<object, GodotMaterialDuplicateProtocol<object>>();

function nativeCloneProtocol<TNative extends object>(
  native: TNative,
): GodotMaterialDuplicateProtocol<TNative> | undefined {
  const clone = Reflect.get(native, 'clone');
  if (typeof clone !== 'function') return undefined;
  return {
    createDuplicate(source, subresources, memo) {
      void subresources;
      void memo;
      const copy = Reflect.apply(clone, source, []) as unknown;
      if ((typeof copy !== 'object' || copy === null) && typeof copy !== 'function') {
        throw new TypeError('godot-compat: native Material.clone returned no object.');
      }
      return copy as TNative;
    },
  };
}

export function bindGodotMaterial<TNative extends object>(
  native: TNative,
  initial: Partial<Omit<GodotMaterialState<TNative>, 'native'>> = {},
  godotClass = 'Material',
  duplicateProtocol: GodotMaterialDuplicateProtocol<TNative> | undefined = nativeCloneProtocol(native),
): GodotMaterialState<TNative> {
  const state: GodotMaterialState<TNative> = {
    native,
    renderPriority: initial.renderPriority ?? 0,
    nextPass: initial.nextPass ?? null,
  };
  materialStates.set(native, state as GodotMaterialState<unknown>);
  if (duplicateProtocol !== undefined) {
    materialDuplicateProtocols.set(
      native,
      duplicateProtocol as GodotMaterialDuplicateProtocol<object>,
    );
  }
  registerGodotObjectIdentity(native, godotClass);
  Object.defineProperties(native, {
    render_priority: {
      configurable: true,
      enumerable: true,
      get: (): number => getMaterialRenderPriority(native),
      set: (value: number): void => setMaterialRenderPriority(native, value),
    },
    next_pass: {
      configurable: true,
      enumerable: true,
      get: (): object | null => getMaterialNextPass(native),
      set: (value: object | null): void => setMaterialNextPass(native, value),
    },
    set_render_priority: {
      configurable: true,
      value: (value: number): void => setMaterialRenderPriority(native, value),
    },
    get_render_priority: {
      configurable: true,
      value: (): number => getMaterialRenderPriority(native),
    },
    set_next_pass: {
      configurable: true,
      value: (value: object | null): void => setMaterialNextPass(native, value),
    },
    get_next_pass: {
      configurable: true,
      value: (): object | null => getMaterialNextPass(native),
    },
  });
  bindGodotResourcePath(native, '');
  bindGodotResourceProtocol(native, {
    createDuplicate(source, subresources, memo) {
      const protocol = materialDuplicateProtocols.get(source) as
        | GodotMaterialDuplicateProtocol<TNative>
        | undefined;
      if (protocol === undefined) {
        throw new Error(
          `godot-compat: ${godotClass} must register its exact native Material duplicate factory.`,
        );
      }
      const copy = protocol.createDuplicate(source, subresources, memo);
      const sourceState = godotMaterialState(source);
      const copyState = godotMaterialState(copy);
      copyState.renderPriority = sourceState.renderPriority;
      copyState.nextPass = sourceState.nextPass;
      return copy;
    },
    populateDuplicate(source, target, subresources, memo) {
      const protocol = materialDuplicateProtocols.get(source) as
        | GodotMaterialDuplicateProtocol<TNative>
        | undefined;
      const sourceState = godotMaterialState(source);
      if (subresources && sourceState.nextPass !== null) {
        const copiedNext = duplicateGodotSubresource(sourceState.nextPass.native, memo);
        godotMaterialState(target).nextPass = godotMaterialState(copiedNext);
      }
      protocol?.populateDuplicate?.(source, target, subresources, memo);
    },
    setupLocalToScene(resource, scene) {
      const protocol = materialDuplicateProtocols.get(resource) as
        | GodotMaterialDuplicateProtocol<TNative>
        | undefined;
      protocol?.setupLocalToScene?.(resource, scene);
    },
  });
  return state;
}

export function godotMaterialState<TNative extends object>(
  native: TNative,
): GodotMaterialState<TNative> {
  const existing = materialStates.get(native) as GodotMaterialState<TNative> | undefined;
  return existing ?? bindGodotMaterial(native);
}

export function getMaterialRenderPriority(native: object): number {
  return godotMaterialState(native).renderPriority;
}

export function setMaterialRenderPriority(native: object, priority: number): void {
  if (
    !Number.isInteger(priority) ||
    priority < GODOT_MATERIAL_RENDER_PRIORITY_MIN ||
    priority > GODOT_MATERIAL_RENDER_PRIORITY_MAX
  ) {
    throw new RangeError(
      `Material.render_priority must be an integer from ${GODOT_MATERIAL_RENDER_PRIORITY_MIN} ` +
        `through ${GODOT_MATERIAL_RENDER_PRIORITY_MAX}; got ${priority}.`,
    );
  }
  const state = godotMaterialState(native);
  if (state.renderPriority === priority) return;
  state.renderPriority = priority;
  godotResourceEmitChanged(native);
}

export function getMaterialRenderPriorityRange(): readonly [number, number] {
  return [GODOT_MATERIAL_RENDER_PRIORITY_MIN, GODOT_MATERIAL_RENDER_PRIORITY_MAX];
}

export function getMaterialNextPass<TNext extends object = object>(native: object): TNext | null {
  return (godotMaterialState(native).nextPass?.native as TNext | undefined) ?? null;
}

export function setMaterialNextPass(native: object, next: object | null): void {
  const state = godotMaterialState(native);
  const nextState = next === null ? null : godotMaterialState(next);
  if (state.nextPass === nextState) return;
  state.nextPass = nextState;
  godotResourceEmitChanged(native);
}

export function getMaterialResourceLocalToScene(native: object): boolean {
  return getGodotResourceLocalToScene(native);
}

export function setMaterialResourceLocalToScene(native: object, local: boolean): void {
  if (getGodotResourceLocalToScene(native) === local) return;
  setGodotResourceLocalToScene(native, local);
  godotResourceEmitChanged(native);
}

/** Exact Resource-style identity comparison; Material equality is identity, never parameter bags. */
export function isSameGodotMaterial(left: object | null, right: object | null): boolean {
  return left === right;
}

/**
 * Traverse Godot's `next_pass` chain without fabricating a renderer-owned pass graph. The caller
 * that owns a retained draw can render each returned native in order. Cycles are rejected loudly:
 * RenderingServer cannot complete an unbounded next-pass chain either.
 */
export function godotMaterialPassChain<TNative extends object>(
  first: TNative,
): readonly TNative[] {
  const result: TNative[] = [];
  const seen = new Set<object>();
  let current: TNative | null = first;
  while (current !== null) {
    if (seen.has(current)) {
      throw new Error('godot-compat: Material.next_pass contains a cycle.');
    }
    seen.add(current);
    result.push(current);
    current = getMaterialNextPass(current);
  }
  return result;
}

export function applyGodotMaterialPriority(
  object: Object3D,
  material: Material | readonly Material[],
): void {
  const materials = Array.isArray(material) ? material : [material];
  object.renderOrder = materials.reduce(
    (highest, native) => Math.max(highest, getMaterialRenderPriority(native)),
    GODOT_MATERIAL_RENDER_PRIORITY_MIN,
  );
}

export function duplicateGodotMaterial<TNative extends object>(
  native: TNative,
  clone: (value: TNative) => TNative,
  deep = false,
  godotClass = 'Material',
): TNative {
  const protocol: GodotMaterialDuplicateProtocol<TNative> = { createDuplicate: clone };
  if (!materialDuplicateProtocols.has(native)) {
    materialDuplicateProtocols.set(native, protocol as GodotMaterialDuplicateProtocol<object>);
  }
  void godotClass;
  return godotResourceDuplicate(native, deep);
}
