/*---------------------------------------------------------------------------------------------
 *  THE TOP BAR — the look owns the title bar's height, and that is the fork's CORE EDIT 1
 *  (WORK.md U9; the list is in `vgai/README.md`).
 *
 *  WHAT IS ALREADY THE TITLE BAR, WITH NO CORE EDIT. Our whole header is: the contribution
 *  hands the bridge a slot appended into `.part.titlebar .titlebar-container` and the bridge
 *  portals `ProjectHeader` into it. The WORKSPACE-TAB ROW and the PLAY TRANSPORT come with it,
 *  because both are `ProjectHeader`'s own children (`ProjectHeader.tsx`'s `<WorkspaceTabs/>`
 *  and its `transport` slot, which defaults to the connected `PlayBar` the game skew
 *  contributes). So the half of U9's brief that reads "the workspace-tab row as a title-bar
 *  element" needed NO core edit and no new mechanism, and neither did the Game skew's
 *  transport (WORK.md U2).
 *
 *  WHAT COULD NOT BE REACHED, and the four routes measured before the edit was made:
 *
 *  1. AN EXTENSION'S `configurationDefaults`. There is no height SETTING to set. The value is
 *     `DEFAULT_CUSTOM_TITLEBAR_HEIGHT` (35) in `platform/window/common/window.ts` and a bare
 *     `30` in the part, chosen by `isCommandCenterVisible || isWCOEnabled()`. The route fails
 *     for want of a KEY, not for want of scope — the scope wall the spike measured
 *     (`window.customTitleBarVisibility` and friends are APPLICATION-scoped, so an extension
 *     default is filtered out) is a different problem, already routed around by the command
 *     writing those keys itself.
 *  2. A PROGRAMMATIC WRITE through U7's adapter layer. Same answer: no key exists to write.
 *  3. `IWorkbenchLayoutService.setSize(Parts.TITLEBAR_PART, { height })`. It reaches
 *     `SplitView.resizeView`, whose line
 *     `size = clamp(size, item.minimumSize, Math.min(item.maximumSize, this.size))` clamps
 *     against the view's own min/max — and the title bar reports `maximumHeight` as literally
 *     `this.minimumHeight`, so the part is PINNED and the call is a no-op.
 *  4. CSS over `.part.titlebar`. The grid RESERVES the part's height; a stylesheet paints our
 *     header shorter inside a slot that is still 30 or 35 px tall, leaving a band of dead title
 *     bar under it and the editor still starting at the old y. That is not a height change.
 *
 *  So the edit: FOUR LINES over two files, adding one number the part will honour —
 *  `window.titleBarHeight`, read in `BrowserTitlebarPart.minimumHeight` (plus the one-line
 *  guard in `NativeTitlebarPart`'s macOS override, which never calls super), and a one-line
 *  re-fire so a look CHANGED at runtime re-lays out the grid. Nothing is removed and nothing
 *  branches on vgai: an unset key is the workbench's own behaviour, byte for byte.
 *
 *  WHERE THE VALUE COMES FROM. The LOOK, through the layer U7 already built. The editor's
 *  chrome density carries a top-bar height per look — `theme.ts`'s `chromeSize.commandBar`
 *  (36, Classic's) and `@vgai/blender`'s `blender.style.ts` `chrome.commandBar` (26, traced
 *  from Blender 5.2's own frames at 1x) — published as the `--vgai-command-bar-height` custom
 *  property `.vgai-project-header`'s own CSS reads for its `height`. The bridge hands that
 *  resolved number over and `vgaiSettings.ts` writes it at `ConfigurationTarget.MEMORY` with
 *  the same INSPECT GATE every other key on that layer has, so a project's
 *  `.vscode/settings.json` still outranks it. There is no second source of truth for the
 *  number: the title bar is exactly as tall as the band our own stylesheet would have drawn.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';

/** The one key core edit 1 reads. Named in the `window` namespace rather than `vgai.*` on
 *  purpose: it is a fact about the WINDOW's chrome, it is the shape upstream would give the
 *  setting if it ever grew one, and on the day it does our edit disappears instead of leaving
 *  a vgai-branded key behind in a core part. */
export const TITLE_BAR_HEIGHT_KEY = 'window.titleBarHeight';

// WINDOW scope, not APPLICATION: the height is a property of the window a project is open in,
// so a project may answer it in `.vscode/settings.json` and the adapter layer's inspect gate
// hands it the win. Declared with NO default, so an unset key leaves the part's own 30/35
// arithmetic untouched — a workbench with no vgai project open is byte-identical to upstream.
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'window',
	order: 8,
	title: localize('vgaiWindowConfigurationTitle', "Window"),
	type: 'object',
	properties: {
		[TITLE_BAR_HEIGHT_KEY]: {
			type: 'number',
			minimum: 1,
			scope: ConfigurationScope.WINDOW,
			markdownDescription: localize('vgaiTitleBarHeight', "The height of the custom title bar, in pixels. Unset, the title bar sizes itself (30px, or 35px with the Command Center). The Volter Editor sets this from the active look's own top-bar height."),
		},
	},
});
