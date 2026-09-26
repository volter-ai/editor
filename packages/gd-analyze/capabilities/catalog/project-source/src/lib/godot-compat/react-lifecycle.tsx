/**
 * React composition boundary for Godot's Node lifecycle: generated scene components seat their
 * script attachments on the native hierarchy they mounted, and `node.ts` applies Godot's
 * enter/ready/exit ordering in the host's own layout-effect phase.
 *
 * @godot-class Node
 * @role PROTOCOL
 * @source main/main.cpp:4495-4560 (autoloads added to root before the main scene)
 * @source scene/main/node.cpp:323-455 (enter/ready/exit propagation order)
 * Pinned revision 5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88 (Godot 4.7).
 */

import {
  createContext,
  createElement,
  type PropsWithChildren,
  type RefObject,
  useContext,
  useLayoutEffect,
  useRef,
} from 'react';
import {
  type GodotScriptLifecycleBinding,
  godot_node_pending_children,
  mountGodotScriptForest,
  mountGodotScriptTree,
} from './node';
import { godot_tree_root } from './scene-tree';

export interface GodotScriptTreeAttachment {
  readonly root: object;
  readonly bindings: readonly GodotScriptLifecycleBinding[];
  readonly release: () => void;
}

interface GodotStartupRegistration extends GodotScriptTreeAttachment {
  readonly sequence: number;
}

interface GodotStartupBatch {
  register(attachment: GodotScriptTreeAttachment): () => void;
}

const GodotStartupContext = createContext<GodotStartupBatch | null>(null);

function contains(root: object, sought: object): boolean {
  if (root === sought) return true;
  const children = (root as { readonly children?: readonly object[] }).children ?? [];
  return children.some((child) => contains(child, sought));
}

function outermostRoots(registrations: readonly GodotStartupRegistration[]): readonly object[] {
  return registrations
    .filter(
      (candidate) =>
        registrations.some(
          (other) => other !== candidate && contains(other.root, candidate.root),
        ) === false,
    )
    .map((registration) => registration.root);
}

/**
 * React composition boundary for Godot's one project-startup lifecycle transaction.
 *
 * Descendant scene/autoload components retain their own native refs and script instances. This
 * context collects only their mount-time native identities and callbacks. Once every descendant
 * exists, generated project composition may wire its exact typed cross-root fields through
 * `prepare`; compat then applies Godot's cross-root enter/ready/exit ordering. No hierarchy or
 * registration survives unmount.
 *
 * @godot Node (protocol)
 * @source main/main.cpp:4495-4560 (autoloads added to root)
 * @source main/main.cpp:4764 (then the main scene)
 */
export function GodotProjectStartup({
  children,
  prepare,
}: PropsWithChildren<{ readonly prepare?: () => void }>) {
  const registrations = useRef<GodotStartupRegistration[]>([]);
  const nextSequence = useRef(0);
  const prepareOnMount = useRef(prepare);
  const batch = useRef<GodotStartupBatch | null>(null);
  batch.current ??= {
    register(attachment): () => void {
      const registration = { ...attachment, sequence: nextSequence.current++ };
      registrations.current.push(registration);
      return () => {
        const index = registrations.current.indexOf(registration);
        if (index >= 0) registrations.current.splice(index, 1);
      };
    },
  };

  useLayoutEffect(() => {
    const mounted = [...registrations.current].sort(
      (left, right) => left.sequence - right.sequence,
    );
    prepareOnMount.current?.();
    // Every scene mounted under the tree root enters, scripted or not (`Main::start` adds the
    // autoloads, then the main scene, to the root); a registered root outside them enters too.
    const treeRoot = godot_tree_root();
    const pending = treeRoot === undefined ? [] : godot_node_pending_children(treeRoot);
    const roots = [
      ...pending,
      ...outermostRoots(mounted).filter((root) => !pending.some((scene) => contains(scene, root))),
    ];
    const releaseLifecycle = mountGodotScriptForest(
      roots,
      mounted.flatMap((registration) => registration.bindings),
    );
    return () => {
      releaseLifecycle();
      for (let index = mounted.length - 1; index >= 0; index -= 1) mounted[index]!.release();
    };
  }, []);

  return createElement(GodotStartupContext.Provider, { value: batch.current }, children);
}

/**
 * Seat one generated scene's retained script attachments on its native hierarchy.
 *
 * At project startup the enclosing batch owns notification ordering. A scene mounted later has no
 * enclosing startup context, so the same hook mounts its real native subtree immediately.
 *
 * @godot Node (protocol)
 * @source scene/main/node.cpp:341-362 (a node added to the tree enters, then readies, at once)
 */
export function useGodotScriptTreeAttachment<Native extends object>(
  root: RefObject<Native | null>,
  attach: () => Omit<GodotScriptTreeAttachment, 'root'>,
): void {
  const startup = useContext(GodotStartupContext);
  useLayoutEffect(() => {
    const nativeRoot = root.current;
    if (nativeRoot === null) return;
    const attachment = { root: nativeRoot, ...attach() };
    if (startup !== null) return startup.register(attachment);
    const releaseLifecycle = mountGodotScriptTree(attachment.root, attachment.bindings);
    return () => {
      releaseLifecycle();
      attachment.release();
    };
  }, []);
}
