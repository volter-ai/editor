/**
 * A `{ module }` root: the project's OWN adapter module is the mechanism.
 *
 * The editor imports the game folder's declared module (path-guarded before,
 * shape-checked after — both loud, named failures, never a silent `undefined`
 * or a crash deep inside `mount`), then wraps its `mount` so that what the
 * editor actually REACHES is measured off the real mounted surface and every
 * capability short of a native root's is warned about by name.
 */

import {
  type ProjectMountEpoch,
  projectEntryImportUrl,
} from '@vgai/editor-sdk/session/project-module-url';
import { relativePathRejection } from '@vgai/editor-sdk/session/relative-path-guard';
import type { RootAdapter, SurfaceAdapter } from '@vgai/project/adapter';
import type { AdapterSurface } from '@vgai/project/adapter/adapter-surface';
import { assertNever } from '@vgai/project/adapter/adapter-surface';
import type { HostContextFor } from '@vgai/project/adapter/host-context';
import type { MountedRootFor } from '@vgai/project/adapter/root-adapter';
import type { ResolvedAdapterRoot } from '@vgai/project/manifest/load';
import { formatCapabilityWarning, measureAdapterReach } from '../adapter-reach';

/**
 * Validate `adapter.module` is a game-folder-RELATIVE path with no `..`
 * escape. The rule itself is `relative-path-guard.ts`'s
 * `relativePathRejection` — the ONE spelling every trust boundary in the
 * editor shares. Only the MESSAGES are local: a manifest author needs to be
 * told which declaration is wrong.
 *
 * Returns the normalized (slash-joined, no leading/trailing slash) path — the
 * one thing the shared predicate does not do, because normalization is not a
 * trust decision.
 */
export function guardModulePath(world: ResolvedAdapterRoot, moduleId: string): string {
  const fail = (reason: string): never => {
    throw new Error(
      `resolveRootBinding: world "${world.id}" declares { module: "${moduleId}" } — ${reason} ` +
        '(the module path must be game-folder-relative, normalized, with no `..` escape).',
    );
  };

  const rejection = relativePathRejection(moduleId);
  if (rejection === 'empty') fail('the module path is empty');
  if (rejection === 'nul') fail('the module path contains a NUL byte');
  if (rejection === 'absolute') fail('the module path is absolute, not game-folder-relative');
  if (rejection === 'traversal') {
    fail('the module path contains a `..` segment and would escape the game folder');
  }
  // POSIX-only beyond the shared rule: a module id reaches Vite as a URL.
  if (moduleId.includes('\\')) fail('the module path contains a backslash (not POSIX-relative)');

  const normalized = moduleId
    .split('/')
    .filter((seg) => seg.length > 0 && seg !== '.')
    .join('/');
  if (normalized === '') fail('the module path resolves to nothing (empty after normalization)');

  return normalized;
}

/**
 * Runtime shape every `RootAdapter` must satisfy — the module branch cannot
 * trust TypeScript alone (the imported value is `unknown` until checked).
 *
 * Parameterized by surface: the checked SHAPE is surface-independent
 * (`{ id, mount }` are the same members for every `K`), so the caller passes
 * the world's DECLARED surface and gets a `RootAdapter<K>` back. The surface
 * itself is a manifest CLAIM no structural check can verify — that is exactly
 * what {@link withCapabilityWarning} measures post-mount, against the real
 * mounted root, and what `module-mode.ts` re-checks against the mounted
 * result's own `kind` tag.
 */
function guardModuleShape<K extends AdapterSurface>(
  world: ResolvedAdapterRoot,
  moduleId: string,
  candidate: unknown,
): asserts candidate is RootAdapter<K> {
  const fail = (reason: string): never => {
    throw new Error(
      `resolveRootBinding: world "${world.id}"'s custom adapter module "${moduleId}" ${reason} ` +
        '— a { module } adapter must default-export an object shaped like `RootAdapter`: ' +
        '`{ id: string, mount(host): Promise<MountedThreeRoot> }`.',
    );
  };

  if (candidate === null || typeof candidate !== 'object') {
    fail('has no default export (or it is not an object)');
  }
  const obj = candidate as Record<string, unknown>;
  if (typeof obj['id'] !== 'string' || obj['id'].length === 0) {
    fail('default-exports an object with no non-empty string `id`');
  }
  if (typeof obj['mount'] !== 'function') {
    fail('default-exports an object with no `mount` function');
  }
}

/** How a `{ module }` world reaches the editor: the project's own adapter
 *  module IS the mechanism, so anything missing is missing from that module. */
const MODULE_ADAPTER_MECHANISM =
  'this world mounts through the project’s own adapter module, so every capability the editor ' +
  'has here is one that module hands it';

/**
 * Wrap a custom adapter's `mount` so that, once it resolves, what the editor
 * actually REACHES is measured off the real mounted surface. There is nothing
 * to compare against and nothing to declare: the bar is a native root, and a
 * gap keeps warning until it is closed. The warning never blocks the mount.
 *
 * The `editorConsole.warn(...)` call is a LAZY dynamic import: this resolver is
 * imported by headless Node/vitest suites with no `window`, and
 * `editor-console.ts`'s module top level touches `window` unconditionally.
 */
function withCapabilityWarning<K extends AdapterSurface>(
  world: ResolvedAdapterRoot,
  adapter: RootAdapter<K>,
): RootAdapter<K> {
  return {
    id: adapter.id,
    async mount(host: HostContextFor<K>): Promise<MountedRootFor<K>> {
      const mounted = await adapter.mount(host);
      const warning = formatCapabilityWarning(
        world.id,
        measureAdapterReach(mounted),
        MODULE_ADAPTER_MECHANISM,
        // The MOUNT's own surface, so a provider this surface cannot have (a
        // DOM root's 3D `transforms`) is not warned about forever. Read off
        // `mounted`, not `world`, for the same reason the reach beside it is:
        // this is what actually mounted, not what was declared.
        mounted.kind,
      );
      if (warning) {
        const { editorConsole } = await import('../editor-console');
        editorConsole.warn(warning, 'adapter');
      }
      return mounted;
    },
  };
}

/**
 * Resolve a `{ module }` adapter world: import the game folder's declared
 * module through the same project-import route every other root entry takes
 * (so it inherits the root `vite.config.ts`'s `resolve.dedupe: ['three',
 * 'pixi.js']` collapse), guard it, and tag it with the manifest's declared
 * surface.
 *
 * The module is imported through `projectEntryImportUrl` (`/@fs/`, mount-epoch
 * cache-busted), like every other project module.
 *
 * Returns the module's own namespace beside the tagged adapter: for a
 * `{ module }` root THAT namespace is the root's static surface — the project
 * declared this module as the root's mechanism — and it becomes the
 * declaration's `entry` (see `binding-resolver.ts`).
 */
export async function resolveModuleAdapter(
  world: ResolvedAdapterRoot,
  projectRoot: string,
  epoch: ProjectMountEpoch,
): Promise<{ readonly resolved: SurfaceAdapter; readonly module: Record<string, unknown> }> {
  const { adapter } = world;
  if (adapter.type !== 'module') {
    throw new Error(`resolveModuleAdapter: world "${world.id}" is not a { module } world.`);
  }

  const normalizedPath = guardModulePath(world, adapter.module);
  // A `{ module }` root is project-owned code that can share modules with its
  // sibling roots, so it takes the same mount epoch they do.
  const modulePath = projectEntryImportUrl(projectRoot, normalizedPath, epoch);
  const mod = (await import(/* @vite-ignore */ modulePath)) as Record<string, unknown>;
  const candidate = mod['default'];

  // The manifest's declared surface is the discriminant, so each branch names
  // the module's adapter at ITS OWN surface — `guardModuleShape<K>` performs
  // the identical runtime check in all three, and the result is paired with
  // the tag rather than flattened through a three-shaped channel.
  switch (world.surface) {
    case 'three': {
      guardModuleShape<'three'>(world, adapter.module, candidate);
      return {
        resolved: { surface: 'three', adapter: withCapabilityWarning(world, candidate) },
        module: mod,
      };
    }
    case 'canvas': {
      guardModuleShape<'canvas'>(world, adapter.module, candidate);
      return {
        resolved: { surface: 'canvas', adapter: withCapabilityWarning(world, candidate) },
        module: mod,
      };
    }
    case 'dom': {
      guardModuleShape<'dom'>(world, adapter.module, candidate);
      return {
        resolved: { surface: 'dom', adapter: withCapabilityWarning(world, candidate) },
        module: mod,
      };
    }
    default:
      return assertNever(world.surface, 'resolveModuleAdapter');
  }
}
