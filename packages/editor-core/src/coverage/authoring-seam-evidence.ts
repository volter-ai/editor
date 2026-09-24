/**
 * One structural and operational answer for an AuthoringAdapter.
 *
 * This module does not call providers. It inventories their compiler-pinned
 * shapes and combines those receipts with receipts produced by real consumers
 * and conformance probes. Shape can reject a malformed carrier immediately;
 * it can never manufacture an operational pass.
 */

import {
  AUTHORING_ADAPTER_SHAPE,
  AUTHORING_PROVIDER_KEYS,
  AUTHORING_PROVIDER_SHAPES,
  type AuthoringAdapter,
  type AuthoringProviderKey,
  gradeSeamCarrier,
  gradeSeamEvidence,
  HIERARCHY_PROVIDER_SHAPE,
  type HierarchyProvider,
  inspectSeamShape,
  type SeamEvidenceReceipt,
  type SeamEvidenceVerdict,
  type SeamProofStage,
  type SeamShape,
  type StructuralWriteOutcome,
  type WriteAck,
} from '@volter/editor-project/adapter';
import { liveSeamEvidence, recordLiveSeamEvidence } from '@volter/editor-sdk/kit/live-seam-evidence';

const EPOCHS = new WeakMap<object, string>();
let nextEpoch = 1;

/** Stable only for the lifetime of this adapter object. A cold remount creates
 * a new adapter and therefore cannot inherit receipts from the old one. */
export function authoringAdapterEpoch(adapter: AuthoringAdapter): string {
  const object = adapter as object;
  const existing = EPOCHS.get(object);
  if (existing) return existing;
  const epoch = `authoring-${nextEpoch++}`;
  EPOCHS.set(object, epoch);
  return epoch;
}

function recordAuthoringReceipt(options: {
  readonly adapter: AuthoringAdapter;
  readonly seam: string;
  readonly stage: SeamProofStage;
  readonly outcome: 'pass' | 'fail';
  readonly detail: string;
}): void {
  const epoch = authoringAdapterEpoch(options.adapter);
  const record = (seam: string, detail: string): void =>
    recordLiveSeamEvidence({
      seam,
      subject: 'authoring-adapter',
      epoch,
      stage: options.stage,
      outcome: options.outcome,
      source: 'consumer',
      detail,
    });
  record(options.seam, options.detail);
  const segments = options.seam.split('.');
  if (segments.length < 3) return;
  const parent = segments.slice(0, -1).join('.');
  record(
    parent,
    options.outcome === 'pass'
      ? `${parent} served a real consumer ${options.stage}`
      : `${parent} failed through its consumer: ${options.detail}`,
  );
}

function writeAck(value: unknown): WriteAck | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { destination?: unknown; persisted?: unknown };
  return typeof candidate.destination === 'string' && typeof candidate.persisted === 'boolean'
    ? (candidate as WriteAck)
    : null;
}

/** Record one real consumer call against the exact adapter object it used.
 *
 * The epoch, not a display label, is the identity boundary: one root can be
 * reported under its manifest id in status and under `root` in the ingest
 * mount report, while both names refer to this same adapter instance. The
 * receipt is therefore stored under the neutral subject and rebound to the
 * report's subject in {@link inspectAuthoringAdapterSeams} below.
 *
 * Promise-returning provider methods keep their original timing and rejection;
 * success is recorded only after they settle. A thrown/rejected call records a
 * failing receipt and is rethrown unchanged.
 */
export function recordAuthoringConsumerUse<T>(options: {
  readonly adapter: AuthoringAdapter;
  readonly seam: string;
  readonly stage: SeamProofStage;
  readonly detail: string;
  readonly run: () => T;
}): T {
  const receipt = (outcome: 'pass' | 'fail', detail: string): void => {
    recordAuthoringReceipt({ ...options, outcome, detail });
  };
  try {
    const value = options.run();
    if (value && typeof (value as { then?: unknown }).then === 'function') {
      return Promise.resolve(value).then(
        (settled) => {
          receipt('pass', options.detail);
          return settled;
        },
        (error) => {
          receipt(
            'fail',
            `${options.detail} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          throw error;
        },
      ) as unknown as T;
    }
    receipt('pass', options.detail);
    return value;
  } catch (error) {
    receipt(
      'fail',
      `${options.detail} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

/** Record a write at the strength its own return value proves. A concrete
 * WriteAck is a round trip even when it honestly says live-only; `void` proves
 * only that the effect call returned. This keeps void-returning legacy lanes
 * from manufacturing the stronger receipt their contract still owes. */
export function recordAuthoringWriteConsumerUse(options: {
  readonly adapter: AuthoringAdapter;
  readonly seam: string;
  readonly detail: string;
  readonly run: () => StructuralWriteOutcome;
}): StructuralWriteOutcome {
  const success = (value: void | WriteAck): void | WriteAck => {
    const ack = writeAck(value);
    recordAuthoringReceipt({
      adapter: options.adapter,
      seam: options.seam,
      stage: ack ? 'round-trip' : 'effect',
      outcome: 'pass',
      detail: ack
        ? `${options.detail}: ${ack.destination} (${ack.persisted ? 'persisted' : 'live-only'})`
        : `${options.detail}; the provider returned no write acknowledgement`,
    });
    return value;
  };
  const failure = (error: unknown): never => {
    recordAuthoringReceipt({
      adapter: options.adapter,
      seam: options.seam,
      stage: 'round-trip',
      outcome: 'fail',
      detail: `${options.detail} failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    throw error;
  };
  try {
    const value = options.run();
    return value && typeof (value as { then?: unknown }).then === 'function'
      ? Promise.resolve(value).then(success, failure)
      : success(value as void | WriteAck);
  } catch (error) {
    return failure(error);
  }
}

export interface AuthoringSeamEvidence {
  readonly subject: string;
  readonly epoch: string;
  readonly receipts: readonly SeamEvidenceReceipt[];
  readonly providers: Readonly<Record<AuthoringProviderKey, SeamEvidenceVerdict>>;
  /**
   * The hierarchy CARRIER: well-formed, and every member it advertises proven
   * at that member's own required stage. This is the door
   * `authoring/active-adapter.ts` refuses a malformed adapter with — a missing
   * or mis-kinded `roots`/`node` only ever shows up as a member verdict, so
   * the refusal needs the carrier grade and not the seam's own.
   */
  readonly hierarchy: SeamEvidenceVerdict;
  /**
   * The hierarchy WALK — the `editor.hierarchy` seam's own verdict, which is a
   * different and weaker question than {@link hierarchy}: did a current-epoch
   * operation walk this root's tree and find it finite, non-empty and
   * reciprocal (`coverage/authoring-read-probe.ts`)?
   *
   * It exists because the CARRIER asks a strictly stronger question: every
   * member the carrier advertises, proven at that member's own stage. It used
   * to be an UNANSWERABLE one — `object3D` (required `operation`) and
   * `idForObject3D` (then required `effect`) are optional-but-PRESENT on every
   * three adapter, no production consumer records a receipt for either, and
   * the read probe did not call them, so `gradeSeamCarrier` returned
   * `unverified` on a perfectly reciprocal tree, forever. Both are pure
   * lookups and are `operation` now, called and checked against the walk by
   * `coverage/authoring-read-probe.ts`'s `objectLookupReceipts`, so the
   * carrier answers its own question on a healthy adapter.
   * The two grades stay separate regardless: this one is what
   * `adapter-reach.ts`'s `captureEvidence` reads, and reading the CARRIER
   * there once left the capture row's `ok` branch DEAD — a healthy
   * root printed "no current-epoch hierarchy operation proves it projects
   * this root's runtime" as `info` while the operation had in fact run and
   * passed. MEASURED 2026-09-19 on a `--template game` scaffold: `info` with
   * the reciprocity fix in, `gap` with the pre-fix adapter planted — the
   * failure branch worked, the success branch could not be reached.
   *
   * Graded here, beside the carrier and off the SAME receipt set, so the two
   * answers cannot drift apart in two modules.
   */
  readonly hierarchyWalk: SeamEvidenceVerdict;
}

export function inspectAuthoringAdapterSeams(options: {
  readonly adapter: AuthoringAdapter;
  readonly subject: string;
  readonly epoch?: string | undefined;
  readonly receipts?: readonly SeamEvidenceReceipt[] | undefined;
}): AuthoringSeamEvidence {
  const { adapter, subject } = options;
  const epoch = options.epoch ?? authoringAdapterEpoch(adapter);
  const receipts: SeamEvidenceReceipt[] = [
    ...inspectSeamShape<AuthoringAdapter>({
      prefix: 'editor',
      value: adapter,
      shape: AUTHORING_ADAPTER_SHAPE,
      subject,
      epoch,
    }),
    ...inspectSeamShape<HierarchyProvider>({
      prefix: 'editor.hierarchy',
      value: adapter.hierarchy,
      shape: HIERARCHY_PROVIDER_SHAPE,
      subject,
      epoch,
    }),
  ];

  for (const [provider, shape] of Object.entries(AUTHORING_PROVIDER_SHAPES)) {
    receipts.push(
      ...inspectSeamShape({
        prefix: `editor.${provider}`,
        value: (adapter as unknown as Record<string, unknown>)[provider],
        shape: shape as SeamShape<object>,
        subject,
        epoch,
      }),
    );
  }
  // An adapter epoch already identifies one concrete carrier. Rebind its live
  // consumer receipts to this report's display subject so the same operation
  // closes both the per-root status row (`worldId`) and the ingest report
  // (`root`) without duplicating or guessing names at the call site.
  receipts.push(
    ...liveSeamEvidence.receipts({ epoch }).map((receipt) => ({ ...receipt, subject })),
  );
  if (options.receipts) receipts.push(...options.receipts);

  const providers = {} as Record<AuthoringProviderKey, SeamEvidenceVerdict>;
  for (const provider of AUTHORING_PROVIDER_KEYS) {
    const nested = (AUTHORING_PROVIDER_SHAPES as Partial<Record<string, SeamShape<object>>>)[
      provider
    ];
    providers[provider] = gradeSeamCarrier({
      seam: `editor.${provider}`,
      required: AUTHORING_ADAPTER_SHAPE[provider].required,
      shape: nested,
      subject,
      epoch,
      receipts,
    });
  }

  return {
    subject,
    epoch,
    receipts,
    providers,
    hierarchy: gradeSeamCarrier({
      seam: 'editor.hierarchy',
      required: AUTHORING_ADAPTER_SHAPE.hierarchy.required,
      shape: HIERARCHY_PROVIDER_SHAPE as SeamShape<object>,
      subject,
      epoch,
      receipts,
    }),
    hierarchyWalk: gradeSeamEvidence({
      seam: 'editor.hierarchy',
      required: AUTHORING_ADAPTER_SHAPE.hierarchy.required,
      subject,
      epoch,
      receipts,
    }),
  };
}
