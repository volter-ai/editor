/** Project-owned custom Performance monitors layered beside native frame counters. */

import { GodotCallable } from './callable';
import { packedInt32Array, type PackedInt32Array } from './packed-array';

export const PERFORMANCE_MONITOR_TYPE_QUANTITY = 0;
export const PERFORMANCE_MONITOR_TYPE_MEMORY = 1;
export const PERFORMANCE_MONITOR_TYPE_TIME = 2;

interface CustomMonitor {
  readonly callable: GodotCallable;
  readonly arguments: readonly unknown[];
  readonly type: number;
}

function monitorName(value: unknown, member: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Performance.${member} requires non-empty StringName.`);
  }
  return value;
}

function callable(value: unknown): GodotCallable {
  if (value instanceof GodotCallable) return value;
  if (typeof value === 'function') return GodotCallable.custom(value as (...args: readonly unknown[]) => unknown);
  throw new TypeError('Performance.add_custom_monitor requires Callable.');
}

class GodotPerformanceRuntime {
  private readonly custom = new Map<string, CustomMonitor>();
  private modificationTimeValue = 0;

  private modified(): void {
    const now = typeof performance === 'undefined' ? Date.now() * 1000 : Math.trunc(performance.now() * 1000);
    this.modificationTimeValue = Math.max(this.modificationTimeValue + 1, now);
  }

  add_custom_monitor(id: unknown, callableValue: unknown, args: unknown = [], typeValue: unknown = PERFORMANCE_MONITOR_TYPE_QUANTITY): void {
    const name = monitorName(id, 'add_custom_monitor');
    if (!Array.isArray(args)) throw new TypeError('Performance.add_custom_monitor arguments requires Array.');
    if (typeof typeValue !== 'number' || !Number.isInteger(typeValue) || typeValue < 0 || typeValue > 2) {
      throw new RangeError('Performance.add_custom_monitor type is outside MonitorType.');
    }
    this.custom.set(name, { callable: callable(callableValue), arguments: [...args], type: typeValue });
    this.modified();
  }

  remove_custom_monitor(id: unknown): void {
    if (this.custom.delete(monitorName(id, 'remove_custom_monitor'))) this.modified();
  }

  has_custom_monitor(id: unknown): boolean { return this.custom.has(monitorName(id, 'has_custom_monitor')); }

  get_custom_monitor(id: unknown): unknown {
    const monitor = this.custom.get(monitorName(id, 'get_custom_monitor'));
    return monitor?.callable.call(...(monitor.arguments)) ?? null;
  }

  get_monitor_modification_time(): number { return this.modificationTimeValue; }
  get_custom_monitor_names(): string[] { return [...this.custom.keys()]; }
  get_custom_monitor_types(): PackedInt32Array { return packedInt32Array([...this.custom.values()].map((entry) => entry.type)); }
  clear(): void { if (this.custom.size > 0) { this.custom.clear(); this.modified(); } }
}

export const GodotPerformance = new GodotPerformanceRuntime();
