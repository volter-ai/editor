/** Structural/operational evidence for one mounted SystemAdapters slot. */

import {
  displayKeyedPhysics,
  gradeSeamCarrier,
  inspectSeamShape,
  PHYSICS_2D_ADAPTER_SHAPE,
  PHYSICS_ADAPTER_SHAPE,
  type SeamEvidenceReceipt,
  type SeamEvidenceVerdict,
  type SeamShape,
  SYSTEM_ADAPTERS_SHAPE,
  SYSTEM_PROVIDER_SHAPES,
  type SystemAdapters,
} from '@volter/editor-project/adapter';
import { liveSeamEvidence } from './live-seam-evidence';

const EPOCHS = new WeakMap<object, string>();
let nextEpoch = 1;

export function systemAdapterEpoch(value: object): string {
  const found = EPOCHS.get(value);
  if (found) return found;
  const epoch = `system-${nextEpoch++}`;
  EPOCHS.set(value, epoch);
  return epoch;
}

export function inspectSystemAdapterSeam<K extends keyof SystemAdapters>(options: {
  readonly slot: K;
  readonly adapter: NonNullable<SystemAdapters[K]>;
  readonly subject: string;
  readonly epoch?: string | undefined;
  readonly receipts?: readonly SeamEvidenceReceipt[] | undefined;
}): SeamEvidenceVerdict {
  const epoch = options.epoch ?? systemAdapterEpoch(options.adapter as object);
  const seam = `system.${options.slot}`;
  const bag = { [options.slot]: options.adapter } as Partial<SystemAdapters>;
  const nestedShape =
    options.slot === 'physics'
      ? displayKeyedPhysics(options.adapter as SystemAdapters['physics'])
        ? PHYSICS_2D_ADAPTER_SHAPE
        : PHYSICS_ADAPTER_SHAPE
      : SYSTEM_PROVIDER_SHAPES[options.slot as Exclude<keyof SystemAdapters, 'physics'>];
  const receipts: SeamEvidenceReceipt[] = [
    ...inspectSeamShape<SystemAdapters>({
      prefix: 'system',
      value: bag,
      shape: SYSTEM_ADAPTERS_SHAPE,
      subject: options.subject,
      epoch,
    }).filter((receipt) => receipt.seam === seam),
    ...inspectSeamShape({
      prefix: seam,
      value: options.adapter,
      shape: nestedShape as SeamShape<object>,
      subject: options.subject,
      epoch,
    }),
    ...liveSeamEvidence.receipts({ subject: options.subject, epoch }),
    ...(options.receipts ?? []),
  ];

  return gradeSeamCarrier({
    seam,
    subject: options.subject,
    epoch,
    required: SYSTEM_ADAPTERS_SHAPE[options.slot].required,
    receipts,
    shape: nestedShape as SeamShape<object>,
  });
}
