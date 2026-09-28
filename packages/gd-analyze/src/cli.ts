/** The single public Godot compiler CLI: one import pipeline plus its whole-project sweep. */
import { importGodotProject } from './import-project';
import { runClosure } from './report/closure';
import { runSweep } from './sweep';

const USAGE = `usage: gd-analyze <command> [options]

  import <godot-project-dir> <target-dir> --bound-exporter-binary <path> --official-binary <path>
           Compile one immutable Godot project snapshot through the pinned official
           frontend into a complete standalone volter-game-editor project.

  sweep [fixture ...] --bound-exporter-binary <path> --official-binary <path>
           Run that same import pipeline over every pinned source fixture, or only
           the named fixtures, and report the first failed product gate per game.

  closure [fixture ...] --bound-exporter-binary <path> --official-binary <path> [--out <file.json>]
           Report (read-only) the Godot capabilities the pinned fixtures use: call targets,
           unresolved calls, attributes, operators, node classes, resources, signals, assets.

  refusals [fixture ...] --bound-exporter-binary <path> --official-binary <path> [--out <file.json>]
           Plan (read-only) the import of each pinned fixture and report every refusal the
           plan holds, per kit and grouped by family across kits. Nothing is emitted or built.

  run <imported-project-dir> [--frames <n>] [--budget-ms <ms>] [--profile [--profile-after <frames>]]
           Mount an imported project's world headlessly and step it n
           display frames at 60 Hz with no input (default 300): each frame's thrown error is
           printed with its stack, and a frame over its budget (default 2000 ms) is paused
           through the inspector and its call stack printed.
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
  if (command === 'run') {
    const positional = positionals(rest, ['--frames', '--budget-ms', '--profile-after']);
    if (positional.length !== 1) fail('run needs exactly one imported project directory');
    const { runImportedWorld } = await import('./run/run-world');
    (await import('./run/node-assets')).registerNodeAssetImports();
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
  if (command === 'refusals') {
    const { runRefusals } = await import('./report/refusals');
    return runRefusals(
      positionals(rest, ['--bound-exporter-binary', '--official-binary', '--out']),
      requiredExporter(rest),
      requiredOfficial(rest),
      optionValue(rest, '--out'),
    );
  }
  fail(`unknown command "${command}"`);
}

process.exitCode = await runCli(process.argv.slice(2));
