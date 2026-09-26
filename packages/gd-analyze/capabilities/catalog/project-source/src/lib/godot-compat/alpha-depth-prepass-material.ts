import {
  Material,
  Mesh,
  MeshDepthMaterial,
  MeshDistanceMaterial,
  InstancedMesh,
  NoBlending,
  SkinnedMesh,
  type Object3D,
} from 'three';

/**
 * Godot 4.7's `depth_prepass_alpha` render mode submits one material to two renderer lists:
 * an opaque, depth-only pass (alpha >= 0.99 in Forward+) and the ordinary transparent colour
 * pass. Shadow depth uses the engine's separate 0.1 threshold. Three has no material flag for
 * that scheduling, so this owner-aware attachment supplies the second native Mesh while keeping
 * the authored material itself as the colour pass.
 */
const GODOT_FORWARD_PLUS_OPAQUE_PREPASS_THRESHOLD = 0.99;
const GODOT_SHADOW_ALPHA_THRESHOLD = 0.1;
const PREPASS_RENDER_ORDER = -1_000_000_000;

interface OwnerPrepassState {
  readonly owner: Mesh;
  readonly authoredCastShadow: boolean;
  readonly passes: Set<DepthPrepass>;
}

interface DepthPrepass {
  readonly mesh: Mesh;
  readonly colorDepthMaterial: Material;
  readonly renderMaterials: readonly Material[];
  readonly shadowDepthMaterial: MeshDepthMaterial;
  readonly shadowDistanceMaterial: MeshDistanceMaterial;
}

const OWNER_STATES = new WeakMap<Mesh, OwnerPrepassState>();
const DEPTH_PREPASS_MATERIALS = new WeakSet<Material>();

function requireMesh(value: Object3D, member: string): Mesh {
  if (!(value instanceof Mesh)) {
    throw new TypeError(`${member} requires a native Three Mesh material owner.`);
  }
  return value;
}

function syncDepthMaterial(target: Material, source: Material, threshold: number): void {
  const sourceMap: unknown = Reflect.get(source, 'map');
  const sourceAlphaMap: unknown = Reflect.get(source, 'alphaMap');
  const sourceDisplacementMap: unknown = Reflect.get(source, 'displacementMap');
  const changed = Reflect.get(target, 'map') !== sourceMap ||
    Reflect.get(target, 'alphaMap') !== sourceAlphaMap ||
    Reflect.get(target, 'displacementMap') !== sourceDisplacementMap ||
    target.side !== source.side || target.alphaTest !== threshold;
  Reflect.set(target, 'map', sourceMap);
  Reflect.set(target, 'alphaMap', sourceAlphaMap);
  Reflect.set(target, 'displacementMap', sourceDisplacementMap);
  Reflect.set(target, 'displacementScale', Reflect.get(source, 'displacementScale') ?? 1);
  Reflect.set(target, 'displacementBias', Reflect.get(source, 'displacementBias') ?? 0);
  target.side = source.side;
  target.shadowSide = source.shadowSide;
  target.alphaTest = threshold;
  target.depthTest = source.depthTest;
  target.depthFunc = source.depthFunc;
  target.depthWrite = true;
  target.colorWrite = false;
  target.transparent = false;
  target.blending = NoBlending;
  target.clippingPlanes = source.clippingPlanes;
  target.clipIntersection = source.clipIntersection;
  target.clipShadows = source.clipShadows;
  target.polygonOffset = source.polygonOffset;
  target.polygonOffsetFactor = source.polygonOffsetFactor;
  target.polygonOffsetUnits = source.polygonOffsetUnits;
  if (changed) target.needsUpdate = true;
}

interface DepthPassMaterialAttachment {
  readonly attachment: Material | Material[];
  readonly owned: readonly Material[];
}

function materialArrayForSurface(material: Material, surface: number | undefined): DepthPassMaterialAttachment {
  if (surface === undefined) return { attachment: material, owned: [material] };
  const skipped = new Material();
  skipped.visible = false;
  const materials = Array.from({ length: surface + 1 }, () => skipped);
  materials[surface] = material;
  return { attachment: materials, owned: [material, skipped] };
}

function createDepthPass(owner: Mesh, source: Material, surface: number | undefined): DepthPrepass {
  const depth = source.clone();
  syncDepthMaterial(depth, source, GODOT_FORWARD_PLUS_OPAQUE_PREPASS_THRESHOLD);
  const shadow = new MeshDepthMaterial();
  const pointShadow = new MeshDistanceMaterial();
  syncDepthMaterial(shadow, source, GODOT_SHADOW_ALPHA_THRESHOLD);
  syncDepthMaterial(pointShadow, source, GODOT_SHADOW_ALPHA_THRESHOLD);
  const passMaterial = materialArrayForSurface(depth, surface);

  // Clone the native mesh kind so skinning, morph-target and instancing state stay on Three's
  // own implementations. The pass is then parented under its owner at identity, giving it the
  // owner's exact world transform without copying authored scene hierarchy.
  const pass = owner instanceof InstancedMesh
    ? new InstancedMesh(owner.geometry, passMaterial.attachment, owner.count)
    : owner instanceof SkinnedMesh
      ? new SkinnedMesh(owner.geometry, passMaterial.attachment)
      : new Mesh(owner.geometry, passMaterial.attachment);
  if (owner instanceof InstancedMesh && pass instanceof InstancedMesh) {
    pass.instanceMatrix = owner.instanceMatrix;
    pass.instanceColor = owner.instanceColor;
    pass.morphTexture = owner.morphTexture;
  }
  if (owner instanceof SkinnedMesh && pass instanceof SkinnedMesh) {
    pass.bindMode = owner.bindMode;
    pass.bind(owner.skeleton, owner.bindMatrix);
    pass.bindMatrixInverse.copy(owner.bindMatrixInverse);
  }
  pass.name = '__godot_alpha_depth_prepass';
  pass.position.set(0, 0, 0);
  pass.quaternion.identity();
  pass.scale.set(1, 1, 1);
  pass.matrix.identity();
  pass.matrixWorld.identity();
  pass.matrixAutoUpdate = true;
  pass.customDepthMaterial = shadow;
  pass.customDistanceMaterial = pointShadow;
  pass.castShadow = false;
  pass.receiveShadow = false;
  pass.renderOrder = PREPASS_RENDER_ORDER + owner.renderOrder;
  pass.raycast = () => undefined;
  pass.onBeforeRender = () => {
    pass.geometry = owner.geometry;
    pass.layers.mask = owner.layers.mask;
    pass.visible = owner.visible;
    pass.renderOrder = PREPASS_RENDER_ORDER + owner.renderOrder;
    const ownerMorphs = owner.morphTargetInfluences;
    if (ownerMorphs !== undefined && pass.morphTargetInfluences !== undefined) {
      pass.morphTargetInfluences.splice(0, pass.morphTargetInfluences.length, ...ownerMorphs);
    }
    syncDepthMaterial(depth, source, GODOT_FORWARD_PLUS_OPAQUE_PREPASS_THRESHOLD);
    syncDepthMaterial(shadow, source, GODOT_SHADOW_ALPHA_THRESHOLD);
    syncDepthMaterial(pointShadow, source, GODOT_SHADOW_ALPHA_THRESHOLD);
  };
  owner.add(pass);
  return {
    mesh: pass,
    colorDepthMaterial: depth,
    renderMaterials: passMaterial.owned,
    shadowDepthMaterial: shadow,
    shadowDistanceMaterial: pointShadow,
  };
}

function ownerState(owner: Mesh): OwnerPrepassState {
  let state = OWNER_STATES.get(owner);
  if (state !== undefined) return state;
  state = { owner, authoredCastShadow: owner.castShadow, passes: new Set() };
  OWNER_STATES.set(owner, state);
  return state;
}

function releaseDepthPass(state: OwnerPrepassState, prepass: DepthPrepass): void {
  state.passes.delete(prepass);
  state.owner.remove(prepass.mesh);
  for (const material of prepass.renderMaterials) material.dispose();
  prepass.shadowDepthMaterial.dispose();
  prepass.shadowDistanceMaterial.dispose();
  if (state.passes.size === 0) {
    state.owner.castShadow = state.authoredCastShadow;
    OWNER_STATES.delete(state.owner);
  }
}

/** Mark a retained StandardMaterial3D Resource as mode 4 for owner-side material assignment. */
export function setGodotAlphaDepthPrepassMaterial(material: Material, enabled: boolean): void {
  if (enabled) {
    DEPTH_PREPASS_MATERIALS.add(material);
    material.transparent = true;
    material.depthWrite = false;
  } else {
    DEPTH_PREPASS_MATERIALS.delete(material);
  }
  material.needsUpdate = true;
}

export function isGodotAlphaDepthPrepassMaterial(material: Material): boolean {
  return DEPTH_PREPASS_MATERIALS.has(material);
}

/** Bind one authored material slot to Godot's depth-prepass scheduling on its native Mesh owner. */
export function bindGodotAlphaDepthPrepassMaterial(
  ownerValue: Object3D,
  material: Material,
  surface?: number,
): () => void {
  const owner = requireMesh(ownerValue, 'BaseMaterial3D transparency mode 4');
  if (surface !== undefined && (!Number.isInteger(surface) || surface < 0)) {
    throw new RangeError(`BaseMaterial3D depth-prepass surface must be a non-negative integer; got ${surface}.`);
  }
  setGodotAlphaDepthPrepassMaterial(material, true);
  const state = ownerState(owner);
  const prepass = createDepthPass(owner, material, surface);
  state.passes.add(prepass);
  if (state.authoredCastShadow) {
    owner.castShadow = false;
    prepass.mesh.castShadow = true;
  }
  return () => releaseDepthPass(state, prepass);
}

/**
 * R3F custom attachment for an inline translated material. A function attachment receives both
 * the Mesh owner and material object, so compat owns the extra native passes and translation only
 * declares which authored surface selected mode 4.
 */
export function godotAlphaDepthPrepassMaterialAttach(surface?: number) {
  return (ownerValue: Object3D, material: Material): (() => void) => {
    const owner = requireMesh(ownerValue, 'BaseMaterial3D transparency mode 4 attachment');
    let restore: () => void;
    if (surface === undefined) {
      const previous = owner.material;
      owner.material = material;
      restore = () => { owner.material = previous; };
    } else {
      let materials: Material[];
      if (Array.isArray(owner.material)) materials = owner.material;
      else {
        materials = [];
        owner.material = materials;
      }
      const previous = materials[surface];
      materials[surface] = material;
      restore = () => {
        if (previous === undefined) delete materials[surface];
        else materials[surface] = previous;
      };
    }
    const release = bindGodotAlphaDepthPrepassMaterial(owner, material, surface);
    return () => {
      release();
      restore();
    };
  };
}
