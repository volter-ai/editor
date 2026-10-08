/**
 * Window ▸ Save Screenshot (Editor)… — Blender's own row (`TOPBAR_MT_window`, `screen.screenshot_area`),
 * the person's door to the photograph an agent takes with `get_viewport_screenshot`.
 *
 * Blender asks for a path in its file browser; the files door has no file picker, so the picture
 * goes to the project's `screenshots/` folder and the console says which file it is. Like every
 * photograph of the document it flashes the document and shows itself in the corner.
 */
import type { MenuContribution } from '@volter/sdk/chrome';
import { editorHost } from '@volter/sdk/host';
import { announcePhotograph } from '@volter/sdk/kit/photograph-notice';

export const point = 'workspace.menu';

export const menu: MenuContribution = {
  menu: 'window',
  items: [
    {
      id: 'blender-save-screenshot-editor',
      label: 'Save Screenshot (Editor)…',
      testId: 'menu-save-screenshot-editor',
      execute: async () => {
        const host = editorHost();
        const capture = await host.documents.captureActive();
        announcePhotograph(capture.base64);
        const path = `screenshots/screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        await host.files.write(path, Uint8Array.from(atob(capture.base64), (c) => c.charCodeAt(0)));
        host.console.log(`Saved the screenshot to ${path}.`, 'blender-screenshot');
      },
    },
  ],
};
