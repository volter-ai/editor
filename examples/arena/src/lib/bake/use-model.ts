import { useMemo } from 'react';
import type * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

/**
 * THE SEAM BETWEEN A MODEL BUILDER AND A PREFAB.
 *
 * A game authors a 3D asset as a builder returning an Object3D — that is what
 * `project.bake.preview` photographs in isolation and what `project.bake`
 * bakes. To place one in a world it has to become an R3F component, and until
 * this existed the engine offered no way across that gap, so every project
 * hand-rolled the same three decisions: build once or per instance, clone or
 * duplicate, and how to hold the result across renders.
 *
 * The obvious hand-rolled answer is wrong, and wrong SILENTLY:
 *
 *     const model = useMemo(() => build(), []);   // <- stale after any edit
 *
 * React Fast Refresh re-renders a mounted component rather than remounting it,
 * and deliberately preserves hook state. An empty dep array therefore survives
 * every hot update, so the component goes on handing out the Object3D built
 * from the module version before the edit. The new geometry is built correctly
 * and nothing ever asks for it. Nothing errors; the model simply stops
 * changing, which reads as "HMR is broken" and sends people to restart the
 * host — the failure that motivated this file.
 *
 * `useModel` keys its cache on the BUILDER ITSELF. A hot update re-executes the
 * module that defines the builder, which mints a new function identity, so the
 * dep changes exactly when the source changed and at no other time.
 *
 * Instances share buffers: the builder runs once per builder identity, and each
 * caller gets a `clone()`, which copies the scene graph while sharing geometry
 * and material by reference. A hall with ten of a machine pays for ten graph
 * entries and one set of buffers.
 *
 *     function Scanner(props: ThreeElements['group']) {
 *       const model = useModel(buildScanner);
 *       return <group {...props}><primitive object={model} /></group>;
 *     }
 *
 * Disposal is deliberately NOT done here. The shared source outlives any one
 * component, and clones share its buffers, so disposing on unmount would free
 * geometry still in use by every sibling. A project that spawns and destroys
 * models at runtime owns that lifetime itself — `disposeObject3D` is next door.
 */
const sources = new WeakMap<() => THREE.Object3D, THREE.Object3D>();

/** Build (or reuse) a model and return an instance of it, HMR-correct. */
export function useModel(build: () => THREE.Object3D): THREE.Object3D {
  return useMemo(() => instantiate(build), [build]);
}

/**
 * The same thing outside React, for callers placing models imperatively. Kept
 * beside the hook rather than duplicated, so both share one cache.
 */
export function instantiate(build: () => THREE.Object3D): THREE.Object3D {
  let source = sources.get(build);
  if (!source) {
    source = build();
    sources.set(build, source);
  }
  return cloneModel(source);
}

/**
 * Clone a built model — and use `SkeletonUtils` when it is RIGGED.
 *
 * `Object3D.clone()` copies the meshes and the bones but NOT the bone↔skeleton
 * wiring: the copied `SkinnedMesh` keeps a reference to the ORIGINAL's
 * `THREE.Skeleton`, so it is driven by the original's bones and the clone's own
 * bones drive nothing. One instance animates and every other stands frozen —
 * with no error anywhere, because nothing is broken, only pointed elsewhere.
 * This is the same trap the 3D-assets skill names for a baked GLB
 * ("a SKINNED GLB must be cloned with `SkeletonUtils.clone`"); it applies to a
 * model MODULE for exactly the same reason, and `useModel` is the seam every
 * model module reaches a scene through.
 *
 * Measured by the adventurer driver: a story wound its clip onto the clone's
 * bones and the character rendered its REST pose in every variant.
 *
 * `animations` is carried across too. Three's clone drops the field, and the
 * model-file contract puts a model's clips on `root.animations` — a prefab
 * that could not read them would have to rebuild them, which is a second
 * implementation of the thing the module already shipped.
 */
function cloneModel(source: THREE.Object3D): THREE.Object3D {
  let rigged = false;
  source.traverse((object) => {
    if ((object as THREE.SkinnedMesh).isSkinnedMesh === true) rigged = true;
  });
  const copy = rigged ? cloneSkeleton(source) : source.clone();
  if (source.animations.length > 0) copy.animations = source.animations;
  return copy;
}
