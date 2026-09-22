/**
 * Canonical z-index scale (editor-style-polish U0).
 * Replaces the ungoverned 1..10000 range (4 orders of magnitude, 2 sites
 * typed as strings) with named tiers. Re-exported from `theme.ts`; kept as
 * its own module too so a call site that only needs stacking order doesn't
 * have to import the whole token set.
 *
 * `designTimeLayers` is deliberately NOT given a single number here —
 * `authoring/design-time-layers.ts`'s `BASE_Z_INDEX` is already a real,
 * scoped constant for that tier and is left as-is per the audit.
 */
export const zIndex = {
  /** Default stacking (no explicit z-index needed). */
  base: 0,
  /** World-selection / text-edit / align-toolbar tier (absorbs 20/50/60/70). */
  overlayLow: 50,
  /** Sticky editor chrome stays above in-document overlays but below floating UI. */
  sticky: 100,
  /** Dropdown, context-menu, tooltip, and popover tier. */
  dropdown: 1000,
  /** Toast tier. */
  toast: 9999,
  /** Modal tier — already consistent across all dialog components. */
  modal: 10000,
} as const;
