import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const stubs = {
  'react/jsx-runtime': 'export const jsx = () => null, jsxs = () => null;',
  react: 'export const useSyncExternalStore = () => {};',
  '@volter/sdk/widgets': 'export const themeVars = {};',
  '@volter/sdk/kit/asset-selection': 'export const setSelectedAsset = asset => probe.selected.push(asset);',
  '@volter/sdk/kit/asset-capabilities': 'export const assetCapabilities = () => ({kind: "model"});',
  '@volter/sdk/kit/document-context-registry': 'export const awaitAnnouncedObject3DDocumentSession = () => {}, waitForContributedDocumentMount = () => {};',
  '@volter/sdk/kit/document-open-registry': 'export const registerDocumentOpener = () => {};',
  '@volter/sdk/kit/project-adapter': `export const projectAdapterFacet = () => probe.facet;
    export const subscribeProjectAdapter = fn => {probe.listeners.add(fn); return () => probe.listeners.delete(fn);};`,
  '@volter/sdk/kit/tool-loader': `export const documentContributionForKind = kind => kind === 'model' ? {file: 'model-tool'} : undefined;
    export const getGlobalToolContributions = () => [], subscribeToolContributions = () => () => {};`,
  '@volter/sdk/kit/wait-until': 'export const waitUntil = () => {};',
  '@volter/sdk/kit/active-project': 'export const getCurrentProject = () => "project";',
  '@volter/sdk/kit/workspace-document-registry': `export const openWorkspaceDocuments = () => probe.open;
    export const openWorkspaceDocument = (descriptor, options) => {probe.opened.push({descriptor, options}); probe.open.push({descriptor});};`,
  '@volter/sdk/kit/workspace-document-restore': 'export const registerWorkspaceDocumentRestorer = restorer => {probe.restorer = restorer;};',
  '@volter/sdk/kit/components/asset-documents': 'export const openAssetDocument = () => {};',
  '@volter/sdk/kit/components/ToolHost': 'export const ToolHost = () => null;',
};
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../../sdk/src/kit/components/kind-documents.tsx', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  plugins: [{name: 'discovery-boundaries', setup(build) {
    build.onResolve({filter: /.*/}, args => args.kind === 'entry-point' ? undefined : {path: args.path, namespace: 'stub'});
    build.onLoad({filter: /.*/, namespace: 'stub'}, args => ({contents: stubs[args.path]}));
  }}],
});
const entry = name => ({id: `model:src/models/${name}.blend`, kind: 'model', label: name, source: {path: `src/models/${name}.blend`}});
function fixture(open = []) {
  const track = entry('track');
  const probe = {facet: {scenes: {entries: [track], default: track.id}, documentsPending: false},
    open, opened: [], selected: [], listeners: new Set()};
  const module = {exports: {}};
  runInNewContext(bundle.outputFiles[0].text, {module, exports: module.exports, probe});
  probe.restorer.beginRestore({hasDocumentsToRestore: true, documentsToRestore: [{kind: 'asset'}]});
  const add = name => {probe.facet.scenes.entries.push(entry(name)); for (const fn of [...probe.listeners]) fn();};
  return {probe, add, api: module.exports};
}

test('adding a model preserves the open document and selection, while explicit open still works', () => {
  const f = fixture([{descriptor: {id: 'document:model:src/models/track.blend'}}]);
  f.add('second');
  assert.equal(f.probe.opened.length, 0);
  assert.equal(f.probe.selected.length, 0);
  assert.equal(f.api.openKindDocument(entry('second')), true);
  assert.equal(f.probe.opened[0].descriptor.id, 'document:model:src/models/second.blend');
});

test('discovery can still fill an empty workspace containing only layout areas', () => {
  const f = fixture([{descriptor: {id: 'timeline', area: true}}]);
  f.add('second');
  assert.equal(f.probe.opened.length, 1);
  assert.equal(f.probe.opened[0].descriptor.id, 'document:model:src/models/second.blend');
  f.add('third');
  assert.equal(f.probe.opened.length, 1, 'later discovery does not replace the document it just opened');
});

test('a discovery skipped while another document is open is not replayed on later table refresh', () => {
  const f = fixture([{descriptor: {id: 'track'}}]);
  f.add('second');
  f.probe.open = [];
  for (const fn of [...f.probe.listeners]) fn();
  assert.equal(f.probe.opened.length, 0);
});
