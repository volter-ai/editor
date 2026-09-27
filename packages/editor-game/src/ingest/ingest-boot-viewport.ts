/**
 * WHERE A BOOT-TIME INGEST BECOMES EDITABLE.
 *
 * Game is a play-time document (`game-document.ts`). A boot-time ingest
 * still acquires Game — that is the host the runtime mounts into — but the
 * authoring surface is Scene. Three already landed on Edit; canvas and DOM
 * forced the play tab, so opening Bubbo put Game in front with nothing
 * having pressed ▶.
 *
 * This is also the ONE cold-landing boundary. Every successful ingest mount
 * publishes its required pause surface before calling here, so hold content
 * time BEFORE exposing Edit. Keeping the hold here prevents each surface
 * adapter from independently remembering (or forgetting) the same invariant.
 * A play-time ingest mount (`deferred-ingest-play.ts`) crosses this boundary
 * while it constructs, then explicitly releases the hold and flips to Game.
 */

import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { projectAdapterFacet } from '@volter/editor-sdk/kit/project-adapter';
import { sceneDocumentId } from '@volter/editor-sdk/kit/scene-document-plan';
import { CANVAS_SCENE_DOCUMENT_ID, SCENE_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import {
  activateWorkspaceDocument,
  openWorkspaceDocuments,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { activeIngest } from './active-ingest';
import { activeIngestPauseGap, holdIngestContentTimeForMode } from './ingest-play-control';

export function landIngestBootInEdit(): void {
  const active = activeIngest();
  if (active) {
    const held = holdIngestContentTimeForMode('edit');
    if (!held) {
      throw new Error(
        `Ingest "${active.worldId}" mounted without the required pause capability; refusing ` +
          `to expose a running game in Edit — ${activeIngestPauseGap() ?? 'no lifecycle control was bound'}.`,
      );
    }
    editorConsole.log(
      `Ingest "${active.worldId}" is HELD — content time does not advance in Edit until ▶`,
      'ingest',
    );
  }
  const open = openWorkspaceDocuments();
  const defaultId = projectAdapterFacet()?.scenes.default;
  const isolationId = defaultId ? sceneDocumentId(defaultId) : undefined;
  const scene =
    (isolationId ? open.find((d) => d.descriptor.id === isolationId) : undefined) ??
    open.find((d) => d.descriptor.id === CANVAS_SCENE_DOCUMENT_ID) ??
    open.find((d) => d.descriptor.id === SCENE_DOCUMENT_ID);
  if (scene) activateWorkspaceDocument(scene.descriptor.id);
}
