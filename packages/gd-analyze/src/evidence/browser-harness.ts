/**
 * The target side of a proof that needs the page's WebGL2 context (GPU particles run Godot's own
 * `particles.glsl` through transform feedback, which Node has no context for): the emitted project
 * served by Vite's dev server with one harness page beside it, opened in headless Chromium, whose
 * GL is ANGLE over the machine's GPU. The page publishes its rows as `window.godotProofRows` (or
 * `window.godotProofError`); nothing else is read from it.
 *
 * Chromium comes from Playwright's own install (`npx playwright install chromium`), the same
 * browser the lane's other page drivers use.
 */
import { writeFileSync } from 'node:fs';
import * as path from 'node:path';

export interface BrowserProofPage {
  /** The harness module's source: it mounts the scene and sets `window.godotProofRows`. */
  readonly module: string;
  /** How long the page may take to publish its rows. */
  readonly timeoutMs?: number;
}

/** The rows the harness page published, and the renderer it ran on. */
export interface BrowserProofResult {
  readonly rows: unknown;
  readonly renderer: string;
}

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0"><div id="root" style="width:320px;height:240px"></div>
<script type="module" src="/godot-proof.tsx"></script></body></html>
`;

export async function runBrowserProof(projectDir: string, page: BrowserProofPage): Promise<BrowserProofResult> {
  writeFileSync(path.join(projectDir, 'godot-proof.html'), HTML);
  writeFileSync(path.join(projectDir, 'godot-proof.tsx'), page.module);
  const { createServer } = await import('vite');
  const { chromium } = await import('playwright');
  const server = await createServer({
    root: projectDir,
    configFile: path.join(projectDir, 'vite.config.ts'),
    logLevel: 'error',
    server: { port: 0, strictPort: false, hmr: false },
  });
  await server.listen();
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
  try {
    const address = server.resolvedUrls?.local[0];
    if (address === undefined) throw new Error('the proof page server has no local address');
    const tab = await browser.newPage();
    const console: string[] = [];
    tab.on('console', (message) => console.push(`${message.type()}: ${message.text()}`));
    tab.on('pageerror', (error) => console.push(`pageerror: ${error.message}`));
    await tab.goto(new URL('godot-proof.html', address).href);
    const timeout = page.timeoutMs ?? 120_000;
    try {
      await tab.waitForFunction(
        () => (window as { godotProofRows?: unknown; godotProofError?: unknown }).godotProofRows !== undefined ||
          (window as { godotProofError?: unknown }).godotProofError !== undefined,
        undefined,
        { timeout },
      );
    } catch (error) {
      throw new Error(`the proof page published nothing within ${String(timeout)} ms\n${console.join('\n')}`, { cause: error });
    }
    const published = await tab.evaluate(() => {
      const view = window as { godotProofRows?: unknown; godotProofError?: unknown };
      const gl = document.createElement('canvas').getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      const renderer = gl === null || gl === undefined ? 'no webgl2' : String(gl.getParameter(info === null || info === undefined ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL));
      return { rows: view.godotProofRows, error: view.godotProofError, renderer };
    });
    if (published.error !== undefined) throw new Error(`the proof page failed: ${String(published.error)}\n${console.join('\n')}`);
    return { rows: published.rows, renderer: published.renderer };
  } finally {
    await browser.close();
    await server.close();
  }
}
