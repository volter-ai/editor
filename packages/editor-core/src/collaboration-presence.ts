import type { CollaborationPresence } from '@volter/editor-sdk/session/collaboration-types';
import { updateCollaborationPresence } from './collaboration-client';

let presence: CollaborationPresence = {
  document: null,
  file: null,
  oid: null,
  selection: [],
  camera: null,
  gesture: null,
};
let sent = '';
let scheduled = false;
let inFlight = false;

const PRESENCE_INTERVAL_MS = 100;

function schedulePresence(): void {
  if (scheduled || inFlight) return;
  scheduled = true;
  globalThis.setTimeout(() => {
    scheduled = false;
    const serialized = JSON.stringify(presence);
    if (serialized === sent) return;
    sent = serialized;
    inFlight = true;
    void updateCollaborationPresence(presence)
      .catch(() => {
        sent = '';
      })
      .finally(() => {
        inFlight = false;
        if (JSON.stringify(presence) !== sent) schedulePresence();
      });
  }, PRESENCE_INTERVAL_MS);
}

export function reportCollaborationPresence(patch: Partial<CollaborationPresence>): void {
  presence = { ...presence, ...patch };
  schedulePresence();
}
