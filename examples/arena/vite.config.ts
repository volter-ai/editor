import path from 'node:path';
import { createRequire } from 'node:module';
import { defineConfig } from 'vite';
import { manifestEntryModulesPlugin } from './manifest-entry-modules-plugin';
import manifest from './vgai.project.json';

/** A vgai runtime package served as SOURCE, the way the editor serves it. */
const packageSource = (name: string) =>
  path.join(path.dirname(createRequire(import.meta.url).resolve(`${name}/package.json`)), 'src');

export default defineConfig({
  plugins: [manifestEntryModulesPlugin(manifest)],
  resolve: {
    alias: {
      '@volter/editor-project': packageSource('@volter/editor-project'),
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
