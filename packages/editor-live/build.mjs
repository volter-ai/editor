import {build} from 'esbuild';
await build({entryPoints:['src/index.ts'],outfile:'dist/index.js',bundle:true,platform:'node',target:'node22',format:'esm',external:['undici'],sourcemap:true});
