/**
 * THE PROJECTOR FOR THE CANVAS SURFACE — one live display-tree walk, one
 * identity index, and the picking/bounds views derived from it.
 *
 * `AuthoringAdapter2D` remains the Pixi truth backend: it applies transforms,
 * reflected properties, and session overlays. This class owns the PROJECTION
 * currency that every canvas authoring view reads. The split is deliberate:
 * the projector answers what exists and where it is; a write target answers
 * where an edit lands.
 */

import type { AuthoringAdapter2D, EditorNode2D } from '../../runtime/pixi/authoring';
import type { DOMRectLike, FrameCorners } from '@volter/editor-project/adapter';
import type { Container, PointData } from 'pixi.js';
import type { ProjectedNode, Projection } from '@volter/editor-sdk/kit/projection-types';

export type PixiNode = ProjectedNode<Container>;

export interface PixiWalkStats {
  readonly count: number;
  readonly sprites: number;
}

export type PixiProjection = Projection<Container, PixiWalkStats>;

export const EMPTY_PIXI_WALK_STATS: PixiWalkStats = { count: 0, sprites: 0 };

export interface PixiSurfaceMapping {
  readonly surface: () => HTMLElement | null;
  readonly pointFromClient?: (clientX: number, clientY: number, rect: DOMRect) => PointData | null;
}

/**
 * Project a live Pixi stage through the identity scheme held by
 * {@link AuthoringAdapter2D}. The backend is injected so projection and truth
 * share the exact same object index; neither side can mint a second id.
 */
export class PixiProjector {
  private current: PixiProjection = {
    nodes: new Map(),
    rootIds: [],
    stats: EMPTY_PIXI_WALK_STATS,
  };

  /** True while {@link current} may be reused instead of re-walked. Closed at
   *  the next microtask checkpoint by {@link scheduleWindowClose}. */
  private projectionFresh = false;

  constructor(
    private readonly root: Container,
    private readonly index: AuthoringAdapter2D,
    private readonly mapping?: PixiSurfaceMapping,
    /** Injected by the unit test that drives the coalescing window by hand;
     *  the editor always uses the microtask checkpoint. */
    private readonly scheduleWindowClose: (close: () => void) => void = (close) =>
      queueMicrotask(close),
  ) {
    this.refresh();
  }

  /** Rewalk identity and reapply the truth backend's saved overlay. */
  refresh(): PixiWalkStats {
    const stats = this.index.refresh();
    this.current = this.readProjection(stats);
    this.openProjectionWindow();
    return stats;
  }

  /**
   * Rewalk identity only, then publish one immutable projection snapshot —
   * AT MOST ONCE PER SYNCHRONOUS TURN.
   *
   * The read is still the refresh point: a world that commits nodes after the
   * adapter was handed its root is still picked up on the next read, because
   * the window this coalesces over closes at the next microtask checkpoint.
   * What it removes is the RE-walk inside one derivation — measured
   * 2026-08-20 on a 1822-node canvas world, one projection is 70ms and a
   * single coverage/status pass asked for eight of them, because every
   * `hierarchy.roots()`, every `pickable.candidates()` and every composite
   * group-node read projects again.
   *
   * The window is only sound while nothing moves the display list behind it.
   * Two kinds of mover exist and BOTH have a door: this adapter's own write
   * paths call {@link reproject}, and the GAME — a world that commits its own
   * nodes when an atlas or a resource load resolves — is caught by the owner's
   * `childAdded`/`childRemoved` watcher, which calls {@link invalidate} the
   * synchronous instant pixi fires. Without that second door a read landing in
   * the same turn as the game's own commit answers from the stale walk, which
   * is exactly the late-commit defect the watcher exists to prevent.
   */
  project(): PixiProjection {
    if (this.projectionFresh) return this.current;
    return this.reproject();
  }

  /** Project unconditionally — the write paths' door, for a caller that has
   *  just mutated the display list and must not read its own stale window. */
  reproject(): PixiProjection {
    const stats = this.index.reindex();
    this.current = this.readProjection(stats);
    this.openProjectionWindow();
    return this.current;
  }

  /**
   * Close the coalescing window WITHOUT walking — the door for a mutation this
   * projector cannot see coming (the game's own commit, reported by its
   * owner's display-list watcher). The next read re-walks; a burst of commits
   * with no read between them still costs one walk, so the measured win of the
   * window survives intact.
   */
  invalidate(): void {
    this.projectionFresh = false;
  }

  /** Hold this projection for the rest of the current synchronous turn. */
  private openProjectionWindow(): void {
    if (this.projectionFresh) return;
    this.projectionFresh = true;
    this.scheduleWindowClose(() => {
      this.projectionFresh = false;
    });
  }

  projection(): PixiProjection {
    return this.current;
  }

  /**
   * The live container for `id`, or null.
   *
   * A DESTROYED container is not a live object. A survivor-style game destroys
   * entities every frame and this map is only refreshed by the next walk, so
   * between a destroy and that walk every consumer here would be handed a
   * husk whose `children`, `effects`, `pivot` and `anchor` are nulled — and
   * Pixi's own recursive bounds walk plus the editor's origin read both crash
   * on it mid-React-render (`Cannot read properties of null` reading 'length'
   * then 'x'; runhuman passes 115 and 119, two call sites of the same husk).
   * Answering null here is what stops the next reader from being the third.
   */
  object(id: string): Container | null {
    const object = this.current.nodes.get(id)?.object ?? null;
    return object === null || object.destroyed ? null : object;
  }

  node(id: string): EditorNode2D | null {
    const projected = this.current.nodes.get(id);
    if (!projected) return null;
    const native = this.index.node(id);
    if (!native) return null;
    return {
      ...native,
      parentId: projected.parentId,
      childIds: [...projected.childIds],
    };
  }

  roots(): EditorNode2D[] {
    return this.current.rootIds
      .map((id) => this.node(id))
      .filter((node): node is EditorNode2D => node !== null);
  }

  pick(clientX: number, clientY: number, excluded: (id: string) => boolean): string | null {
    return this.candidates(clientX, clientY, excluded)[0] ?? null;
  }

  candidates(clientX: number, clientY: number, excluded: (id: string) => boolean): string[] {
    const point = this.pointFromClient(clientX, clientY);
    if (!point) return [];
    this.project();
    return this.hitIds(point, excluded);
  }

  private pointFromClient(clientX: number, clientY: number): PointData | null {
    const surface = this.mapping?.surface() ?? null;
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const mapped = this.mapping?.pointFromClient?.(clientX, clientY, rect) ?? null;
    if (this.mapping?.pointFromClient) return mapped;
    const logicalWidth = Number(surface.dataset?.['vgaiStageWidth'] ?? rect.width);
    const logicalHeight = Number(surface.dataset?.['vgaiStageHeight'] ?? rect.height);
    if (!(logicalWidth > 0) || !(logicalHeight > 0)) return null;
    return {
      x: (clientX - rect.left) * (logicalWidth / rect.width),
      y: (clientY - rect.top) * (logicalHeight / rect.height),
    };
  }

  private hitIds(point: PointData, excluded: (id: string) => boolean): string[] {
    const visual: Container[] = [];
    const hitAreas: Container[] = [];
    this.collectHits(this.root, point, 'visual', visual);
    this.collectHits(this.root, point, 'hitArea', hitAreas);

    const ids: string[] = [];
    const seen = new Set<string>();
    for (const object of [...visual, ...hitAreas]) {
      const id = (object as Container & { __authId?: string }).__authId;
      if (id && !excluded(id) && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    return ids;
  }

  rect(id: string): DOMRectLike | null {
    const object = this.object(id);
    if (!object || typeof object.getBounds !== 'function') return null;
    const bounds = object.getBounds();
    if (!(bounds.width > 0) || !(bounds.height > 0)) return null;
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  }

  /** The node's local bounds carried by its global transform — its turned box's corners. */
  frame(id: string): FrameCorners | null {
    const object = this.object(id) as
      | (Container & { getLocalBounds?: () => { x: number; y: number; width: number; height: number } })
      | null;
    if (!object || typeof object.getLocalBounds !== 'function') return null;
    const local = object.getLocalBounds();
    if (!(local.width > 0) || !(local.height > 0)) return null;
    // `toGlobal` brings the transform up to date itself, as `getBounds` does; the cached
    // `worldTransform` is only as fresh as the last render, and an Edit surface renders on demand.
    const at = (x: number, y: number) => {
      const point = object.toGlobal({ x, y });
      return { x: point.x, y: point.y };
    };
    return {
      tl: at(local.x, local.y),
      tr: at(local.x + local.width, local.y),
      br: at(local.x + local.width, local.y + local.height),
      bl: at(local.x, local.y + local.height),
    };
  }

  contextRects(id: string): { parent?: DOMRectLike; siblings: DOMRectLike[] } {
    const node = this.node(id);
    if (!node) return { siblings: [] };
    const siblingIds = node.parentId
      ? (this.node(node.parentId)?.childIds ?? [])
      : this.current.rootIds;
    const parent = node.parentId ? this.rect(node.parentId) : null;
    return {
      ...(parent ? { parent } : {}),
      siblings: siblingIds
        .filter((siblingId) => siblingId !== id)
        .map((siblingId) => this.rect(siblingId))
        .filter((rect): rect is DOMRectLike => rect !== null),
    };
  }

  private readProjection(stats: PixiWalkStats): PixiProjection {
    const nodes = new Map<string, PixiNode>();
    const rootIds: string[] = [];
    const visit = (native: EditorNode2D): void => {
      const object = this.index.displayObject(native.id);
      if (!object) return;
      const node: PixiNode = {
        object,
        id: native.id,
        parentId: native.parentId,
        childIds: [...native.childIds],
      };
      nodes.set(native.id, node);
      for (const childId of native.childIds) {
        const child = this.index.node(childId);
        if (child) visit(child);
      }
    };
    for (const root of this.index.roots()) {
      rootIds.push(root.id);
      visit(root);
    }
    return { nodes, rootIds, stats };
  }

  /** Pixi paint order, frontmost first; rendered geometry precedes hit areas. */
  private collectHits(
    parent: Container,
    point: PointData,
    mode: 'visual' | 'hitArea',
    hits: Container[],
  ): void {
    const children = parent.children ?? [];
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index] as Container;
      if (!child.visible || !child.renderable) continue;
      child.updateLocalTransform();
      const local: PointData = { x: 0, y: 0 };
      child.localTransform.applyInverse(point, local);
      this.collectHits(child, local, mode, hits);
      if (this.contains(child, local, mode)) hits.push(child);
    }
  }

  private contains(object: Container, local: PointData, mode: 'visual' | 'hitArea'): boolean {
    if (!(object as Container & { __authId?: string }).__authId) return false;
    const shaped = object as Container & {
      hitArea?: { contains(x: number, y: number): boolean } | null;
      containsPoint?: (point: PointData) => boolean;
    };
    if (mode === 'hitArea') {
      return shaped.hitArea ? shaped.hitArea.contains(local.x, local.y) : false;
    }
    return typeof shaped.containsPoint === 'function' ? shaped.containsPoint(local) : false;
  }
}
