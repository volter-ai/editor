/** One current-process evidence ledger shared by panels, relay consumers,
 * coverage, status, and Doctor. It is intentionally ephemeral: project source
 * remains truth and no VGAI evidence sidecar is invented. */

import { SeamEvidenceLedger, type SeamEvidenceReceipt } from '@volter/editor-project/adapter';

export const liveSeamEvidence = new SeamEvidenceLedger();

export function recordLiveSeamEvidence(receipt: SeamEvidenceReceipt): void {
  liveSeamEvidence.record(receipt);
}
