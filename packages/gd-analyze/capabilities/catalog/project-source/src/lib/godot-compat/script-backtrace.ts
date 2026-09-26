/** Godot ScriptBacktrace retained language, frame, and variable snapshots. */

import { registerGodotObjectIdentity } from './object';

export interface GodotScriptBacktraceVariable { readonly name: string; readonly value: unknown }
export interface GodotScriptBacktraceFrame {
  readonly function: string;
  readonly file: string;
  readonly line: number;
  readonly locals?: readonly GodotScriptBacktraceVariable[];
  readonly members?: readonly GodotScriptBacktraceVariable[];
}
export interface GodotScriptBacktraceSeed {
  readonly languageName: string;
  readonly frames?: readonly GodotScriptBacktraceFrame[];
  readonly globals?: readonly GodotScriptBacktraceVariable[];
}

function arrayIndex(value: number, length: number, member: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value >= length) {
    throw new RangeError(`ScriptBacktrace.${member} index requires 0..${Math.max(0, length - 1)}.`);
  }
  return value;
}

export class GodotScriptBacktrace {
  private readonly frames: readonly GodotScriptBacktraceFrame[];
  private readonly globals: readonly GodotScriptBacktraceVariable[];
  private readonly languageName: string;

  constructor(seed: GodotScriptBacktraceSeed) {
    this.languageName = String(seed.languageName);
    this.frames = (seed.frames ?? []).map((frame) => Object.freeze({
      function: String(frame.function), file: String(frame.file), line: Math.max(0, Math.trunc(frame.line)),
      locals: (frame.locals ?? []).map((variable) => Object.freeze({ ...variable })),
      members: (frame.members ?? []).map((variable) => Object.freeze({ ...variable })),
    }));
    this.globals = (seed.globals ?? []).map((variable) => Object.freeze({ ...variable }));
    registerGodotObjectIdentity(this, 'ScriptBacktrace');
  }
  get_language_name(): string { return this.languageName; }
  is_empty(): boolean { return this.frames.length === 0; }
  get_frame_count(): number { return this.frames.length; }
  get_frame_function(index: number): string { return this.frame(index).function; }
  get_frame_file(index: number): string { return this.frame(index).file; }
  get_frame_line(index: number): number { return this.frame(index).line; }
  get_global_variable_count(): number { return this.globals.length; }
  get_global_variable_name(index: number): string { return this.variable(this.globals, index, 'global_variable').name; }
  get_global_variable_value(index: number): unknown { return this.variable(this.globals, index, 'global_variable').value; }
  get_local_variable_count(frameIndex: number): number { return this.frame(frameIndex).locals?.length ?? 0; }
  get_local_variable_name(frameIndex: number, variableIndex: number): string {
    const locals = this.frame(frameIndex).locals ?? [];
    return this.variable(locals, variableIndex, 'local_variable').name;
  }
  get_local_variable_value(frameIndex: number, variableIndex: number): unknown {
    const locals = this.frame(frameIndex).locals ?? [];
    return this.variable(locals, variableIndex, 'local_variable').value;
  }
  get_member_variable_count(frameIndex: number): number { return this.frame(frameIndex).members?.length ?? 0; }
  get_member_variable_name(frameIndex: number, variableIndex: number): string {
    const members = this.frame(frameIndex).members ?? [];
    return this.variable(members, variableIndex, 'member_variable').name;
  }
  get_member_variable_value(frameIndex: number, variableIndex: number): unknown {
    const members = this.frame(frameIndex).members ?? [];
    return this.variable(members, variableIndex, 'member_variable').value;
  }
  format(indentAll = 0, indentFrames = 4): string {
    const all = ' '.repeat(Math.max(0, Math.trunc(indentAll)));
    const nested = ' '.repeat(Math.max(0, Math.trunc(indentFrames)));
    const lines = [`${all}${this.languageName} backtrace (${this.frames.length} frames):`];
    this.frames.forEach((frame, index) => {
      lines.push(`${all}${nested}${index}: ${frame.function} at ${frame.file}:${frame.line}`);
      for (const variable of frame.locals ?? []) lines.push(`${all}${nested}${nested}local ${variable.name} = ${String(variable.value)}`);
      for (const variable of frame.members ?? []) lines.push(`${all}${nested}${nested}member ${variable.name} = ${String(variable.value)}`);
    });
    for (const variable of this.globals) lines.push(`${all}${nested}global ${variable.name} = ${String(variable.value)}`);
    return lines.join('\n');
  }
  private frame(index: number): GodotScriptBacktraceFrame { return this.frames[arrayIndex(index, this.frames.length, 'frame')]!; }
  private variable(values: readonly GodotScriptBacktraceVariable[], index: number, member: string): GodotScriptBacktraceVariable {
    return values[arrayIndex(index, values.length, member)]!;
  }
}

export function createGodotScriptBacktrace(seed: GodotScriptBacktraceSeed): GodotScriptBacktrace {
  return new GodotScriptBacktrace(seed);
}
