/**
 * `gd-analyze closure` — the Godot capabilities a set of projects uses, read from the official
 * frontend's bound program and the decoded scenes and resources.
 *
 * A read-only observer: it runs the same snapshot, official frontend and reader the import runs,
 * and feeds nothing back into production. It answers "what must compat and translation cover for
 * these games", per game and in total:
 *
 * - every call target the official compiler selected (`owner.member`), by target kind;
 * - every call the official compiler left unresolved, with its source location, because the lane
 *   must type its receiver before it can bind it;
 * - every attribute read or written on a typed base (`owner.property`);
 * - every node class a scene authors, every resource and sub-resource type, every signal
 *   connected in a scene, and every external asset format.
 *
 * The project's declared engine version is reported, not enforced: the frontend here is a
 * measuring instrument, so a Godot 4.6 project is read with the pinned 4.7 frontend and marked.
 * Godot 3 projects are listed as unread, since no Godot 3 frontend exists.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureGodotBoundProgram } from '../godot-frontend/run-bound-program';
import { godotSourceAuthority } from '../godot-frontend/source-authority';
import { godotReadAuthority } from '../read/authority-data';
import { readGodotProjectSnapshot } from '../read/godot-project';
import type { SceneNode } from '../read/godot-types';
import {
  captureGodotProjectSnapshot,
  materializeGodotProjectSnapshot,
} from '../snapshot/project-snapshot';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES_DIR = path.join(PACKAGE_DIR, 'test', 'fixtures');

type Counts = Record<string, number>;

interface GameClosure {
  readonly fixture: string;
  readonly engine: string;
  readonly read: 'read' | 'unread-godot3' | 'failed';
  readonly error?: string;
  readonly callTargets: Counts;
  readonly callKinds: Counts;
  readonly unresolvedCalls: readonly string[];
  readonly attributes: Counts;
  readonly untypedAttributes: readonly string[];
  readonly operators: Counts;
  readonly nodeClasses: Counts;
  readonly resourceTypes: Counts;
  readonly signals: Counts;
  readonly assetFormats: Counts;
}

function bump(counts: Counts, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

interface BoundNode {
  readonly id: number;
  readonly kind: string;
  readonly startLine?: number;
  readonly [key: string]: unknown;
}

function indexNodes(script: unknown): Map<number, BoundNode> {
  const byId = new Map<number, BoundNode>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record['id'] === 'number' && typeof record['kind'] === 'string') {
      byId.set(record['id'], record as unknown as BoundNode);
    }
    for (const child of Object.values(record)) walk(child);
  };
  walk(script);
  return byId;
}

function typeName(node: BoundNode | undefined): string | undefined {
  const datatype = node?.['datatype'] as Record<string, string> | undefined;
  if (datatype === undefined) return undefined;
  switch (datatype['kind']) {
    case 'BUILTIN':
      return datatype['builtinType'];
    case 'NATIVE':
      return datatype['nativeType'];
    case 'SCRIPT':
    case 'CLASS':
      return datatype['nativeType'] === '' ? undefined : datatype['nativeType'];
    default:
      return undefined;
  }
}

function sceneClasses(node: SceneNode | undefined, counts: Counts): void {
  if (node === undefined) return;
  if (node.type !== undefined) bump(counts, node.type);
  for (const child of node.children) sceneClasses(child, counts);
}

function engineOf(fixtureDir: string): { major: number; label: string } {
  const snapshot = captureGodotProjectSnapshot(fixtureDir);
  return {
    major: snapshot.engine.major,
    label: `${String(snapshot.engine.major)} [${snapshot.engine.features.join(', ')}]`,
  };
}

function readGame(fixture: string, exporter: string): GameClosure {
  const fixtureDir = path.join(FIXTURES_DIR, fixture);
  const empty = {
    callTargets: {},
    callKinds: {},
    unresolvedCalls: [],
    attributes: {},
    untypedAttributes: [],
    operators: {},
    nodeClasses: {},
    resourceTypes: {},
    signals: {},
    assetFormats: {},
  };
  const engine = engineOf(fixtureDir);
  if (engine.major !== 4) return { fixture, engine: engine.label, read: 'unread-godot3', ...empty };
  const snapshot = captureGodotProjectSnapshot(fixtureDir);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-closure-'));
  try {
    const projectDir = path.join(temp, 'project');
    materializeGodotProjectSnapshot(snapshot, projectDir);
    chmodSync(projectDir, 0o755);
    const program = captureGodotBoundProgram({ godotBinary: exporter, projectDir });
    const result: GameClosure = { fixture, engine: engine.label, read: 'read', ...empty };
    const unresolved: string[] = [];
    const untyped: string[] = [];
    for (const script of program.scripts) {
      const nodes = indexNodes(script);
      for (const node of nodes.values()) {
        if (node.kind === 'CALL') {
          const target = node['compilerTarget'] as Record<string, string> | undefined;
          const kind = target?.['kind'] ?? 'none';
          bump(result.callKinds, kind);
          if (target?.['owner'] !== undefined && target['owner'] !== '') {
            if (!target['owner'].startsWith('res://')) {
              bump(result.callTargets, `${target['owner']}.${target['member']}`);
            }
          } else if (kind === 'unresolved' || kind === 'dynamic' || kind === 'none') {
            unresolved.push(
              `${script.resPath}:${String(node.startLine)} ${String(node['functionName'])}`,
            );
          }
        } else if (node.kind === 'SUBSCRIPT' && node['isAttribute'] === true) {
          const base = nodes.get(node['base'] as number);
          const attribute = nodes.get(node['attribute'] as number);
          const owner = typeName(base);
          const name = String(attribute?.['name'] ?? '?');
          if (owner === undefined) {
            untyped.push(`${script.resPath}:${String(node.startLine)} .${name}`);
          } else {
            bump(result.attributes, `${owner}.${name}`);
          }
        } else if (node.kind === 'BINARY_OPERATOR' || node.kind === 'UNARY_OPERATOR') {
          const operand = nodes.get(
            (node['leftOperand'] ?? node['operand']) as number,
          );
          bump(result.operators, `${String(node['operation'])}(${typeName(operand) ?? 'Variant'})`);
        }
      }
    }
    const project = readGodotProjectSnapshot(snapshot, godotReadAuthority(godotSourceAuthority(4)));
    for (const scene of project.scenes) {
      if (scene.gltfOrigin !== undefined) continue;
      sceneClasses(scene.root, result.nodeClasses);
      for (const sub of scene.subResources) bump(result.resourceTypes, sub.type);
      for (const ext of scene.extResources) {
        bump(result.assetFormats, `${ext.type}:${path.extname(ext.resPath) || '?'}`);
      }
      for (const connection of scene.connections) bump(result.signals, connection.signal);
    }
    for (const resource of project.resources) {
      bump(result.resourceTypes, resource.type);
      for (const sub of resource.subResources) bump(result.resourceTypes, sub.type);
    }
    return { ...result, unresolvedCalls: unresolved, untypedAttributes: untyped };
  } catch (error) {
    return {
      fixture,
      engine: engine.label,
      read: 'failed',
      error: (error instanceof Error ? error.message.split('\n', 1)[0] : undefined) ?? String(error),
      ...empty,
    };
  } finally {
    // The captured tree is read-only, as the import leaves it; restore write to remove it.
    spawnSync('chmod', ['-R', 'u+w', temp]);
    rmSync(temp, { recursive: true, force: true });
  }
}

function merge(games: readonly GameClosure[], field: keyof GameClosure): Record<string, string[]> {
  const total: Record<string, string[]> = {};
  for (const game of games) {
    for (const key of Object.keys(game[field] as Counts)) {
      (total[key] ??= []).push(game.fixture);
    }
  }
  return Object.fromEntries(Object.entries(total).sort(([a], [b]) => a.localeCompare(b)));
}

export function runClosure(requested: readonly string[], exporter: string, out?: string): number {
  const fixtures =
    requested.length > 0
      ? requested
      : readdirSync(FIXTURES_DIR)
          .filter((name) => name.endsWith('.UPSTREAM.lock'))
          .map((name) => name.slice(0, -'.UPSTREAM.lock'.length))
          .filter((name) => existsSync(path.join(FIXTURES_DIR, name)))
          .sort();
  const games = fixtures.map((fixture) => readGame(fixture, exporter));
  const report = {
    games,
    total: {
      callTargets: merge(games, 'callTargets'),
      attributes: merge(games, 'attributes'),
      operators: merge(games, 'operators'),
      nodeClasses: merge(games, 'nodeClasses'),
      resourceTypes: merge(games, 'resourceTypes'),
      signals: merge(games, 'signals'),
      assetFormats: merge(games, 'assetFormats'),
    },
  };
  for (const game of games) {
    process.stdout.write(
      `${game.fixture.padEnd(28)} ${game.engine.padEnd(28)} ${game.read.padEnd(14)}` +
        (game.read === 'read'
          ? ` targets=${Object.keys(game.callTargets).length} unresolved=${game.unresolvedCalls.length}` +
            ` attributes=${Object.keys(game.attributes).length} untyped=${game.untypedAttributes.length}` +
            ` nodeClasses=${Object.keys(game.nodeClasses).length} resources=${Object.keys(game.resourceTypes).length}`
          : game.error === undefined
            ? ''
            : ` ${game.error}`) +
        '\n',
    );
  }
  const totals = report.total;
  process.stdout.write(
    `total: targets=${Object.keys(totals.callTargets).length} attributes=${Object.keys(totals.attributes).length}` +
      ` operators=${Object.keys(totals.operators).length} nodeClasses=${Object.keys(totals.nodeClasses).length}` +
      ` resources=${Object.keys(totals.resourceTypes).length} signals=${Object.keys(totals.signals).length}` +
      ` assetFormats=${Object.keys(totals.assetFormats).length}\n`,
  );
  if (out !== undefined) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  return games.some((game) => game.read === 'failed') ? 1 : 0;
}
