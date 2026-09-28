import { godotSceneSubnodes } from '../data/scene-document-plan';
/**
 * The JSX element each carried node family is written as (GODOT.md, "The output is idiomatic
 * three.js"), whatever shape the rest of its scene is written in: the element's tag, its literal
 * props (Godot's values converted at import into three's units) and its resource children. The
 * scene's structure (name, transform, ref, children) is the caller's.
 *
 * - A `MeshInstance3D` is a `<mesh>` that casts shadows as Godot's default setting does and
 *   receives them as every Godot mesh does, its render layers as three's layer mask.
 * - A primitive mesh is three's matching geometry with Godot's parameters: a `PlaneMesh`/`QuadMesh`
 *   three's plane (turned to Godot's orientation), a `SphereMesh` three's sphere of `rings + 1`
 *   bands (Godot's builder makes `rings + 2` rows of vertices) turned a quarter to Godot's columns, a `CylinderMesh` three's cylinder of
 *   `rings + 1` height segments. Three lays a cylinder's UVs out its own way (`cylinder-uv-layout`)
 *   and gives a sphere's pole vertices the `u` half a segment on (`sphere-pole-u`).
 * - An `ArrayMesh` is a `<bufferGeometry>` whose attributes come from the mesh's data file
 *   (`data/scene-families.ts` writes it in three's conventions), a group per surface.
 * - A `StandardMaterial3D` is the three material element and props the plan gives it
 *   (`data/scene-material-idioms.ts`), printed as they are; a surface without one Godot's
 *   Compatibility default material.
 * - A `DirectionalLight3D` is a `<directionalLight>` aimed along the node's -Z, an `OmniLight3D` a
 *   `<pointLight>`: Godot's energy times pi as three's intensity, the colour as its sRGB hex, an
 *   omni light's range and attenuation as three's distance and decay (`light-3d.ts`).
 * - A `Camera3D` is drei's `<PerspectiveCamera>` with Godot's lens; the camera the scene draws
 *   with first is its default camera.
 * - An imported image is `useGodotTexture(url, importOptions, sampler)`: loaded and processed as
 *   Godot's importer does, sampled as the material's filter and repeat flag select.
 */
import * as path from 'node:path';
import type {
  TargetTsExpression,
  TargetTsJsxAttribute,
  TargetTsJsxChild,
  TargetTsObjectProperty,
  TargetTsStatement,
} from '../code/target-ts-syntax';
import type { DirectGodotSceneNodePlan } from '../data/direct-project-composition-plan';
import type { GodotSceneNodeIdiomForm } from '../data/scene-node-idioms';
import { godotAnimationLibraryDataPath, godotAnimationTreeDataPath } from '../data/scene-animation';
import { godotArrayMeshDataPath, godotGridMapDataPath, godotMeshLibraryDataPath } from '../data/scene-families';
import type { TargetGodotSceneResourcePlan, TargetGodotSceneSetterPlan, TargetGodotSceneValue } from '../data/scene-document-plan';
import { GODOT_DEFAULT_MATERIAL_IDIOM, type GodotSceneMaterialIdiom } from '../data/scene-material-idioms';

const f32 = Math.fround;

/** The shortest decimal that reads back as this float32 value. */
export function float32Literal(value: number): number {
  const single = f32(value);
  if (Object.is(single, -0) || single === 0) return 0;
  for (let digits = 1; digits <= 9; digits += 1) {
    const candidate = Number(single.toPrecision(digits));
    if (f32(candidate) === single) return candidate;
  }
  return single;
}

export function literal(value: number | string | boolean | null): TargetTsExpression {
  return { kind: 'literal-expression', value: typeof value === 'number' ? float32Literal(value) : value };
}

export function numbers(values: readonly number[]): TargetTsExpression {
  return { kind: 'array-expression', elements: values.map((value) => literal(value)) };
}

export function attribute(name: string, value: TargetTsExpression): TargetTsJsxAttribute {
  return { kind: 'jsx-expression-attribute', name, value };
}

export function flag(name: string): TargetTsJsxAttribute {
  return { kind: 'jsx-expression-attribute', name, value: { kind: 'literal-expression', value: true } };
}

export function element(tag: string, attributes: readonly TargetTsJsxAttribute[], children: readonly TargetTsJsxChild[] = []): TargetTsJsxChild {
  return { kind: 'jsx-element-child', tag, attributes, children };
}

function identifier(name: string): TargetTsExpression {
  return { kind: 'identifier-expression', name };
}


export function numberValue(value: TargetGodotSceneValue | undefined): number | undefined {
  return value?.kind === 'number' ? value.value : undefined;
}

function boolValue(value: TargetGodotSceneValue | undefined): boolean | undefined {
  return value?.kind === 'bool' ? value.value : undefined;
}

export function componentsValue(value: TargetGodotSceneValue | undefined): readonly number[] | undefined {
  return value !== undefined && 'components' in value ? value.components : undefined;
}

export function setterValue(setters: readonly TargetGodotSceneSetterPlan[], exportName: string, index?: number): TargetGodotSceneValue | undefined {
  return setters.find((entry) => entry.setter.exportName === exportName && (index === undefined || entry.index === index))?.value;
}

/** What a scene's family elements need beside themselves: imports, hooks and data files. */
export interface FamilyEmission {
  readonly targetPath: string;
  readonly resources: ReadonlyMap<string, TargetGodotSceneResourcePlan>;
  /** Values imported from three (constants such as `AdditiveBlending`). */
  readonly three: Set<string>;
  /** Components imported from drei. */
  readonly drei: Set<string>;
  /**
   * The Camera3D the scene draws with first (its node path), written as drei's `makeDefault`: the
   * one authored current, else the first in tree order, where the scene decides that itself.
   */
  readonly currentCamera?: string;
  /** Compat exports, by module name under `lib/godot-compat/`. */
  readonly compat: Map<string, Set<string>>;
  /** Statements at the top of the component: resource loaders, in first-use order. */
  readonly hooks: TargetTsStatement[];
  /** Module-level resources (a Godot resource that loads nothing), in first-use order. */
  readonly statics: TargetTsStatement[];
  /** React hooks the component calls beside compat's (`useMemo`). */
  readonly react: Set<string>;
  /** Resource locals that load (hooks), whose users are made in the component too. */
  readonly loaded: Set<string>;
  readonly hookLocals: Map<string, string>;
  /** Data files the scene imports, by module specifier: their local names. */
  readonly data: Map<string, string>;
  /** Local names in use in the component and its module. */
  readonly taken: Set<string>;
  /** How many of the scene's nodes draw each mesh and material resource (`familyCountUses`). */
  readonly uses: Map<string, number>;
  /** Shared resources' locals, by resource key. */
  readonly shared: Map<string, string>;
}

export function familyEmission(
  targetPath: string,
  resources: readonly TargetGodotSceneResourcePlan[],
  currentCamera?: string,
): FamilyEmission {
  return {
    targetPath,
    resources: new Map(resources.map((resource) => [resource.key, resource] as const)),
    three: new Set(),
    drei: new Set(),
    ...(currentCamera === undefined ? {} : { currentCamera }),
    compat: new Map(),
    hooks: [],
    statics: [],
    react: new Set(),
    loaded: new Set(),
    hookLocals: new Map(),
    data: new Map(),
    taken: new Set(),
    uses: new Map(),
    shared: new Map(),
  };
}

export function useCompat(emission: FamilyEmission, module: string, name: string, local = name): string {
  const names = emission.compat.get(module) ?? new Set<string>();
  names.add(local === name ? name : `${name} as ${local}`);
  emission.compat.set(module, names);
  return local;
}

export function camelName(name: string): string {
  const words = name.replace(/[^A-Za-z0-9]+/gu, ' ').trim().split(' ').filter((word) => word !== '');
  const joined = words.map((word, index) => (index === 0 ? word.charAt(0).toLowerCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1))).join('');
  return /^[A-Za-z_$]/u.test(joined) ? joined : `node${joined}`;
}

/** A JSON-like value as a literal expression. */
function plainData(value: unknown): TargetTsExpression {
  if (Array.isArray(value)) return { kind: 'array-expression', elements: value.map(plainData) };
  if (value !== null && typeof value === 'object') {
    return { kind: 'object-expression', properties: Object.entries(value as Record<string, unknown>).map(([key, entry]) => ({ key, value: plainData(entry) })) };
  }
  return literal(value as number | string | boolean | null);
}

/** A local name from `base`, unused in the scene's module. */
export function freshLocal(emission: FamilyEmission, base: string): string {
  const stem = camelName(base);
  let name = stem;
  for (let n = 2; emission.taken.has(name); n += 1) name = `${stem}${String(n)}`;
  emission.taken.add(name);
  return name;
}

export function moduleSpecifier(from: string, target: string): string {
  const withoutExtension = target.replace(/\.(?:ts|tsx)$/u, '');
  const relative = path.posix.relative(path.posix.dirname(from), withoutExtension);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function resourceOf(emission: FamilyEmission, value: TargetGodotSceneValue | undefined): TargetGodotSceneResourcePlan | undefined {
  return value?.kind === 'resource' ? emission.resources.get(value.key) : undefined;
}

/** An imported file's asset URL: the file copied beside the app (`public/godot/…`). */
function assetUrl(resPath: string): string {
  return `/godot/${resPath.slice('res://'.length)}`;
}

/** An imported image loaded once in the component, sampled as `sampler` says (or unsampled). */
function textureHook(
  emission: FamilyEmission,
  texture: TargetGodotSceneResourcePlan,
  sampler?: { readonly filter: number; readonly repeat: boolean; readonly srgb: boolean },
): string {
  const load = texture.load;
  if (load === undefined) throw new Error(`${texture.key}: a texture that is not an imported image`);
  return importedTextureHook(emission, texture.key, load, sampler);
}

/**
 * An imported image (`load`, keyed as its resource is) loaded once in the component: the same local
 * wherever the component uses that texture.
 */
export function importedTextureHook(
  emission: FamilyEmission,
  resourceKey: string,
  load: NonNullable<TargetGodotSceneResourcePlan['load']>,
  sampler?: { readonly filter: number; readonly repeat: boolean; readonly srgb: boolean },
): string {
  const key = `${resourceKey}\0${sampler === undefined ? '' : `${String(sampler.filter)}:${String(sampler.repeat)}:${String(sampler.srgb)}`}`;
  const existing = emission.hookLocals.get(key);
  if (existing !== undefined) return existing;
  const local = freshLocal(emission, path.posix.basename(load.sourceResPath).replace(/\.[^.]+$/u, ''));
  emission.hookLocals.set(key, local);
  emission.loaded.add(local);
  emission.hooks.push({
    kind: 'variable-statement',
    declaration: 'const',
    name: local,
    initializer: {
      kind: 'call-expression',
      callee: identifier(useCompat(emission, 'compressed-texture-2d', 'useGodotTexture')),
      arguments: [
        literal(assetUrl(load.sourceResPath)),
        { kind: 'object-expression', properties: Object.entries(load.options).map(([name, value]) => ({ key: name, value: literal(value) })) },
        ...(sampler === undefined
          ? []
          : [
              {
                kind: 'object-expression' as const,
                properties: [
                  { key: 'filter', value: literal(sampler.filter) },
                  { key: 'repeat', value: literal(sampler.repeat) },
                  ...(sampler.srgb ? [] : [{ key: 'srgb', value: literal(false) }]),
                ],
              },
            ]),
      ],
    },
  });
  return local;
}

/** An ArrayMesh's data file, imported once: its local. */
function arrayMeshData(emission: FamilyEmission, resource: TargetGodotSceneResourcePlan): string {
  const file = godotArrayMeshDataPath(emission.targetPath, resource.key);
  const specifier = moduleSpecifier(emission.targetPath, file);
  let local = emission.data.get(specifier);
  if (local === undefined) {
    const name = resource.mesh?.resourceName ?? '';
    local = freshLocal(emission, `${name === '' ? path.posix.basename(file).replace(/\..*$/u, '') : name} mesh`);
    emission.data.set(specifier, local);
  }
  return local;
}

/** A primitive or array mesh resource as three's geometry element. */
function geometry(emission: FamilyEmission, resource: TargetGodotSceneResourcePlan): TargetTsJsxChild {
  const set = resource.setters;
  const num = (name: string, initial: number) => numberValue(setterValue(set, name)) ?? initial;
  const idiom = resource.idiom;
  switch (idiom?.kind) {
    case 'plane': {
      const size = componentsValue(setterValue(set, 'set_size')) ?? idiom.size;
      const segments = [num('set_subdivide_width', 0) + 1, num('set_subdivide_depth', 0) + 1];
      // `Orientation` (`primitive_meshes.h:240`): FACE_X 0, FACE_Y 1 (PlaneMesh's), FACE_Z 2 (QuadMesh's, three's own).
      const orientation = num('set_orientation', idiom.orientation);
      const turn =
        orientation === 1
          ? useCompat(emission, 'plane-mesh', 'godot_plane_mesh_face_y')
          : orientation === 0
            ? useCompat(emission, 'plane-mesh', 'godot_plane_mesh_face_x')
            : undefined;
      const args = segments.some((value) => value !== 1) ? [size[0] as number, size[1] as number, ...segments] : [size[0] as number, size[1] as number];
      return element('planeGeometry', [attribute('args', numbers(args)), ...(turn === undefined ? [] : [attribute('onUpdate', identifier(turn))])]);
    }
    case 'sphere':
      // Godot's column `u` lies at (sin 2πu, cos 2πu) in XZ, three's at (-cos φ, sin φ): three's
      // sphere starts a quarter turn on (`phiStart` π/2) for its columns and UVs to be Godot's.
      return element('sphereGeometry', [
        attribute('args', {
          kind: 'array-expression',
          elements: [
            ...[num('set_radius', 0.5), num('set_radial_segments', 64), num('set_rings', 32) + 1].map((value) => literal(value)),
            { kind: 'binary-expression', operator: '/', left: { kind: 'property-expression', object: identifier('Math'), property: 'PI' }, right: literal(2) },
          ],
        }),
      ]);
    case 'cylinder': {
      const open = boolValue(setterValue(set, 'set_cap_top')) === false;
      return element('cylinderGeometry', [
        attribute(
          'args',
          {
            kind: 'array-expression',
            elements: [
              ...[num('set_top_radius', 0.5), num('set_bottom_radius', 0.5), num('set_height', 2), num('set_radial_segments', 64), num('set_rings', 4) + 1].map((value) => literal(value)),
              ...(open ? [literal(true)] : []),
            ],
          },
        ),
      ]);
    }
    case 'array-mesh': {
      const mesh = resource.mesh;
      if (mesh === undefined) throw new Error(`${resource.key}: an ArrayMesh without surfaces`);
      const data = arrayMeshData(emission, resource);
      const first = mesh.surfaces[0];
      const attributeElement = (name: string, attach: string, size: number, array: 'Float32Array' | 'Uint32Array') =>
        element('bufferAttribute', [
          { kind: 'jsx-string-attribute', name: 'attach', value: attach },
          attribute('args', {
            kind: 'array-expression',
            elements: [{ kind: 'new-expression', callee: identifier(array), arguments: [{ kind: 'property-expression', object: identifier(data), property: name }] }, literal(size)],
          }),
        ]);
      const present = (name: keyof NonNullable<typeof first>['arrays']) => first?.arrays[name] !== undefined;
      return element('bufferGeometry', mesh.surfaces.length > 1 ? [attribute('groups', { kind: 'property-expression', object: identifier(data), property: 'groups' })] : [], [
        attributeElement('position', 'attributes-position', 3, 'Float32Array'),
        ...(present('normal') ? [attributeElement('normal', 'attributes-normal', 3, 'Float32Array')] : []),
        ...(present('tangent') ? [attributeElement('tangent', 'attributes-tangent', 4, 'Float32Array')] : []),
        ...(present('color') ? [attributeElement('color', 'attributes-color', 4, 'Float32Array')] : []),
        ...(present('tex_uv') ? [attributeElement('uv', 'attributes-uv', 2, 'Float32Array')] : []),
        ...(present('tex_uv2') ? [attributeElement('uv1', 'attributes-uv1', 2, 'Float32Array')] : []),
        attributeElement('index', 'index', 1, 'Uint32Array'),
      ]);
    }
    default:
      throw new Error(`${resource.key}: ${resource.className} has no three geometry`);
  }
}

/**
 * A material's props as the plan states them (`data/scene-material-idioms.ts`), each printed as it
 * is: a colour's linear components as an array (`shared`: three's `Color`), a three constant
 * imported, a map sampled by its texture's hook, a compat function by name.
 */
function materialProps(emission: FamilyEmission, idiom: GodotSceneMaterialIdiom, shared: boolean): { readonly name: string; readonly value: TargetTsExpression }[] {
  return idiom.props.map(({ name, value }) => {
    switch (value.kind) {
      case 'literal':
        return { name, value: literal(value.value) };
      case 'linear-color':
        if (!shared) return { name, value: numbers(value.components) };
        emission.three.add('Color');
        return { name, value: { kind: 'new-expression', callee: identifier('Color'), arguments: value.components.map((component) => literal(component)) } };
      case 'three':
        emission.three.add(value.name);
        return { name, value: identifier(value.name) };
      case 'map': {
        const texture = emission.resources.get(value.texture);
        if (texture === undefined) throw new Error(`${value.texture}: a texture the scene does not plan`);
        const sampler = { filter: value.filter, repeat: value.repeat, srgb: value.srgb };
        return { name, value: identifier(texture.idiom?.kind === 'gradient-texture' ? gradientMap(emission, texture, value.filter, value.repeat) : textureHook(emission, texture, sampler)) };
      }
      case 'user-data':
        return {
          name,
          value: { kind: 'object-expression', properties: value.entries.map((entry) => ({ key: entry.key, value: typeof entry.value === 'object' ? numbers(entry.value) : literal(entry.value) })) },
        };
      case 'compat':
        return { name, value: identifier(useCompat(emission, value.module, value.exportName)) };
    }
  });
}

/** A surface's material element: the planned material, or none (Godot's default material). */
function material(emission: FamilyEmission, resource: TargetGodotSceneResourcePlan | undefined, attach: readonly TargetTsJsxAttribute[]): TargetTsJsxChild {
  const idiom = resource === undefined ? GODOT_DEFAULT_MATERIAL_IDIOM : resource.idiom;
  if (idiom?.kind !== 'material') throw new Error(`${resource?.key ?? ''}: ${resource?.className ?? ''} has no three material`);
  return element(idiom.element, [...attach, ...materialProps(emission, idiom, false).map((prop) => attribute(prop.name, prop.value))]);
}

/** A Godot property's prop name: `anchor_left` is `anchorLeft`, `stream_0/stream` `stream0Stream`. */
export function godotPropName(property: string): string {
  return camelName(property.replace(/\//gu, '_'));
}

/** A metadata value as the Variant it is: a built-in made by its compat constructor. */
function metaValue(emission: FamilyEmission, value: TargetGodotSceneValue): TargetTsExpression {
  if (value.kind === 'Vector2' || value.kind === 'Vector3' || value.kind === 'Color' || value.kind === 'Quaternion') {
    const module = { Vector2: 'vector2', Vector3: 'vector3', Color: 'color', Quaternion: 'quaternion' }[value.kind];
    return { kind: 'call-expression', callee: identifier(useCompat(emission, module, 'construct', `${value.kind}_construct`)), arguments: value.components.map((component) => literal(component)) };
  }
  if (value.kind === 'number' || value.kind === 'bool' || value.kind === 'string') return propValue(emission, value);
  throw new Error(`a ${value.kind} metadata value has no element form`);
}

/** An authored value as a literal prop value: a built-in's components, a resource's local. */
function propValue(emission: FamilyEmission, value: TargetGodotSceneValue): TargetTsExpression {
  switch (value.kind) {
    case 'number':
    case 'bool':
    case 'string':
      return literal(value.value);
    case 'null':
      return literal(null);
    case 'resource':
      return identifier(resourceLocal(emission, value.key));
    default:
      return numbers(value.components);
  }
}

/**
 * A Godot resource a compat element receives, as a local: an imported image or sound loaded by its
 * hook, another resource made by its class's constructor from the properties the scene states, at
 * module level (shared by every instance of the scene, as Godot shares a scene's resources) or,
 * when it holds a loaded resource, once in the component (`useMemo`).
 */
function resourceLocal(emission: FamilyEmission, key: string): string {
  const resource = emission.resources.get(key);
  if (resource === undefined) throw new Error(`${key}: a resource the scene does not plan`);
  const idiom = resource.idiom;
  if (idiom?.kind === 'texture') return textureHook(emission, resource);
  if (idiom?.kind === 'mesh-library') return libraryLocal(emission, resource);
  if (idiom?.kind === 'animation-library') return animationLibraryLocal(emission, resource);
  if (idiom?.kind === 'animation-tree') return animationTreeLocal(emission, resource);
  const existing = emission.hookLocals.get(key);
  if (existing !== undefined) return existing;
  // An imported file compat's hook loads (a cubemap, a sound).
  if (idiom?.kind === 'loaded') {
    const load = resource.load;
    if (load === undefined) throw new Error(`${key}: a ${resource.className} that is not an imported file`);
    const local = freshLocal(emission, path.posix.basename(load.sourceResPath).replace(/\.[^.]+$/u, ''));
    emission.hookLocals.set(key, local);
    emission.loaded.add(local);
    emission.hooks.push({
      kind: 'variable-statement',
      declaration: 'const',
      name: local,
      initializer: {
        kind: 'call-expression',
        callee: identifier(useCompat(emission, idiom.module, idiom.exportName)),
        arguments: [
          literal(assetUrl(load.sourceResPath)),
          { kind: 'object-expression', properties: Object.entries(load.options).map(([name, value]) => ({ key: name, value: literal(value) })) },
        ],
      },
    });
    return local;
  }
  if (idiom?.kind === 'shader') {
    const lowered = resource.shader;
    if (lowered === undefined) throw new Error(`${key}: a shader without its lowered code`);
    const local = freshLocal(emission, `${stemOf(key)} shader`);
    emission.hookLocals.set(key, local);
    emission.statics.push({
      kind: 'variable-statement',
      declaration: 'const',
      name: local,
      initializer: { kind: 'call-expression', callee: identifier(useCompat(emission, 'shader', 'godot_shader_new')), arguments: [plainData(lowered)] },
    });
    return local;
  }
  if (idiom?.kind === 'shader-material') {
    const shaderValue = resource.setters.find((setter) => setter.setter.exportName === 'set_shader')?.value;
    const shader: TargetTsExpression = shaderValue === undefined ? literal(null) : propValue(emission, shaderValue);
    const parameters = resource.setters
      .filter((setter) => setter.setter.exportName === 'set_shader_parameter')
      .map((setter) => ({ key: String(setter.index), value: propValue(emission, setter.value) }));
    const uses = [shader, ...parameters.map((parameter) => parameter.value)].flatMap((value) => (value.kind === 'identifier-expression' && emission.loaded.has(value.name) ? [value.name] : []));
    const local = freshLocal(emission, stemOf(key));
    emission.hookLocals.set(key, local);
    const made: TargetTsExpression = {
      kind: 'call-expression',
      callee: identifier(useCompat(emission, 'shader-material', 'godot_shader_material_new')),
      arguments: [shader, { kind: 'object-expression', properties: parameters }],
    };
    if (uses.length === 0) {
      emission.statics.push({ kind: 'variable-statement', declaration: 'const', name: local, initializer: made });
      return local;
    }
    emission.loaded.add(local);
    emission.react.add('useMemo');
    emission.hooks.push({
      kind: 'variable-statement',
      declaration: 'const',
      name: local,
      initializer: { kind: 'call-expression', callee: identifier('useMemo'), arguments: [{ kind: 'arrow-expression', parameters: [], body: made }, { kind: 'array-expression', elements: uses.map(identifier) }] },
    });
    return local;
  }
  const properties = resource.setters.map((setter) => ({ key: godotPropName(setter.propertyName), value: propValue(emission, setter.value) }));
  const uses = properties.flatMap((property) => (property.value.kind === 'identifier-expression' && emission.loaded.has(property.value.name) ? [property.value.name] : []));
  const local = freshLocal(emission, key.replace(/^.*[:/#]/u, '').replace(/_[A-Za-z0-9]{5}$/u, ''));
  emission.hookLocals.set(key, local);
  const constructor = useCompat(emission, resource.construct.module.replace(/^lib\/godot-compat\//u, ''), resource.construct.exportName);
  // An engine material's generated shaders come first, by the name its binding selects each with.
  const engineShaders = resource.engineShaders === undefined ? [] : [{ kind: 'object-expression' as const, properties: Object.entries(resource.engineShaders).map(([name, shaderKey]) => ({ key: name, value: identifier(resourceLocal(emission, shaderKey)) })) }];
  const made: TargetTsExpression = {
    kind: 'call-expression',
    callee: identifier(constructor),
    arguments: [...engineShaders, ...(properties.length === 0 ? (engineShaders.length === 0 ? [] : [{ kind: 'object-expression' as const, properties: [] }]) : [{ kind: 'object-expression' as const, properties }])],
  };
  if (uses.length === 0) {
    emission.statics.push({ kind: 'variable-statement', declaration: 'const', name: local, initializer: made });
    return local;
  }
  emission.loaded.add(local);
  emission.react.add('useMemo');
  emission.hooks.push({
    kind: 'variable-statement',
    declaration: 'const',
    name: local,
    initializer: {
      kind: 'call-expression',
      callee: identifier('useMemo'),
      arguments: [
        { kind: 'arrow-expression', parameters: [], body: made },
        { kind: 'array-expression', elements: uses.map(identifier) },
      ],
    },
  });
  return local;
}


/** A MeshInstance3D's mesh and, per surface, the material it draws (its override, else the mesh's own). */
function meshSurfaces(emission: FamilyEmission, node: DirectGodotSceneNodePlan): {
  readonly mesh: TargetGodotSceneResourcePlan | undefined;
  readonly materials: readonly (TargetGodotSceneResourcePlan | undefined)[];
} {
  const mesh = resourceOf(emission, setterValue(node.setters, 'set_mesh'));
  if (mesh === undefined) return { mesh, materials: [] };
  const surfaces = mesh.mesh?.surfaces.length ?? 1;
  const own = (surface: number) => {
    if (mesh.mesh === undefined) return resourceOf(emission, setterValue(mesh.setters, 'set_material'));
    const key = mesh.mesh.surfaces[surface]?.material;
    return key === undefined ? undefined : emission.resources.get(key);
  };
  return {
    mesh,
    materials: Array.from({ length: surfaces }, (_, surface) => resourceOf(emission, setterValue(node.setters, 'set_surface_override_material', surface)) ?? own(surface)),
  };
}

/**
 * Counts, over the scene's nodes, the drawers of each mesh and material resource: one Godot shares
 * between nodes is one three object the scene declares once (`sharedGeometry`, `sharedMaterial`), so
 * a script that changes it changes every node that draws it.
 */
export function familyCountUses(emission: FamilyEmission, root: DirectGodotSceneNodePlan): void {
  const walk = (node: DirectGodotSceneNodePlan): void => {
    if (node.idiom?.form.kind === 'mesh') {
      const { mesh, materials } = meshSurfaces(emission, node);
      for (const resource of [mesh, ...materials]) {
        if (resource !== undefined) emission.uses.set(resource.key, (emission.uses.get(resource.key) ?? 0) + 1);
      }
    }
    for (const child of godotSceneSubnodes(node)) walk(child);
  };
  walk(root);
}

function sharedResource(emission: FamilyEmission, resource: TargetGodotSceneResourcePlan): boolean {
  return (emission.uses.get(resource.key) ?? 0) > 1;
}

/** A local declared once for a shared resource: at module level, or in the component (`useMemo`) over the loaded resources it holds. */
function declareShared(emission: FamilyEmission, key: string, base: string, made: TargetTsExpression, uses: readonly string[]): string {
  const existing = emission.shared.get(key);
  if (existing !== undefined) return existing;
  const local = freshLocal(emission, base);
  emission.shared.set(key, local);
  if (uses.length === 0) {
    emission.statics.push({ kind: 'variable-statement', declaration: 'const', name: local, initializer: made });
    return local;
  }
  emission.loaded.add(local);
  emission.react.add('useMemo');
  emission.hooks.push({
    kind: 'variable-statement',
    declaration: 'const',
    name: local,
    initializer: {
      kind: 'call-expression',
      callee: identifier('useMemo'),
      arguments: [
        { kind: 'arrow-expression', parameters: [], body: made },
        { kind: 'array-expression', elements: uses.map(identifier) },
      ],
    },
  });
  return local;
}

/** A resource key's local stem: `sub:StandardMaterial3D_abcde` is `standardMaterial3D`. */
function stemOf(key: string): string {
  return key.replace(/^.*[:/#]/u, '').replace(/\.[^.]+$/u, '').replace(/_[A-Za-z0-9]{5}$/u, '');
}

/** A shared mesh resource: three's geometry made once with the element's own arguments. */
function sharedGeometry(emission: FamilyEmission, resource: TargetGodotSceneResourcePlan): string {
  const made = ((): TargetTsExpression => {
    if (resource.idiom?.kind === 'array-mesh') {
      const data = arrayMeshData(emission, resource);
      return { kind: 'call-expression', callee: identifier(useCompat(emission, 'array-mesh', 'godot_array_mesh_geometry')), arguments: [identifier(data)] };
    }
    const child = geometry(emission, resource) as TargetTsJsxChild & { readonly tag: string; readonly attributes: readonly TargetTsJsxAttribute[] };
    const args = child.attributes.find((entry) => entry.kind === 'jsx-expression-attribute' && entry.name === 'args');
    const turn = child.attributes.find((entry) => entry.kind === 'jsx-expression-attribute' && entry.name === 'onUpdate');
    const three = child.tag.charAt(0).toUpperCase() + child.tag.slice(1);
    emission.three.add(three);
    const construct: TargetTsExpression = {
      kind: 'new-expression',
      callee: identifier(three),
      arguments: args?.kind === 'jsx-expression-attribute' && args.value.kind === 'array-expression' ? args.value.elements : [],
    };
    return turn?.kind === 'jsx-expression-attribute' ? { kind: 'call-expression', callee: turn.value, arguments: [construct] } : construct;
  })();
  return declareShared(emission, resource.key, `${stemOf(resource.key)} geometry`, made, []);
}

/** A shared material: three's material made once from the planned props. */
function sharedMaterial(emission: FamilyEmission, resource: TargetGodotSceneResourcePlan): string {
  return declareMaterial(emission, resource.key, stemOf(resource.key), resource.idiom?.kind === 'material' ? resource.idiom : undefined, resource);
}

/** A planned material declared once: `new` its three class with its props, handed to its `onUpdate`. */
function declareMaterial(emission: FamilyEmission, key: string, base: string, idiom: GodotSceneMaterialIdiom | undefined, resource?: TargetGodotSceneResourcePlan): string {
  if (idiom === undefined) throw new Error(`${resource?.key ?? key}: ${resource?.className ?? ''} has no three material`);
  const three = idiom.element.charAt(0).toUpperCase() + idiom.element.slice(1);
  emission.three.add(three);
  const uses: string[] = [];
  const properties = materialProps(emission, idiom, true).map((prop) => {
    if (prop.value.kind === 'identifier-expression' && emission.loaded.has(prop.value.name)) uses.push(prop.value.name);
    return { key: prop.name, value: prop.value };
  });
  const onUpdate = properties.find((property) => property.key === 'onUpdate');
  const own = properties.filter((property) => property !== onUpdate);
  const constructed: TargetTsExpression = { kind: 'new-expression', callee: identifier(three), arguments: own.length === 0 ? [] : [{ kind: 'object-expression', properties: own }] };
  // What an element's `onUpdate` does to its material, done once to the declared one.
  const made: TargetTsExpression = onUpdate === undefined ? constructed : { kind: 'call-expression', callee: onUpdate.value, arguments: [constructed] };
  return declareShared(emission, key, base, made, uses);
}

/** A data file the scene imports, once: its local. */
function dataImport(emission: FamilyEmission, file: string, base: string): string {
  const specifier = moduleSpecifier(emission.targetPath, file);
  let local = emission.data.get(specifier);
  if (local === undefined) {
    local = freshLocal(emission, base);
    emission.data.set(specifier, local);
  }
  return local;
}

/** Godot's Compatibility default material (`GODOT_DEFAULT_MATERIAL_IDIOM`), declared once. */
function defaultMaterialLocal(emission: FamilyEmission): string {
  return declareMaterial(emission, '\0default-material', 'default material', GODOT_DEFAULT_MATERIAL_IDIOM);
}

/**
 * A MeshLibrary: its data file (items, placements, shapes) and, by item id, the three mesh the
 * scene declares for the item (its geometry and its surfaces' materials, each declared once),
 * made once: at module level, or in the component (`useMemo`) over the loaded textures it holds.
 */
function libraryLocal(emission: FamilyEmission, resource: TargetGodotSceneResourcePlan): string {
  const existing = emission.shared.get(resource.key);
  if (existing !== undefined) return existing;
  const library = resource.library;
  if (library === undefined) throw new Error(`${resource.key}: a MeshLibrary without items`);
  const data = dataImport(emission, godotMeshLibraryDataPath(emission.targetPath, resource.key), `${stemOf(resource.key)} library`);
  const uses: string[] = [];
  const meshes: TargetTsObjectProperty[] = [];
  for (const item of library.items) {
    const mesh = item.mesh === undefined ? undefined : emission.resources.get(item.mesh);
    if (mesh === undefined) continue;
    const surfaces = mesh.mesh?.surfaces.map((surface) => (surface.material === undefined ? undefined : emission.resources.get(surface.material))) ?? [resourceOf(emission, setterValue(mesh.setters, 'set_material'))];
    const materials = surfaces.map((surface) => {
      const local = surface === undefined ? defaultMaterialLocal(emission) : sharedMaterial(emission, surface);
      if (emission.loaded.has(local)) uses.push(local);
      return identifier(local);
    });
    meshes.push({
      key: item.id,
      value: { kind: 'object-expression', properties: [{ key: 'geometry', value: identifier(sharedGeometry(emission, mesh)) }, { key: 'materials', value: { kind: 'array-expression', elements: materials } }] },
    });
  }
  const made: TargetTsExpression = {
    kind: 'call-expression',
    callee: identifier(useCompat(emission, 'mesh-library', 'godot_mesh_library_new')),
    arguments: [identifier(data), { kind: 'object-expression', properties: meshes }],
  };
  return declareShared(emission, resource.key, stemOf(resource.key), made, [...new Set(uses)]);
}

/** An AnimationLibrary: its data file loaded once, at module level (`godot_animation_library_load`). */
function animationLibraryLocal(emission: FamilyEmission, resource: TargetGodotSceneResourcePlan): string {
  const existing = emission.shared.get(resource.key);
  if (existing !== undefined) return existing;
  if (resource.animations === undefined) throw new Error(`${resource.key}: an AnimationLibrary without animations`);
  const data = dataImport(emission, godotAnimationLibraryDataPath(emission.targetPath, resource.key), `${stemOf(resource.key)} animations`);
  const made: TargetTsExpression = {
    kind: 'call-expression',
    callee: identifier(useCompat(emission, 'animation-library', 'godot_animation_library_load')),
    arguments: [identifier(data)],
  };
  return declareShared(emission, resource.key, `${stemOf(resource.key)} library`, made, []);
}

/** An AnimationTree's blend tree: its data file loaded once, at module level (`godot_animation_node_load`). */
function animationTreeLocal(emission: FamilyEmission, resource: TargetGodotSceneResourcePlan): string {
  const existing = emission.shared.get(resource.key);
  if (existing !== undefined) return existing;
  if (resource.animationTree === undefined) throw new Error(`${resource.key}: a blend tree without its graph`);
  const data = dataImport(emission, godotAnimationTreeDataPath(emission.targetPath, resource.key), `${stemOf(resource.key)} graph`);
  const made: TargetTsExpression = { kind: 'call-expression', callee: identifier(useCompat(emission, 'animation-tree', 'godot_animation_node_load')), arguments: [identifier(data)] };
  return declareShared(emission, resource.key, `${stemOf(resource.key)} tree`, made, []);
}

/**
 * An AnimationPlayer's track bindings, declared once at module level: each value track's setter
 * (with its index) or script field and each method track's native methods, by track path.
 */
function animationBindingsLocal(emission: FamilyEmission, node: Pick<DirectGodotSceneNodePlan, 'animation' | 'name'>): string | undefined {
  const plan = node.animation;
  if (plan === undefined || (plan.values.length === 0 && plan.methods.length === 0)) return undefined;
  const compat = (binding: { readonly module: string; readonly exportName: string; readonly localName: string }) =>
    identifier(useCompat(emission, binding.module.replace(/^lib\/godot-compat\//u, ''), binding.exportName, binding.localName));
  const values: TargetTsObjectProperty[] = plan.values.map(({ path: trackPath, binding }) => ({
    key: trackPath,
    value: {
      kind: 'object-expression',
      properties:
        'field' in binding
          ? [{ key: 'field', value: literal(binding.field) }]
          : [{ key: 'set', value: compat(binding.setter) }, ...(binding.index === undefined ? [] : [{ key: 'index', value: { kind: 'literal-expression' as const, value: binding.index } }])],
    },
  }));
  const byPath = new Map<string, TargetTsObjectProperty[]>();
  for (const { path: trackPath, method, binding } of plan.methods) {
    const list = byPath.get(trackPath) ?? [];
    list.push({ key: method, value: compat(binding) });
    byPath.set(trackPath, list);
  }
  const local = freshLocal(emission, `${node.name} bindings`);
  emission.statics.push({
    kind: 'variable-statement',
    declaration: 'const',
    name: local,
    initializer: {
      kind: 'object-expression',
      properties: [
        ...(values.length === 0 ? [] : [{ key: 'values', value: { kind: 'object-expression' as const, properties: values } }]),
        ...(byPath.size === 0
          ? []
          : [{ key: 'methods', value: { kind: 'object-expression' as const, properties: [...byPath].map(([key, properties]) => ({ key, value: { kind: 'object-expression' as const, properties } })) } }]),
      ],
    },
  });
  return local;
}

/**
 * An imported model's AnimationPlayer as the instancing scene overrides it (`<GodotImportedScene
 * overrides>`): its track bindings, then its libraries and other properties by prop name.
 */
export function familyAnimationOverride(
  emission: FamilyEmission,
  name: string,
  setters: readonly TargetGodotSceneSetterPlan[],
  animation: DirectGodotSceneNodePlan['animation'],
): TargetTsObjectProperty[] {
  const bindings = animationBindingsLocal(emission, { name, ...(animation === undefined ? {} : { animation }) });
  return [
    ...(bindings === undefined ? [] : [{ key: 'bindings', value: identifier(bindings) }]),
    ...elementProps(emission, name, setters).flatMap((entry) => (entry.kind === 'jsx-expression-attribute' ? [{ key: entry.name, value: entry.value }] : [])),
  ];
}

/**
 * An imported model's mesh node as the instancing scene overrides its surface materials
 * (`<GodotImportedScene overrides>`): each override the scene's material, declared once.
 */
export function familyMaterialOverride(emission: FamilyEmission, setters: readonly TargetGodotSceneSetterPlan[]): TargetTsObjectProperty[] {
  return setters.flatMap((setter) => {
    const resource = resourceOf(emission, setter.value);
    if (resource === undefined) return [];
    return [{ key: `surface_material_override/${String(setter.index)}`, value: identifier(sharedMaterial(emission, resource)) }];
  });
}

/**
 * An imported model's external materials (`<GodotImportedScene materials>`): each the project's
 * material, declared once, by the glTF material name it stands in for.
 */
export function familyModelMaterials(emission: FamilyEmission, materials: readonly { readonly name: string; readonly key: string }[]): TargetTsObjectProperty[] {
  return materials.flatMap(({ name, key }) => {
    const resource = emission.resources.get(key);
    if (resource === undefined) return [];
    return [{ key: name, value: identifier(sharedMaterial(emission, resource)) }];
  });
}

/** A compat element's props for a node's authored properties (a GridMap's `data` its cells file). */
function elementProps(emission: FamilyEmission, nodePath: string, setters: readonly TargetGodotSceneSetterPlan[]): TargetTsJsxAttribute[] {
  // A mixer's libraries, one `libraries` prop by name (`libraries/NAME`, `AnimationMixer::_set`).
  const libraries = setters.filter((setter) => setter.setter.exportName === 'godot_animation_mixer_set_library');
  // An AnimationTree's parameters, one `parameters` prop by path (`parameters/<path>`).
  const parameters = setters.filter((setter) => setter.setter.exportName === 'godot_animation_tree_set');
  const own = setters.filter((setter) => !['set_meta', 'godot_animation_mixer_set_library', 'godot_animation_tree_set'].includes(setter.setter.exportName));
  // The node's metadata entries, one `meta` prop (`Object::_set`, `metadata/NAME`).
  const meta = setters.filter((setter) => setter.setter.exportName === 'set_meta');
  return [
    ...(libraries.length === 0
      ? []
      : [attribute('libraries', { kind: 'object-expression', properties: libraries.map((setter) => ({ key: String(setter.index), value: propValue(emission, setter.value) })) })]),
    ...own.flatMap((setter) => {
      if (setter.written === 'cells-file') {
        return [attribute('data', identifier(dataImport(emission, godotGridMapDataPath(emission.targetPath, nodePath), `${nodePath === '.' ? 'grid' : nodePath} cells`)))];
      }
      const resource = resourceOf(emission, setter.value);
      // A mesh an element draws (a particle system's) is three's geometry and its surface's material.
      if (resource?.idiom !== undefined && 'geometry' in resource.idiom) return particleMesh(emission, resource);
      // A material an element draws with (a material override) is three's material, as a mesh's is.
      if (resource?.idiom?.kind === 'material') return [attribute(godotPropName(setter.propertyName), identifier(sharedMaterial(emission, resource)))];
      return [attribute(godotPropName(setter.propertyName), propValue(emission, setter.value))];
    }),
    ...(meta.length === 0
      ? []
      : [attribute('meta', { kind: 'object-expression', properties: meta.map((setter) => ({ key: String(setter.index), value: metaValue(emission, setter.value) })) })]),
    ...(parameters.length === 0
      ? []
      : [attribute('parameters', { kind: 'object-expression', properties: parameters.map((setter) => ({ key: String(setter.index), value: propValue(emission, setter.value) })) })]),
  ];
}

/**
 * An instanced scene's overrides on its root, when the root is a compat element: the instance's
 * authored properties as the element's props (they follow the prefab's own, and win).
 */
export function familyInstanceProps(
  emission: FamilyEmission,
  node: DirectGodotSceneNodePlan,
  own: readonly TargetGodotSceneSetterPlan[],
): TargetTsJsxAttribute[] | undefined {
  // A value the instanced scene's root already holds (the same resource file, the same literal) is its own.
  const same = (entry: TargetGodotSceneSetterPlan) =>
    own.some((mine) => mine.setter.exportName === entry.setter.exportName && mine.index === entry.index && JSON.stringify(mine.value) === JSON.stringify(entry.value) && (entry.value.kind !== 'resource' || entry.value.key.startsWith('ext:')));
  return elementProps(emission, node.nodePath, node.setters.filter((entry) => !same(entry)));
}

/**
 * A GradientTexture2D a material samples: its image made from the properties the scene states, as
 * three's texture sampled with the material's filter and repeat, declared once in the module.
 */
function gradientMap(emission: FamilyEmission, texture: TargetGodotSceneResourcePlan, filter: number, repeat: boolean): string {
  const image: TargetTsExpression = {
    kind: 'call-expression',
    callee: identifier(useCompat(emission, 'gradient-texture-2d', 'godot_gradient_texture_2d_texture')),
    arguments: [identifier(resourceLocal(emission, texture.key))],
  };
  const made: TargetTsExpression = {
    kind: 'call-expression',
    callee: identifier(useCompat(emission, 'base-material-3d', 'godot_base_material_3d_scene_map')),
    arguments: [image, literal(filter), literal(repeat)],
  };
  return declareShared(emission, `${texture.key}\0${String(filter)}:${String(repeat)}`, `${stemOf(texture.key)} map`, made, []);
}

/** A particle system's mesh as the three geometry and material it draws, declared once in the module. */
function particleMesh(emission: FamilyEmission, mesh: TargetGodotSceneResourcePlan | undefined): TargetTsJsxAttribute[] {
  if (mesh === undefined) return [];
  const surface = mesh.mesh?.surfaces[0]?.material;
  const material = mesh.mesh === undefined ? resourceOf(emission, setterValue(mesh.setters, 'set_material')) : surface === undefined ? undefined : emission.resources.get(surface);
  return [
    attribute('geometry', identifier(sharedGeometry(emission, mesh))),
    ...(material === undefined ? [] : [attribute('material', identifier(sharedMaterial(emission, material)))]),
  ];
}

/** A carried node's element (tag, family props and resource children), or undefined for another class. */
export function familyElement(
  emission: FamilyEmission,
  form: GodotSceneNodeIdiomForm,
  node: DirectGodotSceneNodePlan,
): { readonly tag: string; readonly attributes: readonly TargetTsJsxAttribute[]; readonly children: readonly TargetTsJsxChild[] } | undefined {
  if (form.kind === 'element') {
    // Godot's layout and drawing are compat's: the element states the node's properties as props, in
    // the scene's order.
    const tag = useCompat(emission, form.module, form.exportName);
    // A mixer's track bindings come first: its libraries and autoplay are set after them.
    const bindings = animationBindingsLocal(emission, node);
    return { tag, attributes: [...(bindings === undefined ? [] : [attribute('bindings', identifier(bindings))]), ...elementProps(emission, node.nodePath, node.setters)], children: [] };
  }
  switch (form.kind) {
    case 'reflection-probe': {
      // The game editor's reflections capability captures the probe (`reflection-probe.ts` maps its
      // properties, by Godot name, to the capture's props).
      const tag = useCompat(emission, 'lib:reflections/index', 'ReflectionProbe');
      const props = useCompat(emission, 'reflection-probe', 'godot_reflection_probe_props');
      const authored: TargetTsExpression = {
        kind: 'object-expression',
        properties: node.setters.map((setter) => ({ key: setter.propertyName, value: propValue(emission, setter.value) })),
      };
      return { tag, attributes: [{ kind: 'jsx-spread-attribute', value: { kind: 'call-expression', callee: identifier(props), arguments: [authored] } }], children: [] };
    }
    case 'mesh': {
      const set = node.setters;
      const layers = numberValue(setterValue(set, 'set_layer_mask')) ?? 1;
      // Any setting but `SHADOW_CASTING_SETTING_OFF` casts (`geometry-instance-3d.ts`).
      const castShadow = (numberValue(setterValue(set, 'set_cast_shadows_setting')) ?? 1) !== 0;
      const attributes: TargetTsJsxAttribute[] = [
        ...(castShadow ? [flag('castShadow')] : []),
        flag('receiveShadow'),
        ...(layers === 1 ? [] : [attribute('layers-mask', literal(layers))]),
      ];
      const { mesh, materials } = meshSurfaces(emission, node);
      if (mesh === undefined) return { tag: 'mesh', attributes, children: [] };
      const children: TargetTsJsxChild[] = [];
      // A resource shared with another node is the one object the scene declares, by reference.
      if (sharedResource(emission, mesh)) attributes.push(attribute('geometry', identifier(sharedGeometry(emission, mesh))));
      else children.push(geometry(emission, mesh));
      materials.forEach((resource, surface) => {
        const attach = materials.length === 1 ? [] : [{ kind: 'jsx-string-attribute' as const, name: 'attach', value: `material-${String(surface)}` }];
        if (resource !== undefined && sharedResource(emission, resource)) {
          const local = identifier(sharedMaterial(emission, resource));
          if (materials.length === 1) attributes.push(attribute('material', local));
          else children.push(element('primitive', [attribute('object', local), ...attach]));
        } else {
          children.push(material(emission, resource, attach));
        }
      });
      return { tag: 'mesh', attributes, children };
    }
    case 'light': {
      // The planner's three light (`scene-light-idioms.ts`), printed as it is.
      const light = node.light;
      if (light === undefined) throw new Error(`${node.nodePath}: a light node without its planned light`);
      const authored = light.authored;
      return {
        tag: light.element,
        attributes: [
          // Godot's directional light shines along its -Z; three's toward its target, which this
          // aims; its Godot state is the values the scene authors (the sky pass reads them).
          ...(authored === undefined
            ? []
            : [
                attribute('onUpdate', {
                  kind: 'call-expression',
                  callee: identifier(useCompat(emission, 'directional-light-3d', 'godot_directional_light_3d_authored_prop')),
                  arguments: [
                    {
                      kind: 'object-expression',
                      properties: [
                        ...(authored.color === undefined ? [] : [{ key: 'color', value: numbers(authored.color) }]),
                        { key: 'params', value: { kind: 'object-expression', properties: authored.params.map((entry) => ({ key: String(entry.index), value: literal(entry.value) })) } },
                        { key: 'shadow', value: literal(authored.shadow) },
                        { key: 'skyMode', value: literal(authored.skyMode) },
                        ...(authored.blendSplits === true ? [{ key: 'blendSplits', value: literal(true) }] : []),
                      ],
                    },
                  ],
                }),
              ]),
          ...light.props.map((prop) =>
            prop.value.kind === 'numbers'
              ? attribute(prop.name, numbers(prop.value.values))
              : prop.value.kind === 'flag'
                ? flag(prop.name)
                : attribute(prop.name, literal(prop.value.value)),
          ),
        ],
        children: [],
      };
    }
    case 'camera': {
      emission.drei.add('PerspectiveCamera');
      // Godot's lens (`camera_3d.h:68`): three's own defaults differ, so every value is stated.
      const property = (name: string, initial: number) => node.properties.find((entry) => entry.propertyName === name)?.value[0] ?? initial;
      return {
        tag: 'PerspectiveCamera',
        attributes: [
          ...(emission.currentCamera === node.nodePath ? [flag('makeDefault')] : []),
          // Its aspect and vertical angle are Godot's projection (`camera-3d.ts`), not drei's resize.
          flag('manual'),
          attribute('fov', literal(property('fov', 75))),
          attribute('near', literal(property('near', 0.05))),
          attribute('far', literal(property('far', 4000))),
          // Its cull mask is three's camera layers (`camera-3d.ts`); three's default is layer 0
          // alone, Godot's all 20 (`camera_3d.h:83`), so the mask is always stated.
          attribute('layers-mask', literal(numberValue(setterValue(node.setters, 'set_cull_mask')) ?? 0xfffff)),
          // Its own environment, drawn in place of the world's while the viewport draws with it.
          ...(setterValue(node.setters, 'set_environment') === undefined
            ? []
            : [
                attribute('onUpdate', {
                  kind: 'call-expression',
                  callee: identifier(useCompat(emission, 'camera-3d', 'godot_camera_3d_environment_prop')),
                  arguments: [propValue(emission, setterValue(node.setters, 'set_environment') as TargetGodotSceneValue)],
                }),
              ]),
        ],
        children: [],
      };
    }
    default:
      return undefined;
  }
}


/** The imports a scene's family elements need: compat, three constants and data files. */
export function familyImports(emission: FamilyEmission): TargetTsStatement[] {
  return [
    ...(emission.react.size === 0
      ? []
      : [{ kind: 'import-statement' as const, module: 'react', namedBindings: [...emission.react].sort().map((name) => ({ imported: name, local: name })) }]),
    ...(emission.three.size === 0
      ? []
      : [{ kind: 'import-statement' as const, module: 'three', namedBindings: [...emission.three].sort().map((name) => ({ imported: name, local: name })) }]),
    ...(emission.drei.size === 0
      ? []
      : [{ kind: 'import-statement' as const, module: '@react-three/drei', namedBindings: [...emission.drei].sort().map((name) => ({ imported: name, local: name })) }]),
    ...[...emission.compat].map(([module, names]) => ({
      kind: 'import-statement' as const,
      // `lib:` names another capability's module (`lib:reflections/index`), beside godot-compat.
      module: moduleSpecifier(emission.targetPath, module.startsWith('lib:') ? `src/lib/${module.slice('lib:'.length)}.ts` : `src/lib/godot-compat/${module}.ts`),
      namedBindings: [...names].sort().map((name) => {
        const [imported, local] = name.split(' as ') as [string, string | undefined];
        return { imported, local: local ?? imported };
      }),
    })),
    ...[...emission.data].map(([module, local]) => ({
      kind: 'import-statement' as const,
      module,
      defaultBinding: local,
      namedBindings: [],
    })),
  ];
}
