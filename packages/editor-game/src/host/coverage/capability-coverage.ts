/**
 * CAPABILITY COVERAGE — one derivation over whichever protocol families a
 * mounted subject can honestly measure.
 *
 * ## The defect this closes
 *
 * An ingested game that declares no integration seams does not fail. It
 * mounts, it draws, and the editor simply … has less: ▶ does not control its
 * frames, an edit cannot be written anywhere. Every one of those is measured somewhere in this
 * codebase already — `adapter-reach.ts` measures what the editor reaches,
 * `ingest/same-realm-loop-gate.ts`
 * probes the loop, `game-contract.ts` reads the declared endpoints (its
 * `systems` surface included, which `adapter/ingest/contract-debug-adapter.ts`
 * projects onto `game.commands()`/`game.state()`),
 * `authoring/ingest-source-persistence.ts` asks the server who owns the bytes —
 * and none of it was ever ASSEMBLED into one answer a reader could act on. The
 * absence stayed silent, so the user's model of "what this editor can do"
 * quietly diverged from the truth per game.
 *
 * This began as the shelf-badge derivation (ARCHITECTURE-CORE §Foreign games: a
 * capability list "DERIVED, never hand-written, from all five seam families")
 * built early and pointed at the LIVE mount instead of a gallery card. It now
 * receives authoring reach from each mounted root, observation from the game
 * and system registry, and verbs from the project. A family the subject does
 * not own is omitted and produces no placeholder rows.
 *
 * ## The rules it is written under
 *
 * - **Every row is a measurement.** Nothing here consults the route, the
 *   manifest's promises, or the game's id. There is no per-game text of any
 *   kind — a row's words come from the seam vocabulary plus values the probes
 *   actually returned. A game this file has never heard of gets the same
 *   report as one it has.
 * - **Unmeasured is its own answer.** A probe that has not run yet reports
 *   `info`, never `ok` and never `gap` — a verdict is a measurement with a
 *   timestamp (`ingest/same-realm-loop-gate.ts`), and the honest report of a missing
 *   measurement is "not measured", with what was looked at.
 * - **A fix names a mechanism, not an aspiration.** Where the only mechanism
 *   is one that does not exist yet, the row says so in those words rather
 *   than implying the user has a move they do not have.
 *
 * Pure and injectable — every input arrives as data, so the whole derivation
 * is unit-testable with no browser (`packages/editor/test/capability-coverage.test.ts`).
 * `ingest/mount-coverage.ts` assembles the facts from the live singletons.
 */

import { commandLine } from '@volter/editor-core/product-command';
import type {
  AuthoringProviderKey,
  SeamEvidenceVerdict,
  WriteAnchorKind,
} from '@volter/editor-project/adapter';
import { WRITE_ANCHOR_KINDS } from '@volter/editor-project/adapter';
import type { AdapterSurface } from '@volter/editor-project/adapter/adapter-surface';
import type { VgaiGameContract } from '@volter/editor-project/adapter/ingest/game-contract';
import type { SystemAdapters } from '@volter/editor-project/adapter/system-adapter';
import { SYSTEM_ADAPTERS_SHAPE } from '@volter/editor-project/adapter/system-seam-contract';
import {
  type AdapterReach,
  AUTHORING_PROVIDER_KEYS,
  CAPTURE_GAP,
  HIERARCHY_RECIPROCITY_GAP,
  notApplicableReason,
  PROVIDER_GAP,
} from '../adapter-reach';
import {
  type GameContractEvidence,
  inspectGameContractSeams,
} from './game-contract-seam-evidence';
import type { MeasuredLoop } from '../same-realm-loop-gate';
import {
  assertCoverageReconciles,
  deriveCoverageAccounting,
  formatCoverageGapHeadline,
} from './coverage-accounting';

export type { CoverageAccounting, CoverageAccountingRow } from './coverage-accounting';
export {
  assertCoverageReconciles,
  coverageSeamFamily,
  deriveCoverageAccounting,
  formatCoverageGapHeadline,
} from './coverage-accounting';

/**
 * The seams a report can speak about.
 *
 * The `editor.*` family is GENERATED — it is the `AuthoringAdapter` provider
 * vocabulary (`@volter/editor-project/adapter/authoring`'s `AUTHORING_PROVIDER_KEYS`, which
 * the compiler pins to the interface) plus the one non-provider fact,
 * `editor.capture`. A capability nobody remembered to enumerate therefore still
 * gets a row.
 *
 * The rest are contract facts about an ingested game — declarations only a
 * `window.vgaiGame` can make — and they grow with the contract; nothing
 * switches exhaustively on this type, so no consumer breaks when it does.
 */
export type CapabilityCoverageSeam =
  | 'editor.capture'
  | `editor.${AuthoringProviderKey}`
  | 'loop'
  | 'contract.root'
  | 'contract.lifecycle.start'
  | 'contract.lifecycle.pause'
  | 'persistence'
  | 'systems'
  | `system.${SystemAdapterSlot}`
  | `project.${ProjectVerbSlot}`
  | 'authoring.scenes'
  | 'authoring.pieces';

/** The `SystemAdapters` slots. The type is `keyof SystemAdapters`, so a slot
 *  added to the contract cannot be forgotten here. */
export type SystemAdapterSlot = keyof SystemAdapters;

/**
 * THE NATIVE VERBS THAT LIVE OUTSIDE BOTH DERIVED FAMILIES.
 *
 * `editor.*` is generated from the `AuthoringAdapter` contract and `system.*`
 * from `SystemAdapters`, so between them they exhaust what an ADAPTER can be
 * asked. This capability is not an adapter's to answer at all — it is a fact
 * about the PROJECT, and a project can be green in both other families while
 * lacking it:
 *
 *  - `export` — whether this project can produce the standalone build that is
 *    the ONLY way it runs outside the editor.
 *
 * There is no interface to pin this list to, so it is a literal — which is why
 * it is a `Record` (a slot dropped from the vocabulary fails to compile against
 * the union) and why the pure rules that fill it live in one file with one
 * test (`coverage/project-verb-coverage.ts`).
 */
export type ProjectVerbSlot = 'export';

const PROJECT_VERB_PRESENCE: Readonly<Record<ProjectVerbSlot, true>> = {
  export: true,
};

export const PROJECT_VERB_SLOTS: readonly ProjectVerbSlot[] = Object.keys(
  PROJECT_VERB_PRESENCE,
) as ProjectVerbSlot[];

/**
 * Report ORDER for those slots — a property of the report (two reports of the
 * same mount stay diffable line for line), and pinned to the type by the
 * `Record` below, so the order list cannot silently omit a slot the way a bare
 * array literal could.
 */
export const SYSTEM_ADAPTER_SLOTS = Object.keys(SYSTEM_ADAPTERS_SHAPE) as SystemAdapterSlot[];

/**
 * One seam's verdict.
 *
 *  - `ok`   — the seam is there and the editor functionality it unlocks works.
 *  - `gap`  — MEASURED absent; `missing` says what the editor therefore cannot
 *             do and `fix` names the mechanism that would close it.
 *  - `na`   — absent BY DESIGN for this root's surface kind, with the reason in
 *             `detail`. Never a way to be quiet about a real absence: the N-A
 *             set is a small per-surface table (`adapter-reach.ts`'s
 *             `SURFACE_NOT_APPLICABLE`), and anything not in it is a `gap`.
 *  - `info` — measured, but not a pass/fail: a fact the reader needs (what was
 *             registered, what has not been probed yet, what could not be
 *             looked at).
 */
export interface CapabilityCoverageRow {
  readonly seam: CapabilityCoverageSeam;
  readonly status: 'ok' | 'gap' | 'na' | 'info';
  /** What was measured, in the measurement's own terms. Always present —
   *  a row with no evidence behind it has no business existing. */
  readonly detail: string;
  /** The editor functionality this gap disables, in plain language. */
  readonly missing?: string;
  /** The named mechanism that fills it. */
  readonly fix?: string;
  /**
   * WHO made an `empty` row's statement — the game's own declaration, or the
   * host's inference. Structured (not only flattened into `detail`) so
   * consumers can COUNT host inferences: a header reading "0 unanswered"
   * above rows the game never answered was the measured misleading case.
   */
  readonly attestedBy?: 'game' | 'host';
}

export interface CapabilityCoverageSummary {
  readonly worldId: string;
  readonly rows: number;
  readonly gaps: number;
  readonly ok: number;
  readonly na: number;
  readonly info: number;
}

export interface CapabilityCoverageReport {
  readonly summary: CapabilityCoverageSummary;
  readonly rows: readonly CapabilityCoverageRow[];
}

// ─────────────────────────────────────────────────────────── the measurements

/** The NAMES a declared `systems` surface exposes, in declaration order. Names
 *  rather than a count because the systems row prints them, and they are the
 *  same strings `game.commands()`/`game.providers()` list — still presence:
 *  nothing here ever calls a command's `run` or a provider's `read`. */
export interface SystemsPresence {
  readonly commands: readonly string[];
  readonly state: readonly string[];
}

/**
 * Which game→host contract endpoints this mount's realm actually declared.
 * Presence only — the contract's own doctrine is "capabilities by PRESENCE",
 * and this file never calls any of them.
 */
export interface ContractPresence {
  /** `readGameContract()` answered at all (a v1 `window.vgaiGame`). */
  readonly declared: boolean;
  readonly root: boolean;
  readonly start: boolean;
  readonly pause: boolean;
  readonly resume: boolean;
  /** The declared `systems` surface, or `null` when the contract names none. */
  readonly systems: SystemsPresence | null;
  readonly proof?: GameContractEvidence | null;
}

/** Fold a read contract (or its absence) into presence flags. */
export function measureGameContract(contract: VgaiGameContract | null): ContractPresence {
  const systems = contract?.systems;
  return {
    declared: contract !== null,
    root: contract?.root !== undefined,
    start: contract?.lifecycle?.start !== undefined,
    pause: contract?.lifecycle?.pause !== undefined,
    resume: contract?.lifecycle?.resume !== undefined,
    systems: systems
      ? {
          commands: (systems.commands ?? []).map((c) => c.name),
          state: (systems.state ?? []).map((p) => p.name),
        }
      : null,
    proof: contract ? inspectGameContractSeams({ contract }) : null,
  };
}

/**
 * The server's answer about who owns this session's base, as
 * `authoring/ingest-source-persistence.ts` caches it. `null` means the
 * question has not been answered yet — and unknown is NOT writable there, so
 * it is not writable here either; it is `info`.
 */
export interface OwnershipFacts {
  readonly writable: boolean;
  /** The server's own words for why not. */
  readonly reason: string | null;
  /** The server's own words for who records the diff a write produces. `null`
   *  when it did not say — which is only ever the not-writable case. */
  readonly recorder?: string | null;
}

/**
 * What the mount's own authoring adapter MEASURED about its world's reach into
 * source: how many projected nodes have a real write address, out of how many
 * exist, and where a write would land when one does.
 */
export interface WriteReachFacts {
  readonly addressable: number;
  readonly total: number;
  /** The persistence backend's own `destination()` phrase, shown verbatim. */
  readonly destination: string;
  /**
   * The same nodes, counted by the LANE their write would take
   * (`WriteAnchorKind`). Derived from the same planning call `addressable` is,
   * so the two cannot disagree.
   *
   * Why a bare count is not enough: "12 of 37 resolve to a source address"
   * reads healthy while every one of the 12 belongs to one lane and a whole
   * other lane — a world's physics-placed cargo, or its level-data records —
   * goes unwritten and unexercised. A per-kind tally is what makes an
   * exhaustive walk possible; `vgai doctor`'s edit-write phase is its reader.
   *
   * Optional, because callers older than the vocabulary supply none and a
   * fabricated zero for every kind would read as a measurement.
   */
  readonly byKind?: Readonly<Record<WriteAnchorKind, number>>;
}

/**
 * A declared data writer's terminal state — the OTHER half of "can an edit be
 * written back here", for a game that holds part of its truth outside source.
 *
 * `dataFile` is present only when the writer is `ready`, because until the
 * module loads nobody knows which file it names; a surface that printed one
 * beforehand would be printing the manifest's promise as a fact.
 */
export interface DataWriterFacts {
  readonly state: 'loading' | 'ready' | 'failed';
  readonly dataFile?: string;
  /** The loader's own words when it failed. */
  readonly reason?: string;
}

/**
 * One `SystemAdapters` slot's terminal state, MEASURED two ways and never
 * inferred from the route or the game's id:
 *
 *  - `bound` — the live editor-side registry (`authoring/active-systems.ts`)
 *    actually holds an adapter for this slot. That is the strongest available
 *    statement: it is the same object the editor's panels will call.
 *  - `empty` — the game POSITIVELY answered "I have no X" through
 *    `window.vgaiGame.systems.systemAdapters` (`evidence` is its own words).
 *  - `malformed` — a declaration that could not be honoured; `evidence` is the
 *    projection's reason. Reported so a broken shim is loud, never silently
 *    read as either of the two terminal states.
 *  - `unanswered` — nothing bound and nothing declared. The only state that is
 *    a work order.
 */
export interface SystemAdapterMeasurement {
  readonly slot: SystemAdapterSlot;
  readonly state: 'bound' | 'empty' | 'malformed' | 'unanswered';
  /** The game's absence evidence, or the projection's rejection reason. */
  readonly evidence?: string;
  /** Bound-object availability is not operational proof. */
  readonly proof?: SeamEvidenceVerdict | undefined;
  /**
   * The mechanism that would close this slot, in the MEASURER's own words —
   * supplied when the lane that produced the measurement knows a fix the
   * shared default would state wrongly.
   *
   * This is what keeps the derivation provenance-NEUTRAL. The default fix text
   * below names `window.vgaiGame.systems…`, which is true of a game that
   * declares a contract and false of a first-party one; rather than have the
   * row builder ask WHO produced the measurement, the measurement carries the
   * answer as a fact (`coverage/system-adapter-coverage.ts` supplies it for a
   * native mount; the ingested lane supplies none and gets the contract text).
   */
  readonly fix?: string;
  /**
   * WHO answered an `empty`: the GAME (an `absent(reason)` declaration, or an
   * ingested game's `{ present: false, evidence }` record) or the HOST (the
   * editor's own inference from an unfilled slot on a live mount).
   *
   * Both are legitimate and both are terminal, but they are not the same claim,
   * and the row must not print one as the other — a host inference wearing the
   * game's voice attributes to a game a statement it never made. Absent means
   * `'game'`: the ingest lane's `empty` IS the game's declaration, and that was
   * this field's only producer before the native lane could derive one.
   */
  readonly attestedBy?: 'game' | 'host';
}

/**
 * One `project.*` verb's terminal state — THREE states, and the split between
 * the last two is the whole point:
 *
 *  - `present` — the project declares the thing the verb reads, and `evidence`
 *    quotes it.
 *  - `absent` — MEASURED absent: the file was read and the declaration is not
 *    in it. A standing work order.
 *  - `unanswered` — nobody looked yet (no server to ask, the fetch has not
 *    landed). Never a gap and never an `ok`: `evidence` says what could not be
 *    read, so an unread fact can never be mistaken for a clean bill of health.
 *
 * Same shape and same reason as {@link SystemAdapterMeasurement}: the measurer
 * carries its own words, so the row builder below never asks who produced it.
 */
export interface ProjectVerbMeasurement {
  readonly slot: ProjectVerbSlot;
  readonly state: 'present' | 'absent' | 'unanswered';
  /** What was measured, in the measurement's own terms. Always present — a row
   *  with no evidence behind it has no business existing. */
  readonly evidence: string;
  /** Result of executing the real project verb, when Doctor or the verb itself
   * has produced one. A package.json key by itself is not proof. */
  readonly proof?: SeamEvidenceVerdict | undefined;
  /** What the project therefore cannot do. Absent states only. */
  readonly missing?: string;
  /** The named mechanism that fills it. Absent states only. */
  readonly fix?: string;
}

/**
 * The facts one capability subject can honestly answer. Families are optional:
 * a mounted root supplies authoring reach, the game supplies runtime facts, the
 * system registry supplies adapters, and the project supplies verbs. Omission
 * means "this is not my question" and produces no row; an explicit `null`
 * means the family measured the question and has no answer yet.
 */
export interface CapabilityCoverageFacts {
  readonly worldId: string;
  /** What this mount's authoring surface actually reached, per editor
   *  capability (`adapter-reach.ts`) — `null` before anything has measured it.
   *  There is nothing to compare it against: the bar is "everything", so a
   *  false here is a gap whatever route produced it. */
  readonly reach?: AdapterReach | null;
  /**
   * The root's SURFACE kind, which is what decides whether an absent provider is
   * a gap or absent-by-design (`adapter-reach.ts`'s `SURFACE_NOT_APPLICABLE`).
   * `null` ⇒ the caller could not say, and NOTHING is excused — an unknown
   * surface reports every absence as a gap rather than inventing an exemption.
   */
  readonly surface?: AdapterSurface | null;
  /** How this mount reached (or failed to reach) the game's runtime — the
   *  capture route in the mount's own words. Diagnosis a reader needs to act
   *  on a fix, never a verdict about how much is acceptable. */
  readonly reachMechanism?: string | null;
  /**
   * The MEASURED loop verdict AND the evidence behind it
   * (`ingest/same-realm-loop-gate.ts`'s `MeasuredLoop`); `null` before the probe
   * has ever run — or on a route that installs no gate, where
   * {@link loopReason} says so.
   *
   * A pair rather than the bare word because `'gated'`/`'self-driven'` is also
   * the manifest's DECLARED intent vocabulary, and this report may only ever
   * speak the measured one: see that type's doc comment.
   */
  readonly loop?: MeasuredLoop | null;
  /** The probe's own words — or, when `loop` is `null`, why there is no verdict
   *  to report. `null` means the probe simply has not run yet. */
  readonly loopReason?: string | null;
  readonly contract?: ContractPresence;
  readonly ownership?: OwnershipFacts | null;
  /**
   * How much of the MOUNTED WORLD an edit can be written back to — `null` when
   * nothing measured it (a route with no three authoring surface).
   *
   * Separate from {@link ownership} because they answer different questions and
   * the row needs both: ownership is about the FOLDER (may these bytes be
   * written, and who records the diff), reach is about the OBJECTS (does any of
   * them have a source address at all). A writable folder whose every object is
   * unaddressable is precisely the state the persistence row used to report as
   * `ok` — measured on a react-three-fiber game, where every object is
   * constructed inside `node_modules` and no creation site in the game's own
   * source names one.
   */
  readonly writeReach?: WriteReachFacts | null;
  /** The state of this game's DECLARED data writer, or `null` when it declares
   *  none — which is the ordinary case and not a gap: most games hold nothing
   *  authorable outside their source. */
  readonly dataWriter?: DataWriterFacts | null;
  /** A completed write→source→cold-remount→revert proof. Ownership and source
   * addressability alone are only preconditions. */
  readonly persistenceProof?: SeamEvidenceVerdict | undefined;
  /** One entry per `SystemAdapters` slot. An EMPTY array means the caller had
   *  no live mount to ask, and the rows say so rather than reporting six gaps
   *  against a mount that does not exist. */
  readonly systemAdapters?: readonly SystemAdapterMeasurement[];
  /** One entry per native verb (`coverage/project-verb-coverage.ts`). EMPTY
   *  means this caller's subject is not a project — the same convention
   *  {@link CapabilityCoverageFacts.systemAdapters} uses, and for the same reason:
   *  three fabricated gaps are worse than no rows. */
  readonly projectVerbs?: readonly ProjectVerbMeasurement[];
  /** The visible Edit tabs and Content pieces derived from the project's
   * resolved scene table. `null` means the table is not measurable yet. */
  readonly authoringSurface?: AuthoringSurfaceFacts | null;
}

export interface AuthoringSurfaceFacts {
  readonly sceneDocuments: number;
  readonly isolationDocuments: number;
  readonly openIsolationDocuments: number;
  readonly availableIsolationDocuments: number;
  readonly pieces: number;
  readonly sceneEntries: number;
}

/** Required only inside the row rules. Public callers never manufacture this
 * shape; {@link deriveCapabilityCoverage} normalizes the families they did
 * supply and invokes only those families. */
type ResolvedCoverageFacts = Required<CapabilityCoverageFacts>;

// ───────────────────────────────────────────────────────── the fix vocabulary

/**
 * The route for a game whose bytes may not be touched — which is EVERY
 * repo-vendored ingest, by doctrine. "Declare `window.vgaiGame.root`" is the
 * mechanism, but a game nobody may edit cannot declare anything, so a fix that
 * stopped there would be telling the reader to do something they are not
 * allowed to do. Both host-side carriers now exist, so this names them and
 * where to put one.
 */
const UNMODIFIABLE_ROUTE =
  'a game whose bytes must stay unmodified declares it from a host-side carrier ' +
  'instead — a contract shim beside the game (`ingest.contractShim` in its ' +
  'vgai.project.json, injected ahead of the game`s entry module; see ' +
  'public/ingest/simcity/vgai.shim.js) or a recorded patch';

const CONTRACT_FIX = (endpoint: string): string =>
  `declare ${endpoint} in the game's own entry; ${UNMODIFIABLE_ROUTE}`;

// ────────────────────────────────────────────────────────────── the row logic

/**
 * THE GENERATED FAMILY — one row per member of the authoring contract, plus the
 * capture fact they all stand on.
 *
 * The bar is a native root's own capability, so there is nothing to compare
 * against and no summary verdict to compute: a capability this root did not
 * reach is a `gap` that keeps being reported for as long as it is missing, one
 * it did reach is silent-adjacent (`ok`), and one its surface cannot have is
 * `na` WITH THE REASON. The route that produced the mount appears only inside
 * `detail`, as the mechanism a reader has to act on.
 *
 * Nothing in here names a provider: the loop is over
 * `AUTHORING_PROVIDER_KEYS`, so this function does not change when the contract
 * grows, and a provider that reaches the contract without reaching this report
 * is impossible by construction.
 */
function editorSurfaceRows(facts: ResolvedCoverageFacts): readonly CapabilityCoverageRow[] {
  const because = facts.reachMechanism ? ` — ${facts.reachMechanism}` : '';
  if (facts.reach === null) {
    return [
      {
        seam: 'editor.capture',
        status: 'info',
        detail: 'no mount has measured what the editor reaches on this root yet',
      },
      ...AUTHORING_PROVIDER_KEYS.map(
        (key): CapabilityCoverageRow => ({
          seam: `editor.${key}`,
          status: 'info',
          detail: `no mount has measured whether this root exposes ${key} yet`,
        }),
      ),
    ];
  }
  const reach = facts.reach;
  const captureRow: CapabilityCoverageRow = reach.captured
    ? reach.captureEvidence?.state === 'verified'
      ? {
          seam: 'editor.capture',
          status: 'ok',
          // The VERDICT'S OWN sentence, not a restatement of it. The walk
          // reports how many nodes it visited and whether the budget bounded
          // it, and a reader checking a "0 gaps" report needs that number —
          // a generic "exercised its hierarchy" reads identically over a
          // twelve-node scaffold and a truncated 24,000-node translation.
          detail: `the editor reached this root's own runtime and exercised its hierarchy — ${reach.captureEvidence.detail}${because}`,
        }
      : reach.captureEvidence?.state === 'failed'
        ? {
            seam: 'editor.capture',
            status: 'gap',
            detail: `an authoring object was captured, but its hierarchy seam failed — ${reach.captureEvidence.detail}${because}`,
            // NOT `CAPTURE_GAP`: the editor DID reach this root. Spending the
            // never-reached words here told a reader with a working hierarchy
            // panel that "not one object in it can be listed" and pointed them
            // at a bare `import 'three'` their game already has — a row that
            // reads as a false alarm and teaches readers to skip the report.
            missing: HIERARCHY_RECIPROCITY_GAP.missing,
            fix: HIERARCHY_RECIPROCITY_GAP.fix,
          }
        : {
            seam: 'editor.capture',
            status: 'info',
            // Reachable only when NO hierarchy operation was recorded at all
            // — an injected fixture, or a reach measured without the read
            // probe. Every live mount runs the probe, so a `--template game`
            // scaffold reading this line is the bug, not the honest answer;
            // it was the permanent answer until `captureEvidence` stopped
            // reading the hierarchy CARRIER grade (`adapter-reach.ts`).
            detail: `an authoring object was captured, but no current-epoch hierarchy operation proves it projects this root's runtime${
              reach.captureEvidence ? ` — ${reach.captureEvidence.detail}` : ''
            }${because}`,
          }
    : {
        seam: 'editor.capture',
        status: 'gap',
        detail: `the editor never reached this root's runtime${because}`,
        missing: CAPTURE_GAP.missing,
        fix: CAPTURE_GAP.fix,
      };
  const providerRows = AUTHORING_PROVIDER_KEYS.map((key): CapabilityCoverageRow => {
    const seam = `editor.${key}` as const;
    const evidence = reach.providerEvidence?.[key];
    const naReason = notApplicableReason(facts.surface, key);
    if (!reach.providers[key] && naReason !== null) {
      return {
        seam,
        status: 'na',
        detail: `not applicable to a ${facts.surface} root — ${naReason}`,
      };
    }
    if (evidence?.state === 'verified') {
      return { seam, status: 'ok', detail: evidence.detail };
    }
    if (evidence?.state === 'failed') {
      return {
        seam,
        status: 'gap',
        detail: `${key} is exposed but malformed or failed — ${evidence.detail}${because}`,
        missing: PROVIDER_GAP[key].missing,
        fix: PROVIDER_GAP[key].fix,
      };
    }
    if (reach.providers[key]) {
      return {
        seam,
        status: 'info',
        detail:
          evidence?.detail ?? `this root exposes ${key}, but no operational proof was recorded`,
      };
    }
    return {
      seam,
      status: 'gap',
      detail: `this root exposes no ${key} provider${because}`,
      missing: PROVIDER_GAP[key].missing,
      fix: PROVIDER_GAP[key].fix,
    };
  });
  return [captureRow, ...providerRows];
}

/**
 * Does anything in this editor control the game's frames?
 *
 * TWO mechanisms can answer it, and the row must read the one the ingest
 * adapter ACTUALLY bound: the game's own declared `lifecycle.pause`/`resume`
 * pair, otherwise the host's outside-in gate. So a
 * game that declares both HAS answered this capability — the gate's verdict is
 * then a fact about a fallback nobody is using, and reporting it as a gap makes
 * this report contradict itself two rows down (the shape a live mount of a
 * pause-declaring game produced: `contract.lifecycle.pause ✓` beside
 * `loop ✗ declare lifecycle.pause`).
 *
 * The gate verdict is the answer only for a game with no declared pause, and
 * `null` there is genuinely unmeasured — never a gap.
 */
function loopRow(facts: ResolvedCoverageFacts): CapabilityCoverageRow {
  const because = facts.loopReason ? ` — ${facts.loopReason}` : '';
  const { pause, resume } = facts.contract;
  if (
    pause &&
    resume &&
    facts.contract.proof?.pause.state === 'verified' &&
    facts.contract.proof.resume.state === 'verified'
  ) {
    return {
      seam: 'loop',
      status: 'ok',
      detail:
        "the game's own declared lifecycle.pause + resume control its frames, and that is what " +
        `▶/⏸ call${facts.loopReason ? ` (the host's fallback gate, unused here, reports: ${facts.loopReason})` : ''}`,
    };
  }
  if (facts.loop?.verdict === 'gated') {
    return { seam: 'loop', status: 'ok', detail: `gated${because}` };
  }
  if (facts.loop?.verdict === 'self-driven') {
    return {
      seam: 'loop',
      status: 'gap',
      detail: `self-driven${because}`,
      missing:
        "nothing in this editor controls the game's frames: ▶/⏸ and Step do not stop it, and " +
        'Edit mode cannot be quiet — it keeps simulating while you author',
      fix: CONTRACT_FIX('window.vgaiGame.lifecycle.pause + resume'),
    };
  }
  // No verdict, and that is its own answer — never a gap. The caller supplies
  // the truth for its own route when there is one (a route with no gate at all
  // says so); the pending sentence is the fallback for a route that really does
  // have a gate waiting to be probed.
  return {
    seam: 'loop',
    status: 'info',
    detail:
      facts.loopReason ??
      'no loop verdict has been measured yet — the probe runs at the first pause',
  };
}

function contractRootRow(facts: ResolvedCoverageFacts): CapabilityCoverageRow {
  if (facts.contract.root) {
    if (facts.contract.proof?.root.state === 'failed') {
      return {
        seam: 'contract.root',
        status: 'gap',
        detail: `the game declares a root, but the seam failed — ${facts.contract.proof.root.detail}`,
        missing:
          'the host cannot trust that the declared element owns the game DOM rather than an unrelated or detached subtree',
        fix: CONTRACT_FIX('window.vgaiGame.root'),
      };
    }
    return {
      seam: 'contract.root',
      status: facts.contract.proof?.root.state === 'verified' ? 'ok' : 'info',
      detail:
        facts.contract.proof?.root.state === 'verified'
          ? facts.contract.proof.root.detail
          : 'the game declares a root element, but no consumer has proved it owns the mounted game DOM',
    };
  }
  return {
    seam: 'contract.root',
    status: 'gap',
    detail: facts.contract.declared
      ? 'a contract is declared, but it names no root element'
      : 'no game→host contract is declared at all',
    missing:
      'the host adopts the bare canvas, so any DOM this game owns beside it (HUD, overlays, ' +
      'portals) is stranded at page level over the editor chrome instead of living in the ' +
      'game pane',
    fix: CONTRACT_FIX('window.vgaiGame.root'),
  };
}

function contractStartRow(facts: ResolvedCoverageFacts): CapabilityCoverageRow {
  if (facts.contract.start) {
    if (facts.contract.proof?.start.state === 'failed') {
      return {
        seam: 'contract.lifecycle.start',
        status: 'gap',
        detail: `lifecycle.start is declared but failed — ${facts.contract.proof.start.detail}`,
        missing:
          'the mount cannot prove it starts cold and enters a session only when Play requests one',
        fix: CONTRACT_FIX('window.vgaiGame.lifecycle.start'),
      };
    }
    return {
      seam: 'contract.lifecycle.start',
      status: facts.contract.proof?.start.state === 'verified' ? 'ok' : 'info',
      detail:
        facts.contract.proof?.start.state === 'verified'
          ? facts.contract.proof.start.detail
          : 'the game declares lifecycle.start, but no current-epoch effect proves that ▶ starts the session',
    };
  }
  return {
    seam: 'contract.lifecycle.start',
    status: 'gap',
    detail: facts.contract.declared
      ? 'a contract is declared, but it names no lifecycle.start'
      : 'no game→host contract is declared at all',
    missing:
      'the mount cannot be COLD: this game runs its session side-effects (backend ' +
      'connections, audio, narrative) as it loads, so opening it in the editor starts ' +
      'playing it, and ▶ is a wire event the game may ignore',
    fix: CONTRACT_FIX('window.vgaiGame.lifecycle.start'),
  };
}

/**
 * What falling back to the host's loop gate actually costs — DERIVED from the
 * measured loop verdict, not asserted.
 *
 * This row used to state flatly that the host gate "cannot reach a raw
 * requestAnimationFrame loop at all", which was true before the gate existed and
 * is now the opposite of what the probe measures: the same report would print
 * `loop ✓ gated` two lines above this row's claim that ⏸ does not work. Two rows
 * of one report contradicting each other about one mechanism is exactly the
 * dishonesty the coverage derivation exists to end, so the fallback's cost is
 * read off the same measurement the loop row reads.
 */
function pauseFallbackCost(facts: ResolvedCoverageFacts): string {
  if (facts.loop?.verdict === 'gated') {
    return (
      "pausing this game is the host's outside-in loop gate only. That gate is MEASURED to hold " +
      'the work this game schedules, so ⏸ does stop it — but a host reaching in is not the game ' +
      'quieting itself: anything it drives from outside its own scheduling (a worker, a socket, ' +
      'a media callback) keeps running, and it gets no chance to stop its audio, drop its ' +
      'connections, or checkpoint before the pause'
    );
  }
  if (facts.loop?.verdict === 'self-driven') {
    return (
      "pausing this game is the host's outside-in loop gate only, and that gate is MEASURED not " +
      'to control this loop — so ⏸ may freeze the picture while the game keeps running ' +
      'underneath it'
    );
  }
  return (
    "pausing this game is the host's outside-in loop gate only, and no probe has measured " +
    'whether that gate reaches this loop yet — so ⏸ may freeze the picture while the game keeps ' +
    'running underneath it'
  );
}

function contractPauseRow(facts: ResolvedCoverageFacts): CapabilityCoverageRow {
  const { pause, resume, declared } = facts.contract;
  if (pause && resume) {
    const pauseVerified = facts.contract.proof?.pause.state === 'verified';
    const resumeVerified = facts.contract.proof?.resume.state === 'verified';
    const failed = [facts.contract.proof?.pause, facts.contract.proof?.resume].find(
      (proof) => proof?.state === 'failed',
    );
    if (failed) {
      return {
        seam: 'contract.lifecycle.pause',
        status: 'gap',
        detail: `pause/resume is declared but failed — ${failed.detail}`,
        missing: pauseFallbackCost(facts),
        fix: CONTRACT_FIX('window.vgaiGame.lifecycle.pause + resume'),
      };
    }
    return {
      seam: 'contract.lifecycle.pause',
      status: pauseVerified && resumeVerified ? 'ok' : 'info',
      detail:
        pauseVerified && resumeVerified
          ? 'the mounted lifecycle exercised both declared pause + resume effects'
          : 'the game declares pause + resume, but declaration alone does not prove either changes its frames',
    };
  }
  const half = missingPauseHalf(pause, resume);
  return {
    seam: 'contract.lifecycle.pause',
    status: 'gap',
    detail: half
      ? `the contract declares ${half} — the host needs both to hand control back`
      : declared
        ? 'a contract is declared, but it names no lifecycle.pause/resume'
        : 'no game→host contract is declared at all',
    missing: pauseFallbackCost(facts),
    fix: CONTRACT_FIX('window.vgaiGame.lifecycle.pause + resume'),
  };
}

function missingPauseHalf(pause: boolean, resume: boolean): string | null {
  if (pause) return 'lifecycle.pause without a resume';
  if (resume) return 'lifecycle.resume without a pause';
  return null;
}

/**
 * THE MEASUREMENT BEATS THE PERMISSION.
 *
 * A writable base is a fact about the FOLDER; it says nothing about whether any
 * object in the world that is actually mounted has a source address. On a
 * react-three-fiber game every object is constructed inside `node_modules`, so
 * the creation-site index knows none of them — and the persistence row read
 * `ok` over a world where not one edit could ever leave the session. Reported
 * reach of ZERO is a gap however writable the folder is, and the mechanism is
 * named so the reader can act on it.
 */
/**
 * The per-lane breakdown, in vocabulary order — `` when the measurement carries
 * none, and only the kinds this world actually has, because a row that printed
 * `data-record 0` for every game would bury the two counts that matter.
 */
function byKindLeg(reach: WriteReachFacts | null): string {
  const byKind = reach?.byKind;
  if (!byKind) return '';
  const named = WRITE_ANCHOR_KINDS.filter((kind: WriteAnchorKind) => (byKind[kind] ?? 0) > 0).map(
    (kind: WriteAnchorKind) => `${kind} ${byKind[kind]}`,
  );
  // "lane", not "anchor": a node can belong to a lane whose ADDRESS this tier
  // has not resolved (a stamped object the client index has not answered for
  // yet still writes through the server), so the two counts are not the same
  // question and the row must not read as though they were.
  return named.length > 0 ? ` (by write lane: ${named.join(', ')})` : '';
}

function unreachableWorldRow(reach: WriteReachFacts): CapabilityCoverageRow {
  return {
    seam: 'persistence',
    status: 'gap',
    detail:
      `this game's base is writable, but NONE of the ${reach.total} object(s) the editor ` +
      `projects from the mounted world has a source address — every edit stays ${reach.destination}` +
      byKindLeg(reach),
    missing:
      'nothing you change here survives the session: the base may be written, but no line of ' +
      "this game's own source is known to address any object in it",
    fix:
      "serve this game's own source through the editor's authoring transform so its elements " +
      'carry source stamps (a JSX world), or give it construction sites the creation-site ' +
      "index can see (a `new` expression in the game's own served module)",
  };
}

/** The writable-base row, where the two destinations a game can have are
 *  spelled out. Split out of {@link persistenceRow} for readability only — the
 *  conditions are unchanged. */
function writableBaseRow(
  ownership: OwnershipFacts,
  reach: WriteReachFacts | null,
  data: DataWriterFacts | null,
  proof: SeamEvidenceVerdict | undefined,
): CapabilityCoverageRow {
  const recorder = ownership.recorder ?? 'whatever records this folder';
  const reachLeg = reach
    ? `; ${reach.addressable} of ${reach.total} projected object(s) resolve to one, and the rest are runtime or library parts with no source of their own${byKindLeg(reach)}`
    : '';
  // TWO destinations, and a game can have both. Source write-back reaches
  // whatever a `new` expression or a JSX literal spells; a declared data writer
  // reaches what the game placed from its own level file and no literal
  // mentions. Naming only the first would report a game as less writable than
  // it is — and naming the second where none is declared would be the opposite
  // lie, which is why this reads the writer's real state rather than assuming
  // one.
  const dataStalled = data !== null && data.state !== 'ready';
  const dataLeg = writableDataLeg(data);
  if (proof?.state === 'failed') {
    return {
      seam: 'persistence',
      status: 'gap',
      detail: `the write path is addressable, but its round trip failed — ${proof.detail}`,
      missing:
        'the editor can issue a write but cannot trust that the game source and a cold remount reflect it',
      fix: 'fix the failing write receipt named above; provider presence and a write acknowledgement are not persistence',
    };
  }
  return {
    seam: 'persistence',
    status: dataStalled ? 'gap' : proof?.state === 'verified' ? 'ok' : 'info',
    detail:
      "this game's base is writable, so an edit can be written back to the line of its own " +
      `source that built the object${reachLeg}${dataLeg}; the diff is recorded in ${recorder}` +
      (proof?.state === 'verified'
        ? `; ${proof.detail}`
        : '; no current-epoch cold-remount round trip has verified that path'),
    ...(dataStalled
      ? {
          missing:
            'every object this game places from its own level data — its whole placed cargo — ' +
            'is unwritable while that writer is unreachable',
          fix: `make \`ingest.dataWriter\` loadable: ${data.reason ?? 'it has not resolved yet'}`,
        }
      : {}),
  };
}

function writableDataLeg(data: DataWriterFacts | null): string {
  if (data === null) return '';
  if (data.state === 'ready') {
    return `, and an object the game anchored to a record in ${data.dataFile} is written back into that file`;
  }
  const reason = data.reason ? ` (${data.reason})` : '';
  return `, but its declared data writer is ${data.state}${reason}, so an object anchored to a level-data record stays live-only`;
}

function persistenceRow(facts: ResolvedCoverageFacts): CapabilityCoverageRow {
  const { ownership } = facts;
  if (ownership === null) {
    return {
      seam: 'persistence',
      status: 'info',
      detail:
        "the editor has not asked who owns this game's source yet — until it answers, edits " +
        'stay live-only',
    };
  }
  const reach = facts.writeReach;
  if (ownership.writable && reach !== null && reach.addressable === 0) {
    return unreachableWorldRow(reach);
  }
  if (ownership.writable)
    return writableBaseRow(ownership, reach, facts.dataWriter, facts.persistenceProof);
  return {
    seam: 'persistence',
    status: 'gap',
    detail: `edits are live-only — ${ownership.reason ?? "this game's source is not writable"}`,
    missing:
      'nothing you change survives the session: no source write-back, and by doctrine no ' +
      'sidecar will ever be invented to fake one',
    fix:
      'open this game from a folder the editor can write — creation-site persistence needs a ' +
      'writable base (the server decides, not the editor)',
  };
}

/** `${n} thing(s)`, plus the names when there are any. */
function counted(noun: string, names: readonly string[]): string {
  return `${names.length} ${noun}(s)${names.length > 0 ? `: ${names.join(', ')}` : ''}`;
}

/**
 * The AGENT door. A declared `systems` surface is what
 * `contract-debug-adapter.ts` projects onto the host's `DebugAdapter`, so a
 * game that declares one can be enumerated, driven and read through the same
 * `game.commands()`/`game.state()` an agent already uses on first-party
 * content — and a game that declares none is not merely quiet there, it is
 * undrivable. That is a gap, measured the same way as the other contract rows:
 * an EMPTY surface counts as none, because the projection declines to build an
 * adapter over zero verbs and zero reads rather than serve an empty one.
 */
function systemsRow(facts: ResolvedCoverageFacts): CapabilityCoverageRow {
  const { systems, declared } = facts.contract;
  const commands = systems?.commands ?? [];
  const state = systems?.state ?? [];
  if (commands.length > 0 || state.length > 0) {
    if (facts.contract.proof?.systems.state === 'failed') {
      return {
        seam: 'systems',
        status: 'gap',
        detail: `the systems carrier is declared but failed — ${facts.contract.proof.systems.detail}`,
        missing:
          '`game.commands()` / `game.providers()` cannot safely enumerate or invoke this carrier',
        fix: CONTRACT_FIX('window.vgaiGame.systems (commands + state)'),
      };
    }
    return {
      seam: 'systems',
      status: facts.contract.proof?.systems.state === 'verified' ? 'ok' : 'info',
      detail:
        facts.contract.proof?.systems.state === 'verified'
          ? facts.contract.proof.systems.detail
          : `the game declares ${counted('command', commands)}; ${counted('state provider', state)}, but the agent door has not operationally enumerated/read them in this epoch`,
    };
  }
  return {
    seam: 'systems',
    status: 'gap',
    detail: systems
      ? 'the contract declares a systems surface that names no commands and no state providers'
      : declared
        ? 'a contract is declared, but it names no systems'
        : 'no game→host contract is declared at all',
    missing:
      'this game exposes no verbs and no state to drive or read it with: `game.commands()` and ' +
      '`game.providers()` enumerate nothing, so there is no `game.command(...)` to play it from ' +
      `${commandLine('eval')} and no \`game.state(...)\` for ${commandLine('status')} to see anything of what it is doing`,
    fix: CONTRACT_FIX('window.vgaiGame.systems (commands + state)'),
  };
}

/**
 * What each slot unlocks, in the editor's own terms — used ONLY to say what a
 * work-order row costs. Never a per-game sentence: the same words describe the
 * same missing slot on every mount, because the slot is what is missing.
 */
const SYSTEM_SLOT_COSTS: Record<SystemAdapterSlot, string> = {
  physics:
    'the editor cannot freeze a simulated body while the gizmo edits it, so a physics-driven ' +
    "object's pose is overwritten the next frame",
  networking:
    'the Network inspector shows nothing: no connection state, no room, no peers, and no ' +
    'authority answer to keep a server-owned object inspect-only',
  navigation: 'the Navigation panel has no navmesh to report, query a path through, or draw',
  audio:
    "⏸ cannot silence this world's audio and the Audio debugger has no graph, transport, meters " +
    'or events to show',
  camera:
    'the selected-camera Inspector cannot report which native camera/controller is active or whether a blend is in progress',
  // A getter: the product's command is known only once the page has asked
  // for it, well after this module loaded.
  get debug() {
    return (
      '`game.commands()` and `game.providers()` enumerate nothing, so there is no verb to drive ' +
      `this game with and no state read for ${commandLine('status')} to see`
    );
  },
  renderDebug:
    'the Frame debugger cannot capture a frame and the Profiler has no render-memory snapshot',
};

/**
 * The `debug` slot's fix is the contract's commands/state (the `systems` row
 * above owns that story in detail); every other game-declarable slot's fix is
 * the `systemAdapters` carrier. `renderDebug` is neither — it is engine-owned,
 * derived from a captured renderer, so a game cannot supply it and telling a
 * reader to declare one would be false.
 */
function systemSlotFix(slot: SystemAdapterSlot): string {
  if (slot === 'renderDebug') {
    return (
      'nothing a game declares reaches this slot — the host derives it from the captured ' +
      "renderer's own WebGL2 context (`ingest/ingest-render-debug.ts`), so a mount whose " +
      'renderer has no such context (a stub context) can never have it'
    );
  }
  if (slot === 'debug') {
    return CONTRACT_FIX('window.vgaiGame.systems (commands + state)');
  }
  return CONTRACT_FIX(`window.vgaiGame.systems.systemAdapters.${slot}`);
}

/**
 * ONE row per `SystemAdapters` slot — the ingestion bar's §F ("the full
 * surface, both modes") made checkable.
 *
 * The bar admits exactly two terminal states per slot, so exactly two states
 * here are `ok`: an adapter the live registry holds, and an absence the game
 * positively answered with evidence. Everything else is a work order.
 */
function systemAdapterRow(m: SystemAdapterMeasurement): CapabilityCoverageRow {
  const seam = `system.${m.slot}` as const;
  if (m.state === 'bound') {
    if (m.proof?.state === 'failed') {
      return {
        seam,
        status: 'gap',
        detail: `a ${m.slot} adapter is bound, but its contract failed — ${m.proof.detail}`,
        missing: SYSTEM_SLOT_COSTS[m.slot],
        fix: `fix the bound ${m.slot} adapter; registration is not evidence that its operations work`,
      };
    }
    if (m.proof?.state !== 'verified') {
      return {
        seam,
        status: 'info',
        detail:
          m.proof?.detail ??
          `a ${m.slot} adapter is installed, but no current-epoch operational proof was recorded`,
      };
    }
    return {
      seam,
      status: 'ok',
      detail: `a ${m.slot} adapter is installed in the editor's live system registry`,
    };
  }
  if (m.state === 'empty') {
    // WHO ANSWERED is part of the answer. Both provenances land in `empty`, and
    // for a long time both printed "the game answers that it has no X" — which
    // was a fabricated attestation whenever the HOST had derived it: measured
    // live on third-person, whose `systems` table declares only audio and
    // physics, the navigation/camera/networking rows all claimed the game had
    // answered. Attributing a statement to a game that never made it is the
    // anti-shim rule's own failure mode, in the product's own voice.
    if (m.attestedBy === 'host') {
      return {
        seam,
        status: 'info',
        attestedBy: 'host',
        detail:
          `derived-empty (the HOST's observation, not the game's answer) — nothing filled ` +
          `${m.slot} on a live mount: ${m.evidence ?? ''}. The game has not itself declared ` +
          `this absence; \`absent(reason)\` in its \`systems\` table is what turns the host's ` +
          `inference into the game's own statement.`,
      };
    }
    return {
      seam,
      status: 'info',
      attestedBy: 'game',
      detail: `declared-empty (an attestation, not a mechanically verified absence) — the game answers that it has no ${m.slot}: ${
        m.evidence ?? ''
      }`,
    };
  }
  if (m.state === 'malformed') {
    return {
      seam,
      status: 'gap',
      detail: `the game declared a ${m.slot} slot that could not be honoured — ${m.evidence ?? ''}`,
      missing: SYSTEM_SLOT_COSTS[m.slot],
      fix:
        `fix the declaration to engage with the row's evidence — the detail above names the ` +
        `specific conflict (a declared absence must name a contradicting shipped dependency; a ` +
        `declared adapter must be a real adapter or a { present: false, evidence } record)`,
    };
  }
  return {
    seam,
    status: 'gap',
    detail: `no ${m.slot} adapter is installed and the game declares no answer for the slot`,
    missing: SYSTEM_SLOT_COSTS[m.slot],
    fix: m.fix ?? systemSlotFix(m.slot),
  };
}

/**
 * ONE row per native verb — the family that is neither an `AuthoringAdapter`
 * provider nor a `SystemAdapters` slot, and so was reported by nothing.
 *
 * The measurer supplies every word, because each verb's evidence is a different
 * KIND of fact (a package.json script, the server's ownership answer, the
 * export door's own precondition) and a shared sentence here would be wrong for
 * at least two of them. All this decides is which of the three states is a
 * standing work order.
 */
function projectVerbRow(m: ProjectVerbMeasurement): CapabilityCoverageRow {
  const seam = `project.${m.slot}` as const;
  if (m.state === 'present') return presentProjectVerbRow(m, seam);
  // Unmeasured is its own answer (see this file's header): a fact nobody could
  // read is `info` with the reason, never a gap and never a pass.
  return {
    seam,
    status: m.state === 'absent' ? 'gap' : 'info',
    detail: m.evidence,
    ...(m.missing ? { missing: m.missing } : {}),
    ...(m.fix ? { fix: m.fix } : {}),
  };
}

function presentProjectVerbRow(
  measurement: ProjectVerbMeasurement,
  seam: `project.${ProjectVerbSlot}`,
): CapabilityCoverageRow {
  if (measurement.proof?.state === 'failed') {
    return {
      seam,
      status: 'gap',
      detail: `${measurement.evidence}; the real verb failed — ${measurement.proof.detail}`,
      ...(measurement.missing ? { missing: measurement.missing } : {}),
      ...(measurement.fix ? { fix: measurement.fix } : {}),
    };
  }
  const verified = measurement.proof?.state === 'verified';
  return {
    seam,
    status: verified ? 'ok' : 'info',
    detail: verified
      ? `${measurement.evidence}; ${measurement.proof?.detail}`
      : `${measurement.evidence}; declaration is only a precondition — this verb has not completed successfully in the current evidence run`,
  };
}

function authoringSurfaceRows(facts: ResolvedCoverageFacts): readonly CapabilityCoverageRow[] {
  const surface = facts.authoringSurface;
  if (!surface) return [];
  const scenes: CapabilityCoverageRow =
    surface.sceneDocuments === 0
      ? {
          seam: 'authoring.scenes',
          status: 'gap',
          detail: 'the adapter scene table names no authorable scene with a document to open',
          missing:
            'Edit has no scene tab — a captured runtime can still be healthy while the authoring surface is empty',
          fix: 'declare authorable scene-table entries with a mountable source or root region so planSceneDocument produces a document',
        }
      : surface.availableIsolationDocuments < surface.isolationDocuments
        ? {
            seam: 'authoring.scenes',
            status: 'gap',
            detail: `the table plans ${surface.isolationDocuments} isolation document(s) but only ${surface.availableIsolationDocuments} are available to open`,
            missing: 'declared scenes are absent from the Content catalog',
            fix: 'register every planned isolation document in the available-document catalog',
          }
        : {
            seam: 'authoring.scenes',
            status: 'ok',
            detail:
              `${surface.sceneDocuments} scene document(s) planned` +
              (surface.isolationDocuments > 0
                ? `, ${surface.openIsolationDocuments} of ${surface.isolationDocuments} isolation tab(s) open, ${surface.availableIsolationDocuments} available from Content`
                : ''),
          };
  const pieces: CapabilityCoverageRow =
    surface.pieces === 0 && surface.sceneEntries === 0
      ? {
          seam: 'authoring.pieces',
          status: 'na',
          detail:
            'the scene table declares no scenes, so there is no surface to place prefabs on ' +
            '(a models or website project)',
        }
      : surface.pieces === 0
        ? {
            seam: 'authoring.pieces',
            status: 'gap',
            detail: 'the resolved scene table contains no prefab entries',
            missing: 'Content has no project pieces and the component board has nothing to show',
            fix: 'add portable CSF stories inside the adapter region include globs so prefabsFromStories resolves entries',
          }
        : {
            seam: 'authoring.pieces',
            status: 'ok',
            detail: `${surface.pieces} prefab(s) resolved from the scene table`,
          };
  return [scenes, pieces];
}

/**
 * THE derivation. Rows are produced in a fixed order — cheapest to reason
 * about first (what the editor reached), then what the game declared, then
 * what it owns — so two reports of the same mount are diffable line for line.
 */
function resolveCoverageFacts(facts: CapabilityCoverageFacts): ResolvedCoverageFacts {
  return {
    worldId: facts.worldId,
    reach: facts.reach ?? null,
    surface: facts.surface ?? null,
    reachMechanism: facts.reachMechanism ?? null,
    loop: facts.loop ?? null,
    loopReason: facts.loopReason ?? null,
    contract: facts.contract ?? {
      declared: false,
      root: false,
      start: false,
      pause: false,
      resume: false,
      systems: null,
    },
    ownership: facts.ownership ?? null,
    writeReach: facts.writeReach ?? null,
    dataWriter: facts.dataWriter ?? null,
    persistenceProof: facts.persistenceProof,
    systemAdapters: facts.systemAdapters ?? [],
    projectVerbs: facts.projectVerbs ?? [],
    authoringSurface: facts.authoringSurface ?? null,
  };
}

function capabilityRows(
  facts: CapabilityCoverageFacts,
  resolved: ResolvedCoverageFacts,
): readonly CapabilityCoverageRow[] {
  const hasAuthoringFacts = 'reach' in facts || 'surface' in facts || 'reachMechanism' in facts;
  const hasLoopFacts = 'loop' in facts || 'loopReason' in facts || 'contract' in facts;
  const hasContractFacts = 'contract' in facts;
  const hasPersistenceFacts =
    'ownership' in facts ||
    'writeReach' in facts ||
    'dataWriter' in facts ||
    'persistenceProof' in facts;
  return [
    ...(hasAuthoringFacts ? editorSurfaceRows(resolved) : []),
    ...(hasLoopFacts ? [loopRow(resolved)] : []),
    ...(hasContractFacts
      ? [contractRootRow(resolved), contractStartRow(resolved), contractPauseRow(resolved)]
      : []),
    ...(hasPersistenceFacts ? [persistenceRow(resolved)] : []),
    ...(hasContractFacts ? [systemsRow(resolved)] : []),
    // One row per SystemAdapters slot, in `SYSTEM_ADAPTER_SLOTS` order. An
    // empty measurement list contributes no rows: with no live mount to ask,
    // six fabricated gaps would be worse than silence.
    ...resolved.systemAdapters.map(systemAdapterRow),
    // One row per native verb, same empty-list convention.
    ...resolved.projectVerbs.map(projectVerbRow),
    ...('authoringSurface' in facts ? authoringSurfaceRows(resolved) : []),
  ];
}

export function deriveCapabilityCoverage(facts: CapabilityCoverageFacts): CapabilityCoverageReport {
  const rows = capabilityRows(facts, resolveCoverageFacts(facts));
  return {
    rows,
    summary: {
      worldId: facts.worldId,
      rows: rows.length,
      gaps: rows.filter((r) => r.status === 'gap').length,
      ok: rows.filter((r) => r.status === 'ok').length,
      na: rows.filter((r) => r.status === 'na').length,
      info: rows.filter((r) => r.status === 'info').length,
    },
  };
}

// ──────────────────────────────────────────────────── the canvas-overlay probe

/** The shape this probe needs from a DOM element. Structural on purpose: a real
 *  `Element` satisfies it, and so does a plain object in a headless test. */
export interface OverlayRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface OverlayElement {
  readonly tagName: string;
  readonly id: string;
  readonly children: ArrayLike<OverlayElement>;
  getBoundingClientRect(): OverlayRect;
}

function subtreeHasCanvas(el: OverlayElement, canvas: OverlayElement): boolean {
  if (el === canvas) return true;
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i];
    if (child && subtreeHasCanvas(child, canvas)) return true;
  }
  return false;
}

interface CanvasCandidate {
  element: OverlayElement;
  depth: number;
  area: number;
}

/** Pick the visible canvas most likely to be the game's presentation surface:
 * largest painted area first, then the shallowest DOM placement. Hidden
 * loading canvases therefore stop winning once the real game canvas appears. */
export function findPrimaryCanvas(root: OverlayElement): OverlayElement | null {
  const candidates: CanvasCandidate[] = [];
  const visit = (element: OverlayElement, depth: number): void => {
    if (element.tagName.toLowerCase() === 'canvas') {
      const rect = element.getBoundingClientRect();
      candidates.push({
        element,
        depth,
        area: Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top),
      });
    }
    for (let i = 0; i < element.children.length; i++) {
      const child = element.children[i];
      if (child) visit(child, depth + 1);
    }
  };
  visit(root, 0);
  const visible = candidates.filter((candidate) => candidate.area > 0);
  const ranked = visible.length > 0 ? visible : candidates;
  ranked.sort((a, b) => b.area - a.area || a.depth - b.depth);
  return ranked[0]?.element ?? null;
}

const NON_UI_TAGS = new Set(['script', 'style', 'link', 'meta', 'base', 'title', 'noscript']);

/** Outermost non-inert branches outside the primary canvas ancestry. Unlike
 * the coverage probe this deliberately includes hidden UI: title screens and
 * pause menus remain authorable documents when their current state hides them. */
export function findCanvasUiElements(
  root: OverlayElement,
  canvas: OverlayElement,
): OverlayElement[] {
  const found: OverlayElement[] = [];
  const visit = (element: OverlayElement): void => {
    for (let i = 0; i < element.children.length; i++) {
      const child = element.children[i];
      if (!child) continue;
      if (subtreeHasCanvas(child, canvas)) {
        visit(child);
      } else if (!NON_UI_TAGS.has(child.tagName.toLowerCase())) found.push(child);
    }
  };
  visit(root);
  return found;
}

// ──────────────────────────────────────────────────────────── the console door

/** One block as the editor console takes it: a level and the whole grouped text. */
export interface CapabilityCoverageConsoleBlock {
  readonly level: 'info' | 'warn';
  readonly message: string;
}

const STATUS_MARK: Record<CapabilityCoverageRow['status'], string> = {
  gap: '✗',
  ok: '✓',
  na: '–',
  info: '·',
};

function renderRow(row: CapabilityCoverageRow): string {
  const lines = [`  ${STATUS_MARK[row.status]} ${row.seam} — ${row.detail}`];
  if (row.missing) lines.push(`      missing: ${row.missing}`);
  if (row.fix) lines.push(`      fix: ${row.fix}`);
  return lines.join('\n');
}

// ───────────────────────────────────────────────────── the headline, once
//
// THE COUNTING RULE, AND WHY IT HAS ONE OWNER.
//
// The headline used to read "N of 21 seams are MISSING" wherever it was
// printed, and 21 is the `editor.*` family ALONE — the `AuthoringAdapter`
// provider vocabulary plus `editor.capture`. Every other family
// (`system.*`, the contract rows, and now `project.*`) is derived in its own
// report, so a session could print a clean "0 of 21" while a whole family of
// verbs was missing and nothing anywhere summed them. A headline that counts
// one family while calling its total "seams" is the clean-answer failure this
// derivation exists to end.
//
// The remaining failure is quieter: the same sentence said "editor 11 of 42"
// in the morning and "editor 7 of 21" in the afternoon, both while still
// grading two roots. 42 is root-instances; 21 is distinct capabilities. The
// producer now states both units (`coverage-accounting.ts`) so a reader can
// tell them apart without opening this file.

export interface CoverageFamilyCount {
  readonly family: string;
  readonly rows: number;
  readonly gaps: number;
}

/**
 * THE sentence. `rows` is whatever the caller is reporting on — one report or
 * the union of several. Capabilities are unique applicable seams; a gap on
 * any root keeps the capability missing (gap-wins). Root-instances ride in
 * the same sentence so 21 capabilities cannot be mistaken for 42 rows.
 */
export function coverageGapHeadline(head: string, rows: readonly CapabilityCoverageRow[]): string {
  const headline = formatCoverageGapHeadline(head, deriveCoverageAccounting(rows));
  assertCoverageReconciles(rows, headline);
  return headline;
}

/** One contributing report, and the label that says whose it is. A `label` is
 *  needed only when several parts can carry the SAME seam (one `editor.*` row
 *  set per mounted root); the game-scoped families pass `null`. */
export interface CoveragePart {
  readonly label: string | null;
  readonly report: CapabilityCoverageReport;
}

/**
 * Fold several family reports into ONE, so a caller that derives its families
 * separately still prints a single union-counting headline.
 *
 * A labelled part's rows carry the label in their `detail`, because the same
 * seam legitimately appears once per mounted root and a union that dropped the
 * attribution would show two verdicts for one capability with no way to tell
 * them apart.
 */
export function unionCoverageReport(
  worldId: string,
  parts: readonly CoveragePart[],
): CapabilityCoverageReport {
  const rows = parts.flatMap((part) =>
    part.report.rows.map((row) =>
      part.label ? { ...row, detail: `[${part.label}] ${row.detail}` } : row,
    ),
  );
  return {
    rows,
    summary: {
      worldId,
      rows: rows.length,
      gaps: rows.filter((r) => r.status === 'gap').length,
      ok: rows.filter((r) => r.status === 'ok').length,
      na: rows.filter((r) => r.status === 'na').length,
      info: rows.filter((r) => r.status === 'info').length,
    },
  };
}

/**
 * Render the report as at most two grouped blocks — gaps as ONE warning,
 * everything else as ONE info — matching how the mount paths already report
 * (a single multi-line entry per thing that happened, never a line per row:
 * the console collapses consecutive identical messages, and a fan-out of
 * eight entries would bury the mount's own log lines).
 */
export function formatCapabilityCoverageBlocks(
  report: CapabilityCoverageReport,
  /** What this report is ABOUT, when the caller's subject is not one root — a
   *  union across every family is a session's answer, not a root's, and a head
   *  saying otherwise would misname where the gaps live. */
  headOverride?: string,
): readonly CapabilityCoverageConsoleBlock[] {
  const { summary } = report;
  // "root", not "ingest": the same derivation now reports NATIVE roots too
  // (`@volter/editor-game/coverage/root-coverage.ts`), and a headline naming the ingest lane over a
  // first-party root's gaps would tell the reader something false about where
  // the gap lives.
  const head = headOverride ?? `root coverage "${summary.worldId}"`;
  const blocks: CapabilityCoverageConsoleBlock[] = [];
  const gaps = report.rows.filter((r) => r.status === 'gap');
  const rest = report.rows.filter((r) => r.status !== 'gap');
  if (gaps.length > 0) {
    blocks.push({
      level: 'warn',
      message: [
        `${coverageGapHeadline(head, report.rows)} ` +
          'This game mounts, but the editor cannot do the following with it:',
        ...gaps.map(renderRow),
      ].join('\n'),
    });
  }
  if (rest.length > 0) {
    blocks.push({
      level: 'info',
      message: [
        `${head} — ${summary.ok} seam(s) present, ${summary.na} not applicable to this surface, ` +
          `${summary.info} measured-only:`,
        ...rest.map(renderRow),
      ].join('\n'),
    });
  }
  return blocks;
}

/**
 * The console door, ONCE PER MOUNT.
 *
 * The report is derived on demand (the status facet re-derives it on every
 * read, so `vgai status` never serves a verdict older than the question), which
 * makes "print it" a thing that could happen many times — per status poll, per
 * re-render, in the limit per frame. The guard is a mount token: the same
 * mount's report is emitted once and then never again, and a NEW mount emits
 * again because it is a different game's answer.
 *
 * A factory rather than module-level state so the guard is directly testable
 * and so a test never has to reset a global.
 */
export function createCapabilityCoverageConsole(
  emit: (block: CapabilityCoverageConsoleBlock) => void,
): {
  report(mountToken: string, report: CapabilityCoverageReport): boolean;
} {
  let lastToken: string | null = null;
  return {
    /** Emits and returns true the first time it sees `mountToken`; a no-op
     *  returning false for every later call with that same token. */
    report(mountToken: string, report: CapabilityCoverageReport): boolean {
      if (lastToken === mountToken) return false;
      lastToken = mountToken;
      for (const block of formatCapabilityCoverageBlocks(report)) emit(block);
      return true;
    },
  };
}
