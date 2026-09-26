import { registerGodotObjectIdentity } from './object';
import { packedStringArray, type PackedArrayValue } from './packed-array';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceEmitChanged,
} from './resource-io';

export const SHADER_STAGE_VERTEX = 0;
export const SHADER_STAGE_FRAGMENT = 1;
export const SHADER_STAGE_TESSELATION_CONTROL = 2;
export const SHADER_STAGE_TESSELATION_EVALUATION = 3;
export const SHADER_STAGE_COMPUTE = 4;

type ShaderStage = 0 | 1 | 2 | 3 | 4;

function stage(value: number): ShaderStage {
  if (!Number.isSafeInteger(value) || value < 0 || value > 4) {
    throw new RangeError('RDShaderSPIRV shader stage must be in [0, 4].');
  }
  return value as ShaderStage;
}

function versionName(value: string): string {
  if (typeof value !== 'string') throw new TypeError('RDShaderFile version requires StringName.');
  return value;
}

function bytes(value: Uint8Array | readonly number[]): Uint8Array {
  if (value instanceof Uint8Array) return value.slice();
  if (!Array.isArray(value) || value.some((entry) => !Number.isSafeInteger(entry) || entry < 0 || entry > 255)) {
    throw new TypeError('RDShaderSPIRV bytecode requires PackedByteArray values in [0, 255].');
  }
  return Uint8Array.from(value);
}

/** Raw RenderingDevice SPIR-V resource. Browser renderers retain it for identity/introspection. */
export class GodotRDShaderSpirv {
  private readonly bytecode = new Map<ShaderStage, Uint8Array>();
  private readonly compileErrors = new Map<ShaderStage, string>();

  public constructor() {
    registerGodotObjectIdentity(this, 'RDShaderSPIRV');
    bindGodotResourceProtocol<GodotRDShaderSpirv>(this, {
      createDuplicate: (source) => {
        const copy = new GodotRDShaderSpirv();
        for (const [shaderStage, value] of source.bytecode) copy.bytecode.set(shaderStage, value.slice());
        for (const [shaderStage, value] of source.compileErrors) copy.compileErrors.set(shaderStage, value);
        return copy;
      },
    });
  }

  public setStageBytecode(shaderStage: number, value: Uint8Array | readonly number[]): void {
    this.bytecode.set(stage(shaderStage), bytes(value));
    godotResourceEmitChanged(this);
  }

  public getStageBytecode(shaderStage: number): Uint8Array {
    return this.bytecode.get(stage(shaderStage))?.slice() ?? new Uint8Array();
  }

  public setStageCompileError(shaderStage: number, value: string): void {
    if (typeof value !== 'string') throw new TypeError('RDShaderSPIRV compile error requires String.');
    this.compileErrors.set(stage(shaderStage), value);
    godotResourceEmitChanged(this);
  }

  public getStageCompileError(shaderStage: number): string {
    return this.compileErrors.get(stage(shaderStage)) ?? '';
  }
}

export class GodotRDShaderFile {
  private readonly versions = new Map<string, GodotRDShaderSpirv>();
  private baseErrorValue = '';

  public constructor(
    versions: Readonly<Record<string, GodotRDShaderSpirv>> = {},
    baseError = '',
  ) {
    registerGodotObjectIdentity(this, 'RDShaderFile');
    for (const [name, spirv] of Object.entries(versions)) this.setVersion(name, spirv);
    this.setBaseError(baseError);
    bindGodotResourceProtocol<GodotRDShaderFile>(this, {
      createDuplicate: (source) => new GodotRDShaderFile(
        Object.fromEntries(source.versions),
        source.baseErrorValue,
      ),
      populateDuplicate: (source, target, subresources, memo) => {
        if (!subresources) return;
        for (const [name, spirv] of source.versions) {
          target.setVersion(name, duplicateGodotSubresource(spirv, memo));
        }
      },
    });
  }

  public get base_error(): string { return this.baseErrorValue; }

  public getSpirv(version = ''): GodotRDShaderSpirv | null {
    return this.versions.get(versionName(version)) ?? null;
  }

  public getVersionList(): PackedArrayValue<string> {
    return packedStringArray([...this.versions.keys()].sort());
  }

  public setVersion(version: string, spirv: GodotRDShaderSpirv): void {
    const name = versionName(version);
    if (!(spirv instanceof GodotRDShaderSpirv)) {
      throw new TypeError('RDShaderFile version requires an RDShaderSPIRV Resource.');
    }
    if (this.versions.get(name) === spirv) return;
    this.versions.set(name, spirv);
    godotResourceEmitChanged(this);
  }

  public setBaseError(value: string): void {
    if (typeof value !== 'string') throw new TypeError('RDShaderFile.base_error requires String.');
    if (this.baseErrorValue === value) return;
    this.baseErrorValue = value;
    godotResourceEmitChanged(this);
  }
}

export function createGodotRDShaderFile(): GodotRDShaderFile { return new GodotRDShaderFile(); }
export function createGodotRDShaderSpirv(): GodotRDShaderSpirv { return new GodotRDShaderSpirv(); }
