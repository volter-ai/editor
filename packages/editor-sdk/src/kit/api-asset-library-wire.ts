/**
 * The asset-library wire — the shapes `/__editor/assets/*` answers with,
 * declared ONCE in a leaf module both sides import (the browser client in
 * `./assets.ts`, the producing routes in `../../server/asset-library-routes.ts`).
 * Deliberately import-free so the server's tsconfig can reach it without
 * dragging the client's whole module graph along.
 */

export interface OnlineAsset {
  id: string;
  source: 'polyhaven' | 'ambientcg' | 'local';
  name: string;
  type: 'model' | 'animation' | 'source' | 'hdri' | 'texture' | 'material';
  thumbnailUrl: string;
  categories: string[];
  tags: string[];
  downloadCount?: number;
  license?: string;
  author?: string;
  sourceUrl?: string;
  cloudHosted?: boolean;
  variantId?: string;
  variantCount?: number;
  sizeBytes?: number;
  animationCount?: number;
  deliveryKinds?: ('local-ssd' | 'cloud' | 'remote')[];
  addedAt?: string;
  capabilities?: {
    previewable: boolean;
    importable: boolean;
    runtimeReady: boolean;
    animated: boolean;
    deliveryAvailable: boolean;
    health: 'healthy' | 'source-only' | 'unsupported';
  };
}

export interface AssetFileOption {
  label: string;
  format: string;
  url: string;
  sizeBytes?: number;
  /** Additional files that must be downloaded alongside the main URL (GLTF includes). */
  includes?: { relativePath: string; url: string; size: number }[];
}
