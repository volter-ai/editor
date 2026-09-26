import type { SupportedGodotMajor } from './source-authority';
import { godotSourceAuthority } from './source-authority';

/**
 * Versioned, target-neutral Godot resource/import meaning.
 *
 * Readers may know Godot's serialized dictionaries; translators and printers may not. This is the
 * first vertical slice of the same closed semantic boundary Unity's `BoundCSharpProgram` uses.
 * New resource semantics enter as explicit variants and the validator is total over every variant.
 */
export const GODOT_FRONTEND_PROTOCOL = 'vgai.godot-frontend' as const;
export const GODOT_FRONTEND_PROTOCOL_VERSION = 5 as const;

export type BoundGodotCubemapArrangement = '1x6' | '2x3' | '3x2' | '6x1';

export interface BoundGodotExternalMaterial {
  readonly name: string;
  readonly resPath: string;
}

interface BoundGodotObjImportBase {
  readonly kind: 'wavefront-obj';
  readonly sidecarPath: string;
  readonly sourcePath: string;
  readonly generateTangents: boolean;
  readonly scaleMesh: readonly [number, number, number];
  readonly offsetMesh: readonly [number, number, number];
}

export type BoundGodotObjImport = BoundGodotObjImportBase &
  (
    | {
        readonly engineMajor: 3;
        readonly optimizeMesh: boolean;
        readonly importerVersion?: never;
        readonly forceDisableMeshCompression?: never;
      }
    | {
        readonly engineMajor: 4;
        readonly optimizeMesh?: never;
        readonly importerVersion: 1;
        readonly forceDisableMeshCompression: boolean;
      }
  );

export type BoundGodotAssetImport =
  | {
      readonly kind: 'scene';
      readonly sidecarPath: string;
      readonly sourcePath: string;
      readonly godot3MaterialsStorage?: number;
      readonly godot3StoreInSubdir?: boolean;
      readonly externalMaterials: readonly BoundGodotExternalMaterial[];
    }
  | {
      readonly kind: 'cubemap-texture';
      readonly sidecarPath: string;
      readonly sourcePath: string;
      readonly arrangement: BoundGodotCubemapArrangement;
    }
  | BoundGodotObjImport
  | {
      readonly kind: 'other';
      readonly sidecarPath: string;
      readonly importer?: string;
      readonly sourcePath?: string;
    };

export interface BoundGodotResourceProgram {
  readonly protocol: typeof GODOT_FRONTEND_PROTOCOL;
  readonly protocolVersion: typeof GODOT_FRONTEND_PROTOCOL_VERSION;
  readonly engineMajor: SupportedGodotMajor;
  /** Immutable Godot source revision that supplied the meaning represented here. */
  readonly sourceRevision: string;
  /** Exact ClassDB/GDNative dump paired with {@link sourceRevision}. */
  readonly apiDumpSha256: string;
  readonly evidence: {
    readonly claimIds: readonly string[];
    readonly registryDigest: string;
  };
  readonly imports: readonly BoundGodotAssetImport[];
}

export function assertBoundGodotResourceProgram(
  value: BoundGodotResourceProgram,
): asserts value is BoundGodotResourceProgram {
  if (value.protocol !== GODOT_FRONTEND_PROTOCOL) {
    throw new Error(`Godot frontend protocol mismatch: ${String(value.protocol)}`);
  }
  if (value.protocolVersion !== GODOT_FRONTEND_PROTOCOL_VERSION) {
    throw new Error(`Godot frontend version mismatch: ${String(value.protocolVersion)}`);
  }
  const authority = godotSourceAuthority(value.engineMajor);
  if (value.sourceRevision !== authority.revision) {
    throw new Error(
      `Godot frontend source revision mismatch for ${authority.version}: ` +
        `${value.sourceRevision} != ${authority.revision}`,
    );
  }
  if (value.apiDumpSha256 !== authority.apiDumpSha256) {
    throw new Error(
      `Godot frontend API dump mismatch for ${authority.version}: ` +
        `${value.apiDumpSha256} != ${authority.apiDumpSha256}`,
    );
  }
  if (
    value.evidence.claimIds.length === 0 ||
    new Set(value.evidence.claimIds).size !== value.evidence.claimIds.length ||
    !/^[0-9a-f]{64}$/.test(value.evidence.registryDigest)
  ) {
    throw new Error('Godot frontend resource evidence is missing or malformed');
  }
  const sidecars = new Set<string>();
  for (const imported of value.imports) {
    if (!imported.sidecarPath.startsWith('res://') || sidecars.has(imported.sidecarPath)) {
      throw new Error(`Godot frontend sidecar identity is invalid: ${imported.sidecarPath}`);
    }
    sidecars.add(imported.sidecarPath);
    if (imported.kind === 'other') continue;
    if (!imported.sourcePath.startsWith('res://')) {
      throw new Error(`Godot frontend source identity is invalid: ${imported.sourcePath}`);
    }
    if (imported.kind === 'cubemap-texture') {
      if (!(['1x6', '2x3', '3x2', '6x1'] as const).includes(imported.arrangement)) {
        throw new Error(
          `Godot frontend cubemap arrangement is invalid: ${String(imported.arrangement)}`,
        );
      }
      continue;
    }
    if (imported.kind === 'wavefront-obj') {
      const serialized = imported as unknown as Readonly<Record<string, unknown>>;
      if (imported.engineMajor !== value.engineMajor) {
        throw new Error(
          `Godot frontend OBJ engine major is invalid: ${String(imported.engineMajor)} != ${value.engineMajor}`,
        );
      }
      if (
        imported.engineMajor === 3 &&
        ('importerVersion' in serialized || 'forceDisableMeshCompression' in serialized)
      ) {
        throw new Error(
          `Godot 3 frontend OBJ carries Godot 4 importer fields for ${imported.sourcePath}`,
        );
      }
      if (imported.engineMajor === 4 && serialized['importerVersion'] !== 1) {
        throw new Error(
          `Godot frontend OBJ importer version is invalid: ${String(serialized['importerVersion'])}`,
        );
      }
      if (
        typeof imported.generateTangents !== 'boolean' ||
        (imported.engineMajor === 3 && typeof imported.optimizeMesh !== 'boolean') ||
        (imported.engineMajor === 4 && typeof imported.forceDisableMeshCompression !== 'boolean')
      ) {
        throw new Error(`Godot frontend OBJ importer flags are invalid for ${imported.sourcePath}`);
      }
      for (const [name, vector] of [
        ['scale_mesh', imported.scaleMesh],
        ['offset_mesh', imported.offsetMesh],
      ] as const) {
        if (vector.length !== 3 || vector.some((component) => !Number.isFinite(component))) {
          throw new Error(`Godot frontend OBJ ${name} is invalid for ${imported.sourcePath}`);
        }
      }
      continue;
    }
    const names = new Set<string>();
    for (const material of imported.externalMaterials) {
      if (
        material.name === '' ||
        names.has(material.name) ||
        !material.resPath.startsWith('res://')
      ) {
        throw new Error(
          `Godot frontend external material is invalid: ${material.name} -> ${material.resPath}`,
        );
      }
      names.add(material.name);
    }
  }
}
