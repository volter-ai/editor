/**
 * The Stories inspection section's renderer (D4/B3) — the story picker for a
 * `world:<id>` group row whose owning child adapter advertises `stories`, and
 * for a `kind:'component'` catalog node (which also gets the Isolate toggle).
 *
 * The governing adapter decides which nodes own portable states. React roots
 * can apply them in place; Three component nodes open the same CSF state in
 * the standard Object3D story document. This renderer knows neither substrate
 * — it renders the provider data it is handed.
 */

import { Button, Select, themeVars } from '@volter/editor-sdk/widgets';

export interface InspectorStoriesSectionProps {
  /** The selection's available portable-CSF previews (`[]` ⇒ the disclosure). */
  readonly stories: readonly { readonly id: string; readonly label: string }[];
  /** Currently applied story id, or `''` for none. */
  readonly activeStoryId: string;
  readonly onApplyStory: (storyId: string | null) => void;
  /** B3 — a catalog component node also gets the Isolate toggle. */
  readonly isolation: { readonly isolated: boolean; readonly toggle: () => void } | null;
  /** The PROVIDER's own reason its list could not be read
   *  (`StoriesProvider.unavailable`), or `null`/absent when it ran. This
   *  renderer reaches into no particular provider's discovery to find out:
   *  the same section draws an ingested game's screens and a project's CSF. */
  readonly unavailableReason?: string | null;
}

export function InspectorStoriesSection({
  stories,
  activeStoryId,
  onApplyStory,
  isolation,
  unavailableReason,
}: InspectorStoriesSectionProps) {
  // No "Stories" label and no divider of its own: the projection heads every
  // section with its title + icon and owns the separator
  // (`components/InspectionProjection.tsx`).
  return (
    <div style={{ padding: '4px 0' }}>
      {stories.length > 0 ? (
        <Select
          data-testid="ingest-stories-select"
          value={activeStoryId}
          onChange={(e) => {
            const v = e.target.value;
            onApplyStory(v === '' ? null : v);
          }}
          style={{ width: '100%' }}
        >
          <option value="">(none)</option>
          {stories.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      ) : (
        <div
          data-testid="ingest-stories-none"
          style={{
            fontSize: 'var(--vgai-font-base)',
            color: themeVars.content.dim,
            fontStyle: 'italic',
          }}
        >
          {/* "This root has no previews" is a claim about the PROJECT, and it
              is only true when discovery actually ran. When it could not, say
              which realm limitation or host failure stopped it instead — an
              empty list and an unread list look identical from here. */}
          {unavailableReason ?? 'No stories — this root has no associated portable CSF previews.'}
        </div>
      )}
      {/* B3 — Isolate toggle: render ONLY this catalog component (alone,
          against whichever story is currently selected in the dropdown
          above) on the world's design-time layer; exiting restores the
          Live Preview. Session-only — mirrors the story overlay writes,
          never persisted to source. */}
      {isolation && (
        <Button
          data-testid="catalog-isolate"
          onClick={isolation.toggle}
          variant={isolation.isolated ? 'primary' : 'secondary'}
          aria-pressed={isolation.isolated}
          style={{ marginTop: 6, width: '100%' }}
        >
          {isolation.isolated ? 'Exit isolation' : 'Isolate'}
        </Button>
      )}
    </div>
  );
}
