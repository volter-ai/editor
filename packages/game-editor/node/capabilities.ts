/**
 * `volter-game-editor add [id...]` / `remove <id...>` / `outdated` — the
 * capability verbs, transferred from vgai's `runCapabilityCommand`
 * (`packages/vgai-cli/src/index.ts`). What you add is a CAPABILITY from this
 * product's catalog (`catalog/`); it becomes ordinary project source on
 * arrival. Bare `add` LISTS every available capability and marks which are
 * already installed — there is no separate `list` or `status` verb.
 *
 * The mechanism is the scaffolder's (`./scaffold/catalog.ts`), the same code
 * `create` uses to add a template's capabilities.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findProjectRootFrom } from '@volter/editor-live';
import { installRoot, productRoot } from './create';
import { usesRuntimeImage } from './runtime-image';
import {
  addCapabilities,
  capabilityVersions,
  initializeProjectCatalog,
  readCatalog,
  readCatalogStatus,
  removeCapabilities,
} from './scaffold/catalog';
import { checkoutPackageSpec, linkCheckoutPackages } from './scaffold/scaffold';

export type CapabilityVerb = 'add' | 'outdated' | 'remove';

export interface CapabilityOptions {
  project?: string | undefined;
  'dry-run'?: boolean | undefined;
  json?: boolean | undefined;
}

/** `parseArgs` option declarations for the capability verbs. */
export const CAPABILITY_OPTIONS = {
  project: { type: 'string' }, 'dry-run': { type: 'boolean' }, json: { type: 'boolean' },
} as const;

const catalogDir = join(productRoot, 'catalog');

export function runCapabilityCommand(verb: CapabilityVerb, ids: string[], options: CapabilityOptions): void {
  const dryRun = options['dry-run'] === true;
  const json = options.json === true;
  const log = console.log;
  const emit = (value: unknown) => log(JSON.stringify(value, null, 2));
  const projectDir = findProjectRootFrom(resolve(options.project ?? process.cwd()));
  const catalog = readCatalog(catalogDir);

  if (verb === 'add' && ids.length === 0) {
    const installed = new Set(projectDir ? readCatalogStatus(projectDir, catalogDir).installed : []);
    const report = catalog.map(capability => ({
      description: capability.description,
      id: capability.id,
      installed: installed.has(capability.id),
      requires: capability.requires,
      title: capability.title,
    }));
    if (json) emit(report);
    else {
      for (const capability of report) log(`${capability.installed ? '✓' : '○'} ${capability.id} — ${capability.title}`);
      log('\nFull descriptions and dependencies: volter-game-editor add --json');
    }
    return;
  }

  if (!projectDir) throw new Error('No vgai.project.json found. Run this command inside a game or pass --project.');

  if (verb === 'outdated') {
    if (ids.length > 0) throw new Error('Usage: volter-game-editor outdated [--project <path>] [--json]');
    const rows = capabilityVersions(projectDir, catalogDir);
    if (json) return emit(rows);
    const behind = rows.filter(row => row.outdated);
    if (rows.length === 0) return log('No capabilities vendored in this project.');
    if (behind.length === 0) {
      return log(rows.length === 1 ? 'The 1 vendored capability is current.' : `All ${rows.length} vendored capabilities are current.`);
    }
    for (const row of behind) log(`${row.id}  ${row.copied ?? '(unstamped)'} → ${row.current}`);
    // Your edits are git's to report — this only knows that upstream moved.
    log(`\n${behind.length} behind. These files are YOURS: nothing will overwrite them.\n` +
      'Use `git diff` to see your changes, then port what you want from the new version.');
    return;
  }

  if (verb === 'remove') {
    if (ids.length === 0) throw new Error('Usage: volter-game-editor remove <id...>');
    const removal = removeCapabilities({ catalogDir, dryRun, ids, projectDir });
    if (json) return emit(removal);
    if (removal.notInstalled.length > 0) log(`Not installed (nothing to do): ${removal.notInstalled.join(', ')}`);
    if (removal.removed.length > 0) {
      log(`${dryRun ? 'Would remove' : 'Removed'}: ${removal.removed.join(', ')} ` +
        `(${removal.deletedFiles.length} file${removal.deletedFiles.length === 1 ? '' : 's'})`);
    }
    for (const path of removal.keptModifiedFiles) log(`  [kept] ${path} — you edited this file; delete it yourself if you meant to`);
    for (const capabilityId of new Set(removal.keptDivergedFiles.map(file => file.capabilityId))) {
      const files = removal.keptDivergedFiles.filter(file => file.capabilityId === capabilityId);
      for (const file of files) log(`  [kept] ${file.path}`);
      const first = files[0];
      const copied = first?.copied ?? null;
      log(`    ↑ ${files.length} file${files.length === 1 ? '' : 's'} differ from ${capabilityId} ${first?.current ?? '(unknown)'}, ` +
        `which is the version installed here — but this project vendored ${copied === null ? 'an UNRECORDED version (pre-stamp copy)' : copied}. ` +
        'The difference is upstream drift, your edit, or both, which is why they were kept rather than deleted.');
      log(`      \`git diff -- ${first?.path ?? ''}\` is what actually knows. Delete what you no longer want.`);
    }
    for (const path of removal.keptSharedFiles) log(`  [kept] ${path} — still provided by another installed capability`);
    if (removal.removedToolEntries.length > 0) {
      log(`${dryRun ? 'Would unregister' : 'Unregistered'} tools: ${removal.removedToolEntries.join(', ')}`);
    }
    if (removal.orphanedDependencyNames.length > 0) {
      log(`Left installed (your code may import them): ${removal.orphanedDependencyNames.join(', ')}`);
    }
    return;
  }

  const monoRoot = installRoot();
  const report = addCapabilities({
    catalogDir,
    dryRun,
    ids,
    projectDir,
    // A capability may require a package the registry cannot serve; a
    // checkout's own copy answers it, exactly as `create` resolves it.
    resolveDependencySpec: (name, spec) => checkoutPackageSpec(name, monoRoot) ?? spec,
    installDependencies: dependencyNames => {
      // A game on the runtime image installs nothing: the image carries every
      // capability's dependencies. One it lacks is named, never installed into
      // the image every game of this version shares.
      if (usesRuntimeImage(projectDir)) {
        const missing = dependencyNames.filter(name => !existsSync(join(projectDir, 'node_modules', ...name.split('/'), 'package.json')));
        if (missing.length > 0) throw new Error(`The runtime image lacks ${missing.join(', ')}; this capability needs a game that installs its own dependencies.`);
        return;
      }
      if (!json) log(`Installing dependencies: ${dependencyNames.join(', ')}`);
      execFileSync('npm', ['install', '--prefer-offline', '--no-audit', '--no-fund', '--loglevel=error'], {
        cwd: projectDir, stdio: json ? 'ignore' : 'inherit', shell: process.platform === 'win32',
      });
      // That install re-resolved the project's packages from the registry;
      // re-apply the checkout link `create` made, as `create` does.
      linkCheckoutPackages(projectDir, monoRoot);
    },
  });
  if (!dryRun) initializeProjectCatalog(projectDir, catalogDir);

  if (json) emit(report);
  else {
    log(`${dryRun ? 'Would resolve requirements' : 'Resolved requirements'}: ${report.planned.join(', ')}`);
    if (!dryRun && report.installed.length > 0) log(`Newly installed: ${report.installed.join(', ')}`);
    if (report.kept.length > 0) log(`Left as-is (already present, yours): ${report.kept.length} files.`);
    if (report.writtenFiles.length > 0) {
      log(`${dryRun ? 'Would write' : 'Wrote'} ${report.writtenFiles.length} files:\n${report.writtenFiles.map(path => `  ${path}`).join('\n')}`);
    }
    if (report.alreadyInstalled.length > 0) log(`Already present: ${report.alreadyInstalled.join(', ')}`);
  }
  // A capability's JSX needs a region declaration in `vgai.adapter.ts`, or the
  // editor stamps the wrong source-id attribute on it.
  for (const unplaced of report.unplacedRegions) {
    console.error(`Warning: ${unplaced.capability} renders on the \`${unplaced.surface}\` surface ` +
      `(${unplaced.globs.join(', ')}), but ${unplaced.reason}. The editor will report \`OID001\` for those files until this project declares them.`);
  }
  // vgai materialized declared asset packs here (`asset-packs.ts`). No entry in
  // this catalog declares one, and nothing in this product delivers their
  // bytes, so a declaration is refused loudly rather than left unfetched.
  if (!dryRun && report.declaredAssets.length > 0) {
    throw new Error(`These capabilities declare asset packs this product cannot fetch: ` +
      `${report.declaredAssets.map(entry => entry.dest).join(', ')}. Their source will look for files that are not on disk.`);
  }
}
