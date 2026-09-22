import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faCaretDown,
  faCaretRight,
  faChevronDown,
  faChevronRight,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type React from 'react';
import { useSyncExternalStore } from 'react';
import { activeIconGlyph, activeIconSetSnapshot, subscribeIconSets } from '../icon-set-registry';
import { themeVars } from '../theme';

export type EditorIconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
export type EditorIconTone = 'current' | 'primary' | 'muted' | 'dim' | 'accent' | 'danger';

// A glyph's size is the ICON scale (`theme.ts`'s `iconSize`), not the type
// scale: these sizes used to be the font's rungs, so a skin that tightened its
// text shrank every glyph with it — under Blender's density the chrome drew
// 10–11 px glyphs where Blender draws 14.
const SIZE: Record<EditorIconSize, string> = {
  xs: 'var(--vgai-icon-xs)',
  sm: 'var(--vgai-icon-sm)',
  md: 'var(--vgai-icon-md)',
  lg: 'var(--vgai-icon-lg)',
  xl: 'var(--vgai-icon-xl)',
  '2xl': 'var(--vgai-icon-2xl)',
};

const TONE: Record<EditorIconTone, string | undefined> = {
  current: undefined,
  primary: themeVars.content.primary,
  muted: themeVars.content.muted,
  dim: themeVars.content.dim,
  accent: themeVars.accent.default,
  danger: themeVars.semantic.danger,
};

export interface EditorIconProps extends Omit<React.HTMLAttributes<SVGSVGElement>, 'color'> {
  icon: IconDefinition;
  size?: EditorIconSize;
  tone?: EditorIconTone;
  /** Icons inside already-labelled controls stay decorative by default. */
  label?: string;
  spin?: boolean;
}

/** Canonical editor-chrome icon metrics and accessibility behavior. */
export function EditorIcon({
  icon,
  size = 'sm',
  tone = 'current',
  label,
  className,
  style,
  spin = false,
  ...svgProps
}: EditorIconProps) {
  // The active icon set (`icon-set-registry.ts`): a glyph it carries for this
  // name paints in Font Awesome's box (1.25em fixed width, 1em tall, the
  // -0.125em baseline) so no site notices which set is on.
  useSyncExternalStore(subscribeIconSets, activeIconSetSnapshot, activeIconSetSnapshot);
  const glyph = activeIconGlyph(icon.iconName);
  if (glyph) {
    // THE GLYPH'S OWN COLOUR, and who wins. A site that names a tone has
    // said something about THIS instance — de-emphasis (`dim`/`muted` on a
    // quiet rail), status (`danger`) — and that always wins; `current` is the
    // default, i.e. the site said nothing, so the glyph's category speaks.
    const siteToned = tone !== 'current';
    const categoryInk = glyph.tone ? `var(--vgai-category-${glyph.tone}, currentColor)` : undefined;
    // With a `tonedPath` the category tints only that path and the body stays
    // `currentColor` — Blender's operator marks tint the OPERATED element and
    // leave the cube neutral. Without one, the category is the whole glyph's
    // ink, so it rides `color` and every path inherits it.
    const svgColor = siteToned ? TONE[tone] : glyph.tonedPath ? undefined : categoryInk;
    const tonedFill = siteToned ? 'currentColor' : (categoryInk ?? 'currentColor');
    return (
      <svg
        {...svgProps}
        viewBox={glyph.viewBox ?? '0 0 16 16'}
        // THE SITE'S HALF OF THE INK. A category token is the glyph's colour
        // at FULL opacity (`theme.ts`'s category docblock) and Blender's own
        // alpha belongs to the SITE — 0.80 in the Outliner and on an inactive
        // Properties tab, 1.00 on the open tab and in the tool shelf. A site
        // can only apply that to the glyphs it actually tints, so the tone
        // rides out as a DOM marker: a set with no tone for this name (Font
        // Awesome's, every Classic surface) carries no attribute and no rule
        // keyed on it can reach it.
        data-vgai-tone={siteToned ? undefined : glyph.tone}
        className={className}
        aria-hidden={label ? undefined : (svgProps['aria-hidden'] ?? 'true')}
        aria-label={label}
        role={label ? 'img' : undefined}
        style={{
          width: '1.25em',
          height: '1em',
          overflow: 'visible',
          verticalAlign: '-0.125em',
          fontSize: SIZE[size],
          color: svgColor,
          ...style,
        }}
      >
        <path d={glyph.path} fill="currentColor" />
        {glyph.tonedPath ? <path d={glyph.tonedPath} fill={tonedFill} /> : null}
      </svg>
    );
  }
  return (
    <FontAwesomeIcon
      {...svgProps}
      icon={icon}
      fixedWidth
      spin={spin}
      className={className}
      aria-hidden={label ? undefined : (svgProps['aria-hidden'] ?? 'true')}
      aria-label={label}
      role={label ? 'img' : undefined}
      style={{ fontSize: SIZE[size], color: TONE[tone], ...style }}
    />
  );
}

export function DisclosureIcon({
  direction,
  size = 'xs',
  tone = 'current',
  style,
}: {
  direction: 'right' | 'down';
  size?: EditorIconSize;
  tone?: EditorIconTone;
  style?: React.CSSProperties;
}) {
  return (
    <EditorIcon
      icon={direction === 'right' ? faChevronRight : faChevronDown}
      size={size}
      tone={tone}
      {...(style ? { style } : {})}
    />
  );
}

export function TreeDisclosureIcon({
  direction,
  size = 'xs',
  tone = 'current',
}: {
  direction: 'right' | 'down';
  size?: EditorIconSize;
  tone?: EditorIconTone;
}) {
  return (
    <EditorIcon icon={direction === 'right' ? faCaretRight : faCaretDown} size={size} tone={tone} />
  );
}
