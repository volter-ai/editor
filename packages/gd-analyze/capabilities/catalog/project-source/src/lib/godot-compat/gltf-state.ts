export const GODOT_GLTF_HANDLE_BINARY_DISCARD_TEXTURES = 0;
export const GODOT_GLTF_HANDLE_BINARY_EXTRACT_TEXTURES = 1;
export const GODOT_GLTF_HANDLE_BINARY_EMBED_AS_BASISU = 2;
export const GODOT_GLTF_HANDLE_BINARY_EMBED_AS_UNCOMPRESSED = 3;

export class GodotGLTFNode {
  private originalName = '';
  private parent = -1;
  private height = -1;
  private transform: unknown = null;
  private mesh = -1;
  private camera = -1;
  private skin = -1;
  private skeleton = -1;
  private position = { x: 0, y: 0, z: 0 };
  private rotation = { x: 0, y: 0, z: 0, w: 1 };
  private scale = { x: 1, y: 1, z: 1 };
  private children: number[] = [];
  private light = -1;
  private visible = true;
  private readonly additionalData = new Map<string, unknown>();

  get_original_name(): string { return this.originalName; }
  set_original_name(originalName: string): void { this.originalName = originalName; }
  get_parent(): number { return this.parent; }
  set_parent(parent: number): void { this.parent = parent; }
  get_height(): number { return this.height; }
  set_height(height: number): void { this.height = height; }
  get_xform(): unknown { return this.transform; }
  set_xform(transform: unknown): void { this.transform = transform; }
  get_mesh(): number { return this.mesh; }
  set_mesh(mesh: number): void { this.mesh = mesh; }
  get_camera(): number { return this.camera; }
  set_camera(camera: number): void { this.camera = camera; }
  get_skin(): number { return this.skin; }
  set_skin(skin: number): void { this.skin = skin; }
  get_skeleton(): number { return this.skeleton; }
  set_skeleton(skeleton: number): void { this.skeleton = skeleton; }
  get_position(): Readonly<{ x: number; y: number; z: number }> { return this.position; }
  set_position(position: Readonly<{ x: number; y: number; z: number }>): void { this.position = { ...position }; }
  get_rotation(): Readonly<{ x: number; y: number; z: number; w: number }> { return this.rotation; }
  set_rotation(rotation: Readonly<{ x: number; y: number; z: number; w: number }>): void { this.rotation = { ...rotation }; }
  get_scale(): Readonly<{ x: number; y: number; z: number }> { return this.scale; }
  set_scale(scale: Readonly<{ x: number; y: number; z: number }>): void { this.scale = { ...scale }; }
  get_children(): readonly number[] { return this.children; }
  set_children(children: readonly number[]): void { this.children = [...children]; }
  append_child_index(childIndex: number): void { this.children.push(childIndex); }
  get_light(): number { return this.light; }
  set_light(light: number): void { this.light = light; }
  get_visible(): boolean { return this.visible; }
  set_visible(visible: boolean): void { this.visible = visible; }
  get_additional_data(extensionName: string): unknown { return this.additionalData.get(extensionName) ?? null; }
  set_additional_data(extensionName: string, additionalData: unknown): void { this.additionalData.set(extensionName, additionalData); }

  get_scene_node_path(state: GodotGLTFState, handleSkeletons = true): string {
    const index = state.get_nodes().indexOf(this);
    if (index < 0) return '';
    const names: string[] = [];
    let cursor = index;
    const visited = new Set<number>();
    while (cursor >= 0 && !visited.has(cursor)) {
      visited.add(cursor);
      const node = state.get_nodes()[cursor];
      if (!(node instanceof GodotGLTFNode)) break;
      if (handleSkeletons || node.get_skeleton() < 0) names.unshift(node.get_original_name() || `Node${cursor}`);
      cursor = node.get_parent();
    }
    return names.join('/');
  }
}

export class GodotGLTFState {
  private json: Readonly<Record<string, unknown>> = {};
  private majorVersion = 2;
  private minorVersion = 0;
  private copyright = '';
  private glbData = new Uint8Array();
  private useNamedSkinBinds = false;
  private nodes: unknown[] = [];
  private buffers: Uint8Array[] = [];
  private bufferViews: unknown[] = [];
  private accessors: unknown[] = [];
  private meshes: unknown[] = [];
  private animationPlayers: unknown[] = [];
  private materials: unknown[] = [];
  private sceneName = '';
  private basePath = '';
  private filename = '';
  private rootNodes: number[] = [];
  private textures: unknown[] = [];
  private textureSamplers: unknown[] = [];
  private images: unknown[] = [];
  private skins: unknown[] = [];
  private cameras: unknown[] = [];
  private lights: unknown[] = [];
  private uniqueNames: string[] = [];
  private uniqueAnimationNames: string[] = [];
  private skeletons: unknown[] = [];
  private createAnimations = true;
  private importAsSkeletonBones = false;
  private animations: unknown[] = [];
  private handleBinaryImageMode = GODOT_GLTF_HANDLE_BINARY_EMBED_AS_UNCOMPRESSED;
  private bakeFPS = 30;
  private readonly usedExtensions = new Map<string, boolean>();
  private readonly sceneNodes = new Map<number, unknown>();
  private readonly nodeIndices = new Map<unknown, number>();
  private readonly additionalData = new Map<string, unknown>();

  add_used_extension(extensionName: string, required = false): void {
    this.usedExtensions.set(extensionName, required || this.usedExtensions.get(extensionName) === true);
  }

  append_data_to_buffers(data: Uint8Array | readonly number[], deduplication = false): number {
    const bytes = Uint8Array.from(data);
    if (deduplication) {
      const existing = this.buffers.findIndex((buffer) => buffer.length === bytes.length && buffer.every((byte, index) => byte === bytes[index]));
      if (existing >= 0) return existing;
    }
    this.buffers.push(bytes);
    return this.buffers.length - 1;
  }

  append_gltf_node(gltfNode: GodotGLTFNode, godotSceneNode: unknown, parentNodeIndex: number): number {
    gltfNode.set_parent(parentNodeIndex);
    const index = this.nodes.push(gltfNode) - 1;
    this.sceneNodes.set(index, godotSceneNode);
    this.nodeIndices.set(godotSceneNode, index);
    if (parentNodeIndex < 0) this.rootNodes.push(index);
    else (this.nodes[parentNodeIndex] as GodotGLTFNode | undefined)?.append_child_index(index);
    return index;
  }

  get_json(): Readonly<Record<string, unknown>> { return this.json; }
  set_json(json: Readonly<Record<string, unknown>>): void { this.json = json; }
  get_major_version(): number { return this.majorVersion; }
  set_major_version(version: number): void { this.majorVersion = version; }
  get_minor_version(): number { return this.minorVersion; }
  set_minor_version(version: number): void { this.minorVersion = version; }
  get_copyright(): string { return this.copyright; }
  set_copyright(copyright: string): void { this.copyright = copyright; }
  get_glb_data(): Uint8Array { return this.glbData; }
  set_glb_data(data: Uint8Array | readonly number[]): void { this.glbData = Uint8Array.from(data); }
  get_use_named_skin_binds(): boolean { return this.useNamedSkinBinds; }
  set_use_named_skin_binds(value: boolean): void { this.useNamedSkinBinds = value; }
  get_nodes(): unknown[] { return this.nodes; }
  set_nodes(value: unknown[]): void { this.nodes = value; }
  get_buffers(): Uint8Array[] { return this.buffers; }
  set_buffers(value: Uint8Array[]): void { this.buffers = value; }
  get_buffer_views(): unknown[] { return this.bufferViews; }
  set_buffer_views(value: unknown[]): void { this.bufferViews = value; }
  get_accessors(): unknown[] { return this.accessors; }
  set_accessors(value: unknown[]): void { this.accessors = value; }
  get_meshes(): unknown[] { return this.meshes; }
  set_meshes(value: unknown[]): void { this.meshes = value; }
  get_animation_players_count(): number { return this.animationPlayers.length; }
  get_animation_player(index: number): unknown { return this.animationPlayers[index] ?? null; }
  get_materials(): unknown[] { return this.materials; }
  set_materials(value: unknown[]): void { this.materials = value; }
  get_scene_name(): string { return this.sceneName; }
  set_scene_name(value: string): void { this.sceneName = value; }
  get_base_path(): string { return this.basePath; }
  set_base_path(value: string): void { this.basePath = value; }
  get_filename(): string { return this.filename; }
  set_filename(value: string): void { this.filename = value; }
  get_root_nodes(): number[] { return this.rootNodes; }
  set_root_nodes(value: number[]): void { this.rootNodes = value; }
  get_textures(): unknown[] { return this.textures; }
  set_textures(value: unknown[]): void { this.textures = value; }
  get_texture_samplers(): unknown[] { return this.textureSamplers; }
  set_texture_samplers(value: unknown[]): void { this.textureSamplers = value; }
  get_images(): unknown[] { return this.images; }
  set_images(value: unknown[]): void { this.images = value; }
  get_skins(): unknown[] { return this.skins; }
  set_skins(value: unknown[]): void { this.skins = value; }
  get_cameras(): unknown[] { return this.cameras; }
  set_cameras(value: unknown[]): void { this.cameras = value; }
  get_lights(): unknown[] { return this.lights; }
  set_lights(value: unknown[]): void { this.lights = value; }
  get_unique_names(): string[] { return this.uniqueNames; }
  set_unique_names(value: string[]): void { this.uniqueNames = value; }
  get_unique_animation_names(): string[] { return this.uniqueAnimationNames; }
  set_unique_animation_names(value: string[]): void { this.uniqueAnimationNames = value; }
  get_skeletons(): unknown[] { return this.skeletons; }
  set_skeletons(value: unknown[]): void { this.skeletons = value; }
  get_create_animations(): boolean { return this.createAnimations; }
  set_create_animations(value: boolean): void { this.createAnimations = value; }
  get_import_as_skeleton_bones(): boolean { return this.importAsSkeletonBones; }
  set_import_as_skeleton_bones(value: boolean): void { this.importAsSkeletonBones = value; }
  get_animations(): unknown[] { return this.animations; }
  set_animations(value: unknown[]): void { this.animations = value; }
  get_scene_node(index: number): unknown { return this.sceneNodes.get(index) ?? null; }
  get_node_index(sceneNode: unknown): number { return this.nodeIndices.get(sceneNode) ?? -1; }
  get_additional_data(extensionName: string): unknown { return this.additionalData.get(extensionName) ?? null; }
  set_additional_data(extensionName: string, data: unknown): void { this.additionalData.set(extensionName, data); }
  get_handle_binary_image_mode(): number { return this.handleBinaryImageMode; }
  set_handle_binary_image_mode(mode: number): void { this.handleBinaryImageMode = mode; }
  set_bake_fps(value: number): void { this.bakeFPS = value; }
  get_bake_fps(): number { return this.bakeFPS; }
  get_handle_binary_image(): number { return this.handleBinaryImageMode; }
  set_handle_binary_image(mode: number): void { this.handleBinaryImageMode = mode; }
}

export class GodotGLTFTexture {
  private sourceImage = -1;
  private sampler = -1;
  get_src_image(): number { return this.sourceImage; }
  set_src_image(sourceImage: number): void { this.sourceImage = sourceImage; }
  get_sampler(): number { return this.sampler; }
  set_sampler(sampler: number): void { this.sampler = sampler; }
}
export function createGodotGLTFState(): GodotGLTFState { return new GodotGLTFState(); }
export function createGodotGLTFNode(): GodotGLTFNode { return new GodotGLTFNode(); }
export function createGodotGLTFTexture(): GodotGLTFTexture { return new GodotGLTFTexture(); }
