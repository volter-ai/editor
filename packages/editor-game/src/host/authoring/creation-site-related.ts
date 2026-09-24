/**
 * CREATION-SITE RELATED LINKS — a kit piece of the live-adapter toolbox
 * (owner-directed program, 2026-08-22: everything substrate-neutral is
 * shared, so a new substrate adapter costs only its projection).
 *
 * The ONE jump a live subject honestly has is to the source line that
 * constructs it — the serve-time OID stamp for a fiber world, the `new` site
 * for a structural one. This existed twice, self-admittedly ("the canvas
 * lane's method transcribed"): `PixiAuthoringAdapter.creationSiteLinks` and
 * `ThreeAuthoringAdapter.related`. One producer now; an adapter hands in only
 * its own site resolution.
 *
 * Only a SOURCE anchor names a `file:line` the editor's source-locator door
 * speaks; an unanchored or level-data subject reports no link at all (the
 * inspector's creation-site note already says why, in its own words) — a link
 * titled "unknown" would be a jump to nowhere. Opening reuses
 * `runInstanceSourceAction` verbatim, so no lane can drift into a second
 * sentence for the same act. The locator is a standalone object and NOT a
 * `sourceLocation` method on any adapter, for the reason the Pixi lane
 * records: that name is duck-typed by `instanceSourceLocatorFor` to decide
 * which rows get hierarchy source items.
 */

import type { NodeCreationSite, RelatedSubjectsProvider } from '@volter/editor-project/adapter';
import { type InstanceSourceLocator, runInstanceSourceAction } from '@volter/editor-sdk/kit/instance-source-actions';
import { showTransientHint } from '@volter/editor-sdk/kit/transient-hint';

/** The related provider for an adapter whose truth can place a subject at a
 *  creation site. `resolveSite` is the adapter's own id→site hop. */
export function creationSiteRelated(
  resolveSite: (id: string) => NodeCreationSite,
): RelatedSubjectsProvider {
  const locator: InstanceSourceLocator = {
    sourceLocation: (id) => {
      const site = resolveSite(id);
      if (!site.anchored || site.kind !== 'source') return undefined;
      return { file: site.file, line: site.line };
    },
  };
  return {
    links: (id) => {
      const site = resolveSite(id);
      if (!site.anchored || site.kind !== 'source') return [];
      return [
        {
          id: `creation-site:${site.file}:${site.line}:${site.col}`,
          title: `Constructed at ${site.display}`,
          open: () => {
            void runInstanceSourceAction(locator, id, 'callsite').then(showTransientHint);
          },
        },
      ];
    },
  };
}
