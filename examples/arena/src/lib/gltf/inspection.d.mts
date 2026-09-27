export interface GltfAnimationSummary {
  index: number;
  name: string;
  duration: number;
  channels: number;
  targetPaths: Record<string, number>;
  targetNodes: string[];
}

export interface GltfSkinSummary {
  index: number;
  name: string;
  jointCount: number;
  roots: string[];
  inverseBindMatrices: boolean;
  joints: string[];
}

export interface GltfInspectionReport {
  file: string;
  bytes: number;
  assetVersion: string | undefined;
  generator: string | undefined;
  counts: {
    scenes: number;
    nodes: number;
    meshes: number;
    primitives: number;
    skins: number;
    animations: number;
    materials: number;
    textures: number;
    images: number;
  };
  externalDependencies: string[];
  skins: GltfSkinSummary[];
  animations: GltfAnimationSummary[];
  warnings: string[];
}

export function inspectGltfDocument(
  document: unknown,
  filePath?: string,
  byteLength?: number,
): GltfInspectionReport;

export function inspectGltfFile(path: string): Promise<GltfInspectionReport>;

export function missingRequiredClips(
  report: GltfInspectionReport,
  requiredClips: string[],
): string[];
