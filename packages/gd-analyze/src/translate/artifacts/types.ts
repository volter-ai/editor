import type { DirectJsonValue } from '../data/direct-project-data-plan';

export interface GodotSourceTranslationOrigin {
  readonly kind: 'source-translation';
  readonly sourcePath: string;
  readonly sourceDigest: string;
}

export interface GodotProjectDataOrigin {
  readonly kind: 'project-data';
  readonly sourcePaths: readonly string[];
  readonly toolchainSources: readonly {
    readonly path: string;
    readonly digest: string;
  }[];
}

export interface GodotAssetOrigin {
  readonly kind: 'asset-copy';
  readonly sourcePath: string;
  readonly sourceDigest: string;
  readonly operation:
    | { readonly kind: 'byte-identical-copy' }
    | {
        readonly kind: 'native-conversion';
        readonly converterId: string;
        readonly converterVersion: string;
        readonly options: DirectJsonValue;
      };
}

export interface GodotCapabilityCopyOrigin {
  readonly kind: 'capability-copy';
  readonly capabilityId: string;
  readonly capabilityVersion: string;
  readonly catalogPath: string;
}

export interface GodotPlannedSourceTranslationArtifact {
  readonly kind: 'source-translation';
  readonly path: string;
  readonly sourceMapPath: string;
  readonly emission:
    | {
        readonly kind: 'code-module';
        readonly syntaxSourcePath: string;
        readonly inputDigest: string;
      }
    | {
        readonly kind: 'scene-module';
        readonly sceneResPath: string;
        readonly inputDigest: string;
      };
  readonly origin: GodotSourceTranslationOrigin;
  readonly planIdentity: string;
}

export type GodotPlannedProjectDataArtifact =
  | {
      readonly kind: 'project-data';
      readonly path: string;
      readonly content: {
        readonly kind: 'generated-target-ts';
        readonly module: 'world' | 'main' | 'vite-config';
        readonly inputDigest: string;
      };
      readonly sourceMapPath: string;
      readonly origin: GodotProjectDataOrigin;
      readonly planIdentity: string;
    }
  | {
      readonly kind: 'project-data';
      readonly path: string;
      readonly content: { readonly kind: 'json'; readonly value: DirectJsonValue };
      readonly origin: GodotProjectDataOrigin;
      readonly planIdentity: string;
    }
  | {
      readonly kind: 'project-data';
      readonly path: string;
      readonly content: { readonly kind: 'bytes'; readonly bytes: Uint8Array };
      readonly digest: string;
      readonly origin: GodotProjectDataOrigin;
      readonly planIdentity: string;
    };

export interface GodotPlannedAssetArtifact {
  readonly kind: 'asset-copy';
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly digest: string;
  readonly origin: GodotAssetOrigin;
  readonly planIdentity: string;
}

export interface GodotPlannedCapabilityCopyArtifact {
  readonly kind: 'capability-copy';
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly digest: string;
  readonly origin: GodotCapabilityCopyOrigin;
  readonly planIdentity: string;
}

export type GodotPlannedArtifact =
  | GodotPlannedSourceTranslationArtifact
  | GodotPlannedProjectDataArtifact
  | GodotPlannedAssetArtifact
  | GodotPlannedCapabilityCopyArtifact;

export type GodotArtifactOrigin =
  | GodotSourceTranslationOrigin
  | GodotProjectDataOrigin
  | GodotAssetOrigin
  | GodotCapabilityCopyOrigin;

export interface GodotEmittedArtifact {
  readonly kind: GodotPlannedArtifact['kind'];
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly digest: string;
  readonly origin: GodotArtifactOrigin;
  readonly role: 'primary' | 'source-map';
  readonly planIdentity: string;
}

export type GodotEmittedSourceTranslationArtifact = GodotEmittedArtifact & {
  readonly kind: 'source-translation';
  readonly origin: GodotSourceTranslationOrigin;
};
