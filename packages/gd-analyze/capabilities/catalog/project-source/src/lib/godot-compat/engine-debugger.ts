/** Retained EngineDebugger registration, message capture, profiler, and breakpoint state. */

import { GodotCallable } from './callable';
import { registerGodotObjectIdentity } from './object';

export interface GodotEngineProfiler {
  _toggle?(enabled: boolean, options: readonly unknown[]): void;
  _add_frame?(data: readonly unknown[]): void;
  _tick?(frameTime: number, processTime: number, physicsTime: number, physicsFrameTime: number): void;
}

interface ProfilerRecord {
  readonly profiler: GodotEngineProfiler;
  enabled: boolean;
  options: readonly unknown[];
  frames: readonly unknown[][];
}

function stringName(value: unknown, member: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`EngineDebugger.${member} name requires a non-empty StringName.`);
  }
  return value;
}

function array(value: unknown, member: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`EngineDebugger.${member} requires an Array.`);
  return value;
}

function int32(value: unknown, member: string): number {
  if (!Number.isInteger(value) || (value as number) < -0x8000_0000 || (value as number) > 0x7fff_ffff) {
    throw new RangeError(`EngineDebugger.${member} requires int32.`);
  }
  return value as number;
}

function profiler(value: unknown): GodotEngineProfiler {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('EngineDebugger.register_profiler requires EngineProfiler.');
  }
  return value as GodotEngineProfiler;
}

function callVirtual(target: object, method: string, args: readonly unknown[]): unknown {
  const callback = Reflect.get(target, method);
  return typeof callback === 'function' ? Reflect.apply(callback, target, args) : undefined;
}

function breakpointKey(source: string, line: number): string { return `${source}\u0000${line}`; }

export function createGodotEngineProfiler(): GodotEngineProfiler {
  const value: GodotEngineProfiler = {};
  registerGodotObjectIdentity(value, 'EngineProfiler');
  return value;
}

class GodotEngineDebuggerRuntime {
  private readonly profilers = new Map<string, ProfilerRecord>();
  private readonly captures = new Map<string, GodotCallable>();
  private readonly breakpoints = new Set<string>();
  private linesLeft = -1;
  private depth = -1;
  private skippingBreakpoints = false;
  private active = false;

  is_active(): boolean { return this.active; }

  register_profiler(nameValue: unknown, profilerValue: unknown): void {
    const name = stringName(nameValue, 'register_profiler');
    if (this.profilers.has(name)) throw new Error(`EngineDebugger profiler ${name} is already registered.`);
    this.profilers.set(name, {
      profiler: profiler(profilerValue),
      enabled: false,
      options: [],
      frames: [],
    });
  }

  unregister_profiler(nameValue: unknown): void {
    const name = stringName(nameValue, 'unregister_profiler');
    const record = this.profilers.get(name);
    if (record?.enabled === true) callVirtual(record.profiler, '_toggle', [false, []]);
    this.profilers.delete(name);
  }

  is_profiling(nameValue: unknown): boolean {
    return this.profilers.get(stringName(nameValue, 'is_profiling'))?.enabled ?? false;
  }

  has_profiler(nameValue: unknown): boolean {
    return this.profilers.has(stringName(nameValue, 'has_profiler'));
  }

  profiler_add_frame_data(nameValue: unknown, dataValue: unknown): void {
    const name = stringName(nameValue, 'profiler_add_frame_data');
    const data = [...array(dataValue, 'profiler_add_frame_data')];
    const record = this.requireProfiler(name, 'profiler_add_frame_data');
    record.frames = [...record.frames, data];
    callVirtual(record.profiler, '_add_frame', [data]);
  }

  profiler_enable(nameValue: unknown, enableValue: unknown, argumentsValue: unknown = []): void {
    const name = stringName(nameValue, 'profiler_enable');
    if (typeof enableValue !== 'boolean') throw new TypeError('EngineDebugger.profiler_enable enable requires bool.');
    const options = [...array(argumentsValue, 'profiler_enable')];
    const record = this.requireProfiler(name, 'profiler_enable');
    if (record.enabled === enableValue && this.sameArray(record.options, options)) return;
    record.enabled = enableValue;
    record.options = options;
    callVirtual(record.profiler, '_toggle', [enableValue, options]);
  }

  register_message_capture(nameValue: unknown, callableValue: unknown): void {
    const name = stringName(nameValue, 'register_message_capture');
    if (!(callableValue instanceof GodotCallable) || !callableValue.isValid()) {
      throw new TypeError('EngineDebugger.register_message_capture requires a valid Callable.');
    }
    if (this.captures.has(name)) throw new Error(`EngineDebugger message capture ${name} is already registered.`);
    this.captures.set(name, callableValue);
  }

  unregister_message_capture(nameValue: unknown): void {
    this.captures.delete(stringName(nameValue, 'unregister_message_capture'));
  }

  has_capture(nameValue: unknown): boolean {
    return this.captures.has(stringName(nameValue, 'has_capture'));
  }

  line_poll(): void {
    for (const record of this.profilers.values()) {
      if (record.enabled) callVirtual(record.profiler, '_tick', [0, 0, 0, 0]);
    }
  }

  send_message(messageValue: unknown, dataValue: unknown): void {
    if (typeof messageValue !== 'string') throw new TypeError('EngineDebugger.send_message message requires String.');
    const data = [...array(dataValue, 'send_message')];
    const separator = messageValue.indexOf(':');
    const captureName = separator < 0 ? messageValue : messageValue.slice(0, separator);
    const payloadName = separator < 0 ? '' : messageValue.slice(separator + 1);
    this.captures.get(captureName)?.call(payloadName, data);
  }

  debug(canContinueValue = true, isErrorBreakpointValue = false): void {
    if (typeof canContinueValue !== 'boolean' || typeof isErrorBreakpointValue !== 'boolean') {
      throw new TypeError('EngineDebugger.debug flags require bool.');
    }
    this.active = true;
    this.skippingBreakpoints = !canContinueValue && !isErrorBreakpointValue;
  }

  script_debug(language: unknown, canContinueValue = true, isErrorBreakpointValue = false): void {
    if (typeof language !== 'object' || language === null) {
      throw new TypeError('EngineDebugger.script_debug requires ScriptLanguage.');
    }
    this.debug(canContinueValue, isErrorBreakpointValue);
  }

  set_lines_left(value: unknown): void { this.linesLeft = int32(value, 'set_lines_left'); }
  get_lines_left(): number { return this.linesLeft; }
  set_depth(value: unknown): void { this.depth = int32(value, 'set_depth'); }
  get_depth(): number { return this.depth; }

  is_breakpoint(lineValue: unknown, sourceValue: unknown): boolean {
    const line = int32(lineValue, 'is_breakpoint');
    const source = stringName(sourceValue, 'is_breakpoint');
    return this.breakpoints.has(breakpointKey(source, line));
  }

  is_skipping_breakpoints(): boolean { return this.skippingBreakpoints; }

  insert_breakpoint(lineValue: unknown, sourceValue: unknown): void {
    const line = int32(lineValue, 'insert_breakpoint');
    const source = stringName(sourceValue, 'insert_breakpoint');
    this.breakpoints.add(breakpointKey(source, line));
  }

  remove_breakpoint(lineValue: unknown, sourceValue: unknown): void {
    const line = int32(lineValue, 'remove_breakpoint');
    const source = stringName(sourceValue, 'remove_breakpoint');
    this.breakpoints.delete(breakpointKey(source, line));
  }

  clear_breakpoints(): void { this.breakpoints.clear(); }

  tick(frameTime: number, processTime: number, physicsTime: number, physicsFrameTime: number): void {
    for (const record of this.profilers.values()) {
      if (record.enabled) callVirtual(record.profiler, '_tick', [frameTime, processTime, physicsTime, physicsFrameTime]);
    }
  }

  private requireProfiler(name: string, member: string): ProfilerRecord {
    const record = this.profilers.get(name);
    if (record === undefined) throw new Error(`EngineDebugger.${member} has no profiler named ${name}.`);
    return record;
  }

  private sameArray(left: readonly unknown[], right: readonly unknown[]): boolean {
    return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  }
}

export const GodotEngineDebugger = new GodotEngineDebuggerRuntime();

export function godotEngineDebuggerTick(
  frameTime: number,
  processTime: number,
  physicsTime: number,
  physicsFrameTime: number,
): void {
  GodotEngineDebugger.tick(frameTime, processTime, physicsTime, physicsFrameTime);
}
