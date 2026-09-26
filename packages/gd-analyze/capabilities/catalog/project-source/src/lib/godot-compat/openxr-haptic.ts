/** Godot OpenXR haptic resources. */

import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';

export class GodotOpenXRHapticBase {
  constructor(className = 'OpenXRHapticBase') {
    registerGodotObjectIdentity(this, className);
    bindGodotResourceProtocol<GodotOpenXRHapticBase>(this, {
      createDuplicate: () => new GodotOpenXRHapticBase(className),
    });
  }
}

export class GodotOpenXRHapticVibration extends GodotOpenXRHapticBase {
  private duration = -1;
  private frequency = 0;
  private amplitude = 1;
  constructor() {
    super('OpenXRHapticVibration');
    bindGodotResourceProtocol<GodotOpenXRHapticVibration>(this, {
      createDuplicate: (source) => {
        const duplicate = new GodotOpenXRHapticVibration();
        duplicate.duration = source.duration;
        duplicate.frequency = source.frequency;
        duplicate.amplitude = source.amplitude;
        return duplicate;
      },
    });
  }
  set_duration(duration: number): void {
    if (!Number.isSafeInteger(duration) || duration < -1) throw new RangeError('OpenXR haptic duration requires -1 or non-negative nanoseconds.');
    if (duration === this.duration) return;
    this.duration = duration;
    godotResourceEmitChanged(this);
  }
  get_duration(): number { return this.duration; }
  set_frequency(frequency: number): void {
    if (!Number.isFinite(frequency) || frequency < 0) throw new RangeError('OpenXR haptic frequency must be non-negative.');
    if (frequency === this.frequency) return;
    this.frequency = frequency;
    godotResourceEmitChanged(this);
  }
  get_frequency(): number { return this.frequency; }
  set_amplitude(amplitude: number): void {
    if (!Number.isFinite(amplitude) || amplitude < 0 || amplitude > 1) throw new RangeError('OpenXR haptic amplitude requires 0..1.');
    if (amplitude === this.amplitude) return;
    this.amplitude = amplitude;
    godotResourceEmitChanged(this);
  }
  get_amplitude(): number { return this.amplitude; }
}

export function createGodotOpenXRHapticBase(): GodotOpenXRHapticBase { return new GodotOpenXRHapticBase(); }
export function createGodotOpenXRHapticVibration(): GodotOpenXRHapticVibration { return new GodotOpenXRHapticVibration(); }
