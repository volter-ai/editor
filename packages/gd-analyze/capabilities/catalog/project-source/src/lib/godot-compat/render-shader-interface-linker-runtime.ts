export interface RenderShaderInterfaceVariable {
  location: number;
  component?: number;
  name?: string;
  type: string;
  interpolation?: "smooth" | "flat" | "noperspective";
  arrayCount?: number;
  optional?: boolean;
}

export interface RenderShaderStageInterface {
  shaderId: string;
  stage: string;
  inputs: readonly RenderShaderInterfaceVariable[];
  outputs: readonly RenderShaderInterfaceVariable[];
}

export interface RenderShaderLinkDiagnostic {
  severity: "warning" | "error";
  code: string;
  message: string;
  location?: number;
}

export interface RenderShaderLinkResult {
  valid: boolean;
  producerShaderId: string;
  consumerShaderId: string;
  linked: Array<{ output: RenderShaderInterfaceVariable; input: RenderShaderInterfaceVariable }>;
  unusedOutputs: RenderShaderInterfaceVariable[];
  diagnostics: RenderShaderLinkDiagnostic[];
  signature: string;
}

function cloneVariable(variable: RenderShaderInterfaceVariable): RenderShaderInterfaceVariable {
  return { ...variable };
}

function slotKey(variable: RenderShaderInterfaceVariable): string {
  return `${variable.location}:${variable.component ?? 0}`;
}

function hash(value: string): string {
  let result = 5381;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result, 33) ^ value.charCodeAt(index);
  return (result >>> 0).toString(16).padStart(8, "0");
}

export class RenderShaderInterfaceLinkerRuntime {
  link(producer: RenderShaderStageInterface, consumer: RenderShaderStageInterface): RenderShaderLinkResult {
    this.validateInterface(producer);
    this.validateInterface(consumer);
    const outputs = new Map(producer.outputs.map((output) => [slotKey(output), output]));
    const linked: RenderShaderLinkResult["linked"] = [];
    const diagnostics: RenderShaderLinkDiagnostic[] = [];
    const consumed = new Set<string>();
    for (const input of consumer.inputs) {
      const key = slotKey(input);
      const output = outputs.get(key);
      if (!output) {
        if (!input.optional) diagnostics.push({ severity: "error", code: "MISSING_OUTPUT", message: `Input ${input.name ?? key} has no producer output`, location: input.location });
        continue;
      }
      consumed.add(key);
      if (output.type !== input.type || (output.arrayCount ?? 1) !== (input.arrayCount ?? 1)) {
        diagnostics.push({ severity: "error", code: "TYPE_MISMATCH", message: `Interface location ${key} has incompatible types ${output.type} and ${input.type}`, location: input.location });
      }
      if ((output.interpolation ?? "smooth") !== (input.interpolation ?? "smooth")) {
        diagnostics.push({ severity: "error", code: "INTERPOLATION_MISMATCH", message: `Interface location ${key} has incompatible interpolation`, location: input.location });
      }
      linked.push({ output: cloneVariable(output), input: cloneVariable(input) });
    }
    const unusedOutputs = producer.outputs.filter((output) => !consumed.has(slotKey(output))).map(cloneVariable);
    for (const output of unusedOutputs) {
      diagnostics.push({ severity: "warning", code: "UNUSED_OUTPUT", message: `Output ${output.name ?? slotKey(output)} is not consumed`, location: output.location });
    }
    const signature = hash(JSON.stringify(linked.map((entry) => [slotKey(entry.output), entry.output.type, entry.output.interpolation ?? "smooth", entry.output.arrayCount ?? 1])));
    return { valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"), producerShaderId: producer.shaderId, consumerShaderId: consumer.shaderId, linked, unusedOutputs, diagnostics, signature };
  }

  linkChain(stages: readonly RenderShaderStageInterface[]): RenderShaderLinkResult[] {
    const results: RenderShaderLinkResult[] = [];
    for (let index = 0; index + 1 < stages.length; index += 1) {
      const producer = stages[index];
      const consumer = stages[index + 1];
      if (producer === undefined || consumer === undefined) throw new Error('Shader interface chain contains a missing stage.');
      results.push(this.link(producer, consumer));
    }
    return results;
  }

  private validateInterface(shader: RenderShaderStageInterface): void {
    if (!shader.shaderId || !shader.stage) throw new Error("Shader stage interface requires a shader id and stage");
    this.validateVariables(shader.inputs, `${shader.shaderId} inputs`);
    this.validateVariables(shader.outputs, `${shader.shaderId} outputs`);
  }

  private validateVariables(variables: readonly RenderShaderInterfaceVariable[], label: string): void {
    const slots = new Set<string>();
    for (const variable of variables) {
      if (!Number.isInteger(variable.location) || variable.location < 0 || !variable.type) throw new Error(`${label} contains an invalid variable`);
      const key = slotKey(variable);
      if (slots.has(key)) throw new Error(`${label} duplicates location ${key}`);
      slots.add(key);
    }
  }
}
