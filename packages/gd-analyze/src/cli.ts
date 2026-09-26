/** The single public Godot compiler CLI: one import pipeline plus its whole-project sweep. */
import { importGodotProject } from './import-project';
import { runClosure } from './report/closure';
import { runSweep } from './sweep';

const USAGE = `usage: gd-analyze <command> [options]

  import <godot-project-dir> <target-dir> --bound-exporter-binary <path>
           Compile one immutable Godot project snapshot through the pinned official
           frontend into a complete standalone vgai project.

  sweep [fixture ...] --bound-exporter-binary <path>
           Run that same import pipeline over every pinned source fixture, or only
           the named fixtures, and report the first failed product gate per game.

  closure [fixture ...] --bound-exporter-binary <path> [--out <file.json>]
           Report (read-only) the Godot capabilities the pinned fixtures use: call targets,
           unresolved calls, attributes, operators, node classes, resources, signals, assets.

  evidence <class> --official-binary <path>
           Run evidence/godot-4.7/<class>.cases.ts in the official Godot 4.7 binary (headless)
           and through its compat module in Node; on full agreement write the binding rows and
           semantic claims to src/translate/code/authority/godot-4.7/<class>.json.

  evidence --refresh --official-binary <path> --bound-exporter-binary <path>
           Run every authority's native/target proof; where they agree, rewrite that
           proof's identities (authority/godot-4.7/proof-<name>.json). A disagreeing proof
           is named and nothing is written for it.
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

export async function runCli(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return command === undefined ? 2 : 0;
  }
  if (command === 'import') {
    const positional = positionals(rest, ['--bound-exporter-binary']);
    if (positional.length !== 2) {
      fail('import needs exactly one Godot project directory and one new target directory');
    }
    importGodotProject(positional[0] as string, positional[1] as string, {
      boundExporterBinary: requiredExporter(rest),
    });
    return 0;
  }
  if (command === 'sweep') {
    return runSweep(positionals(rest, ['--bound-exporter-binary']), requiredExporter(rest));
  }
  if (command === 'closure') {
    return runClosure(
      positionals(rest, ['--bound-exporter-binary', '--out']),
      requiredExporter(rest),
      optionValue(rest, '--out'),
    );
  }
  if (command === 'evidence') {
    const positional = positionals(rest, ['--official-binary', '--bound-exporter-binary']);
    const binary = optionValue(rest, '--official-binary');
    if (binary === undefined) fail('evidence needs --official-binary <path>');
    if (rest.includes('--refresh')) {
      if (positional.length !== 0) fail('evidence --refresh takes no class');
      const { refreshEvidence } = await import('./evidence/refresh');
      return refreshEvidence({ officialBinary: binary, exporterBinary: requiredExporter(rest) });
    }
    if (positional.length !== 1) fail('evidence needs exactly one Godot class');
    const { runEvidence } = await import('./evidence/run-evidence');
    return runEvidence(positional[0] as string, binary);
  }
  fail(`unknown command "${command}"`);
}

process.exitCode = await runCli(process.argv.slice(2));
