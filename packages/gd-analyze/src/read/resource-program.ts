import {
  assertBoundGodotResourceProgram,
  type BoundGodotAssetImport,
  type BoundGodotCubemapArrangement,
  type BoundGodotResourceProgram,
  GODOT_FRONTEND_PROTOCOL,
  GODOT_FRONTEND_PROTOCOL_VERSION,
} from '../godot-frontend/protocol';
import { godotSourceAuthority } from '../godot-frontend/source-authority';
import type { GodotReadAuthority } from './authority';
import { GodotReadAuthorityResolver } from './authority';
import type { GodotProject } from './godot-types';
import type { ImportSidecar } from './import-sidecar';

export class GodotResourceBindingError extends Error {
  constructor(
    readonly at: string,
    message: string,
  ) {
    super(`${at}: ${message}`);
    this.name = 'GodotResourceBindingError';
  }
}

const CUBEMAP_ARRANGEMENTS: Readonly<Record<number, BoundGodotCubemapArrangement>> = {
  0: '1x6',
  1: '2x3',
  2: '3x2',
  3: '6x1',
};

const GODOT3_OBJ_OPTIONS = new Set([
  'generate_tangents',
  'scale_mesh',
  'offset_mesh',
  'optimize_mesh',
]);
const GODOT4_OBJ_OPTIONS = new Set([
  'generate_tangents',
  'generate_lods',
  'generate_shadow_mesh',
  'generate_lightmap_uv2',
  'generate_lightmap_uv2_texel_size',
  'scale_mesh',
  'offset_mesh',
  'force_disable_mesh_compression',
]);

function assertSupportedMajor(engineMajor: number | undefined): asserts engineMajor is 3 | 4 {
  if (engineMajor !== 3 && engineMajor !== 4) {
    throw new GodotResourceBindingError(
      'project.godot',
      `the Godot engine major is ${String(engineMajor)}, but this reader is pinned to ` +
        'Godot 3 and 4 source authorities.',
    );
  }
}

function sceneImport(sidecar: ImportSidecar): BoundGodotAssetImport | undefined {
  if (sidecar.importer !== 'scene' || sidecar.sourceFile === undefined) return undefined;
  return {
    kind: 'scene',
    sidecarPath: sidecar.resPath,
    sourcePath: sidecar.sourceFile,
    ...(sidecar.materialsStorage === undefined
      ? {}
      : { godot3MaterialsStorage: sidecar.materialsStorage }),
    ...(sidecar.storeInSubdir === undefined ? {} : { godot3StoreInSubdir: sidecar.storeInSubdir }),
    externalMaterials: Object.entries(sidecar.externalMaterials ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, resPath]) => ({ name, resPath })),
  };
}

function cubemapImport(sidecar: ImportSidecar): BoundGodotAssetImport | undefined {
  if (sidecar.importer !== 'cubemap_texture' || sidecar.sourceFile === undefined) return undefined;
  const arrangement = CUBEMAP_ARRANGEMENTS[sidecar.cubemapArrangement ?? 1];
  if (arrangement === undefined) {
    throw new GodotResourceBindingError(
      sidecar.resPath,
      `cubemap slices/arrangement ${String(sidecar.cubemapArrangement)} is outside Godot's closed layouts`,
    );
  }
  return {
    kind: 'cubemap-texture',
    sidecarPath: sidecar.resPath,
    sourcePath: sidecar.sourceFile,
    arrangement,
  };
}

function otherImport(sidecar: ImportSidecar): BoundGodotAssetImport {
  return {
    kind: 'other',
    sidecarPath: sidecar.resPath,
    ...(sidecar.importer === undefined ? {} : { importer: sidecar.importer }),
    ...(sidecar.sourceFile === undefined ? {} : { sourcePath: sidecar.sourceFile }),
  };
}

function objImport(engineMajor: 3 | 4, sidecar: ImportSidecar): BoundGodotAssetImport {
  const params = sidecar.objParams;
  if (params === undefined || sidecar.sourceFile === undefined) {
    throw new GodotResourceBindingError(
      sidecar.resPath,
      'wavefront_obj sidecar has no typed importer parameters or source file',
    );
  }
  const allowedOptions = engineMajor === 3 ? GODOT3_OBJ_OPTIONS : GODOT4_OBJ_OPTIONS;
  const unknownOptions = params.authoredOptions.filter((option) => !allowedOptions.has(option));
  if (unknownOptions.length > 0) {
    throw new GodotResourceBindingError(
      sidecar.resPath,
      `Godot ${engineMajor} wavefront_obj authors unsupported option(s): ${unknownOptions.join(', ')}`,
    );
  }
  const versionIsExact =
    engineMajor === 3 ? params.importerVersion === undefined : params.importerVersion === 1;
  if (!versionIsExact || params.resourceType !== 'Mesh') {
    throw new GodotResourceBindingError(
      sidecar.resPath,
      `Godot ${engineMajor} wavefront_obj version/type does not match its pinned dialect`,
    );
  }
  if (
    params.generateTangents === undefined ||
    params.scaleMesh === undefined ||
    params.offsetMesh === undefined ||
    (engineMajor === 3 && params.optimizeMesh === undefined) ||
    (engineMajor === 4 && params.forceDisableMeshCompression === undefined)
  ) {
    throw new GodotResourceBindingError(
      sidecar.resPath,
      `Godot ${engineMajor} wavefront_obj omits a required pinned import option`,
    );
  }
  const base = {
    kind: 'wavefront-obj' as const,
    sidecarPath: sidecar.resPath,
    sourcePath: sidecar.sourceFile,
    generateTangents: params.generateTangents,
    scaleMesh: params.scaleMesh,
    offsetMesh: params.offsetMesh,
  };
  return engineMajor === 3
    ? { ...base, engineMajor: 3, optimizeMesh: params.optimizeMesh as boolean }
    : {
        ...base,
        engineMajor: 4,
        importerVersion: 1,
        forceDisableMeshCompression: params.forceDisableMeshCompression as boolean,
      };
}

function bindSidecar(engineMajor: 3 | 4, sidecar: ImportSidecar): BoundGodotAssetImport {
  const scene = sceneImport(sidecar);
  if (scene !== undefined) return scene;
  const cubemap = cubemapImport(sidecar);
  if (cubemap !== undefined) return cubemap;
  return sidecar.importer === 'wavefront_obj'
    ? objImport(engineMajor, sidecar)
    : otherImport(sidecar);
}

/** Decode serialized resource/import meaning once in the read layer. */
export function bindGodotResources(
  project: GodotProject,
  readAuthority: GodotReadAuthority,
): BoundGodotResourceProgram {
  const engineMajor = project.engine.major;
  assertSupportedMajor(engineMajor);
  const authority = godotSourceAuthority(engineMajor);
  const resolver = new GodotReadAuthorityResolver(readAuthority);
  if (
    resolver.sourceRevision !== authority.revision ||
    project.readEvidence.registryDigest !== resolver.registryDigest
  ) {
    throw new GodotResourceBindingError(
      'project.godot',
      'resource binding authority differs from the authority that decoded the project',
    );
  }
  const evidenceClaimIds = new Set(project.readEvidence.claimIds);
  if (project.imports.some((sidecar) => sidecar.importer === 'wavefront_obj')) {
    evidenceClaimIds.add(resolver.require('obj-import-options').claimId);
  }
  if (project.imports.some((sidecar) => sidecar.importer === 'cubemap_texture')) {
    evidenceClaimIds.add(resolver.require('cubemap-import-options').claimId);
  }
  const program: BoundGodotResourceProgram = {
    protocol: GODOT_FRONTEND_PROTOCOL,
    protocolVersion: GODOT_FRONTEND_PROTOCOL_VERSION,
    engineMajor,
    sourceRevision: authority.revision,
    apiDumpSha256: authority.apiDumpSha256,
    evidence: {
      claimIds: [...evidenceClaimIds],
      registryDigest: resolver.registryDigest,
    },
    imports: project.imports.map((sidecar) => bindSidecar(engineMajor, sidecar)),
  };
  assertBoundGodotResourceProgram(program);
  return program;
}
