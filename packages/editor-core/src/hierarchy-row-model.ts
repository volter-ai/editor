/**
 * Pure row-model math for the hierarchy panel.
 *
 * Four questions a row needs answered, all extracted here so they are unit
 * testable without a DOM, an adapter session, or a live source tree:
 *
 * 1. **Is this row a component instance, and what is its type?** The
 *    adapter already computes `EditorNode.typeLabel`; the row just needs to
 *    know when to print it. Detached `#n` pockets deliberately carry no
 *    `typeLabel` — a pocket must not impersonate the `<Enemy>` that
 *    rendered it — so "has a typeLabel AND is a component row" is the whole
 *    rule and no special-casing of pockets is needed here.
 * 2. **Is every transform channel refused, and with what sentence?**
 *    The adapter's `reason` is the ONE canonical text (doctrine rule 2): the
 *    hierarchy tooltip, the inspector field, and the gizmo-denial hint all
 *    show this exact string, never a paraphrase. So this module NEVER writes
 *    a reason of its own — it only forwards the adapter's.
 * 3. **Does this row have authorability warnings, and what do they say?**
 *    Same rule as H2, one step stronger: the diagnostic message is written by
 *    the analyzer that found the problem and is shown VERBATIM. This module
 *    picks no wording, adds no severity of its own and truncates nothing — it
 *    counts and newline-joins.
 * 4. **What may this row DO?** One predicate ({@link rowAffordances}) that
 *    every gate in the panel consults, instead of five copies of
 *    `!isStructural && !isInternal` drifting apart.
 *
 * Cost note: `R3fSourceAuthoringAdapter.editability` re-analyzes JSX
 * attributes from cached source text on every call (string scan + parse). It
 * is NOT free per render, which is why {@link transformLockSummary}
 * short-circuits on the first WRITABLE channel (the overwhelmingly common
 * case costs exactly one probe, not three) and why {@link TransformLockCache}
 * exists at all.
 */

import type { EditorNode, TransformChannel, TransformEditability } from '@volter/editor-project/adapter';

/** The three channels a lock glyph summarizes, in probe order. */
const CHANNELS: readonly TransformChannel[] = ['position', 'rotation', 'scale'];

// ------------------------------------------------------------------ H1

export interface RowIdentity {
  /** The row's own name — unchanged, and still the ONLY thing search matches. */
  readonly label: string;
  /** The component type to print as a dim suffix, or null for a plain row. */
  readonly typeSuffix: string | null;
}

/**
 * H1 — `EnemyBravo ·Enemy`. A row earns the type suffix (and the instance
 * accent tint that travels with it) only when it BOTH represents a component
 * instance (`role: 'component'`) and the adapter told us its type.
 */
export function rowIdentity(node: Pick<EditorNode, 'label' | 'role' | 'typeLabel'>): RowIdentity {
  const isInstance = node.role === 'component' && !!node.typeLabel;
  return { label: node.label, typeSuffix: isInstance ? node.typeLabel! : null };
}

// ------------------------------------------------------------------ H2

export interface TransformLockSummary {
  /** True only when position, rotation AND scale are all refused. */
  readonly locked: boolean;
  /** The position channel's verbatim adapter reason (never rewritten here). */
  readonly reason?: string;
}

/** Shared immutable "nothing to say" result — avoids per-row allocation. */
export const UNLOCKED: TransformLockSummary = { locked: false };

/** One channel probe. `undefined` means the adapter declares no editability
 *  opinion at all, which every consumer in this editor reads as writable
 *  (`editability?.(…)?.writable ?? true`). */
export type EditabilityProbe = (channel: TransformChannel) => TransformEditability | undefined;

/**
 * H2 — collapse the three channels into one row-level verdict. Short-circuits
 * on the first writable channel, so an ordinary movable row pays for ONE
 * `editability` call.
 *
 * The surfaced reason is the POSITION channel's, matching the design record:
 * per-channel detail stays inspector-only, and the row shows one sentence.
 */
export function transformLockSummary(probe: EditabilityProbe): TransformLockSummary {
  let positionReason: string | undefined;
  for (const channel of CHANNELS) {
    const verdict = probe(channel);
    if (!verdict || verdict.writable) return UNLOCKED;
    if (channel === 'position') positionReason = verdict.reason;
  }
  return positionReason === undefined ? { locked: true } : { locked: true, reason: positionReason };
}

/** The minimal adapter surface {@link TransformLockCache} needs — structurally
 *  satisfied by `AuthoringAdapter` without importing it. */
export interface EditabilitySource {
  readonly transforms?:
    | {
        readonly editability?:
          | ((id: string, channel: TransformChannel) => TransformEditability)
          | undefined;
      }
    | undefined;
}

/**
 * Memoized {@link transformLockSummary} per row id.
 *
 * INVALIDATION KEY: `(source identity, version)`. `version` is supplied by the
 * caller and must be a monotonically increasing counter that advances whenever
 * anything the adapter's `editability` reads could have changed. `GameHierarchy`
 * passes `store.getSnapshot() + adapterVersion` — the shell store's `_version`
 * (bumped by `_notify()`, which EVERY source-write path funnels through via
 * `notifyIngestEdit()`) plus its own adapter-subscription counter. Both are
 * monotone, so their sum is monotone, and a stale entry therefore cannot
 * survive a source edit: the edit bumps `_version` before the re-render that
 * would read the cache.
 *
 * The cache also clears on ADAPTER SWITCH (the `source !== this.source`
 * check), so ids minted by one adapter can never answer for another's.
 */
export class TransformLockCache {
  private entries = new Map<string, TransformLockSummary>();
  private source: EditabilitySource | null = null;
  private version = Number.NaN;
  /** Test-visible: how many times the adapter was actually probed. */
  private computed = 0;

  get computeCount(): number {
    return this.computed;
  }

  summaryFor(source: EditabilitySource, version: number, id: string): TransformLockSummary {
    if (this.source !== source || this.version !== version) {
      this.entries.clear();
      this.source = source;
      this.version = version;
    }
    const cached = this.entries.get(id);
    if (cached) return cached;
    this.computed++;
    const editability = source.transforms?.editability;
    const summary = editability
      ? transformLockSummary((channel) => editability(id, channel))
      : UNLOCKED;
    this.entries.set(id, summary);
    return summary;
  }
}

// ------------------------------------------------------------------ H6

/** What a row is allowed to do. Every field is a REFUSAL gate, never a
 *  capability claim: `true` means "this row model does not stand in the way",
 *  and the adapter's own provider/value probes still decide whether the
 *  affordance renders at all (a `document` row has no `name` path, so it never
 *  renames regardless of what this says). */
export interface RowAffordances {
  /** Reparent-by-drag. */
  readonly draggable: boolean;
  /** Inline rename (double-click) and the Rename menu item. */
  readonly renamable: boolean;
  /** ANY write: create/duplicate/delete/group, the visibility eye, the lock
   *  toggle, the entity-asset save. One flag, because H6's rule is not
   *  per-operation — a revealed internal has no writable surface at all. */
  readonly writable: boolean;
  /** Whether the row's label participates in hierarchy search. */
  readonly searchable: boolean;
}

const ORDINARY_ROW: RowAffordances = {
  draggable: true,
  renamable: true,
  writable: true,
  searchable: true,
};
const STRUCTURAL_ROW: RowAffordances = {
  draggable: false,
  renamable: false,
  writable: true,
  searchable: true,
};
/**
 * H6 — a revealed internal. Non-writable BY CONSTRUCTION, not by policy: it is
 * a rendered part of a component's output with no authored source identity, so
 * there is nothing for a rename/reparent/delete to write to. Selection stays
 * open (the id resolves, the inspector shows what it honestly can, and H2's
 * lock-with-reason sentence explains the refusal); search is closed, because a
 * `mixamorig:Spine` match across four enemies buries every real row.
 */
const INTERNAL_ROW: RowAffordances = {
  draggable: false,
  renamable: false,
  writable: false,
  searchable: false,
};

/**
 * The ONE gate for "may this row be written to / dragged / found by search".
 *
 * `structural` keeps its pre-H6 meaning exactly (world groups, organization
 * rows, root-group members, and the `STRUCTURAL_ROLES` set): non-draggable,
 * with its write items gated by the adapter probes the panel already runs.
 * `internal` is the new, stronger state and it wins over everything.
 */
export function rowAffordances(row: {
  readonly structural: boolean;
  readonly internal: boolean;
}): RowAffordances {
  if (row.internal) return INTERNAL_ROW;
  return row.structural ? STRUCTURAL_ROW : ORDINARY_ROW;
}

// ------------------------------------------------------------------ H5

/**
 * The two fields a row badge needs from one diagnostic. Structurally satisfied
 * by `R3fAuthoringDiagnostic` — declared narrowly here so the hierarchy never
 * imports an R3F/ui-source type (the same contract-only rule H2's
 * {@link EditabilitySource} and H3's `InstanceSourceLocator` follow).
 */
export interface RowDiagnostic {
  readonly code: string;
  readonly message: string;
}

export interface RowWarningBadge {
  /** How many diagnostics this row carries — always ≥ 1 when a badge exists. */
  readonly count: number;
  /** Every message, VERBATIM and newline-joined, in the order the adapter
   *  returned them. The badge's tooltip is this string and nothing else. */
  readonly tooltip: string;
  /** The codes, for the badge's `data-` attribute (a test can name the exact
   *  finding without matching on prose that is allowed to be reworded). */
  readonly codes: readonly string[];
}

/**
 * H5 — collapse a row's diagnostics into its badge, or `null` for the
 * overwhelmingly common "nothing to warn about" row.
 *
 * The verbatim rule is the point: doctrine rule 2 says the analyzer's sentence
 * is the ONE canonical text, so multiple findings are STACKED (newline-joined),
 * never summarized into "3 problems" and never truncated. A row with two
 * warnings shows both sentences.
 */
export function rowWarningBadge(
  diagnostics: readonly RowDiagnostic[] | undefined | null,
): RowWarningBadge | null {
  if (!diagnostics || diagnostics.length === 0) return null;
  return {
    count: diagnostics.length,
    tooltip: diagnostics.map((diagnostic) => diagnostic.message).join('\n'),
    codes: diagnostics.map((diagnostic) => diagnostic.code),
  };
}

/** The minimal adapter surface {@link RowWarningCache} needs — structurally
 *  satisfied by `CompositeAuthoringAdapter`/`R3fSourceAuthoringAdapter` without
 *  importing either, and honestly absent on every adapter that runs no source
 *  analyzer (which then shows no badges, rather than fabricated ones). */
export interface RowDiagnosticsSource {
  readonly diagnosticsFor?: ((id: string) => readonly RowDiagnostic[] | undefined) | undefined;
}

/**
 * Memoized {@link rowWarningBadge} per row id, with the SAME invalidation
 * contract as {@link TransformLockCache} — `(source identity, version)`, where
 * `GameHierarchy` passes the same `store.getSnapshot() + adapterVersion` key to
 * both.
 *
 * That key is exactly right for H5 and not by coincidence: diagnostics arrive
 * on the OID index, and the R3F adapter's `refreshSourceState()` calls
 * `store.notifyIngestEdit()` the moment a new index lands — which bumps the
 * store `_version` that is half this key. So a fresh index invalidates these
 * badges by construction, on the same tick, through the path every source-write
 * and HMR remount already funnels through.
 *
 * Worth caching even though the adapter's own lookup is two map reads: on a
 * composite it is a `route(id)` ownership walk, and the badge object plus its
 * joined tooltip string would otherwise be reallocated for every row on every
 * render.
 */
export class RowWarningCache {
  private entries = new Map<string, RowWarningBadge | null>();
  private source: RowDiagnosticsSource | null = null;
  private version = Number.NaN;
  /** Test-visible: how many times the adapter was actually probed. */
  private computed = 0;

  get computeCount(): number {
    return this.computed;
  }

  badgeFor(source: RowDiagnosticsSource, version: number, id: string): RowWarningBadge | null {
    if (this.source !== source || this.version !== version) {
      this.entries.clear();
      this.source = source;
      this.version = version;
    }
    const cached = this.entries.get(id);
    if (cached !== undefined) return cached;
    this.computed++;
    const badge = source.diagnosticsFor ? rowWarningBadge(source.diagnosticsFor(id)) : null;
    this.entries.set(id, badge);
    return badge;
  }
}
