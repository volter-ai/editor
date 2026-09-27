// `node --import` entry: registers the `?url` asset hook (node-assets.ts).
import { registerHooks } from 'node:module';
import { resolve } from './node-asset-loader.mjs';

registerHooks({ resolve });
