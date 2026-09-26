/**
 * export-cycle-probe/emit-unity-yaml.ts — Force-Text YAML fragments our unity-analyze reader accepts.
 */
import { createHash } from 'node:crypto';

export function guidFor(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

/** Deterministic positive fileID in Unity's int64 range, never 0 and never SceneRoots' max. */
export function fileIdFor(seed: string): string {
  const hex = createHash('sha256').update(`fileid:${seed}`).digest('hex').slice(0, 15);
  const n = BigInt(`0x${hex}`);
  const id = n === 0n ? 1n : n;
  return id.toString();
}

export function yamlHeader(): string {
  return '%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:';
}

export function docHeader(classId: number, fileId: string, stripped = false): string {
  return stripped ? `--- !u!${classId} &${fileId} stripped` : `--- !u!${classId} &${fileId}`;
}

export function vec3(x: number, y: number, z: number): string {
  return `{x: ${fmt(x)}, y: ${fmt(y)}, z: ${fmt(z)}}`;
}

export function vec4(x: number, y: number, z: number, w: number): string {
  return `{x: ${fmt(x)}, y: ${fmt(y)}, z: ${fmt(z)}, w: ${fmt(w)}}`;
}

export function color(r: number, g: number, b: number, a: number): string {
  return `{r: ${fmt(r)}, g: ${fmt(g)}, b: ${fmt(b)}, a: ${fmt(a)}}`;
}

export function fileRef(fileId: string, guid?: string, type?: number): string {
  if (guid === undefined) return `{fileID: ${fileId}}`;
  const t = type === undefined ? '' : `, type: ${type}`;
  return `{fileID: ${fileId}, guid: ${guid}${t}}`;
}

export function fmt(n: number): string {
  if (Object.is(n, -0)) return '-0';
  if (Number.isInteger(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER) return String(n);
  const plain = n.toString();
  if (Number(plain) === n) return plain;
  return n.toPrecision(17);
}

export function fileMeta(guid: string, importer = 'DefaultImporter'): string {
  return [
    'fileFormatVersion: 2',
    `guid: ${guid}`,
    `${importer}:`,
    '  externalObjects: {}',
    '  userData: ',
    '  assetBundleName: ',
    '  assetBundleVariant: ',
    '',
  ].join('\n');
}

export function folderMeta(guid: string): string {
  return [
    'fileFormatVersion: 2',
    `guid: ${guid}`,
    'folderAsset: yes',
    'DefaultImporter:',
    '  externalObjects: {}',
    '  userData: ',
    '  assetBundleName: ',
    '  assetBundleVariant: ',
    '',
  ].join('\n');
}

export function scriptMeta(guid: string): string {
  return [
    'fileFormatVersion: 2',
    `guid: ${guid}`,
    'MonoImporter:',
    '  externalObjects: {}',
    '  serializedVersion: 2',
    '  defaultReferences: []',
    '  executionOrder: 0',
    '  icon: {instanceID: 0}',
    '  userData: ',
    '  assetBundleName: ',
    '  assetBundleVariant: ',
    '',
  ].join('\n');
}

export function prefabMeta(guid: string): string {
  return fileMeta(guid, 'PrefabImporter');
}

export function nativeMeta(guid: string): string {
  return fileMeta(guid, 'NativeFormatImporter');
}

/** Scene singletons copied from the canary's Force-Text shape so census meets known classIDs. */
export function sceneSingletons(): string {
  return `${docHeader(29, '1')}
OcclusionCullingSettings:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_OcclusionBakeSettings:
    smallestOccluder: 5
    smallestHole: 0.25
    backfaceThreshold: 100
  m_SceneGUID: 00000000000000000000000000000000
  m_OcclusionCullingData: {fileID: 0}
${docHeader(104, '2')}
RenderSettings:
  m_ObjectHideFlags: 0
  serializedVersion: 9
  m_Fog: 0
  m_FogColor: {r: 0.5, g: 0.5, b: 0.5, a: 1}
  m_FogMode: 3
  m_FogDensity: 0.01
  m_LinearFogStart: 0
  m_LinearFogEnd: 300
  m_AmbientSkyColor: {r: 0.212, g: 0.227, b: 0.259, a: 1}
  m_AmbientEquatorColor: {r: 0.114, g: 0.125, b: 0.133, a: 1}
  m_AmbientGroundColor: {r: 0.047, g: 0.043, b: 0.035, a: 1}
  m_AmbientIntensity: 1
  m_AmbientMode: 0
  m_SubtractiveShadowColor: {r: 0.42, g: 0.478, b: 0.627, a: 1}
  m_SkyboxMaterial: {fileID: 10304, guid: 0000000000000000f000000000000000, type: 0}
  m_HaloStrength: 0.5
  m_FlareStrength: 1
  m_FlareFadeSpeed: 3
  m_HaloTexture: {fileID: 0}
  m_SpotCookie: {fileID: 10001, guid: 0000000000000000e000000000000000, type: 0}
  m_DefaultReflectionMode: 0
  m_DefaultReflectionResolution: 128
  m_ReflectionBounces: 1
  m_ReflectionIntensity: 1
  m_CustomReflection: {fileID: 0}
  m_Sun: {fileID: 0}
  m_UseRadianceAmbientProbe: 0
${docHeader(157, '3')}
LightmapSettings:
  m_ObjectHideFlags: 0
  serializedVersion: 12
  m_GIWorkflowMode: 1
  m_GISettings:
    serializedVersion: 2
    m_BounceScale: 1
    m_IndirectOutputScale: 1
    m_AlbedoBoost: 1
    m_EnvironmentLightingMode: 0
    m_EnableBakedLightmaps: 1
    m_EnableRealtimeLightmaps: 0
  m_LightmapEditorSettings:
    serializedVersion: 12
    m_Resolution: 2
    m_BakeResolution: 40
    m_AtlasSize: 1024
    m_AO: 0
    m_AOMaxDistance: 1
    m_CompAOExponent: 1
    m_CompAOExponentDirect: 0
    m_ExtractAmbientOcclusion: 0
    m_Padding: 2
    m_LightmapParameters: {fileID: 0}
    m_LightmapsBakeMode: 1
    m_TextureCompression: 1
    m_FinalGather: 0
    m_FinalGatherFiltering: 1
    m_FinalGatherRayCount: 256
    m_ReflectionCompression: 2
    m_MixedBakeMode: 2
    m_BakeBackend: 1
    m_PVRSampling: 1
    m_PVRDirectSampleCount: 32
    m_PVRSampleCount: 512
    m_PVRBounces: 2
    m_PVREnvironmentSampleCount: 256
    m_PVREnvironmentReferencePointCount: 2048
    m_PVRFilteringMode: 1
    m_PVRDenoiserTypeDirect: 1
    m_PVRDenoiserTypeIndirect: 1
    m_PVRDenoiserTypeAO: 1
    m_PVRFilterTypeDirect: 0
    m_PVRFilterTypeIndirect: 0
    m_PVRFilterTypeAO: 0
    m_PVREnvironmentMIS: 1
    m_PVRCulling: 1
    m_PVRFilteringGaussRadiusDirect: 1
    m_PVRFilteringGaussRadiusIndirect: 5
    m_PVRFilteringGaussRadiusAO: 2
    m_PVRFilteringAtrousPositionSigmaDirect: 0.5
    m_PVRFilteringAtrousPositionSigmaIndirect: 2
    m_PVRFilteringAtrousPositionSigmaAO: 1
    m_ExportTrainingData: 0
    m_TrainingDataDestination: TrainingData
    m_LightProbeSampleCountMultiplier: 4
  m_LightingDataAsset: {fileID: 0}
  m_LightingSettings: {fileID: 0}
${docHeader(196, '4')}
NavMeshSettings:
  serializedVersion: 2
  m_ObjectHideFlags: 0
  m_BuildSettings:
    serializedVersion: 3
    agentTypeID: 0
    agentRadius: 0.5
    agentHeight: 2
    agentSlope: 45
    agentClimb: 0.4
    ledgeDropHeight: 0
    maxJumpAcrossDistance: 0
    minRegionArea: 2
    manualCellSize: 0
    cellSize: 0.16666667
    manualTileSize: 0
    tileSize: 256
    buildHeightMesh: 0
    maxJobWorkers: 0
    preserveTilesOutsideBounds: 0
    debug:
      m_Flags: 0
  m_NavMeshData: {fileID: 0}`;
}

export const SCENE_ROOTS_FILE_ID = '9223372036854775807';

export const BUILT_IN_RESOURCES = '0000000000000000e000000000000000';
export const BUILT_IN_EXTRA = '0000000000000000f000000000000000';
export const MESH_CUBE = 10202;
export const MESH_CYLINDER = 10206;
export const MESH_SPHERE = 10207;
export const MESH_CAPSULE = 10208;
export const DEFAULT_MATERIAL = 10303;
