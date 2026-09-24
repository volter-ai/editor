/**
 * The LIVE half of the canvas surface's persistence axis
 * ({@link CanvasWriteTarget}) — a display tree the editor did not author the
 * JSX of, driven through the running `PIXI.Container`s themselves.
 *
 * WHERE A CLOSED GESTURE GOES IS A PARAMETER, not a property of this file.
 * Constructed with no {@link LiveCanvasWriteTargetOptions.persistence} backend
 * it is exactly what it always was: edits apply to the running tree (and,
 * where a body owns the transform, through the freeze→commit→unfreeze physics
 * handshake) and are journaled for UNDO within the session, never saved.
 * Constructed WITH one — which is what
 * `createCreationSiteCanvasWriteTarget` hands it — a closed gesture is offered
 * to the game's OWN SOURCE first, at the line that constructed the object, and
 * only falls back to the session journal when the backend refuses, with the
 * refusal's own reason reported. That is the same seam the three lane uses
 * (`source-persistence-backend.ts`), not a second one: the ingest-authoring
 * model's "every edit edits the game's own CODE or DATA" is one rule, and it
 * would not survive two implementations.
 *
 * A REFUSAL IS PER-EDIT AND CARRIES ITS REASON. Nothing here decides whether a
 * write is possible — `creation-site-edit.ts` decides it on the server against
 * the game's real bytes — and nothing here retries with looser rules or writes
 * anywhere else. The sentence the backend returns is what
 * `transformEditability` shows before the gesture and what the console reports
 * after it.
 *
 * Extracted verbatim from the class this replaces: it was a SECOND canvas
 * adapter keyed on provenance, which ARCHITECTURE-CORE §Rules names the
 * forbidden shape. Its live behaviour is unchanged; only its place in the seam
 * moved, and the persistence parameter is what this unit added.
 */

import type {
  AuthoringAdapter2D,
  Overlay2D,
  Transform2DValue,
} from '@volter/game-runtime/pixi/authoring';
import type { PhysicsAdapter2D } from '@volter/game-runtime/pixi/system-adapters';
import type {
  ComponentInstanceApplyResult,
  ComponentInstanceDescription,
  ComponentInstanceOverride,
  ComponentInstancesProvider,
  NodeCreationSite,
  PersistenceProvider,
  PropertyDescriptor,
  TransformChannel,
  TransformEditability,
} from '@volter/editor-project/adapter';
import type { Container } from 'pixi.js';
import type { ChannelValue, CreationSiteLiteralReport } from '@volter/editor-core/creation-site-edit';
import { creationSiteAnchor, instancesAtSite } from '@volter/editor-core/creation-site-registry';
import { editorConsole } from '@volter/editor-core/editor-console';
import { JsonHistoryResource } from '../history/json-history-resource';
import { createEphemeralPersistence } from './ephemeral-persistence';
import { multiChannelRefusal, persistChannelWrite } from './gesture-persist';
import type { CanvasWriteContext, CanvasWriteTarget } from './pixi-authoring-adapter';
import { transform2DChanged } from './pixi-transform-channels';
import type { SourcePersistenceBackend, SourceWriteSubject } from './source-persistence-backend';
import {
  LIVE_ONLY_ACK,
  LIVE_ONLY_DESTINATION,
  resolvesLiveOnly,
  runWritePipe,
  type WriteAck,
  type WriteResolution,
} from '@volter/editor-sdk/kit/write-pipe';

interface PixiLiveHistoryState {
  overlay: Overlay2D;
  nodes: Record<
    string,
    {
      label: string;
      alpha: number;
      visible: boolean;
      tint?: number;
      transform?: Transform2DValue;
      /** The node's own transform ORIGIN — a container's pivot in local units,
       *  a sprite's normalized anchor. Journaled because an origin move is an
       *  authored edit like any other, and a snapshot that omitted it would
       *  record a transaction whose undo silently restored nothing. */
      pivot?: readonly [number, number];
      anchor?: readonly [number, number];
    }
  >;
}

/** The point-shaped members this target reads and writes as a pair of numbers.
 *  A Pixi `ObservablePoint` is not structured-cloneable, so history holds the
 *  two numbers and puts them back through the same setter an edit uses. */
function pointOf(value: unknown): readonly [number, number] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const point = value as { x?: unknown; y?: unknown };
  return typeof point.x === 'number' && typeof point.y === 'number'
    ? [point.x, point.y]
    : undefined;
}

/** Put one journaled origin back through the same setter an edit uses — and
 *  only on an object that HAS that member, so restoring a container's snapshot
 *  never invents a sprite anchor. */
function restoreOrigin(
  display: Container,
  member: 'pivot' | 'anchor',
  value: readonly [number, number] | undefined,
): void {
  const shaped = display as Container & Record<string, unknown>;
  if (!value || !pointOf(shaped[member])) return;
  shaped[member] = { x: value[0], y: value[1] };
}

function numToHex(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
}
function hexToNum(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}

/** The three transform channels, in the order `endTransformEdit` reports them. */
const TRANSFORM_CHANNELS = ['position', 'rotation', 'scale'] as const;

export interface LiveCanvasWriteTargetOptions {
  /** Transform ownership + the freeze/commit/unfreeze handshake, so a drag
   *  sticks instead of being stomped by the next physics step. */
  readonly physics: PhysicsAdapter2D;
  /**
   * Where a closed gesture's value goes. ABSENT ⇒ live-only for the session,
   * which is the honest answer for a tree with no reachable source; present ⇒
   * the game's own source, per edit, when every gate the backend owns is open.
   */
  readonly persistence?: SourcePersistenceBackend | undefined;
}

export function createLiveCanvasWriteTarget(
  options: LiveCanvasWriteTargetOptions,
): CanvasWriteTarget {
  const { physics } = options;
  const persist = options.persistence ?? null;
  let a2d: AuthoringAdapter2D;
  let notify: () => void = () => {};
  let historyResource: JsonHistoryResource<PixiLiveHistoryState> | null = null;
  let editStartState: PixiLiveHistoryState | undefined;
  /** The transform in force when the current gesture began — the value the
   *  creation-site planner's equality backstop is checked against. */
  let editBaseline: Transform2DValue | undefined;
  /**
   * Did the current gesture move the node's ORIGIN (pivot/anchor)?
   *
   * The origin handle writes two things at once — the origin itself and a
   * compensating `position` that keeps the drawn content still — and the origin
   * is NOT one of `TRANSFORM_CHANNELS`. Counting only those would see a lone
   * `position` move, write it into the game's source, and leave the origin half
   * in the session alone; one Ctrl+Z would then undo half the drag, which is the
   * exact failure `endTransformEdit`'s multi-property refusal exists to prevent.
   * So the origin counts as a moved property there.
   */
  let editMovedOrigin = false;
  /** Has this session already raised the "structural edits stay live-only"
   *  warning? (See `reportStructureLiveOnly`.) */
  let structureLiveOnlyAnnounced = false;

  const captureHistoryState = (): PixiLiveHistoryState => {
    const nodes: PixiLiveHistoryState['nodes'] = {};
    const visit = (id: string): void => {
      const node = a2d.node(id);
      const display = a2d.displayObject(id) as (Container & { tint?: number }) | null;
      if (!node || !display) return;
      let transform: Transform2DValue | null = null;
      try {
        transform = a2d.getTransform(id);
      } catch {
        // A custom adapter may expose inspectable container-like nodes without
        // Pixi transform observables. Their non-transform fields stay journaled.
      }
      const pivot = pointOf((display as { pivot?: unknown }).pivot);
      const anchor = pointOf((display as { anchor?: unknown }).anchor);
      nodes[id] = {
        label: display.label ?? '',
        alpha: display.alpha,
        visible: display.visible,
        ...('tint' in display ? { tint: display.tint } : {}),
        ...(transform ? { transform } : {}),
        ...(pivot ? { pivot } : {}),
        ...(anchor ? { anchor } : {}),
      };
      for (const childId of node.childIds) visit(childId);
    };
    for (const root of a2d.roots()) visit(root.id);
    return { overlay: structuredClone(a2d.serializeOverlay()), nodes };
  };

  const restoreHistoryState = (state: PixiLiveHistoryState): void => {
    for (const [id, value] of Object.entries(state.nodes)) {
      const display = a2d.displayObject(id) as (Container & { tint?: number }) | null;
      if (!display) continue;
      display.label = value.label;
      display.alpha = value.alpha;
      display.visible = value.visible;
      if (value.tint !== undefined && 'tint' in display) display.tint = value.tint;
      restoreOrigin(display, 'pivot', value.pivot);
      restoreOrigin(display, 'anchor', value.anchor);
      if (value.transform) a2d.setTransform(id, value.transform);
    }
    a2d.replaceOverlay(state.overlay);
    notify();
  };

  /**
   * JOURNALED LOUDLY. A rejected `record(...)` means the edit IS applied to the
   * live tree and has NO history entry: the user sees the value they changed
   * and Ctrl+Z does nothing, with nothing said. Same statement (and same
   * wording) as the three lane's `recordHistory`
   * (`three-authoring-adapter.ts`) and the canvas structure lane's
   * `CanvasStructureHistory.run`.
   *
   * WHY THE REPORT IS HERE AND NOT IN THE VERB'S ACK. Every value verb funnels
   * through this function, and the ones that carry an ack — `set`,
   * `endTransformEdit` — reach it on the arm where the pipe resolved LIVE-ONLY,
   * whose ack answers a different question (where the BYTES went — nowhere, by
   * design, on that arm) and cannot carry a journaling failure without claiming
   * it was a persistence one. The rest (`revertOverrides`, the unpersisted
   * `set`/`endTransformEdit` paths) return `void`, so no caller can await this
   * write at all.
   */
  const recordHistory = (label: string, before: PixiLiveHistoryState | undefined): void => {
    if (historyResource && before) {
      void historyResource.record(label, before, captureHistoryState()).catch((error: unknown) => {
        editorConsole.error(
          `[canvas] failed to journal "${label}" into project history — the edit is applied ` +
            `but has no history entry (it cannot be undone): ${
              error instanceof Error ? error.message : String(error)
            }`,
          'authoring',
        );
      });
    }
  };

  const writeProp = (id: string, path: string, value: unknown): void => {
    const display = a2d.displayObject(id) as (Container & Record<string, unknown>) | null;
    if (!display) return;
    if (path === 'name') a2d.set(id, 'label', value as string);
    else if (path === 'tint') a2d.set(id, 'tint', hexToNum(value as string));
    else if (path === 'visible') a2d.set(id, 'visible', value as boolean);
    else if (path === 'alpha') a2d.set(id, 'alpha', value as number);
    else display[path] = value;
    notify();
  };

  const readProp = (id: string, path: string): unknown => {
    const display = a2d.displayObject(id) as (Container & Record<string, unknown>) | null;
    if (!display) return undefined;
    if (path === 'name') return display.label;
    if (path === 'tint') return numToHex((display as { tint?: number }).tint ?? 0xffffff);
    return display[path];
  };

  // ───────────────────────────────────────────── the persistence collaboration

  /**
   * One property's value in the shape the creation-site planner speaks.
   *
   * Pixi's own vocabulary, not the editor's neutral 3D transform: a canvas
   * `position` is TWO numbers and a canvas `rotation` is ONE scalar in radians,
   * which is what the game's own source holds and therefore what a literal at a
   * creation site can be compared against. Translating to the neutral transform
   * here would compare a quaternion to a number.
   */
  const readChannel = (id: string, property: string): ChannelValue | undefined => {
    const transform = a2d.getTransform(id);
    if (property === 'position') return transform ? [...transform.position] : undefined;
    if (property === 'rotation') return transform ? transform.rotation : undefined;
    if (property === 'scale') return transform ? [...transform.scale] : undefined;
    return readProp(id, property) as ChannelValue | undefined;
  };

  /** Put one property back on the live object — the undo/redo half of a
   *  persisted edit, routed through the SAME writers an ordinary edit uses. */
  const applyChannel = (id: string, property: string, value: ChannelValue): void => {
    if (property === 'position' && Array.isArray(value)) {
      a2d.setTransform(id, { position: [value[0] ?? 0, value[1] ?? 0] });
    } else if (property === 'rotation' && typeof value === 'number') {
      a2d.setTransform(id, { rotation: value });
    } else if (property === 'scale' && Array.isArray(value)) {
      a2d.setTransform(id, { scale: [value[0] ?? 1, value[1] ?? 1] });
    } else {
      writeProp(id, property, value);
      return;
    }
    notify();
  };

  /**
   * The creation site an edit to `property` would have to be written at, plus
   * how many objects that site built.
   *
   * There is no OWNER HOP on this surface, and that is a fact rather than an
   * omission: a Pixi display object holds its own tint, alpha and visibility —
   * there is no separate material object with its own `new`, which is the case
   * that forces `ChannelOwner` to exist on three.
   */
  const subjectFor = (id: string, property: string): SourceWriteSubject => {
    const anchor = creationSiteAnchor(a2d.displayObject(id) ?? null);
    return {
      entityId: id,
      property,
      surface: 'pixi',
      anchor,
      // This surface plans ONE lane and its absence: a construction literal in
      // the game's own module, or nothing at all. There is no serve-time prop
      // stamp here and no data-record anchor, and claiming either would be a
      // kind this target cannot write.
      anchorKind: anchor.anchored ? 'construction-literal' : 'live-only',
      instances: anchor.anchored && anchor.kind === 'source' ? instancesAtSite(anchor) : 0,
    };
  };

  const labelOf = (id: string): string => a2d.node(id)?.label ?? '2D Object';

  /**
   * Close out one gesture: write it into the game's own source if every gate is
   * open, and otherwise journal it live-only.
   *
   * ONE gesture becomes ONE history entry either way — the persisted path's
   * transaction carries both the file and the live value, so the live-only
   * journal is SKIPPED when it succeeds rather than added to it. Transcribed
   * from `ThreeAuthoringAdapter.persistOrJournal`, including its rule that a
   * gesture which moved more than one channel is refused AS A WHOLE: a partial
   * write would leave one channel in the file and one only in the session, and
   * one Ctrl+Z would then undo half a drag.
   */
  const persistOrJournal = (
    id: string,
    label: string,
    before: PixiLiveHistoryState | undefined,
    property: string | null,
    baseline: ChannelValue | undefined,
    next: ChannelValue | undefined,
  ): Promise<WriteAck> | undefined => {
    if (!persist) return undefined;
    if (property === null || baseline === undefined || next === undefined) {
      // Nothing single-channel to write, so there is no edit for the pipe to
      // carry — the live values still have to be undoable.
      recordHistory(label, before);
      return undefined;
    }
    // The shared kit resolution (`gesture-persist.ts`). NOTE the drift it
    // retired: this copy used to check the LANE before the gate, so a
    // live-only subject whose gate was also shut earned a different refusal
    // sentence here than on the three lane. The documented order — gate
    // first, because it names the precise reason — now holds everywhere.
    return persistChannelWrite({
      backend: persist,
      subject: () => subjectFor(id, property),
      baseline,
      next,
      label,
      journal: () => recordHistory(label, before),
    });
  };

  const listProperties = (id: string): PropertyDescriptor[] => {
    const props: PropertyDescriptor[] = [
      { path: 'name', label: 'Name', type: 'string' },
      { path: 'visible', label: 'Visible', type: 'boolean' },
      { path: 'alpha', label: 'Alpha', type: 'number' },
    ];
    const display = a2d.displayObject(id);
    if (display && 'tint' in display) props.push({ path: 'tint', label: 'Tint', type: 'color' });
    return props;
  };

  // ─────────────────────────────────── component instances: the site IS the component
  //
  // On this surface a "component" is not a declared React/prefab component at
  // all — it is the CONSTRUCTION STATEMENT. `new Bubble(0.5, 0.5)` is the
  // declaration, its literals are the defaults, and the live object the editor
  // is showing is the instance. So an OVERRIDE is exactly "the live value is not
  // the one that line names", REVERT puts the line's own value back on the
  // object, and APPLY writes the live value INTO the line — which is what makes
  // every sibling that line constructs inherit it on the next load.
  //
  // The literals come from the server (`/__ingest-source/inspect`), because
  // deciding what a literal is means parsing the game's source, and that parser
  // is deliberately not in the browser bundle. `describe` is synchronous, so it
  // answers from a CACHE and asks for a cold one — see `literalsFor`.

  /** Literals per SITE, not per node: they are a property of the line, and the
   *  same line can have constructed several of the nodes being inspected. */
  const literalsBySite = new Map<string, Record<string, CreationSiteLiteralReport>>();
  /** ONE read in flight per site, ever — the answer's promise, so a synchronous
   *  `describe` and an awaiting `revert` share the same request rather than
   *  racing two. A failed read resolves to `{}` and stays cached for the
   *  session, the same direction `loadIngestOwnership` fails in. */
  const literalRequests = new Map<string, Promise<Record<string, CreationSiteLiteralReport>>>();

  const siteKeyOf = (anchor: NodeCreationSite): string | null =>
    anchor.anchored && anchor.kind === 'source'
      ? `${anchor.file}:${anchor.line}:${anchor.col}`
      : null;

  /** The channel paths a canvas subject can be described against: its three
   *  transform channels plus its own reflected inspector rows. */
  const instanceProperties = (id: string): ReadonlyArray<{ path: string; label: string }> => [
    { path: 'position', label: 'Position' },
    { path: 'rotation', label: 'Rotation' },
    { path: 'scale', label: 'Scale' },
    ...listProperties(id).map((property) => ({ path: property.path, label: property.label })),
  ];

  /** Read the site once, for the whole subject, and notify when it lands so the
   *  inspector draws the description on the next render. */
  const loadLiterals = (
    id: string,
    key: string,
    anchor: NodeCreationSite,
    instances: number,
  ): Promise<Record<string, CreationSiteLiteralReport>> => {
    const existing = literalRequests.get(key);
    if (existing) return existing;
    const read = persist?.readSiteLiterals;
    const properties = instanceProperties(id)
      .map((property) => ({ property: property.path, live: readChannel(id, property.path) }))
      .filter(
        (entry): entry is { property: string; live: ChannelValue } => entry.live !== undefined,
      );
    if (!read || properties.length === 0) return Promise.resolve({});
    const request = read({
      anchor,
      instances,
      writeScope: 'creation-site',
      surface: 'pixi',
      properties,
    }).then((answer) => {
      literalsBySite.set(key, answer);
      notify();
      return answer;
    });
    literalRequests.set(key, request);
    return request;
  };

  /**
   * The site's literals for `id`, or `null` while they are still being read.
   *
   * `null` is an absence of KNOWLEDGE, never a claim that the site names
   * nothing — the caller reports no description at all for it, which is what the
   * shell already reads as "this subject is not a component instance", and the
   * read's own notify brings the real answer one render later.
   */
  const literalsFor = (
    id: string,
    key: string,
    anchor: NodeCreationSite,
    instances: number,
  ): Record<string, CreationSiteLiteralReport> | null => {
    const known = literalsBySite.get(key);
    if (known) return known;
    void loadLiterals(id, key, anchor, instances);
    return null;
  };

  /** Float slack for "is the live value still the one the line names" — a
   *  running game's own arithmetic lands a few ULPs off an authored decimal, and
   *  reporting that as an override would put a phantom row in every inspector. */
  const CHANNEL_EPS = 1e-6;

  const sameChannelValue = (a: ChannelValue, b: ChannelValue): boolean => {
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((value, index) => sameChannelValue(value, b[index]!));
    }
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= CHANNEL_EPS;
    return a === b;
  };

  /** The game's OWN name for what this node is: the class its construction
   *  statement built. Never a name this editor invented for it. */
  const componentNameOf = (id: string): string => {
    const display = a2d.displayObject(id);
    return display?.constructor?.name || (a2d.node(id)?.kind ?? '2D Object');
  };

  const affectedInstances = (count: number): string =>
    `${count} ${count === 1 ? 'instance' : 'instances'}`;

  const overrideOf = (
    id: string,
    property: { path: string; label: string },
    report: CreationSiteLiteralReport | undefined,
    subject: ReturnType<typeof subjectFor>,
  ): ComponentInstanceOverride | null => {
    const live = readChannel(id, property.path);
    if (!report || report.literal === null || live === undefined) return null;
    if (sameChannelValue(report.literal, live)) return null;
    const gate = persist?.gate({
      ...subject,
      property: property.path,
      writeScope: 'creation-site',
    });
    const unavailable = !report.writable ? report.reason : gate?.ok ? undefined : gate?.reason;
    return {
      path: property.path,
      label: property.label,
      value: live,
      ...(report.text ? { defaultText: report.text } : {}),
      canApplyToComponent: unavailable === undefined,
      ...(unavailable === undefined ? {} : { applyUnavailableReason: unavailable }),
      affectedInstanceCount: subject.instances,
    };
  };

  /**
   * The two values an apply would write — or the reason it cannot happen, in the
   * voice that OWNS that refusal: the planner's words when the source is what
   * stands in the way, the backend gate's when the session mode or ownership is.
   */
  type ApplyPlan =
    | {
        readonly ok: true;
        readonly backend: SourcePersistenceBackend;
        readonly baseline: ChannelValue;
        readonly next: ChannelValue;
      }
    | { readonly ok: false; readonly message: string };

  const planApply = (
    subject: SourceWriteSubject,
    path: string,
    report: CreationSiteLiteralReport | undefined,
    live: ChannelValue | undefined,
  ): ApplyPlan => {
    if (!persist || !report || report.literal === null || live === undefined) {
      return {
        ok: false,
        message:
          report?.reason ??
          `The construction site names no ${path} for this object, so there is no default to change.`,
      };
    }
    if (!report.writable) {
      return {
        ok: false,
        message: report.reason ?? `The construction site's ${path} cannot be rewritten.`,
      };
    }
    const verdict = persist.gate({ ...subject, writeScope: 'creation-site' });
    if (!verdict.ok) return { ok: false, message: verdict.reason };
    return { ok: true, backend: persist, baseline: report.literal, next: live };
  };

  /**
   * The site's literals for `id`, AWAITED — what an ACTING caller needs, where
   * `literalsFor` is what a rendering one needs. A revert or an apply is a
   * deliberate act with somewhere to await, so it must not silently do nothing
   * merely because nothing happened to have described this node first (an agent
   * driving the provider through `vgai eval` never does).
   */
  const literalsNow = async (
    id: string,
  ): Promise<Record<string, CreationSiteLiteralReport> | null> => {
    const subject = subjectFor(id, 'position');
    const key = siteKeyOf(subject.anchor);
    if (!key) return null;
    return (
      literalsBySite.get(key) ?? (await loadLiterals(id, key, subject.anchor, subject.instances))
    );
  };

  const instancesProvider: ComponentInstancesProvider = {
    describe: (id): ComponentInstanceDescription | null => {
      const subject = subjectFor(id, 'position');
      const key = siteKeyOf(subject.anchor);
      if (!key || !a2d.displayObject(id)) return null;
      const literals = literalsFor(id, key, subject.anchor, subject.instances);
      // An EMPTY map is not "the site names nothing" — the server answers one
      // entry per property asked, `literal: null` and all. It is "nothing
      // answered": a tier with no `/__ingest-source/*` route, or a transport
      // that failed. Describing an instance from it would report "using
      // component defaults" about defaults nobody read.
      if (!literals || Object.keys(literals).length === 0) return null;
      const overrides = instanceProperties(id)
        .map((property) => overrideOf(id, property, literals[property.path], subject))
        .filter((override): override is ComponentInstanceOverride => override !== null);
      return {
        componentName: componentNameOf(id),
        ...(subject.anchor.anchored ? { sourcePath: subject.anchor.display } : {}),
        overrides,
      };
    },

    // REVERT IS A LIVE WRITE, and only a live write: the value being restored is
    // the one the source already holds, so there is nothing to write back to it.
    // One transaction for the batch — reverting three overrides is one Ctrl+Z.
    revert: async (id, paths) => {
      const literals = await literalsNow(id);
      if (!literals) return;
      const before = captureHistoryState();
      const reverted: string[] = [];
      for (const path of paths) {
        const literal = literals[path]?.literal;
        if (literal === null || literal === undefined) continue;
        applyChannel(id, path, literal);
        reverted.push(path);
      }
      if (reverted.length === 0) return;
      recordHistory(
        reverted.length === 1
          ? `Revert ${labelOf(id)} ${reverted[0]}`
          : `Revert ${reverted.length} ${labelOf(id)} overrides`,
        before,
      );
      notify();
      return LIVE_ONLY_ACK;
    },

    applyToComponent: async (id, path): Promise<ComponentInstanceApplyResult> => {
      const subject = { ...subjectFor(id, path), writeScope: 'creation-site' as const };
      const key = siteKeyOf(subject.anchor);
      const report = (await literalsNow(id))?.[path];
      const live = readChannel(id, path);
      const plan = planApply(subject, path, report, live);
      if (!plan.ok) return { changed: false, message: plan.message };
      const label =
        `Apply ${path} to ${componentNameOf(id)} default ` +
        `(${affectedInstances(subject.instances)})`;
      // BASELINE IS THE LITERAL, not the live value: the planner may only
      // rewrite a literal it can prove is the value in force at that slot, and
      // for this gesture the value in force AT THE SITE is exactly what the site
      // says. The live value is the one being written INTO it.
      const persisted = await plan.backend.write({
        ...subject,
        baseline: plan.baseline,
        next: plan.next,
        label,
      });
      if (!persisted) {
        return {
          changed: false,
          message: `${label} did not land — the editor console names why.`,
        };
      }
      // The line says something new now; the next describe re-reads it.
      if (key) literalsBySite.delete(key);
      notify();
      return {
        changed: true,
        message: `${path} now reads ${JSON.stringify(live)} for all ${affectedInstances(subject.instances)} at ${
          subject.anchor.anchored ? subject.anchor.display : 'its creation site'
        }.`,
        write: {
          destination: subject.anchor.anchored ? subject.anchor.display : 'creation site',
          persisted: true,
        },
      };
    },
  };

  return {
    provenance: persist
      ? {
          source: 'foreign',
          label: 'creation-site',
          detail:
            'Live 2D (PixiJS) tree projected directly — an edit is written into the game’s own ' +
            'source at the line that constructed the object, and says why whenever it cannot be.',
        }
      : {
          source: 'foreign',
          label: 'live-only',
          detail:
            'Live 2D (PixiJS) tree projected directly — edits apply for this session only and are never saved.',
        },

    // A creation-site write commits per edit through project history at the
    // moment of the gesture, so there is no whole-document save to flush — but
    // `destination` is still the one-line answer to "where do edits go", and it
    // is a GETTER because holding or releasing the game changes the answer
    // mid-session.
    get persistence(): PersistenceProvider {
      const backend = persist;
      if (!backend) {
        return { ...createEphemeralPersistence(), destination: LIVE_ONLY_DESTINATION };
      }
      return {
        ...createEphemeralPersistence(),
        get destination() {
          return backend.destination();
        },
      };
    },

    // The READ surface answers from the same literal report the write path uses.
    // A recorded `new` proves WHERE the object came from, but does not prove
    // that this particular property is writable there. While the source read
    // is in flight the lane is deliberately unknown; once it lands, a write
    // the planner says it would accept earns `construction-literal` — a
    // rewritable literal, or an insertable named assignment (`writable` with
    // `literal: null`). A proven refusal is `live-only`, in agreement with
    // the write pipe's actual destination rather than the constructor stamp
    // alone.
    truth: (id, property) => {
      const subject = subjectFor(id, property);
      if (subject.anchorKind === 'live-only') {
        return { site: subject.anchor, writeAnchorKind: 'live-only' };
      }
      const key = siteKeyOf(subject.anchor);
      if (!key) return { site: subject.anchor, writeAnchorKind: 'live-only' };
      const known = literalsBySite.get(key);
      if (!known) {
        void loadLiterals(id, key, subject.anchor, subject.instances);
        return { site: subject.anchor, writeAnchorKind: undefined };
      }
      const report = known[property];
      return {
        site: subject.anchor,
        writeAnchorKind: report?.writable ? 'construction-literal' : 'live-only',
      };
    },

    // A class-owned Pixi object carries a real component identity in its own
    // constructor. That identity is enough to associate the instance with the
    // project's portable CSF stories (generic PIXI.Container/Sprite names
    // simply match nothing). Keep the source path absent: the construction
    // site is vendor source while the colocated authoring component may be a
    // project-owned TSX facade, and pretending those are the same file would
    // incorrectly defeat the registry's name-based association.
    componentIdentity: (id) => (a2d.displayObject(id) ? { name: componentNameOf(id) } : null),

    // Present exactly when a backend can READ the game's own source: with no
    // reachable source there are no literals to call defaults, and a description
    // built without them would be the fabrication the doctrine forbids.
    ...(persist?.readSiteLiterals ? { instances: () => instancesProvider } : {}),

    /**
     * Mid-gesture origin write — see {@link CanvasWriteTarget.writeOrigin}. It
     * pushes no history of its own: `beginTransformEdit` has already captured
     * the before-state (which now carries pivot/anchor), and
     * `endTransformEdit` records the one entry covering the whole gesture.
     */
    writeOrigin(id: string, kind: 'pivot' | 'anchor', value: readonly [number, number]): void {
      historyResource?.assertCanMutate();
      const display = a2d.displayObject(id) as (Container & Record<string, unknown>) | null;
      if (!display || !pointOf(display[kind])) return;
      display[kind] = { x: value[0], y: value[1] };
      editMovedOrigin = true;
      notify();
    },

    bind(context: CanvasWriteContext): void {
      a2d = context.a2d;
      notify = context.notify;
      const history = context.store.projectHistory;
      historyResource = history
        ? new JsonHistoryResource({
            history,
            kind: 'session-state',
            scope: 'session',
            // The SUBJECT's session, not this mount's — see the ownership block
            // in `history/json-history-resource.ts`. A held canvas world is
            // remounted by HMR and by a re-entered ingest, and its entity ids
            // are identical across both, so its undo stack belongs to the world.
            subject: { ...context.journal, id: `${context.journal.id}/world-2d-edits` },
            displayName: 'World 2D edits',
            capture: captureHistoryState,
            // The snapshot mirrors every live display object, but this is a
            // RUNNING game that moves its own sprites every frame, so the full
            // snapshot stops matching a frame after it is taken. The OVERLAY is
            // this resource's real content — only editor edits touch it — so it
            // alone decides "did something else change this resource?". Without
            // it every transaction fails preflight with `content-conflict` and
            // undo silently does nothing (the three lane paid for this as #81).
            conflictIdentity: (state) => state.overlay,
            restore: async (state) => {
              restoreHistoryState(state);
            },
          })
        : null;
      persist?.attach({ read: readChannel, apply: applyChannel });
    },

    onReindex(): void {
      // Ids are structural, so a re-walk can move them; nothing here caches an
      // id across one.
    },

    // A live tree's transform is writable wherever Pixi will accept it, which is
    // everywhere. What the backend adds is the SENTENCE: where this particular
    // object's edit will land, or the named reason it will only live in the
    // session — the per-edit honesty the doctrine asks for, read before the
    // gesture rather than after it. `removable` rides the same answer when the
    // backend declares a removal door that is open for this subject — the flag
    // `compose.ts` turns into the field's `resettable`, which is what lets
    // `remove-inspection-field` reach {@link removeTransform} instead of
    // refusing by name (the three lane's `removableFlag` is the transcribed
    // precedent).
    transformEditability(id: string, channel: TransformChannel): TransformEditability {
      if (!persist) return { writable: true };
      const subject = subjectFor(id, channel);
      const removable =
        subject.anchorKind !== 'live-only' && persist.removal?.available(subject)
          ? { removable: true as const }
          : {};
      return { writable: true, reason: persist.describe(subject), ...removable };
    },

    beginTransformEdit(id: string): void {
      historyResource?.assertCanMutate();
      const display = a2d.displayObject(id);
      if (display && physics.ownerOf(display) === 'physics') physics.freeze(display);
      editStartState = captureHistoryState();
      editBaseline = persist ? (a2d.getTransform(id) ?? undefined) : undefined;
      editMovedOrigin = false;
    },

    writeTransform(id: string, next: Transform2DValue): void {
      historyResource?.assertCanMutate();
      const display = a2d.displayObject(id);
      if (display && physics.ownerOf(display) === 'physics') {
        physics.commit(display, next.position, next.rotation);
      }
      a2d.setTransform(id, next);
      notify();
    },

    // Pushes exactly ONE undo entry per gesture: `writeTransform` fires many
    // times during a live drag (no undo push there), and this fires once on
    // commit, which is where the before/after pair is recorded — and where a
    // source write is attempted.
    endTransformEdit(id: string): void | Promise<WriteAck> {
      const display = a2d.displayObject(id);
      if (display && physics.ownerOf(display) === 'physics') physics.unfreeze(display);
      const label = `Transform ${labelOf(id)}`;
      const before = editStartState;
      const baseline = editBaseline;
      const movedOrigin = editMovedOrigin;
      editStartState = undefined;
      editBaseline = undefined;
      editMovedOrigin = false;
      if (!persist) {
        recordHistory(label, before);
        return;
      }
      const after = a2d.getTransform(id) ?? undefined;
      // `origin` first, and it is not a writable channel — see `editMovedOrigin`.
      const changed: string[] = movedOrigin ? ['origin'] : [];
      if (baseline && after) {
        changed.push(
          ...TRANSFORM_CHANNELS.filter((channel) => transform2DChanged(channel, baseline, after)),
        );
      }
      if (changed.length > 1) {
        persist.report(label, multiChannelRefusal(changed));
      }
      const property = changed.length === 1 && changed[0] !== 'origin' ? changed[0]! : null;
      return persistOrJournal(
        id,
        label,
        before,
        property,
        property ? readChannelOf(baseline, property) : undefined,
        property ? readChannelOf(after, property) : undefined,
      );
    },

    /**
     * THE REMOVAL DOOR for one transform channel — the byte-absence half the
     * insertion arm makes necessary on this lane too: an authored canvas
     * transform can ADD a `receiver.member.axis = value;` statement for an
     * axis the game's source never named, and only deleting that statement
     * restores byte-absence. Through the SAME pipe every other edit takes,
     * resolving on the backend's removal verb; no live half is journalled (a
     * removal changes the FILE — the running object keeps its value, and the
     * undo is the backend's own project-source transaction). Transcribed from
     * `ThreeAuthoringAdapter.pipedRemove`.
     */
    removeTransform(id: string, channel: TransformChannel): void | Promise<WriteAck> {
      const backend = persist;
      const removal = backend?.removal;
      if (!backend || !removal) return;
      const label = `Remove ${labelOf(id)} ${channel}`;
      return runWritePipe({
        resolve: (): WriteResolution => {
          const subject = subjectFor(id, channel);
          if (subject.anchorKind === 'live-only' || !removal.available(subject)) {
            return resolvesLiveOnly(backend.describe(subject));
          }
          return {
            reaches: 'writer',
            anchorKind: subject.anchorKind,
            destination: backend.destination(),
            write: () => removal.perform({ ...subject, label }),
          };
        },
        record: () => {},
        report: (reason) => {
          if (backend.armed()) backend.report(label, reason);
        },
      });
    },

    /**
     * ONCE AS A WARNING, THEN AS A LOG — because the fact is a property of the
     * LANE, not of each op.
     *
     * With a backend the user armed, every refused op reports through the same
     * channel a refused transform does: they asked for source writes, so each
     * one that did not land matters individually. Unarmed, the first structural
     * edit of the session raises the warning that reaches the product's own
     * doors (`vgai status`, the session journal, one ack to clear) — a whole
     * class of this author's edits will not be saved, which is exactly what an
     * unresolved warning is for — and every later op logs, because repeating an
     * ack-requiring entry per created node would flood the set with the lane
     * working as designed.
     */
    reportStructureLiveOnly(label: string, reason: string): void {
      if (persist?.armed()) {
        persist.report(label, reason);
        return;
      }
      if (!structureLiveOnlyAnnounced) {
        structureLiveOnlyAnnounced = true;
        editorConsole.warn(
          `[canvas] structural edits in this world are live-only — ${reason}. ` +
            `First one: ${label}.`,
          'authoring',
        );
        return;
      }
      editorConsole.log(`[canvas] ${label} is live-only — ${reason}.`, 'authoring');
    },

    properties: listProperties,

    get(id: string, path: string): unknown {
      return readProp(id, path);
    },

    set(id: string, path: string, value: unknown): void | Promise<WriteAck> {
      historyResource?.assertCanMutate();
      const before = captureHistoryState();
      const label = `Set ${labelOf(id)} ${path}`;
      if (!persist) {
        writeProp(id, path, value);
        recordHistory(label, before);
        return;
      }
      // Read the baseline BEFORE the write: the creation-site planner may only
      // rewrite a literal it can prove is the value currently in force, and
      // "currently" means before this gesture touched anything.
      const baseline = readChannel(id, path);
      writeProp(id, path, value);
      const next = readChannel(id, path);
      const moved =
        baseline !== undefined &&
        next !== undefined &&
        JSON.stringify(baseline) !== JSON.stringify(next);
      return persistOrJournal(id, label, before, moved ? path : null, baseline, next);
    },

    dispose(): void {
      historyResource?.dispose();
      historyResource = null;
      persist?.dispose();
    },
  };
}

/** One channel out of a 2D transform, in the planner's own shape. */
function readChannelOf(
  transform: Transform2DValue | undefined,
  property: string,
): ChannelValue | undefined {
  if (!transform) return undefined;
  if (property === 'position') return [...transform.position];
  if (property === 'rotation') return transform.rotation;
  if (property === 'scale') return [...transform.scale];
  return undefined;
}
