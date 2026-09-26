/** Godot ResourceUID singleton object over the retained resource registry. */

import { registerGodotObjectIdentity } from './object';
import {
  resourceUidAddId,
  resourceUidCreateId,
  resourceUidEnsurePath,
  resourceUidGetIdPath,
  resourceUidGetPathId,
  resourceUidHasId,
  resourceUidIdToText,
  resourceUidPathToUid,
  resourceUidRemoveId,
  resourceUidSetId,
  resourceUidTextToId,
  resourceUidUidToPath,
} from './resource-io';

export class GodotResourceUID {
  constructor() { registerGodotObjectIdentity(this, 'ResourceUID'); }
  id_to_text(id: number | bigint): string { return resourceUidIdToText(id); }
  text_to_id(textId: string): bigint { return resourceUidTextToId(textId); }
  create_id(): bigint { return resourceUidCreateId(); }
  create_id_for_path(path: string): bigint {
    const existing = resourceUidGetPathId(path);
    if (existing >= 0n) return existing;
    const id = resourceUidCreateId();
    resourceUidAddId(id, path);
    return id;
  }
  has_id(id: number | bigint): boolean { return resourceUidHasId(id); }
  add_id(id: number | bigint, path: string): void { resourceUidAddId(id, path); }
  set_id(id: number | bigint, path: string): void { resourceUidSetId(id, path); }
  get_id_path(id: number | bigint): string { return resourceUidGetIdPath(id); }
  remove_id(id: number | bigint): void { resourceUidRemoveId(id); }
  uid_to_path(uid: string): string { return resourceUidUidToPath(uid); }
  path_to_uid(path: string): string { return resourceUidPathToUid(path); }
  ensure_path(pathOrUid: string): string { return resourceUidEnsurePath(pathOrUid); }
}

export function createGodotResourceUID(): GodotResourceUID { return new GodotResourceUID(); }
export const ResourceUID = new GodotResourceUID();
