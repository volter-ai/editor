import {
  monorepoImplementationDigest,
  withLiveImplementation,
} from '../../godot-frontend/implementation-liveness';
import type { GodotSourceAuthority } from '../../godot-frontend/source-authority';
import {
  GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  GODOT_4_7_CODE_SEED_SOURCE_REVISION,
} from '../code/authority/godot-4.7-seed';
import {
  GODOT_4_7_LIFECYCLE_CLAIMS,
  GODOT_4_7_LIFECYCLE_LIVENESS,
  GODOT_4_7_LIFECYCLE_RULES,
  GODOT_4_7_MAIN_LOOP_RULES,
  GODOT_4_7_PROJECT_STARTUP_RULES,
} from './authority/godot-4.7-lifecycle';
import {
  GODOT_LIFECYCLE_AUTHORITY_VERSION,
  type GodotLifecycleAuthority,
} from './lifecycle-authority';

export const GODOT_LIFECYCLE_IMPLEMENTATION_FILES = [
  'packages/gd-analyze/src/translate/data/direct-scene-module-plan.ts',
  'packages/gd-analyze/src/translate/emit/direct-autoload-syntax.ts',
  'packages/gd-analyze/src/translate/emit/direct-scene-syntax.ts',
  'packages/gd-analyze/src/translate/emit/direct-scene-lifecycle-syntax.ts',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/node.ts',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/scene-tree.ts',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/signal.ts',
] as const;

export const GODOT_PROJECT_STARTUP_IMPLEMENTATION_FILES = [
  'packages/gd-analyze/src/translate/data/direct-project-data-plan.ts',
  'packages/gd-analyze/src/translate/emit/direct-autoload-syntax.ts',
  'packages/gd-analyze/src/translate/emit/direct-project-world-syntax.ts',
  'packages/gd-analyze/src/translate/emit/direct-scene-lifecycle-syntax.ts',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/node.ts',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/scene-tree.ts',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/signal.ts',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/react-lifecycle.tsx',
] as const;

const COMPAT = 'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat';

/** What the project-world proof runs: the composition, its emitters and the compat `Main` drives. */
export const GODOT_PROJECT_WORLD_IMPLEMENTATION_FILES = [
  'packages/gd-analyze/src/translate/data/direct-project-composition-plan.ts',
  'packages/gd-analyze/src/translate/data/input-map-plan.ts',
  'packages/gd-analyze/src/translate/emit/direct-project-world-syntax.ts',
  'packages/gd-analyze/src/translate/emit/direct-scene-syntax.ts',
  ...[
    'main.tsx',
    'main-timer-sync.ts',
    'scene-tree.ts',
    'node.ts',
    'react-lifecycle.tsx',
    'window.ts',
    'viewport.ts',
    'input.ts',
    'input-event.ts',
    'camera-3d.ts',
    'canvas-item.ts',
    'control.ts',
    'label.ts',
    'font.ts',
    'world-3d.ts',
    'collision-object-3d.ts',
    'rigid-body-3d.ts',
    'static-body-3d.ts',
    'project-settings.ts',
  ].map((file) => `${COMPAT}/${file}`),
] as const;

/** Checked-in exact-pin lifecycle authority for generated native scene composition. */
export function godotLifecycleAuthority(source: GodotSourceAuthority): GodotLifecycleAuthority {
  const supported =
    source.revision === GODOT_4_7_CODE_SEED_SOURCE_REVISION &&
    source.apiDumpSha256 === GODOT_4_7_CODE_SEED_API_DUMP_SHA256;
  return {
    version: GODOT_LIFECYCLE_AUTHORITY_VERSION,
    sourceRevision: source.revision,
    apiDumpSha256: source.apiDumpSha256,
    rules: supported ? GODOT_4_7_LIFECYCLE_RULES : [],
    projectStartupRules: supported ? GODOT_4_7_PROJECT_STARTUP_RULES : [],
    mainLoopRules: supported ? GODOT_4_7_MAIN_LOOP_RULES : [],
    claims: supported ? GODOT_4_7_LIFECYCLE_CLAIMS : [],
    liveness: supported
      ? GODOT_4_7_LIFECYCLE_LIVENESS.flatMap((entry) =>
          withLiveImplementation(
            [entry],
            entry.claimId === 'godot-4.7-project-main-loop'
              ? monorepoImplementationDigest(GODOT_PROJECT_WORLD_IMPLEMENTATION_FILES)
              : entry.claimId === 'godot-4.7-project-autoload-startup'
                ? monorepoImplementationDigest(GODOT_PROJECT_STARTUP_IMPLEMENTATION_FILES)
                : monorepoImplementationDigest(GODOT_LIFECYCLE_IMPLEMENTATION_FILES),
          ),
        )
      : [],
  };
}
