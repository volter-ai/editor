/**
 * @godot-class PackedScene
 * @role BINDING
 *
 * Godot 4.7's imported scene (`editor/import/3d/resource_importer_scene.cpp` over
 * `modules/gltf/gltf_document.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto
 * three's `GLTFLoader` through R3F's `useLoader`. Godot's importer builds its own node tree from
 * the file: it synthesizes a root, a `Skeleton3D` per skin (the joints become its bones, not
 * nodes) and an `AnimationPlayer`, reparents skinned meshes under their skeleton, and names every
 * node with its own uniquifier.
 * three's loader keeps the file's tree. The translated scene hands this component Godot's tree (the
 * importer model in `read/gltf-godot-scene.ts`, as the model's data file: each node's Godot name,
 * class chain, local transform and, for a node the file backs, its glTF `nodes[]` index); the
 * scene writes `<GodotImportedScene src tree overrides>`, its own children as JSX children and the
 * nodes it places under a node of the model inside `<GodotPlaced at="Path">`; the component loads the
 * file, and makes each Godot node the three object the loader made for that glTF node (a
 * synthesized node a new group), under Godot's parent, with Godot's name and transform, adopted
 * by the Node protocol; a Skeleton3D's bones are the loader's joint objects in Godot's bone order.
 * Objects Godot has no node for (a skeleton's bones, a multi-surface mesh's
 * per-surface meshes) stay where the loader put them, unadopted, so `get_node` never sees them.
 *
 * An image the file references outside itself (`images[i].uri`) is the project's imported texture,
 * as `GLTFDocument::_parse_images` loads it (`gltf_document.cpp:2362`): the scene passes that
 * texture (the one `load()` of its path gives, shared by every model that references it) as
 * `images[i]`; the loader does not decode the file, and each material slot that samples it
 * samples the shared texture with the filter and repeat the glTF sampler gives the material
 * (`gltf_texture_sampler.h:87`, `:131`).
 *
 * Not yet transcribed: the importer applies a model's `RESET` animation before saving the scene
 * (`resource_importer_scene.cpp:3400`), which re-poses its bones; here each bone keeps the pose the
 * importer's skeleton gives it (`skin_tool.cpp:636`), which the RESET keys can differ from.
 */

import { godot_geometry_instance_3d_mount } from './geometry-instance-3d';
import { createPortal, type ThreeElements, useLoader } from '@react-three/fiber';
import { createContext, createElement, type ReactNode, type Ref, useContext, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { type BufferGeometry, Group, type Material, type Mesh, type Object3D, Texture } from 'three';
import { type GLTF, GLTFLoader, type GLTFLoaderPlugin } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { type AnimationLibrary, type GodotAnimationLibraryData, get_animation, godot_animation_library_load } from './animation-library';
import { godot_animation_mixer_set_library } from './animation-mixer';
import { godot_animation_player_apply_reset, godot_animation_player_mount, godot_animation_player_set_prop } from './animation-player';
import { godot_base_material_3d_model_map } from './base-material-3d';
import { godot_node_adopt, godot_node_foreign } from './node';
import { set_transform } from './node-3d';
import { construct as quaternion } from './quaternion';
import { construct as transform3d } from './transform-3d';
import { godot_skeleton_3d_bind, set_bone_pose_position, set_bone_pose_rotation, set_bone_pose_scale } from './skeleton-3d';
import { construct as vector3 } from './vector3';
import { set_layer_mask } from './visual-instance-3d';

/** One node of the imported tree, below its root, in `Node::get_children` depth-first order. */
export interface GodotImportedSceneNode {
  /** Relative to the imported root (`Skeleton/Skeleton3D`). */
  readonly path: string;
  readonly name: string;
  /** The Godot class and its native ancestors, nearest first. */
  readonly classes: readonly string[];
  /** A plain `Node` (not a Node3D): mounted non-spatial. */
  readonly nonSpatial?: true;
  /** The glTF `nodes[]` index the importer made this node from; absent for a synthesized node. */
  readonly gltfNode?: number;
  /** Godot's local transform, column-major (the Object3D matrix). */
  /** The importer's AnimationPlayer, which plays the model's clips. */
  readonly animationPlayer?: true;
  /** A GeometryInstance3D (a mesh): it casts and receives shadows as Godot makes it. */
  readonly geometryInstance?: true;
  readonly matrix: readonly number[];
  /** A Skeleton3D's bones in Godot's bone order: name, glTF joint node and the imported pose. */
  readonly bones?: readonly {
    readonly name: string;
    readonly gltfNode: number;
    readonly pose: {
      readonly position: readonly [number, number, number];
      readonly rotation: readonly [number, number, number, number];
      readonly scale: readonly [number, number, number];
    };
  }[];
}

/** The importer's tree of a model, as its data file holds it. */
export interface GodotImportedSceneTree {
  readonly rootClasses: readonly string[];
  readonly nodes: readonly GodotImportedSceneNode[];
  /** The importer's AnimationPlayer library: its clips as the importer keyed them. */
  readonly animations?: GodotAnimationLibraryData;
  /**
   * The `.import`'s `nodes/root_scale` with `nodes/apply_root_scale` on: the importer bakes it into
   * the model's meshes (`_apply_scale_to_scalable_node_collection`, `resource_importer_scene.cpp:599`),
   * and the nodes' positions in `nodes` already carry it.
   */
  readonly meshScale?: number;
}

/**
 * The importer's root scale baked into the loaded file's meshes, as the file loads: each geometry
 * the loader made is scaled once, so the cached file, every clone of it and every instance that
 * shares it draw the importer's mesh.
 */
function rootScale(scale: number): GLTFLoaderPlugin {
  return {
    name: 'godot_root_scale',
    afterRoot: (result: GLTF) => {
      const scaled = new Set<BufferGeometry>();
      for (const scene of result.scenes) {
        scene.traverse((object) => {
          const geometry = (object as Mesh).isMesh === true ? (object as Mesh).geometry : undefined;
          if (geometry === undefined || scaled.has(geometry)) return;
          geometry.scale(scale, scale, scale);
          // Its blend shapes' vertices too (`_rescale_importer_mesh`, resource_importer_scene.cpp:532);
          // three's `scale` moves only the base attributes.
          for (const target of geometry.morphAttributes['position'] ?? []) {
            for (let index = 0; index < target.count; index += 1) {
              target.setXYZ(index, target.getX(index) * scale, target.getY(index) * scale, target.getZ(index) * scale);
            }
            target.needsUpdate = true;
          }
          scaled.add(geometry);
        });
      }
      return Promise.resolve();
    },
  };
}

/**
 * Each model's own loader, with the file's plugins (its external images, its root scale), like its
 * library below: a loader runs every load through it with its plugins by name, so a plugin that
 * belongs to one file cannot sit on a loader other files load through. The loader and the file are
 * the load cache's key, so every instance of a model shares one load, and a reloaded model (a new
 * tree) or a reload of this module loads the file afresh.
 */
const LOADERS = new WeakMap<GodotImportedSceneTree, GLTFLoader>();

function loaderOf(tree: GodotImportedSceneTree, images: Readonly<Record<number, Texture>> | undefined): GLTFLoader {
  let loader = LOADERS.get(tree);
  if (loader === undefined) {
    loader = new GLTFLoader();
    if (images !== undefined) loader.register((parser) => externalImages(parser, images));
    const scale = tree.meshScale;
    if (scale !== undefined) loader.register(() => rootScale(scale));
    LOADERS.set(tree, loader);
  }
  return loader;
}

/** A model's library, loaded once for all its instances (the imported scene's shared resources). */
const LIBRARIES = new WeakMap<GodotImportedSceneTree, AnimationLibrary>();

function libraryOf(tree: GodotImportedSceneTree): AnimationLibrary | undefined {
  if (tree.animations === undefined) return undefined;
  let library = LIBRARIES.get(tree);
  if (library === undefined) {
    library = godot_animation_library_load(tree.animations);
    LIBRARIES.set(tree, library);
  }
  return library;
}

const BONE_POSE = /^bones\/(\d+)\/(position|rotation|scale)$/u;
const SURFACE_OVERRIDE = /^surface_material_override\/(\d+)$/u;

/**
 * One property the instancing scene sets on a node of the model, by its Godot name, through the
 * node's setter: a Skeleton3D's bone poses (`Skeleton3D::_set`, `skeleton_3d.cpp:118`), a
 * VisualInstance3D's render layers (`layers`, `visual_instance_3d.cpp:130`), a MeshInstance3D's
 * surface material override (`surface_material_override/N`, `mesh_instance_3d.cpp:73`), a Node3D's
 * `transform` (`node_3d.cpp:399`). `adopted`
 * is the model's Godot nodes: a mesh node's per-surface meshes, which the loader made below it and
 * Godot has no node for, draw as that node's instance does, so they take its layers too; the
 * importer's surfaces are the glTF mesh's primitives in order, which the loader makes the node's
 * own mesh (one primitive) or its meshes (several), so an override is that mesh's material.
 */
function applyOverride(entity: Object3D, property: string, value: unknown, adopted: ReadonlySet<Object3D>): void {
  // An AnimationPlayer's properties: its track bindings, libraries, autoplay (`animation-player.ts`).
  if (ANIMATION_PLAYERS.has(entity)) {
    godot_animation_player_set_prop(entity, property, value);
    return;
  }
  // A Node3D's local transform (`Node3D::set_transform`, `node_3d.cpp:399`), given as the column-major
  // matrix: its columns are the basis's axes and the origin.
  if (property === 'transform') {
    const m = value as readonly number[];
    const column = (at: number) => vector3(m[at] as number, m[at + 1] as number, m[at + 2] as number);
    set_transform(entity, transform3d(column(0), column(4), column(8), column(12)));
    return;
  }
  if (property === 'layers') {
    set_layer_mask(entity, value as number);
    const surfaces = (object: Object3D): void => {
      for (const child of object.children) {
        if (adopted.has(child)) continue;
        child.layers.mask = entity.layers.mask;
        surfaces(child);
      }
    };
    surfaces(entity);
    return;
  }
  const surface = SURFACE_OVERRIDE.exec(property);
  if (surface !== null) {
    const meshes = (entity as Mesh).isMesh === true ? [entity] : entity.children.filter((child) => !adopted.has(child) && (child as Mesh).isMesh === true);
    const mesh = meshes[Number(surface[1])] as Mesh | undefined;
    if (mesh !== undefined && value !== null) mesh.material = value as Material;
    return;
  }
  const bone = BONE_POSE.exec(property);
  if (bone === null) throw new Error(`godot-compat: an imported model's node has no overridable property ${property}.`);
  const index = Number(bone[1]);
  const components = value as readonly number[];
  if (bone[2] === 'rotation') set_bone_pose_rotation(entity, index, quaternion(...(components as [number, number, number, number])));
  else if (bone[2] === 'position') set_bone_pose_position(entity, index, vector3(...(components as [number, number, number])));
  else set_bone_pose_scale(entity, index, vector3(...(components as [number, number, number])));
}

/** The model's AnimationPlayers: made the class's node (`godot_animation_player_mount`). */
const ANIMATION_PLAYERS = new WeakSet<Object3D>();

/** The loaded tree's nodes by path, for the nodes a scene places under them. */
const TreeContext = createContext<ReadonlyMap<string, Object3D> | null>(null);

/**
 * Nodes the instancing scene places under a node of the imported model (`at`, its path in the
 * model): mounted as that node's children.
 *
 * @godot PackedScene (protocol)
 * @source scene/resources/packed_scene.cpp:540
 */
export function GodotPlaced({ at, children }: { readonly at: string; readonly children?: ReactNode }) {
  const byPath = useContext(TreeContext);
  const target = byPath?.get(at);
  if (target === undefined) throw new Error(`godot-compat: the imported tree has no node ${at}`);
  return createPortal(children, target);
}

type GroupProps = Omit<ThreeElements['group'], 'ref'>;

interface BuiltTree {
  /** Every object the loader made (a Godot node or not). */
  readonly loaded: readonly Object3D[];
  readonly byPath: ReadonlyMap<string, Object3D>;
  readonly byIndex: ReadonlyMap<number, Object3D>;
  readonly depthOne: readonly Object3D[];
}

/** The loaded file's objects as Godot's imported tree, on a private clone of the loaded scene. */
function buildTree(scene: Object3D, associations: ReadonlyMap<Object3D, { readonly nodes?: number }>, nodes: readonly GodotImportedSceneNode[]): BuiltTree {
  const copy = cloneSkinned(scene);
  const loaded: Object3D[] = [];
  copy.traverse((object) => loaded.push(object));
  // The clone has the loaded scene's shape: walk both together to find each glTF node's copy.
  const byIndex = new Map<number, Object3D>();
  const pair = (source: Object3D, target: Object3D): void => {
    const index = associations.get(source)?.nodes;
    if (index !== undefined && !byIndex.has(index)) byIndex.set(index, target);
    source.children.forEach((child, i) => pair(child, target.children[i] as Object3D));
  };
  pair(scene, copy);
  const byPath = new Map<string, Object3D>();
  const depthOne: Object3D[] = [];
  for (const node of nodes) {
    const entity = node.gltfNode === undefined ? new Group() : byIndex.get(node.gltfNode);
    if (entity === undefined) throw new Error(`godot-compat: the loaded model has no glTF node ${node.gltfNode}`);
    entity.name = node.name;
    entity.matrixAutoUpdate = false;
    entity.matrix.fromArray(node.matrix as number[]);
    entity.matrix.decompose(entity.position, entity.quaternion, entity.scale);
    const slash = node.path.lastIndexOf('/');
    if (slash < 0) {
      entity.removeFromParent();
      depthOne.push(entity);
    } else {
      const parent = byPath.get(node.path.slice(0, slash));
      if (parent === undefined) throw new Error(`godot-compat: ${node.path} has no parent in the imported tree`);
      parent.add(entity);
    }
    byPath.set(node.path, entity);
  }
  return { loaded, byPath, byIndex, depthOne };
}

/** What the loader's parser gives a texture plugin. */
interface GltfParser {
  readonly json: {
    readonly textures?: readonly { readonly source?: number; readonly sampler?: number }[];
    readonly samplers?: readonly { readonly minFilter?: number; readonly wrapS?: number; readonly wrapT?: number }[];
  };
}

/**
 * The loader's texture for an external image the scene gave: a stand-in with no image to decode,
 * naming its `images[]` index (it survives the loader's `texCoord` and `KHR_texture_transform`
 * clones), swapped for the shared texture once the model has loaded.
 */
function externalImages(parser: GltfParser, images: Readonly<Record<number, Texture>>) {
  return {
    name: 'godot_external_images',
    loadTexture: (index: number): Promise<Texture> | null => {
      const texture = parser.json.textures?.[index];
      if (texture?.source === undefined || images[texture.source] === undefined) return null;
      const standIn = new Texture();
      standIn.userData = { godotImage: texture.source, godotTexture: index };
      return Promise.resolve(standIn);
    },
  };
}

/** The material slots a glTF texture fills, and whether the slot is a colour (sRGB) one. */
const SLOTS: readonly (readonly [string, boolean])[] = [
  ['map', true],
  ['emissiveMap', true],
  ['normalMap', false],
  ['roughnessMap', false],
  ['metalnessMap', false],
  ['aoMap', false],
];

/** `GLTFTextureSampler::get_filter_mode` (`gltf_texture_sampler.h:87`): the material's `texture_filter`. */
function samplerFilter(minFilter: number | undefined): number {
  if (minFilter === 9728) return 0;
  if (minFilter === 9729) return 1;
  if (minFilter === 9984 || minFilter === 9986) return 2;
  return 3;
}

/** Each loaded model's materials are given the shared textures once. */
const SAMPLED = new WeakSet<object>();

/** Swaps each stand-in for the shared texture as the material samples it. */
function sampleExternalImages(gltf: { readonly scene: Object3D; readonly parser: unknown }, images: Readonly<Record<number, Texture>>): void {
  if (SAMPLED.has(gltf.scene)) return;
  SAMPLED.add(gltf.scene);
  const json = (gltf.parser as GltfParser).json;
  gltf.scene.traverse((object) => {
    const materials = (object as Mesh).material;
    if (materials === undefined) return;
    for (const material of Array.isArray(materials) ? materials : [materials]) {
      const slots = material as Material & Record<string, Texture | null | undefined>;
      for (const [slot, srgb] of SLOTS) {
        const standIn = slots[slot];
        const image = standIn?.userData['godotImage'] as number | undefined;
        if (standIn === null || standIn === undefined || image === undefined) continue;
        const shared = images[image] as Texture;
        const sampler = json.samplers?.[json.textures?.[standIn.userData['godotTexture'] as number]?.sampler ?? -1];
        const repeat = (sampler?.wrapS ?? 10497) === 10497 && (sampler?.wrapT ?? 10497) === 10497;
        slots[slot] = godot_base_material_3d_model_map(shared, samplerFilter(sampler?.minFilter), repeat, srgb, standIn);
        material.needsUpdate = true;
      }
    }
  });
}

/**
 * An instanced imported model: its root (this group, the instancing scene's node) and Godot's
 * imported tree under it, with the instancing scene's placements portalled into its nodes.
 *
 * @godot PackedScene (protocol)
 * @source editor/import/3d/resource_importer_scene.cpp:3174
 */
export function GodotImportedScene({
  src,
  tree: model,
  overrides = {},
  images,
  materials,
  children,
  ref,
  ...props
}: GroupProps & {
  /** The instancing scene's ref to the model's root (a scene's own root, a node it references). */
  readonly ref?: Ref<Group>;
  readonly src: string;
  readonly tree: GodotImportedSceneTree;
  /** The instancing scene's properties on the model's nodes: by node path, by Godot name. */
  readonly overrides?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** The project's imported textures for the file's external images, by `images[]` index. */
  readonly images?: Readonly<Record<number, Texture>>;
  /** The importer's external materials: the project's material for each of the file's, by name. */
  readonly materials?: Readonly<Record<string, Material>>;
  readonly children?: ReactNode;
}) {
  const gltf = useLoader(loaderOf(model, images), src);
  useMemo(() => {
    if (images !== undefined) sampleExternalImages(gltf, images);
  }, [gltf, images]);
  const { rootClasses, nodes } = model;
  // The external materials are the instance's as it mounts, as the importer bakes them in.
  const external = useRef(materials);
  const tree = useMemo(() => {
    const built = buildTree(gltf.scene, gltf.parser.associations as ReadonlyMap<Object3D, { readonly nodes?: number }>, nodes);
    const swap = external.current;
    if (swap !== undefined) {
      for (const object of built.loaded) {
        const mesh = object as Mesh;
        if (mesh.material === undefined) continue;
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map((material) => swap[material.name] ?? material)
          : (swap[mesh.material.name] ?? mesh.material);
      }
    }
    return built;
  }, [gltf, nodes]);
  const root = useRef<Group | null>(null);
  useImperativeHandle(ref, () => root.current as Group, []);
  // The instancing scene's values are set once, as the scene instantiates: a render that rebuilds
  // the `overrides` object with the same values sets nothing again.
  const authored = useRef(overrides);
  useLayoutEffect(() => {
    const entity = root.current;
    if (entity === null) return;
    godot_node_adopt(entity, { classes: rootClasses });
    // The imported tree's own children come first, before the instancing scene's (Godot adds
    // those after instantiating the imported scene, packed_scene.cpp:540).
    tree.depthOne.forEach((child, index) => {
      entity.add(child);
      entity.children.splice(entity.children.indexOf(child), 1);
      entity.children.splice(index, 0, child);
    });
    // What the loader made that Godot's importer has no node for is not a node.
    const members = new Set(tree.byPath.values());
    for (const object of tree.loaded) if (!members.has(object)) godot_node_foreign(object);
    for (const node of nodes) {
      const member = tree.byPath.get(node.path) as Object3D;
      godot_node_adopt(member, {
        classes: node.classes,
        owner: entity,
        ...(node.nonSpatial === true ? { kind: 'node' as const } : {}),
      });
      // The importer's AnimationPlayer is the class's node, which the instancing scene may set up.
      // A mesh casts and receives shadows as Godot makes it, through the loader's primitives under it.
      if (node.geometryInstance === true) {
        member.traverse((object) => {
          if (object === member || !members.has(object)) godot_geometry_instance_3d_mount(object);
        });
      }
      if (node.animationPlayer === true && !ANIMATION_PLAYERS.has(member)) {
        godot_animation_player_mount(member);
        ANIMATION_PLAYERS.add(member);
        const library = libraryOf(model);
        if (library !== undefined) godot_animation_mixer_set_library(member, '', library);
      }
    }
    // A skeleton's bones are the loader's joint objects, in Godot's bone order.
    for (const node of nodes) {
      if (node.bones === undefined) continue;
      godot_skeleton_3d_bind(
        tree.byPath.get(node.path) as Object3D,
        node.bones.map((bone) => {
          const object = tree.byIndex.get(bone.gltfNode);
          if (object === undefined) throw new Error(`godot-compat: the loaded model has no joint node ${bone.gltfNode}`);
          return { object, name: bone.name, pose: bone.pose };
        }),
      );
    }
    // The importer applied the model's RESET before saving it (`resource_importer_scene.cpp:3394`).
    const library = libraryOf(model);
    const reset = library === undefined ? null : get_animation(library, 'RESET');
    if (reset !== null) godot_animation_player_apply_reset(entity, reset);
    // Godot sets the instancing scene's values on the instantiated nodes (`SceneState::instantiate`,
    // packed_scene.cpp:400).
    for (const [at, properties] of Object.entries(authored.current)) {
      const target = tree.byPath.get(at);
      if (target === undefined) throw new Error(`godot-compat: the imported tree has no node ${at}`);
      for (const [property, value] of Object.entries(properties)) applyOverride(target, property, value, members);
    }
    return () => {
      for (const child of tree.depthOne) entity.remove(child);
    };
  }, [tree, nodes, rootClasses]);
  return createElement(
    'group',
    { ...props, ref: root },
    createElement(TreeContext.Provider, { value: tree.byPath }, children),
  );
}
