/**
 * THE GAME DOCUMENT's content, registered (`@volter/editor-sdk/services`, a
 * `workspace.service` contribution). The host owns the live document's
 * LIFETIME — `workspace:game` opens when a lane acquires it and closes on the
 * playing → stopped edge (`live-document.ts`) — and this package owns what it
 * DRAWS: the panel a runtime mounts into and the document-local toolbar
 * (resolution, device emulation, instance inspection, debug draw, frame
 * capture).
 *
 * A service rather than a module-load side effect, so the registration is
 * paired with an unregistration the host runs before the next contribution
 * pass — a build that drops `@volter/editor-game` leaves the host with no live content
 * and the door's own `NoLiveContent` placeholder, which is the honest state.
 */
import { editorHost } from '@volter/editor-sdk/host';
import { GameDocumentContent, GameDocumentToolbar } from '../src/game-document/GameDocument';

export const point = 'workspace.service';

export function start(): () => void {
  return editorHost().workspace.liveDocument.register({
    Content: GameDocumentContent,
    Toolbar: GameDocumentToolbar,
  });
}
