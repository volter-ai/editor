/**
 * THE RENDERER: mounts a piece (a React component of `@volter/dawproject` elements) into a
 * plain graph of {@link DawNode}s, the way `@pixi/react` mounts a world into Pixi containers.
 * The graph is plain data, so it crosses any realm and any worker unchanged.
 *
 * The editor stamps every JSX element of a project module with its source address (`data-oid`,
 * `@volter/editor-react`'s transform, in the editor's served graph only). The stamp arrives here
 * as an ordinary prop; each node keeps it as {@link DawNode.oid} and drops it from `props`, so a
 * node knows the exact source element it came from. A standalone render has no stamps and every
 * `oid` is `null`.
 *
 * The host config is `@pixi/react`'s shape (react-reconciler 0.31 on React 19): mutation mode,
 * no text, no suspense, and every commit publishes a fresh snapshot to the root's listeners.
 */

import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';
import Reconciler from 'react-reconciler';
import { ConcurrentRoot, DefaultEventPriority } from 'react-reconciler/constants.js';

export const OID_PROP = 'data-oid';
const TYPE_PREFIX = 'dawproject.';

export interface DawNode {
  /** The element's short name: `Project`, `Track`, `Clip`, `Note`, … */
  readonly type: string;
  readonly props: Readonly<Record<string, unknown>>;
  /** The source element this node was rendered from, or `null` outside the editor. */
  readonly oid: string | null;
  readonly children: readonly DawNode[];
}

interface Instance {
  type: string;
  props: Record<string, unknown>;
  oid: string | null;
  children: Instance[];
}

interface Container {
  children: Instance[];
  onCommit: () => void;
}

function ownProps(props: Record<string, unknown>): { props: Record<string, unknown>; oid: string | null } {
  const out: Record<string, unknown> = {};
  let oid: string | null = null;
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children') continue;
    if (key === OID_PROP) {
      oid = typeof value === 'string' ? value : null;
      continue;
    }
    out[key] = value;
  }
  return { props: out, oid };
}

function shortType(type: string): string {
  if (!type.startsWith(TYPE_PREFIX)) {
    throw new Error(
      `<${type}> is not a DAWproject element. A piece renders only @volter/dawproject's elements (Project, Transport, Track, Channel, Device, Clip, Note, Marker) and components made of them.`,
    );
  }
  return type.slice(TYPE_PREFIX.length);
}

function remove<T>(list: T[], item: T): void {
  const index = list.indexOf(item);
  if (index >= 0) list.splice(index, 1);
}

function insert<T>(list: T[], item: T, before: T): void {
  remove(list, item);
  const index = list.indexOf(before);
  list.splice(index < 0 ? list.length : index, 0, item);
}

let currentUpdatePriority = 0;

const reconciler = Reconciler({
  isPrimaryRenderer: false,
  noTimeout: -1,
  NotPendingTransition: null,
  supportsHydration: false,
  supportsMutation: true,
  supportsPersistence: false,
  warnsIfNotActing: false,
  createInstance(type: string, props: Record<string, unknown>): Instance {
    const { props: own, oid } = ownProps(props);
    return { type: shortType(type), props: own, oid, children: [] };
  },
  createTextInstance(text: string): never {
    throw new Error(`A piece renders elements, not text ("${text}").`);
  },
  appendInitialChild(parent: Instance, child: Instance) {
    parent.children.push(child);
  },
  appendChild(parent: Instance, child: Instance) {
    remove(parent.children, child);
    parent.children.push(child);
  },
  appendChildToContainer(container: Container, child: Instance) {
    remove(container.children, child);
    container.children.push(child);
  },
  insertBefore(parent: Instance, child: Instance, before: Instance) {
    insert(parent.children, child, before);
  },
  insertInContainerBefore(container: Container, child: Instance, before: Instance) {
    insert(container.children, child, before);
  },
  removeChild(parent: Instance, child: Instance) {
    remove(parent.children, child);
  },
  removeChildFromContainer(container: Container, child: Instance) {
    remove(container.children, child);
  },
  clearContainer(container: Container) {
    container.children.length = 0;
  },
  commitUpdate(instance: Instance, _type: string, _old: Record<string, unknown>, next: Record<string, unknown>) {
    const { props, oid } = ownProps(next);
    instance.props = props;
    instance.oid = oid;
  },
  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  getRootHostContext: () => ({}),
  getChildHostContext: (parent: object) => parent,
  getPublicInstance: (instance: Instance) => instance,
  prepareForCommit: () => null,
  resetAfterCommit(container: Container) {
    container.onCommit();
  },
  preparePortalMount() {},
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  getCurrentUpdatePriority: () => currentUpdatePriority,
  setCurrentUpdatePriority(priority: number) {
    currentUpdatePriority = priority;
  },
  resolveUpdatePriority: () => currentUpdatePriority || DefaultEventPriority,
  getInstanceFromNode: () => null,
  getInstanceFromScope: () => null,
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  prepareScopeUpdate() {},
  detachDeletedInstance() {},
  hideInstance() {},
  unhideInstance() {},
  hideTextInstance() {},
  unhideTextInstance() {},
  maySuspendCommit: () => false,
  preloadInstance: () => true,
  startSuspendingCommit() {},
  suspendInstance() {},
  waitForCommitToBeReady: () => null,
  resetFormInstance() {},
  requestPostPaintCallback() {},
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent() {},
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  rendererPackageName: '@volter/dawproject',
  rendererVersion: '0.5.66',
} as never);

function snapshot(instance: Instance): DawNode {
  return {
    type: instance.type,
    props: { ...instance.props },
    oid: instance.oid,
    children: instance.children.map(snapshot),
  };
}

export interface PieceRoot {
  /** The latest committed graph: the piece's single root element, or `null` before the first commit. */
  readonly current: () => DawNode | null;
  /** Re-render with a new component (the same module re-imported after an edit). */
  readonly render: (piece: ComponentType) => Promise<DawNode>;
  /** Called after every commit, including updates the piece makes itself (state, effects). */
  readonly subscribe: (listener: (graph: DawNode | null) => void) => () => void;
  readonly unmount: () => void;
}

/** Mount a piece. Resolves once the first commit has produced its graph. */
export function createPieceRoot(onError: (error: unknown) => void = console.error): PieceRoot {
  const listeners = new Set<(graph: DawNode | null) => void>();
  let latest: DawNode | null = null;
  const container: Container = {
    children: [],
    onCommit() {
      const roots = container.children;
      if (roots.length > 1) {
        onError(new Error(`A piece renders one <Project>; this one rendered ${roots.length} root elements.`));
      }
      latest = roots[0] ? snapshot(roots[0]) : null;
      for (const listener of listeners) listener(latest);
    },
  };
  // react-reconciler 0.31's runtime takes ten arguments (the three error callbacks are new in
  // React 19); the installed `@types/react-reconciler` still declares the older eight.
  const createContainer = reconciler.createContainer as unknown as (
    ...args: unknown[]
  ) => ReturnType<typeof reconciler.createContainer>;
  const fiberRoot = createContainer(
    container,
    ConcurrentRoot,
    null,
    false,
    null,
    '',
    onError,
    onError,
    onError,
    null,
  );
  const render = (piece: ComponentType): Promise<DawNode> =>
    new Promise((resolve, reject) => {
      const element: ReactNode = createElement(piece);
      reconciler.updateContainer(element, fiberRoot, null, () => {
        if (latest) resolve(latest);
        else reject(new Error('The piece rendered nothing; its default export returns a <Project>.'));
      });
    });
  return {
    current: () => latest,
    render,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    unmount() {
      reconciler.updateContainer(null, fiberRoot, null, () => undefined);
      listeners.clear();
    },
  };
}
