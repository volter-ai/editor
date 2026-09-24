/**
 * ONE undo entry per STRUCTURAL op on a live canvas tree — the bracket
 * `PixiAuthoringAdapter.structure` wraps every create/remove/duplicate/
 * reparent/reorder in.
 *
 * It is the SAME history path a transform edit already takes (a
 * {@link JsonHistoryResource} registered against `store.projectHistory`), not a
 * second one: what differs is the STATE SHAPE, and that is why it is a resource
 * of its own rather than a field bolted onto the write target's. The write
 * target journals a node's VALUES (label, alpha, tint, transform) keyed by the
 * adapter's structural-path id; a structural op changes what those ids even
 * ARE, so a value snapshot cannot describe it. This resource journals
 * PLACEMENTS instead — "which parent, at which index, in which local pose" —
 * keyed by a uid stamped on the display object itself, which survives the
 * re-walk that renames every id.
 *
 * WHY A UID AND A REGISTRY. A removed object must be resurrectable, so it is
 * kept alive here (detached, never `destroy()`ed) and found again by uid; a
 * JSON snapshot cannot hold a `Container` reference. The registry is the ONLY
 * thing that makes undo-of-remove possible at all.
 *
 * IT IS DELIBERATELY EDIT-SCOPED. Only objects an editor op touched (plus the
 * ancestors those ops named) are tracked, so a restore never reorders the
 * thousands of sprites a RUNNING game adds and removes on its own every frame.
 * For the same reason `conflictIdentity` narrows to the parent map: a game that
 * appended one sprite of its own since the transaction was recorded has shifted
 * every index without touching anything the editor authored, and hashing those
 * indexes would make every undo fail preflight as a content-conflict — the
 * failure the three lane paid for as #81.
 */

import type { Container } from 'pixi.js';
import { editorConsole } from '@volter/editor-core/editor-console';
import type { EditorShellStore } from '@volter/editor-core/editor-shell-store';
import { type JournalSubject, JsonHistoryResource } from '../history/json-history-resource';

/** The stage root's stand-in uid: it is not one of the adapter's nodes, but it
 *  is a legal parent for every op. */
const ROOT_UID = '#root';

/** The uid stamp, on the display object itself — the same technique
 *  `AuthoringAdapter2D` uses for `__authId`, for the same reason (there is no
 *  side table that survives the object outliving one walk). */
interface StructureStamped {
  __vgaiStructUid?: string;
}

/** A node's own local pose, as plain numbers. Recorded because `reparent`
 *  rewrites it to preserve the world transform — undoing the move without
 *  undoing that rewrite would leave the node in the right parent at the wrong
 *  place. */
interface CanvasNodePose {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  pivotX: number;
  pivotY: number;
  skewX: number;
  skewY: number;
}

interface CanvasPlacement {
  /** The parent's uid, {@link ROOT_UID} for the stage root, or `null` when the
   *  node is detached (removed, or not yet added). */
  parent: string | null;
  /** Index among that parent's children; `-1` while detached. */
  index: number;
  pose?: CanvasNodePose;
}

export interface CanvasStructureState {
  placements: Record<string, CanvasPlacement>;
}

function poseOf(object: Container): CanvasNodePose | undefined {
  // A tracked node is not guaranteed to be a real PixiJS display object (the
  // same tolerance `getTransform` and the structure watcher already carry).
  if (!object.position || !object.scale || !object.pivot || !object.skew) return undefined;
  return {
    x: object.position.x,
    y: object.position.y,
    rotation: object.rotation,
    scaleX: object.scale.x,
    scaleY: object.scale.y,
    pivotX: object.pivot.x,
    pivotY: object.pivot.y,
    skewX: object.skew.x,
    skewY: object.skew.y,
  };
}

function applyPose(object: Container, pose: CanvasNodePose): void {
  if (!object.position || !object.scale || !object.pivot || !object.skew) return;
  object.position.set(pose.x, pose.y);
  object.scale.set(pose.scaleX, pose.scaleY);
  object.pivot.set(pose.pivotX, pose.pivotY);
  object.skew.set(pose.skewX, pose.skewY);
  object.rotation = pose.rotation;
}

export class CanvasStructureHistory {
  private readonly byUid = new Map<string, Container>();
  private readonly resource: JsonHistoryResource<CanvasStructureState> | null;

  constructor(
    private readonly root: Container,
    store: EditorShellStore,
    /** Whose journal this structure stack belongs to — the world's for a held
     *  surface, the run's for play (`history/json-history-resource.ts`). */
    journal: JournalSubject,
    /** Re-index + notify after a restore put objects back. */
    private readonly onRestored: () => void,
  ) {
    const history = store.projectHistory;
    this.resource = history
      ? new JsonHistoryResource<CanvasStructureState>({
          history,
          kind: 'session-state',
          scope: 'session',
          subject: { ...journal, id: `${journal.id}/world-2d-structure` },
          displayName: 'World 2D structure',
          capture: () => this.capture(),
          conflictIdentity: (state) =>
            Object.fromEntries(
              Object.entries(state.placements).map(([uid, placement]) => [uid, placement.parent]),
            ),
          restore: async (state) => {
            this.restore(state);
          },
        })
      : null;
  }

  /** Register a display object so its placement is journaled and so a detached
   *  one can be found again. Idempotent; returns the uid. */
  track(object: Container): string {
    return this.uidOf(object);
  }

  /**
   * Run ONE structural mutation as ONE undo entry.
   *
   * Every participant must be {@link track}ed BEFORE the call — including a
   * node that does not exist in the tree yet, whose "before" placement is
   * therefore `detached`, which is exactly what makes undo-of-create remove it.
   */
  run<T>(label: string, mutate: () => T): T {
    this.resource?.assertCanMutate();
    const before = this.capture();
    const result = mutate();
    if (this.resource) {
      // JOURNALED LOUDLY. A rejected `record(...)` means the op IS applied to
      // the live tree and has NO history entry: the user sees the node they
      // created/moved/deleted and Ctrl+Z does nothing, with nothing said. Same
      // statement (and same wording) as the three lane's `recordHistory`
      // (`three-authoring-adapter.ts`).
      //
      // WHY THE REPORT IS HERE AND NOT IN THE VERB'S ACK. Every structural verb
      // funnels through this method, and two of them — `structure.create` and
      // `structure.duplicate` — return a synchronous node id by contract, so no
      // caller can await this write. One report at the funnel is the only place
      // that covers all of them identically; the pipe's ack answers a different
      // question (where the BYTES went — nowhere, for this lane) and cannot
      // carry a journaling failure without claiming it was a persistence one.
      void this.resource.record(label, before, this.capture()).catch((error: unknown) => {
        editorConsole.error(
          `[canvas] failed to journal "${label}" into project history — the structural edit is ` +
            `applied but has no history entry (it cannot be undone): ${
              error instanceof Error ? error.message : String(error)
            }`,
          'authoring',
        );
      });
    }
    return result;
  }

  dispose(): void {
    this.resource?.dispose();
    this.byUid.clear();
  }

  private uidOf(object: Container): string {
    if (object === this.root) return ROOT_UID;
    const stamped = object as Container & StructureStamped;
    const existing = stamped.__vgaiStructUid;
    if (existing && this.byUid.get(existing) === object) return existing;
    const uid = existing ?? `s${crypto.randomUUID()}`;
    stamped.__vgaiStructUid = uid;
    this.byUid.set(uid, object);
    return uid;
  }

  private capture(): CanvasStructureState {
    const placements: Record<string, CanvasPlacement> = {};
    // `uidOf` may register an ancestor mid-iteration; a Map iterator visits
    // entries added during the walk, so those ancestors get placements of their
    // own — bounded by the depth of the tree, and what makes a restore able to
    // name the parent it is putting a node back under.
    for (const [uid, object] of this.byUid) {
      const parent = (object.parent as Container | null) ?? null;
      const pose = poseOf(object);
      placements[uid] = {
        parent: parent ? this.uidOf(parent) : null,
        index: parent ? (parent.children?.indexOf(object) ?? -1) : -1,
        ...(pose ? { pose } : {}),
      };
    }
    return { placements };
  }

  private restore(state: CanvasStructureState): void {
    const entries = Object.entries(state.placements);
    // Detach first, so the indexes the attach pass reads are the ones the
    // snapshot was taken against.
    for (const [uid, placement] of entries) {
      if (placement.parent !== null) continue;
      const object = this.byUid.get(uid);
      object?.parent?.removeChild(object);
    }
    for (const [uid, placement] of entries
      .filter(([, placement]) => placement.parent !== null)
      .sort((a, b) => a[1].index - b[1].index)) {
      const object = this.byUid.get(uid);
      if (!object) continue;
      const parent =
        placement.parent === ROOT_UID ? this.root : this.byUid.get(placement.parent as string);
      if (!parent || typeof parent.addChildAt !== 'function') continue;
      const capacity = parent.children.length - (object.parent === parent ? 1 : 0);
      parent.addChildAt(object, Math.max(0, Math.min(placement.index, capacity)));
      if (placement.pose) applyPose(object, placement.pose);
    }
    this.onRestored();
  }
}
