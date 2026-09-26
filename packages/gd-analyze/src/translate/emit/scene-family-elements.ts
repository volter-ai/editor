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
 * - A `StandardMaterial3D` is `<meshStandardMaterial>` (`<meshBasicMaterial>` unshaded), a surface
 *   without one Godot's Compatibility default material; the albedo as its sRGB hex (a colour
 *   beyond 1 as linear components), the emission as the linear colour the Compatibility shader
 *   computes from it and its energy (`scene.glsl:2399`, `tonemap_inc.glsl:22`).
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
import { godotAnimationLibraryDataPath } from '../data/scene-animation';
import { godotArrayMeshDataPath, godotGridMapDataPath, godotMeshLibraryDataPath } from '../data/scene-families';
import type { TargetGodotSceneResourcePlan, TargetGodotSceneSetterPlan, TargetGodotSceneValue } from '../data/scene-document-plan';

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

/** A Godot colour's components as the sRGB hex three reads (`#rrggbb`). */
export function hexColor(components: readonly number[]): string {
  const channel = (value: number) => Math.round(Math.min(Math.max(value, 0), 1) * 255).toString(16).padStart(2, '0');
  return `#${components.slice(0, 3).map(channel).join('')}`;
}

/**
 * The Compatibility shader's `srgb_to_linear` (`drivers/gles3/shaders/tonemap_inc.glsl:22`), a
 * polynomial approximation, in the GPU's single precision.
 */
function srgbToLinear(value: number): number {
  return f32(value * f32(f32(value * f32(f32(value * 0.305306011) + 0.682171111)) + 0.012522878));
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
  const key = `${texture.key}\0${sampler === undefined ? '' : `${String(sampler.filter)}:${String(sampler.repeat)}:${String(sampler.srgb)}`}`;
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
  switch (resource.className) {
    case 'PlaneMesh':
    case 'QuadMesh': {
      const quad = resource.className === 'QuadMesh';
      const size = componentsValue(setterValue(set, 'set_size')) ?? (quad ? [1, 1] : [2, 2]);
      const segments = [num('set_subdivide_width', 0) + 1, num('set_subdivide_depth', 0) + 1];
      // `Orientation` (`primitive_meshes.h:240`): FACE_X 0, FACE_Y 1 (PlaneMesh's), FACE_Z 2 (QuadMesh's, three's own).
      const orientation = num('set_orientation', quad ? 2 : 1);
      const turn =
        orientation === 1
          ? useCompat(emission, 'plane-mesh', 'godot_plane_mesh_face_y')
          : orientation === 0
            ? useCompat(emission, 'plane-mesh', 'godot_plane_mesh_face_x')
            : undefined;
      const args = segments.some((value) => value !== 1) ? [size[0] as number, size[1] as number, ...segments] : [size[0] as number, size[1] as number];
      return element('planeGeometry', [attribute('args', numbers(args)), ...(turn === undefined ? [] : [attribute('onUpdate', identifier(turn))])]);
    }
    case 'SphereMesh':
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
    case 'CylinderMesh': {
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
    case 'ArrayMesh': {
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

/** Three's blending constant for a `BaseMaterial3D::BlendMode` (`material.h:226`), mix excepted. */
const BLENDING = ['', 'AdditiveBlending', 'SubtractiveBlending', 'MultiplyBlending'] as const;

/** A colour prop: the sRGB hex, or linear components where a channel is beyond hex's range. */
function colourProp(components: readonly number[]): TargetTsExpression {
  const rgb = components.slice(0, 3);
  if (rgb.every((value) => value >= 0 && value <= 1)) return literal(hexColor(rgb));
  return numbers(rgb.map(srgbToLinear));
}

/**
 * A surface's material element: a `StandardMaterial3D`, or none (the Compatibility renderer's
 * default material, `rasterizer_scene_gles3.cpp:4624`: albedo 0.6, roughness 0.8, metallic 0.2).
 */
function material(emission: FamilyEmission, resource: TargetGodotSceneResourcePlan | undefined, attach: readonly TargetTsJsxAttribute[]): TargetTsJsxChild {
  if (resource === undefined) {
    // The shader's albedo is converted from sRGB like any material's (`scene.glsl:2398`).
    return element('meshStandardMaterial', [
      ...attach,
      attribute('color', literal(hexColor([0.6, 0.6, 0.6]))),
      attribute('roughness', literal(0.8)),
      attribute('metalness', literal(0.2)),
    ]);
  }
  if (resource.className !== 'StandardMaterial3D') throw new Error(`${resource.key}: ${resource.className} has no three material`);
  const set = resource.setters;
  const albedo = componentsValue(setterValue(set, 'set_albedo'));
  const transparency = numberValue(setterValue(set, 'set_transparency')) ?? 0;
  const blend = numberValue(setterValue(set, 'set_blend_mode')) ?? 0;
  const unshaded = (numberValue(setterValue(set, 'set_shading_mode')) ?? 1) === 0;
  const metallic = numberValue(setterValue(set, 'set_metallic'));
  const roughness = numberValue(setterValue(set, 'set_roughness'));
  const texture = resourceOf(emission, setterValue(set, 'set_texture', 0));
  // `TEXTURE_ROUGHNESS` (`material.h:149`): three samples its green channel where Godot samples the
  // material's `roughness_texture_channel` (red by default); a grey image reads the same.
  const roughnessTexture = resourceOf(emission, setterValue(set, 'set_texture', 2));
  const emissionOn = boolValue(setterValue(set, 'set_feature', 0)) === true;
  const props: TargetTsJsxAttribute[] = [...attach];
  if (albedo !== undefined && albedo.slice(0, 3).some((value) => value !== 1)) props.push(attribute('color', colourProp(albedo)));
  const filter = numberValue(setterValue(set, 'set_texture_filter')) ?? 3;
  const repeat = boolValue(setterValue(set, 'set_flag', 16)) ?? true;
  if (texture !== undefined) {
    const map = texture.className === 'GradientTexture2D' ? gradientMap(emission, texture, filter, repeat) : textureHook(emission, texture, { filter, repeat, srgb: true });
    props.push(attribute('map', identifier(map)));
  }
  // Proximity fade draws through the alpha pass (`material.cpp:1807`); its fade is not drawn
  // (`proximity-fade`, base-material-3d.ts).
  const proximity = boolValue(setterValue(set, 'set_proximity_fade_enabled')) === true;
  if (transparency !== 0 || proximity) props.push(flag('transparent'), attribute('opacity', literal(transparency !== 0 ? (albedo?.[3] ?? 1) : 1)));
  if (transparency === 2) props.push(attribute('alphaTest', literal(0.5)));
  const blending = BLENDING[blend];
  if (blending !== undefined && blending !== '') {
    emission.three.add(blending);
    props.push(attribute('blending', identifier(blending)));
  }
  if (!unshaded) {
    if (metallic !== undefined) props.push(attribute('metalness', literal(metallic)));
    if (roughness !== undefined) props.push(attribute('roughness', literal(roughness)));
    if (roughnessTexture !== undefined) {
      props.push(attribute('roughnessMap', identifier(textureHook(emission, roughnessTexture, { filter, repeat, srgb: false }))));
    }
    if (emissionOn) {
      const colour = componentsValue(setterValue(set, 'set_emission')) ?? [0, 0, 0, 1];
      const energy = numberValue(setterValue(set, 'set_emission_energy_multiplier')) ?? 1;
      props.push(attribute('emissive', numbers(colour.slice(0, 3).map((value) => srgbToLinear(f32(value * energy))))));
    }
  }
  // `CULL_FRONT` and `CULL_DISABLED` as the side three draws (`material.h:296`).
  const cull = numberValue(setterValue(set, 'set_cull_mode')) ?? 0;
  if (cull !== 0) {
    const side = cull === 1 ? 'BackSide' : 'DoubleSide';
    emission.three.add(side);
    props.push(attribute('side', identifier(side)));
  }
  // The Godot-only parameters the draw reads back: vertex colour (a particle system's instance
  // colour), the billboard, proximity fade.
  const data: TargetTsObjectProperty[] = [];
  const billboard = numberValue(setterValue(set, 'set_billboard_mode')) ?? 0;
  if (billboard !== 0) data.push({ key: 'billboard_mode', value: literal(billboard) });
  if (boolValue(setterValue(set, 'set_flag', 5)) === true) data.push({ key: 'billboard_keep_scale', value: literal(true) });
  if (boolValue(setterValue(set, 'set_flag', 1)) === true) data.push({ key: 'vertex_color_use_as_albedo', value: literal(true) });
  if (boolValue(setterValue(set, 'set_flag', 2)) === true) data.push({ key: 'vertex_color_is_srgb', value: literal(true) });
  if (proximity) {
    data.push({ key: 'proximity_fade_enabled', value: literal(true) });
    data.push({ key: 'proximity_fade_distance', value: literal(Math.max(f32(numberValue(setterValue(set, 'set_proximity_fade_distance')) ?? 1), f32(0.01))) });
  }
  if (data.length > 0) props.push(attribute('userData', { kind: 'object-expression', properties: data }));
  // A billboard or vertex colour draws through Godot's vertex code (`godot_base_material_3d_scene_shader`).
  if (billboard !== 0 || boolValue(setterValue(set, 'set_flag', 1)) === true) props.push(attribute('onUpdate', identifier(useCompat(emission, 'base-material-3d', 'godot_base_material_3d_scene_shader'))));
  // Anisotropy (`FEATURE_ANISOTROPY`) draws on three's physical material (`godot_base_material_3d_anisotropy`).
  const anisotropic = !unshaded && boolValue(setterValue(set, 'set_feature', 4)) === true;
  if (anisotropic) {
    const ratio = numberValue(setterValue(set, 'set_anisotropy')) ?? 0;
    const { anisotropy, rotation } = godotAnisotropy(ratio);
    props.push(attribute('anisotropy', literal(anisotropy)));
    if (rotation !== 0) props.push(attribute('anisotropyRotation', literal(rotation)));
  }
  return element(unshaded ? 'meshBasicMaterial' : anisotropic ? 'meshPhysicalMaterial' : 'meshStandardMaterial', props);
}

/** `godot_base_material_3d_anisotropy` (`base-material-3d.ts`): the strength and the rotation from the tangent. */
function godotAnisotropy(ratio: number): { readonly anisotropy: number; readonly rotation: number } {
  const value = f32(ratio);
  return { anisotropy: Math.abs(value), rotation: value < 0 ? Math.PI / 2 : 0 };
}

/**
 * The Godot classes written as compat elements (`useGodotElement`): their component, its module, and
 * the three object it mounts (for a script's ref).
 */
const GODOT_ELEMENTS: Readonly<Record<string, readonly [module: string, three: string]>> = {
  CanvasLayer: ['canvas-layer', 'Group'],
  Control: ['control', 'Group'],
  HBoxContainer: ['h-box-container', 'Group'],
  Label: ['label', 'Group'],
  TextureRect: ['texture-rect', 'Group'],
  Node2D: ['node-2d', 'Group'],
  Sprite2D: ['sprite-2d', 'Group'],
  TouchScreenButton: ['touch-screen-button', 'Group'],
  Label3D: ['label-3d', 'Mesh'],
  AudioStreamPlayer: ['audio-stream-player', 'Group'],
  AudioStreamPlayer3D: ['audio-stream-player-3d', 'Group'],
  GridMap: ['grid-map', 'Group'],
  CPUParticles3D: ['cpu-particles-3d', 'Group'],
  Decal: ['decal', 'Group'],
  AnimationPlayer: ['animation-player', 'Group'],
};

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
  if (resource.className === 'CompressedTexture2D') return textureHook(emission, resource);
  if (resource.className === 'MeshLibrary') return libraryLocal(emission, resource);
  if (resource.className === 'AnimationLibrary') return animationLibraryLocal(emission, resource);
  const existing = emission.hookLocals.get(key);
  if (existing !== undefined) return existing;
  if (resource.className === 'AudioStreamWAV') {
    const load = resource.load;
    if (load === undefined) throw new Error(`${key}: a sound that is not an imported file`);
    const local = freshLocal(emission, path.posix.basename(load.sourceResPath).replace(/\.[^.]+$/u, ''));
    emission.hookLocals.set(key, local);
    emission.loaded.add(local);
    emission.hooks.push({
      kind: 'variable-statement',
      declaration: 'const',
      name: local,
      initializer: {
        kind: 'call-expression',
        callee: identifier(useCompat(emission, 'audio-stream-wav', 'useGodotAudioStreamWav')),
        arguments: [
          literal(assetUrl(load.sourceResPath)),
          { kind: 'object-expression', properties: Object.entries(load.options).map(([name, value]) => ({ key: name, value: literal(value) })) },
        ],
      },
    });
    return local;
  }
  const properties = resource.setters.map((setter) => ({ key: godotPropName(setter.propertyName), value: propValue(emission, setter.value) }));
  const uses = properties.flatMap((property) => (property.value.kind === 'identifier-expression' && emission.loaded.has(property.value.name) ? [property.value.name] : []));
  const local = freshLocal(emission, key.replace(/^.*[:/#]/u, '').replace(/_[A-Za-z0-9]{5}$/u, ''));
  emission.hookLocals.set(key, local);
  const constructor = useCompat(emission, resource.construct.module.replace(/^lib\/godot-compat\//u, ''), resource.construct.exportName);
  const made: TargetTsExpression = {
    kind: 'call-expression',
    callee: identifier(constructor),
    arguments: properties.length === 0 ? [] : [{ kind: 'object-expression', properties }],
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

/**
 * A shadow-casting light's shadow as three's `shadow` props, converted from Godot's parameters by the
 * Compatibility renderer's own use of them (`shadow-mapping`: three draws one fixed shadow camera
 * where Godot fits its splits to the view camera):
 * - a directional light's bias is `SHADOW_BIAS / 100` of its shadow camera's depth range
 *   (`rasterizer_scene_gles3.cpp:2256`, the bias scale `z_max - z_min`, `renderer_scene_cull.cpp:2360`),
 *   which is three's bias in its normalized depth, towards the light; its normal bias
 *   `SHADOW_NORMAL_BIAS` shadow-map texels (`rasterizer_scene_gles3.cpp:1809`, a texel
 *   `2 * radius / size`, `renderer_scene_cull.cpp:2359`); its map the directional atlas (4096) or a
 *   quarter of it per split; its camera the box `SHADOW_MAX_DISTANCE` around the light;
 * - an omni light's bias is world distance added to the caster's (`scene.glsl:2751`), three's in its
 *   normalized distance between the shadow camera's near (0.5) and far (the light's range); its
 *   map a cube face of the positional atlas's first quadrant (2048, halved for a cube,
 *   `rasterizer_scene_gles3.cpp:2298`).
 * `SHADOW_BLUR` is not read by the Compatibility renderer; the fade start has no three form.
 */
function shadowMapping(directional: boolean, param: (index: number, initial: number) => number, mode: number): TargetTsJsxAttribute[] {
  if (directional) {
    const distance = param(9, 100);
    const size = mode === 0 ? 4096 : 2048;
    return [
      attribute('shadow-bias', literal(-param(15, 0.1) / 100)),
      attribute('shadow-normalBias', literal((param(14, 2) * 2 * distance) / size)),
      attribute('shadow-mapSize', numbers([size, size])),
      attribute('shadow-camera-left', literal(-distance)),
      attribute('shadow-camera-right', literal(distance)),
      attribute('shadow-camera-bottom', literal(-distance)),
      attribute('shadow-camera-top', literal(distance)),
      attribute('shadow-camera-near', literal(-distance)),
      attribute('shadow-camera-far', literal(distance)),
    ];
  }
  const range = Math.max(0.001, param(4, 5));
  return [attribute('shadow-bias', literal(-param(15, 0.1) / (range - 0.5))), attribute('shadow-mapSize', numbers([1024, 1024]))];
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
    if (node.classes[0] === 'MeshInstance3D') {
      const { mesh, materials } = meshSurfaces(emission, node);
      for (const resource of [mesh, ...materials]) {
        if (resource !== undefined) emission.uses.set(resource.key, (emission.uses.get(resource.key) ?? 0) + 1);
      }
    }
    for (const child of [...node.children, ...(node.placements ?? []).map((placed) => placed.node)]) walk(child);
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
    if (resource.className === 'ArrayMesh') {
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

/** A shared material: three's material made once from the element's own props. */
function sharedMaterial(emission: FamilyEmission, resource: TargetGodotSceneResourcePlan): string {
  const child = material(emission, resource, []) as TargetTsJsxChild & { readonly tag: string; readonly attributes: readonly TargetTsJsxAttribute[] };
  const three = child.tag.charAt(0).toUpperCase() + child.tag.slice(1);
  emission.three.add(three);
  const uses: string[] = [];
  const properties = child.attributes.flatMap((entry) => {
    if (entry.kind !== 'jsx-expression-attribute') return [];
    let value = entry.value;
    if (value.kind === 'identifier-expression' && emission.loaded.has(value.name)) uses.push(value.name);
    // A colour's linear components are three's `Color`.
    if ((entry.name === 'color' || entry.name === 'emissive') && value.kind === 'array-expression') {
      emission.three.add('Color');
      value = { kind: 'new-expression', callee: identifier('Color'), arguments: value.elements };
    }
    return [{ key: entry.name, value }];
  });
  const onUpdate = properties.find((property) => property.key === 'onUpdate');
  const own = properties.filter((property) => property !== onUpdate);
  const constructed: TargetTsExpression = { kind: 'new-expression', callee: identifier(three), arguments: own.length === 0 ? [] : [{ kind: 'object-expression', properties: own }] };
  // What an element's `onUpdate` does to its material, done once to the declared one.
  const made: TargetTsExpression = onUpdate === undefined ? constructed : { kind: 'call-expression', callee: onUpdate.value, arguments: [constructed] };
  return declareShared(emission, resource.key, stemOf(resource.key), made, uses);
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

/** Godot's Compatibility default material (`rasterizer_scene_gles3.cpp:4624`), declared once. */
function defaultMaterialLocal(emission: FamilyEmission): string {
  const made = material(emission, undefined, []) as TargetTsJsxChild & { readonly attributes: readonly TargetTsJsxAttribute[] };
  emission.three.add('MeshStandardMaterial');
  const properties = made.attributes.flatMap((entry) => (entry.kind === 'jsx-expression-attribute' ? [{ key: entry.name, value: entry.value }] : []));
  return declareShared(emission, '\0default-material', 'default material', { kind: 'new-expression', callee: identifier('MeshStandardMaterial'), arguments: [{ kind: 'object-expression', properties }] }, []);
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

/**
 * An AnimationPlayer's track bindings, declared once at module level: each value track's setter
 * (with its index) or script field and each method track's native methods, by track path.
 */
function animationBindingsLocal(emission: FamilyEmission, node: DirectGodotSceneNodePlan): string | undefined {
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

/** A compat element's props for a node's authored properties (a GridMap's `data` its cells file). */
function elementProps(emission: FamilyEmission, nodePath: string, setters: readonly TargetGodotSceneSetterPlan[]): TargetTsJsxAttribute[] {
  // A mixer's libraries, one `libraries` prop by name (`libraries/NAME`, `AnimationMixer::_set`).
  const libraries = setters.filter((setter) => setter.setter.exportName === 'godot_animation_mixer_set_library');
  const own = setters.filter((setter) => setter.setter.exportName !== 'set_meta' && setter.setter.exportName !== 'godot_animation_mixer_set_library');
  // The node's metadata entries, one `meta` prop (`Object::_set`, `metadata/NAME`).
  const meta = setters.filter((setter) => setter.setter.exportName === 'set_meta');
  return [
    ...(libraries.length === 0
      ? []
      : [attribute('libraries', { kind: 'object-expression', properties: libraries.map((setter) => ({ key: String(setter.index), value: propValue(emission, setter.value) })) })]),
    ...own.flatMap((setter) =>
      setter.setter.exportName === 'godot_grid_map_set_data'
        ? [attribute('data', identifier(dataImport(emission, godotGridMapDataPath(emission.targetPath, nodePath), `${nodePath === '.' ? 'grid' : nodePath} cells`)))]
        : // Particles draw their mesh as three draws a mesh: its geometry and its surface's material.
          setter.setter.exportName === 'set_mesh' && setter.setter.module.endsWith('/cpu-particles-3d')
          ? particleMesh(emission, resourceOf(emission, setter.value))
          : [attribute(godotPropName(setter.propertyName), propValue(emission, setter.value))],
    ),
    ...(meta.length === 0
      ? []
      : [attribute('meta', { kind: 'object-expression', properties: meta.map((setter) => ({ key: String(setter.index), value: metaValue(emission, setter.value) })) })]),
  ];
}

/**
 * An instanced scene's overrides on its root, when the root is a compat element: the instance's
 * authored properties as the element's props (they follow the prefab's own, and win).
 */
export function familyInstanceProps(
  emission: FamilyEmission,
  rootClass: string,
  node: DirectGodotSceneNodePlan,
  own: readonly TargetGodotSceneSetterPlan[],
): TargetTsJsxAttribute[] | undefined {
  if (GODOT_ELEMENTS[rootClass] === undefined) return undefined;
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
  node: DirectGodotSceneNodePlan,
): { readonly tag: string; readonly attributes: readonly TargetTsJsxAttribute[]; readonly children: readonly TargetTsJsxChild[] } | undefined {
  const className = node.classes[0];
  const godot = className === undefined ? undefined : GODOT_ELEMENTS[className];
  if (godot !== undefined && className !== undefined) {
    // Godot's layout and drawing are compat's: the element states the node's properties as props, in
    // the scene's order.
    const tag = useCompat(emission, godot[0], `Godot${className}`);
    // A mixer's track bindings come first: its libraries and autoplay are set after them.
    const bindings = animationBindingsLocal(emission, node);
    return { tag, attributes: [...(bindings === undefined ? [] : [attribute('bindings', identifier(bindings))]), ...elementProps(emission, node.nodePath, node.setters)], children: [] };
  }
  switch (className) {
    case 'ReflectionProbe': {
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
    case 'MeshInstance3D': {
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
    case 'DirectionalLight3D':
    case 'OmniLight3D': {
      const set = node.setters;
      const param = (index: number, initial: number) => numberValue(setterValue(set, 'set_param', index)) ?? initial;
      const color = componentsValue(setterValue(set, 'set_color'));
      const shadow = boolValue(setterValue(set, 'set_shadow')) === true;
      // `SKY_MODE_SKY_ONLY` lights nothing in the scene (`rasterizer_scene_gles3.cpp:1724`).
      const energy = (numberValue(setterValue(set, 'set_sky_mode')) ?? 0) === 2 ? 0 : param(0, 1);
      const directional = className === 'DirectionalLight3D';
      return {
        tag: directional ? 'directionalLight' : 'pointLight',
        attributes: [
          // Godot's directional light shines along its -Z; three's toward its target, which this aims.
          ...(directional ? [attribute('onUpdate', identifier(useCompat(emission, 'directional-light-3d', 'godot_directional_light_3d_aim')))] : []),
          // Godot's shader divides the Lambert term by pi as three's does (`light-3d.ts`).
          attribute('intensity', literal(f32(energy) * Math.PI)),
          ...(color === undefined || color.slice(0, 3).every((value) => value === 1) ? [] : [attribute('color', literal(hexColor(color)))]),
          // An omni light's range is the distance its attenuation reaches zero at, its attenuation
          // three's decay exponent (`get_omni_spot_attenuation`, `scene.glsl:429`).
          ...(directional ? [] : [attribute('distance', literal(Math.max(0.001, param(4, 5)))), attribute('decay', literal(param(6, 1)))]),
          ...(shadow ? [flag('castShadow'), ...shadowMapping(directional, param, numberValue(setterValue(set, 'set_shadow_mode')) ?? 2)] : []),
        ],
        children: [],
      };
    }
    case 'Camera3D': {
      emission.drei.add('PerspectiveCamera');
      // Godot's lens (`camera_3d.h:68`): three's own defaults differ, so every value is stated.
      const property = (name: string, initial: number) => node.properties.find((entry) => entry.propertyName === name)?.value[0] ?? initial;
      return {
        tag: 'PerspectiveCamera',
        attributes: [
          ...(emission.currentCamera === node.nodePath ? [flag('makeDefault')] : []),
          attribute('fov', literal(property('fov', 75))),
          attribute('near', literal(property('near', 0.05))),
          attribute('far', literal(property('far', 4000))),
        ],
        children: [],
      };
    }
    default:
      return undefined;
  }
}

/** The three object a carried node's element mounts, for a script's ref. */
export function familyThreeType(className: string): string | undefined {
  const godot = GODOT_ELEMENTS[className];
  if (godot !== undefined) return godot[1];
  return (
    { MeshInstance3D: 'Mesh', DirectionalLight3D: 'DirectionalLight', OmniLight3D: 'PointLight', Camera3D: 'PerspectiveCamera', ReflectionProbe: 'Group' } as Readonly<Record<string, string>>
  )[className];
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
