/** Retained Pixi MeshInstance2D over a shared 2D mesh geometry/texture resource. */

import { Container, Mesh, MeshGeometry, Texture } from 'pixi.js';

import { bindGodotCanvasNode2DApi, markInternalCanvasChild, registerCanvasNodeRelease } from './node';
import { registerGodotObjectIdentity } from './object';
import { godotRect2New, type GodotRect2 } from './rect2';
import type { GodotMultiMesh2DGeometry } from './multimesh-2d';

export type GodotMeshInstance2DResource = GodotMultiMesh2DGeometry;

export type GodotMeshInstance2D = Container & {
  mesh: GodotMeshInstance2DResource | null;
  texture: Texture | null;
  set_mesh(value: GodotMeshInstance2DResource | null): void;
  get_mesh(): GodotMeshInstance2DResource | null;
  set_texture(value: Texture | null): void;
  get_texture(): Texture | null;
  get_rect(): GodotRect2;
};

interface MeshInstance2DState {
  resource: GodotMeshInstance2DResource | null;
  textureOverride: Texture | null;
  drawable: Mesh<MeshGeometry> | null;
  released: boolean;
}

const STATES = new WeakMap<GodotMeshInstance2D, MeshInstance2DState>();

function validateResource(value: GodotMeshInstance2DResource | null): GodotMeshInstance2DResource | null {
  if (value === null) return null;
  if (typeof value !== 'object' || !(value.geometry instanceof MeshGeometry) || !(value.texture instanceof Texture)) {
    throw new TypeError('MeshInstance2D.mesh requires a retained 2D mesh geometry resource or null.');
  }
  return value;
}

function validateTexture(value: Texture | null): Texture | null {
  if (value !== null && !(value instanceof Texture)) {
    throw new TypeError('MeshInstance2D.texture requires a retained Texture2D or null.');
  }
  return value;
}

function clear(node: GodotMeshInstance2D, state: MeshInstance2DState): void {
  if (state.drawable === null) return;
  state.drawable.removeFromParent();
  state.drawable.destroy({ texture: false, textureSource: false });
  state.drawable = null;
}

function rebuild(node: GodotMeshInstance2D, state: MeshInstance2DState): void {
  clear(node, state);
  if (state.resource === null) return;
  const drawable = markInternalCanvasChild(new Mesh({
    geometry: state.resource.geometry,
    texture: state.textureOverride ?? state.resource.texture,
  }));
  state.drawable = drawable;
  node.addChild(drawable);
}

export function createGodotMeshInstance2D(
  mesh: GodotMeshInstance2DResource | null = null,
): GodotMeshInstance2D {
  const node = bindGodotCanvasNode2DApi(new Container()) as unknown as GodotMeshInstance2D;
  const state: MeshInstance2DState = {
    resource: validateResource(mesh),
    textureOverride: null,
    drawable: null,
    released: false,
  };
  STATES.set(node, state);
  Object.defineProperties(node, {
    mesh: {
      configurable: true,
      enumerable: true,
      get: () => state.resource,
      set: (value: GodotMeshInstance2DResource | null) => {
        const next = validateResource(value);
        if (next === state.resource) return;
        state.resource = next;
        rebuild(node, state);
      },
    },
    texture: {
      configurable: true,
      enumerable: true,
      get: () => state.textureOverride,
      set: (value: Texture | null) => {
        const next = validateTexture(value);
        if (next === state.textureOverride) return;
        state.textureOverride = next;
        rebuild(node, state);
      },
    },
  });
  Object.assign(node, {
    set_mesh: (value: GodotMeshInstance2DResource | null): void => { node.mesh = value; },
    get_mesh: (): GodotMeshInstance2DResource | null => state.resource,
    set_texture: (value: Texture | null): void => { node.texture = value; },
    get_texture: (): Texture | null => state.textureOverride,
    get_rect: (): GodotRect2 => {
      const bounds = state.drawable?.getLocalBounds();
      return bounds === undefined
        ? godotRect2New()
        : godotRect2New(bounds.x, bounds.y, bounds.width, bounds.height);
    },
  });
  registerGodotObjectIdentity(node, 'MeshInstance2D');
  registerCanvasNodeRelease(node, () => releaseGodotMeshInstance2D(node));
  rebuild(node, state);
  return node;
}

export function releaseGodotMeshInstance2D(node: GodotMeshInstance2D): void {
  const state = STATES.get(node);
  if (state === undefined || state.released) return;
  state.released = true;
  clear(node, state);
  state.resource = null;
  state.textureOverride = null;
  STATES.delete(node);
}
