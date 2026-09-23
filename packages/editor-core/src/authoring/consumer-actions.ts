import type {
  AssetDropContext,
  AuthoringAdapter,
  ComponentInstanceApplyResult,
  SpatialHandlesProvider,
  StructuralClipboardOutcome,
  StructuralIdsWrite,
  StructuralIdWrite,
  StructuralWriteOutcome,
  Transform,
  TransformChannel,
  WriteAck,
} from '@volter/editor-project/adapter';
import {
  recordAuthoringConsumerUse,
  recordAuthoringWriteConsumerUse,
} from '../coverage/authoring-seam-evidence';

export function setAuthoringSelection(
  adapter: AuthoringAdapter,
  nodeIds: readonly string[],
  options?: { intent?: 'semantic' | 'exact' },
): boolean {
  const provider = adapter.selection;
  if (!provider) return false;
  recordAuthoringConsumerUse({
    adapter,
    seam: 'editor.selection.set',
    stage: 'effect',
    detail: `the editor selected ${nodeIds.length} authoring subject(s)`,
    run: () => provider.set([...nodeIds], options),
  });
  return true;
}

export function beginAuthoringTransformEdit(adapter: AuthoringAdapter, nodeId: string): boolean {
  const provider = adapter.transforms;
  if (!provider) return false;
  recordAuthoringConsumerUse({
    adapter,
    seam: 'editor.transforms.beginEdit',
    stage: 'effect',
    detail: `the editor began a transform gesture on ${nodeId}`,
    run: () => provider.beginEdit(nodeId),
  });
  return true;
}

export function applyAuthoringTransform(
  adapter: AuthoringAdapter,
  nodeId: string,
  transform: Transform,
): boolean {
  const provider = adapter.transforms;
  if (!provider) return false;
  recordAuthoringConsumerUse({
    adapter,
    seam: 'editor.transforms.apply',
    stage: 'effect',
    detail: `the editor applied a transform to ${nodeId}`,
    run: () => provider.apply(nodeId, transform),
  });
  return true;
}

export function endAuthoringTransformEdit(
  adapter: AuthoringAdapter,
  nodeId: string,
): StructuralWriteOutcome {
  const provider = adapter.transforms;
  if (!provider) return;
  return recordAuthoringWriteConsumerUse({
    adapter,
    seam: 'editor.transforms.endEdit',
    detail: `the editor completed a transform gesture on ${nodeId}`,
    run: () => provider.endEdit(nodeId),
  });
}

export function removeAuthoringTransform(
  adapter: AuthoringAdapter,
  nodeId: string,
  channel: TransformChannel,
): StructuralWriteOutcome {
  const remove = adapter.transforms?.remove;
  if (!remove) return;
  return recordAuthoringWriteConsumerUse({
    adapter,
    seam: 'editor.transforms.remove',
    detail: `the editor removed transform ${channel} from ${nodeId}`,
    run: () => remove(nodeId, channel),
  });
}

/** The explicit Play→source gesture. Ordinary transform edits never call this;
 * the Inspector action is the sole shell consumer. */
export function commitAuthoringTransformSource(
  adapter: AuthoringAdapter,
  nodeId: string,
): StructuralWriteOutcome {
  const provider = adapter.transforms?.sourceCommit;
  if (!provider) return;
  return recordAuthoringWriteConsumerUse({
    adapter,
    seam: 'editor.transforms.sourceCommit',
    detail: `the user committed the live transform of ${nodeId} to source`,
    run: () => provider.commit(nodeId),
  });
}

/** Save one adapter-owned document through its native persistence provider.
 * A clean save may still let the provider flush bookkeeping, but it cannot
 * manufacture evidence that bytes round-tripped. Composite adapters call this
 * again at the child boundary, so one shell action records both the composite
 * and the exact dirty root that actually saved. */
export async function saveAuthoringDocument(
  adapter: AuthoringAdapter,
  detail = 'the editor saved the active authoring document',
): Promise<void> {
  const provider = adapter.persistence;
  if (!provider) return;
  if (!provider.isDirty()) {
    await provider.save();
    return;
  }
  await recordAuthoringConsumerUse({
    adapter,
    seam: 'editor.persistence.save',
    stage: 'round-trip',
    detail: `${detail} to ${provider.destination}`,
    run: () => provider.save(),
  });
}

/** Write one Inspector field through the provider that owns it and retain the
 * provider's own acknowledgement. Every Inspector-shaped surface uses this
 * action so coverage and write truth do not depend on which panel initiated
 * the same edit. */
export function setAuthoringInspectorField(
  adapter: AuthoringAdapter,
  nodeId: string,
  path: string,
  value: unknown,
): StructuralWriteOutcome {
  const provider = adapter.inspector;
  if (!provider) return;
  return recordAuthoringWriteConsumerUse({
    adapter,
    seam: 'editor.inspector.set',
    detail: `the editor wrote ${path} on ${nodeId}`,
    run: () => provider.set(nodeId, path, value),
  });
}

export function removeAuthoringInspectorField(
  adapter: AuthoringAdapter,
  nodeId: string,
  path: string,
): StructuralWriteOutcome {
  const remove = adapter.inspector?.remove;
  if (!remove) return;
  return recordAuthoringWriteConsumerUse({
    adapter,
    seam: 'editor.inspector.remove',
    detail: `the editor removed ${path} from ${nodeId}`,
    run: () => remove(nodeId, path),
  });
}

/** Route one accepted asset drop through its real adapter and retain exactly
 * the strength of the provider's own acknowledgement. Composite adapters use
 * this again at their child boundary, so per-root coverage follows ownership
 * instead of stopping at the shell router. */
export function dropAuthoringAsset(
  adapter: AuthoringAdapter,
  nodeId: string,
  assetPath: string,
  context?: AssetDropContext,
): StructuralWriteOutcome {
  const provider = adapter.assetDrop;
  if (!provider) return;
  return recordAuthoringWriteConsumerUse({
    adapter,
    seam: 'editor.assetDrop.drop',
    detail: `the editor dropped ${assetPath} on ${nodeId || 'the root'}`,
    run: () =>
      context === undefined
        ? provider.drop(nodeId, assetPath)
        : provider.drop(nodeId, assetPath, context),
  });
}

export function openAuthoringComponent(adapter: AuthoringAdapter, nodeId: string): void {
  const provider = adapter.instances;
  if (!provider?.openComponent) return;
  recordAuthoringConsumerUse({
    adapter,
    seam: 'editor.instances.openComponent',
    stage: 'effect',
    detail: `the Inspector opened the component owning ${nodeId}`,
    run: () => provider.openComponent?.(nodeId),
  });
}

export function revertAuthoringInstance(
  adapter: AuthoringAdapter,
  nodeId: string,
  paths: readonly string[],
): Promise<WriteAck | undefined> {
  const provider = adapter.instances;
  if (!provider) return Promise.resolve(undefined);
  return Promise.resolve(
    recordAuthoringWriteConsumerUse({
      adapter,
      seam: 'editor.instances.revert',
      detail: `the Inspector reverted ${paths.length} override(s) on ${nodeId}`,
      run: () => provider.revert(nodeId, paths),
    }),
  ).then((ack) => ack ?? undefined);
}

export async function applyAuthoringInstanceToComponent(
  adapter: AuthoringAdapter,
  nodeId: string,
  path: string,
): Promise<ComponentInstanceApplyResult> {
  const provider = adapter.instances;
  if (!provider) return { changed: false, message: 'This subject has no component instance.' };
  const result = await provider.applyToComponent(nodeId, path);
  await recordAuthoringWriteConsumerUse({
    adapter,
    seam: 'editor.instances.applyToComponent',
    detail: `the Inspector applied ${path} from ${nodeId} to its component`,
    run: () => result.write,
  });
  return result;
}

function structureWrite(
  adapter: AuthoringAdapter,
  verb: string,
  detail: string,
  run: () => StructuralWriteOutcome,
): StructuralWriteOutcome {
  return recordAuthoringWriteConsumerUse({
    adapter,
    seam: `editor.structure.${verb}`,
    detail,
    run,
  });
}

function structureIdWrite<Id extends string | null>(
  adapter: AuthoringAdapter,
  verb: string,
  detail: string,
  run: () => StructuralIdWrite<Id>,
): StructuralIdWrite<Id> {
  const result = recordAuthoringConsumerUse({
    adapter,
    seam: `editor.structure.${verb}`,
    stage: 'effect',
    detail,
    run,
  });
  return {
    ...result,
    ack: structureWrite(adapter, verb, detail, () => result.ack),
  };
}

export function createAuthoringNode(
  adapter: AuthoringAdapter,
  kind: string,
  parentId?: string,
): StructuralIdWrite {
  const provider = adapter.structure;
  if (!provider) return { id: '', ack: undefined };
  return structureIdWrite(
    adapter,
    'create',
    `the editor created a ${kind} under ${parentId ?? 'the document root'}`,
    () => provider.create(kind, parentId),
  );
}

export function removeAuthoringNode(
  adapter: AuthoringAdapter,
  nodeId: string,
): StructuralWriteOutcome {
  const provider = adapter.structure;
  if (!provider) return;
  return structureWrite(adapter, 'remove', `the editor removed ${nodeId}`, () =>
    provider.remove(nodeId),
  );
}

export function removeManyAuthoringNodes(
  adapter: AuthoringAdapter,
  nodeIds: readonly string[],
): StructuralWriteOutcome {
  const provider = adapter.structure;
  if (!provider?.removeMany) return;
  return structureWrite(
    adapter,
    'removeMany',
    `the editor removed ${nodeIds.length} selected node(s) as one operation`,
    () => provider.removeMany?.(nodeIds),
  );
}

export function duplicateAuthoringNode(
  adapter: AuthoringAdapter,
  nodeId: string,
): StructuralIdWrite {
  const provider = adapter.structure;
  if (!provider) return { id: nodeId, ack: undefined };
  return structureIdWrite(adapter, 'duplicate', `the editor duplicated ${nodeId}`, () =>
    provider.duplicate(nodeId),
  );
}

export function duplicateManyAuthoringNodes(
  adapter: AuthoringAdapter,
  nodeIds: readonly string[],
): StructuralWriteOutcome {
  const provider = adapter.structure;
  if (!provider?.duplicateMany) return;
  return structureWrite(adapter, 'duplicateMany',
    `the editor duplicated ${nodeIds.length} selected node(s) as one operation`,
    () => provider.duplicateMany?.(nodeIds));
}

export function reparentAuthoringNode(
  adapter: AuthoringAdapter,
  nodeId: string,
  parentId: string | null,
): StructuralWriteOutcome {
  const provider = adapter.structure;
  if (!provider) return;
  return structureWrite(
    adapter,
    'reparent',
    `the editor reparented ${nodeId} under ${parentId ?? 'the document root'}`,
    () => provider.reparent(nodeId, parentId),
  );
}

export function reorderAuthoringNode(
  adapter: AuthoringAdapter,
  nodeId: string,
  beforeSiblingId: string | null,
): StructuralWriteOutcome {
  const provider = adapter.structure;
  if (!provider?.reorder) return;
  return structureWrite(
    adapter,
    'reorder',
    `the editor reordered ${nodeId} before ${beforeSiblingId ?? 'the end'}`,
    () => provider.reorder?.(nodeId, beforeSiblingId),
  );
}

export function wrapAuthoringNode(
  adapter: AuthoringAdapter,
  nodeId: string,
  wrapperTag?: string,
): StructuralWriteOutcome {
  const provider = adapter.structure;
  if (!provider?.wrap) return;
  return structureWrite(adapter, 'wrap', `the editor wrapped ${nodeId}`, () =>
    provider.wrap?.(nodeId, wrapperTag),
  );
}

export function unwrapAuthoringNode(
  adapter: AuthoringAdapter,
  nodeId: string,
): StructuralWriteOutcome {
  const provider = adapter.structure;
  if (!provider?.unwrap) return;
  return structureWrite(adapter, 'unwrap', `the editor unwrapped ${nodeId}`, () =>
    provider.unwrap?.(nodeId),
  );
}

export function groupAuthoringNodes(
  adapter: AuthoringAdapter,
  nodeIds: readonly string[],
): StructuralIdWrite<string | null> {
  const provider = adapter.structure;
  if (!provider?.group) return { id: null, ack: undefined };
  return structureIdWrite(
    adapter,
    'group',
    `the editor grouped ${nodeIds.length} selected node(s)`,
    () => provider.group?.(nodeIds) ?? { id: null, ack: undefined },
  );
}

export function ungroupAuthoringNode(
  adapter: AuthoringAdapter,
  nodeId: string,
): StructuralIdsWrite {
  const provider = adapter.structure;
  if (!provider?.ungroup) return { ids: [], ack: undefined };
  const result = recordAuthoringConsumerUse({
    adapter,
    seam: 'editor.structure.ungroup',
    stage: 'effect',
    detail: `the editor ungrouped ${nodeId}`,
    run: () => provider.ungroup?.(nodeId) ?? { ids: [], ack: undefined },
  });
  return {
    ...result,
    ack: structureWrite(adapter, 'ungroup', `the editor ungrouped ${nodeId}`, () => result.ack),
  };
}

export async function copyAuthoringNodes(
  adapter: AuthoringAdapter,
  nodeIds: readonly string[],
): Promise<boolean> {
  const provider = adapter.structure;
  if (!provider?.copy) return false;
  return await recordAuthoringConsumerUse({
    adapter,
    seam: 'editor.structure.copy',
    stage: 'effect',
    detail: `the editor copied ${nodeIds.length} selected node(s)`,
    run: () => provider.copy?.(nodeIds) ?? false,
  });
}

async function clipboardStructureWrite(
  adapter: AuthoringAdapter,
  verb: 'cut' | 'paste',
  detail: string,
  run: () => StructuralClipboardOutcome,
): Promise<false | WriteAck> {
  const outcome = await recordAuthoringConsumerUse({
    adapter,
    seam: `editor.structure.${verb}`,
    stage: 'effect',
    detail,
    run,
  });
  if (outcome === false) return false;
  await structureWrite(adapter, verb, detail, () => outcome);
  return outcome;
}

export function cutAuthoringNodes(
  adapter: AuthoringAdapter,
  nodeIds: readonly string[],
): Promise<false | WriteAck> {
  const provider = adapter.structure;
  if (!provider?.cut) return Promise.resolve(false);
  return clipboardStructureWrite(
    adapter,
    'cut',
    `the editor cut ${nodeIds.length} selected node(s)`,
    () => provider.cut?.(nodeIds) ?? false,
  );
}

export function pasteAuthoringNodes(
  adapter: AuthoringAdapter,
  parentId: string | null,
): Promise<false | WriteAck> {
  const provider = adapter.structure;
  if (!provider?.paste) return Promise.resolve(false);
  return clipboardStructureWrite(
    adapter,
    'paste',
    `the editor pasted nodes under ${parentId ?? 'the document root'}`,
    () => provider.paste?.(parentId) ?? false,
  );
}

/**
 * ADAPTER-OWNED SPATIAL HANDLES, evidence-recorded — the same consumer wrapper
 * every seam above gets, for the provider the 3D viewport raycasts.
 *
 * It lives HERE rather than beside the DOM world overlay it was written next
 * to (`components/world-overlay-gestures.ts`) because its OTHER caller is
 * `editor-viewport.ts`, and that surface must not import the overlay's graph:
 * the overlay reaches the composite adapter, the react-world adapter and the
 * UI source inspector, which is 124 files for a WeakMap and three recorded
 * calls (ARCHITECTURE-CORE §Editor chrome, "the viewport stack is separable").
 * Nothing about the wrapper was overlay-specific; this is its family.
 */
const recordedSpatialHandles = new WeakMap<
  AuthoringAdapter,
  { readonly provider: SpatialHandlesProvider; readonly recorded: SpatialHandlesProvider }
>();

/** Stable evidence-aware view of adapter-owned spatial handles. */
export function spatialHandlesForAdapter(owner: AuthoringAdapter): SpatialHandlesProvider | null {
  const provider = owner.spatialHandles;
  if (!provider) return null;
  const cached = recordedSpatialHandles.get(owner);
  if (cached?.provider === provider) return cached.recorded;
  const recorded: SpatialHandlesProvider = {
    layers: (id) =>
      recordAuthoringConsumerUse({
        adapter: owner,
        seam: 'editor.spatialHandles.layers',
        stage: 'operation',
        detail: `the viewport read adapter-owned spatial layers for ${id}`,
        run: () => provider.layers(id),
      }),
    preview: (id, handleId, worldPosition) =>
      recordAuthoringConsumerUse({
        adapter: owner,
        seam: 'editor.spatialHandles.preview',
        stage: 'effect',
        detail: `the viewport previewed spatial handle ${handleId} for ${id}`,
        run: () => provider.preview(id, handleId, worldPosition),
      }),
    commit: (id, handleId, worldPosition) =>
      recordAuthoringWriteConsumerUse({
        adapter: owner,
        seam: 'editor.spatialHandles.commit',
        detail: `the viewport committed spatial handle ${handleId} for ${id}`,
        run: () => provider.commit(id, handleId, worldPosition),
      }),
  };
  recordedSpatialHandles.set(owner, { provider, recorded });
  return recorded;
}
