/**
 * `gd-analyze evidence --refresh`: run every authority's native/target proof against the pinned
 * official binary and bound exporter, rewrite the identities of each proof that agrees, then
 * re-run every evidence case file (compat modules, then language rules).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { enterEvidenceMeasurement } from '../godot-frontend/implementation-liveness';
import {
  type GodotProofIdentities,
  godotProofIdentities,
  writeGodotProofIdentities,
} from '../godot-frontend/proof-identities';
import { measureAnalysisProof } from './proofs/analysis';
import { measureAutoloadReferenceProof } from './proofs/autoload-reference';
import { measureCodeSeedProof } from './proofs/code-seed';
import { measureFieldValueProof } from './proofs/field-values';
import { measureLanguageProof } from './proofs/language';
import { measureLifecycleProof } from './proofs/lifecycle';
import type { GodotProofMeasurement, GodotProofTools } from './proofs/proof';
import { measureProjectSettingProof } from './proofs/project-settings';
import { measureReadProof } from './proofs/read';
import { measureReceiverProof } from './proofs/receivers';
import { measureSceneNodeProof } from './proofs/scene-nodes';
import { measureSceneStructureProof } from './proofs/scene-structure';
import {
  GODOT_4_7_OFFICIAL_EXECUTABLE_SHA256,
  godotEvidenceCaseNames,
  runEvidence,
} from './run-evidence';

/** Upstream authorities first; the lifecycle proof mounts a DOM on the process, so it runs last. */
const PROOFS: readonly (readonly [
  string,
  (tools: GodotProofTools) => readonly GodotProofMeasurement[] | Promise<readonly GodotProofMeasurement[]>,
])[] = [
  ['read', measureReadProof],
  ['analysis', measureAnalysisProof],
  ['receivers', measureReceiverProof],
  ['project-settings', measureProjectSettingProof],
  ['field-values', measureFieldValueProof],
  ['scene-nodes', measureSceneNodeProof],
  ['scene-structure', measureSceneStructureProof],
  ['code-seed', measureCodeSeedProof],
  ['language', measureLanguageProof],
  ['autoload-reference', measureAutoloadReferenceProof],
  ['lifecycle', measureLifecycleProof],
];

function same(left: GodotProofIdentities, right: GodotProofIdentities): boolean {
  return (
    left.input === right.input &&
    left.implementation === right.implementation &&
    left.observed === right.observed &&
    left.comparison === right.comparison
  );
}

export async function refreshEvidence(tools: GodotProofTools): Promise<number> {
  const executable = createHash('sha256').update(readFileSync(tools.officialBinary)).digest('hex');
  if (executable !== GODOT_4_7_OFFICIAL_EXECUTABLE_SHA256) {
    throw new Error(`refusing ${tools.officialBinary}: it is not the official Godot 4.7-stable executable`);
  }
  // The proofs run the pipeline whose claims they re-measure; see enterEvidenceMeasurement.
  enterEvidenceMeasurement();
  const failed: string[] = [];
  for (const [proof, measure] of PROOFS) {
    let measurements: readonly GodotProofMeasurement[];
    try {
      measurements = await measure(tools);
    } catch (error) {
      failed.push(proof);
      process.stdout.write(
        `${proof}: native and target disagree or the proof failed; nothing written\n  ${
          error instanceof Error ? error.message.split('\n').join('\n  ') : String(error)
        }\n`,
      );
      continue;
    }
    for (const measurement of measurements) {
      if (!measurement.agree) {
        failed.push(measurement.name);
        process.stdout.write(
          `${measurement.name}: native and target disagree; nothing written\n  ${measurement.detail.split('\n').join('\n  ')}\n`,
        );
        continue;
      }
      const recorded = godotProofIdentities(measurement.name);
      if (same(recorded, measurement.identities)) {
        process.stdout.write(`${measurement.name}: agrees, identities unchanged\n`);
        continue;
      }
      writeGodotProofIdentities(measurement.name, measurement.identities);
      const changed = (['input', 'implementation', 'observed', 'comparison'] as const).filter(
        (key) => recorded[key] !== measurement.identities[key],
      );
      process.stdout.write(`${measurement.name}: agrees, refreshed ${changed.join(', ')}\n`);
    }
  }
  // Then every case file: compat modules, then the language rules lowered through them.
  for (const name of await godotEvidenceCaseNames()) {
    try {
      if ((await runEvidence(name, tools.officialBinary, tools.exporterBinary)) !== 0) failed.push(name);
    } catch (error) {
      failed.push(name);
      process.stdout.write(
        `${name}: the case file failed; nothing written\n  ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
  if (failed.length > 0) {
    process.stdout.write(`refresh failed for: ${failed.join(', ')}\n`);
    return 1;
  }
  return 0;
}
