import type {
  AuthoringAdapter,
  EditorNode,
  PropertyDescriptor,
  Transform,
} from '@vgai/project/adapter';

const hierarchyNodes: Readonly<Record<string, Omit<EditorNode, 'label'>>> = {
  scene: {
    id: 'scene',
    role: 'document',
    secondaryLabel: 'src/scenes/AuroraScene.tsx',
    kind: 'scene',
    parentId: null,
    childIds: ['environment', 'camera', 'player', 'enemy-bravo', 'turret'],
  },
  environment: {
    id: 'environment',
    role: 'folder',
    kind: 'group',
    parentId: 'scene',
    childIds: ['key-light', 'fill-light', 'ground'],
  },
  'key-light': {
    id: 'key-light',
    role: 'entity',
    kind: 'light',
    parentId: 'environment',
    childIds: [],
  },
  'fill-light': {
    id: 'fill-light',
    role: 'entity',
    kind: 'light',
    parentId: 'environment',
    childIds: [],
  },
  ground: {
    id: 'ground',
    role: 'entity',
    kind: 'mesh',
    parentId: 'environment',
    childIds: [],
  },
  camera: {
    id: 'camera',
    role: 'entity',
    kind: 'camera',
    parentId: 'scene',
    childIds: [],
  },
  player: {
    id: 'player',
    role: 'entity',
    kind: 'mesh',
    parentId: 'scene',
    childIds: ['weapon'],
  },
  weapon: {
    id: 'weapon',
    role: 'entity',
    kind: 'mesh',
    parentId: 'player',
    childIds: [],
  },
  // The two instance states the hierarchy row now has to say out loud: a
  // component instance carrying its type, and one whose three transform
  // channels are all refused. Every other node above stays a plain entity,
  // which is the third state.
  'enemy-bravo': {
    id: 'enemy-bravo',
    role: 'component',
    kind: 'group',
    typeLabel: 'Enemy',
    parentId: 'scene',
    childIds: [],
  },
  turret: {
    id: 'turret',
    role: 'component',
    kind: 'group',
    typeLabel: 'Turret',
    parentId: 'scene',
    childIds: [],
  },
};

const initialLabels: Readonly<Record<string, string>> = {
  scene: 'Aurora',
  environment: 'Environment',
  'key-light': 'Key Light',
  'fill-light': 'Fill Light',
  ground: 'Ground',
  camera: 'Main Camera',
  player: 'Player',
  weapon: 'Pulse Blade',
  'enemy-bravo': 'EnemyBravo',
  turret: 'WatchTurret',
};

const commonProperties: readonly PropertyDescriptor[] = [
  { path: 'name', label: 'Name', type: 'string' },
  { path: 'visible', label: 'Visible', type: 'boolean' },
  { path: 'locked', label: 'Locked', type: 'boolean' },
];

const propertiesByKind: Readonly<Record<string, readonly PropertyDescriptor[]>> = {
  mesh: [
    ...commonProperties,
    { path: 'material.color', label: 'Tint', type: 'color', group: 'Material' },
    {
      path: 'material.finish',
      label: 'Finish',
      type: 'enum',
      options: ['Matte', 'Metal', 'Glass'],
      group: 'Material',
    },
    { path: 'gameplay.health', label: 'Health', type: 'number', group: 'Gameplay' },
    { path: 'gameplay.respawn', label: 'Respawn', type: 'boolean', group: 'Gameplay' },
  ],
  light: [
    ...commonProperties,
    { path: 'light.color', label: 'Color', type: 'color', group: 'Light' },
    { path: 'light.intensity', label: 'Intensity', type: 'number', group: 'Light' },
    { path: 'light.shadows', label: 'Shadows', type: 'boolean', group: 'Light' },
  ],
  camera: [
    ...commonProperties,
    {
      path: 'camera.projection',
      label: 'Projection',
      type: 'enum',
      options: ['Perspective', 'Orthographic'],
      group: 'Camera',
    },
    { path: 'camera.fov', label: 'Field of view', type: 'number', group: 'Camera' },
  ],
  group: commonProperties,
  scene: commonProperties,
};

/** Mutable adapter fixture shared by every authoring-system story. */
export function createAuthoringFixture(): AuthoringAdapter {
  const listeners = new Set<() => void>();
  const labels = new Map(Object.entries(initialLabels));
  const values = new Map<string, unknown>();
  const transforms = new Map<string, Transform>();
  let selection = ['player'];

  for (const id of Object.keys(hierarchyNodes)) {
    values.set(`${id}:visible`, true);
    values.set(`${id}:locked`, id === 'ground');
    transforms.set(id, {
      position: id === 'player' ? [1.5, 0, -2] : [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    });
  }
  values.set('player:material.color', '#6ea8ff');
  values.set('player:material.finish', 'Metal');
  values.set('player:gameplay.health', 100);
  values.set('player:gameplay.respawn', true);
  values.set('weapon:material.color', '#a9e8ff');
  values.set('weapon:material.finish', 'Glass');
  values.set('weapon:gameplay.health', 24);
  values.set('weapon:gameplay.respawn', false);
  values.set('key-light:light.color', '#ffe3b0');
  values.set('key-light:light.intensity', 3.2);
  values.set('key-light:light.shadows', true);
  values.set('fill-light:light.color', '#8cbcff');
  values.set('fill-light:light.intensity', 1.4);
  values.set('fill-light:light.shadows', false);
  values.set('camera:camera.projection', 'Perspective');
  values.set('camera:camera.fov', 52);

  const notify = () => {
    for (const listener of listeners) listener();
  };
  const node = (id: string): EditorNode | null => {
    const fixture = hierarchyNodes[id];
    return fixture ? { ...fixture, label: labels.get(id) ?? id } : null;
  };

  return {
    capabilities: {
      transform: true,
      inspectorFields: true,
      persist: false,
    },
    provenance: {
      source: 'document',
      label: 'scene',
      detail: 'Fixture data exercises the same adapter contract as an authored scene document.',
    },
    hierarchy: {
      roots: () => [node('scene')!],
      node,
      object3D: () => null,
      idForObject3D: () => null,
    },
    selection: {
      get: () => selection,
      set: (ids) => {
        selection = ids;
        notify();
      },
    },
    transforms: {
      dimensions: () => '3d',
      get: (id) => transforms.get(id) ?? transforms.get('scene')!,
      // H2 — one fixture row is fully refused, with the kind of sentence a
      // real adapter produces. The row shows THIS string and nothing else.
      editability: (id, channel) =>
        id === 'turret'
          ? {
              writable: false,
              reason: `Turret does not forward ${channel} to its group root.`,
            }
          : { writable: true },
      beginEdit: () => undefined,
      apply: (id, transform) => {
        transforms.set(id, transform);
        notify();
      },
      endEdit: () => undefined,
    },
    inspector: {
      properties: (id) => {
        const kind = node(id)?.kind ?? 'object';
        return [...(propertiesByKind[kind] ?? commonProperties)];
      },
      get: (id, path) => {
        if (path === 'name') return labels.get(id);
        return values.get(`${id}:${path}`);
      },
      set: (id, path, value) => {
        if (path === 'name') labels.set(id, String(value));
        else values.set(`${id}:${path}`, value);
        notify();
      },
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
