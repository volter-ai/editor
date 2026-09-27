import {
  GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
  godotProofIdentities,
} from '../../../godot-frontend/proof-identities';
import type { SemanticClaimRecord } from '../../../godot-frontend/semantic-claims';
import {
  GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  GODOT_4_7_CODE_SEED_SOURCE_REVISION,
} from '../../code/authority/godot-4.7-seed';
import {
  type GodotLifecycleClaimLiveness,
  type GodotLifecycleRule,
  type GodotMainLoopRule,
  type GodotProjectStartupRule,
  godotLifecycleRuleKey,
  godotMainLoopRuleKey,
  godotProjectStartupRuleKey,
} from '../lifecycle-authority';

const LIFECYCLE_IDENTITIES = godotProofIdentities('lifecycle');
export const GODOT_4_7_LIFECYCLE_INPUT_SHA256 = LIFECYCLE_IDENTITIES.input;
export const GODOT_4_7_LIFECYCLE_IMPLEMENTATION_SHA256 = LIFECYCLE_IDENTITIES.implementation;
export const GODOT_4_7_LIFECYCLE_OBSERVED_OUTPUT_SHA256 = LIFECYCLE_IDENTITIES.observed;
export const GODOT_4_7_LIFECYCLE_COMPARISON_SHA256 = LIFECYCLE_IDENTITIES.comparison;
const PROJECT_STARTUP_IDENTITIES = godotProofIdentities('project-startup');
export const GODOT_4_7_PROJECT_STARTUP_INPUT_SHA256 = PROJECT_STARTUP_IDENTITIES.input;
export const GODOT_4_7_PROJECT_STARTUP_IMPLEMENTATION_SHA256 = PROJECT_STARTUP_IDENTITIES.implementation;
export const GODOT_4_7_PROJECT_STARTUP_OBSERVED_OUTPUT_SHA256 = PROJECT_STARTUP_IDENTITIES.observed;
export const GODOT_4_7_PROJECT_STARTUP_COMPARISON_SHA256 = PROJECT_STARTUP_IDENTITIES.comparison;

export const GODOT_4_7_LIFECYCLE_RULES: readonly GodotLifecycleRule[] = [
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    phases: ['enter-tree', 'ready', 'exit-tree'],
    targetOperation: 'compat-native-hierarchy-mount',
    evidenceClaimId: 'godot-4.7-native-hierarchy-lifecycle',
  },
];

export const GODOT_4_7_PROJECT_STARTUP_RULES: readonly GodotProjectStartupRule[] = [
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    sourceOrder: 'autoloads-then-main',
    targetOperation: 'react-native-startup-batch',
    evidenceClaimId: 'godot-4.7-project-autoload-startup',
  },
];

const PROJECT_WORLD_IDENTITIES = godotProofIdentities('project-world');

export const GODOT_4_7_MAIN_LOOP_RULES: readonly GodotMainLoopRule[] = [
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    targetOperation: 'compat-godot-main',
    evidenceClaimId: 'godot-4.7-project-main-loop',
  },
];

const reproductionCommand = GODOT_4_7_PROOF_REPRODUCTION_COMMAND;

const mainLoopClaims: readonly SemanticClaimRecord[] = GODOT_4_7_MAIN_LOOP_RULES.map((rule) => ({
  registryVersion: 1,
  claimId: rule.evidenceClaimId,
  layer: 'compat',
  canonicalIdentity: godotMainLoopRuleKey(rule.sourceRevision),
  godot: {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
    sourceFile: 'main/main.cpp',
    sourceSymbol: 'Main::iteration (with Main::start and OS_Web::main_loop_iterate)',
    sourceLine: 4917,
  },
  native: {
    executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
    buildIdentity: 'Godot 4.7-stable official 5b4e0cb0f',
    inputSha256: PROJECT_WORLD_IDENTITIES.input,
    callsite: 'res://observe.gd _physics_process() (--fixed-fps 60)',
    observedOutputSha256: PROJECT_WORLD_IDENTITIES.observed,
  },
  target: {
    implementationSha256: PROJECT_WORLD_IDENTITIES.implementation,
    callsite: 'emitted src/world.tsx <GodotMain> driven by @react-three/fiber advance()',
    observedOutputSha256: PROJECT_WORLD_IDENTITIES.observed,
  },
  comparison: {
    comparator: 'callback log, action state, Label rect and camera exact; body positions within Rapier geometry (0.05)',
    tolerance: 'rapier-geometry 0.05 on body origins; exact elsewhere',
    resultSha256: PROJECT_WORLD_IDENTITIES.comparison,
  },
  reproductionCommand,
}));

const hierarchyClaims: readonly SemanticClaimRecord[] = GODOT_4_7_LIFECYCLE_RULES.map((rule) => ({
  registryVersion: 1,
  claimId: rule.evidenceClaimId,
  layer: 'compat',
  canonicalIdentity: godotLifecycleRuleKey(rule.sourceRevision, rule.phases),
  godot: {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
    sourceFile: 'scene/main/node.cpp',
    sourceSymbol: 'Node::_propagate_enter_tree/_propagate_ready/_propagate_exit_tree',
    sourceLine: 323,
  },
  native: {
    executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
    buildIdentity: 'Godot 4.7-stable official 5b4e0cb0f',
    inputSha256: GODOT_4_7_LIFECYCLE_INPUT_SHA256,
    callsite: 'res://lifecycle_probe.gd:18 run_probe()',
    observedOutputSha256: GODOT_4_7_LIFECYCLE_OBSERVED_OUTPUT_SHA256,
  },
  target: {
    implementationSha256: GODOT_4_7_LIFECYCLE_IMPLEMENTATION_SHA256,
    callsite: 'mountGodotScriptTree(nativeRoot, generatedBindings)',
    observedOutputSha256: GODOT_4_7_LIFECYCLE_OBSERVED_OUTPUT_SHA256,
  },
  comparison: {
    comparator: 'ordered lifecycle trace exact equality',
    tolerance: 'exact',
    resultSha256: GODOT_4_7_LIFECYCLE_COMPARISON_SHA256,
  },
  reproductionCommand,
}));

const startupClaims: readonly SemanticClaimRecord[] = GODOT_4_7_PROJECT_STARTUP_RULES.map(
  (rule) => ({
    registryVersion: 1,
    claimId: rule.evidenceClaimId,
    layer: 'compat',
    canonicalIdentity: godotProjectStartupRuleKey(rule.sourceRevision),
    godot: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
      sourceFile: 'main/main.cpp',
      sourceSymbol: 'Main::start autoload two-pass construction and SceneTree root insertion',
      sourceLine: 4493,
    },
    native: {
      executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
      buildIdentity: 'Godot 4.7-stable official 5b4e0cb0f',
      inputSha256: GODOT_4_7_PROJECT_STARTUP_INPUT_SHA256,
      callsite: 'project.godot [autoload] First/Second plus run/main_scene',
      observedOutputSha256: GODOT_4_7_PROJECT_STARTUP_OBSERVED_OUTPUT_SHA256,
    },
    target: {
      implementationSha256: GODOT_4_7_PROJECT_STARTUP_IMPLEMENTATION_SHA256,
      callsite: '<GodotProjectStartup> generated autoloads then main scene',
      observedOutputSha256: GODOT_4_7_PROJECT_STARTUP_OBSERVED_OUTPUT_SHA256,
    },
    comparison: {
      comparator: 'ordered construction/enter/ready/exit trace exact equality',
      tolerance: 'exact',
      resultSha256: GODOT_4_7_PROJECT_STARTUP_COMPARISON_SHA256,
    },
    reproductionCommand,
  }),
);

export const GODOT_4_7_LIFECYCLE_CLAIMS: readonly SemanticClaimRecord[] = [
  ...hierarchyClaims,
  ...startupClaims,
  ...mainLoopClaims,
];

export const GODOT_4_7_LIFECYCLE_LIVENESS: readonly GodotLifecycleClaimLiveness[] =
  GODOT_4_7_LIFECYCLE_CLAIMS.map((claim) => ({
    claimId: claim.claimId,
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
    executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
    inputSha256:
      claim.claimId === 'godot-4.7-project-main-loop'
        ? PROJECT_WORLD_IDENTITIES.input
        : claim.claimId === 'godot-4.7-project-autoload-startup'
          ? GODOT_4_7_PROJECT_STARTUP_INPUT_SHA256
          : GODOT_4_7_LIFECYCLE_INPUT_SHA256,
    implementationSha256:
      claim.claimId === 'godot-4.7-project-main-loop'
        ? PROJECT_WORLD_IDENTITIES.implementation
        : claim.claimId === 'godot-4.7-project-autoload-startup'
          ? GODOT_4_7_PROJECT_STARTUP_IMPLEMENTATION_SHA256
          : GODOT_4_7_LIFECYCLE_IMPLEMENTATION_SHA256,
  }));
