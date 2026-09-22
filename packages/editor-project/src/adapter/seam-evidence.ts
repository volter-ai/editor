/**
 * Evidence that a protocol seam tells the truth.
 *
 * A property existing on an object proves only SHAPE. It does not prove that
 * calling it works, that its effect reaches the consumer, or that an authored
 * effect survives a cold remount. Those are deliberately separate stages so a
 * declaration can never be promoted to a green capability merely because it
 * has the right spelling.
 *
 * Receipts are scoped to a SUBJECT and an EPOCH. A provider from a prior mount
 * is not evidence about the current mount, even when both mounts use the same
 * project and node ids. This is the generic answer to stale adapter registries,
 * late provider registration, and project switching: old receipts simply do
 * not participate in the new verdict.
 */

export const SEAM_PROOF_STAGES = ['claim', 'shape', 'operation', 'effect', 'round-trip'] as const;

export type SeamProofStage = (typeof SEAM_PROOF_STAGES)[number];
export type SeamEvidenceOutcome = 'pass' | 'fail' | 'absent';
export type SeamEvidenceSource =
  | 'declaration'
  | 'shape-check'
  | 'consumer'
  | 'conformance-probe'
  | 'round-trip';

/** One directly observed fact. `detail` names the observation, never a claim
 * such as "supported" with no described bar behind it. */
export interface SeamEvidenceReceipt {
  readonly seam: string;
  readonly subject: string;
  readonly epoch: string;
  readonly stage: SeamProofStage;
  readonly outcome: SeamEvidenceOutcome;
  readonly source: SeamEvidenceSource;
  readonly detail: string;
}

export type SeamEvidenceState = 'verified' | 'failed' | 'absent' | 'unverified' | 'not-applicable';

export interface SeamEvidenceVerdict {
  readonly seam: string;
  readonly subject: string;
  readonly epoch: string;
  readonly required: SeamProofStage;
  readonly state: SeamEvidenceState;
  /** The strongest current-epoch receipt, or null when nobody has measured the
   * seam. A not-applicable verdict carries its reason here instead. */
  readonly receipt: SeamEvidenceReceipt | null;
  readonly detail: string;
}

const STAGE_RANK: Readonly<Record<SeamProofStage, number>> = {
  claim: 0,
  shape: 1,
  operation: 2,
  effect: 3,
  'round-trip': 4,
};

export function seamStageAtLeast(observed: SeamProofStage, required: SeamProofStage): boolean {
  return STAGE_RANK[observed] >= STAGE_RANK[required];
}

/**
 * Grade one seam from receipts for ONE subject epoch.
 *
 * The strongest stage wins. At the same stage, the last receipt wins so a
 * successful retry can close a failure and a later failure can reopen it.
 * Lower-stage evidence can never overrule a stronger observation: a completed
 * cold-remount round trip is not invalidated by a later shape census.
 */
export function gradeSeamEvidence(options: {
  readonly seam: string;
  readonly subject: string;
  readonly epoch: string;
  readonly required: SeamProofStage;
  readonly receipts: readonly SeamEvidenceReceipt[];
  readonly notApplicable?: string | undefined;
}): SeamEvidenceVerdict {
  const { seam, subject, epoch, required } = options;
  if (options.notApplicable !== undefined) {
    return {
      seam,
      subject,
      epoch,
      required,
      state: 'not-applicable',
      receipt: null,
      detail: options.notApplicable,
    };
  }

  let strongest: SeamEvidenceReceipt | null = null;
  for (const receipt of options.receipts) {
    if (receipt.seam !== seam || receipt.subject !== subject || receipt.epoch !== epoch) continue;
    if (!strongest || STAGE_RANK[receipt.stage] >= STAGE_RANK[strongest.stage]) {
      strongest = receipt;
    }
  }

  if (!strongest) {
    return {
      seam,
      subject,
      epoch,
      required,
      state: 'unverified',
      receipt: null,
      detail: `no current-epoch evidence has reached the required ${required} stage`,
    };
  }
  if (strongest.outcome === 'fail') {
    return {
      seam,
      subject,
      epoch,
      required,
      state: 'failed',
      receipt: strongest,
      detail: strongest.detail,
    };
  }
  if (strongest.outcome === 'absent') {
    return {
      seam,
      subject,
      epoch,
      required,
      state: 'absent',
      receipt: strongest,
      detail: strongest.detail,
    };
  }
  if (!seamStageAtLeast(strongest.stage, required)) {
    return {
      seam,
      subject,
      epoch,
      required,
      state: 'unverified',
      receipt: strongest,
      detail: `${strongest.detail}; this proves ${strongest.stage}, but this seam requires ${required}`,
    };
  }
  return {
    seam,
    subject,
    epoch,
    required,
    state: 'verified',
    receipt: strongest,
    detail: strongest.detail,
  };
}

/** In-memory current-session ledger. It is evidence, not a project file and
 * therefore introduces no VGAI data format. */
export class SeamEvidenceLedger {
  readonly #receipts: SeamEvidenceReceipt[] = [];

  record(receipt: SeamEvidenceReceipt): void {
    if (!receipt.seam || !receipt.subject || !receipt.epoch || !receipt.detail.trim()) {
      throw new Error('seam evidence requires non-empty seam, subject, epoch, and detail');
    }
    this.#receipts.push(receipt);
  }

  receipts(options?: {
    readonly subject?: string | undefined;
    readonly epoch?: string | undefined;
  }): readonly SeamEvidenceReceipt[] {
    return this.#receipts.filter(
      (receipt) =>
        (options?.subject === undefined || receipt.subject === options.subject) &&
        (options?.epoch === undefined || receipt.epoch === options.epoch),
    );
  }

  verdict(options: {
    readonly seam: string;
    readonly subject: string;
    readonly epoch: string;
    readonly required: SeamProofStage;
    readonly notApplicable?: string | undefined;
  }): SeamEvidenceVerdict {
    return gradeSeamEvidence({ ...options, receipts: this.#receipts });
  }

  clearSubject(subject: string): void {
    for (let index = this.#receipts.length - 1; index >= 0; index -= 1) {
      if (this.#receipts[index]?.subject === subject) this.#receipts.splice(index, 1);
    }
  }

  clear(): void {
    this.#receipts.length = 0;
  }
}

type NonUndefined<T> = Exclude<T, undefined>;
type MemberKind<T> = NonUndefined<T> extends (...args: never[]) => unknown ? 'function' : 'value';

/** A compiler-pinned description of every member of `T`. Adding, removing, or
 * changing the optionality/kind of a contract member breaks its descriptor. */
export type SeamShape<T> = {
  readonly [K in keyof T]-?: {
    readonly optional: undefined extends T[K] ? true : false;
    readonly kind: MemberKind<T[K]>;
    readonly required: SeamProofStage;
  };
};

export function defineSeamShape<T>() {
  return <const TShape extends SeamShape<T>>(shape: TShape): TShape => shape;
}

function memberShapeReceipt(options: {
  readonly seam: string;
  readonly value: unknown;
  readonly optional: boolean;
  readonly kind: 'function' | 'value';
  readonly subject: string;
  readonly epoch: string;
}): SeamEvidenceReceipt {
  if (options.value === undefined) {
    return {
      seam: options.seam,
      subject: options.subject,
      epoch: options.epoch,
      stage: 'shape',
      outcome: options.optional ? 'absent' : 'fail',
      source: 'shape-check',
      detail: options.optional
        ? `${options.seam} is not exposed by this subject`
        : `${options.seam} is required by the contract but is absent`,
    };
  }
  const actual = typeof options.value;
  const valid = options.kind === 'function' ? actual === 'function' : actual !== 'function';
  return {
    seam: options.seam,
    subject: options.subject,
    epoch: options.epoch,
    stage: 'shape',
    outcome: valid ? 'pass' : 'fail',
    source: 'shape-check',
    detail: valid
      ? `${options.seam} has the contract's ${options.kind} shape`
      : `${options.seam} is ${actual}; the contract requires a ${options.kind}`,
  };
}

/** Shape is intentionally only shape. Successful members produce `shape`
 * receipts; callers must add operation/effect/round-trip receipts from actual
 * consumers or conformance probes before those seams can verify. */
export function inspectSeamShape<T extends object>(options: {
  readonly prefix: string;
  readonly value: unknown;
  readonly shape: SeamShape<T>;
  readonly subject: string;
  readonly epoch: string;
}): readonly SeamEvidenceReceipt[] {
  const receipts: SeamEvidenceReceipt[] = [];
  const object =
    options.value !== null &&
    (typeof options.value === 'object' || typeof options.value === 'function')
      ? (options.value as Record<string, unknown>)
      : null;
  const members = Object.entries(options.shape) as Array<
    [string, { readonly optional: boolean; readonly kind: 'function' | 'value' }]
  >;
  for (const [member, spec] of members) {
    const seam = `${options.prefix}.${member}`;
    const value = object?.[member];
    receipts.push(
      memberShapeReceipt({
        seam,
        subject: options.subject,
        epoch: options.epoch,
        value,
        optional: spec.optional,
        kind: spec.kind,
      }),
    );
  }
  return receipts;
}

/**
 * Grade a carrier and every member it actually advertises.
 *
 * Optional-and-absent is honest degradation. Optional-and-present is a real
 * promise and is held to exactly the same proof bar as a required member. This
 * is the shared rule that prevents each coverage family from inventing a
 * different meaning for “provider present”.
 */
export function gradeSeamCarrier(options: {
  readonly seam: string;
  readonly required: SeamProofStage;
  readonly shape?: SeamShape<object> | undefined;
  readonly subject: string;
  readonly epoch: string;
  readonly receipts: readonly SeamEvidenceReceipt[];
}): SeamEvidenceVerdict {
  const base = gradeSeamEvidence(options);
  if (base.state === 'absent' || base.state === 'failed' || !options.shape) return base;

  for (const [member, spec] of Object.entries(options.shape)) {
    const memberVerdict = gradeSeamEvidence({
      seam: `${options.seam}.${member}`,
      subject: options.subject,
      epoch: options.epoch,
      required: spec.required,
      receipts: options.receipts,
    });
    if (spec.optional && memberVerdict.state === 'absent') continue;
    if (memberVerdict.state === 'failed' || memberVerdict.state === 'absent') {
      return {
        ...base,
        state: 'failed',
        receipt: memberVerdict.receipt,
        detail: `${options.seam} is malformed: ${memberVerdict.detail}`,
      };
    }
    if (memberVerdict.state !== 'verified') {
      return {
        ...base,
        state: 'unverified',
        detail: `${options.seam} has the required shape, but ${memberVerdict.seam} is unverified: ${memberVerdict.detail}`,
      };
    }
  }
  return base;
}
