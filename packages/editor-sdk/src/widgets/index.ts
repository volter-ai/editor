/**
 * `@volter/editor-sdk/widgets` — THE WIDGET KIT, the API's fourth face beside
 * `protocol`, the host doors + `layouts`, and `session`
 * (ARCHITECTURE-CORE §The target shape, rule 5: "One API, four faces,
 * Apache"). These are the editor's OWN widgets — the exact components its
 * inspector renders — so a panel built from them looks native and re-skins
 * with the editor. Apache-2.0 like the rest of the SDK: a package or a
 * project may draw a panel without taking the host's AGPL.
 *
 * Import it from a package contribution or a project's own
 * `src/contributions/my-tool.document.tsx`:
 *
 * ```tsx
 * import { Inline, NumberInput, SectionHeader, themeVars } from '@volter/editor-sdk/widgets';
 * ```
 *
 * What's here:
 * - **Tokens**: typed semantic `themeVars`; legacy `THEME`/font aliases remain
 *   compatibility exports for existing inspector widgets only.
 * - **Structure**: layout, typography, surfaces, dialogs, toolbars, tabs,
 *   trees, fields, feedback, and menus.
 * - **Inputs**: `NumberInput` (scrub-or-type), `Vec3Input`, `ColorInput`,
 *   `DraftTextInput`, `ScrubbableInput`, `ColorPicker`/`ColorSwatch`,
 *   `GradientEditor`, `FontPicker`, `AlignmentGrid`, `BorderEditor`,
 *   `ShadowEditor`, `FilterEditor`, `CurveEditor`, `AssetSlotPicker`,
 *   `ToggleButton`.
 * - **Appearance**: the theme table, the editor materials, the icon-set
 *   registry, the glyph table and the stacking scale — the values the
 *   components above paint with. `design-system.ts` re-exports the members
 *   its own surfaces use; this face is the UNION, which is why each of those
 *   modules also has its own line below. Where a name arrives by two stars
 *   both resolve to the SAME declaration, so nothing is ambiguous.
 *
 * Contract notes:
 * - The rich widgets share one change contract, `ChangeHandlers<T>`
 *   (`value` + `onChange` per interaction tick + optional `onChangeEnd`
 *   commit — see its doc comment).
 * - Layout and state chrome are API so built-in and project-authored tools
 *   cannot drift into parallel UI kits. Domain charts remain project-owned.
 * - ONE SUBPATH: there is no `./design-system` and no `./theme` door, and the
 *   deep paths the host used to take (`./editor-material`,
 *   `./icon-set-registry`, `./interactive-edit-scope`, `./z-index`,
 *   `components/primitives/editor-icons`) all arrive through this module.
 *   The kit's dependency closure is deliberately shallow — react, react-dom,
 *   Font Awesome, and the SDK's own `looks` types — so a scaffolded
 *   project's `tsc` never drags the editor's internals along, and the
 *   Apache face never reaches AGPL host source (`interactive-edit-scope.ts`
 *   exists precisely to keep `NumberInput`/`ColorInput` off `EditorContext`).
 *   Don't add re-exports here that import the editor store, adapters, or
 *   server code.
 * - The CLASSES these components paint with (`vgai-btn`, `vgai-input`,
 *   `vgai-menu`, …) are declared by the host's own `theme.css`, which stays
 *   in `packages/editor/src` because it is the editor's chrome sheet — the
 *   TOKENS those rules read are installed at runtime from `theme.ts` here
 *   (`editorThemeVariables`).
 *
 * The export lines are ONE alphabetical block because Biome's
 * `organizeImports` sorts them; each line's subject is named above rather
 * than beside it, so a re-sort cannot separate a comment from its target.
 */

export * from './design-system';
export * from './editor-appearance';
export * from './editor-material';
export * from './icon-set-registry';
export * from './inspector-widgets';
export * from './interactive-edit-scope';
export * from './primitives/DraftTextInput';
export * from './primitives/editor-icons';
export * from './theme';
export * from './z-index';
