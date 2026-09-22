import { themeVars } from '../theme';

/**
 * Shared semantic-tone triples for dismissible chrome banners
 * (V-16): two sibling banners each hand-rolled an identical-shaped
 * `{bg, border, fg}` triple as its own inline magic values — built from the
 * same lightness formula, but two independent literals with no shared
 * constant. Hoisted here so a future retouch of one can't silently drift
 * from the other (the same class of bug V-4 already demonstrated happened
 * to `PlayBar`'s button styles).
 *
 * These are tinted-panel triples, not `theme.ts`'s flat `danger`/`warn`
 * scalars (`theme.ts` has no "dark tinted banner background" slot) — kept
 * as their own small module rather than added to the shared token file.
 */

export interface BannerTone {
  bg: string;
  border: string;
  fg: string;
}

export const TONE_ERROR: BannerTone = {
  bg: themeVars.semantic.dangerFaint,
  border: themeVars.semantic.danger,
  fg: themeVars.semantic.danger,
};
export const TONE_WARNING: BannerTone = {
  bg: themeVars.semantic.warningMuted,
  border: themeVars.semantic.warning,
  fg: themeVars.semantic.warning,
};
