/**
 * "Agent presented this view" — published as a NOTIFICATION
 * (`editor-notifications.ts`), with Copy Link and Return inline. It used to be
 * a banner floated over the document's top centre, across the tab row; the
 * owner named that shape as wrong (2026-09-04) and the notification stack is
 * where an event like this goes. This component keeps no DOM: it watches the
 * presentation-notice store and mirrors it into a card.
 */

import { threeStateOf } from '../three-state';
import { useEffect, useSyncExternalStore } from 'react';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { dismissNotification, notify } from '../editor-notifications';
import {
  clearEditorPresentationNotice,
  editorPresentationNotice,
  editorPresentationNoticeVersion,
  subscribeEditorPresentationNotice,
} from '../editor-presentation-notice';
import { useEditorStore } from '../editor-runtime';
import { presentEditorView } from '../editor-view-presentation';

const NOTIFICATION_ID = 'agent-presented-view';

export function AgentPresentationNotice() {
  const store = threeStateOf(useEditorStore());
  useSyncExternalStore(
    subscribeEditorPresentationNotice,
    editorPresentationNoticeVersion,
    editorPresentationNoticeVersion,
  );
  const notice = editorPresentationNotice();
  useEffect(() => {
    if (!notice) {
      dismissNotification(NOTIFICATION_ID);
      return;
    }
    notify({
      id: NOTIFICATION_ID,
      tone: 'info',
      title: 'Agent presented this view.',
      ...(notice.presented.warnings.length > 0
        ? { detail: notice.presented.warnings.join(' ') }
        : {}),
      onDismiss: clearEditorPresentationNotice,
      actions: [
        {
          label: 'Copy Link',
          keeps: true,
          run: () => {
            void Promise.resolve()
              .then(() => navigator.clipboard.writeText(notice.presented.url))
              .catch(() => {
                editorConsole.warn('Could not copy the view link to the clipboard.', 'editor');
              });
          },
        },
        {
          label: 'Return',
          primary: true,
          run: () => {
            void presentEditorView(store, notice.previousView, { origin: 'return' }).catch(
              (error) => {
                editorConsole.error(
                  `Could not return to the previous editor view: ${error instanceof Error ? error.message : String(error)}`,
                  'editor',
                );
              },
            );
          },
        },
      ],
    });
  }, [notice, store]);
  return null;
}
