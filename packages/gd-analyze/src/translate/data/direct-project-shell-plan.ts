import {
  mergeAdapterRegionIncludes,
  type RegionIncludeAddition,
} from '../../../../game-editor/node/scaffold/adapter-region-merge.js';
import type {
  GodotImportToolchainSnapshot,
  GodotToolchainFileArtifact,
} from '../../snapshot/toolchain-snapshot';

const TEMPLATE_PREFIX = 'packages/game-editor/template/';

export interface DirectGodotProjectShellFilePlan {
  readonly kind: 'bytes';
  readonly targetPath: string;
  readonly bytes: Uint8Array;
  readonly sourcePaths: readonly string[];
}

/**
 * The template's boot, carried as it is: its `main.ts` mounts each root the manifest declares
 * (a `three` root's entry in fiber's `<Canvas>`), through the entry modules its Vite plugin
 * generates from the manifest.
 */
const TEMPLATE_SHELL = ['src/main.ts', 'src/manifest-entry-modules.d.ts', 'vite.config.ts', 'manifest-entry-modules-plugin.ts'] as const;

function frozenTemplateArtifact(
  toolchain: GodotImportToolchainSnapshot,
  projectPath: string,
): GodotToolchainFileArtifact {
  const path = `${TEMPLATE_PREFIX}${projectPath}`;
  const artifact = toolchain.scaffoldArtifacts.find((candidate) => candidate.path === path);
  if (artifact === undefined) throw new Error(`${path}: absent from frozen scaffold snapshot`);
  return artifact;
}

function frozenTemplateText(toolchain: GodotImportToolchainSnapshot, projectPath: string): string {
  return Buffer.from(frozenTemplateArtifact(toolchain, projectPath).bytes).toString('utf8');
}

function plannedTsconfig(toolchain: GodotImportToolchainSnapshot): string {
  const config = JSON.parse(frozenTemplateText(toolchain, 'tsconfig.json')) as {
    compilerOptions?: Record<string, unknown>;
    exclude?: string[];
  };
  config.compilerOptions ??= {};
  config.compilerOptions['noUnusedLocals'] = false;
  config.compilerOptions['noUnusedParameters'] = false;
  const excluded = new Set(config.exclude ?? []);
  excluded.add('src/lib/godot-compat');
  config.exclude = [...excluded];
  return `${JSON.stringify(config, null, 2)}\n`;
}

function capabilityRegionAdditions(
  toolchain: GodotImportToolchainSnapshot,
): readonly RegionIncludeAddition[] {
  const globs = toolchain.capabilities.flatMap((capability) => capability.regions?.three ?? []);
  return globs.length === 0 ? [] : [{ rootId: 'world', globs: [...new Set(globs)].sort() }];
}

function plannedAdapterModule(toolchain: GodotImportToolchainSnapshot): string {
  const merge = mergeAdapterRegionIncludes(
    frozenTemplateText(toolchain, 'vgai.adapter.ts'),
    capabilityRegionAdditions(toolchain),
  );
  if (merge.kind === 'unreadable') {
    throw new Error(`vgai.adapter.ts: capability regions cannot be planned: ${merge.reason}`);
  }
  return merge.kind === 'merged' ? merge.text : frozenTemplateText(toolchain, 'vgai.adapter.ts');
}

function retainedIndex(
  projectName: string,
  toolchain: GodotImportToolchainSnapshot,
): DirectGodotProjectShellFilePlan {
  const targetPath = 'index.html';
  const source = frozenTemplateText(toolchain, targetPath);
  return {
    kind: 'bytes',
    targetPath,
    bytes: Buffer.from(source.replace(/<title>.*<\/title>/u, `<title>${projectName}</title>`)),
    sourcePaths: ['project.godot'],
  };
}

/** Select the complete frozen host shell: the template's own files, and what the lane adapts. */
export function planDirectGodotProjectShell(
  projectName: string,
  toolchain: GodotImportToolchainSnapshot,
): readonly DirectGodotProjectShellFilePlan[] {
  const files: DirectGodotProjectShellFilePlan[] = [
    retainedIndex(projectName, toolchain),
    ...TEMPLATE_SHELL.map((targetPath): DirectGodotProjectShellFilePlan => ({
      kind: 'bytes',
      targetPath,
      bytes: frozenTemplateArtifact(toolchain, targetPath).bytes,
      sourcePaths: ['project.godot'],
    })),
    {
      kind: 'bytes',
      targetPath: 'tsconfig.json',
      bytes: Buffer.from(plannedTsconfig(toolchain)),
      sourcePaths: ['project.godot'],
    },
    {
      kind: 'bytes',
      targetPath: 'vgai.adapter.ts',
      bytes: Buffer.from(plannedAdapterModule(toolchain)),
      sourcePaths: ['project.godot'],
    },
    {
      kind: 'bytes',
      targetPath: 'public/.gitkeep',
      bytes: Buffer.alloc(0),
      sourcePaths: ['project.godot'],
    },
  ];
  return files.sort((left, right) => left.targetPath.localeCompare(right.targetPath));
}
