/**
 * A structural authoring projection over a live Phaser 3 game.
 *
 * Phaser belongs behind the generic `canvas` surface: this adapter never
 * imports Phaser and never asks the host to become a Phaser runtime. It reads
 * the public shape of the game instance the editor's realm holds, projects
 * active scenes and their display lists into ordinary EditorNodes, and writes
 * the native object's own transform/visibility fields directly. The game
 * remains the entity model; no mirror tree or editor scene is fabricated.
 */

import type {
  AuthoringAdapter,
  AuthoringCapabilities,
  AuthoringProvenance,
  EditorNode,
  PropertyDescriptor,
  Transform,
} from '@volter/editor-project/adapter';
import type { EditorShellStore } from '@volter/editor-threejs/kit/editor-shell-store';
import { createEphemeralPersistence } from './ephemeral-persistence';

export interface PhaserGameObjectLike {
  name?: string;
  type?: string;
  active?: boolean;
  visible?: boolean;
  alpha?: number;
  depth?: number;
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  list?: PhaserGameObjectLike[];
  constructor?: { name?: string };
}

export interface PhaserSceneLike {
  sys?: { settings?: { key?: string; active?: boolean } };
  children?: { list?: PhaserGameObjectLike[] };
}

export interface PhaserGameLike {
  scene?: { getScenes?: (activeOnly?: boolean) => PhaserSceneLike[] };
  canvas?: HTMLCanvasElement;
  destroy?: (removeCanvas?: boolean, noReturn?: boolean) => void;
}

type IndexedValue =
  | { kind: 'scene'; scene: PhaserSceneLike; node: EditorNode }
  | { kind: 'object'; object: PhaserGameObjectLike; node: EditorNode };

function angleToQuat(angle: number): [number, number, number, number] {
  return [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
}

function quatToAngle(q: [number, number, number, number]): number {
  return 2 * Math.atan2(q[2], q[3]);
}

function cleanSegment(value: string): string {
  return encodeURIComponent(value || 'unnamed');
}

function objectChildren(object: PhaserGameObjectLike): PhaserGameObjectLike[] {
  return Array.isArray(object.list) ? object.list : [];
}

export class PhaserLiveAuthoringAdapter implements AuthoringAdapter {
  readonly capabilities: AuthoringCapabilities = {
    transform: true,
    inspectorFields: true,
    persist: false,
  };

  readonly provenance: AuthoringProvenance = {
    source: 'foreign',
    label: 'live-only',
    detail:
      'Live Phaser scene/display lists projected directly — edits apply to native game objects for this session only.',
  };

  readonly persistence = {
    ...createEphemeralPersistence(),
    destination: 'live-only (not saved)',
  };

  private readonly indexed = new Map<string, IndexedValue>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly game: PhaserGameLike,
    private readonly store: EditorShellStore,
  ) {}

  refresh(): { scenes: number; objects: number } {
    this.reindex();
    let scenes = 0;
    let objects = 0;
    for (const value of this.indexed.values()) {
      if (value.kind === 'scene') scenes++;
      else objects++;
    }
    return { scenes, objects };
  }

  private scenes(): PhaserSceneLike[] {
    const getScenes = this.game.scene?.getScenes;
    if (typeof getScenes !== 'function') return [];
    const active = getScenes.call(this.game.scene, true);
    return Array.isArray(active) ? active : [];
  }

  private reindex(): void {
    this.indexed.clear();
    for (const [sceneIndex, scene] of this.scenes().entries()) {
      const sceneName = scene.sys?.settings?.key || `Scene ${sceneIndex + 1}`;
      const sceneId = `phaser:scene:${sceneIndex}:${cleanSegment(sceneName)}`;
      const roots = Array.isArray(scene.children?.list) ? scene.children.list : [];
      const sceneNode: EditorNode = {
        id: sceneId,
        label: sceneName,
        role: 'root',
        kind: 'phaser-scene',
        typeLabel: 'Phaser.Scene',
        parentId: null,
        childIds: [],
      };
      this.indexed.set(sceneId, { kind: 'scene', scene, node: sceneNode });
      sceneNode.childIds = roots.map((object, index) =>
        this.indexObject(object, sceneId, `${sceneIndex}/${index}`),
      );
    }
  }

  private indexObject(object: PhaserGameObjectLike, parentId: string, path: string): string {
    const nativeType = object.type || object.constructor?.name || 'GameObject';
    const label = object.name || nativeType;
    // Structural path only: renaming a native object must not change the id
    // the editor selection and undo surfaces use for it.
    const id = `phaser:object:${path}`;
    const node: EditorNode = {
      id,
      label,
      role: 'entity',
      kind: `phaser-${nativeType.toLowerCase()}`,
      // Bundled Phaser classes are routinely minified (`c`, `a`, ...). Its
      // public GameObject `type` is the stable player-facing type name.
      typeLabel: nativeType,
      parentId,
      childIds: [],
    };
    this.indexed.set(id, { kind: 'object', object, node });
    node.childIds = objectChildren(object).map((child, index) =>
      this.indexObject(child, id, `${path}/${index}`),
    );
    return id;
  }

  readonly hierarchy = {
    roots: (): EditorNode[] => {
      this.reindex();
      return [...this.indexed.values()]
        .filter((value) => value.kind === 'scene')
        .map((value) => value.node);
    },
    node: (id: string): EditorNode | null => {
      this.reindex();
      return this.indexed.get(id)?.node ?? null;
    },
  };

  readonly selection = {
    get: (): string[] => [...this.store.shell.selectedEntityIds],
    set: (ids: string[]): void => {
      this.store.shell.selectMultiple(ids);
      this.notify();
    },
  };

  readonly transforms = {
    dimensions: (id: string): '2d' | null => {
      this.reindex();
      return this.indexed.get(id)?.kind === 'object' ? '2d' : null;
    },
    get: (id: string): Transform => {
      this.reindex();
      const value = this.indexed.get(id);
      if (!value || value.kind !== 'object') {
        return { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
      }
      const object = value.object;
      return {
        position: [object.x ?? 0, object.y ?? 0, object.depth ?? 0],
        rotation: angleToQuat(object.rotation ?? 0),
        scale: [object.scaleX ?? 1, object.scaleY ?? 1, 1],
      };
    },
    beginEdit: (_id: string): void => {},
    apply: (id: string, transform: Transform): void => {
      this.reindex();
      const value = this.indexed.get(id);
      if (!value || value.kind !== 'object') return;
      value.object.x = transform.position[0];
      value.object.y = transform.position[1];
      value.object.depth = transform.position[2];
      value.object.rotation = quatToAngle(transform.rotation);
      value.object.scaleX = transform.scale[0];
      value.object.scaleY = transform.scale[1];
      this.notify();
    },
    endEdit: (_id: string): void => {},
  };

  readonly inspector = {
    properties: (id: string): PropertyDescriptor[] => {
      this.reindex();
      const value = this.indexed.get(id);
      if (!value) return [];
      if (value.kind === 'scene') {
        return [{ path: 'key', label: 'Scene key', type: 'string', readonly: true }];
      }
      return [
        { path: 'type', label: 'Type', type: 'string', readonly: true },
        { path: 'name', label: 'Name', type: 'string' },
        { path: 'active', label: 'Active', type: 'boolean' },
        { path: 'visible', label: 'Visible', type: 'boolean' },
        { path: 'alpha', label: 'Alpha', type: 'number' },
        { path: 'depth', label: 'Depth', type: 'number' },
      ];
    },
    get: (id: string, path: string): unknown => {
      this.reindex();
      const value = this.indexed.get(id);
      if (!value) return undefined;
      if (value.kind === 'scene')
        return path === 'key' ? value.scene.sys?.settings?.key : undefined;
      if (path === 'type') return value.object.type || value.object.constructor?.name;
      return value.object[path as keyof PhaserGameObjectLike];
    },
    set: (id: string, path: string, value: unknown): void => {
      this.reindex();
      const indexed = this.indexed.get(id);
      if (!indexed || indexed.kind !== 'object' || path === 'type') return;
      (indexed.object as unknown as Record<string, unknown>)[path] = value;
      this.notify();
    },
  };

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.listeners.clear();
    this.indexed.clear();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
    this.store.shell.notifyIngestEdit();
  }
}
