/** Godot 4 ProceduralSkyMaterial carried by a native Three sky-dome shader. */
import {
  BackSide,
  Color,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { bindGodotMaterial, duplicateGodotMaterial } from './material';
import { godotResourceEmitChanged } from './resource-io';
import type { ColorValue } from './variant';

export interface GodotProceduralSkyMaterialState {
  readonly skyTopColor: ColorValue;
  readonly skyHorizonColor: ColorValue;
  readonly skyCurve: number;
  readonly skyEnergyMultiplier: number;
  readonly skyCover: unknown | null;
  readonly skyCoverModulate: ColorValue;
  readonly groundBottomColor: ColorValue;
  readonly groundHorizonColor: ColorValue;
  readonly groundCurve: number;
  readonly groundEnergyMultiplier: number;
  readonly sunAngleMax: number;
  readonly sunCurve: number;
  readonly useDebanding: boolean;
  readonly energyMultiplier: number;
}

const DEFAULTS: GodotProceduralSkyMaterialState = Object.freeze({
  skyTopColor: Object.freeze({ r: 0.385, g: 0.454, b: 0.55, a: 1 }),
  skyHorizonColor: Object.freeze({ r: 0.646, g: 0.656, b: 0.67, a: 1 }),
  skyCurve: 0.15,
  skyEnergyMultiplier: 1,
  skyCover: null,
  skyCoverModulate: Object.freeze({ r: 1, g: 1, b: 1, a: 1 }),
  groundBottomColor: Object.freeze({ r: 0.2, g: 0.169, b: 0.133, a: 1 }),
  groundHorizonColor: Object.freeze({ r: 0.646, g: 0.656, b: 0.67, a: 1 }),
  groundCurve: 0.02,
  groundEnergyMultiplier: 1,
  sunAngleMax: 30,
  sunCurve: 0.15,
  useDebanding: true,
  energyMultiplier: 1,
});

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`ProceduralSkyMaterial.${member} requires a finite number.`);
  }
  return value;
}

function nonnegative(value: unknown, member: string): number {
  const result = finite(value, member);
  if (result < 0) throw new RangeError(`ProceduralSkyMaterial.${member} cannot be negative.`);
  return result;
}

function color(value: unknown, member: string): ColorValue {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`ProceduralSkyMaterial.${member} requires Color.`);
  }
  const input = value as Partial<ColorValue>;
  return {
    r: finite(input.r, member),
    g: finite(input.g, member),
    b: finite(input.b, member),
    a: input.a === undefined ? 1 : finite(input.a, member),
  };
}

function sameColor(a: ColorValue, b: ColorValue): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`ProceduralSkyMaterial.${member} requires bool.`);
  return value;
}

const VERTEX_SHADER = /* glsl */ `
varying vec3 godotSkyDirection;

void main() {
  godotSkyDirection = normalize(position);
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = clip.xyww;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 godotSkyTopColor;
uniform vec3 godotSkyHorizonColor;
uniform float godotSkyCurve;
uniform float godotSkyEnergy;
uniform vec3 godotGroundBottomColor;
uniform vec3 godotGroundHorizonColor;
uniform float godotGroundCurve;
uniform float godotGroundEnergy;
uniform vec3 godotSunDirection;
uniform float godotSunAngleMax;
uniform float godotSunCurve;
uniform float godotEnergyMultiplier;
uniform bool godotUseDebanding;
varying vec3 godotSkyDirection;

float godotCurve(float value, float curve) {
  return pow(clamp(value, 0.0, 1.0), max(curve, 0.00001));
}

float godotInterleavedGradientNoise(vec2 coordinate) {
  return fract(52.9829189 * fract(dot(coordinate, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec3 direction = normalize(godotSkyDirection);
  float up = direction.y;
  vec3 base;
  if (up >= 0.0) {
    float blend = godotCurve(up, godotSkyCurve);
    base = mix(godotSkyHorizonColor, godotSkyTopColor, blend) * godotSkyEnergy;
  } else {
    float blend = godotCurve(-up, godotGroundCurve);
    base = mix(godotGroundHorizonColor, godotGroundBottomColor, blend) * godotGroundEnergy;
  }

  float sunCosine = dot(direction, normalize(godotSunDirection));
  float sunLimit = cos(radians(clamp(godotSunAngleMax, 0.0, 180.0)));
  float sun = smoothstep(sunLimit, 1.0, sunCosine);
  sun = pow(sun, max(godotSunCurve, 0.00001));
  base += vec3(sun);

  if (godotUseDebanding) {
    base += (godotInterleavedGradientNoise(gl_FragCoord.xy) - 0.5) / 255.0;
  }
  gl_FragColor = vec4(max(base * godotEnergyMultiplier, vec3(0.0)), 1.0);
}
`;

export class GodotProceduralSkyMaterial {
  public readonly nativeSky: Mesh<SphereGeometry, ShaderMaterial>;
  private stateValue: GodotProceduralSkyMaterialState;

  public constructor(initial: Partial<GodotProceduralSkyMaterialState> = {}) {
    this.stateValue = {
      skyTopColor: color(initial.skyTopColor ?? DEFAULTS.skyTopColor, 'sky_top_color'),
      skyHorizonColor: color(initial.skyHorizonColor ?? DEFAULTS.skyHorizonColor, 'sky_horizon_color'),
      skyCurve: nonnegative(initial.skyCurve ?? DEFAULTS.skyCurve, 'sky_curve'),
      skyEnergyMultiplier: nonnegative(initial.skyEnergyMultiplier ?? DEFAULTS.skyEnergyMultiplier, 'sky_energy_multiplier'),
      skyCover: initial.skyCover ?? null,
      skyCoverModulate: color(initial.skyCoverModulate ?? DEFAULTS.skyCoverModulate, 'sky_cover_modulate'),
      groundBottomColor: color(initial.groundBottomColor ?? DEFAULTS.groundBottomColor, 'ground_bottom_color'),
      groundHorizonColor: color(initial.groundHorizonColor ?? DEFAULTS.groundHorizonColor, 'ground_horizon_color'),
      groundCurve: nonnegative(initial.groundCurve ?? DEFAULTS.groundCurve, 'ground_curve'),
      groundEnergyMultiplier: nonnegative(initial.groundEnergyMultiplier ?? DEFAULTS.groundEnergyMultiplier, 'ground_energy_multiplier'),
      sunAngleMax: nonnegative(initial.sunAngleMax ?? DEFAULTS.sunAngleMax, 'sun_angle_max'),
      sunCurve: nonnegative(initial.sunCurve ?? DEFAULTS.sunCurve, 'sun_curve'),
      useDebanding: bool(initial.useDebanding ?? DEFAULTS.useDebanding, 'use_debanding'),
      energyMultiplier: nonnegative(initial.energyMultiplier ?? DEFAULTS.energyMultiplier, 'energy_multiplier'),
    };
    const uniforms = {
      godotSkyTopColor: { value: new Color() },
      godotSkyHorizonColor: { value: new Color() },
      godotSkyCurve: { value: 0 },
      godotSkyEnergy: { value: 1 },
      godotGroundBottomColor: { value: new Color() },
      godotGroundHorizonColor: { value: new Color() },
      godotGroundCurve: { value: 0 },
      godotGroundEnergy: { value: 1 },
      godotSunDirection: { value: new Vector3(0, 1, 0) },
      godotSunAngleMax: { value: 30 },
      godotSunCurve: { value: 0.15 },
      godotEnergyMultiplier: { value: 1 },
      godotUseDebanding: { value: true },
    };
    this.nativeSky = new Mesh(
      new SphereGeometry(450_000, 32, 16),
      new ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms,
        side: BackSide,
        depthWrite: false,
        depthTest: true,
        fog: false,
      }),
    );
    this.nativeSky.frustumCulled = false;
    this.nativeSky.renderOrder = -10_000;
    bindGodotMaterial<GodotProceduralSkyMaterial>(this, {}, 'ProceduralSkyMaterial', {
      createDuplicate: (source) => new GodotProceduralSkyMaterial(source.state()),
    });
    this.apply();
  }

  public get sky_top_color(): ColorValue { return this.getSkyTopColor(); }
  public set sky_top_color(value: ColorValue) { this.setSkyTopColor(value); }
  public get sky_horizon_color(): ColorValue { return this.getSkyHorizonColor(); }
  public set sky_horizon_color(value: ColorValue) { this.setSkyHorizonColor(value); }
  public get sky_curve(): number { return this.getSkyCurve(); }
  public set sky_curve(value: number) { this.setSkyCurve(value); }
  public get sky_energy_multiplier(): number { return this.getSkyEnergyMultiplier(); }
  public set sky_energy_multiplier(value: number) { this.setSkyEnergyMultiplier(value); }
  public get sky_cover(): unknown | null { return this.getSkyCover(); }
  public set sky_cover(value: unknown | null) { this.setSkyCover(value); }
  public get sky_cover_modulate(): ColorValue { return this.getSkyCoverModulate(); }
  public set sky_cover_modulate(value: ColorValue) { this.setSkyCoverModulate(value); }
  public get ground_bottom_color(): ColorValue { return this.getGroundBottomColor(); }
  public set ground_bottom_color(value: ColorValue) { this.setGroundBottomColor(value); }
  public get ground_horizon_color(): ColorValue { return this.getGroundHorizonColor(); }
  public set ground_horizon_color(value: ColorValue) { this.setGroundHorizonColor(value); }
  public get ground_curve(): number { return this.getGroundCurve(); }
  public set ground_curve(value: number) { this.setGroundCurve(value); }
  public get ground_energy_multiplier(): number { return this.getGroundEnergyMultiplier(); }
  public set ground_energy_multiplier(value: number) { this.setGroundEnergyMultiplier(value); }
  public get sun_angle_max(): number { return this.getSunAngleMax(); }
  public set sun_angle_max(value: number) { this.setSunAngleMax(value); }
  public get sun_curve(): number { return this.getSunCurve(); }
  public set sun_curve(value: number) { this.setSunCurve(value); }
  public get use_debanding(): boolean { return this.getUseDebanding(); }
  public set use_debanding(value: boolean) { this.setUseDebanding(value); }
  public get energy_multiplier(): number { return this.getEnergyMultiplier(); }
  public set energy_multiplier(value: number) { this.setEnergyMultiplier(value); }

  public setSkyTopColor(value: ColorValue): void { this.setColor('skyTopColor', value, 'sky_top_color'); }
  public getSkyTopColor(): ColorValue { return { ...this.stateValue.skyTopColor }; }
  public setSkyHorizonColor(value: ColorValue): void { this.setColor('skyHorizonColor', value, 'sky_horizon_color'); }
  public getSkyHorizonColor(): ColorValue { return { ...this.stateValue.skyHorizonColor }; }
  public setSkyCurve(value: number): void { this.setScalar('skyCurve', value, 'sky_curve'); }
  public getSkyCurve(): number { return this.stateValue.skyCurve; }
  public setSkyEnergyMultiplier(value: number): void { this.setScalar('skyEnergyMultiplier', value, 'sky_energy_multiplier'); }
  public getSkyEnergyMultiplier(): number { return this.stateValue.skyEnergyMultiplier; }

  public setSkyCover(value: unknown | null): void {
    if (value === this.stateValue.skyCover) return;
    this.stateValue = { ...this.stateValue, skyCover: value };
    godotResourceEmitChanged(this);
  }
  public getSkyCover(): unknown | null { return this.stateValue.skyCover; }
  public setSkyCoverModulate(value: ColorValue): void { this.setColor('skyCoverModulate', value, 'sky_cover_modulate'); }
  public getSkyCoverModulate(): ColorValue { return { ...this.stateValue.skyCoverModulate }; }
  public setGroundBottomColor(value: ColorValue): void { this.setColor('groundBottomColor', value, 'ground_bottom_color'); }
  public getGroundBottomColor(): ColorValue { return { ...this.stateValue.groundBottomColor }; }
  public setGroundHorizonColor(value: ColorValue): void { this.setColor('groundHorizonColor', value, 'ground_horizon_color'); }
  public getGroundHorizonColor(): ColorValue { return { ...this.stateValue.groundHorizonColor }; }
  public setGroundCurve(value: number): void { this.setScalar('groundCurve', value, 'ground_curve'); }
  public getGroundCurve(): number { return this.stateValue.groundCurve; }
  public setGroundEnergyMultiplier(value: number): void { this.setScalar('groundEnergyMultiplier', value, 'ground_energy_multiplier'); }
  public getGroundEnergyMultiplier(): number { return this.stateValue.groundEnergyMultiplier; }
  public setSunAngleMax(value: number): void { this.setScalar('sunAngleMax', value, 'sun_angle_max'); }
  public getSunAngleMax(): number { return this.stateValue.sunAngleMax; }
  public setSunCurve(value: number): void { this.setScalar('sunCurve', value, 'sun_curve'); }
  public getSunCurve(): number { return this.stateValue.sunCurve; }

  public setUseDebanding(value: boolean): void {
    value = bool(value, 'use_debanding');
    if (value === this.stateValue.useDebanding) return;
    this.stateValue = { ...this.stateValue, useDebanding: value };
    this.apply();
    godotResourceEmitChanged(this);
  }
  public getUseDebanding(): boolean { return this.stateValue.useDebanding; }
  public setEnergyMultiplier(value: number): void { this.setScalar('energyMultiplier', value, 'energy_multiplier'); }
  public getEnergyMultiplier(): number { return this.stateValue.energyMultiplier; }

  public applyDirectionalSun(direction: Vector3 | null): boolean {
    const uniform = this.nativeSky.material.uniforms['godotSunDirection']!.value as Vector3;
    const next = direction ?? new Vector3(0, 1, 0);
    if (uniform.equals(next)) return false;
    uniform.copy(next);
    this.nativeSky.material.uniformsNeedUpdate = true;
    return true;
  }

  public state(): GodotProceduralSkyMaterialState {
    return {
      ...this.stateValue,
      skyTopColor: { ...this.stateValue.skyTopColor },
      skyHorizonColor: { ...this.stateValue.skyHorizonColor },
      skyCoverModulate: { ...this.stateValue.skyCoverModulate },
      groundBottomColor: { ...this.stateValue.groundBottomColor },
      groundHorizonColor: { ...this.stateValue.groundHorizonColor },
    };
  }

  public duplicate(deep = false): GodotProceduralSkyMaterial {
    return duplicateGodotMaterial<GodotProceduralSkyMaterial>(
      this,
      (source) => new GodotProceduralSkyMaterial(source.state()),
      deep,
      'ProceduralSkyMaterial',
    );
  }

  private setScalar(
    key: 'skyCurve' | 'skyEnergyMultiplier' | 'groundCurve' | 'groundEnergyMultiplier' |
      'sunAngleMax' | 'sunCurve' | 'energyMultiplier',
    value: number,
    member: string,
  ): void {
    value = nonnegative(value, member);
    if (value === this.stateValue[key]) return;
    this.stateValue = { ...this.stateValue, [key]: value };
    this.apply();
    godotResourceEmitChanged(this);
  }

  private setColor(
    key: 'skyTopColor' | 'skyHorizonColor' | 'skyCoverModulate' |
      'groundBottomColor' | 'groundHorizonColor',
    value: ColorValue,
    member: string,
  ): void {
    const next = color(value, member);
    if (sameColor(next, this.stateValue[key])) return;
    this.stateValue = { ...this.stateValue, [key]: next };
    this.apply();
    godotResourceEmitChanged(this);
  }

  private apply(): void {
    const state = this.stateValue;
    const uniforms = this.nativeSky.material.uniforms;
    uniforms['godotSkyTopColor']!.value.setRGB(state.skyTopColor.r, state.skyTopColor.g, state.skyTopColor.b);
    uniforms['godotSkyHorizonColor']!.value.setRGB(state.skyHorizonColor.r, state.skyHorizonColor.g, state.skyHorizonColor.b);
    uniforms['godotSkyCurve']!.value = state.skyCurve;
    uniforms['godotSkyEnergy']!.value = state.skyEnergyMultiplier;
    uniforms['godotGroundBottomColor']!.value.setRGB(state.groundBottomColor.r, state.groundBottomColor.g, state.groundBottomColor.b);
    uniforms['godotGroundHorizonColor']!.value.setRGB(state.groundHorizonColor.r, state.groundHorizonColor.g, state.groundHorizonColor.b);
    uniforms['godotGroundCurve']!.value = state.groundCurve;
    uniforms['godotGroundEnergy']!.value = state.groundEnergyMultiplier;
    uniforms['godotSunAngleMax']!.value = state.sunAngleMax;
    uniforms['godotSunCurve']!.value = state.sunCurve;
    uniforms['godotEnergyMultiplier']!.value = state.energyMultiplier;
    uniforms['godotUseDebanding']!.value = state.useDebanding;
    this.nativeSky.material.uniformsNeedUpdate = true;
  }
}

export function createGodotProceduralSkyMaterial(
  initial: Partial<GodotProceduralSkyMaterialState> = {},
): GodotProceduralSkyMaterial {
  return new GodotProceduralSkyMaterial(initial);
}
