// Writes the editor's cyclotronMachine.ts from the mascot SVG.
// node write-machine-module.mjs <svg> <out.ts>
import { readFileSync, writeFileSync } from 'node:fs';

const [svgPath, outPath] = process.argv.slice(2);
const svg = readFileSync(svgPath, 'utf8');
const parts = [...svg.matchAll(/<g data-part="(\d+)"( class="accent")?><path d="([^"]+)"\/><\/g>/g)]
  .map(([, part, accent, d]) => ({ part, accent: !!accent, d }));
if (parts.length === 0) throw new Error('no parts');
const lines = [
  "/** THE MACHINE: the drawing on Cyclotron's home page (volter-ai/sites, `model-editor/src/assembly/scene.mjs`, in the",
  " *  view `media/assembly-poster.webp` shows), as this product's mascot. Hidden lines are removed and each part is one",
  " *  path, in the order the page reassembles the machine, so the splash can plot it part by part. `accent` marks the two",
  " *  parts the page swaps in that are inked in the home page's lime: the valve covers and the headers (React, three.js).",
  " *  Generated from the page's own scene by raycast hidden-line removal, not drawn by hand; viewBox 0 0 240 240. */",
  'export const CYCLOTRON_MACHINE: readonly { readonly part: string; readonly accent: boolean; readonly d: string }[] = [',
  ...parts.map((p) => `\t{ part: '${p.part}', accent: ${p.accent}, d: '${p.d}' },`),
  '];',
  '',
];
writeFileSync(outPath, lines.join('\n'));
console.log(parts.length, 'parts');
