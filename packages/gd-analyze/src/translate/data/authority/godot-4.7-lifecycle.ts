import type { SemanticClaimRecord } from '../../../godot-frontend/semantic-claims';
import {
  GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  GODOT_4_7_CODE_SEED_SOURCE_REVISION,
} from '../../code/authority/godot-4.7-seed';
import {
  type GodotLifecycleClaimLiveness,
  type GodotLifecycleRule,
  type GodotProjectStartupRule,
  godotLifecycleRuleKey,
  godotProjectStartupRuleKey,
} from '../lifecycle-authority';

export const GODOT_4_7_LIFECYCLE_INPUT_SHA256 =
  '8f566d5c5b2ebfaa56d80728fa7adbfc6fdab1625c722e801834183555b52ffc' as const;
export const GODOT_4_7_LIFECYCLE_IMPLEMENTATION_SHA256 =
  '58505e75e82e819484bd0295347e83d5b9c4edc1819486c770b62198160f1e67' as const;
export const GODOT_4_7_LIFECYCLE_OBSERVED_OUTPUT_SHA256 =
  '032b7edb685f1c285377304b6b45295d75b3f11d72796edd9a721aff6f4bd6bf' as const;
export const GODOT_4_7_LIFECYCLE_COMPARISON_SHA256 =
  '3ee7ed023a2ac788c0016628f35db4666ef94a396fc1f0172dc3658b65259e24' as const;
export const GODOT_4_7_PROJECT_STARTUP_INPUT_SHA256 =
  'd8a0d1883af6a7621b1e0fa5d3916e5405d02661e2fd84e6ca1d26417a29431e' as const;
export const GODOT_4_7_PROJECT_STARTUP_IMPLEMENTATION_SHA256 =
  'dada429d74889ea855cfb5e0c5d9d2d4ef3949a2bb9bc885a3852240e9545726' as const;
export const GODOT_4_7_PROJECT_STARTUP_OBSERVED_OUTPUT_SHA256 =
  'cd2c86e002601654a8f957ee1da726ff5c0296e70bba697f45a5fb9d9434de1b' as const;
export const GODOT_4_7_PROJECT_STARTUP_COMPARISON_SHA256 =
  'f6e03d5ef93421b43dde2dce2c53a4df7ea314445bfdf0eedeca0bd902a0ee1b' as const;

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

const reproductionCommand = [
  'npm',
  'run',
  'godot-direct-composition-proof',
  '-w',
  '@volter/gd-analyze',
  '--',
  '--official-binary',
  '.vgai/tmp/godot-4.7-stable/Godot.app/Contents/MacOS/Godot',
] as const;

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
];

export const GODOT_4_7_LIFECYCLE_LIVENESS: readonly GodotLifecycleClaimLiveness[] =
  GODOT_4_7_LIFECYCLE_CLAIMS.map((claim) => ({
    claimId: claim.claimId,
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
    executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
    inputSha256:
      claim.claimId === 'godot-4.7-project-autoload-startup'
        ? GODOT_4_7_PROJECT_STARTUP_INPUT_SHA256
        : GODOT_4_7_LIFECYCLE_INPUT_SHA256,
    implementationSha256:
      claim.claimId === 'godot-4.7-project-autoload-startup'
        ? GODOT_4_7_PROJECT_STARTUP_IMPLEMENTATION_SHA256
        : GODOT_4_7_LIFECYCLE_IMPLEMENTATION_SHA256,
  }));
