export type RenderShaderParameterScalar = number | boolean;

export interface RenderShaderParameterField {
  name: string;
  offset: number;
  type: "bool" | "int" | "uint" | "float" | "vec2" | "vec3" | "vec4" | "mat3" | "mat4";
  arrayCount?: number;
  arrayStride?: number;
  matrixStride?: number;
}

export interface RenderShaderParameterLayout {
  byteSize: number;
  fields: readonly RenderShaderParameterField[];
}

export type RenderShaderParameterValue = RenderShaderParameterScalar | readonly RenderShaderParameterScalar[];

interface TypeLayout {
  components: number;
  columns: number;
  scalar: "bool" | "int" | "uint" | "float";
}

const TYPES: Record<RenderShaderParameterField["type"], TypeLayout> = {
  bool: { components: 1, columns: 1, scalar: "bool" },
  int: { components: 1, columns: 1, scalar: "int" },
  uint: { components: 1, columns: 1, scalar: "uint" },
  float: { components: 1, columns: 1, scalar: "float" },
  vec2: { components: 2, columns: 1, scalar: "float" },
  vec3: { components: 3, columns: 1, scalar: "float" },
  vec4: { components: 4, columns: 1, scalar: "float" },
  mat3: { components: 3, columns: 3, scalar: "float" },
  mat4: { components: 4, columns: 4, scalar: "float" },
};

export class RenderShaderParameterPackerRuntime {
  private readonly fields = new Map<string, RenderShaderParameterField>();

  constructor(private readonly layout: RenderShaderParameterLayout) {
    if (!Number.isInteger(layout.byteSize) || layout.byteSize < 0) throw new Error("Shader parameter block byteSize must be non-negative");
    for (const field of layout.fields) {
      if (!field.name || this.fields.has(field.name)) throw new Error(`Shader parameter field ${field.name} is invalid or duplicated`);
      if (!Number.isInteger(field.offset) || field.offset < 0) throw new Error(`Shader parameter field ${field.name} has an invalid offset`);
      this.fields.set(field.name, { ...field });
      const end = this.fieldEnd(field);
      if (end > layout.byteSize) throw new Error(`Shader parameter field ${field.name} exceeds the block size`);
    }
  }

  pack(values: Readonly<Record<string, RenderShaderParameterValue>>, destination?: ArrayBuffer): ArrayBuffer {
    const buffer = destination ?? new ArrayBuffer(this.layout.byteSize);
    if (buffer.byteLength < this.layout.byteSize) throw new Error("Shader parameter destination is too small");
    const view = new DataView(buffer);
    for (const [name, value] of Object.entries(values)) this.write(view, name, value);
    return buffer;
  }

  write(view: DataView, name: string, value: RenderShaderParameterValue, arrayIndex = 0): void {
    const field = this.fields.get(name);
    if (!field) throw new Error(`Unknown shader parameter ${name}`);
    const arrayCount = field.arrayCount ?? 1;
    if (!Number.isInteger(arrayIndex) || arrayIndex < 0 || arrayIndex >= arrayCount) throw new Error(`Shader parameter ${name} array index is out of range`);
    const type = TYPES[field.type];
    const values = Array.isArray(value) ? value : [value];
    const expected = type.components * type.columns;
    if (values.length !== expected) throw new Error(`Shader parameter ${name} requires ${expected} scalar values`);
    const arrayStride = field.arrayStride ?? this.elementByteSize(field);
    const matrixStride = field.matrixStride ?? type.components * 4;
    const base = field.offset + arrayIndex * arrayStride;
    for (let column = 0; column < type.columns; column += 1) {
      for (let component = 0; component < type.components; component += 1) {
        this.writeScalar(view, base + column * matrixStride + component * 4, type.scalar, values[column * type.components + component]);
      }
    }
  }

  read(view: DataView, name: string, arrayIndex = 0): RenderShaderParameterScalar[] {
    const field = this.fields.get(name);
    if (!field) throw new Error(`Unknown shader parameter ${name}`);
    const type = TYPES[field.type];
    const arrayCount = field.arrayCount ?? 1;
    if (!Number.isInteger(arrayIndex) || arrayIndex < 0 || arrayIndex >= arrayCount) throw new Error(`Shader parameter ${name} array index is out of range`);
    const base = field.offset + arrayIndex * (field.arrayStride ?? this.elementByteSize(field));
    const matrixStride = field.matrixStride ?? type.components * 4;
    const result: RenderShaderParameterScalar[] = [];
    for (let column = 0; column < type.columns; column += 1) {
      for (let component = 0; component < type.components; component += 1) {
        const offset = base + column * matrixStride + component * 4;
        result.push(type.scalar === "float" ? view.getFloat32(offset, true)
          : type.scalar === "int" ? view.getInt32(offset, true)
          : type.scalar === "uint" ? view.getUint32(offset, true)
          : view.getUint32(offset, true) !== 0);
      }
    }
    return result;
  }

  names(): string[] {
    return [...this.fields.keys()];
  }

  private writeScalar(view: DataView, offset: number, type: TypeLayout["scalar"], value: RenderShaderParameterScalar): void {
    if (type === "float") view.setFloat32(offset, Number(value), true);
    else if (type === "int") view.setInt32(offset, Number(value), true);
    else if (type === "uint") view.setUint32(offset, Number(value), true);
    else view.setUint32(offset, value ? 1 : 0, true);
  }

  private elementByteSize(field: RenderShaderParameterField): number {
    const type = TYPES[field.type];
    return type.columns * (field.matrixStride ?? type.components * 4);
  }

  private fieldEnd(field: RenderShaderParameterField): number {
    const count = field.arrayCount ?? 1;
    return field.offset + (count - 1) * (field.arrayStride ?? this.elementByteSize(field)) + this.elementByteSize(field);
  }
}
