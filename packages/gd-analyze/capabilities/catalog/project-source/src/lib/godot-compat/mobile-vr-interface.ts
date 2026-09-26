export interface GodotMobileVRCarrier {
  initialize?(settings: GodotMobileVRSettings): boolean;
  uninitialize?(): void;
  process?(delta: number, settings: GodotMobileVRSettings): void;
}

export interface GodotMobileVRSettings {
  eyeHeight: number;
  iod: number;
  displayWidth: number;
  displayToLens: number;
  offsetRect: Readonly<{ x: number; y: number; width: number; height: number }>;
  oversample: number;
  k1: number;
  k2: number;
  vrsMinRadius: number;
  vrsStrength: number;
}

function positive(value: number, member: string, allowZero = false): number {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new RangeError(`MobileVRInterface.${member} must be ${allowZero ? 'non-negative' : 'positive'}.`);
  }
  return value;
}

export class GodotMobileVRInterface {
  private eyeHeight = 1.85;
  private iod = 6.5;
  private displayWidth = 14.5;
  private displayToLens = 4;
  private offsetRect = { x: 0, y: 0, width: 1, height: 1 };
  private oversample = 1.5;
  private k1 = 0.215;
  private k2 = 0.215;
  private vrsMinRadius = 20;
  private vrsStrength = 1;
  private initialized = false;

  constructor(private readonly carrier: GodotMobileVRCarrier = {}) {}

  set_eye_height(eyeHeight: number): void { this.eyeHeight = positive(eyeHeight, 'eye_height'); }
  get_eye_height(): number { return this.eyeHeight; }
  set_iod(iod: number): void { this.iod = positive(iod, 'iod', true); }
  get_iod(): number { return this.iod; }
  set_display_width(displayWidth: number): void { this.displayWidth = positive(displayWidth, 'display_width'); }
  get_display_width(): number { return this.displayWidth; }
  set_display_to_lens(displayToLens: number): void { this.displayToLens = positive(displayToLens, 'display_to_lens'); }
  get_display_to_lens(): number { return this.displayToLens; }

  set_offset_rect(offsetRect: Readonly<{ x: number; y: number; width: number; height: number }>): void {
    if (![offsetRect.x, offsetRect.y, offsetRect.width, offsetRect.height].every(Number.isFinite)) {
      throw new TypeError('MobileVRInterface.offset_rect must be finite.');
    }
    this.offsetRect = { ...offsetRect };
  }

  get_offset_rect(): Readonly<{ x: number; y: number; width: number; height: number }> { return this.offsetRect; }
  set_oversample(oversample: number): void { this.oversample = positive(oversample, 'oversample'); }
  get_oversample(): number { return this.oversample; }
  set_k1(k: number): void { this.k1 = positive(k, 'k1', true); }
  get_k1(): number { return this.k1; }
  set_k2(k: number): void { this.k2 = positive(k, 'k2', true); }
  get_k2(): number { return this.k2; }
  get_vrs_min_radius(): number { return this.vrsMinRadius; }
  set_vrs_min_radius(radius: number): void { this.vrsMinRadius = positive(radius, 'vrs_min_radius', true); }
  get_vrs_strength(): number { return this.vrsStrength; }
  set_vrs_strength(strength: number): void { this.vrsStrength = positive(strength, 'vrs_strength', true); }

  get_name(): string { return 'Native mobile'; }
  get_capabilities(): number { return 3; }
  is_primary(): boolean { return false; }
  is_initialized(): boolean { return this.initialized; }

  initialize(): boolean {
    if (this.initialized) return true;
    this.initialized = this.carrier.initialize?.(this.get_settings()) ?? true;
    return this.initialized;
  }

  uninitialize(): void {
    if (!this.initialized) return;
    this.carrier.uninitialize?.();
    this.initialized = false;
  }

  process(delta: number): void {
    if (this.initialized) this.carrier.process?.(delta, this.get_settings());
  }

  get_render_target_size(viewportSize: Readonly<{ x: number; y: number }>): Readonly<{ x: number; y: number }> {
    return { x: Math.ceil(viewportSize.x * this.oversample), y: Math.ceil(viewportSize.y * this.oversample) };
  }

  get_transform_for_view(view: number, cameraTransform: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    const offset = view === 0 ? -this.iod * 0.005 : this.iod * 0.005;
    return { ...cameraTransform, mobile_vr_eye_offset: offset, mobile_vr_eye_height: this.eyeHeight };
  }

  get_projection_for_view(view: number, aspect: number, near: number, far: number): Readonly<Record<string, number>> {
    const eyeOffset = view === 0 ? -this.iod / 2 : this.iod / 2;
    const fov = 2 * Math.atan((this.displayWidth / 2) / this.displayToLens);
    return { view, aspect, near, far, eyeOffset, fov, k1: this.k1, k2: this.k2 };
  }

  get_settings(): GodotMobileVRSettings {
    return {
      eyeHeight: this.eyeHeight,
      iod: this.iod,
      displayWidth: this.displayWidth,
      displayToLens: this.displayToLens,
      offsetRect: this.offsetRect,
      oversample: this.oversample,
      k1: this.k1,
      k2: this.k2,
      vrsMinRadius: this.vrsMinRadius,
      vrsStrength: this.vrsStrength,
    };
  }
}

export function createGodotMobileVRInterface(carrier: GodotMobileVRCarrier = {}): GodotMobileVRInterface {
  return new GodotMobileVRInterface(carrier);
}
