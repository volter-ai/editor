#!/usr/bin/env node
// node sites/model-editor/build.mjs [--video <mp4>] [--poster <png>]   (defaults: media/launch.mp4, media/launch-poster.png)
//
// Builds the Volter Model Editor's home page into dist/: the page and its stylesheet from src/, and the brand the
// page is drawn with (tokens.css, the Geist faces, the Volter lockup, the product logo in both schemes, the favicon),
// fetched from brand.volter.ai at build time and served from dist/brand/ — the page loads nothing from brand.volter.ai.
// A failed fetch fails the build. The launch video and its poster are copied in when given.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const BRAND = 'https://brand.volter.ai';
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

const fetchOk = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'brand', 'fonts'), { recursive: true });

// tokens.css with its faces pointed at the copies served beside it
let tokens = (await fetchOk(`${BRAND}/tokens.css`)).toString('utf8');
for (const face of new Set(tokens.match(/https:\/\/brand\.volter\.ai\/fonts\/[A-Za-z0-9-]+\.woff2/g) ?? [])) {
  const file = face.split('/').pop();
  writeFileSync(join(dist, 'brand', 'fonts', file), await fetchOk(face));
  tokens = tokens.split(face).join(`fonts/${file}`);
}
writeFileSync(join(dist, 'brand', 'tokens.css'), tokens);

const art = {
  'lockup.svg': `${BRAND}/lockup/svg?height=28&layout=row`,
  'wordmark.svg': `${BRAND}/wordmark/svg?height=20`,
  'logo.svg': `${BRAND}/logo/volter-model-editor/svg?size=40&variant=brand`,
  'logo-dark.svg': `${BRAND}/logo/volter-model-editor/svg?size=40&variant=dark`,
  'favicon.png': `${BRAND}/logo/volter-model-editor/png?size=64&variant=brand`,
  'copy.svg': `${BRAND}/icon/copy/svg?size=16&color=currentColor`,
};
for (const [file, url] of Object.entries(art)) writeFileSync(join(dist, 'brand', file), await fetchOk(url));

for (const file of ['index.html', 'site.css']) copyFileSync(join(here, 'src', file), join(dist, file));
const video = arg('--video') ?? join(here, 'media', 'launch.mp4'); const poster = arg('--poster') ?? join(here, 'media', 'launch-poster.png');
if (video) copyFileSync(video, join(dist, 'launch.mp4'));
if (poster) copyFileSync(poster, join(dist, 'launch-poster.png'));
if (!video) writeFileSync(join(dist, 'index.html'), readFileSync(join(dist, 'index.html'), 'utf8').replace(/<!-- video -->[\s\S]*?<!-- \/video -->/, ''));
// GitHub Pages serves dist/ as it is
writeFileSync(join(dist, '.nojekyll'), '');
console.log(`built ${dist}`);
