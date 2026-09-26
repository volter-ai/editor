export type RenderShaderFeatureValue = string | number | boolean;

export interface RenderShaderFeatureDomain {
  name: string;
  values: readonly RenderShaderFeatureValue[];
  defaultValue: RenderShaderFeatureValue;
}

export interface RenderShaderPermutationConstraint {
  when: Readonly<Record<string, RenderShaderFeatureValue>>;
  require?: Readonly<Record<string, RenderShaderFeatureValue>>;
  exclude?: Readonly<Record<string, RenderShaderFeatureValue>>;
}

export interface RenderShaderPermutation {
  key: string;
  values: Record<string, RenderShaderFeatureValue>;
}

export interface RenderShaderVariantRecord {
  permutation: RenderShaderPermutation;
  handle: unknown;
  lastUsedFrame: number;
  references: number;
}

function valueKey(value: RenderShaderFeatureValue): string {
  return `${typeof value}:${String(value)}`;
}

export class RenderShaderPermutationRuntime {
  private readonly domains = new Map<string, RenderShaderFeatureDomain>();
  private readonly constraints: RenderShaderPermutationConstraint[] = [];
  private readonly variants = new Map<string, RenderShaderVariantRecord>();
  private frame = 0;

  registerDomain(domain: RenderShaderFeatureDomain): void {
    if (!domain.name || domain.values.length === 0) throw new Error("Shader feature domain requires a name and values");
    if (this.domains.has(domain.name)) throw new Error(`Shader feature ${domain.name} is already registered`);
    if (!domain.values.some((value) => valueKey(value) === valueKey(domain.defaultValue))) throw new Error(`Default for feature ${domain.name} is outside its domain`);
    this.domains.set(domain.name, { ...domain, values: [...domain.values] });
  }

  addConstraint(constraint: RenderShaderPermutationConstraint): void {
    this.validateValues(constraint.when);
    if (constraint.require) this.validateValues(constraint.require);
    if (constraint.exclude) this.validateValues(constraint.exclude);
    this.constraints.push({
      when: { ...constraint.when },
      ...(constraint.require === undefined ? {} : { require: { ...constraint.require } }),
      ...(constraint.exclude === undefined ? {} : { exclude: { ...constraint.exclude } }),
    });
  }

  resolve(requested: Readonly<Record<string, RenderShaderFeatureValue>>): RenderShaderPermutation {
    this.validateValues(requested);
    const values: Record<string, RenderShaderFeatureValue> = {};
    for (const domain of this.domains.values()) values[domain.name] = requested[domain.name] ?? domain.defaultValue;
    this.applyRequirements(values);
    if (!this.isValid(values)) throw new Error("Requested shader feature combination violates permutation constraints");
    return { key: this.key(values), values };
  }

  enumerate(): RenderShaderPermutation[] {
    const domains = [...this.domains.values()];
    const results: RenderShaderPermutation[] = [];
    const visit = (index: number, values: Record<string, RenderShaderFeatureValue>) => {
      if (index === domains.length) {
        if (this.isValid(values)) results.push({ key: this.key(values), values: { ...values } });
        return;
      }
      const domain = domains[index];
      if (domain === undefined) throw new Error('Shader feature enumeration encountered a missing domain.');
      for (const value of domain.values) {
        values[domain.name] = value;
        visit(index + 1, values);
      }
    };
    visit(0, {});
    return results;
  }

  fallbackChain(requested: Readonly<Record<string, RenderShaderFeatureValue>>): RenderShaderPermutation[] {
    const resolved = this.resolve(requested);
    const chain = [resolved];
    const values = { ...resolved.values };
    for (const domain of [...this.domains.values()].reverse()) {
      const current = values[domain.name];
      if (current === undefined) throw new Error(`Resolved shader permutation is missing feature ${domain.name}`);
      if (valueKey(current) === valueKey(domain.defaultValue)) continue;
      values[domain.name] = domain.defaultValue;
      try {
        const fallback = this.resolve(values);
        if (!chain.some((entry) => entry.key === fallback.key)) chain.push(fallback);
      } catch { /* next feature may restore a valid combination */ }
    }
    return chain;
  }

  retain(permutation: RenderShaderPermutation, handle: unknown): RenderShaderVariantRecord {
    let record = this.variants.get(permutation.key);
    if (record) {
      record.references += 1;
      record.lastUsedFrame = this.frame;
      return { ...record, permutation: { key: record.permutation.key, values: { ...record.permutation.values } } };
    }
    record = { permutation: { key: permutation.key, values: { ...permutation.values } }, handle, lastUsedFrame: this.frame, references: 1 };
    this.variants.set(permutation.key, record);
    return { ...record, permutation: { key: permutation.key, values: { ...permutation.values } } };
  }

  release(key: string): boolean {
    const record = this.variants.get(key);
    if (!record) return false;
    record.references = Math.max(0, record.references - 1);
    record.lastUsedFrame = this.frame;
    return true;
  }

  beginFrame(frame?: number): void {
    this.frame = frame ?? this.frame + 1;
  }

  evictUnused(maximumIdleFrames: number): string[] {
    const evicted: string[] = [];
    for (const [key, record] of this.variants) {
      if (record.references === 0 && this.frame - record.lastUsedFrame > maximumIdleFrames) {
        this.variants.delete(key);
        evicted.push(key);
      }
    }
    return evicted;
  }

  private applyRequirements(values: Record<string, RenderShaderFeatureValue>): void {
    for (let pass = 0; pass <= this.constraints.length; pass += 1) {
      let changed = false;
      for (const constraint of this.constraints) {
        if (!this.matches(values, constraint.when)) continue;
        for (const [name, value] of Object.entries(constraint.require ?? {})) {
          const current = values[name];
          if (current === undefined || valueKey(current) !== valueKey(value)) {
            values[name] = value;
            changed = true;
          }
        }
      }
      if (!changed) return;
    }
    throw new Error("Shader permutation requirements contain a cycle");
  }

  private isValid(values: Record<string, RenderShaderFeatureValue>): boolean {
    return this.constraints.every((constraint) => !this.matches(values, constraint.when)
      || !constraint.exclude
      || !this.matches(values, constraint.exclude));
  }

  private matches(values: Record<string, RenderShaderFeatureValue>, expected: Readonly<Record<string, RenderShaderFeatureValue>>): boolean {
    return Object.entries(expected).every(([name, value]) => {
      const current = values[name];
      return current !== undefined && valueKey(current) === valueKey(value);
    });
  }

  private key(values: Record<string, RenderShaderFeatureValue>): string {
    return [...this.domains.keys()].sort().map((name) => {
      const value = values[name];
      if (value === undefined) throw new Error(`Shader permutation is missing feature ${name}`);
      return `${name}=${valueKey(value)}`;
    }).join(";");
  }

  private validateValues(values: Readonly<Record<string, RenderShaderFeatureValue>>): void {
    for (const [name, value] of Object.entries(values)) {
      const domain = this.domains.get(name);
      if (!domain) throw new Error(`Unknown shader feature ${name}`);
      if (!domain.values.some((candidate) => valueKey(candidate) === valueKey(value))) throw new Error(`Value ${String(value)} is invalid for shader feature ${name}`);
    }
  }
}
