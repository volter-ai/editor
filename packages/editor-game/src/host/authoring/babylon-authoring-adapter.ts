/**
 * Babylon.js authoring over the engine's native scene graph.
 *
 * Babylon stays the entity model. This adapter imports no Babylon package: it
 * walks the engine's public `scenes` / `rootNodes` / `getChildren()` surface
 * and writes the native Node transform and visibility fields directly.
 */

import type {
  AuthoringAdapter,
  AuthoringCapabilities,
  AuthoringProvenance,
  EditorNode,
  PickProvider,
  PropertyDescriptor,
  Transform,
  WriteAck,
} from '@volter/editor-project/adapter';
import type { ChannelValue } from '@volter/editor-core/creation-site-edit';
import { creationSiteAnchor, instancesAtSite } from '@volter/editor-sdk/kit/creation-site-registry';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import type { EditorShellStore } from '@volter/editor-threejs/kit/editor-shell-store';
import { type JournalSubject, JsonHistoryResource } from '../history/json-history-resource';
import { createEphemeralPersistence } from './ephemeral-persistence';
import { persistChannelWrite } from './gesture-persist';
import type { SourcePersistenceBackend, SourceWriteSubject } from './source-persistence-backend';

interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

interface QuaternionLike extends Vector3Like {
  w: number;
}

export interface BabylonNodeLike {
  name?: string;
  id?: string;
  uniqueId?: number;
  position?: Vector3Like;
  rotation?: Vector3Like;
  rotationQuaternion?: QuaternionLike | null;
  scaling?: Vector3Like;
  isVisible?: boolean;
  visibility?: number;
  getClassName?: () => string;
  getChildren?: () => BabylonNodeLike[];
  isEnabled?: (checkAncestors?: boolean) => boolean;
  setEnabled?: (enabled: boolean) => void;
}

export interface BabylonSceneLike {
  uid?: string;
  name?: string;
  rootNodes?: BabylonNodeLike[];
  isDisposed?: () => boolean;
  activeCamera?: unknown;
  pick?: (x: number, y: number) => { hit?: boolean; pickedMesh?: BabylonNodeLike | null };
  onPointerObservable?: {
    add(callback: (event: { pickInfo?: { pickedMesh?: BabylonNodeLike | null } }) => void): unknown;
    remove(token: unknown): void;
  };
}

export interface BabylonEngineLike {
  scenes?: BabylonSceneLike[];
  dispose?: () => void;
}

interface BabylonGizmoManagerLike {
  positionGizmoEnabled: boolean;
  rotationGizmoEnabled: boolean;
  scaleGizmoEnabled: boolean;
  usePointerToAttachGizmos: boolean;
  attachToMesh(mesh: unknown): void;
  attachToNode?(node: unknown): void;
  dispose(): void;
}

interface BabylonApiLike {
  GizmoManager?: new (scene: BabylonSceneLike) => BabylonGizmoManagerLike;
}

export interface BabylonAuthoringOptions {
  readonly canvas?: HTMLCanvasElement;
  readonly api?: BabylonApiLike;
  readonly persistence?: SourcePersistenceBackend;
  readonly provenance?: AuthoringProvenance;
  /** The subject whose session this adapter's live edits are journaled
   *  under — the same `authoringJournal(worldId)` the Pixi sibling takes.
   *  Absent, no history entries are pushed (the play and ingest mounts). */
  readonly journal?: JournalSubject;
}

/** One session-journal snapshot: every indexed node's channels, plus the
 *  edit record that alone identifies the resource (see `conflictIdentity`). */
interface BabylonHistoryState {
  edits: number;
  nodes: Record<string, Record<string, ChannelValue>>;
}

type IndexedValue =
  | { kind: 'scene'; scene: BabylonSceneLike; node: EditorNode }
  | { kind: 'node'; object: BabylonNodeLike; node: EditorNode };

function cleanSegment(value: string): string {
  return encodeURIComponent(value || 'unnamed');
}

function className(object: BabylonNodeLike): string {
  try {
    return object.getClassName?.() || 'Node';
  } catch {
    return 'Node';
  }
}

function directChildren(object: BabylonNodeLike): BabylonNodeLike[] {
  try {
    const children = object.getChildren?.();
    return Array.isArray(children) ? children : [];
  } catch {
    return [];
  }
}

function quaternionFromEuler(rotation: Vector3Like | undefined): QuaternionLike {
  const x = rotation?.x ?? 0;
  const y = rotation?.y ?? 0;
  const z = rotation?.z ?? 0;
  const cx = Math.cos(x / 2);
  const sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2);
  const sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2);
  const sz = Math.sin(z / 2);
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz,
  };
}

function eulerFromQuaternion([x, y, z, w]: Transform['rotation']): Vector3Like {
  const sinrCosp = 2 * (w * x + y * z);
  const cosrCosp = 1 - 2 * (x * x + y * y);
  const sinp = 2 * (w * y - z * x);
  const sinyCosp = 2 * (w * z + x * y);
  const cosyCosp = 1 - 2 * (y * y + z * z);
  return {
    x: Math.atan2(sinrCosp, cosrCosp),
    y: Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp),
    z: Math.atan2(sinyCosp, cosyCosp),
  };
}

function writeVector(target: Vector3Like | undefined, value: readonly number[]): void {
  if (!target) return;
  target.x = value[0] ?? target.x;
  target.y = value[1] ?? target.y;
  target.z = value[2] ?? target.z;
}

function writeEulerRotation(object: BabylonNodeLike, value: readonly number[]): void {
  if (!object.rotationQuaternion) {
    writeVector(object.rotation, value);
    return;
  }
  const quaternion = quaternionFromEuler({
    x: value[0] ?? 0,
    y: value[1] ?? 0,
    z: value[2] ?? 0,
  });
  writeVector(object.rotationQuaternion, [quaternion.x, quaternion.y, quaternion.z]);
  object.rotationQuaternion.w = quaternion.w;
}

export class BabylonAuthoringAdapter implements AuthoringAdapter {
  readonly capabilities: AuthoringCapabilities = {
    transform: true,
    inspectorFields: true,
    persist: false,
  };

  readonly provenance: AuthoringProvenance;
  readonly persistence;
  readonly pickable?: PickProvider;
  readonly truth;

  private readonly indexed = new Map<string, IndexedValue>();
  private readonly idsByObject = new Map<BabylonNodeLike, string>();
  private readonly listeners = new Set<() => void>();
  private readonly persistenceBackend: SourcePersistenceBackend | null;
  private readonly baselines = new Map<string, Record<string, ChannelValue>>();
  /** The history snapshot taken at `beginEdit`, journaled at `endEdit`. */
  private readonly historyBefore = new Map<string, BabylonHistoryState>();
  private historyResource: JsonHistoryResource<BabylonHistoryState> | null = null;
  private edits = 0;
  private readonly gizmos: BabylonGizmoManagerLike[] = [];
  private readonly pointerTokens: Array<{ scene: BabylonSceneLike; token: unknown }> = [];
  private readonly removeCanvasListeners: (() => void) | null;

  constructor(
    private readonly engine: BabylonEngineLike,
    private readonly store: EditorShellStore,
    private readonly options: BabylonAuthoringOptions = {},
  ) {
    this.persistenceBackend = options.persistence ?? null;
    this.provenance =
      options.provenance ??
      ({
        source: 'foreign',
        label: 'live-only',
        detail:
          'Babylon.js scenes and Nodes projected directly — edits apply to native game objects for this session only.',
      } satisfies AuthoringProvenance);
    const ephemeral = createEphemeralPersistence();
    const backend = this.persistenceBackend;
    this.persistence = backend
      ? {
          isDirty: () => false,
          save: async () => {},
          get destination(): string {
            return backend.destination();
          },
        }
      : ephemeral;
    if (backend) {
      backend.attach({
        read: (id, property) => this.readChannel(id, property),
        apply: (id, property, value) => this.applyChannel(id, property, value),
      });
    }
    // THE SESSION JOURNAL EXISTS EXACTLY WHERE A DESTINATION DOES — the three
    // lane's rule, transcribed. A live-only write (every position edit on
    // the shipped example: its source assigns `new Vector3(0, 1, 0)` whole)
    // used to journal NOTHING, so the edit landed on the live node and
    // Ctrl+Z was a correct no-op over an empty stack — "undo is not working"
    // (runhuman pass 149; traced on production build 75).
    const history = store.shell.projectHistory;
    this.historyResource =
      backend && history && options.journal
        ? new JsonHistoryResource<BabylonHistoryState>({
            history,
            kind: 'session-state',
            scope: 'session',
            subject: { ...options.journal, id: `${options.journal.id}/live-babylon-edits` },
            displayName: 'Live edits',
            capture: () => this.captureHistoryState(),
            // A running world animates its own nodes; only the edit record
            // says whether something ELSE changed this resource (issue #81
            // in the three lane — without this every transaction fails
            // preflight with content-conflict and undo silently does nothing).
            conflictIdentity: (state) => state.edits,
            restore: async (state) => {
              this.restoreHistoryState(state);
            },
          })
        : null;
    if (options.canvas) {
      this.pickable = {
        pick: (clientX: number, clientY: number): string | null => {
          const rect = options.canvas!.getBoundingClientRect();
          for (const scene of this.scenes()) {
            const hit = scene.pick?.(clientX - rect.left, clientY - rect.top);
            const object = hit?.hit ? hit.pickedMesh : null;
            if (object) {
              this.reindex();
              return this.idsByObject.get(object) ?? null;
            }
          }
          return null;
        },
      };
    }
    this.truth = {
      resolve: (id: string, property: string) => {
        const subject = this.subjectFor(id, property);
        return { site: subject.anchor, writeAnchorKind: subject.anchorKind };
      },
    };
    this.installNativeTools();
    if (options.canvas) {
      const onDown = (): void => {
        for (const id of this.selection.get()) this.transforms.beginEdit(id);
      };
      const onUp = (): void => {
        for (const id of this.selection.get()) void this.transforms.endEdit(id);
      };
      options.canvas.addEventListener('pointerdown', onDown);
      options.canvas.addEventListener('pointerup', onUp);
      this.removeCanvasListeners = () => {
        options.canvas!.removeEventListener('pointerdown', onDown);
        options.canvas!.removeEventListener('pointerup', onUp);
      };
    } else {
      this.removeCanvasListeners = null;
    }
  }

  private scenes(): BabylonSceneLike[] {
    return (this.engine.scenes ?? []).filter((scene) => {
      try {
        return !scene.isDisposed?.();
      } catch {
        return true;
      }
    });
  }

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

  private reindex(): void {
    this.indexed.clear();
    this.idsByObject.clear();
    const visited = new Set<BabylonNodeLike>();
    for (const [sceneIndex, scene] of this.scenes().entries()) {
      const sceneName = scene.name || `Scene ${sceneIndex + 1}`;
      const sceneId = `babylon:scene:${sceneIndex}:${cleanSegment(scene.uid || sceneName)}`;
      const roots = Array.isArray(scene.rootNodes) ? scene.rootNodes : [];
      const sceneNode: EditorNode = {
        id: sceneId,
        label: sceneName,
        role: 'root',
        kind: 'babylon-scene',
        typeLabel: 'BABYLON.Scene',
        parentId: null,
        childIds: [],
      };
      this.indexed.set(sceneId, { kind: 'scene', scene, node: sceneNode });
      sceneNode.childIds = roots.map((object, index) =>
        this.indexNode(object, sceneId, `${sceneIndex}/${index}`, visited),
      );
    }
  }

  private indexNode(
    object: BabylonNodeLike,
    parentId: string,
    path: string,
    visited: Set<BabylonNodeLike>,
  ): string {
    const nativeType = className(object);
    const nativeIdentity =
      typeof object.uniqueId === 'number' ? String(object.uniqueId) : `path:${path}`;
    const id = `babylon:node:${nativeIdentity}`;
    const node: EditorNode = {
      id,
      label: object.name || nativeType,
      role: 'entity',
      kind: `babylon-${nativeType.toLowerCase()}`,
      typeLabel: nativeType,
      parentId,
      childIds: [],
    };
    this.indexed.set(id, { kind: 'node', object, node });
    this.idsByObject.set(object, id);
    if (visited.has(object)) return id;
    visited.add(object);
    node.childIds = directChildren(object).map((child, index) =>
      this.indexNode(child, id, `${path}/${index}`, visited),
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
      this.attachGizmos(ids[0] ?? null);
      this.notify();
    },
  };

  readonly transforms = {
    dimensions: (id: string): '3d' | null => {
      this.reindex();
      return this.indexed.get(id)?.kind === 'node' ? '3d' : null;
    },
    get: (id: string): Transform => {
      this.reindex();
      const value = this.indexed.get(id);
      if (!value || value.kind !== 'node') {
        return { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
      }
      const object = value.object;
      const q = object.rotationQuaternion ?? quaternionFromEuler(object.rotation);
      return {
        position: [object.position?.x ?? 0, object.position?.y ?? 0, object.position?.z ?? 0],
        rotation: [q.x, q.y, q.z, q.w],
        scale: [object.scaling?.x ?? 1, object.scaling?.y ?? 1, object.scaling?.z ?? 1],
      };
    },
    beginEdit: (id: string): void => {
      const baseline = this.captureChannels(id);
      if (baseline) this.baselines.set(id, baseline);
      if (this.historyResource) this.historyBefore.set(id, this.captureHistoryState());
    },
    apply: (id: string, transform: Transform): void => {
      this.reindex();
      const value = this.indexed.get(id);
      if (!value || value.kind !== 'node') return;
      const object = value.object;
      writeVector(object.position, transform.position);
      writeVector(object.scaling, transform.scale);
      if (object.rotationQuaternion) {
        writeVector(object.rotationQuaternion, transform.rotation);
        object.rotationQuaternion.w = transform.rotation[3];
      } else {
        const rotation = eulerFromQuaternion(transform.rotation);
        writeVector(object.rotation, [rotation.x, rotation.y, rotation.z]);
      }
      this.notify();
    },
    endEdit: async (id: string): Promise<WriteAck | undefined> => {
      const baseline = this.baselines.get(id);
      this.baselines.delete(id);
      const before = this.historyBefore.get(id);
      this.historyBefore.delete(id);
      if (!baseline || !this.persistenceBackend) return;
      const next = this.captureChannels(id);
      if (!next) return;
      const changed = (['position', 'rotation', 'scale'] as const).filter(
        (property) => JSON.stringify(baseline[property]) !== JSON.stringify(next[property]),
      );
      if (changed.length === 0) return;
      if (changed.length > 1) {
        const reason = `this Babylon gesture changed ${changed.length} properties at once (${changed.join(', ')})`;
        this.persistenceBackend.report(`Transform ${this.labelOf(id)}`, reason);
        return { destination: 'live-only (not saved)', persisted: false };
      }
      const property = changed[0]!;
      return persistChannelWrite({
        backend: this.persistenceBackend,
        subject: () => this.subjectFor(id, property),
        baseline: baseline[property]!,
        next: next[property]!,
        label: `Transform ${this.labelOf(id)}`,
        journal: () => this.recordHistory(`Transform ${this.labelOf(id)}`, before),
      });
    },
  };

  readonly inspector = {
    properties: (id: string): PropertyDescriptor[] => {
      this.reindex();
      const value = this.indexed.get(id);
      if (!value) return [];
      if (value.kind === 'scene') {
        return [
          { path: 'name', label: 'Scene', type: 'string', readonly: true },
          { path: 'uid', label: 'UID', type: 'string', readonly: true },
        ];
      }
      const properties: PropertyDescriptor[] = [
        { path: 'className', label: 'Type', type: 'string', readonly: true },
        { path: 'name', label: 'Name', type: 'string' },
        { path: 'id', label: 'ID', type: 'string', readonly: true },
        { path: 'enabled', label: 'Enabled', type: 'boolean' },
      ];
      if (typeof value.object.isVisible === 'boolean') {
        properties.push({ path: 'isVisible', label: 'Visible', type: 'boolean' });
      }
      if (typeof value.object.visibility === 'number') {
        properties.push({ path: 'visibility', label: 'Visibility', type: 'number' });
      }
      return properties;
    },
    get: (id: string, path: string): unknown => {
      this.reindex();
      const value = this.indexed.get(id);
      if (!value) return undefined;
      if (value.kind === 'scene') {
        return path === 'name' ? value.scene.name : path === 'uid' ? value.scene.uid : undefined;
      }
      if (path === 'className') return className(value.object);
      if (path === 'enabled') return value.object.isEnabled?.(false);
      return value.object[path as keyof BabylonNodeLike];
    },
    set: async (id: string, path: string, value: unknown): Promise<WriteAck | undefined> => {
      this.reindex();
      const indexed = this.indexed.get(id);
      if (!indexed || indexed.kind !== 'node') return;
      const baseline = this.readChannel(id, path);
      const before = this.historyResource ? this.captureHistoryState() : undefined;
      if (path === 'enabled') indexed.object.setEnabled?.(Boolean(value));
      else if (path === 'name' || path === 'isVisible' || path === 'visibility') {
        (indexed.object as unknown as Record<string, unknown>)[path] = value;
      } else return;
      this.notify();
      const next = this.readChannel(id, path);
      if (
        !this.persistenceBackend ||
        baseline === undefined ||
        next === undefined ||
        JSON.stringify(baseline) === JSON.stringify(next)
      ) {
        return;
      }
      return persistChannelWrite({
        backend: this.persistenceBackend,
        subject: () => this.subjectFor(id, path === 'isVisible' ? 'visible' : path),
        baseline,
        next,
        label: `Set ${this.labelOf(id)} ${path}`,
        journal: () => this.recordHistory(`Set ${this.labelOf(id)} ${path}`, before),
      });
    },
  };

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.removeCanvasListeners?.();
    for (const { scene, token } of this.pointerTokens) scene.onPointerObservable?.remove(token);
    for (const gizmo of this.gizmos) gizmo.dispose();
    this.persistenceBackend?.dispose();
    this.listeners.clear();
    this.indexed.clear();
    this.idsByObject.clear();
  }

  private labelOf(id: string): string {
    return this.hierarchy.node(id)?.label ?? 'Babylon node';
  }

  private objectOf(id: string): BabylonNodeLike | null {
    this.reindex();
    const value = this.indexed.get(id);
    return value?.kind === 'node' ? value.object : null;
  }

  private readChannel(id: string, property: string): ChannelValue | undefined {
    const object = this.objectOf(id);
    if (!object) return undefined;
    if (property === 'position') {
      return [object.position?.x ?? 0, object.position?.y ?? 0, object.position?.z ?? 0];
    }
    if (property === 'rotation') {
      const q = object.rotationQuaternion;
      const euler = q
        ? eulerFromQuaternion([q.x, q.y, q.z, q.w])
        : (object.rotation ?? { x: 0, y: 0, z: 0 });
      return [euler.x, euler.y, euler.z];
    }
    if (property === 'scale') {
      return [object.scaling?.x ?? 1, object.scaling?.y ?? 1, object.scaling?.z ?? 1];
    }
    if (property === 'visible') return object.isVisible;
    return this.inspector.get(id, property) as ChannelValue | undefined;
  }

  private applyChannel(id: string, property: string, value: ChannelValue): void {
    const object = this.objectOf(id);
    if (!object) return;
    if (property === 'position' && Array.isArray(value)) writeVector(object.position, value);
    else if (property === 'rotation' && Array.isArray(value)) writeEulerRotation(object, value);
    else if (property === 'scale' && Array.isArray(value)) writeVector(object.scaling, value);
    else if (property === 'visible') object.isVisible = Boolean(value);
    else if (property === 'name' || property === 'visibility') {
      (object as unknown as Record<string, unknown>)[property] = value;
    }
    this.notify();
  }

  /** Journal a before→after snapshot pair into project history, LOUDLY: a
   *  rejected record means the edit is applied but cannot be undone. */
  private recordHistory(label: string, before: BabylonHistoryState | undefined): void {
    if (!this.historyResource || !before) return;
    this.edits += 1;
    void this.historyResource
      .record(label, before, this.captureHistoryState())
      .catch((err: unknown) => {
        editorConsole.error(
          `[babylon] failed to journal "${label}" into project history — the edit is applied ` +
            `but has no history entry (it cannot be undone): ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  private captureHistoryState(): BabylonHistoryState {
    this.reindex();
    const nodes: BabylonHistoryState['nodes'] = {};
    for (const [id, value] of this.indexed) {
      if (value.kind !== 'node') continue;
      const channels: Record<string, ChannelValue> = {};
      for (const property of ['position', 'rotation', 'scale', 'visible', 'name', 'visibility']) {
        const read = this.readChannel(id, property);
        if (read !== undefined && read !== null) channels[property] = read;
      }
      nodes[id] = channels;
    }
    return { edits: this.edits, nodes };
  }

  private restoreHistoryState(state: BabylonHistoryState): void {
    this.edits = state.edits;
    for (const [id, channels] of Object.entries(state.nodes)) {
      for (const [property, value] of Object.entries(channels)) {
        this.applyChannel(id, property, value);
      }
    }
    this.notify();
  }

  private captureChannels(id: string): Record<string, ChannelValue> | null {
    const position = this.readChannel(id, 'position');
    const rotation = this.readChannel(id, 'rotation');
    const scale = this.readChannel(id, 'scale');
    return position && rotation && scale ? { position, rotation, scale } : null;
  }

  private subjectFor(id: string, property: string): SourceWriteSubject {
    const object = this.objectOf(id);
    const anchor = creationSiteAnchor(object);
    return {
      entityId: id,
      property,
      surface: 'babylon',
      anchor,
      anchorKind: anchor.anchored ? 'construction-literal' : 'live-only',
      instances: anchor.anchored && anchor.kind === 'source' ? instancesAtSite(anchor) : 0,
    };
  }

  private installNativeTools(): void {
    const Manager = this.options.api?.GizmoManager;
    for (const scene of this.scenes()) {
      if (Manager) {
        const manager = new Manager(scene);
        manager.positionGizmoEnabled = true;
        manager.rotationGizmoEnabled = true;
        manager.scaleGizmoEnabled = true;
        manager.usePointerToAttachGizmos = false;
        this.gizmos.push(manager);
      }
      const observable = scene.onPointerObservable;
      if (observable) {
        const token = observable.add((event) => {
          const picked = event.pickInfo?.pickedMesh;
          if (!picked) return;
          this.reindex();
          const id = this.idsByObject.get(picked);
          if (id) this.selection.set([id]);
        });
        this.pointerTokens.push({ scene, token });
      }
    }
  }

  private attachGizmos(id: string | null): void {
    const object = id ? this.objectOf(id) : null;
    for (const gizmo of this.gizmos) {
      if (!object) {
        gizmo.attachToMesh(null);
        continue;
      }
      try {
        if (className(object).includes('Mesh')) gizmo.attachToMesh(object);
        else if (gizmo.attachToNode) gizmo.attachToNode(object);
        else gizmo.attachToMesh(null);
      } catch {
        // Cameras, lights, and extension nodes remain selectable even when a
        // Babylon gizmo cannot attach to their native node type.
        gizmo.attachToMesh(null);
      }
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
    this.store.shell.notifyIngestEdit();
  }
}
