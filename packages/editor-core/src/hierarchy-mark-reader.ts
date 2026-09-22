/**
 * The one place the hierarchy panel's mark convention meets a real `Object3D`.
 *
 * `hierarchy-component-marks.ts` is deliberately pure — it takes a
 * {@link NodeMarkReader} and never learns what a node is made of — and
 * `GameHierarchy` is deliberately contract-only (rule zero: no 3D-library value
 * import). This module is the seam between them: it asks the adapter's OPTIONAL
 * `object3D` capability for the node and reads
 * `@volter/editor-threejs/adapter/hierarchy-marks`' two marks off it.
 *
 * An adapter with no `Object3D` seam (React, Pixi, DOM) yields {@link NO_MARKS},
 * which `componentMarkView` recognizes by identity and short-circuits on — so a
 * non-three surface pays nothing and renders byte-identically.
 */

import type { HierarchyProvider } from '@volter/editor-project/adapter';
import { componentRootName, isBuiltInternal } from '@volter/editor-threejs/adapter/hierarchy-marks';
import { getUserData } from '@volter/editor-threejs/ecs/user-data';
import { isComponentInstanceRoot } from './authoring/component-instance-root';
import { NO_MARKS, type NodeMarkReader, type NodeMarks } from './hierarchy-component-marks';

/** Project-local R3F source already carries its component ownership on the
 * native node. Read that existing stamp as the automatic equivalent of an
 * imperative `markComponentRoot`; explicit marks still win. */
function componentName(object: Parameters<typeof componentRootName>[0]): string | undefined {
  const explicit = componentRootName(object);
  // Some project-local components are the native authoring ENTITY constructor rather than a
  // reusable component boundary. Importers are the canonical case: `<UnityNode>` creates the
  // GameObject itself, while a generated `<Player>` prefab remains a component instance around
  // that node. `authoringRoot` is the existing generic declaration for exactly that distinction.
  // An explicit component mark still wins, so a prefab root can be both its own authoring object
  // and the boundary of the reusable prefab instance. A built-internal mark suppresses only the
  // automatic component classification: a React helper that renders implementation machinery is
  // still implementation, not a prefab merely because Fiber recorded its component boundary.
  if (
    explicit ||
    isBuiltInternal(object) ||
    getUserData(object, 'authoringRoot') === true ||
    !isComponentInstanceRoot(object)
  ) {
    return explicit;
  }
  const authored = getUserData(object, 'authoringComponent');
  return typeof authored === 'string' && authored ? authored : undefined;
}

/**
 * A memoized reader over `hierarchy.object3D`.
 *
 * The cache lives for the reader's lifetime — one render pass — because the
 * live graph it reads is re-walked every render anyway (`hierarchy.roots()` IS
 * the refresh point on a live adapter). Within one pass the marks cannot move,
 * and the walk asks for the same id many times: once per `node()` projection,
 * again per internals probe.
 */
export function markReaderFor(hierarchy: Pick<HierarchyProvider, 'object3D'>): NodeMarkReader {
  const object3D = hierarchy.object3D;
  if (typeof object3D !== 'function') return NO_MARKS;
  const cache = new Map<string, NodeMarks | undefined>();
  return (id) => {
    if (cache.has(id)) return cache.get(id);
    const object = object3D.call(hierarchy, id);
    const marks: NodeMarks | undefined = object
      ? {
          componentRoot: componentName(object),
          authoredEntity: getUserData(object, 'authoringRoot') === true,
          builtInternal: isBuiltInternal(object),
        }
      : undefined;
    cache.set(id, marks);
    return marks;
  };
}
