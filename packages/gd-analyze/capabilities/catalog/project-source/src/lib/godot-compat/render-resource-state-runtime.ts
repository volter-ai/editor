export type RenderResourceQueue = "graphics" | "compute" | "transfer";
export type RenderResourceLayout = "undefined" | "general" | "shader_read" | "color_attachment" | "depth_attachment" | "transfer_source" | "transfer_destination" | "present";
export type RenderResourceAccess = "none" | "read" | "write" | "read_write";

export interface RenderSubresourceRange {
  baseMip?: number;
  mipCount?: number;
  baseLayer?: number;
  layerCount?: number;
}

export interface RenderResourceState {
  layout: RenderResourceLayout;
  access: RenderResourceAccess;
  queue: RenderResourceQueue;
  stage: string;
}

export interface RenderResourceTransition {
  resourceId: string;
  range: Required<RenderSubresourceRange>;
  before: RenderResourceState;
  after: RenderResourceState;
  queueTransfer: boolean;
  discard: boolean;
}

export interface RenderTrackedResourceDescriptor {
  id: string;
  mipCount?: number;
  layerCount?: number;
  initialState?: Partial<RenderResourceState>;
}

export interface RenderPassResourceUse {
  resourceId: string;
  range?: RenderSubresourceRange;
  layout: RenderResourceLayout;
  access: RenderResourceAccess;
  queue: RenderResourceQueue;
  stage: string;
  discard?: boolean;
}

export interface RenderResourceHazard {
  resourceId: string;
  range: Required<RenderSubresourceRange>;
  kind: "read_after_write" | "write_after_read" | "write_after_write" | "queue_transfer" | "layout_transition";
  previous: RenderResourceState;
  next: RenderResourceState;
}

export interface RenderPassTransitionPlan {
  passId: string;
  transitions: RenderResourceTransition[];
  hazards: RenderResourceHazard[];
}

interface TrackedResource {
  descriptor: Required<Omit<RenderTrackedResourceDescriptor, "initialState">>;
  states: RenderResourceState[][];
}

const DEFAULT_STATE: RenderResourceState = { layout: "undefined", access: "none", queue: "graphics", stage: "top" };

function cloneState(state: RenderResourceState): RenderResourceState {
  return { ...state };
}

function fullRange(resource: TrackedResource, range: RenderSubresourceRange = {}): Required<RenderSubresourceRange> {
  const baseMip = range.baseMip ?? 0;
  const baseLayer = range.baseLayer ?? 0;
  const mipCount = range.mipCount ?? resource.descriptor.mipCount - baseMip;
  const layerCount = range.layerCount ?? resource.descriptor.layerCount - baseLayer;
  if (!Number.isInteger(baseMip) || !Number.isInteger(mipCount) || baseMip < 0 || mipCount < 1 || baseMip + mipCount > resource.descriptor.mipCount) {
    throw new Error(`Mip range is invalid for resource ${resource.descriptor.id}`);
  }
  if (!Number.isInteger(baseLayer) || !Number.isInteger(layerCount) || baseLayer < 0 || layerCount < 1 || baseLayer + layerCount > resource.descriptor.layerCount) {
    throw new Error(`Layer range is invalid for resource ${resource.descriptor.id}`);
  }
  return { baseMip, mipCount, baseLayer, layerCount };
}

function isWrite(access: RenderResourceAccess): boolean {
  return access === "write" || access === "read_write";
}

function isRead(access: RenderResourceAccess): boolean {
  return access === "read" || access === "read_write";
}

export class RenderResourceStateRuntime {
  private readonly resources = new Map<string, TrackedResource>();

  register(descriptor: RenderTrackedResourceDescriptor): void {
    if (!descriptor.id) throw new Error("Tracked render resource id cannot be empty");
    if (this.resources.has(descriptor.id)) throw new Error(`Render resource ${descriptor.id} is already tracked`);
    const mipCount = descriptor.mipCount ?? 1;
    const layerCount = descriptor.layerCount ?? 1;
    if (!Number.isInteger(mipCount) || mipCount < 1 || !Number.isInteger(layerCount) || layerCount < 1) {
      throw new Error("Tracked resource dimensions must be positive integers");
    }
    const initial = { ...DEFAULT_STATE, ...descriptor.initialState };
    this.resources.set(descriptor.id, {
      descriptor: { id: descriptor.id, mipCount, layerCount },
      states: Array.from({ length: layerCount }, () => Array.from({ length: mipCount }, () => cloneState(initial))),
    });
  }

  unregister(id: string): boolean {
    return this.resources.delete(id);
  }

  state(id: string, mip = 0, layer = 0): RenderResourceState {
    const resource = this.requireResource(id);
    if (!resource.states[layer]?.[mip]) throw new Error(`Subresource ${id}[${layer}:${mip}] is out of range`);
    return cloneState(resource.states[layer][mip]);
  }

  transition(use: RenderPassResourceUse): RenderResourceTransition[] {
    const resource = this.requireResource(use.resourceId);
    const range = fullRange(resource, use.range);
    const after: RenderResourceState = { layout: use.layout, access: use.access, queue: use.queue, stage: use.stage };
    const transitions: RenderResourceTransition[] = [];
    for (let layer = range.baseLayer; layer < range.baseLayer + range.layerCount; layer += 1) {
      const layerStates = resource.states[layer];
      if (layerStates === undefined) throw new Error(`Layer ${layer} is out of range for ${use.resourceId}`);
      for (let mip = range.baseMip; mip < range.baseMip + range.mipCount; mip += 1) {
        const before = layerStates[mip];
        if (before === undefined) throw new Error(`Mip ${mip} is out of range for ${use.resourceId}`);
        if (this.statesEqual(before, after) && !use.discard) continue;
        transitions.push({
          resourceId: use.resourceId,
          range: { baseMip: mip, mipCount: 1, baseLayer: layer, layerCount: 1 },
          before: cloneState(before),
          after: cloneState(after),
          queueTransfer: before.queue !== after.queue,
          discard: use.discard ?? false,
        });
      }
    }
    return this.coalesceTransitions(transitions);
  }

  planPass(passId: string, uses: readonly RenderPassResourceUse[]): RenderPassTransitionPlan {
    const transitions: RenderResourceTransition[] = [];
    const hazards: RenderResourceHazard[] = [];
    const seen = new Map<string, RenderPassResourceUse>();
    for (const use of uses) {
      const resource = this.requireResource(use.resourceId);
      const range = fullRange(resource, use.range);
      const previousUse = seen.get(use.resourceId);
      if (previousUse && (isWrite(previousUse.access) || isWrite(use.access))) {
        throw new Error(`Pass ${passId} declares conflicting uses for resource ${use.resourceId}`);
      }
      seen.set(use.resourceId, use);
      for (const transition of this.transition(use)) {
        transitions.push(transition);
        const before = transition.before;
        const after = transition.after;
        if (before.queue !== after.queue) hazards.push(this.hazard(transition, "queue_transfer"));
        if (before.layout !== after.layout) hazards.push(this.hazard(transition, "layout_transition"));
        if (!transition.discard) {
          if (isWrite(before.access) && isRead(after.access)) hazards.push(this.hazard(transition, "read_after_write"));
          if (isRead(before.access) && isWrite(after.access)) hazards.push(this.hazard(transition, "write_after_read"));
          if (isWrite(before.access) && isWrite(after.access)) hazards.push(this.hazard(transition, "write_after_write"));
        }
      }
    }
    return { passId, transitions, hazards };
  }

  commit(plan: RenderPassTransitionPlan): void {
    for (const transition of plan.transitions) {
      const resource = this.requireResource(transition.resourceId);
      const range = fullRange(resource, transition.range);
      for (let layer = range.baseLayer; layer < range.baseLayer + range.layerCount; layer += 1) {
        const layerStates = resource.states[layer];
        if (layerStates === undefined) throw new Error(`Layer ${layer} is out of range for ${transition.resourceId}`);
        for (let mip = range.baseMip; mip < range.baseMip + range.mipCount; mip += 1) {
          layerStates[mip] = cloneState(transition.after);
        }
      }
    }
  }

  reset(id: string, state: Partial<RenderResourceState> = {}): void {
    const resource = this.requireResource(id);
    const next = { ...DEFAULT_STATE, ...state };
    for (let layer = 0; layer < resource.descriptor.layerCount; layer += 1) {
      const layerStates = resource.states[layer];
      if (layerStates === undefined) throw new Error(`Layer ${layer} is out of range for ${id}`);
      for (let mip = 0; mip < resource.descriptor.mipCount; mip += 1) layerStates[mip] = cloneState(next);
    }
  }

  private coalesceTransitions(transitions: RenderResourceTransition[]): RenderResourceTransition[] {
    const result: RenderResourceTransition[] = [];
    for (const transition of transitions) {
      const previous = result[result.length - 1];
      if (previous
        && previous.resourceId === transition.resourceId
        && previous.range.baseLayer === transition.range.baseLayer
        && previous.range.baseMip + previous.range.mipCount === transition.range.baseMip
        && this.statesEqual(previous.before, transition.before)
        && this.statesEqual(previous.after, transition.after)
        && previous.discard === transition.discard) {
        previous.range.mipCount += 1;
      } else result.push({ ...transition, range: { ...transition.range }, before: cloneState(transition.before), after: cloneState(transition.after) });
    }
    return result;
  }

  private hazard(transition: RenderResourceTransition, kind: RenderResourceHazard["kind"]): RenderResourceHazard {
    return { resourceId: transition.resourceId, range: { ...transition.range }, kind, previous: cloneState(transition.before), next: cloneState(transition.after) };
  }

  private statesEqual(a: RenderResourceState, b: RenderResourceState): boolean {
    return a.layout === b.layout && a.access === b.access && a.queue === b.queue && a.stage === b.stage;
  }

  private requireResource(id: string): TrackedResource {
    const resource = this.resources.get(id);
    if (!resource) throw new Error(`Unknown tracked render resource ${id}`);
    return resource;
  }
}
