import { resetAvailableWorkspaceDocuments } from '@volter/editor-sdk/kit/workspace-available-documents';
/**
 * What must NOT survive a project switch.
 *
 * Switching projects without a page reload is a real path — the project
 * screen's own open sites call `setActiveProject`, and `AppRoot` remounts the
 * editor layout under a fresh provider. React state goes with that remount;
 * MODULE-LEVEL state does not. Every singleton below was written against "one
 * project per page load", and each one carries the previous project's answers
 * into the next: a running play session (RAF loop, WebGL context, Rapier
 * world), a live ingest session nothing unmounted, an authoring override
 * pointing at a game that is gone, System adapters still answering the gizmo
 * and the CLI wire, and two measurement ledgers whose keys (document ids,
 * surface ids) repeat across projects.
 *
 * ONE subscriber, listed in one place, because that is the only way this stays
 * honest: a singleton with a session lifetime that is not named here is a
 * singleton nobody will remember to reset. Add new ones HERE.
 *
 * WHICH SWITCHES ACTUALLY LAND HERE, measured rather than assumed: the
 * browser/FSA project paths (`rootPath: 'browser' | 'fsa'`) never touch the
 * editor server, so nothing reloads and this is the ONLY teardown they get.
 * A local, server-backed open additionally POSTs `/__editor/open-project`,
 * whose broadcast makes `command-listener.ts` reload the page — so there this
 * runs during the window before that reload lands, not instead of it. A page
 * reload reclaims everything by definition; the window before it does not, and
 * it is long enough to hold a live WebGL context and RAF loop across a network
 * round trip.
 */

import { clearSelectedAsset } from './asset-selection';
import { setActiveAuthoring } from '@volter/editor-sdk/kit/authoring/active-adapter';
import { resetActiveSystemsForNewProject } from '@volter/editor-sdk/kit/authoring/active-systems';
import { resetSessionVitalsForNewProject } from './coverage/session-vitals';
import { stopAllLiveSessions } from '@volter/editor-sdk/kit/live-session-registry';
import { onProjectSessionEnd } from '@volter/editor-sdk/kit/project-manager';
import { resetViewportActivationTimingsForNewProject } from '@volter/editor-sdk/kit/viewport-activation-timings';
import { closeAllWorkspaceDocuments } from '@volter/editor-sdk/kit/workspace-document-registry';

/**
 * Register the project-session resets. Called once at editor init
 * (`EditorContext.tsx`), the same lifecycle shape `startProjectAdapterLoad`
 * uses; returns its own teardown.
 */
export function startProjectSessionReset(): () => void {
  return onProjectSessionEnd(() => {
    // TEARDOWN FIRST, and in the order a normal stop would run it: these two
    // own mounted games (loop, renderer, realm, adapters, subscriptions) and
    // each is idempotent + a no-op when nothing is running. Dropping a
    // reference to either would leak the whole session, not just the handle.
    stopAllLiveSessions();
    // Both teardowns above clear the override themselves WHEN they had one;
    // this covers the surfaces that install an override without owning a
    // session (an open design/boundary adapter), which nothing else ends.
    setActiveAuthoring(null);
    resetActiveSystemsForNewProject();
    resetSessionVitalsForNewProject();
    resetViewportActivationTimingsForNewProject();
    // The center's open documents and the Content selection are module
    // state too: a project SWITCH is not a reload, so the previous project's
    // model stayed open in the next project's center, and its restore saw
    // "something is open" and never opened the new project's own default.
    closeAllWorkspaceDocuments();
    resetAvailableWorkspaceDocuments();
    clearSelectedAsset();
  });
}
