/** Current-epoch evidence for the game→host contract. */

import {
  gradeSeamEvidence,
  inspectSeamShape,
  type SeamEvidenceReceipt,
  type SeamEvidenceVerdict,
} from '@volter/editor-project/adapter';
import type {
  VgaiGameContract,
  VgaiGameLifecycle,
  VgaiGameSystems,
} from '@volter/editor-project/adapter/ingest/game-contract';
import {
  GAME_CONTRACT_SHAPE,
  GAME_LIFECYCLE_SHAPE,
  GAME_SYSTEMS_SHAPE,
} from '@volter/editor-project/adapter/ingest/game-contract-seams';
import { liveSeamEvidence } from '@volter/editor-core/coverage/live-seam-evidence';

const EPOCHS = new WeakMap<object, string>();
let nextEpoch = 1;

export function gameContractEpoch(contract: VgaiGameContract): string {
  const found = EPOCHS.get(contract);
  if (found) return found;
  const epoch = `contract-${nextEpoch++}`;
  EPOCHS.set(contract, epoch);
  return epoch;
}

export interface GameContractEvidence {
  readonly root: SeamEvidenceVerdict;
  readonly start: SeamEvidenceVerdict;
  readonly pause: SeamEvidenceVerdict;
  readonly resume: SeamEvidenceVerdict;
  readonly systems: SeamEvidenceVerdict;
}

export function inspectGameContractSeams(options: {
  readonly contract: VgaiGameContract;
  readonly subject?: string | undefined;
  readonly epoch?: string | undefined;
  readonly receipts?: readonly SeamEvidenceReceipt[] | undefined;
}): GameContractEvidence {
  const subject = options.subject ?? 'game';
  const epoch = options.epoch ?? gameContractEpoch(options.contract);
  const receipts: SeamEvidenceReceipt[] = [
    ...inspectSeamShape<VgaiGameContract>({
      prefix: 'contract',
      value: options.contract,
      shape: GAME_CONTRACT_SHAPE,
      subject,
      epoch,
    }),
    ...inspectSeamShape<VgaiGameLifecycle>({
      prefix: 'contract.lifecycle',
      value: options.contract.lifecycle,
      shape: GAME_LIFECYCLE_SHAPE,
      subject,
      epoch,
    }),
    ...inspectSeamShape<VgaiGameSystems>({
      prefix: 'contract.systems',
      value: options.contract.systems,
      shape: GAME_SYSTEMS_SHAPE,
      subject,
      epoch,
    }),
    ...liveSeamEvidence.receipts({ subject, epoch }),
    ...(options.receipts ?? []),
  ];
  const verdict = (seam: string, required: 'operation' | 'effect'): SeamEvidenceVerdict =>
    gradeSeamEvidence({ seam, subject, epoch, required, receipts });
  return {
    root: verdict('contract.root', 'effect'),
    start: verdict('contract.lifecycle.start', 'effect'),
    pause: verdict('contract.lifecycle.pause', 'effect'),
    resume: verdict('contract.lifecycle.resume', 'effect'),
    systems: verdict('contract.systems', 'operation'),
  };
}
