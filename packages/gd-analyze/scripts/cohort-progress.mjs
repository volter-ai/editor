#!/usr/bin/env node

/**
 * Turn one generated `gd-analyze cohort-report --json` result into an immutable, timestamped
 * progress snapshot and compare it with the previous snapshot in the same history directory.
 *
 * Coverage remains generated evidence, never checked-in truth. The history directory therefore
 * belongs under ignored `.vgai/tmp/` (or another explicit scratch volume), and every snapshot
 * records its time, engine revision, input digest, and complete input report. Stable
 * game×requirement keys distinguish actual compat closure from denominator growth.
 *
 * Usage:
 *   node packages/gd-analyze/scripts/cohort-progress.mjs \
 *     <cohort-report.json> <history-dir> [--engine-revision <sha>] \
 *     [--expected-games <count>] [--label <text>]
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

function fail(message) {
  process.stderr.write(`cohort-progress: ${message}\n`);
  process.exit(2);
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) fail(`${name} needs a value`);
  return value;
}

function percent(partition) {
  return partition.observed === 0 ? 100 : (partition.supported / partition.observed) * 100;
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function fixedSigned(value) {
  const rounded = value.toFixed(2);
  return value > 0 ? `+${rounded}` : rounded;
}

function assertPartition(value, name) {
  if (
    value === null ||
    typeof value !== 'object' ||
    !Number.isInteger(value.observed) ||
    !Number.isInteger(value.supported) ||
    !Number.isInteger(value.uncovered)
  ) {
    fail(`input has no valid ${name}`);
  }
}

function assertReport(report) {
  if (
    report === null ||
    typeof report !== 'object' ||
    !['vgai-godot-cohort-v1', 'vgai-godot-cohort-v2'].includes(report.protocol) ||
    !Array.isArray(report.games) ||
    !Array.isArray(report.openUnion)
  ) {
    fail('input is not a supported gd-analyze cohort report');
  }
  assertPartition(report.demandCoverage, 'demandCoverage');
  assertPartition(report.uniqueUnionApiCoverage, 'uniqueUnionApiCoverage');
  for (const game of report.games) {
    if (typeof game.projectId !== 'string' || !Array.isArray(game.requirements)) {
      fail('input contains a game without projectId/requirements');
    }
  }
}

function requirementPairs(report) {
  const pairs = new Map();
  for (const game of report.games) {
    for (const requirement of game.requirements) {
      pairs.set(`${game.projectId}\u0000${requirement.key}`, {
        game: game.projectId,
        key: requirement.key,
        supported: requirement.supported === true,
      });
    }
  }
  return pairs;
}

function parserTotals(report) {
  return report.games.reduce(
    (sum, game) => ({
      scripts: sum.scripts + (game.inventory?.scripts ?? 0),
      parsed: sum.parsed + (game.inventory?.parsedScripts ?? 0),
      unreadable: sum.unreadable + (game.stage === 'unreadable' ? 1 : 0),
    }),
    { scripts: 0, parsed: 0, unreadable: 0 },
  );
}

/** Keep analyzer/binder work out of compat throughput. Both are honest API gaps, but an unresolved
 * receiver cannot be closed by adding another compat method because the generated call has not
 * been bound to that method's Godot class yet. */
function apiGapOwnership(report) {
  const openApi = report.openUnion.filter((row) => row.family === 'api');
  function partition(rows) {
    return {
      uniqueRequirements: rows.length,
      uncoveredPairs: rows.reduce((sum, row) => sum + row.uncoveredGamePairs, 0),
      touches: rows.reduce((sum, row) => sum + row.touchCount, 0),
    };
  }
  const unresolved = openApi.filter((row) => row.canonical.startsWith('unresolved:'));
  const known = openApi.filter((row) => !row.canonical.startsWith('unresolved:'));
  return {
    knownReceiverCompat: partition(known),
    unresolvedBinding: partition(unresolved),
  };
}

function deltaBetween(previous, current) {
  const before = requirementPairs(previous.report);
  const after = requirementPairs(current.report);
  let addedPairs = 0;
  let removedPairs = 0;
  let newlySupportedPairs = 0;
  let regressedPairs = 0;
  const newlySupported = [];
  const regressions = [];

  for (const [key, pair] of after) {
    const prior = before.get(key);
    if (prior === undefined) {
      addedPairs += 1;
    } else if (!prior.supported && pair.supported) {
      newlySupportedPairs += 1;
      newlySupported.push(`${pair.game}:${pair.key}`);
    } else if (prior.supported && !pair.supported) {
      regressedPairs += 1;
      regressions.push(`${pair.game}:${pair.key}`);
    }
  }
  for (const key of before.keys()) if (!after.has(key)) removedPairs += 1;

  const beforeGames = new Set(previous.report.games.map((game) => game.projectId));
  const afterGames = new Set(current.report.games.map((game) => game.projectId));
  const elapsedMinutes = Math.max(
    0,
    (Date.parse(current.capturedAt) - Date.parse(previous.capturedAt)) / 60_000,
  );
  const beforeOpen = new Map(previous.report.openUnion.map((row) => [row.key, row.touchCount]));
  const afterOpen = new Map(current.report.openUnion.map((row) => [row.key, row.touchCount]));
  const openTouchChanges = [];
  for (const key of new Set([...beforeOpen.keys(), ...afterOpen.keys()])) {
    const beforeTouches = beforeOpen.get(key) ?? 0;
    const afterTouches = afterOpen.get(key) ?? 0;
    if (beforeTouches !== afterTouches) {
      openTouchChanges.push({
        key,
        beforeTouches,
        afterTouches,
        delta: afterTouches - beforeTouches,
      });
    }
  }
  openTouchChanges.sort(
    (a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.key.localeCompare(b.key),
  );
  return {
    elapsedMinutes,
    gamesAdded: [...afterGames].filter((game) => !beforeGames.has(game)).sort(),
    gamesRemoved: [...beforeGames].filter((game) => !afterGames.has(game)).sort(),
    addedPairs,
    removedPairs,
    newlySupportedPairs,
    regressedPairs,
    newlySupported,
    regressions,
    demandObserved:
      current.report.demandCoverage.observed - previous.report.demandCoverage.observed,
    demandSupported:
      current.report.demandCoverage.supported - previous.report.demandCoverage.supported,
    demandPercentagePoints:
      percent(current.report.demandCoverage) - percent(previous.report.demandCoverage),
    uniqueApiObserved:
      current.report.uniqueUnionApiCoverage.observed -
      previous.report.uniqueUnionApiCoverage.observed,
    uniqueApiSupported:
      current.report.uniqueUnionApiCoverage.supported -
      previous.report.uniqueUnionApiCoverage.supported,
    parsedScripts: current.parser.parsed - previous.parser.parsed,
    observedScripts: current.parser.scripts - previous.parser.scripts,
    failedScripts:
      current.parser.scripts -
      current.parser.parsed -
      (previous.parser.scripts - previous.parser.parsed),
    unreadableGames: current.parser.unreadable - previous.parser.unreadable,
    openTouchChanges,
  };
}

function gitRevision() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function formatSnapshot(snapshot) {
  const { report, parser, apiGapOwnership: ownership, delta, expectedGames } = snapshot;
  const coverage = percent(report.demandCoverage);
  const uniqueApi = percent(report.uniqueUnionApiCoverage);
  const lines = [
    `Godot corpus snapshot — ${snapshot.capturedAt}`,
    `  corpus                ${report.games.length}${expectedGames === null ? '' : `/${expectedGames}`} game(s); ${parser.unreadable} unreadable`,
    `  demand coverage       ${report.demandCoverage.supported}/${report.demandCoverage.observed} (${coverage.toFixed(2)}%); ${report.demandCoverage.uncovered} uncovered`,
    `  unique API union      ${report.uniqueUnionApiCoverage.supported}/${report.uniqueUnionApiCoverage.observed} (${uniqueApi.toFixed(2)}%)`,
    `  parser yield          ${parser.parsed}/${parser.scripts} scripts (${percent({ supported: parser.parsed, observed: parser.scripts }).toFixed(2)}%)`,
    `  known API gaps        ${ownership.knownReceiverCompat.uncoveredPairs} pairs / ${ownership.knownReceiverCompat.touches} touches (compat owner)`,
    `  unresolved bindings   ${ownership.unresolvedBinding.uncoveredPairs} pairs / ${ownership.unresolvedBinding.touches} touches (analyzer owner)`,
    `  zero-open games       ${report.zeroOpenGameCount}/${report.games.length}`,
    `  engine revision       ${snapshot.engineRevision ?? 'unavailable'}`,
    `  source digest         ${snapshot.sourceSha256}`,
  ];
  if (snapshot.label !== null) lines.push(`  label                 ${snapshot.label}`);

  if (delta === null) {
    lines.push('', 'DELTA', '  baseline snapshot; no previous measurement');
  } else {
    const hours = delta.elapsedMinutes / 60;
    const closureRate = hours > 0 ? delta.newlySupportedPairs / hours : 0;
    lines.push(
      '',
      `DELTA (${delta.elapsedMinutes.toFixed(1)} minutes)`,
      `  games                +${delta.gamesAdded.length} / -${delta.gamesRemoved.length}`,
      `  requirement pairs    ${signed(delta.addedPairs)} added, ${signed(-delta.removedPairs)} removed`,
      `  stable-pair closure  +${delta.newlySupportedPairs} supported, ${delta.regressedPairs} regressed (${closureRate.toFixed(1)} closures/hour)`,
      `  demand totals        ${signed(delta.demandSupported)} supported / ${signed(delta.demandObserved)} observed (${fixedSigned(delta.demandPercentagePoints)} pp)`,
      `  unique API totals    ${signed(delta.uniqueApiSupported)} supported / ${signed(delta.uniqueApiObserved)} observed`,
      `  parser scripts       ${signed(delta.parsedScripts)} parsed / ${signed(delta.observedScripts)} observed; ${signed(delta.failedScripts)} failures`,
    );
    if (delta.gamesAdded.length > 0)
      lines.push(`  games added           ${delta.gamesAdded.join(', ')}`);
    if (delta.regressions.length > 0) {
      lines.push(`  REGRESSIONS           ${delta.regressions.slice(0, 20).join(', ')}`);
    }
    if (delta.openTouchChanges.length > 0) {
      lines.push('  largest touch deltas');
      for (const row of delta.openTouchChanges.slice(0, 10)) {
        lines.push(
          `    ${row.key}: ${row.beforeTouches} → ${row.afterTouches} (${signed(row.delta)})`,
        );
      }
    }
  }

  lines.push('', 'TOP OPEN REQUIREMENTS');
  for (const row of report.openUnion.slice(0, 20)) {
    lines.push(
      `  ${row.key} — ${row.gameFrequency} game(s), ${row.uncoveredGamePairs} uncovered pair(s), ${row.touchCount} touch(es), ${row.blockingSeverity}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

const args = process.argv.slice(2);
const positional = [];
for (let index = 0; index < args.length; index += 1) {
  if (
    args[index] === '--engine-revision' ||
    args[index] === '--expected-games' ||
    args[index] === '--label'
  ) {
    index += 1;
  } else if (args[index].startsWith('--')) {
    fail(`unknown option ${args[index]}`);
  } else {
    positional.push(args[index]);
  }
}
if (positional.length !== 2) {
  fail(
    'usage: cohort-progress <cohort-report.json> <history-dir> [--engine-revision <sha>] [--expected-games <count>] [--label <text>]',
  );
}

const [reportPath, historyDir] = positional.map((value) => path.resolve(value));
const expectedText = optionValue(args, '--expected-games');
const expectedGames = expectedText === undefined ? null : Number(expectedText);
if (expectedGames !== null && (!Number.isInteger(expectedGames) || expectedGames < 1)) {
  fail('--expected-games must be a positive integer');
}
const label = optionValue(args, '--label') ?? null;
const explicitEngineRevision = optionValue(args, '--engine-revision');
if (explicitEngineRevision !== undefined && !/^[0-9a-f]{40}$/.test(explicitEngineRevision)) {
  fail('--engine-revision must be a full lowercase 40-character git SHA');
}
const sourceBytes = await readFile(reportPath);
let report;
try {
  report = JSON.parse(sourceBytes.toString('utf8'));
} catch (error) {
  fail(`cannot parse ${reportPath}: ${error instanceof Error ? error.message : String(error)}`);
}
assertReport(report);
const duplicateIds = report.games
  .map((game) => game.projectId)
  .filter((id, index, ids) => ids.indexOf(id) !== index);
if (duplicateIds.length > 0) {
  fail(`input contains duplicate project ids: ${[...new Set(duplicateIds)].join(', ')}`);
}
if (expectedGames !== null && report.games.length !== expectedGames) {
  fail(`input contains ${report.games.length} games, expected exactly ${expectedGames}`);
}
if (expectedGames !== null) {
  if (
    report.corpus === null ||
    typeof report.corpus !== 'object' ||
    typeof report.corpus.manifestSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(report.corpus.manifestSha256) ||
    report.corpus.manifestGames !== expectedGames
  ) {
    fail('input is not bound to a validated local corpus manifest for the expected game count');
  }
}
const unreadableGames = report.games
  .filter((game) => game.stage === 'unreadable')
  .map((game) => game.projectId);
if (unreadableGames.length > 0) {
  fail(`input contains unreadable games: ${unreadableGames.join(', ')}`);
}

await mkdir(historyDir, { recursive: true });
const priorNames = (await readdir(historyDir))
  .filter((name) => /^\d{8}T\d{6}Z-[0-9a-f]{12}\.json$/.test(name))
  .sort();
let previous = null;
if (priorNames.length > 0) {
  previous = JSON.parse(await readFile(path.join(historyDir, priorNames.at(-1)), 'utf8'));
}

const capturedAt = new Date().toISOString();
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
const snapshot = {
  protocol: 'vgai-godot-cohort-progress-v1',
  capturedAt,
  // The report may have been generated in another worktree. In that case the caller MUST name
  // its revision; silently recording this snapshot command's checkout would be precise-looking
  // false provenance.
  engineRevision: explicitEngineRevision ?? gitRevision(),
  sourceReport: reportPath,
  sourceSha256,
  expectedGames,
  label,
  parser: parserTotals(report),
  apiGapOwnership: apiGapOwnership(report),
  report,
  delta: null,
};
snapshot.delta = previous === null ? null : deltaBetween(previous, snapshot);

const stamp = capturedAt
  .replaceAll('-', '')
  .replaceAll(':', '')
  .replace(/\.\d{3}Z$/, 'Z');
const filename = `${stamp}-${sourceSha256.slice(0, 12)}.json`;
await writeFile(path.join(historyDir, filename), `${JSON.stringify(snapshot, null, 2)}\n`, {
  flag: 'wx',
});
const formatted = formatSnapshot(snapshot);
await writeFile(path.join(historyDir, filename.replace(/\.json$/, '.txt')), formatted, {
  flag: 'wx',
});
process.stdout.write(`${formatted}  snapshot              ${path.join(historyDir, filename)}\n`);
