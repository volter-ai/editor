/** Godot Skin Resource bind table retained beside native Three Skeleton ownership. */
import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';
import type { Transform } from './variant-3d';

export interface GodotSkinBind {
  bone: number;
  name: string;
  pose: Transform;
}

export interface GodotSkin {
  readonly kind: 'Skin';
  add_bind(bone: number, pose: Transform): void;
  add_named_bind(name: string, pose: Transform): void;
  set_bind_count(count: number): void;
  get_bind_count(): number;
  set_bind_bone(index: number, bone: number): void;
  get_bind_bone(index: number): number;
  set_bind_name(index: number, name: string): void;
  get_bind_name(index: number): string;
  set_bind_pose(index: number, pose: Transform): void;
  get_bind_pose(index: number): Transform;
  clear_binds(): void;
  bindSnapshot(): readonly Readonly<GodotSkinBind>[];
}

const IDENTITY: Transform = {
  basis: [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
  ],
  origin: { x: 0, y: 0, z: 0 },
};

function copyPose(value: Transform): Transform {
  const [x, y, z] = value.basis;
  const parts = [x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z, value.origin.x, value.origin.y, value.origin.z];
  if (!parts.every(Number.isFinite)) throw new TypeError('Skin bind pose requires a finite Transform3D.');
  return {
    basis: [
      { x: x.x, y: x.y, z: x.z },
      { x: y.x, y: y.y, z: y.z },
      { x: z.x, y: z.y, z: z.z },
    ],
    origin: { x: value.origin.x, y: value.origin.y, z: value.origin.z },
  };
}

function indexOf(value: number, length: number, member: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value >= length) {
    throw new RangeError(`Skin.${member} bind index ${value} is outside [0, ${length - 1}].`);
  }
  return value;
}

function boneOf(value: number): number {
  if (!Number.isSafeInteger(value) || value < -1) throw new RangeError('Skin bind bone must be -1 or a non-negative integer.');
  return value;
}

function nameOf(value: string): string {
  if (typeof value !== 'string') throw new TypeError('Skin bind name requires StringName.');
  return value;
}

export function createGodotSkin(initial: readonly Readonly<GodotSkinBind>[] = []): GodotSkin {
  let binds = initial.map((bind) => ({ bone: boneOf(bind.bone), name: nameOf(bind.name), pose: copyPose(bind.pose) }));
  let skin!: GodotSkin;
  const changed = (): void => godotResourceEmitChanged(skin);
  skin = {
    kind: 'Skin',
    add_bind(bone, pose) { binds.push({ bone: boneOf(bone), name: '', pose: copyPose(pose) }); changed(); },
    add_named_bind(name, pose) { binds.push({ bone: -1, name: nameOf(name), pose: copyPose(pose) }); changed(); },
    set_bind_count(count) {
      if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Skin bind_count requires a non-negative integer.');
      if (count === binds.length) return;
      if (count < binds.length) binds.length = count;
      else while (binds.length < count) binds.push({ bone: -1, name: '', pose: copyPose(IDENTITY) });
      changed();
    },
    get_bind_count: () => binds.length,
    set_bind_bone(index, bone) { const bind = binds[indexOf(index, binds.length, 'set_bind_bone')]!; const next = boneOf(bone); if (bind.bone === next) return; bind.bone = next; changed(); },
    get_bind_bone(index) { return binds[indexOf(index, binds.length, 'get_bind_bone')]!.bone; },
    set_bind_name(index, name) { const bind = binds[indexOf(index, binds.length, 'set_bind_name')]!; const next = nameOf(name); if (bind.name === next) return; bind.name = next; changed(); },
    get_bind_name(index) { return binds[indexOf(index, binds.length, 'get_bind_name')]!.name; },
    set_bind_pose(index, pose) { binds[indexOf(index, binds.length, 'set_bind_pose')]!.pose = copyPose(pose); changed(); },
    get_bind_pose(index) { return copyPose(binds[indexOf(index, binds.length, 'get_bind_pose')]!.pose); },
    clear_binds() { if (binds.length === 0) return; binds = []; changed(); },
    bindSnapshot: () => binds.map((bind) => ({ bone: bind.bone, name: bind.name, pose: copyPose(bind.pose) })),
  };
  registerGodotObjectIdentity(skin, 'Skin');
  return bindGodotResourceProtocol(skin, {
    createDuplicate: (source) => createGodotSkin(source.bindSnapshot()),
  });
}
