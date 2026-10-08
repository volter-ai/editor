import path from 'node:path';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import { manifestEntryModulesPlugin } from './manifest-entry-modules-plugin';
import manifest from './volter.project.json';

/** A Volter runtime package served as SOURCE, the way the editor serves it. */
const packageSource = (name: string) =>
  path.join(path.dirname(createRequire(import.meta.url).resolve(`${name}/package.json`)), 'src');

/**
 * The game's build holds the game. A project's `editor/` folder (its adapter, contributions and
 * tools) extends the editor and runs inside it, under the editor packages' licenses; none of it
 * may be bundled into what the game ships. A module from that folder reaching this build fails it,
 * naming the file that imported it.
 */
function editorBoundaryPlugin(): Plugin {
  const editorDir = `${path.resolve(import.meta.dirname, 'editor')}${path.sep}`;
  const fold = (file: string) => (process.platform === 'win32' ? file.toLowerCase() : file);
  return {
    name: 'volter-editor-boundary',
    apply: 'build',
    enforce: 'pre',
    load(id) {
      const file = path.resolve(id.split('?')[0]!);
      if (!fold(file).startsWith(fold(editorDir))) return null;
      const importers = this.getModuleInfo(id)?.importers ?? [];
      this.error(
        `${path.relative(import.meta.dirname, file)} is in this project's editor/ folder and may not be part of the game's build. ` +
          (importers.length > 0
            ? `It is imported by ${importers.map((importer) => path.relative(import.meta.dirname, importer.split('?')[0]!)).join(', ')}.`
            : 'It is an entry of this build.'),
      );
    },
  };
}

export default defineConfig({
  plugins: [manifestEntryModulesPlugin(manifest), editorBoundaryPlugin()],
  resolve: {
    alias: {
      '@volter/project': packageSource('@volter/project'),
      '@volter/threejs-runtime': packageSource('@volter/threejs-runtime'),
      '@volter/game-runtime': packageSource('@volter/game-runtime'),
    },
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'],
  },
  optimizeDeps: {
    include: [
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-dom/client',
      '@react-three/fiber',
      '@react-three/drei',
    ],
  },
  server: {
    port: 5180,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2304,
  },
});
