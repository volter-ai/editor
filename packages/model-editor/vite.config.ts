import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { productContributionsPlugin } from '@volter/editor-core/build/product-contributions';
import { sharedReactBuildPlugin } from '@volter/editor-core/build/shared-react';
import { sharedThreeBuildPlugin } from '@volter/editor-core/build/shared-three';

const root = fileURLToPath(new URL('../..', import.meta.url));
export default defineConfig({
  root,
  resolve: {
    alias: { '@editor': fileURLToPath(new URL('../editor-core/src', import.meta.url)) },
    dedupe: ['react', 'react-dom', 'three', '@volter/editor-sdk', '@volter/editor-project'],
  },
  plugins: [productContributionsPlugin(), sharedReactBuildPlugin(root), sharedThreeBuildPlugin(root)],
  worker: { format: 'es' },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    manifest: true,
    target: 'es2022',
    rollupOptions: {
      input: { product: fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
      preserveEntrySignatures: 'strict',
    },
  },
});
