/**
 * The editor design system — patterns, primitives and the theme members its
 * own surfaces read, as ONE module. Theme definitions, CSS recipes,
 * primitives and recurring patterns stay implementation details below it.
 *
 * It is not a published subpath: `./index.ts` re-exports it, and the face is
 * `@volter/editor-sdk/widgets` (ARCHITECTURE-CORE §The target shape, rule 5 —
 * one API, four faces). Everything in and below this file must stay
 * react-only, or the Apache package starts reaching AGPL host source.
 */

export {
  composeEditorAppearance,
  EDITOR_MATERIAL_IDS,
  EDITOR_MATERIALS,
  type EditorMaterialChoice,
  type EditorMaterialId,
  type EditorPalette,
  isEditorMaterialId,
} from './editor-appearance';
export * from './patterns/Dialog';
export * from './patterns/Fields';
export * from './patterns/List';
export * from './patterns/StateSurface';
export * from './patterns/Surfaces';
export * from './patterns/Tabs';
export * from './patterns/Toolbar';
export * from './patterns/Tree';
export * from './primitives/AnchoredMenu';
export * from './primitives/Button';
export * from './primitives/banner-tones';
export * from './primitives/ColorInput';
export * from './primitives/clamp-to-viewport';
export * from './primitives/EditorIcon';
export { editorIcons } from './primitives/editor-icons';
export * from './primitives/FormControls';
export * from './primitives/HoverPreview';
export * from './primitives/JsonInput';
export * from './primitives/Layout';
export * from './primitives/Menu';
export * from './primitives/NumberInput';
export * from './primitives/Panel';
export * from './primitives/SectionHeader';
export * from './primitives/Text';
export * from './primitives/ThemeRootPortal';
export * from './primitives/Tooltip';
export * from './primitives/Vec3Input';
// Product surfaces consume runtime theme references through this boundary as
// they migrate away from direct `theme.ts` imports. Keeping the references
// here preserves custom-theme behavior without exposing design-system internals.
export {
  accent,
  accentMuted,
  applyEditorTheme,
  bg,
  border,
  chromeSize,
  controlSize,
  danger,
  dangerFaint,
  dangerMuted,
  EDITOR_THEME_CLASS,
  type EditorTheme,
  type EditorThemeId,
  type EditorThemeVariable,
  editorThemes,
  editorThemeVariables,
  fontMono,
  fontSans,
  fontSize,
  fontSizeVar,
  fontWeight,
  graphiteDarkEditorTheme,
  lineHeight,
  lineHeightVar,
  midnightHighContrastEditorTheme,
  motion,
  motionVar,
  radius,
  scrim,
  selection,
  shadow,
  space,
  spaceVar,
  strokeWidth,
  success,
  successMuted,
  text,
  themeVars,
  warn,
  warnMuted,
} from './theme';
export { zIndex } from './z-index';
