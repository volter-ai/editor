/** Godot OpenXR frame synthesis state over a native runtime carrier. */

import { registerGodotObjectIdentity } from './object';

export interface GodotOpenXRFrameSynthesisCarrier {
  isAvailable(): boolean;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  getRelaxFrameInterval(): boolean;
  setRelaxFrameInterval(relaxed: boolean): void;
  skipNextFrame(): void;
}

export class GodotOpenXRFrameSynthesisExtension {
  constructor(private readonly carrier: GodotOpenXRFrameSynthesisCarrier) {
    registerGodotObjectIdentity(this, 'OpenXRFrameSynthesisExtension');
  }

  is_available(): boolean { return Boolean(this.carrier.isAvailable()); }
  is_enabled(): boolean { return this.is_available() && Boolean(this.carrier.isEnabled()); }
  set_enabled(enable: boolean): void {
    if (enable && !this.is_available()) throw new Error('OpenXR frame synthesis is unavailable.');
    this.carrier.setEnabled(Boolean(enable));
  }
  get_relax_frame_interval(): boolean { return Boolean(this.carrier.getRelaxFrameInterval()); }
  set_relax_frame_interval(relaxFrameInterval: boolean): void {
    this.carrier.setRelaxFrameInterval(Boolean(relaxFrameInterval));
  }
  skip_next_frame(): void {
    if (!this.is_enabled()) throw new Error('OpenXR frame synthesis must be enabled before skipping a frame.');
    this.carrier.skipNextFrame();
  }
}

export function createGodotOpenXRFrameSynthesisExtension(
  carrier: GodotOpenXRFrameSynthesisCarrier,
): GodotOpenXRFrameSynthesisExtension {
  return new GodotOpenXRFrameSynthesisExtension(carrier);
}
