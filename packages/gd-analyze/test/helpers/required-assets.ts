/**
 * `test/helpers/required-assets.ts` — the ONE mechanism every committed port's binary half runs on.
 *
 * A translated project is source PLUS bytes. The source half has always been a golden: a regen
 * writes it, a freshness test diffs it, and a file the emitter stopped writing gets deleted. The
 * binary half had no such loop — `public/` held whatever a human copied in once, and the freshness
 * walk only checked that what was THERE came from the Godot source. That check passes just as
 * happily when a needed file was never copied at all, which is how `/enemy/shine.png` came to be
 * referenced by two particle effects and shipped by none: the port typechecked, the goldens were
 * fresh, and both effects 404'd.
 *
 * `TranslatedProject.requiredAssets` closed the declaration side (see `translate/data/model.ts`);
 * these two functions are the loop around it, shared by every committed port through the one
 * registry in `helpers/port-fixtures.ts` rather than re-typed per port —
 * {@link syncRequiredAssets} makes `public/` equal to the declaration, and
 * {@link shippedPublicFiles} is what the freshness test asserts that equality against from the
 * other side.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import type { TranslatedProject } from '../../src/translate/data/model';

/**
 * Every file under the port's `public/` that the EMITTER does not write — the binary half.
 *
 * The walk is TOTAL rather than a list of directories, minus the paths the emission itself claims
 * (`public/inputmaps/default.inputmap.json`), because a copied directory nobody remembered to list
 * is exactly the file that would ship unaccounted for. Returns project-relative POSIX paths, so a
 * caller compares them directly against `RequiredAsset.public`.
 */
export function shippedPublicFiles(portDir: string, project: TranslatedProject): string[] {
  const emitted = new Set(project.files.map((file) => file.path));
  const publicDir = path.join(portDir, 'public');
  return filesUnder(publicDir, '')
    .map((at) => `public/${at}`)
    .filter((at) => !emitted.has(at))
    .sort();
}

/** Every file under `<dir>/<relative>`, recursively, as `/`-joined paths relative to `dir`.
 *  Dot-files are skipped; a directory that does not exist contributes nothing. */
function filesUnder(dir: string, relative: string): string[] {
  const here = path.join(dir, relative);
  if (!existsSync(here)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(here, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const at = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(dir, at));
    else out.push(at);
  }
  return out;
}

/**
 * Make the port's `public/` exactly what the translation declares: copy every required asset from
 * the Godot source, and delete every binary the translation no longer asks for.
 *
 * Both directions matter and both were missing. A missing source file is LOUD — a translation that
 * names a `res://` file the project does not contain is a reader bug, and copying nothing while
 * printing nothing is how the gap survived. The prune half is the same argument the source regen's
 * delete pass already makes: a stale copy left behind stays tracked, stays served, and reads as if
 * something still wanted it.
 */
export function syncRequiredAssets(
  project: TranslatedProject,
  sourceDir: string,
  portDir: string,
): void {
  const required = new Set<string>();
  for (const asset of project.requiredAssets) {
    const source = path.join(sourceDir, asset.res.slice('res://'.length));
    if (!existsSync(source)) {
      throw new Error(
        `the translation declares it fetches ${asset.res}, but ${source} does not exist, so ` +
          `${asset.public} cannot be shipped and the emitted game would 404 on it. Either the ` +
          'Godot source is incomplete or an emitter recorded a path it made up.',
      );
    }
    const target = path.join(portDir, asset.public);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    required.add(asset.public);
  }
  for (const shipped of shippedPublicFiles(portDir, project)) {
    if (required.has(shipped)) continue;
    rmSync(path.join(portDir, shipped), { force: true });
    process.stdout.write(`removed ${shipped} (nothing the emitted code fetches)\n`);
  }
}

/**
 * The other half of "fresh": the committed BYTES are what the emitter writes today.
 *
 * Every port freshness test compared the SET OF PATHS the emitter emits against what the fixture
 * ships, and nothing compared content — so a port's committed files could drift arbitrarily from the
 * emitter and the gate still said fresh. Measured 2026-08-17: an emitted translation NOTE was
 * reworded and two committed ports kept the old sentence with all six freshness suites green. That
 * matters most for `TRANSLATION-NOTES.md`, because a recorded deviation is the lane's answer to "we
 * carried the expressible subset" — a deviation record that can go stale while claiming to be
 * current is the failure this whole discipline exists to prevent.
 *
 * Returns the paths whose committed text differs from `emitted`, so a failure NAMES its file rather
 * than printing a diff hunk thousands of lines in.
 */
export function driftedFromEmitter(
  portDir: string,
  emitted: ReadonlyMap<string, string>,
): string[] {
  const drifted: string[] = [];
  for (const [relative, text] of emitted) {
    const at = path.join(portDir, relative);
    if (!existsSync(at)) continue; // a missing file is the path-set assertion's job, not this one
    if (readFileSync(at, 'utf8') !== text) drifted.push(relative);
  }
  return drifted.sort();
}
