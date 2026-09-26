/** The retained Godot Object a native Rapier body collider belongs to. */
export type GodotColliderOwner = object;

/** One registry keyed only by the actual collider identity returned by Rapier. */
export type GodotColliderRegistry<
  TCollider extends object,
  TOwner extends object = GodotColliderOwner,
> = Map<TCollider, TOwner>;

/** Minimal read seam for physics queries that never mutate registry ownership. */
export interface GodotColliderLookup<TCollider extends object, TOwner extends object> {
  get(collider: TCollider): TOwner | undefined;
  [Symbol.iterator](): MapIterator<[TCollider, TOwner]>;
}

/** Minimal ownership seam for collider factories; native Map remains the concrete owner. */
export interface GodotMutableColliderRegistry<
  TCollider extends object,
  TOwner extends object,
> extends GodotColliderLookup<TCollider, TOwner> {
  set(collider: TCollider, owner: TOwner): unknown;
  delete(collider: TCollider): boolean;
}

/** Native Area sensor ownership shared by the 2D and 3D translated surfaces. */
export interface GodotAreaColliderOwner<TNode extends object = object> {
  readonly area?: object;
  readonly scene?: object;
  readonly node?: TNode;
}

export type GodotAreaColliderRegistry<
  TCollider extends object,
  TNode extends object = object,
> = Map<TCollider, GodotAreaColliderOwner<TNode>>;
