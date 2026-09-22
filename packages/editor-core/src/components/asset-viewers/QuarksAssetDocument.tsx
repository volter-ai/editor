import type { ToolObject3DDocumentAuthoringFactory } from '@volter/editor-sdk/contributions';
import { themeVars } from '@volter/editor-sdk/widgets';
import type {
  AuthoringAdapter,
  InspectorProvider,
  PropertyDescriptor,
} from '@volter/editor-project/adapter';
import { resolveUrl } from '@volter/editor-threejs/loader';
import {
  ColorGeneratorFromJSON,
  type FunctionJSON,
  GeneratorFromJSON,
  ValueGeneratorFromJSON,
} from 'quarks.core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type * as THREE from 'three';
import { type ParticleSystem, QuarksLoader } from 'three.quarks';
import { quarksParticleSystems } from '../../authoring/quarks-particle-systems';
import { projectOutputPath } from '../../project-provenance';
import { Object3DDocumentViewport } from '../StageHost';

type JsonObject = Record<string, unknown>;

interface QuarksObjectNode extends JsonObject {
  uuid?: string;
  type?: string;
  ps?: JsonObject;
  children?: QuarksObjectNode[];
}

export interface NativeQuarksJsonSource {
  readonly text: string;
  readonly json: JsonObject;
  readonly projectPath: string;
}

interface QuarksEmitterArtifact {
  readonly system: ParticleSystem;
  readonly json: QuarksObjectNode;
}

interface QuarksAssetArtifact {
  readonly root: THREE.Object3D;
  readonly originalText: string;
  readonly json: JsonObject;
  readonly emitters: ReadonlyMap<THREE.Object3D, QuarksEmitterArtifact>;
  dirty: boolean;
}

const artifacts = new WeakMap<THREE.Object3D, QuarksAssetArtifact>();

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function objectNode(value: unknown): QuarksObjectNode | null {
  return isObject(value) ? (value as QuarksObjectNode) : null;
}

function walkObjectJson(node: QuarksObjectNode, visit: (node: QuarksObjectNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walkObjectJson(child, visit);
}

/** Recognize the library's own Object3D JSON structurally, independent of a
 * filename convention. Quarks does not define a special file extension. */
export function isNativeQuarksJson(value: unknown): value is JsonObject {
  if (!isObject(value)) return false;
  const root = objectNode(value['object']);
  if (!root) return false;
  let emitter = false;
  walkObjectJson(root, (node) => {
    if (node.type === 'ParticleEmitter' && isObject(node.ps) && node.ps['version'] !== undefined) {
      emitter = true;
    }
  });
  return emitter;
}

function jsonNodesByUuid(json: JsonObject): Map<string, QuarksObjectNode> {
  const nodes = new Map<string, QuarksObjectNode>();
  const root = objectNode(json['object']);
  if (!root) return nodes;
  walkObjectJson(root, (node) => {
    if (typeof node.uuid === 'string') nodes.set(node.uuid, node);
  });
  return nodes;
}

function buildQuarksArtifact(source: NativeQuarksJsonSource): QuarksAssetArtifact {
  const root = new QuarksLoader().parse<THREE.Object3D>(source.json);
  const jsonByUuid = jsonNodesByUuid(source.json);
  const systems = quarksParticleSystems(root);
  const systemByEmitter = new Map(
    systems.map((system) => [system.emitter as THREE.Object3D, system]),
  );
  const emitters = new Map<THREE.Object3D, QuarksEmitterArtifact>();
  root.traverse((object) => {
    const system = systemByEmitter.get(object);
    if (!system) return;
    const json = jsonByUuid.get(object.uuid);
    if (!json?.ps) {
      throw new Error(
        `Native Quarks emitter ${object.name || object.uuid} has no matching JSON node.`,
      );
    }
    emitters.set(object, { system, json });
  });
  if (emitters.size === 0) throw new Error('The Quarks document contains no loadable emitter.');
  const artifact: QuarksAssetArtifact = {
    root,
    originalText: source.text,
    json: source.json,
    emitters,
    dirty: false,
  };
  artifacts.set(root, artifact);
  return artifact;
}

function artifactFor(root: THREE.Object3D): QuarksAssetArtifact {
  const artifact = artifacts.get(root);
  if (!artifact) throw new Error('Object3D is not a native three.quarks JSON document.');
  return artifact;
}

function disposeQuarksArtifact(artifact: QuarksAssetArtifact): void {
  for (const emitter of artifact.emitters.values()) emitter.system.dispose();
  artifacts.delete(artifact.root);
}

function serializeQuarksArtifact(root: THREE.Object3D): string {
  const artifact = artifactFor(root);
  // The initial history fingerprint must be the exact bytes that were opened;
  // formatting is canonicalized only after a real native-field edit.
  return artifact.dirty ? `${JSON.stringify(artifact.json, null, 2)}\n` : artifact.originalText;
}

const NATIVE_PARTICLE_PATHS = new Set([
  'particles.duration',
  'particles.looping',
  'particles.prewarm',
  'particles.worldSpace',
  'particles.startLife',
  'particles.startSpeed',
  'particles.startRotation',
  'particles.startSize',
  'particles.startColor',
  'particles.emissionOverTime',
  'particles.emissionOverDistance',
]);

function particleProperties(): PropertyDescriptor[] {
  return [
    {
      path: 'particles.duration',
      label: 'Duration',
      type: 'number',
      group: 'Emission',
    },
    {
      path: 'particles.looping',
      label: 'Looping',
      type: 'boolean',
      group: 'Emission',
    },
    {
      path: 'particles.prewarm',
      label: 'Prewarm',
      type: 'boolean',
      group: 'Emission',
    },
    {
      path: 'particles.emissionOverTime',
      label: 'Rate over time',
      type: 'json',
      group: 'Emission',
    },
    {
      path: 'particles.emissionOverDistance',
      label: 'Rate over distance',
      type: 'json',
      group: 'Emission',
    },
    {
      path: 'particles.startLife',
      label: 'Lifetime',
      type: 'json',
      group: 'Start',
    },
    {
      path: 'particles.startSpeed',
      label: 'Speed',
      type: 'json',
      group: 'Start',
    },
    {
      path: 'particles.startRotation',
      label: 'Rotation',
      type: 'json',
      group: 'Start',
    },
    {
      path: 'particles.startSize',
      label: 'Size',
      type: 'json',
      group: 'Start',
    },
    {
      path: 'particles.startColor',
      label: 'Color',
      type: 'json',
      group: 'Start',
    },
    {
      path: 'particles.worldSpace',
      label: 'World space',
      type: 'boolean',
      group: 'Simulation',
    },
    {
      path: 'particles.shape',
      label: 'Shape',
      type: 'string',
      readonly: true,
      group: 'Shape',
    },
    {
      path: 'particles.behaviors',
      label: 'Modules',
      type: 'json',
      readonly: true,
      group: 'Behavior',
    },
    {
      path: 'particles.renderMode',
      label: 'Native render mode',
      type: 'number',
      readonly: true,
      group: 'Renderer',
    },
  ];
}

function functionJson(value: unknown, label: string): FunctionJSON {
  if (!isObject(value) || typeof value['type'] !== 'string') {
    throw new Error(`${label} must be a native quarks function JSON object with a type.`);
  }
  return value as FunctionJSON;
}

function particleValue(emitter: QuarksEmitterArtifact, path: string): unknown {
  const { system } = emitter;
  switch (path) {
    case 'particles.duration':
      return system.duration;
    case 'particles.looping':
      return system.looping;
    case 'particles.prewarm':
      return system.prewarm;
    case 'particles.worldSpace':
      return system.worldSpace;
    case 'particles.startLife':
      return system.startLife.toJSON();
    case 'particles.startSpeed':
      return system.startSpeed.toJSON();
    case 'particles.startRotation':
      return system.startRotation.toJSON();
    case 'particles.startSize':
      return system.startSize.toJSON();
    case 'particles.startColor':
      return system.startColor.toJSON();
    case 'particles.emissionOverTime':
      return system.emissionOverTime.toJSON();
    case 'particles.emissionOverDistance':
      return system.emissionOverDistance.toJSON();
    case 'particles.shape':
      return system.emitterShape.type;
    case 'particles.behaviors':
      return system.behaviors.map((behavior) => behavior.type);
    case 'particles.renderMode':
      return system.renderMode;
    default:
      return undefined;
  }
}

function nativeJsonKey(path: string): string {
  return path.slice('particles.'.length);
}

function applyParticleValue(emitter: QuarksEmitterArtifact, path: string, value: unknown): void {
  const { system } = emitter;
  switch (path) {
    case 'particles.duration': {
      const duration = Number(value);
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error('Particle duration must be a positive finite number.');
      }
      system.duration = duration;
      break;
    }
    case 'particles.looping':
      system.looping = Boolean(value);
      break;
    case 'particles.prewarm':
      system.prewarm = Boolean(value);
      break;
    case 'particles.worldSpace':
      system.worldSpace = Boolean(value);
      break;
    case 'particles.startLife':
      system.startLife = ValueGeneratorFromJSON(functionJson(value, 'Lifetime'));
      break;
    case 'particles.startSpeed':
      system.startSpeed = ValueGeneratorFromJSON(functionJson(value, 'Speed'));
      break;
    case 'particles.startRotation':
      system.startRotation = GeneratorFromJSON(
        functionJson(value, 'Rotation'),
      ) as typeof system.startRotation;
      break;
    case 'particles.startSize':
      system.startSize = GeneratorFromJSON(functionJson(value, 'Size')) as typeof system.startSize;
      break;
    case 'particles.startColor':
      system.startColor = ColorGeneratorFromJSON(functionJson(value, 'Color'));
      break;
    case 'particles.emissionOverTime':
      system.emissionOverTime = ValueGeneratorFromJSON(functionJson(value, 'Rate over time'));
      break;
    case 'particles.emissionOverDistance':
      system.emissionOverDistance = ValueGeneratorFromJSON(
        functionJson(value, 'Rate over distance'),
      );
      break;
    default:
      throw new Error(`Particle field ${path} is read-only.`);
  }
  emitter.json.ps![nativeJsonKey(path)] = value;
  system.restart();
}

function restoreParticleValue(
  emitter: QuarksEmitterArtifact,
  path: string,
  previousLive: unknown,
  previousJson: unknown,
): void {
  applyParticleValue(emitter, path, previousLive);
  emitter.json.ps![nativeJsonKey(path)] = previousJson;
}

function cloneJson(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

const createQuarksAuthoring: ToolObject3DDocumentAuthoringFactory = ({
  root,
  defaultAdapter,
  commit,
}) => {
  const artifact = artifactFor(root);
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const emitterFor = (id: string): QuarksEmitterArtifact | null => {
    const object = defaultAdapter.hierarchy.object3D?.(id);
    return object ? (artifact.emitters.get(object) ?? null) : null;
  };
  const inspector: InspectorProvider = {
    properties: (id) => [
      ...(defaultAdapter.inspector?.properties(id) ?? []),
      ...(emitterFor(id) ? particleProperties() : []),
    ],
    get: (id, path) => {
      const emitter = emitterFor(id);
      return emitter && path.startsWith('particles.')
        ? particleValue(emitter, path)
        : defaultAdapter.inspector?.get(id, path);
    },
    set: async (id, path, value) => {
      const emitter = emitterFor(id);
      if (!emitter || !NATIVE_PARTICLE_PATHS.has(path)) {
        await defaultAdapter.inspector?.set(id, path, value);
        return;
      }
      const previousLive = particleValue(emitter, path);
      const key = nativeJsonKey(path);
      const previousJson = cloneJson(emitter.json.ps?.[key]);
      const wasDirty = artifact.dirty;
      try {
        applyParticleValue(emitter, path, value);
        artifact.dirty = true;
        notify();
        await commit(`Edit ${emitter.system.emitter.name || 'Particle Emitter'}`);
      } catch (cause) {
        restoreParticleValue(emitter, path, previousLive, previousJson);
        artifact.dirty = wasDirty;
        notify();
        throw cause;
      }
    },
  };
  const adapter: AuthoringAdapter = {
    capabilities: { ...defaultAdapter.capabilities, inspectorFields: true, persist: true },
    provenance: {
      source: 'document',
      label: 'three.quarks JSON',
      detail:
        'The hierarchy and emitter fields are the native three.quarks Object3D JSON document.',
    },
    hierarchy: defaultAdapter.hierarchy,
    ...(defaultAdapter.selection ? { selection: defaultAdapter.selection } : {}),
    ...(defaultAdapter.transforms ? { transforms: defaultAdapter.transforms } : {}),
    inspector,
    subscribe: (listener) => {
      listeners.add(listener);
      const unsubscribeDefault = defaultAdapter.subscribe?.(listener) ?? (() => {});
      return () => {
        listeners.delete(listener);
        unsubscribeDefault();
      };
    },
  };
  return { adapter, dispose: () => listeners.clear() };
};

export async function loadNativeQuarksJsonSource(
  assetPath: string,
  signal?: AbortSignal,
): Promise<NativeQuarksJsonSource | null> {
  const response = await fetch(resolveUrl(assetPath), {
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`Could not load ${assetPath}: HTTP ${response.status}.`);
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  return isNativeQuarksJson(json)
    ? { text, json, projectPath: projectOutputPath(assetPath) }
    : null;
}

export function QuarksAssetDocument({
  documentId,
  assetPath,
  displayName,
  active,
  source,
}: {
  readonly documentId: string;
  readonly assetPath: string;
  readonly displayName: string;
  readonly active: boolean;
  readonly source: NativeQuarksJsonSource;
}) {
  const [artifact, setArtifact] = useState<QuarksAssetArtifact | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setArtifact(null);
      return;
    }
    let built: QuarksAssetArtifact | null = null;
    try {
      built = buildQuarksArtifact(source);
      setArtifact(built);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    return () => {
      if (built) disposeQuarksArtifact(built);
    };
  }, [active, source]);

  const build = useCallback(() => {
    if (!artifact) throw new Error(`Particle asset ${assetPath} is not loaded.`);
    return { root: artifact.root, dispose() {} };
  }, [artifact, assetPath]);
  const persistence = useMemo(
    () => ({
      label: `Edit ${displayName}`,
      resources: [
        {
          path: source.projectPath,
          contentType: 'application/json',
          serialize: ({ root }: { root: THREE.Object3D }) => serializeQuarksArtifact(root),
        },
      ],
    }),
    [displayName, source.projectPath],
  );

  if (error)
    return (
      <div role="alert" style={{ padding: 20, color: themeVars.semantic.danger }}>
        {error}
      </div>
    );
  if (!artifact)
    return (
      <div style={{ padding: 20, color: themeVars.content.muted }}>Loading {displayName}…</div>
    );
  return (
    <Object3DDocumentViewport
      documentId={documentId}
      sourcePath={assetPath}
      displayName={displayName}
      build={build}
      active={active}
      assetType="particles"
      persistence={persistence}
      authoring={createQuarksAuthoring}
      dressing={{ grid: true }}
    />
  );
}
