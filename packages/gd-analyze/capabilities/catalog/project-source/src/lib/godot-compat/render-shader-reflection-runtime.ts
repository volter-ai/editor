export type RenderShaderStage = "vertex" | "fragment" | "compute" | "mesh" | "task" | "ray_generation" | "ray_miss" | "ray_closest_hit" | "ray_any_hit";
export type RenderShaderBindingType = "sampler" | "sampled_texture" | "storage_texture" | "uniform_buffer" | "storage_buffer" | "acceleration_structure";

export interface RenderShaderBindingReflection {
  set: number;
  binding: number;
  name?: string;
  type: RenderShaderBindingType;
  arrayCount?: number;
  writable?: boolean;
  stages?: readonly RenderShaderStage[];
}

export interface RenderShaderPushConstantReflection {
  offset: number;
  byteSize: number;
  stages: readonly RenderShaderStage[];
}

export interface RenderShaderSpecializationReflection {
  id: number;
  name?: string;
  type: "bool" | "int" | "uint" | "float";
  defaultValue?: boolean | number;
}

export interface RenderShaderVertexInputReflection {
  location: number;
  name?: string;
  format: string;
}

export interface RenderShaderReflection {
  shaderId: string;
  stage: RenderShaderStage;
  entryPoint: string;
  bindings?: readonly RenderShaderBindingReflection[];
  pushConstants?: readonly RenderShaderPushConstantReflection[];
  specializations?: readonly RenderShaderSpecializationReflection[];
  vertexInputs?: readonly RenderShaderVertexInputReflection[];
  workgroupSize?: readonly [number, number, number];
}

export interface RenderShaderPipelineLayout {
  bindings: RenderShaderBindingReflection[];
  pushConstants: RenderShaderPushConstantReflection[];
  stages: RenderShaderStage[];
  signature: string;
}

export interface RenderShaderSpecializationValue {
  id: number;
  value: boolean | number;
}

function stages(binding: RenderShaderBindingReflection, fallback: RenderShaderStage): RenderShaderStage[] {
  return [...new Set(binding.stages ?? [fallback])];
}

function hash(value: string): string {
  let current = 2166136261;
  for (let index = 0; index < value.length; index += 1) current = Math.imul(current ^ value.charCodeAt(index), 16777619);
  return (current >>> 0).toString(16).padStart(8, "0");
}

export class RenderShaderReflectionRuntime {
  private readonly shaders = new Map<string, RenderShaderReflection>();

  register(reflection: RenderShaderReflection): void {
    this.validate(reflection);
    if (this.shaders.has(reflection.shaderId)) throw new Error(`Shader reflection ${reflection.shaderId} is already registered`);
    this.shaders.set(reflection.shaderId, this.cloneReflection(reflection));
  }

  update(shaderId: string, reflection: Omit<RenderShaderReflection, "shaderId">): void {
    if (!this.shaders.has(shaderId)) throw new Error(`Unknown shader reflection ${shaderId}`);
    const next = { ...reflection, shaderId };
    this.validate(next);
    this.shaders.set(shaderId, this.cloneReflection(next));
  }

  remove(shaderId: string): boolean {
    return this.shaders.delete(shaderId);
  }

  get(shaderId: string): RenderShaderReflection | undefined {
    const reflection = this.shaders.get(shaderId);
    return reflection ? this.cloneReflection(reflection) : undefined;
  }

  buildLayout(shaderIds: readonly string[]): RenderShaderPipelineLayout {
    const reflections = shaderIds.map((id) => this.require(id));
    const bindings = new Map<string, RenderShaderBindingReflection>();
    const pushConstants: RenderShaderPushConstantReflection[] = [];
    for (const reflection of reflections) {
      for (const binding of reflection.bindings ?? []) {
        const key = `${binding.set}:${binding.binding}`;
        const existing = bindings.get(key);
        if (existing) {
          if (existing.type !== binding.type || (existing.arrayCount ?? 1) !== (binding.arrayCount ?? 1)) {
            throw new Error(`Shader binding ${key} is incompatible between pipeline stages`);
          }
          existing.stages = [...new Set([...(existing.stages ?? []), ...stages(binding, reflection.stage)])];
          if (binding.writable === true) existing.writable = true;
        } else bindings.set(key, { ...binding, stages: stages(binding, reflection.stage) });
      }
      for (const range of reflection.pushConstants ?? []) this.mergePushConstant(pushConstants, range);
    }
    const orderedBindings = [...bindings.values()].sort((a, b) => a.set - b.set || a.binding - b.binding);
    const orderedPushConstants = pushConstants.sort((a, b) => a.offset - b.offset);
    const allStages = [...new Set(reflections.map((reflection) => reflection.stage))];
    const signature = hash(JSON.stringify({ bindings: orderedBindings, pushConstants: orderedPushConstants, stages: allStages }));
    return { bindings: orderedBindings, pushConstants: orderedPushConstants, stages: allStages, signature };
  }

  specializationValues(shaderId: string, values: Readonly<Record<string | number, boolean | number>>): RenderShaderSpecializationValue[] {
    const reflection = this.require(shaderId);
    return (reflection.specializations ?? []).map((specialization) => {
      const requested = values[specialization.id] ?? (specialization.name ? values[specialization.name] : undefined) ?? specialization.defaultValue;
      if (requested === undefined) throw new Error(`Shader ${shaderId} requires specialization ${specialization.name ?? specialization.id}`);
      if (specialization.type === "bool" && typeof requested !== "boolean") throw new Error(`Specialization ${specialization.id} requires a boolean`);
      if (specialization.type !== "bool" && typeof requested !== "number") throw new Error(`Specialization ${specialization.id} requires a number`);
      return { id: specialization.id, value: requested };
    }).sort((a, b) => a.id - b.id);
  }

  private mergePushConstant(target: RenderShaderPushConstantReflection[], range: RenderShaderPushConstantReflection): void {
    const existing = target.find((candidate) => candidate.offset === range.offset && candidate.byteSize === range.byteSize);
    if (existing) existing.stages = [...new Set([...existing.stages, ...range.stages])];
    else {
      const overlaps = target.some((candidate) => candidate.offset < range.offset + range.byteSize && range.offset < candidate.offset + candidate.byteSize);
      if (overlaps) throw new Error("Push constant ranges overlap without matching exactly");
      target.push({ ...range, stages: [...range.stages] });
    }
  }

  private validate(reflection: RenderShaderReflection): void {
    if (!reflection.shaderId || !reflection.entryPoint) throw new Error("Shader reflection requires an id and entry point");
    const bindingKeys = new Set<string>();
    for (const binding of reflection.bindings ?? []) {
      if (!Number.isInteger(binding.set) || binding.set < 0 || !Number.isInteger(binding.binding) || binding.binding < 0) throw new Error("Shader binding indices must be non-negative integers");
      const key = `${binding.set}:${binding.binding}`;
      if (bindingKeys.has(key)) throw new Error(`Shader ${reflection.shaderId} duplicates binding ${key}`);
      bindingKeys.add(key);
    }
    const specializationIds = new Set<number>();
    for (const specialization of reflection.specializations ?? []) {
      if (!Number.isInteger(specialization.id) || specialization.id < 0 || specializationIds.has(specialization.id)) throw new Error(`Shader ${reflection.shaderId} has an invalid specialization id`);
      specializationIds.add(specialization.id);
    }
  }

  private require(id: string): RenderShaderReflection {
    const reflection = this.shaders.get(id);
    if (!reflection) throw new Error(`Unknown shader reflection ${id}`);
    return reflection;
  }

  private cloneReflection(reflection: RenderShaderReflection): RenderShaderReflection {
    return {
      ...reflection,
      ...(reflection.bindings === undefined ? {} : {
        bindings: reflection.bindings.map((binding) => ({
          ...binding,
          ...(binding.stages === undefined ? {} : { stages: [...binding.stages] }),
        })),
      }),
      ...(reflection.pushConstants === undefined ? {} : {
        pushConstants: reflection.pushConstants.map((range) => ({ ...range, stages: [...range.stages] })),
      }),
      ...(reflection.specializations === undefined ? {} : {
        specializations: reflection.specializations.map((specialization) => ({ ...specialization })),
      }),
      ...(reflection.vertexInputs === undefined ? {} : {
        vertexInputs: reflection.vertexInputs.map((input) => ({ ...input })),
      }),
      ...(reflection.workgroupSize === undefined ? {} : { workgroupSize: [...reflection.workgroupSize] }),
    };
  }
}
