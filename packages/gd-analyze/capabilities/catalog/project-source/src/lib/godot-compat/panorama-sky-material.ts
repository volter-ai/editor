/**
 * Godot 4.7 PanoramaSkyMaterial over Three's native equirectangular texture/background slots.
 * Godot 3's `PanoramaSky : Sky` is a different resource class and is translated by the environment
 * data lane; it is deliberately not presented as this Godot 4 Material identity.
 */
import {
  EquirectangularReflectionMapping,
  LinearFilter,
  NearestFilter,
  type Scene,
  Texture,
} from 'three';
import { registerGodotObjectIdentity } from './object';
import { bindGodotMaterial, duplicateGodotMaterial } from './material';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceChangedSignal,
  godotResourceEmitChanged,
} from './resource-io';
import { GodotSky } from './physical-sky-material';

/** Godot 3 `PanoramaSky : Sky`, retained as the source Resource over a native equirect texture. */
export class GodotPanoramaSky extends GodotSky {
  private panoramaValue: Texture | null = null;

  public constructor(panorama: Texture | null = null) {
    super();
    // Godot 3 PanoramaSky defaults to RADIANCE_SIZE_128; Godot 4 Sky defaults to 256.
    this.setRadianceSize(2);
    registerGodotObjectIdentity(this, 'PanoramaSky');
    bindGodotResourceProtocol<GodotPanoramaSky>(this, {
      createDuplicate: (source) => {
        const copy = new GodotPanoramaSky(source.panoramaValue);
        copy.setRadianceSize(source.getRadianceSize());
        return copy;
      },
      populateDuplicate: (source, target, subresources, memo) => {
        if (!subresources || source.panoramaValue === null) return;
        target.setPanorama(duplicateGodotSubresource(source.panoramaValue, memo));
      },
    });
    this.setPanorama(panorama);
  }

  public get panorama(): Texture | null { return this.panoramaValue; }
  public set panorama(value: Texture | null) { this.setPanorama(value); }

  public getPanorama(): Texture | null { return this.panoramaValue; }
  public setPanorama(value: Texture | null): void {
    if (value !== null && !(value instanceof Texture)) {
      throw new TypeError('PanoramaSky.panorama requires a native Texture or null.');
    }
    if (value === this.panoramaValue) return;
    this.panoramaValue = value;
    if (value !== null) {
      value.mapping = EquirectangularReflectionMapping;
      value.needsUpdate = true;
    }
    godotResourceEmitChanged(this);
  }
}

export function createGodotPanoramaSky(): GodotPanoramaSky {
  return new GodotPanoramaSky();
}

export interface GodotPanoramaSkyMaterialState {
  readonly panorama: Texture | null;
  readonly filter: boolean;
  readonly energyMultiplier: number;
}

export interface GodotPanoramaSkyApplication {
  readonly background?: boolean;
  readonly environment?: boolean;
}

export class GodotPanoramaSkyMaterial {
  private panoramaValue: Texture | null = null;
  private filterValue = true;
  private energyMultiplierValue = 1;

  public constructor(initial: Partial<GodotPanoramaSkyMaterialState> = {}) {
    bindGodotMaterial<GodotPanoramaSkyMaterial>(this, {}, 'PanoramaSkyMaterial', {
      createDuplicate: (source) => new GodotPanoramaSkyMaterial(source.state()),
      populateDuplicate: (source, target, subresources, memo) => {
        if (!subresources || source.panoramaValue === null) return;
        target.setPanorama(duplicateGodotSubresource(source.panoramaValue, memo));
      },
    });
    if (initial.filter !== undefined) this.filterValue = initial.filter;
    if (initial.energyMultiplier !== undefined) {
      this.energyMultiplierValue = initial.energyMultiplier;
    }
    if (initial.panorama !== undefined) this.setPanorama(initial.panorama);
  }

  public get panorama(): Texture | null {
    return this.panoramaValue;
  }

  public set panorama(value: Texture | null) {
    this.setPanorama(value);
  }

  public setPanorama(texture: Texture | null): void {
    if (texture === this.panoramaValue) return;
    this.panoramaValue = texture;
    this.prepareTexture();
    this.emitChanged();
  }

  public getPanorama(): Texture | null {
    return this.panoramaValue;
  }

  public get filter(): boolean {
    return this.filterValue;
  }

  public set filter(value: boolean) {
    this.setFilteringEnabled(value);
  }

  public setFilteringEnabled(enabled: boolean): void {
    if (enabled === this.filterValue) return;
    this.filterValue = enabled;
    this.prepareTexture();
    this.emitChanged();
  }

  public isFilteringEnabled(): boolean {
    return this.filterValue;
  }

  public get energyMultiplier(): number {
    return this.energyMultiplierValue;
  }

  public set energyMultiplier(value: number) {
    this.setEnergyMultiplier(value);
  }

  public setEnergyMultiplier(multiplier: number): void {
    if (multiplier === this.energyMultiplierValue) return;
    this.energyMultiplierValue = multiplier;
    this.emitChanged();
  }

  public getEnergyMultiplier(): number {
    return this.energyMultiplierValue;
  }

  public applyToScene(
    scene: Scene,
    application: GodotPanoramaSkyApplication = { background: true },
  ): void {
    const texture = this.panoramaValue;
    if (application.background === true) {
      scene.background = texture;
      scene.backgroundIntensity = this.energyMultiplierValue;
    }
    if (application.environment === true) {
      scene.environment = texture;
      scene.environmentIntensity = this.energyMultiplierValue;
    }
  }

  public state(): GodotPanoramaSkyMaterialState {
    return {
      panorama: this.panoramaValue,
      filter: this.filterValue,
      energyMultiplier: this.energyMultiplierValue,
    };
  }

  public duplicate(deep = false): GodotPanoramaSkyMaterial {
    return duplicateGodotMaterial<GodotPanoramaSkyMaterial>(
      this,
      (material) =>
        new GodotPanoramaSkyMaterial({
          panorama: deep ? material.panoramaValue?.clone() ?? null : material.panoramaValue,
          filter: material.filterValue,
          energyMultiplier: material.energyMultiplierValue,
        }),
      deep,
      'PanoramaSkyMaterial',
    );
  }

  public onChanged(listener: () => void): () => void {
    const connection = godotResourceChangedSignal(this).connect(listener);
    return () => connection.disconnect();
  }

  private prepareTexture(): void {
    const texture = this.panoramaValue;
    if (texture === null) return;
    texture.mapping = EquirectangularReflectionMapping;
    texture.magFilter = this.filterValue ? LinearFilter : NearestFilter;
    texture.minFilter = this.filterValue ? LinearFilter : NearestFilter;
    texture.needsUpdate = true;
  }

  private emitChanged(): void {
    godotResourceEmitChanged(this);
  }
}

export function createGodotPanoramaSkyMaterial(
  initial: Partial<GodotPanoramaSkyMaterialState> = {},
): GodotPanoramaSkyMaterial {
  return new GodotPanoramaSkyMaterial(initial);
}

export function applyGodotPanoramaSkyMaterial(
  scene: Scene,
  material: GodotPanoramaSkyMaterial,
  application: GodotPanoramaSkyApplication = { background: true },
): void {
  material.applyToScene(scene, application);
}
