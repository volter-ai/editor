/**
 * The measured upgrade deltas an older project reaches. A project authored in Godot 4.6 imports as
 * the pinned 4.7 runs it (`selectGodotFrontendAuthority`); `authority/godot-4.6/` records each case
 * whose native run on the official 4.6 binary disagrees with that behaviour, with the source change
 * that explains it. This lists, for one project, each delta member its code or scenes reach, and
 * where. It is information for the import report, not a gate.
 *
 * Reach is read from the bound project: a call's official target (or the analysis's typed receiver),
 * a native or built-in property read or written in code (its getter and setter, up the API dump's
 * class chain), and a scene node's authored properties (their setters, up its native ancestry).
 * A delta whose member is not reached but whose class is used is listed as class-level.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { GodotApiDump } from '../analyze/api-dump';
import type { BoundGodotProject } from '../analyze/bound-project';
import { godotEvidenceDir, type GodotEvidenceVersion } from '../godot-frontend/proof-identities';
import type { GodotEvidenceFile, GodotUpgradeDelta } from '../translate/code/authority/godot-4.7-evidence';

export interface GodotUpgradeDeltaReach {
  readonly member: string;
  readonly cases: readonly string[];
  readonly explanations: readonly GodotUpgradeDelta['explanation'][];
  /** `member` when the member itself is reached, `class` when only its class is used. */
  readonly reach: 'member' | 'class';
  readonly at: readonly string[];
}

/** Every recorded delta of `version`'s record, by case file. */
function recordedDeltas(version: GodotEvidenceVersion): readonly (GodotUpgradeDelta & { readonly file: string })[] {
  const dir = godotEvidenceDir(version);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json') && !name.startsWith('proof-'))
    .flatMap((name) => {
      const file = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as GodotEvidenceFile;
      return (file.deltas ?? []).map((delta) => ({ ...delta, file: name.replace(/\.json$/u, '') }));
    });
}

/** The getter and setter of `property` on `className` or an ancestor, as `Owner.method`. */
function accessors(apiDump: GodotApiDump, className: string, property: string): readonly string[] {
  const classes = new Map(apiDump.classes.map((entry) => [entry.name, entry] as const));
  for (let current = classes.get(className); current !== undefined; current = current.base_class === '' ? undefined : classes.get(current.base_class)) {
    const found = current.properties.find((entry) => entry.name === property);
    if (found !== undefined) return [found.getter, found.setter].filter((name): name is string => name !== undefined && name !== '').map((name) => `${current?.name ?? ''}.${name}`);
  }
  const builtin = (apiDump.builtinClasses ?? []).find((entry) => entry.name === className);
  return builtin?.members.some((entry) => entry.name === property) === true ? [`${className}.${property}`] : [];
}

function ancestry(apiDump: GodotApiDump, className: string): readonly string[] {
  const classes = new Map(apiDump.classes.map((entry) => [entry.name, entry] as const));
  const out: string[] = [];
  for (let current = classes.get(className); current !== undefined; current = current.base_class === '' ? undefined : classes.get(current.base_class)) out.push(current.name);
  return out.length === 0 ? [className] : out;
}

export function godotUpgradeDeltasReached(
  project: BoundGodotProject,
  projectVersion: string,
  apiDump: GodotApiDump,
): readonly GodotUpgradeDeltaReach[] {
  if (projectVersion !== '4.6') return [];
  const deltas = recordedDeltas(projectVersion);
  if (deltas.length === 0) return [];
  // What the project reaches: `Owner.member` and class names, each with where.
  const members = new Map<string, string[]>();
  const classes = new Map<string, string[]>();
  const note = (map: Map<string, string[]>, key: string, at: string) => map.set(key, [...(map.get(key) ?? []), at]);
  const noteMember = (className: string, member: string, at: string) => {
    for (const owner of ancestry(apiDump, className)) note(members, `${owner}.${member}`, at);
    for (const owner of ancestry(apiDump, className)) note(classes, owner, at);
  };
  for (const script of project.scripts) {
    const receivers = new Map(script.callReceivers.map((entry) => [entry.nodeId, entry] as const));
    for (const node of script.program.nodes) {
      const at = `${script.resPath}:${String(node.startLine)}`;
      if (node.kind === 'CALL') {
        const target = receivers.get(node.id)?.target ?? node.compilerTarget;
        if (target.owner !== '' && target.member !== '') noteMember(target.owner, target.member, at);
      } else if (node.kind === 'SUBSCRIPT' && node.isAttribute) {
        const base = script.program.nodes[node.base];
        const attribute = script.program.nodes[node.attribute];
        if (base === undefined || attribute?.kind !== 'IDENTIFIER') continue;
        const type = base.datatype.kind === 'NATIVE' ? base.datatype.nativeType : base.datatype.kind === 'BUILTIN' ? base.datatype.builtinType : '';
        if (type === '') continue;
        for (const accessor of accessors(apiDump, type, attribute.name)) {
          const [owner, member] = accessor.split('.') as [string, string];
          noteMember(owner, member, at);
        }
      }
    }
  }
  for (const scene of project.documents.scenes) {
    for (const node of scene.nodes) {
      const className = node.class.nativeName;
      const at = `${scene.resPath}#${node.nodePath}`;
      for (const owner of node.class.nativeAncestry) note(classes, owner, at);
      for (const property of Object.keys(node.authoredProperties)) {
        for (const accessor of accessors(apiDump, className, property)) {
          const [owner, member] = accessor.split('.') as [string, string];
          noteMember(owner, member, at);
        }
      }
    }
  }
  const bySymbol = new Map<string, (GodotUpgradeDelta & { readonly file: string })[]>();
  for (const delta of deltas) bySymbol.set(delta.symbol, [...(bySymbol.get(delta.symbol) ?? []), delta]);
  const reached: GodotUpgradeDeltaReach[] = [];
  for (const [symbol, group] of bySymbol) {
    const direct = members.get(symbol);
    const owner = symbol.split('.')[0] as string;
    const used = classes.get(owner);
    if (direct === undefined && used === undefined) continue;
    const explanations = [...new Map(group.map((delta) => [JSON.stringify(delta.explanation), delta.explanation] as const)).values()];
    reached.push({
      member: symbol,
      cases: group.map((delta) => `${delta.file}:${delta.caseId}`),
      explanations,
      reach: direct === undefined ? 'class' : 'member',
      at: [...new Set(direct ?? used ?? [])],
    });
  }
  return reached.sort((left, right) => (left.reach === right.reach ? left.member.localeCompare(right.member) : left.reach === 'member' ? -1 : 1));
}

/** The report's lines for the deltas reached. */
export function godotUpgradeDeltaReport(projectVersion: string, reached: readonly GodotUpgradeDeltaReach[]): string {
  if (reached.length === 0) return '';
  const lines = [`Authored in Godot ${projectVersion}, imported as Godot 4.7 runs it. Measured ${projectVersion}-to-4.7 deltas this project reaches:`];
  for (const entry of reached) {
    const where = entry.at.slice(0, 3).join(', ') + (entry.at.length > 3 ? `, +${String(entry.at.length - 3)} more` : '');
    lines.push(`  ${entry.member} (${entry.reach === 'member' ? 'member reached' : 'class used'}; ${where})`);
    for (const explanation of entry.explanations) {
      lines.push(
        'unexplained' in explanation
          ? `    unexplained: ${explanation.unexplained}`
          : `    ${explanation.file}:${String(explanation.line47)} (4.6: ${String(explanation.line46)}): ${explanation.change}`,
      );
    }
    lines.push(`    cases: ${entry.cases.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}
