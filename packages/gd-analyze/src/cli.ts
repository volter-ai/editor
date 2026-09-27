/** The single public Godot compiler CLI: one import pipeline plus its whole-project sweep. */
import { importGodotProject } from './import-project';
import { runClosure } from './report/closure';
import { runSweep } from './sweep';

const USAGE = `usage: gd-analyze <command> [options]

  import <godot-project-dir> <target-dir> --bound-exporter-binary <path> --official-binary <path>
           Compile one immutable Godot project snapshot through the pinned official
           frontend into a complete standalone volter project.

  sweep [fixture ...] --bound-exporter-binary <path> --official-binary <path>
           Run that same import pipeline over every pinned source fixture, or only
           the named fixtures, and report the first failed product gate per game.

  closure [fixture ...] --bound-exporter-binary <path> --official-binary <path> [--out <file.json>]
           Report (read-only) the Godot capabilities the pinned fixtures use: call targets,
           unresolved calls, attributes, operators, node classes, resources, signals, assets.

  evidence <name> --official-binary <path> [--bound-exporter-binary <path>]
           Run evidence/godot-4.7/<name>.cases.ts in the official Godot 4.7 binary (headless)
           and in Node: a compat case file through its compat module, a language case file
           through production code lowering (which needs the bound exporter). On full agreement
           write what it proves to src/translate/code/authority/godot-4.7/<name>.json.

  evidence --refresh --official-binary <path> --bound-exporter-binary <path>
           Run every authority's native/target proof; where they agree, rewrite that
           proof's identities (authority/godot-4.7/proof-<name>.json). A disagreeing proof
           is named and nothing is written for it.

  run <imported-project-dir> [--frames <n>] [--budget-ms <ms>] [--profile [--profile-after <frames>]]
           Mount an imported project's world headlessly (the proofs' harness) and step it n
           display frames at 60 Hz with no input (default 300): each frame's thrown error is
           printed with its stack, and a frame over its budget (default 2000 ms) is paused
           through the inspector and its call stack printed.

  run --self-check --bound-exporter-binary <path> --official-binary <path>
           Import a world whose script spins in _process and check that run reports the hang
           with a paused frame at that script's loop line.

  liveness
           Check every claim the import's authorities carry against the working tree, as the
           import checks each before use; list the stale ones (no Godot binary needed).

  evidence ... --godot 4.6 [--pipeline-official-binary <4.7 editor>]
           The same cases and proofs with the official 4.6 binary as the native side, against
           the same target (compat, and the 4.7 pipeline through the 4.7 exporter and, for the
           refresh's proofs, the 4.7 editor as its importer); written to
           src/translate/code/authority/godot-4.6/.
`;

function fail(message: string): never {
  process.stderr.write(`gd-analyze: ${message}\n\n${USAGE}`);
  process.exit(2);
}

function optionValue(rest: readonly string[], flag: string): string | undefined {
  const index = rest.indexOf(flag);
  if (index === -1) return undefined;
  const value = rest[index + 1];
  if (value === undefined || value.startsWith('--')) fail(`${flag} needs a value`);
  return value;
}

function positionals(rest: readonly string[], valueFlags: readonly string[]): string[] {
  const consumed = new Set<number>();
  rest.forEach((arg, index) => {
    if (valueFlags.includes(arg)) {
      consumed.add(index);
      consumed.add(index + 1);
    } else if (arg.startsWith('--')) {
      consumed.add(index);
    }
  });
  return rest.filter((_, index) => !consumed.has(index));
}

function requiredExporter(rest: readonly string[]): string {
  const binary = optionValue(rest, '--bound-exporter-binary');
  if (binary === undefined) {
    fail('the pinned official frontend is mandatory: pass --bound-exporter-binary <path>');
  }
  return binary;
}

function requiredOfficial(rest: readonly string[]): string {
  const binary = optionValue(rest, '--official-binary');
  if (binary === undefined) {
    fail('the pinned official Godot editor performs the import: pass --official-binary <path>');
  }
  return binary;
}

export async function runCli(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return command === undefined ? 2 : 0;
  }
  if (command === 'run' && rest.includes('--self-check')) {
    const { runSpinSelfCheck } = await import('./run/run-world');
    (await import('./evidence/node-assets')).registerNodeAssetImports();
    process.exit(await runSpinSelfCheck({ exporterBinary: requiredExporter(rest), officialBinary: requiredOfficial(rest) }));
  }
  if (command === 'run') {
    const positional = positionals(rest, ['--frames', '--budget-ms', '--profile-after']);
    if (positional.length !== 1) fail('run needs exactly one imported project directory');
    const { runImportedWorld } = await import('./run/run-world');
    (await import('./evidence/node-assets')).registerNodeAssetImports();
    const code = await runImportedWorld(positional[0] as string, {
      frames: Number(optionValue(rest, '--frames') ?? 300),
      budgetMs: Number(optionValue(rest, '--budget-ms') ?? 2000),
      profile: rest.includes('--profile'),
      profileAfter: Number(optionValue(rest, '--profile-after') ?? 0),
    });
    // A terminated, paused worker can leave the inspector's handles open: the run ends here.
    process.exit(code);
  }
  if (command === 'import') {
    const positional = positionals(rest, ['--bound-exporter-binary', '--official-binary']);
    if (positional.length !== 2) {
      fail('import needs exactly one Godot project directory and one new target directory');
    }
    importGodotProject(positional[0] as string, positional[1] as string, {
      boundExporterBinary: requiredExporter(rest),
      officialBinary: requiredOfficial(rest),
    });
    return 0;
  }
  if (command === 'sweep') {
    return runSweep(
      positionals(rest, ['--bound-exporter-binary', '--official-binary']),
      requiredExporter(rest),
      requiredOfficial(rest),
    );
  }
  if (command === 'closure') {
    return runClosure(
      positionals(rest, ['--bound-exporter-binary', '--official-binary', '--out']),
      requiredExporter(rest),
      requiredOfficial(rest),
      optionValue(rest, '--out'),
    );
  }
  if (command === 'liveness') {
    const { runLiveness } = await import('./report/liveness');
    return runLiveness();
  }
  if (command === 'evidence') {
    (await import('./evidence/node-assets')).registerNodeAssetImports();
    const positional = positionals(rest, ['--official-binary', '--bound-exporter-binary', '--godot', '--pipeline-official-binary']);
    const version = optionValue(rest, '--godot') ?? '4.7';
    if (version !== '4.6' && version !== '4.7') fail('evidence --godot takes 4.6 or 4.7');
    const binary = optionValue(rest, '--official-binary');
    if (binary === undefined) fail('evidence needs --official-binary <path>');
    if (rest.includes('--refresh')) {
      if (positional.length !== 0) fail('evidence --refresh takes no class');
      const { refreshEvidence } = await import('./evidence/refresh');
      const pipeline = optionValue(rest, '--pipeline-official-binary');
      if (version !== '4.7' && pipeline === undefined) fail('evidence --refresh --godot 4.6 needs --pipeline-official-binary <the 4.7 editor>');
      return await refreshEvidence(
        { officialBinary: binary, exporterBinary: requiredExporter(rest), ...(pipeline === undefined ? {} : { pipelineOfficialBinary: pipeline }) },
        version,
      );
    }
    if (positional.length !== 1) fail('evidence needs exactly one Godot class');
    const { runEvidence } = await import('./evidence/run-evidence');
    return runEvidence(
      positional[0] as string,
      binary,
      optionValue(rest, '--bound-exporter-binary'),
      version,
    );
  }
  fail(`unknown command "${command}"`);
}

process.exitCode = await runCli(process.argv.slice(2));
