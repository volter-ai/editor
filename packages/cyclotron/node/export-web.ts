/**
 * `export web [folder] --out <dir>` — A MODEL'S GAME AS A STATIC WEB PAGE: index.html and its
 * assets, playing in any browser from any static host, with no editor and no Blender.
 *
 * 1. THE DUMP. The running editor tab holding the model writes what the game plays into the
 *    project's `.volter/export/web/` (`blender-export-play`, `@volter/editor-blender`'s
 *    `blender-export.command.ts`): the model's frame, every armature's clips baked, the scene's
 *    display transform and camera. Blender lives in that tab, so the editor must be running with
 *    the model open (`cyclotron edit`). `--no-dump` builds from the dump already there.
 * 2. THE PAGE. A generated entry, modelled on the game editor's standalone boot
 *    (`@volter/game-editor`'s template `src/main.ts`), boots `web-player.ts` over the dump:
 *    the scene from the frame, Play's animation over the clips, the project's play script through
 *    `@volter/play`'s host-free runner, and every `dom` root the manifest declares mounted with
 *    react-dom over the canvas. One bundle, so the script and its UI share their modules (a store
 *    both import) as they do in the editor.
 * 3. THE BUILD is the project's own Vite (the one its editor runs) in production mode, rooted in a
 *    scratch folder beside the dump; the dump's files are copied beside the page under `data/`.
 *    Workers, lookup tables and other assets the engine loads through `new URL(…, import.meta.url)`
 *    are emitted by that build like any import.
 *
 * `--out` defaults to the project's `dist/web`. A folder that holds something other than an
 * earlier export is refused.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hasManifest } from '@volter/project/manifest/locate';
import {
  WEB_EXPORT_CLIPS_FILE,
  WEB_EXPORT_MOVIE_FILE,
  WEB_EXPORT_DUMP_DIR,
  WEB_EXPORT_FRAME_FILE,
  WEB_EXPORT_MANIFEST_FILE,
} from '@volter/editor-blender/web-export/web-export-files.ts';

import { levels as cookLevels, levelOf, listLevels } from './levels';

export const EXPORT_WEB_USAGE = 'export web [folder] [--out <dir>] [--document <id>] [--no-dump]';

/** The page's own folder of data files, beside index.html. */
const DATA_DIR = 'data';
/** Written into every export, so a later export knows the folder is one it may replace. */
const MARKER = '.cyclotron-web-export';

interface DeclaredRoot {
  readonly id: string;
  readonly adapter: unknown;
  readonly entry?: string;
  readonly zOrder?: number;
}

interface ExportWebOptions {
  readonly out?: string | undefined;
  readonly document?: string | undefined;
  readonly dump?: boolean | undefined;
  readonly log?: (line: string) => void;
}

function projectOf(folder: string): string {
  for (let dir = resolve(folder); ; dir = dirname(dir)) {
    if (hasManifest(dir)) return dir;
    if (dirname(dir) === dir) throw new Error(`export web: ${resolve(folder)} is not inside a project (no volter.project.json).`);
  }
}

const posix = (path: string): string => path.split(sep).join('/');
/** An import specifier from `fromDir` to `file`. */
const specifier = (fromDir: string, file: string): string => {
  const path = posix(relative(fromDir, file));
  return path.startsWith('.') ? path : `./${path}`;
};

/** The project's own Vite, as its editor runs it. */
async function projectVite(project: string): Promise<typeof import('vite')> {
  const require = createRequire(join(project, 'package.json'));
  let packageJson: string;
  try { packageJson = require.resolve('vite/package.json'); }
  catch { throw new Error(`export web: ${project} has no vite installed; run npm install in the project.`); }
  const manifest = JSON.parse(readFileSync(packageJson, 'utf8')) as { exports?: Record<string, unknown> };
  const root = manifest.exports?.['.'] as { import?: string } | string | undefined;
  const entry = typeof root === 'string' ? root : root?.import ?? './dist/node/index.js';
  const url = pathToFileURL(join(dirname(packageJson), entry)).href;
  return (await import(/* @vite-ignore */ url)) as typeof import('vite');
}

/** `out` made ready: absent, empty, or an earlier export (which is replaced). */
function prepareOut(out: string, project: string): void {
  if (resolve(out) === resolve(project) || resolve(project).startsWith(resolve(out) + sep))
    throw new Error(`export web: --out ${out} would replace the project itself.`);
  if (!existsSync(out)) return;
  if (readdirSync(out).length > 0 && !existsSync(join(out, MARKER)))
    throw new Error(`export web: ${out} is not empty and holds no earlier export; refusing to write over it.`);
  rmSync(out, { recursive: true, force: true, maxRetries: 3 });
}

/** The entry the page boots (see the header, step 2). */
function entrySource(buildDir: string, project: string, script: string, roots: readonly DeclaredRoot[], levelScripts: Readonly<Record<string, string>> = {}, startLevel = ''): string {
  const imports = roots.map((root, index) => `import Root${index} from ${JSON.stringify(specifier(buildDir, join(project, root.entry!)))};`);
  const table = roots.map((root, index) => `  { id: ${JSON.stringify(root.id)}, zOrder: ${Number(root.zOrder ?? 0)}, component: Root${index} as ComponentType },`);
  // each level's own play script, loaded when the game loads the level (play.load)
  const levelTable = Object.entries(levelScripts).map(([level, path]) => `  ${JSON.stringify(level)}: { name: ${JSON.stringify(path)}, load: () => import(${JSON.stringify(specifier(buildDir, join(project, path)))}) },`);
  return `// Generated by \`cyclotron export web\`; rebuilt on every export.
import { createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { createPlayRunner } from '@volter/play/play-runner';
import { bootWebPlayer } from '@volter/editor-blender/web-export/web-player.ts';
import manifest from './${WEB_EXPORT_MANIFEST_FILE}';
import * as script from ${JSON.stringify(specifier(buildDir, join(project, script)))};
${imports.join('\n')}
// (the game's script runs: the page's own loading line gives way to the game's loader)
document.getElementById('boot')?.remove();

const roots = [
${table.join('\n')}
].sort((a, b) => a.zOrder - b.zOrder);
const levelScripts: Record<string, { name: string; load: () => Promise<{ default?: unknown }> }> = {
${levelTable.join('\n')}
};
const data = (file: string): string => new URL(\`./${DATA_DIR}/\${file}\`, document.baseURI).href;
const container = document.getElementById('game') as HTMLElement;

bootWebPlayer({
  container,
  manifest: manifest as Parameters<typeof bootWebPlayer>[0]['manifest'],
  frameUrl: data(${JSON.stringify(WEB_EXPORT_FRAME_FILE)}),
  clipsUrl: data(${JSON.stringify(WEB_EXPORT_CLIPS_FILE)}),
  movieUrl: data(${JSON.stringify(WEB_EXPORT_MOVIE_FILE)}),
  script,
  // THE LEVELS (docs/LEVELS.md): each cook under data/levels/, each level's script from the table above
  levels: {
    // (the level the page starts in is the page's own data: shipped once)
    url: (level, file) => (level === ${JSON.stringify(startLevel)} ? data(file) : data(\`levels/\${level}/\${file}\`)),
    script: (level) => levelScripts[level]?.load() ?? null,
    scriptName: (level) => levelScripts[level]?.name,
  },
  runner: (stage) => createPlayRunner({
    root: stage.root,
    camera: stage.camera,
    animation: stage.animation as Parameters<typeof createPlayRunner>[0]['animation'],
    ownMaterial: stage.ownMaterial,
    report: stage.report,
    ...(stage.loadLevel ? { loadLevel: stage.loadLevel as NonNullable<Parameters<typeof createPlayRunner>[0]['loadLevel']> } : {}),
    ...(stage.preloadLevel ? { preloadLevel: stage.preloadLevel } : {}),
  }),
  // Each dom root in its own layer over the canvas, stacked by zOrder; pointer events fall
  // through to the game except where the UI's own elements claim them.
  mountHud: (hud) => {
    for (const root of roots) {
      const layer = document.createElement('div');
      Object.assign(layer.style, { position: 'absolute', inset: '0', zIndex: String(root.zOrder), pointerEvents: 'none' });
      layer.dataset['rootId'] = root.id;
      layer.setAttribute('data-volter-game-styles', '');
      hud.appendChild(layer);
      createRoot(layer).render(createElement(root.component));
    }
  },
}).catch((error: unknown) => {
  const said = document.createElement('pre');
  said.style.cssText = 'position:fixed;inset:0;margin:0;padding:24px;color:#ff8a80;background:#000;font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap';
  said.textContent = \`The game could not start: \${error instanceof Error ? error.stack ?? error.message : String(error)}\`;
  document.body.appendChild(said);
  console.error(error);
});
`;
}

function pageSource(title: string): string {
  const escaped = title.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <title>${escaped}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
    #game { position: fixed; inset: 0; }
  </style>
</head>
<body>
  <!-- THE PAGE SAYS WHAT HAPPENS BEFORE THE GAME CAN (playtest round 25: a tester saw only black for
       ten minutes, the game's script never ran, and nothing said why): a line that is there before any
       script, every error written on screen with the browser's version, WebGL2 checked, and after a minute
       still loading, what to do. The game's script removes the line when it starts. -->
  <div id="boot" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;color:#cfd6dc;font:15px/1.5 system-ui,sans-serif;text-align:center;padding:24px;z-index:10">
    <div id="boot-line">Loading the game…</div>
    <pre id="boot-said" style="color:#ff8a80;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;max-width:90vw"></pre>
  </div>
  <script>
    (function () {
      var said = function (text) {
        var pre = document.getElementById('boot-said');
        if (!pre) { pre = document.createElement('pre'); pre.style.cssText = 'position:fixed;left:0;right:0;bottom:0;margin:0;padding:12px;color:#ff8a80;background:#000c;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;z-index:100'; document.body.appendChild(pre); }
        pre.textContent += text + '\\n';
      };
      var browser = navigator.userAgent;
      window.addEventListener('error', function (event) {
        said('Error: ' + (event.message || (event.error && event.error.message) || 'a file could not load') + (event.filename ? ' (' + event.filename + ':' + event.lineno + ')' : '') + '\\nBrowser: ' + browser);
      }, true);
      window.addEventListener('unhandledrejection', function (event) {
        var why = event.reason; said('Error: ' + ((why && (why.stack || why.message)) || String(why)) + '\\nBrowser: ' + browser);
      });
      try {
        if (!document.createElement('canvas').getContext('webgl2')) said('This browser cannot draw WebGL2, which the game needs. Turn on hardware acceleration (chrome://settings/system) or try another browser.\\nBrowser: ' + browser);
      } catch (e) { said('WebGL2 could not be checked: ' + e + '\\nBrowser: ' + browser); }
      setTimeout(function () {
        var line = document.getElementById('boot-line');
        if (line) line.textContent = 'Still loading after a minute. If nothing moves, press F12, open Console and read out the red lines. Browser: ' + browser;
      }, 60000);
    })();
  </script>
  <div id="game"></div>
  <script type="module" src="./main.ts"></script>
</body>
</html>
`;
}

export async function exportWeb(folder: string, options: ExportWebOptions = {}): Promise<{ out: string; files: number }> {
  const log = options.log ?? ((line: string) => console.log(line));
  const project = projectOf(folder);
  const out = resolve(options.out ?? join(project, 'dist', 'web'));
  const dump = join(project, ...WEB_EXPORT_DUMP_DIR.split('/'));
  const projectManifest = JSON.parse(readFileSync(join(project, 'volter.project.json'), 'utf8')) as {
    name?: string; roots?: readonly DeclaredRoot[];
  };
  const roots = (projectManifest.roots ?? []).filter((root) => root.adapter === 'dom' || (root.adapter as { identity?: string } | null)?.['identity'] === 'dom');
  for (const root of roots) if (!root.entry) throw new Error(`export web: the dom root "${root.id}" names no entry.`);
  prepareOut(out, project);

  if (options.dump !== false) {
    log('Asking the editor for the game (the model, its clips and its look)…');
    const { connect } = await import('@volter/live');
    const { editor } = await connect(project);
    const answer = await editor.blender<{ ok?: boolean; error?: string; blend?: string; bakes?: number; armatures?: number; actions?: number; failed?: readonly string[]; files?: Record<string, number> }>(
      'blender-export-play', options.document === undefined ? {} : { document: options.document });
    if (answer.ok === false) throw new Error(`export web: ${answer.error ?? 'the editor refused the export'}`);
    const frameBytes = answer.files?.[WEB_EXPORT_FRAME_FILE] ?? 0;
    log(`  ${answer.blend}: ${(frameBytes / 1048576).toFixed(1)} MB of scene, ${answer.bakes} clip(s) for ${answer.armatures} armature(s) × ${answer.actions} action(s)`);
    for (const failure of answer.failed ?? []) log(`  not exported: ${failure}`);
  }
  for (const file of [WEB_EXPORT_MANIFEST_FILE, WEB_EXPORT_FRAME_FILE, WEB_EXPORT_CLIPS_FILE])
    if (!existsSync(join(dump, file))) throw new Error(`export web: ${posix(relative(project, join(dump, file)))} is missing; export with the editor running and the model open (without --no-dump).`);
  const exported = JSON.parse(readFileSync(join(dump, WEB_EXPORT_MANIFEST_FILE), 'utf8')) as { script: string; blend: string };
  if (!existsSync(join(project, exported.script))) throw new Error(`export web: the play script ${exported.script} is gone.`);

  // THE LEVELS (docs/LEVELS.md): every cooked level travels with the page, a stale one cooked again first
  // (with the editor, as the dump is); a level never cooked is not one the game loads
  let bundled = listLevels(project).filter((one) => one.state !== 'uncooked');
  const stale = bundled.filter((one) => one.state === 'stale').map((one) => one.level);
  if (stale.length > 0) {
    if (options.dump !== false) {
      log(`Cooking ${stale.length} stale level(s) again: ${stale.join(', ')}…`);
      await cookLevels(project, ['cook', ...stale], (line) => log(`  ${line}`));
      bundled = listLevels(project).filter((one) => one.state !== 'uncooked');
    } else log(`  exported as cooked, though their .blend changed since: ${stale.join(', ')} (cyclotron levels cook)`);
  }
  const levelScripts = Object.fromEntries(bundled
    .map((one) => [one.level, one.blend.replace(/\.blend$/i, '') + '.play.ts'] as const)
    .filter(([, path]) => existsSync(join(project, path))));

  // THE ENTRY, in a scratch folder beside the dump (inside the project, so its node_modules resolve).
  const buildDir = join(dump, 'build');
  rmSync(buildDir, { recursive: true, force: true, maxRetries: 3 });
  mkdirSync(buildDir, { recursive: true });
  copyFileSync(join(dump, WEB_EXPORT_MANIFEST_FILE), join(buildDir, WEB_EXPORT_MANIFEST_FILE));
  const startLevel = levelOf(exported.blend);
  writeFileSync(join(buildDir, 'main.ts'), entrySource(buildDir, project, exported.script, roots, levelScripts, startLevel));
  writeFileSync(join(buildDir, 'index.html'), pageSource(projectManifest.name ?? 'Game'));

  log(`Building the page with Vite…`);
  const vite = await projectVite(project);
  const publicDir = join(project, 'public');
  await vite.build({
    configFile: false,
    root: buildDir,
    base: './',
    mode: 'production',
    logLevel: 'warn',
    publicDir: existsSync(publicDir) ? publicDir : false,
    // The engine's packages are served as source (TSX among them), outside the project's tsconfig.
    esbuild: { jsx: 'automatic' },
    resolve: { dedupe: ['react', 'react-dom', 'three'] },
    worker: { format: 'es' },
    build: {
      outDir: out,
      emptyOutDir: true,
      target: 'es2022',
      chunkSizeWarningLimit: 8192,
      reportCompressedSize: false,
      rollupOptions: {
        // A dependency's misplaced `@__PURE__` comment is its own; it changes nothing here.
        onwarn(warning, warn) { if (warning.code !== 'INVALID_ANNOTATION') warn(warning); },
      },
    },
  });
  mkdirSync(join(out, DATA_DIR), { recursive: true });
  for (const file of [WEB_EXPORT_FRAME_FILE, WEB_EXPORT_CLIPS_FILE]) copyFileSync(join(dump, file), join(out, DATA_DIR, file));
  // (a dump from before movies has none: the page then plays no cutscene)
  if (existsSync(join(dump, WEB_EXPORT_MOVIE_FILE))) copyFileSync(join(dump, WEB_EXPORT_MOVIE_FILE), join(out, DATA_DIR, WEB_EXPORT_MOVIE_FILE));
  for (const one of bundled) {
    // the level the page starts in loads from the page's own data (see the entry)
    if (one.level === startLevel) continue;
    const from = join(project, '.volter', 'levels', one.level);
    const to = join(out, DATA_DIR, 'levels', one.level);
    mkdirSync(to, { recursive: true });
    for (const file of [WEB_EXPORT_FRAME_FILE, WEB_EXPORT_CLIPS_FILE, WEB_EXPORT_MOVIE_FILE, 'level.json'])
      if (existsSync(join(from, file))) copyFileSync(join(from, file), join(to, file));
  }
  if (bundled.length > 0) log(`  levels: ${bundled.map((one) => `${one.level}${levelScripts[one.level] ? ' (with its script)' : ''}`).join(', ')}`);
  writeFileSync(join(out, MARKER), `${exported.blend}\n`);
  const files = (readdirSync(out, { recursive: true }) as string[]).length;
  log(`Exported ${exported.blend} to ${out}`);
  log(`  Serve that folder from any static host; e.g. npx serve "${out}"`);
  return { out, files };
}
