/**
 * A scene written as idiomatic React Three Fiber (GODOT.md, "The output is idiomatic three.js"):
 * ordinary JSX with Godot's values converted at import into three's units and written as literals,
 * transforms as `position`/`rotation`/`scale`, geometry and materials as child elements with
 * literal args, lights and cameras with three's own props, bodies and colliders as
 * `@react-three/rapier` components, and each script attached by compat's `useGodotScript`. Node
 * names are Godot's, so `$Path` resolves over the mounted tree.
 *
 * The conversions (each a `render-mapping` the scene-idiomatic proof measures):
 * - a Transform3D is decomposed into position, XYZ Euler rotation and scale (a basis with shear has
 *   no such form and is refused by name);
 * - a light's energy is three's intensity times pi (three's physically based light units);
 * - a colour is its sRGB hex (8 bits a channel);
 * - a PlaneMesh is three's plane turned to face +Y as Godot's does; a SphereMesh three's sphere
 *   with Godot's radius, radial segments and rings;
 * - a BoxShape3D is a cuboid collider of half its size.
 */
import * as path from 'node:path';
import type {
  TargetTsExpression,
  TargetTsJsxAttribute,
  TargetTsJsxChild,
  TargetTsJsxElementShape,
  TargetTsSourceFile,
  TargetTsStatement,
  TargetTsType,
} from '../code/target-ts-syntax';
import { TARGET_TS_SYNTAX_VERSION } from '../code/target-ts-syntax';
import type {
  DirectGodotProjectCompositionPlan,
  DirectGodotSceneDocumentPlan,
  DirectGodotSceneNodePlan,
} from '../data/direct-project-composition-plan';
import type { TargetGodotSceneResourcePlan, TargetGodotSceneSetterPlan, TargetGodotSceneValue } from '../data/scene-document-plan';
import { directGodotSceneAutoloadContextName, directGodotSceneAutoloadReferences } from './direct-autoload-syntax';

const f32 = Math.fround;

/** The shortest decimal that reads back as this float32 value. */
function float32Literal(value: number): number {
  const single = f32(value);
  if (Object.is(single, -0) || single === 0) return 0;
  for (let digits = 1; digits <= 9; digits += 1) {
    const candidate = Number(single.toPrecision(digits));
    if (f32(candidate) === single) return candidate;
  }
  return single;
}

function literal(value: number | string | boolean | null): TargetTsExpression {
  return { kind: 'literal-expression', value: typeof value === 'number' ? float32Literal(value) : value };
}

function numbers(values: readonly number[]): TargetTsExpression {
  return { kind: 'array-expression', elements: values.map((value) => literal(value)) };
}

function attribute(name: string, value: TargetTsExpression): TargetTsJsxAttribute {
  return { kind: 'jsx-expression-attribute', name, value };
}

function flag(name: string): TargetTsJsxAttribute {
  return { kind: 'jsx-expression-attribute', name, value: { kind: 'literal-expression', value: true } };
}

/**
 * A Transform3D (the plan's column-major matrix) as `position`, XYZ `rotation` and `scale` props,
 * each only when it differs from three's default. A basis whose columns are not orthogonal
 * (shear) has no such form.
 */
function transformAttributes(at: string, matrix: readonly number[] | undefined): TargetTsJsxAttribute[] {
  if (matrix === undefined) return [];
  const e = matrix;
  const columns = [0, 1, 2].map((c) => [e[c * 4] as number, e[c * 4 + 1] as number, e[c * 4 + 2] as number]);
  const length = (v: readonly number[]) => Math.hypot(v[0] as number, v[1] as number, v[2] as number);
  const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, x, i) => sum + x * (b[i] as number), 0);
  const [cx, cy, cz] = columns as [number[], number[], number[]];
  for (const [a, b] of [[cx, cy], [cx, cz], [cy, cz]] as const) {
    if (Math.abs(dot(a, b)) > 1e-5 * length(a) * length(b)) {
      throw new Error(`${at}: a transform with shear has no position, rotation and scale`);
    }
  }
  const det =
    (cx[0] as number) * ((cy[1] as number) * (cz[2] as number) - (cz[1] as number) * (cy[2] as number)) -
    (cy[0] as number) * ((cx[1] as number) * (cz[2] as number) - (cz[1] as number) * (cx[2] as number)) +
    (cz[0] as number) * ((cx[1] as number) * (cy[2] as number) - (cy[1] as number) * (cx[2] as number));
  const scale = [length(cx) * (det < 0 ? -1 : 1), length(cy), length(cz)];
  // Row r, column c of the rotation (three's `Euler.setFromRotationMatrix`, order XYZ).
  const m = (r: number, c: number) => ((columns[c] as number[])[r] as number) / (scale[c] as number);
  const clamp = (x: number) => Math.min(Math.max(x, -1), 1);
  const y = Math.asin(clamp(m(0, 2)));
  let x: number;
  let z: number;
  if (Math.abs(m(0, 2)) < 0.9999999) {
    x = Math.atan2(-m(1, 2), m(2, 2));
    z = Math.atan2(-m(0, 1), m(0, 0));
  } else {
    x = Math.atan2(m(2, 1), m(1, 1));
    z = 0;
  }
  const position = [e[12] as number, e[13] as number, e[14] as number];
  const result: TargetTsJsxAttribute[] = [];
  if (position.some((value) => value !== 0)) result.push(attribute('position', numbers(position)));
  if ([x, y, z].some((value) => float32Literal(value) !== 0)) result.push(attribute('rotation', numbers([x, y, z])));
  if (scale.some((value) => float32Literal(value) !== 1)) result.push(attribute('scale', numbers(scale)));
  return result;
}

/** A Godot colour's components as the sRGB hex three reads (`#rrggbb`). */
function hexColor(components: readonly number[]): string {
  const channel = (value: number) => Math.round(Math.min(Math.max(value, 0), 1) * 255).toString(16).padStart(2, '0');
  return `#${components.slice(0, 3).map(channel).join('')}`;
}

function numberValue(value: TargetGodotSceneValue | undefined): number | undefined {
  return value?.kind === 'number' ? value.value : undefined;
}

function componentsValue(value: TargetGodotSceneValue | undefined): readonly number[] | undefined {
  return value !== undefined && 'components' in value ? value.components : undefined;
}

function setterValue(setters: readonly TargetGodotSceneSetterPlan[], exportName: string, index?: number): TargetGodotSceneValue | undefined {
  return setters.find((entry) => entry.setter.exportName === exportName && (index === undefined || entry.index === index))?.value;
}

interface Emission {
  readonly scene: DirectGodotSceneDocumentPlan;
  readonly resources: ReadonlyMap<string, TargetGodotSceneResourcePlan>;
  readonly three: Set<string>;
  readonly drei: Set<string>;
  readonly rapier: Set<string>;
  readonly compat: Map<string, Set<string>>;
  readonly scripts: Map<string, { readonly local: string; readonly module: string; readonly exportName: string }>;
  readonly hooks: TargetTsStatement[];
  readonly refNames: Set<string>;
  /** The scene's autoload context (`<Scene>Autoloads`), when its scripts read autoloads. */
  readonly autoloads: string | undefined;
  /** The Camera3D Godot makes current: the authored current one, else the first in tree order. */
  currentCamera: string | undefined;
}

function useCompat(emission: Emission, module: string, name: string): string {
  const names = emission.compat.get(module) ?? new Set<string>();
  names.add(name);
  emission.compat.set(module, names);
  return name;
}

function resourceOf(emission: Emission, value: TargetGodotSceneValue | undefined): TargetGodotSceneResourcePlan | undefined {
  return value?.kind === 'resource' ? emission.resources.get(value.key) : undefined;
}

function element(tag: string, attributes: readonly TargetTsJsxAttribute[], children: readonly TargetTsJsxChild[] = []): TargetTsJsxChild {
  return { kind: 'jsx-element-child', tag, attributes, children };
}

/** A mesh resource as three's geometry element. */
function geometry(emission: Emission, resource: TargetGodotSceneResourcePlan): TargetTsJsxChild {
  const set = resource.setters;
  if (resource.className === 'PlaneMesh') {
    const size = componentsValue(setterValue(set, 'set_size')) ?? [2, 2];
    const face = useCompat(emission, 'plane-mesh', 'godot_plane_mesh_face_y');
    return element('planeGeometry', [
      attribute('args', numbers([size[0] as number, size[1] as number])),
      attribute('onUpdate', { kind: 'identifier-expression', name: face }),
    ]);
  }
  if (resource.className === 'SphereMesh') {
    const radius = numberValue(setterValue(set, 'set_radius')) ?? 0.5;
    const height = numberValue(setterValue(set, 'set_height')) ?? 1;
    if (f32(height) !== f32(radius * 2)) throw new Error(`${resource.key}: a SphereMesh whose height is not its diameter has no three sphere`);
    const radial = numberValue(setterValue(set, 'set_radial_segments')) ?? 64;
    const rings = numberValue(setterValue(set, 'set_rings')) ?? 32;
    return element('sphereGeometry', [attribute('args', numbers([radius, radial, rings]))]);
  }
  throw new Error(`${resource.key}: ${resource.className} has no idiomatic geometry`);
}

/** A StandardMaterial3D (or none: Godot's default material) as `<meshStandardMaterial>`. */
function material(resource: TargetGodotSceneResourcePlan | undefined): TargetTsJsxChild {
  if (resource === undefined) return element('meshStandardMaterial', []);
  const set = resource.setters;
  const albedo = componentsValue(setterValue(set, 'set_albedo'));
  const metallic = numberValue(setterValue(set, 'set_metallic'));
  const roughness = numberValue(setterValue(set, 'set_roughness'));
  return element('meshStandardMaterial', [
    ...(albedo === undefined ? [] : [attribute('color', literal(hexColor(albedo)))]),
    ...(metallic === undefined ? [] : [attribute('metalness', literal(metallic))]),
    ...(roughness === undefined ? [] : [attribute('roughness', literal(roughness))]),
  ]);
}

function camelName(name: string): string {
  const words = name.replace(/[^A-Za-z0-9]+/gu, ' ').trim().split(' ').filter((word) => word !== '');
  const joined = words.map((word, index) => (index === 0 ? word.charAt(0).toLowerCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1))).join('');
  return /^[A-Za-z_$]/u.test(joined) ? joined : `node${joined}`;
}

function pascalName(file: string): string {
  const base = path.posix.basename(file).replace(/\.[^.]+$/u, '');
  const camel = camelName(base);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/** A script's attachment: a ref on its node, and `useGodotScript(ref, Class, { exports })`. */
function scriptAttachment(emission: Emission, node: DirectGodotSceneNodePlan, threeType: string): TargetTsJsxAttribute[] {
  const script = node.scriptInstance;
  if (script === undefined) return [];
  let refName = camelName(node.name);
  for (let n = 2; emission.refNames.has(refName); n += 1) refName = `${camelName(node.name)}${String(n)}`;
  emission.refNames.add(refName);
  const cls = script.generatedClass;
  let local = emission.scripts.get(cls.modulePath + cls.exportName)?.local;
  if (local === undefined) {
    local = pascalName(script.scriptResPath);
    const taken = new Set([...emission.scripts.values()].map((entry) => entry.local));
    for (let n = 2; taken.has(local); n += 1) local = `${pascalName(script.scriptResPath)}${String(n)}`;
    emission.scripts.set(cls.modulePath + cls.exportName, {
      local,
      module: moduleSpecifier(emission.scene.targetPath, cls.modulePath),
      exportName: cls.exportName,
    });
  }
  emission.three.add(threeType);
  emission.hooks.push(
    {
      kind: 'variable-statement',
      declaration: 'const',
      name: refName,
      initializer: {
        kind: 'call-expression',
        callee: { kind: 'identifier-expression', name: 'useRef' },
        typeArguments: [{ kind: 'type-reference', name: threeType, arguments: [] }],
        arguments: [{ kind: 'literal-expression', value: null }],
      },
    },
    {
      kind: 'expression-statement',
      expression: {
        kind: 'call-expression',
        callee: { kind: 'identifier-expression', name: useCompat(emission, 'react-lifecycle', 'useGodotScript') },
        arguments: [
          { kind: 'identifier-expression', name: refName },
          { kind: 'identifier-expression', name: local },
          ...(script.fields.length === 0 && script.autoloadReferences.length === 0
            ? []
            : [
                {
                  kind: 'object-expression' as const,
                  properties: script.fields.map((field) => ({
                    key: field.fieldName,
                    value: { kind: 'literal-expression' as const, value: field.value.value },
                  })),
                },
              ]),
          // The autoloads the script reads, each its field and the ref the world mounts it into.
          ...(script.autoloadReferences.length === 0 || emission.autoloads === undefined
            ? []
            : [
                {
                  kind: 'object-expression' as const,
                  properties: script.autoloadReferences.map((reference) => ({
                    key: reference.fieldName,
                    value: {
                      kind: 'property-expression' as const,
                      object: { kind: 'identifier-expression' as const, name: 'autoloads' },
                      property: reference.name,
                    },
                  })),
                },
              ]),
        ],
      },
    },
  );
  return [attribute('ref', { kind: 'identifier-expression', name: refName })];
}

function nodeElement(emission: Emission, node: DirectGodotSceneNodePlan): TargetTsJsxChild {
  const className = node.classes[0] as string;
  const at = `${emission.scene.sourceResPath}#${node.nodePath}`;
  const matrix = node.properties.find((entry) => entry.propertyName === 'transform')?.value;
  const name: TargetTsJsxAttribute = { kind: 'jsx-string-attribute', name: 'name', value: node.name };
  // A camera or light draws with its scale removed (`disable_scale`, node_3d.cpp:655; set by
  // Camera3D and Light3D): with no children and no script to read it back, its authored scale (the
  // rounding a `.tscn` rotation carries) changes nothing, and the element states none.
  const scaleless =
    (className === 'Camera3D' || className === 'DirectionalLight3D') &&
    node.children.length === 0 &&
    node.scriptInstance === undefined;
  const transform = transformAttributes(at, matrix).filter(
    (entry) => !scaleless || entry.kind === 'jsx-spread-attribute' || entry.name !== 'scale',
  );
  const children = () => node.children.map((child) => nodeElement(emission, child));
  switch (className) {
    case 'Node3D':
      return element('group', [name, ...scriptAttachment(emission, node, 'Group'), ...transform], children());
    case 'MeshInstance3D': {
      const mesh = resourceOf(emission, setterValue(node.setters, 'set_mesh'));
      const override = resourceOf(emission, setterValue(node.setters, 'set_surface_override_material', 0));
      const meshMaterial = mesh === undefined ? undefined : resourceOf(emission, setterValue(mesh.setters, 'set_material'));
      return element('mesh', [name, ...scriptAttachment(emission, node, 'Mesh'), ...transform], [
        ...(mesh === undefined ? [] : [geometry(emission, mesh), material(override ?? meshMaterial)]),
        ...children(),
      ]);
    }
    case 'DirectionalLight3D': {
      const energy = numberValue(setterValue(node.setters, 'set_param', 0)) ?? 1;
      const color = componentsValue(setterValue(node.setters, 'set_color'));
      return element('directionalLight', [
        name,
        ...scriptAttachment(emission, node, 'DirectionalLight'),
        ...transform,
        // Godot's light shines along its -Z; three's toward its target, which this aims.
        attribute('onUpdate', {
          kind: 'identifier-expression',
          name: useCompat(emission, 'directional-light-3d', 'godot_directional_light_3d_aim'),
        }),
        attribute('intensity', literal(energy * Math.PI)),
        ...(color === undefined ? [] : [attribute('color', literal(hexColor(color)))]),
      ], children());
    }
    case 'Camera3D': {
      emission.drei.add('PerspectiveCamera');
      return element('PerspectiveCamera', [
        name,
        ...scriptAttachment(emission, node, 'PerspectiveCamera'),
        ...(emission.currentCamera === node.nodePath ? [flag('makeDefault')] : []),
        ...transform,
        attribute('fov', literal(numberValue(setterValue(node.setters, 'set_fov')) ?? 75)),
        attribute('near', literal(numberValue(setterValue(node.setters, 'set_near')) ?? 0.05)),
        attribute('far', literal(numberValue(setterValue(node.setters, 'set_far')) ?? 4000)),
      ], children());
    }
    case 'StaticBody3D': {
      if (node.scriptInstance !== undefined) throw new Error(`${at}: a script on a static body is not written idiomatically yet`);
      emission.rapier.add('RigidBody');
      return element('RigidBody', [
        name,
        { kind: 'jsx-string-attribute', name: 'type', value: 'fixed' },
        attribute('colliders', { kind: 'literal-expression', value: false }),
        ...transform,
      ], children());
    }
    case 'CollisionShape3D': {
      if (node.scriptInstance !== undefined) throw new Error(`${at}: a script on a collision shape is not written idiomatically yet`);
      const shape = resourceOf(emission, setterValue(node.setters, 'set_shape'));
      if (shape === undefined) return element('group', [name, ...transform], children());
      if (shape.className !== 'BoxShape3D') throw new Error(`${at}: ${shape.className} has no idiomatic collider`);
      emission.rapier.add('CuboidCollider');
      const size = componentsValue(setterValue(shape.setters, 'set_size')) ?? [1, 1, 1];
      return element('CuboidCollider', [name, attribute('args', numbers(size.map((value) => value / 2))), ...transform], children());
    }
    default:
      throw new Error(`${at}: ${className} has no idiomatic element`);
  }
}

function moduleSpecifier(from: string, target: string): string {
  const withoutExtension = target.replace(/\.[^.]+$/u, '');
  const relative = path.posix.relative(path.posix.dirname(from), withoutExtension);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

/** The first Camera3D the scene holds, in tree order, or the one authored current. */
function currentCamera(node: DirectGodotSceneNodePlan): { readonly first?: string; readonly authored?: string } {
  let first: string | undefined;
  let authored: string | undefined;
  const walk = (entry: DirectGodotSceneNodePlan) => {
    if (entry.classes[0] === 'Camera3D') {
      first ??= entry.nodePath;
      const current = setterValue(entry.setters, 'set_current');
      if (current?.kind === 'bool' && current.value) authored ??= entry.nodePath;
    }
    for (const child of entry.children) walk(child);
  };
  walk(node);
  return { ...(first === undefined ? {} : { first }), ...(authored === undefined ? {} : { authored }) };
}

/** The props an instancing scene hands the root, by the root element. */
function rootPropsType(tag: string): { readonly type: TargetTsType; readonly children: boolean; readonly from?: { readonly module: string; readonly name: string } } {
  const omitRef = (type: TargetTsType): TargetTsType => ({ kind: 'type-reference', name: 'Omit', arguments: [type, { kind: 'literal-type', value: 'ref' }] });
  if (tag === 'PerspectiveCamera') {
    return { type: { kind: 'type-reference', name: 'PerspectiveCameraProps', arguments: [] }, children: false, from: { module: '@react-three/drei', name: 'PerspectiveCameraProps' } };
  }
  if (tag === 'RigidBody') {
    return { type: omitRef({ kind: 'type-reference', name: 'RigidBodyProps', arguments: [] }), children: true, from: { module: '@react-three/rapier', name: 'RigidBodyProps' } };
  }
  return {
    type: omitRef({ kind: 'indexed-access-type', object: { kind: 'type-reference', name: 'ThreeElements', arguments: [] }, index: { kind: 'literal-type', value: tag } }),
    children: true,
    from: { module: '@react-three/fiber', name: 'ThreeElements' },
  };
}

export function idiomaticSceneSourceFile(
  project: DirectGodotProjectCompositionPlan,
  scene: DirectGodotSceneDocumentPlan,
): TargetTsSourceFile {
  const cameras = currentCamera(scene.root);
  const autoloadReferences = directGodotSceneAutoloadReferences(scene.root);
  const referencedAutoloads = autoloadReferences.map((reference) => {
    const autoload = project.scriptAutoloads.find((candidate) => candidate.name === reference.name && candidate.scriptResPath === reference.resPath);
    if (autoload === undefined) throw new Error(`${reference.name}: singleton ${reference.resPath} is absent from composition`);
    return autoload;
  });
  const emission: Emission = {
    scene,
    resources: new Map(scene.resources.map((resource) => [resource.key, resource] as const)),
    three: new Set(),
    drei: new Set(),
    rapier: new Set(),
    compat: new Map(),
    scripts: new Map(),
    hooks: [],
    refNames: new Set(),
    autoloads: autoloadReferences.length === 0 ? undefined : directGodotSceneAutoloadContextName(scene.exportName),
    // Godot makes the first camera to enter the viewport current when none is authored so: the
    // main scene's first.
    currentCamera: cameras.authored ?? (scene.sourceResPath === project.mainScene ? cameras.first : undefined),
  };
  const node = nodeElement(emission, scene.root) as TargetTsJsxElementShape & { readonly kind: 'jsx-element-child' };
  // An instancing scene's props (its name, transform, …) reach the root, and its children follow
  // the scene's own: the prefab form.
  const props = rootPropsType(node.tag);
  const root: TargetTsJsxElementShape & { readonly kind: 'jsx-element-child' } = {
    ...node,
    attributes: [...node.attributes, { kind: 'jsx-spread-attribute', value: { kind: 'identifier-expression', name: 'props' } }],
    children: props.children
      ? [...node.children, { kind: 'jsx-expression-child', value: { kind: 'property-expression', object: { kind: 'identifier-expression', name: 'props' }, property: 'children' } }]
      : node.children,
  };
  if (emission.autoloads !== undefined) {
    emission.hooks.unshift(
      {
        kind: 'variable-statement',
        declaration: 'const',
        name: 'autoloads',
        initializer: {
          kind: 'call-expression',
          callee: { kind: 'identifier-expression', name: 'useContext' },
          arguments: [{ kind: 'identifier-expression', name: emission.autoloads }],
        },
      },
      {
        kind: 'if-statement',
        condition: {
          kind: 'binary-expression',
          operator: '===',
          left: { kind: 'identifier-expression', name: 'autoloads' },
          right: { kind: 'literal-expression', value: null },
        },
        // biome-ignore lint/suspicious/noThenProperty: TargetTsSyntax names the source branch.
        then: [
          {
            kind: 'throw-statement',
            expression: {
              kind: 'new-expression',
              callee: { kind: 'identifier-expression', name: 'Error' },
              arguments: [{ kind: 'literal-expression', value: 'The world provides no autoloads to this scene.' }],
            },
          },
        ],
      },
    );
  }
  const compatModule = (name: string) => moduleSpecifier(scene.targetPath, `src/lib/godot-compat/${name}.ts`);
  const reactNames = [
    ...(emission.autoloads === undefined ? [] : ['createContext', 'useContext']),
    ...(emission.refNames.size === 0 ? [] : ['useRef']),
  ];
  const imports: TargetTsStatement[] = [
    ...(reactNames.length === 0
      ? []
      : [{ kind: 'import-statement' as const, module: 'react', namedBindings: reactNames.map((name) => ({ imported: name, local: name })) }]),
    ...(emission.autoloads === undefined
      ? []
      : [{ kind: 'import-statement' as const, module: 'react', namedBindings: [{ imported: 'RefObject', local: 'RefObject' }], typeOnly: true as const }]),
    ...(props.from === undefined
      ? []
      : [{ kind: 'import-statement' as const, module: props.from.module, namedBindings: [{ imported: props.from.name, local: props.from.name }], typeOnly: true as const }]),
    ...(emission.three.size === 0
      ? []
      : [
          {
            kind: 'import-statement' as const,
            module: 'three',
            namedBindings: [...emission.three].sort().map((name) => ({ imported: name, local: name })),
            typeOnly: true as const,
          },
        ]),
    ...(emission.drei.size === 0
      ? []
      : [{ kind: 'import-statement' as const, module: '@react-three/drei', namedBindings: [...emission.drei].sort().map((name) => ({ imported: name, local: name })) }]),
    ...(emission.rapier.size === 0
      ? []
      : [{ kind: 'import-statement' as const, module: '@react-three/rapier', namedBindings: [...emission.rapier].sort().map((name) => ({ imported: name, local: name })) }]),
    ...[...emission.compat].map(([module, names]) => ({
      kind: 'import-statement' as const,
      module: compatModule(module),
      namedBindings: [...names].sort().map((name) => ({ imported: name, local: name })),
    })),
    ...[...emission.scripts.values()].map((script) => ({
      kind: 'import-statement' as const,
      module: script.module,
      namedBindings: [{ imported: script.exportName, local: script.local }],
    })),
    ...referencedAutoloads.map((autoload) => ({
      kind: 'import-statement' as const,
      module: moduleSpecifier(scene.targetPath, autoload.generatedClass.modulePath),
      namedBindings: [{ imported: autoload.generatedClass.exportName, local: `${autoload.name}Autoload` }],
      typeOnly: true as const,
    })),
  ];
  // The autoloads the world mounts, as the refs its context hands this scene's scripts.
  const autoloadContext: TargetTsStatement[] =
    emission.autoloads === undefined
      ? []
      : [
          {
            kind: 'variable-statement',
            declaration: 'const',
            name: emission.autoloads,
            modifiers: ['export'],
            initializer: {
              kind: 'call-expression',
              callee: { kind: 'identifier-expression', name: 'createContext' },
              typeArguments: [
                {
                  kind: 'union-type',
                  members: [
                    {
                      kind: 'object-type',
                      properties: referencedAutoloads.map((autoload) => ({
                        name: autoload.name,
                        readonly: true as const,
                        type: {
                          kind: 'type-reference' as const,
                          name: 'RefObject',
                          arguments: [
                            {
                              kind: 'union-type' as const,
                              members: [
                                { kind: 'type-reference' as const, name: `${autoload.name}Autoload`, arguments: [] },
                                { kind: 'literal-type' as const, value: null },
                              ],
                            },
                          ],
                        },
                      })),
                    },
                    { kind: 'literal-type', value: null },
                  ],
                },
              ],
              arguments: [{ kind: 'literal-expression', value: null }],
            },
          },
        ];
  return {
    syntaxVersion: TARGET_TS_SYNTAX_VERSION,
    sourcePath: scene.targetPath,
    statements: [
      ...imports,
      ...autoloadContext,
      {
        kind: 'function-statement',
        name: scene.exportName,
        modifiers: ['export'],
        parameters: [{ name: 'props', type: props.type }],
        body: [...emission.hooks, { kind: 'return-statement', expression: { ...root, kind: 'jsx-element-expression' } }],
      },
    ],
  };
}
