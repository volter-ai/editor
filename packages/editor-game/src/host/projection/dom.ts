/**
 * THE PROJECTOR FOR THE DOM SURFACE — one walk, one index, one set of derived
 * views, for every authoring adapter that drives a live element tree
 * (ARCHITECTURE-CORE §The editor protocol, projection family).
 *
 * The projection unit is the RUNTIME ELEMENT. Nothing here reads source, an AST
 * or a document; a walk answers from the tree that is actually mounted, so an
 * empty projection over a mounted world is a defect rather than a fact.
 *
 * ## What this owns, and what it deliberately does not
 *
 * OWNS — the two things both DOM authoring classes used to spell separately:
 *
 *  - the walk itself ({@link walkDomGraph}), including the "root is not a node"
 *    rule and the fold-into-the-nearest-admitted-ancestor rule,
 *  - IDENTITY MINTING, parameterized by scheme ({@link structuralDomIdentity},
 *    {@link oidDomIdentity}) — the id FORMATS are the schemes', the walk that
 *    applies them is one.
 *
 * DOES NOT own the LANE-SPECIFIC hierarchy VIEW built on top. The first-party
 * React world adapter overlays portable-CSF / catalog rows on the OID
 * projection; the ingested React adapter does not. Both read this projection
 * and derive their rows from it.
 *
 * PICKING is not here either. DOM hit-testing is a geometric rect walk over
 * `getBoundingClientRect` (and must honor design-time `pointer-events`), which
 * is a derived view the adapters already share by transcription, not a
 * raycast the projector can own the way {@link ThreeProjector.pick} does.
 */

import type { ProjectedNode, Projection } from '@volter/editor-core/projection/types';

export type { ProjectedNode, Projection } from '@volter/editor-core/projection/types';

/**
 * The minimum shape a live DOM walk needs. Deliberately not `Element` so a
 * headless fixture (plain object, no jsdom) can project the same way a real
 * element does. A real `Element` satisfies this structurally.
 */
export interface DomWalkable {
  readonly tagName: string;
  readonly children: ArrayLike<DomWalkable>;
}

/** Extra surface a scheme needs when identity is an authored attribute. */
export interface OidWalkable extends DomWalkable {
  getAttribute(name: string): string | null;
}

/** One projected authoring node over a live DOM tree. */
export type DomNode<TEl extends DomWalkable = DomWalkable> = ProjectedNode<TEl>;

export interface DomWalkStats {
  readonly count: number;
}

export type DomProjection<TEl extends DomWalkable = DomWalkable> = Projection<TEl, DomWalkStats>;

export const EMPTY_DOM_WALK_STATS: DomWalkStats = { count: 0 };

/**
 * The IDENTITY seam — how a live element tree is addressed: which elements
 * are authoring nodes, what their ids are, and how they nest.
 *
 * An adapter never mints an id itself. It asks a scheme for a
 * {@link DomProjection} and drives every provider (hierarchy, selection,
 * inspector, picking) off that one walk.
 */
export interface DomIdentity<TEl extends DomWalkable = DomWalkable> {
  project(root: TEl): DomProjection<TEl>;
}

/** Where the walk currently is, for a scheme that mints from position. */
export interface DomWalkContext<TEl extends DomWalkable = DomWalkable> {
  /** The nearest ADMITTED ancestor's id — `null` ⇒ this element hangs under
   *  transparent wrappers only, so a node admitted here is a projection root. */
  readonly ownerId: string | null;
  /** Whether anything above already claims this subtree as its parts. */
  readonly ownedByAncestor: boolean;
  /** The element whose `.children` this visit came from — the walk root on
   *  the first level, an already-visited descendant after that. */
  readonly parent: TEl;
  /** Index in `siblings`. */
  readonly siblingIndex: number;
  /** The parent's element children, in tree order. */
  readonly siblings: readonly TEl[];
}

/** The per-lane half of a walk: what to skip, what to admit, what to call it. */
export interface DomIdentityScheme<TEl extends DomWalkable = DomWalkable> {
  begin?(): void;
  /** This element never enters the projection, WITH its descendants. */
  skip?(el: TEl): boolean;
  /** This element's id, or `null` when it is not an authoring node — in which
   *  case its children fold into the nearest admitted ancestor. */
  identify(el: TEl, context: DomWalkContext<TEl>): string | null;
  /** Visit this element's children? Defaults to yes. `false` is how an inline
   *  SVG stays one atomic node instead of exposing its `g`/`path` internals. */
  descend?(el: TEl): boolean;
  leave?(el: TEl, id: string | null): void;
}

const OID_ATTR = 'data-oid';

function tally<TEl extends DomWalkable>(nodes: ReadonlyMap<string, DomNode<TEl>>): DomWalkStats {
  return { count: nodes.size };
}

function isSvg(el: DomWalkable): boolean {
  return el.tagName.toLowerCase() === 'svg';
}

/**
 * THE WALK. One DFS over a live DOM root's ELEMENT children. The root itself
 * is never a node — its element children are the projection roots — matching
 * both DOM adapters' pre-extraction contract.
 *
 * Idempotent for every scheme that mints from the tree's own facts: re-walking
 * the same tree re-derives the same ids for the same elements.
 */
export function walkDomGraph<TEl extends DomWalkable>(
  root: TEl,
  scheme: DomIdentityScheme<TEl>,
): DomProjection<TEl> {
  const nodes = new Map<string, DomNode<TEl>>();
  const rootIds: string[] = [];
  scheme.begin?.();

  const visitChildren = (parent: TEl, ownerId: string | null, ownedByAncestor: boolean): void => {
    const siblings = Array.from(parent.children) as TEl[];
    siblings.forEach((el, siblingIndex) => {
      if (scheme.skip?.(el)) return;
      const id = scheme.identify(el, {
        ownerId,
        ownedByAncestor,
        parent,
        siblingIndex,
        siblings,
      });
      if (id !== null) {
        nodes.set(id, { object: el, id, parentId: ownerId, childIds: [] });
        if (ownerId === null) rootIds.push(id);
        else nodes.get(ownerId)?.childIds.push(id);
      }
      const nextOwner = id ?? ownerId;
      const nextOwned = ownedByAncestor || id !== null;
      if (scheme.descend?.(el) !== false) visitChildren(el, nextOwner, nextOwned);
      scheme.leave?.(el, id);
    });
  };

  visitChildren(root, null, false);
  return { nodes, rootIds, stats: tally(nodes) };
}

/**
 * The STRUCTURAL-PATH scheme. Deterministic from the tree's shape: each
 * segment is `<tag>[k]` where `k` is the element's index among preceding
 * SAME-TAG element siblings. Prefixed `rdom:`. This is the scheme for a
 * graph whose source was never stamped.
 */
export function structuralDomIdentity<TEl extends DomWalkable = DomWalkable>(): DomIdentity<TEl> {
  return {
    project: (root) => {
      const pathById = new Map<string, string>();
      return walkDomGraph(root, {
        begin: () => pathById.clear(),
        identify: (el, context) => {
          const tag = el.tagName.toLowerCase();
          let k = 0;
          for (let i = 0; i < context.siblingIndex; i++) {
            if (context.siblings[i]!.tagName.toLowerCase() === tag) k++;
          }
          const segment = `${tag}[${k}]`;
          const parentPath = context.ownerId ? (pathById.get(context.ownerId) ?? '') : '';
          const path = parentPath ? `${parentPath}/${segment}` : segment;
          const id = `rdom:${path}`;
          pathById.set(id, path);
          return id;
        },
        descend: (el) => !isSvg(el),
      });
    },
  };
}

/**
 * The OID scheme. A `data-oid`-stamped element is a node; an unstamped wrapper
 * is transparent and its children fold into the nearest stamped ancestor.
 * Repeats of the same oid (one JSX line rendered N times) keep the bare oid
 * on the first occurrence and suffix `#n` after that.
 */
export function oidDomIdentity<TEl extends OidWalkable = OidWalkable>(): DomIdentity<TEl> {
  return {
    project: (root) => {
      const occurrence = new Map<string, number>();
      return walkDomGraph(root, {
        begin: () => occurrence.clear(),
        identify: (el) => {
          const oid = el.getAttribute(OID_ATTR);
          if (!oid) return null;
          const n = occurrence.get(oid) ?? 0;
          occurrence.set(oid, n + 1);
          return n === 0 ? oid : `${oid}#${n}`;
        },
        descend: (el) => !isSvg(el),
      });
    },
  };
}

/** Walk a live DOM root under the structural-path scheme. */
export function projectStructuralDom<TEl extends DomWalkable>(root: TEl): DomProjection<TEl> {
  return structuralDomIdentity<TEl>().project(root);
}

/** Walk a live DOM root under the OID scheme. */
export function projectOidDom<TEl extends OidWalkable>(root: TEl): DomProjection<TEl> {
  return oidDomIdentity<TEl>().project(root);
}

/**
 * The projector: one identity scheme, the index its walk produces, and the
 * derived views every DOM authoring adapter reads instead of re-walking.
 */
export class DomProjector<TEl extends DomWalkable = DomWalkable> {
  private nodesById = new Map<string, DomNode<TEl>>();
  private objectsById = new Map<string, TEl>();
  private idsByObjectIndex = new Map<TEl, string>();
  private roots: string[] = [];
  private walkStats: DomWalkStats = EMPTY_DOM_WALK_STATS;

  constructor(private readonly identity: DomIdentity<TEl>) {}

  /**
   * (Re)walk. `null` is an honest "nothing is mounted" — the projection empties
   * rather than keeping a stale index, because a hierarchy over a torn-down
   * world is worse than no hierarchy.
   */
  project(root: TEl | null): DomWalkStats {
    if (!root) {
      this.nodesById = new Map();
      this.objectsById = new Map();
      this.idsByObjectIndex = new Map();
      this.roots = [];
      this.walkStats = EMPTY_DOM_WALK_STATS;
      return this.walkStats;
    }
    const { nodes, rootIds, stats } = this.identity.project(root);
    this.nodesById = nodes;
    this.objectsById = new Map([...nodes].map(([id, node]) => [id, node.object] as const));
    this.idsByObjectIndex = new Map([...nodes].map(([id, node]) => [node.object, id] as const));
    this.roots = rootIds;
    this.walkStats = stats;
    return stats;
  }

  get nodes(): ReadonlyMap<string, DomNode<TEl>> {
    return this.nodesById;
  }

  get objects(): ReadonlyMap<string, TEl> {
    return this.objectsById;
  }

  get idsByObject(): ReadonlyMap<TEl, string> {
    return this.idsByObjectIndex;
  }

  get rootIds(): readonly string[] {
    return this.roots;
  }

  get stats(): DomWalkStats {
    return this.walkStats;
  }

  node(id: string): DomNode<TEl> | null {
    return this.nodesById.get(id) ?? null;
  }

  rootNodes(): DomNode<TEl>[] {
    return this.roots
      .map((id) => this.nodesById.get(id))
      .filter((node): node is DomNode<TEl> => node !== undefined);
  }

  objectOf(id: string): TEl | null {
    return this.objectsById.get(id) ?? null;
  }

  idOf(el: TEl): string | null {
    return this.idsByObjectIndex.get(el) ?? null;
  }
}
