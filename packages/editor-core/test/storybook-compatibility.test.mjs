import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// Resolve from the consumer package, including a nested installation. Exercise
// the real upstream API: an audit-clean major bump still has to compose stories.
const require = createRequire(new URL('../package.json', import.meta.url));
const {composeStories, setProjectAnnotations} = await import(pathToFileURL(require.resolve('@storybook/react')));
const {createElement} = await import(pathToFileURL(require.resolve('react')));
const {renderToStaticMarkup} = await import(pathToFileURL(require.resolve('react-dom/server')));
const {sortStoriesV7} = await import(pathToFileURL(require.resolve('storybook/internal/preview-api')));

test('upgraded portable stories retain args, decorators and loaded context', async () => {
  setProjectAnnotations({decorators: [(Story) => createElement('section', null, createElement(Story))]});
  const {Primary} = composeStories({
    default: {title: 'Review/Button', args: {label: 'default'},
      render: (args, context) => createElement('button', null, args.label + context.loaded.suffix)},
    Primary: {args: {label: 'ready'}, loaders: [async () => ({suffix: '!'})]},
  });
  await Primary.load();
  assert.equal(Primary.id, 'review-button--primary');
  assert.equal(renderToStaticMarkup(createElement(Primary)), '<section><button>ready!</button></section>');
});

test('upgraded native story ordering accepts the current index shape', () => {
  const entries = ['Zulu', 'Alpha'].map(name => ({type: 'story', subtype: 'story',
    id: name.toLowerCase(), title: 'Review/' + name, name: 'Primary', importPath: './' + name + '.stories.ts', tags: []}));
  assert.deepEqual(sortStoriesV7(entries, {method: 'alphabetical'}, entries.map(e => e.importPath)).map(e => e.id), ['alpha', 'zulu']);
});

test('editor grouping retains explicit and automatic Storybook titles', async () => {
  const result = await build({entryPoints: [fileURLToPath(new URL('../src/stories/story-grouping.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false});
  const {deriveStoryGroupPath} = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64'));
  assert.deepEqual(deriveStoryGroupPath({modulePath: 'src/ui/Button.stories.tsx', title: 'Controls/Button'}),
    {segments: ['Controls'], leaf: 'Button'});
  assert.deepEqual(deriveStoryGroupPath({modulePath: 'src/ui/Button.stories.tsx'}),
    {segments: ['ui'], leaf: 'Button'});
});
