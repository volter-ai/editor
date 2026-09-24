/**
 * The animation stamp's status facet (`@volter/editor-sdk/services`, a `workspace.service`
 * contribution): `vgai status` reports the mixers the running world's own code made, with the
 * clips it has played through each and the objects each animates, so "the timeline found
 * nothing" is answerable from the session.
 */
import { editorHost } from '@volter/editor-sdk/host';
import { liveMixers } from '../src/animation/live-mixers';

export const point = 'workspace.service';

export function start(): () => void {
  return editorHost().session.reportFacet(() => ({
    liveMixers: liveMixers().map((entry) => ({
      site: entry.key,
      clips: [...entry.clips.keys()],
      animates: [...entry.roots].map((root) => (root as { name?: string }).name || '(unnamed)'),
    })),
  }));
}
