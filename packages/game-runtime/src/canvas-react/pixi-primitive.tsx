/**
 * `<PixiPrimitive>` and `adoptNow` — the canvas surface's seam for an object React did NOT create.
 *
 * ## Why this exists
 *
 * A first-party canvas world is a `@pixi/react` tree, and every element in one is built by the
 * reconciler: `createInstance` does `new PixiComponent(props)` and there is no escape hatch for an
 * existing `Container`. That is fine until something OUTSIDE React owns an object the tree has to
 * render — which is the ordinary case the moment a world has a runtime, not just a picture:
 *
 *  - a translated Godot scene's own root, written to by a script (`mob.position = …`) in the same
 *    statement sequence that constructs it, BEFORE anything has rendered;
 *  - a container a game's own module or an asset pipeline handed over whole.
 *
 * three's lane answers this with `<primitive object={…}>`. This is that element for Pixi, and the
 * three properties it must have are the three that make it not a mirror: the props go on the SAME
 * object, the children go UNDER the same object, and unmount DETACHES it rather than destroying it
 * — because React never owned it.
 *
 * ## How it is wired, and what @pixi/react actually offers
 *
 * Through `extend()`, which is @pixi/react's own documented extension point — the catalogue it
 * resolves an intrinsic tag against. A registered class is constructed with the element's props, and
 * a JS constructor that RETURNS an object hands back that object instead of the one `new` made: so
 * the element's instance IS the adopted container, and from there every host-config path is the
 * library's own (`appendChild` -> `parent.addChild`, `applyProps` -> the same property writes every
 * other element gets, `insertBefore` -> `addChildAt`). No parallel reconciler, no re-implemented
 * host config, no patched package.
 *
 * ONE path could not be wired through: `removeChild` unconditionally calls `childInstance.destroy()`
 * (`@pixi/react` 8.0.5, `lib/helpers/removeChild.mjs`), there is no per-instance opt-out, and the
 * host config is module-private (the package's `exports` map has only `"."`, so its
 * `lib/core/reconciler` cannot be imported). {@link PixiPrimitive} therefore arms a ONE-SHOT
 * `destroy` on the object in its own layout-effect cleanup — which React runs, synchronously,
 * immediately before the `removeChild` that would destroy it — and that override detaches, restores
 * the real method and is gone. It is disarmed on the next microtask regardless, so a deletion that
 * never reaches this node (React calls `removeChild` only for the OUTERMOST host node of a deleted
 * subtree) cannot leave the override installed.
 *
 * ## What `adoptNow` is for
 *
 * @pixi/react exports no reconciler `flushSync` — every `react-reconciler` instance closes over its
 * own scheduler state (`module.exports = function ($$$config) { … }`), so no second instance and no
 * other renderer can flush this one's work. A state update made from inside a frame therefore
 * commits on React's own schedule rather than inside the call that made it.
 *
 * {@link adoptNow} is what the seam CAN offer for that: the half of the guarantee that is about the
 * DISPLAY TREE rather than about React. A caller that has just created an object and asked React to
 * render it places it now, and the commit that follows is an idempotent re-adoption of the same
 * object under the same parent — `<PixiPrimitive>` renders the object the caller already placed, so
 * there is one object and one tree, never a second insertion. What it does not do is run the
 * object's own mount work early: whatever the rendering component does in its layout effect still
 * happens when React commits, and a caller that needs that ordering must say so.
 */

import { extend } from '@pixi/react';
import { Container } from 'pixi.js';
import {
  createElement,
  type FunctionComponent,
  type ReactNode,
  useLayoutEffect,
  useRef,
} from 'react';

/** The prop the adoption element carries its object on. */
const OBJECT_PROP = 'object';

/**
 * The catalogue entry, and the whole of the adoption mechanism.
 *
 * It is never instantiated: a constructor that returns an object hands that object back to the
 * caller, so `new AdoptedPixiObject({ object })` IS `object`. That is the one thing @pixi/react's
 * `createInstance` cannot do on its own and the only thing this class exists for.
 */
class AdoptedPixiObject {
  constructor(props: { readonly [OBJECT_PROP]?: unknown }) {
    const object = props[OBJECT_PROP];
    if (!(object instanceof Container)) {
      throw new Error(
        'PixiPrimitive: `object` must be a PIXI.Container (got ' +
          `${object === null ? 'null' : typeof object}). This element adopts an object the game ` +
          'already owns; it does not create one.',
      );
    }
    // `applyProps` writes every prop it is given onto the instance, and the instance here is the
    // GAME'S object. A non-enumerable accessor answers with the object and swallows that write, so
    // adoption never plants a self-reference on something the game holds.
    Object.defineProperty(object, OBJECT_PROP, {
      configurable: true,
      enumerable: false,
      get: () => object,
      set: () => {},
    });
    // The returned object IS the mechanism — see this module's header. @pixi/react's
    // `createInstance` has exactly one way to produce an element's instance
    // (`new PixiComponent(props)`), so a constructor that hands back an existing object is the only
    // door an existing one can be adopted through, and this class exists for nothing else. Nobody
    // ever reads an `AdoptedPixiObject`; the catalogue is its only caller.
    // biome-ignore lint/correctness/noConstructorReturn: adoption is exactly this return
    return object;
  }
}

extend({ VgaiAdopted: AdoptedPixiObject });

/** The intrinsic `extend` above registered. Typed as a component so this module is the ONE place
 *  that knows the tag; nothing else in the repo, and no game, ever spells it. */
const ADOPTION_ELEMENT = 'pixiVgaiAdopted' as unknown as FunctionComponent<Record<string, unknown>>;

export interface PixiPrimitiveProps {
  /** The container to adopt. It must not change for the life of one element — see below. */
  readonly object: Container;
  readonly children?: ReactNode;
  /** Everything else is an ordinary `@pixi/react` prop, applied to {@link object} itself. */
  readonly [prop: string]: unknown;
}

/**
 * Render an EXISTING `PIXI.Container` as an element of this tree.
 *
 * ```tsx
 * <PixiPrimitive object={scene.node} label={'Main'} x={0} y={0}>
 *   <pixiSprite label={'Background'} texture={background} />
 * </PixiPrimitive>
 * ```
 *
 * The props land on `scene.node`, the children become its children, and when this unmounts
 * `scene.node` leaves the display tree intact — its lifetime belongs to whoever made it.
 */
export function PixiPrimitive(props: PixiPrimitiveProps): React.JSX.Element {
  const { object, children, ...rest } = props;
  // The adopted object is the element's INSTANCE, and an instance is fixed for the life of an
  // element — a changed `object` would silently keep rendering the old one. Refuse by name instead.
  const adopted = useRef(object);
  if (adopted.current !== object) {
    throw new Error(
      'PixiPrimitive: `object` changed on a mounted element. The adopted container IS this ' +
        "element's instance, so it cannot be swapped; give the element a `key` derived from the " +
        'object instead, so React remounts it.',
    );
  }
  useLayoutEffect(() => {
    // React runs this cleanup, synchronously, just before the `removeChild` that would destroy the
    // object — see this module's header.
    return () => armDetach(object);
    // `object` is invariant for this element (asserted above), so this is once per mount.
  }, [object]);
  // An `undefined` prop is DROPPED, so absent means "keep what the game set". @pixi/react's mount
  // diff compares element props against the instance's OWN-enumerable snapshot, and for an own
  // property (a v8 `Container`'s `label`) that snapshot shows the live value — so a forwarded-but-
  // unset prop (`label={props.label}` on a spawned scene root) would diff `'Mob' -> undefined` and
  // write `undefined` onto the game's object. Dropping the key instead also gives a later
  // defined -> undefined transition the library's own REMOVAL semantics (reset to the class
  // default) rather than a literal `undefined` write.
  const applied: Record<string, unknown> = { [OBJECT_PROP]: object };
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) applied[key] = value;
  }
  return createElement(ADOPTION_ELEMENT, applied, children);
}

/**
 * Turn the next `destroy()` on `object` into a detach, then restore the real method.
 *
 * One shot and self-disarming: the override removes itself before doing anything, and a microtask
 * removes it in any case, so the window in which it can answer is exactly React's own (synchronous)
 * commit.
 */
function armDetach(object: Container): void {
  const target = object as unknown as { destroy: Container['destroy'] };
  const previous = Object.getOwnPropertyDescriptor(object, 'destroy');
  let armed = true;
  const disarm = (): void => {
    if (!armed) return;
    armed = false;
    if (previous === undefined) delete (target as Partial<typeof target>).destroy;
    else Object.defineProperty(object, 'destroy', previous);
  };
  Object.defineProperty(object, 'destroy', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: function detachInsteadOfDestroy(this: Container): void {
      disarm();
      this.removeFromParent();
    },
  });
  queueMicrotask(disarm);
}

/**
 * Put `child` under `parent` NOW, ahead of the commit that will render it.
 *
 * The canvas surface's answer to a reconciler `flushSync`, which @pixi/react does not expose (see
 * this module's header). Idempotent with {@link PixiPrimitive}: re-adopting the same object under
 * the same parent is what the commit does, and Pixi's own `addChild` treats it as a no-op reorder.
 */
export function adoptNow(parent: Container, child: Container): void {
  if (child.parent === parent) return;
  parent.addChild(child);
}
