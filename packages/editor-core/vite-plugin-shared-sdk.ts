/** One SDK for bundled and project-declared tools. Publish only SDK modules
 * already reached by the composition; packages absent from it stay absent.
 * Each entry is the original module, so Rollup and the browser share its
 * registries, project state and callbacks rather than copying implementations.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const manifestFile = 'volter-shared-sdk.json';
function sdkModule(id: string): string | null {
  const file = id.split('?')[0]!.replaceAll('\\', '/');
  const match = /\/editor-sdk\/src\/(.+)\.[cm]?[jt]sx?$/.exec(file);
  return match?.[1] ?? null;
}

/** Hooks used by the universal composition build plugin, not by a product. */
export function sharedSdkBuildHooks(): Pick<Plugin, 'moduleParsed' | 'generateBundle' | 'outputOptions'> {
  const entries = new Map<string, string>();
  return {
    // Registries have cyclic imports inside the SDK. Keep their initialization
    // in one chunk; publishing entries must not turn those into chunk cycles.
    outputOptions(options) {
      const previous = options.manualChunks;
      return { ...options, manualChunks(id, context) {
        if (sdkModule(id)) return 'volter-sdk';
        if (typeof previous === 'function') return previous(id, context);
        if (previous) return Object.entries(previous).find(([, ids]) => ids.includes(id))?.[0];
        return undefined;
      } };
    },
    moduleParsed(module) {
      const name = sdkModule(module.id);
      if (!name || entries.has(name) || module.exports.length === 0) return;
      entries.set(name, this.emitFile({
        type: 'chunk', id: module.id,
        name: `volter-sdk-${name.replaceAll('/', '-')}`,
        preserveSignature: 'strict',
      }));
    },
    generateBundle() {
      const files = Object.fromEntries([...entries].map(([name, reference]) => [name, this.getFileName(reference)]));
      this.emitFile({ type: 'asset', fileName: manifestFile, source: JSON.stringify(files, null, 2) + '\n' });
    },
  };
}

export function readSharedSdkUrls(dist: string): Record<string, string> | null {
  const file = join(dist, manifestFile);
  if (!existsSync(file)) return null;
  const files = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  return Object.fromEntries(Object.entries(files).map(([name, chunk]) => [name, `/${chunk}`]));
}

/** Resolve both public SDK specifiers and relative imports within the SDK.
 * Unpublished modules remain served source and can import the published ones.
 * Dependency scanning keeps filesystem identities; browser serving uses the
 * exact URLs the bundled editor imports, as the React/Three doors do.
 */
export function sharedSdkPlugin(urls: Record<string, string>): Plugin {
  return {
    name: 'volter-shared-sdk', enforce: 'pre',
    async resolveId(source, importer, options) {
      if ((options as { scan?: boolean }).scan) return;
      if (!source.startsWith('@volter/editor-sdk') && !(source.startsWith('.') && importer && sdkModule(importer))) return;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      const name = resolved && sdkModule(resolved.id);
      return name && urls[name] ? urls[name] : undefined;
    },
  };
}
