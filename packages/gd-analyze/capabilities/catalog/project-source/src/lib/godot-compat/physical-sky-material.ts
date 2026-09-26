/**
 * Godot 4 PhysicalSkyMaterial and Godot 3/4 Sky radiance resolution over Three's native
 * atmospheric Sky shader and PMREMGenerator. Only the four scattering scalars that Three's shader
 * consumes are exposed; Godot's colour, night-texture, debanding and sun-disc controls remain loud
 * because retaining them without a shader input would be fake success.
 */
import {
  CubeCamera,
  HalfFloatType,
  Mesh,
  PMREMGenerator,
  Scene,
  WebGLCubeRenderTarget,
  Vector3,
  type DirectionalLight,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { Sky as ThreeSky } from 'three/addons/objects/Sky.js';
import { bindGodotMaterial, duplicateGodotMaterial } from './material';
import { godotDirectionalLightContributesToPhysicalSky } from './light-3d';
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceChangedSignal,
  godotResourceEmitChanged,
} from './resource-io';

export const GODOT_SKY_RADIANCE_SIZE = Object.freeze({
  RADIANCE_SIZE_32: 0,
  RADIANCE_SIZE_64: 1,
  RADIANCE_SIZE_128: 2,
  RADIANCE_SIZE_256: 3,
  RADIANCE_SIZE_512: 4,
  RADIANCE_SIZE_1024: 5,
  RADIANCE_SIZE_2048: 6,
  RADIANCE_SIZE_MAX: 7,
} as const);

export const GODOT_SKY_PROCESS_MODE = Object.freeze({
  PROCESS_MODE_AUTOMATIC: 0,
  PROCESS_MODE_QUALITY: 1,
  PROCESS_MODE_INCREMENTAL: 2,
  PROCESS_MODE_REALTIME: 3,
} as const);

export type GodotSkyProcessMode = 0 | 1 | 2 | 3;
export type GodotSkyRadianceSize = 0 | 1 | 2 | 3 | 4 | 5 | 6;

function skyRadianceSize(value: number): GodotSkyRadianceSize {
  switch (value) {
    case 0:
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
      return value;
    default:
      throw new RangeError('Sky.radiance_size requires RADIANCE_SIZE_32 through RADIANCE_SIZE_2048; RADIANCE_SIZE_MAX is a sentinel.');
  }
}

/** Structural sky-material seam: the returned object remains its native Three sky mesh. */
export interface GodotSkyNativeMaterial {
  readonly nativeSky: Mesh;
  applyDirectionalSun(direction: Vector3 | null): boolean;
}

export interface GodotPhysicalSkyMaterialState {
  readonly rayleighCoefficient: number;
  readonly mieCoefficient: number;
  readonly mieEccentricity: number;
  readonly turbidity: number;
}

function finiteNonnegative(value: number, property: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`PhysicalSkyMaterial.${property} requires a finite nonnegative number.`);
  }
  return value;
}

function finiteUnit(value: number, property: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`PhysicalSkyMaterial.${property} requires a finite number from 0 through 1.`);
  }
  return value;
}

export class GodotPhysicalSkyMaterial {
  public readonly nativeSky = new ThreeSky();
  private rayleighCoefficientValue = 2;
  private mieCoefficientValue = 0.005;
  private mieEccentricityValue = 0.8;
  private turbidityValue = 10;

  public constructor(initial: Partial<GodotPhysicalSkyMaterialState> = {}) {
    bindGodotMaterial<GodotPhysicalSkyMaterial>(this, {}, 'PhysicalSkyMaterial', {
      createDuplicate: (source) => new GodotPhysicalSkyMaterial(source.state()),
    });
    this.nativeSky.scale.setScalar(450_000);
    this.nativeSky.frustumCulled = false;
    if (initial.rayleighCoefficient !== undefined) {
      this.rayleighCoefficientValue = finiteNonnegative(initial.rayleighCoefficient, 'rayleigh_coefficient');
    }
    if (initial.mieCoefficient !== undefined) {
      this.mieCoefficientValue = finiteNonnegative(initial.mieCoefficient, 'mie_coefficient');
    }
    if (initial.mieEccentricity !== undefined) {
      this.mieEccentricityValue = finiteUnit(initial.mieEccentricity, 'mie_eccentricity');
    }
    if (initial.turbidity !== undefined) {
      this.turbidityValue = finiteNonnegative(initial.turbidity, 'turbidity');
    }
    this.applyUniforms();
  }

  public get rayleigh_coefficient(): number { return this.getRayleighCoefficient(); }
  public set rayleigh_coefficient(value: number) { this.setRayleighCoefficient(value); }
  public get mie_coefficient(): number { return this.getMieCoefficient(); }
  public set mie_coefficient(value: number) { this.setMieCoefficient(value); }
  public get mie_eccentricity(): number { return this.getMieEccentricity(); }
  public set mie_eccentricity(value: number) { this.setMieEccentricity(value); }
  public get turbidity(): number { return this.getTurbidity(); }
  public set turbidity(value: number) { this.setTurbidity(value); }

  public setRayleighCoefficient(value: number): void {
    value = finiteNonnegative(value, 'rayleigh_coefficient');
    if (value === this.rayleighCoefficientValue) return;
    this.rayleighCoefficientValue = value;
    this.applyUniforms();
    godotResourceEmitChanged(this);
  }
  public getRayleighCoefficient(): number { return this.rayleighCoefficientValue; }

  public setMieCoefficient(value: number): void {
    value = finiteNonnegative(value, 'mie_coefficient');
    if (value === this.mieCoefficientValue) return;
    this.mieCoefficientValue = value;
    this.applyUniforms();
    godotResourceEmitChanged(this);
  }
  public getMieCoefficient(): number { return this.mieCoefficientValue; }

  public setMieEccentricity(value: number): void {
    value = finiteUnit(value, 'mie_eccentricity');
    if (value === this.mieEccentricityValue) return;
    this.mieEccentricityValue = value;
    this.applyUniforms();
    godotResourceEmitChanged(this);
  }
  public getMieEccentricity(): number { return this.mieEccentricityValue; }

  public setTurbidity(value: number): void {
    value = finiteNonnegative(value, 'turbidity');
    if (value === this.turbidityValue) return;
    this.turbidityValue = value;
    this.applyUniforms();
    godotResourceEmitChanged(this);
  }
  public getTurbidity(): number { return this.turbidityValue; }

  public state(): GodotPhysicalSkyMaterialState {
    return {
      rayleighCoefficient: this.rayleighCoefficientValue,
      mieCoefficient: this.mieCoefficientValue,
      mieEccentricity: this.mieEccentricityValue,
      turbidity: this.turbidityValue,
    };
  }

  public duplicate(deep = false): GodotPhysicalSkyMaterial {
    return duplicateGodotMaterial<GodotPhysicalSkyMaterial>(
      this,
      (source) => new GodotPhysicalSkyMaterial(source.state()),
      deep,
      'PhysicalSkyMaterial',
    );
  }

  private applyUniforms(): void {
    const uniforms = this.nativeSky.material.uniforms;
    uniforms['rayleigh']!.value = this.rayleighCoefficientValue;
    uniforms['mieCoefficient']!.value = this.mieCoefficientValue;
    uniforms['mieDirectionalG']!.value = this.mieEccentricityValue;
    uniforms['turbidity']!.value = this.turbidityValue;
    this.nativeSky.material.uniformsNeedUpdate = true;
  }

  /** Renderer-owned directional sun input; this is not a writable material property. */
  public applyDirectionalSun(direction: Vector3 | null): boolean {
    const value = this.nativeSky.material.uniforms['sunPosition']!.value as Vector3;
    const x = direction?.x ?? 0;
    const y = direction?.y ?? 0;
    const z = direction?.z ?? 0;
    if (value.x === x && value.y === y && value.z === z) return false;
    value.set(x, y, z);
    this.nativeSky.material.uniformsNeedUpdate = true;
    return true;
  }
}

export function createGodotPhysicalSkyMaterial(
  initial: Partial<GodotPhysicalSkyMaterialState> = {},
): GodotPhysicalSkyMaterial {
  return new GodotPhysicalSkyMaterial(initial);
}

export class GodotSky {
  private radianceSizeValue: number = GODOT_SKY_RADIANCE_SIZE.RADIANCE_SIZE_256;
  private processModeValue: GodotSkyProcessMode = GODOT_SKY_PROCESS_MODE.PROCESS_MODE_AUTOMATIC;
  private materialValue: GodotSkyNativeMaterial | null = null;

  public constructor(material: GodotSkyNativeMaterial | null = null) {
    registerGodotObjectIdentity(this, 'Sky');
    bindGodotResourceProtocol<GodotSky>(this, {
      createDuplicate: (source) => {
        const copy = new GodotSky(source.materialValue);
        copy.radianceSizeValue = source.radianceSizeValue;
        copy.processModeValue = source.processModeValue;
        return copy;
      },
      populateDuplicate: (source, target, subresources, memo) => {
        if (!subresources || source.materialValue === null) return;
        target.setMaterial(duplicateGodotSubresource(source.materialValue, memo));
      },
    });
    this.setMaterial(material);
  }

  public get sky_material(): GodotSkyNativeMaterial | null { return this.getMaterial(); }
  public set sky_material(value: GodotSkyNativeMaterial | null) { this.setMaterial(value); }
  public get radiance_size(): number { return this.getRadianceSize(); }
  public set radiance_size(value: number) { this.setRadianceSize(value); }
  public get process_mode(): GodotSkyProcessMode { return this.getProcessMode(); }
  public set process_mode(value: GodotSkyProcessMode) { this.setProcessMode(value); }

  public setMaterial(value: GodotSkyNativeMaterial | null): void {
    if (value !== null && (
      typeof value !== 'object' ||
      !(value.nativeSky instanceof Mesh) ||
      typeof value.applyDirectionalSun !== 'function'
    )) {
      throw new TypeError(
        'Sky.sky_material requires a native Godot sky material or null.',
      );
    }
    if (value === this.materialValue) return;
    this.materialValue = value;
    godotResourceEmitChanged(this);
  }

  public getMaterial(): GodotSkyNativeMaterial | null { return this.materialValue; }

  public setRadianceSize(value: number): void {
    const exact = skyRadianceSize(value);
    if (exact === this.radianceSizeValue) return;
    this.radianceSizeValue = exact;
    godotResourceEmitChanged(this);
  }

  public getRadianceSize(): number { return this.radianceSizeValue; }
  public getRadiancePixelSize(): number { return 2 ** (this.radianceSizeValue + 5); }

  public setProcessMode(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 3) {
      throw new RangeError(
        'Sky.process_mode requires PROCESS_MODE_AUTOMATIC through PROCESS_MODE_REALTIME.',
      );
    }
    if (value === this.processModeValue) return;
    this.processModeValue = value as GodotSkyProcessMode;
    godotResourceEmitChanged(this);
  }

  public getProcessMode(): GodotSkyProcessMode { return this.processModeValue; }
}

export function createGodotSky(material: GodotSkyNativeMaterial | null = null): GodotSky {
  return new GodotSky(material);
}

/** Godot 3 `ProceduralSky.new()` over the same native Three atmospheric shader and radiance sky. */
export function createGodotProceduralSky(): GodotSky {
  const sky = new GodotSky(new GodotPhysicalSkyMaterial({
    rayleighCoefficient: 2,
    mieCoefficient: 0.005,
    mieEccentricity: 0.8,
    turbidity: 10,
  }));
  registerGodotObjectIdentity(sky, 'ProceduralSky');
  return sky;
}

export interface GodotMountedPhysicalSky {
  readonly refreshRadiance: () => void;
  readonly syncDirectionalSun: () => void;
  readonly dispose: () => void;
}

/** Mount the native dome and derive Three's filtered environment at Sky.radiance_size. */
export function mountGodotPhysicalSky(
  scene: Scene,
  renderer: WebGLRenderer,
  sky: GodotSky,
  material: GodotPhysicalSkyMaterial,
  useAsEnvironment = true,
): GodotMountedPhysicalSky {
  if (sky.getMaterial() === null) sky.setMaterial(material);
  let activeMaterial: GodotSkyNativeMaterial | null = sky.getMaterial();
  if (activeMaterial === null) {
    throw new Error('Sky.sky_material requires a PhysicalSkyMaterial before mounting.');
  }
  if (activeMaterial.nativeSky.parent !== null) {
    throw new Error('PhysicalSkyMaterial native sky is already mounted in another Scene.');
  }
  const previousEnvironment = scene.environment;
  let target: WebGLRenderTarget | null = null;
  const generator = new PMREMGenerator(renderer);
  const captureScene = new Scene();
  const lightPosition = new Vector3();
  const targetPosition = new Vector3();
  const sunDirection = new Vector3();
  let captureSky: Mesh | null = new Mesh(activeMaterial.nativeSky.geometry, activeMaterial.nativeSky.material);
  captureSky.scale.copy(activeMaterial.nativeSky.scale);
  captureScene.add(captureSky);
  scene.add(activeMaterial.nativeSky);

  const refreshRadiance = (): void => {
    if (activeMaterial === null || captureSky === null) return;
    const captureTarget = new WebGLCubeRenderTarget(sky.getRadiancePixelSize(), {
      type: HalfFloatType,
    });
    const captureCamera = new CubeCamera(0.1, 500_000, captureTarget);
    captureCamera.update(renderer, captureScene);
    const next = generator.fromCubemap(captureTarget.texture);
    captureTarget.dispose();
    const previous = target;
    target = next;
    if (useAsEnvironment) scene.environment = next.texture;
    previous?.dispose();
  };
  refreshRadiance();
  const refresh = (): void => refreshRadiance();
  let materialConnection: { disconnect(): void } | null =
    godotResourceChangedSignal(activeMaterial).connect(refresh);
  const skyConnection = godotResourceChangedSignal(sky).connect(() => {
    const nextMaterial = sky.getMaterial();
    if (nextMaterial !== activeMaterial) {
      if (nextMaterial !== null && nextMaterial.nativeSky.parent !== null) {
        throw new Error('Replacement PhysicalSkyMaterial native sky is already mounted.');
      }
      materialConnection?.disconnect();
      activeMaterial?.nativeSky.removeFromParent();
      captureSky?.removeFromParent();
      activeMaterial = nextMaterial;
      if (activeMaterial === null) {
        captureSky = null;
        materialConnection = null;
        if (target !== null && scene.environment === target.texture) {
          scene.environment = previousEnvironment;
        }
        target?.dispose();
        target = null;
      } else {
        captureSky = new Mesh(activeMaterial.nativeSky.geometry, activeMaterial.nativeSky.material);
        captureSky.scale.copy(activeMaterial.nativeSky.scale);
        captureScene.add(captureSky);
        scene.add(activeMaterial.nativeSky);
        materialConnection = godotResourceChangedSignal(activeMaterial).connect(refresh);
      }
    }
    refreshRadiance();
  });
  const syncDirectionalSun = (): void => {
    const contributors: DirectionalLight[] = [];
    scene.traverseVisible((object) => {
      if (
        'isDirectionalLight' in object &&
        object.isDirectionalLight === true &&
        godotDirectionalLightContributesToPhysicalSky(object)
      ) {
        contributors.push(object as DirectionalLight);
      }
    });
    if (contributors.length > 1) {
      throw new Error(
        `PhysicalSkyMaterial found ${contributors.length} visible sky-contributing ` +
          'DirectionalLight3D nodes; Three Sky has one sunPosition and cannot flatten multiple Godot suns.',
      );
    }
    const contributor = contributors[0];
    if (contributor === undefined) {
      if (activeMaterial?.applyDirectionalSun(null) === true) refreshRadiance();
      return;
    }
    contributor.updateWorldMatrix(true, false);
    contributor.target.updateWorldMatrix(true, false);
    contributor.getWorldPosition(lightPosition);
    contributor.target.getWorldPosition(targetPosition);
    sunDirection.subVectors(lightPosition, targetPosition);
    if (sunDirection.lengthSq() === 0) {
      throw new Error(
        'PhysicalSkyMaterial cannot derive a sun direction from a DirectionalLight3D whose target coincides with the light.',
      );
    }
    sunDirection.normalize();
    if (activeMaterial?.applyDirectionalSun(sunDirection) === true) refreshRadiance();
  };
  let disposed = false;
  return {
    refreshRadiance,
    syncDirectionalSun,
    dispose() {
      if (disposed) return;
      disposed = true;
      skyConnection.disconnect();
      materialConnection?.disconnect();
      activeMaterial?.nativeSky.removeFromParent();
      captureSky?.removeFromParent();
      if (target !== null && scene.environment === target.texture) {
        scene.environment = previousEnvironment;
      }
      target?.dispose();
      generator.dispose();
    },
  };
}
