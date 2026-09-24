/**
 * A design root borrows the viewport's GPU for offscreen work (PMREM, cube
 * cameras, render textures). The editor owns the canvas, loop and context.
 * Fiber configuration is local to the borrower and applied only while it
 * submits work, so overlapping HMR mounts cannot restore each other's state.
 */
import {
  Color,
  type ColorRepresentation,
  Vector4,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';

export function createDesignTimeRenderer(
  canvas: HTMLCanvasElement,
  renderer: WebGLRenderer,
): WebGLRenderer {
  const noop = (): void => {};
  const owned = new Set<PropertyKey>([
    'dispose',
    'forceContextLoss',
    'forceContextRestore',
    'setAnimationLoop',
    'setSize',
    'setPixelRatio',
    'setDrawingBufferSize',
  ]);
  const writes = new Map<PropertyKey, unknown>();
  const shadowMap = { ...renderer.shadowMap };
  let xrEnabled = renderer.xr.enabled;
  const clearColor = renderer.getClearColor(new Color());
  let clearAlpha = renderer.getClearAlpha();
  let renderTarget: WebGLRenderTarget | null = null;
  let cubeFace = 0;
  let mipLevel = 0;
  const viewport = renderer.getViewport(new Vector4());
  const scissor = renderer.getScissor(new Vector4());
  let scissorTest = renderer.getScissorTest();
  let viewportAfterTarget = false;
  let scissorAfterTarget = false;
  let scissorTestAfterTarget = false;
  const copyRect = (out: Vector4, x: Vector4 | number, y?: number, w?: number, h?: number) => {
    if (typeof x === 'number') out.set(x, y!, w!, h!);
    else out.copy(x);
  };
  const xr = new Proxy(renderer.xr, {
    get(target, key) {
      if (key === 'enabled') return xrEnabled;
      if (key === 'setAnimationLoop' || key === 'addEventListener' || key === 'removeEventListener')
        return noop;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, key, value) {
      if (key === 'enabled') {
        xrEnabled = value;
        return true;
      }
      return Reflect.set(target, key, value, target);
    },
  });
  const renderLists = new Proxy(renderer.renderLists, {
    get(target, key) {
      if (key === 'dispose') return noop;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  function submit(method: (...args: unknown[]) => unknown, args: unknown[]): unknown {
    const previous = new Map<PropertyKey, unknown>();
    const previousShadows = { ...renderer.shadowMap };
    const previousXr = renderer.xr.enabled;
    const previousColor = renderer.getClearColor(new Color());
    const previousAlpha = renderer.getClearAlpha();
    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousMip = renderer.getActiveMipmapLevel();
    const previousViewport = renderer.getViewport(new Vector4());
    const previousScissor = renderer.getScissor(new Vector4());
    const previousScissorTest = renderer.getScissorTest();
    try {
      for (const [key, value] of writes) {
        previous.set(key, Reflect.get(renderer, key));
        Reflect.set(renderer, key, value);
      }
      Object.assign(renderer.shadowMap, shadowMap);
      renderer.xr.enabled = xrEnabled;
      renderer.setClearColor(clearColor, clearAlpha);
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(scissorTest);
      renderer.setRenderTarget(renderTarget, cubeFace, mipLevel);
      if (viewportAfterTarget) renderer.setViewport(viewport);
      if (scissorAfterTarget) renderer.setScissor(scissor);
      if (scissorTestAfterTarget) renderer.setScissorTest(scissorTest);
      return method.apply(renderer, args);
    } finally {
      for (const [key, value] of previous) Reflect.set(renderer, key, value);
      Object.assign(renderer.shadowMap, previousShadows);
      renderer.xr.enabled = previousXr;
      renderer.setClearColor(previousColor, previousAlpha);
      renderer.setViewport(previousViewport);
      renderer.setScissor(previousScissor);
      renderer.setScissorTest(previousScissorTest);
      renderer.setRenderTarget(previousTarget, previousFace, previousMip);
    }
  }

  const methods = new Map<PropertyKey, unknown>();
  return new Proxy(renderer, {
    get(target, key) {
      if (key === 'domElement') return canvas;
      if (key === 'shadowMap') return shadowMap;
      if (key === 'xr') return xr;
      if (key === 'renderLists') return renderLists;
      if (owned.has(key)) return noop;
      if (key === 'getRenderTarget') return () => renderTarget;
      if (key === 'getActiveCubeFace') return () => cubeFace;
      if (key === 'getActiveMipmapLevel') return () => mipLevel;
      if (key === 'setRenderTarget')
        return (value: WebGLRenderTarget | null, face = 0, mip = 0) => {
          renderTarget = value;
          cubeFace = face;
          mipLevel = mip;
          viewportAfterTarget = scissorAfterTarget = scissorTestAfterTarget = false;
        };
      if (key === 'getViewport') return (out: Vector4) => out.copy(viewport);
      if (key === 'getCurrentViewport')
        return (out: Vector4) => {
          if (renderTarget && !viewportAfterTarget) return out.copy(renderTarget.viewport);
          out.copy(viewport).multiplyScalar(renderer.getPixelRatio());
          return viewportAfterTarget ? out.round() : out.floor();
        };
      if (key === 'getScissor') return (out: Vector4) => out.copy(scissor);
      if (key === 'getScissorTest') return () => scissorTest;
      if (key === 'setViewport')
        return (x: Vector4 | number, y?: number, w?: number, h?: number) => {
          copyRect(viewport, x, y, w, h);
          viewportAfterTarget = true;
        };
      if (key === 'setScissor')
        return (x: Vector4 | number, y?: number, w?: number, h?: number) => {
          copyRect(scissor, x, y, w, h);
          scissorAfterTarget = true;
        };
      if (key === 'setScissorTest')
        return (value: boolean) => {
          scissorTest = value;
          scissorTestAfterTarget = true;
        };
      if (key === 'getClearColor') return (out: Color) => out.copy(clearColor);
      if (key === 'getClearAlpha') return () => clearAlpha;
      if (key === 'setClearColor')
        return (color: ColorRepresentation, alpha = clearAlpha) => {
          clearColor.set(color);
          clearAlpha = alpha;
        };
      if (key === 'setClearAlpha')
        return (alpha: number) => {
          clearAlpha = alpha;
        };
      if (writes.has(key)) return writes.get(key);
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      if (!methods.has(key)) {
        const gpu = /^(render|compile|clear|copy|init|readRenderTarget)/.test(String(key));
        methods.set(
          key,
          gpu
            ? (...args: unknown[]) => {
                // Fiber's final screen draw is the viewport's job. Offscreen draws
                // and clears must execute: their textures are inputs to that image.
                if ((key === 'render' || String(key).startsWith('clear')) && !renderTarget)
                  return undefined;
                return submit(value, args);
              }
            : value.bind(target),
        );
      }
      return methods.get(key);
    },
    set(_target, key, value) {
      if (key !== 'domElement') writes.set(key, value);
      return true;
    },
  });
}
