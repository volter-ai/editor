/**
 * Projects an ingested game's declared semantic hierarchy groups onto the
 * ordinary AuthoringAdapter hierarchy. The shell remains content-blind: the
 * game supplies ids, labels, and live counts; this decorator only translates
 * them into EditorNode currency and keeps the captured render tree available
 * under one explicitly named folder.
 */

import type { AuthoringAdapter, EditorNode, HierarchyProvider } from '@volter/editor-project/adapter';
import type {
  VgaiGameHierarchyGroup,
  VgaiGameHierarchyProvider,
} from '@volter/editor-project/adapter/ingest/game-contract';
import { editorConsole } from '@volter/editor-core/editor-console';

const GROUP_PREFIX = 'contract-hierarchy:group:';
const RENDER_TREE_ID = 'contract-hierarchy:render-tree';

function groupNodeId(id: string): string {
  return `${GROUP_PREFIX}${encodeURIComponent(id)}`;
}

function groupNode(group: VgaiGameHierarchyGroup): EditorNode {
  return {
    id: groupNodeId(group.id),
    label: group.label,
    secondaryLabel: `${group.count} ${group.count === 1 ? 'item' : 'items'}`,
    role: 'folder',
    kind: 'group',
    parentId: null,
    childIds: [],
  };
}

function assertGroups(value: unknown): VgaiGameHierarchyGroup[] {
  if (!Array.isArray(value)) throw new Error('hierarchy() did not return an array');
  const ids = new Set<string>();
  for (const group of value) {
    if (
      typeof group !== 'object' ||
      group === null ||
      typeof group.id !== 'string' ||
      group.id.trim().length === 0 ||
      typeof group.label !== 'string' ||
      group.label.trim().length === 0 ||
      typeof group.count !== 'number' ||
      !Number.isInteger(group.count) ||
      group.count < 0
    ) {
      throw new Error('hierarchy() returned an invalid { id, label, count } group');
    }
    if (ids.has(group.id)) throw new Error(`hierarchy() returned duplicate id "${group.id}"`);
    ids.add(group.id);
  }
  return value;
}

/** Identity-preserving when the game declares no hierarchy surface. */
export function withContractHierarchy(
  base: AuthoringAdapter,
  provider: VgaiGameHierarchyProvider | undefined,
): AuthoringAdapter {
  if (!provider) return base;

  let warned = false;
  const groups = (): VgaiGameHierarchyGroup[] => {
    try {
      return assertGroups(provider());
    } catch (error) {
      if (!warned) {
        warned = true;
        editorConsole.warn(
          `Ignored invalid game-contract hierarchy: ${error instanceof Error ? error.message : String(error)}`,
          'ingest',
        );
      }
      return [];
    }
  };

  const roots = () => {
    const semantic = groups();
    const rendered = base.hierarchy.roots();
    if (semantic.length === 0) return rendered;
    return [
      ...semantic.map(groupNode),
      {
        id: RENDER_TREE_ID,
        label: 'Rendered objects',
        secondaryLabel: 'live tree',
        role: 'folder',
        kind: 'group',
        parentId: null,
        childIds: rendered.map((node) => node.id),
      },
    ];
  };
  const node = (id: string) => {
    const semantic = groups();
    const group = semantic.find((candidate) => groupNodeId(candidate.id) === id);
    if (group) return groupNode(group);
    if (semantic.length > 0 && id === RENDER_TREE_ID) {
      const rendered = base.hierarchy.roots();
      return {
        id: RENDER_TREE_ID,
        label: 'Rendered objects',
        secondaryLabel: 'live tree',
        role: 'folder',
        kind: 'group',
        parentId: null,
        childIds: rendered.map((node) => node.id),
      };
    }
    const rendered = base.hierarchy.node(id);
    return semantic.length > 0 && rendered?.parentId === null
      ? { ...rendered, parentId: RENDER_TREE_ID }
      : rendered;
  };
  const hierarchy = new Proxy(base.hierarchy, {
    get(target, property) {
      if (property === 'roots') return roots;
      if (property === 'node') return node;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) satisfies HierarchyProvider;
  const subscribe = (listener: () => void): (() => void) => {
    const unsubscribeBase = base.subscribe?.(listener);
    const unsubscribeContract = provider.subscribe?.(listener);
    return () => {
      unsubscribeBase?.();
      unsubscribeContract?.();
    };
  };

  return new Proxy(base, {
    get(target, property) {
      if (property === 'hierarchy') return hierarchy;
      if (property === 'subscribe') return subscribe;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
