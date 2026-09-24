/**
 * Headless PixiJS v8 `Application` bootstrap for Node-based Pixi tests.
 *
 * `Application.init()` needs a DOM (canvas/div elements with `.style`,
 * `addEventListener`, etc.) and a frame clock (`requestAnimationFrame`) even
 * when it falls back to its `CanvasRenderer` — no real WebGL context exists
 * headlessly, so the auto-detected renderer probes for one, fails, and falls
 * back to 2D canvas rendering. Our fake 2D context no-ops every draw call;
 * nothing here attempts real rasterization, only enough surface for
 * `Application.init()` + `render()` to complete without throwing.
 *
 * This is deliberately separate from `scene-context.ts`'s `installCanvasStub`
 * (used broadly by THREE-based tests): Pixi needs a materially larger DOM
 * surface (div elements with `.style`, global `addEventListener`, a
 * `requestAnimationFrame`/`performance.now()` pair) that THREE-only tests
 * don't, and don't need to pay for.
 */

/** Minimal stand-in for a DOM element — enough surface for Pixi's
 *  `DOMPipe`/`CanvasRenderer`/`EventSystem` init paths to run without a real DOM. */
// biome-ignore lint/suspicious/noExplicitAny: a deliberately loose DOM element shape — real HTMLElement/HTMLCanvasElement typing would need a jsdom-shaped stub far bigger than this test surface needs.
function makeElement(tag: string): any {
  const el: Record<string, unknown> & { children: unknown[]; childNodes: unknown[] } = {
    tagName: tag.toUpperCase(),
    style: {},
    classList: {
      add() {},
      remove() {},
      contains: () => false,
      toggle() {},
    },
    children: [],
    childNodes: [],
    dataset: {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    removeAttribute() {},
    appendChild(child: unknown) {
      el.children.push(child);
      el.childNodes.push(child);
      return child;
    },
    removeChild(child: unknown) {
      el.children = el.children.filter((c) => c !== child);
      return child;
    },
    remove() {},
    getBoundingClientRect: () => ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    }),
    cloneNode: () => makeElement(tag),
    ownerDocument: null,
    parentNode: null,
    contains: () => false,
  };
  if (tag === 'canvas') {
    el['width'] = 0;
    el['height'] = 0;
    el['getContext'] = (kind: string) => {
      if (kind !== '2d') return null; // no webgl/webgl2/webgpu — forces the CanvasRenderer fallback
      return {
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {},
        clearRect() {},
        drawImage() {},
        fillStyle: '',
        font: '',
        textAlign: '',
        textBaseline: '',
        fillText() {},
        save() {},
        restore() {},
        scale() {},
        setTransform() {},
        resetTransform() {},
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      };
    };
  }
  return el;
}

let fakeNow = 0;
let rafCallback: ((time: number) => void) | null = null;

/** Install the headless DOM/rAF/clock stub, once per process. Idempotent —
 *  same guard style as `installCanvasStub`. */
export function installPixiHeadlessStub(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g['__vgaiPixiHeadlessStub']) return;
  g['__vgaiPixiHeadlessStub'] = true;

  g['document'] = {
    createElement: (tag: string) => makeElement(tag),
    createElementNS: (_ns: string, tag: string) => makeElement(tag),
    body: makeElement('body'),
    documentElement: makeElement('html'),
    addEventListener() {},
    removeEventListener() {},
    hidden: false,
    // The synthetic document never has id-addressed elements.
    getElementById: () => null,
  };
  g['window'] = g;
  // Modern Node already provides a real (getter-only) `navigator` global —
  // only install a stand-in if none exists.
  if (!g['navigator']) g['navigator'] = { userAgent: 'node' };
  // Bare global constructors so an `instanceof HTMLDivElement`-style check
  // (e.g. `create-runtime.ts`'s "reuse a pre-existing #example-ui" probe)
  // doesn't throw a ReferenceError — `makeElement`'s stubs are plain
  // objects, never real instances of these, so such a check still
  // (correctly) evaluates false against them.
  if (!g['HTMLElement']) g['HTMLElement'] = class HTMLElement {};
  if (!g['HTMLDivElement']) g['HTMLDivElement'] = class HTMLDivElement {};
  if (!g['HTMLCanvasElement']) g['HTMLCanvasElement'] = class HTMLCanvasElement {};
  g['addEventListener'] = g['addEventListener'] ?? (() => {});
  g['removeEventListener'] = g['removeEventListener'] ?? (() => {});

  // A fully fake, test-controlled clock: `core/game-loop.ts`'s real
  // `requestAnimationFrame` chain is driven deterministically by `pumpFrame`
  // below instead of waiting on wall-clock time. `requestAnimationFrame`
  // here only STORES the callback (never invokes it) — the loop's `frame()`
  // re-registers itself at the top of every call, so a synchronously-firing
  // stub would recurse unboundedly.
  g['performance'] = { now: () => fakeNow };
  g['requestAnimationFrame'] = (cb: (time: number) => void) => {
    rafCallback = cb;
    return 1;
  };
  g['cancelAnimationFrame'] = () => {
    rafCallback = null;
  };
}

/**
 * Advance the fake clock by `deltaMs` (default: a 60Hz fixed substep PLUS a
 * small margin) and invoke the pending `requestAnimationFrame` callback, if
 * any — drives `core/game-loop.ts`'s real accumulator loop deterministically
 * through the SAME `requestAnimationFrame`-based code path production uses
 * (no bypassing `Game.runFrame`). The margin matters: `fakeNow` is a
 * module-level running total across every `pumpFrame` call in a test file,
 * so floating-point summation drift can put a bare `1000/60`-per-call delta
 * a hair UNDER `core/game-loop.ts`'s `fixedDt` threshold after enough calls
 * — that call would then consume zero substeps (a silent no-op, not an
 * error). A small positive margin keeps every call comfortably above the
 * threshold regardless of accumulated drift, at the cost of occasionally
 * consuming 2 substeps instead of 1 in a given call (harmless for assertions
 * that only care "at least one step happened").
 */
export function pumpFrame(deltaMs = 1000 / 60 + 1): void {
  fakeNow += deltaMs;
  rafCallback?.(fakeNow);
}
