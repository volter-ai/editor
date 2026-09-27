import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from '../../code/authority/godot-4.7-seed';
import type {
  GodotLifecycleRule,
  GodotMainLoopRule,
  GodotProjectStartupRule,
} from '../lifecycle-authority';

export const GODOT_4_7_LIFECYCLE_RULES: readonly GodotLifecycleRule[] = [
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    phases: ['enter-tree', 'ready', 'exit-tree'],
    targetOperation: 'compat-native-hierarchy-mount',
  },
];

export const GODOT_4_7_PROJECT_STARTUP_RULES: readonly GodotProjectStartupRule[] = [
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    sourceOrder: 'autoloads-then-main',
    targetOperation: 'react-native-startup-batch',
  },
];

export const GODOT_4_7_MAIN_LOOP_RULES: readonly GodotMainLoopRule[] = [
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    targetOperation: 'compat-godot-main',
  },
];
