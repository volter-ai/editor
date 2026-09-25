/*---------------------------------------------------------------------------------------------
 *  THE PLOTTER LOOK'S FACES — Geist and Geist Mono (SIL OFL 1.1, `media/fonts/Geist-OFL.txt`,
 *  from the `geist` package the brand itself serves them from). Loaded through
 *  `FileAccess.asBrowserUri` off the APP ROOT, the way the model editor loads Inter, so they are
 *  `'self'` under the workbench's CSP and nothing is fetched from the network. The faces are
 *  declared in every window; only the Plotter look names them (`media/plotter-look.css`, and the
 *  palette's typography for the editor's own panels, which render in this same document).
 *--------------------------------------------------------------------------------------------*/

import './media/plotter-look.css';
import { mainWindow } from '../../../../base/browser/window.js';
import { FileAccess } from '../../../../base/common/network.js';

(() => {
	const face = (family: string, file: string) =>
		`@font-face { font-family: '${family}'; src: url(${FileAccess.asBrowserUri(`vs/workbench/contrib/vgai/browser/media/fonts/${file}`).toString(true)}) format('woff2'); font-weight: 100 900; font-display: swap; }`;
	const style = mainWindow.document.createElement('style');
	style.textContent = [face('Geist', 'Geist-Variable.woff2'), face('Geist Mono', 'GeistMono-Variable.woff2')].join('\n');
	mainWindow.document.head.appendChild(style);
})();
