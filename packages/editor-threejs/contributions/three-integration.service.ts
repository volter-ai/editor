/**
 * The Three integration, installed at boot (`workspace.service`): the Object3D surfaces
 * contributions mount, the viewport's relay verbs, Asset Lab viewers, inspection and hierarchy
 * media, captures, the authoring policy and the session's view-state persistence
 * (`src/kit/three-integration.ts`). Every viewport also ensures it before it mounts.
 */
import { ensureThreeIntegration } from '../src/kit/three-integration';

export const point = 'workspace.service';

export function start(): () => void {
  return ensureThreeIntegration();
}
