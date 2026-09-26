/**
 * export-cycle-probe/unity-legitimacy.ts — S0 + census on the Unity intermediate.
 *
 * What this guarantees: our reader ingest the project (zero error-severity diagnostics, census
 * closes, unknownUnrefused = 0). That is the Force-Text / "real Unity project" half of the brief.
 *
 * What this does NOT guarantee: that no Godot fact is encoded in a real Unity field. A GameObject
 * name, a leftover MonoBehaviour member, a comment — the reader either parses them as Unity values
 * or drops them. Smuggling is closed on the RETURN hop: `writeGodotFromUnityModel` re-reads this
 * project through unity-analyze and emits Godot from THAT model alone. A comment is not in the
 * model and cannot come back. A name suffix comes back as a name (a named model diff). An unused
 * field is a census member and does not join to `wait_time` unless a join row says so.
 *
 * There is no residual token scan. The previous `/#\\s*(vgai-stash|stash):/i` check was a paper
 * red-proof: it only caught the token it planted.
 */
import { censusProject, formatCensus, type UnityCensus } from '../../../unity-analyze/src/analyze/census';
import { readUnityProject, type UnityProject } from '../../../unity-analyze/src/read/unity-project';

export interface LegitimacyReport {
  readonly ok: boolean;
  readonly project: UnityProject;
  readonly census: UnityCensus | undefined;
  readonly censusText: string;
  readonly errors: readonly string[];
}

export function checkUnityLegitimacy(projectDir: string): LegitimacyReport {
  const project = readUnityProject(projectDir);
  const errors: string[] = project.diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => `${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`);
  let census: UnityCensus | undefined;
  let censusText = '';
  try {
    census = censusProject(project);
    censusText = formatCensus(census).join('\n');
    if (census.unknownUnrefused !== 0) {
      errors.push(`census unknownUnrefused=${census.unknownUnrefused}`);
    }
    if (census.documents === 0) errors.push('census documents=0 (vacuous)');
    if (census.gameObjects === 0) errors.push('census gameObjects=0 (vacuous)');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return {
    ok: errors.length === 0,
    project,
    census,
    censusText,
    errors,
  };
}
