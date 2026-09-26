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
  TargetTsStatement,
} from '../code/target-ts-syntax';
import type { DirectGodotSceneNodePlan } from '../data/direct-project-composition-plan';
import { godotArrayMeshDataPath } from '../data/scene-families';
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
  readonly hookLocals: Map<string, string>;
  /** Data files the scene imports, by module specifier: their local names. */
  readonly data: Map<string, string>;
  /** Local names in use in the component and its module. */
  readonly taken: Set<string>;
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
    hookLocals: new Map(),
    data: new Map(),
    taken: new Set(),
  };
}

export function useCompat(emission: FamilyEmission, module: string, name: string): string {
  const names = emission.compat.get(module) ?? new Set<string>();
  names.add(name);
  emission.compat.set(module, names);
  return name;
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
      const file = godotArrayMeshDataPath(emission.targetPath, resource.key);
      const specifier = moduleSpecifier(emission.targetPath, file);
      let local = emission.data.get(specifier);
      if (local === undefined) {
        local = freshLocal(emission, `${mesh.resourceName === '' ? path.posix.basename(file).replace(/\..*$/u, '') : mesh.resourceName} mesh`);
        emission.data.set(specifier, local);
      }
      const data = local;
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
  if (texture !== undefined) props.push(attribute('map', identifier(textureHook(emission, texture, { filter, repeat, srgb: true }))));
  if (transparency !== 0) props.push(flag('transparent'), attribute('opacity', literal(albedo?.[3] ?? 1)));
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
  return element(unshaded ? 'meshBasicMaterial' : 'meshStandardMaterial', props);
}

/** A carried node's element (tag, family props and resource children), or undefined for another class. */
export function familyElement(
  emission: FamilyEmission,
  node: DirectGodotSceneNodePlan,
): { readonly tag: string; readonly attributes: readonly TargetTsJsxAttribute[]; readonly children: readonly TargetTsJsxChild[] } | undefined {
  const className = node.classes[0];
  switch (className) {
    case 'MeshInstance3D': {
      const set = node.setters;
      const mesh = resourceOf(emission, setterValue(set, 'set_mesh'));
      const layers = numberValue(setterValue(set, 'set_layer_mask')) ?? 1;
      // Any setting but `SHADOW_CASTING_SETTING_OFF` casts (`geometry-instance-3d.ts`).
      const castShadow = (numberValue(setterValue(set, 'set_cast_shadows_setting')) ?? 1) !== 0;
      const attributes = [
        ...(castShadow ? [flag('castShadow')] : []),
        flag('receiveShadow'),
        ...(layers === 1 ? [] : [attribute('layers-mask', literal(layers))]),
      ];
      if (mesh === undefined) return { tag: 'mesh', attributes, children: [] };
      const surfaces = mesh.mesh?.surfaces.length ?? 1;
      const own = (surface: number) =>
        mesh.mesh === undefined
          ? resourceOf(emission, setterValue(mesh.setters, 'set_material'))
          : (() => {
              const key = mesh.mesh.surfaces[surface]?.material;
              return key === undefined ? undefined : emission.resources.get(key);
            })();
      const materials = Array.from({ length: surfaces }, (_, surface) =>
        material(
          emission,
          resourceOf(emission, setterValue(set, 'set_surface_override_material', surface)) ?? own(surface),
          surfaces === 1 ? [] : [{ kind: 'jsx-string-attribute', name: 'attach', value: `material-${String(surface)}` }],
        ),
      );
      return { tag: 'mesh', attributes, children: [geometry(emission, mesh), ...materials] };
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
          ...(shadow ? [flag('castShadow')] : []),
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

/** The imports a scene's family elements need: compat, three constants and data files. */
export function familyImports(emission: FamilyEmission): TargetTsStatement[] {
  return [
    ...(emission.three.size === 0
      ? []
      : [{ kind: 'import-statement' as const, module: 'three', namedBindings: [...emission.three].sort().map((name) => ({ imported: name, local: name })) }]),
    ...(emission.drei.size === 0
      ? []
      : [{ kind: 'import-statement' as const, module: '@react-three/drei', namedBindings: [...emission.drei].sort().map((name) => ({ imported: name, local: name })) }]),
    ...[...emission.compat].map(([module, names]) => ({
      kind: 'import-statement' as const,
      module: moduleSpecifier(emission.targetPath, `src/lib/godot-compat/${module}.ts`),
      namedBindings: [...names].sort().map((name) => ({ imported: name, local: name })),
    })),
    ...[...emission.data].map(([module, local]) => ({
      kind: 'import-statement' as const,
      module,
      defaultBinding: local,
      namedBindings: [],
    })),
  ];
}
