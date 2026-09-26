export interface RenderShaderBindingLocation {
  set: number;
  binding: number;
}

export interface RenderShaderBindingRecord extends RenderShaderBindingLocation {
  name?: string;
  type: string;
  stages: readonly string[];
  arrayCount?: number;
}

export interface RenderShaderBindingRemapRule {
  source: RenderShaderBindingLocation;
  target: RenderShaderBindingLocation;
  stages?: readonly string[];
}

export interface RenderShaderBindingReservedRange {
  set: number;
  firstBinding: number;
  bindingCount: number;
  owner?: string;
}

export interface RenderShaderBindingRemapResult {
  bindings: RenderShaderBindingRecord[];
  map: Map<string, RenderShaderBindingLocation>;
  signature: string;
}

function key(location: RenderShaderBindingLocation): string {
  return `${location.set}:${location.binding}`;
}

function validIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 0x01000193);
  return (result >>> 0).toString(16).padStart(8, "0");
}

export class RenderShaderBindingRemapRuntime {
  private readonly rules: RenderShaderBindingRemapRule[] = [];
  private readonly reserved: RenderShaderBindingReservedRange[] = [];

  addRule(rule: RenderShaderBindingRemapRule): void {
    this.validateLocation(rule.source);
    this.validateLocation(rule.target);
    if (this.rules.some((existing) => key(existing.source) === key(rule.source)
      && this.stageSetsOverlap(existing.stages, rule.stages))) {
      throw new Error(`Shader binding ${key(rule.source)} already has an overlapping remap rule`);
    }
    this.rules.push({
      source: { ...rule.source },
      target: { ...rule.target },
      ...(rule.stages === undefined ? {} : { stages: [...rule.stages] }),
    });
  }

  reserve(range: RenderShaderBindingReservedRange): void {
    if (!validIndex(range.set) || !validIndex(range.firstBinding) || !Number.isInteger(range.bindingCount) || range.bindingCount < 1) {
      throw new Error("Shader binding reserved range is invalid");
    }
    const end = range.firstBinding + range.bindingCount;
    if (this.reserved.some((existing) => existing.set === range.set
      && existing.firstBinding < end
      && range.firstBinding < existing.firstBinding + existing.bindingCount)) {
      throw new Error(`Shader binding reserved range overlaps another range in set ${range.set}`);
    }
    this.reserved.push({ ...range });
  }

  remap(bindings: readonly RenderShaderBindingRecord[]): RenderShaderBindingRemapResult {
    const occupied = new Map<string, RenderShaderBindingRecord>();
    const map = new Map<string, RenderShaderBindingLocation>();
    const output: RenderShaderBindingRecord[] = [];
    for (const binding of bindings) {
      this.validateLocation(binding);
      const rule = this.rules.find((candidate) => key(candidate.source) === key(binding)
        && (!candidate.stages || binding.stages.some((stage) => candidate.stages!.includes(stage))));
      const target = rule?.target ?? { set: binding.set, binding: binding.binding };
      if (this.isReserved(target) && !rule) throw new Error(`Shader binding ${key(target)} occupies a reserved range without a remap rule`);
      const targetKey = key(target);
      const collision = occupied.get(targetKey);
      if (collision) throw new Error(`Shader bindings ${collision.name ?? key(collision)} and ${binding.name ?? key(binding)} collide at ${targetKey}`);
      const remapped = { ...binding, set: target.set, binding: target.binding, stages: [...binding.stages] };
      occupied.set(targetKey, remapped);
      output.push(remapped);
      map.set(key(binding), { ...target });
    }
    output.sort((a, b) => a.set - b.set || a.binding - b.binding);
    const signature = hash(JSON.stringify(output.map((binding) => [binding.set, binding.binding, binding.type, binding.arrayCount ?? 1, [...binding.stages].sort()])));
    return { bindings: output, map, signature };
  }

  allocate(set: number, occupiedBindings: readonly number[], preferred = 0): RenderShaderBindingLocation {
    if (!validIndex(set) || !validIndex(preferred)) throw new Error("Shader binding allocation indices are invalid");
    const occupied = new Set(occupiedBindings);
    for (let binding = preferred; binding < Number.MAX_SAFE_INTEGER; binding += 1) {
      if (!occupied.has(binding) && !this.isReserved({ set, binding })) return { set, binding };
    }
    throw new Error(`No shader binding is available in set ${set}`);
  }

  clearRules(): void {
    this.rules.length = 0;
  }

  clearReservedRanges(): void {
    this.reserved.length = 0;
  }

  private isReserved(location: RenderShaderBindingLocation): boolean {
    return this.reserved.some((range) => range.set === location.set
      && location.binding >= range.firstBinding
      && location.binding < range.firstBinding + range.bindingCount);
  }

  private stageSetsOverlap(a?: readonly string[], b?: readonly string[]): boolean {
    return !a || !b || a.some((stage) => b.includes(stage));
  }

  private validateLocation(location: RenderShaderBindingLocation): void {
    if (!validIndex(location.set) || !validIndex(location.binding)) throw new Error("Shader binding location must contain non-negative integers");
  }
}
