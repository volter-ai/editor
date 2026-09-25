import type { AuthoringAdapter, EditorNode, PropertyDescriptor } from '@volter/editor-project/adapter';
import { setAuthoringInspectorField } from './authoring/consumer-actions';
import { forEachHierarchyNode } from './hierarchy-walk';

export const LIGHT_EXPLORER_PATHS = {
  enabled: 'visible',
  color: 'light.color',
  intensity: 'light.intensity',
  range: 'light.distance',
  shadows: 'shadow.cast',
} as const;

export type LightExplorerField = keyof typeof LIGHT_EXPLORER_PATHS;

export interface LightExplorerCell<T> {
  readonly supported: boolean;
  readonly writable: boolean;
  readonly value: T | null;
}

export interface LightExplorerRow {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly enabled: LightExplorerCell<boolean>;
  readonly color: LightExplorerCell<string>;
  readonly intensity: LightExplorerCell<number>;
  readonly range: LightExplorerCell<number>;
  readonly shadows: LightExplorerCell<boolean>;
}

interface HierarchyWithInternals {
  /** Optional editor-side hierarchy projection used by component-owning
   * adapters. These are still real adapter nodes; they are merely folded out
   * of the ordinary tree until a person asks to reveal implementation parts. */
  internalChildren?(id: string): EditorNode[] | undefined;
}

function lightNodes(adapter: AuthoringAdapter): EditorNode[] {
  const result: EditorNode[] = [];
  const hierarchyWithInternals = adapter as AuthoringAdapter & HierarchyWithInternals;
  forEachHierarchyNode(
    adapter.hierarchy,
    (node) => {
      if (node.kind === 'light') result.push(node);
    },
    { extraChildren: (id) => hierarchyWithInternals.internalChildren?.(id) },
  );
  return result;
}

export function activeLightCount(adapter: AuthoringAdapter): number {
  return lightNodes(adapter).length;
}

function descriptorFor(
  descriptors: readonly PropertyDescriptor[],
  field: LightExplorerField,
): PropertyDescriptor | null {
  return descriptors.find((descriptor) => descriptor.path === LIGHT_EXPLORER_PATHS[field]) ?? null;
}

function cell<T>(
  adapter: AuthoringAdapter,
  id: string,
  descriptors: readonly PropertyDescriptor[],
  field: LightExplorerField,
  accept: (value: unknown) => value is T,
): LightExplorerCell<T> {
  const descriptor = descriptorFor(descriptors, field);
  if (!descriptor || !adapter.inspector) {
    return { supported: false, writable: false, value: null };
  }
  let value: unknown;
  try {
    value = adapter.inspector.get(id, descriptor.path);
  } catch {
    value = undefined;
  }
  return {
    supported: true,
    writable: descriptor.readonly !== true,
    value: accept(value) ? value : null,
  };
}

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function lightExplorerRows(adapter: AuthoringAdapter): LightExplorerRow[] {
  return lightNodes(adapter).map((node) => {
    let descriptors: readonly PropertyDescriptor[] = [];
    try {
      descriptors = adapter.inspector?.properties(node.id) ?? [];
    } catch {
      // A broken per-node inspector must not take the scene-wide inventory down.
    }
    const nativeType = adapter.hierarchy.object3D?.(node.id)?.type;
    return {
      id: node.id,
      name: node.label,
      type: node.typeLabel ?? nativeType ?? 'Light',
      enabled: cell(adapter, node.id, descriptors, 'enabled', isBoolean),
      color: cell(adapter, node.id, descriptors, 'color', isString),
      intensity: cell(adapter, node.id, descriptors, 'intensity', isNumber),
      range: cell(adapter, node.id, descriptors, 'range', isNumber),
      shadows: cell(adapter, node.id, descriptors, 'shadows', isBoolean),
    };
  });
}

export function setLightExplorerField(
  adapter: AuthoringAdapter,
  ids: readonly string[],
  field: LightExplorerField,
  value: unknown,
): number {
  if (!adapter.inspector) return 0;
  let changed = 0;
  for (const id of ids) {
    let descriptor: PropertyDescriptor | null = null;
    try {
      descriptor = descriptorFor(adapter.inspector.properties(id), field);
    } catch {
      continue;
    }
    if (!descriptor || descriptor.readonly) continue;
    setAuthoringInspectorField(adapter, id, descriptor.path, value);
    changed++;
  }
  return changed;
}
