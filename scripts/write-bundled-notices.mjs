// Trigger: after a release build, preserve the license/notice text of bundled
// modules. Inputs are build-produced module lists/metafiles, never a dependency
// manifest guessed to represent what survived bundling. See release/NOTICES.md.
import {existsSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd();
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// Bundled releases that ship no license text, by `name@version`, and the
// pinned upstream text (release/licenses/sources.json) each one carries.
const fallbacks={
  '@dimforge/rapier3d-compat@0.19.2':'rapier3d', '@pixi/colord@2.9.6':'colord',
  '@react-three/fiber@9.7.0':'fiber', '@react-three/rapier@2.2.0':'react-three-rapier',
  '@storybook/react@10.6.0':'storybook', '@storybook/react-dom-shim@10.6.0':'storybook', 'storybook@10.6.0':'storybook',
  'rrweb@2.1.6':'rrweb', '@volter-ai-dev/supercode-ui@0.1.83':'supercode',
  'draco3d@1.5.7':'draco', 'maath@0.10.8':'maath', 'stats-gl@2.4.2':'stats-gl',
  '@volter-ai-dev/supercode-frontend@0.2.3':'supercode-frontend',
};
const fallbackSources=new Map(read('release/licenses/sources.json').map(s=>[s.name,s]));
// `node scripts/write-bundled-notices.mjs [list]`, default release/modeling.json:
// the listed packages whose shipped files bundle code, from the inputs
// build-release-packages.mjs recorded for the same list.
const list=process.argv[2]??'release/modeling.json';
const release=new Set(read(list).packages);
const metafileInputs=(meta,folder)=>Object.values(read(`.artifacts/${meta}`).outputs)
  .flatMap(output=>Object.entries(output.inputs).filter(([,info])=>info.bytesInOutput>0).map(([file])=>resolve(`packages/${folder}`,file)));
const sourceMapInputs=dir=>readdirSync(dir).filter(f=>f.endsWith('.map'))
  .flatMap(name=>read(join(dir,name)).sources.map(source=>resolve(dir,source)));
const bundles={
  editor:()=>[...read('.artifacts/product-bundle-inputs.json'),...metafileInputs('node-bundle-meta.json','editor')],
  'editor-core':()=>[...metafileInputs('server-bundle-meta.json','editor-core'),
    ...sourceMapInputs('packages/editor-core/dist/build'),...sourceMapInputs('packages/editor-core/dist/server')],
  'editor-live':()=>sourceMapInputs('packages/editor-live/dist'),
  'game-live':()=>sourceMapInputs('packages/game-live/dist'),
  'game-editor':()=>[...read('.artifacts/game-editor-bundle-inputs.json'),...metafileInputs('game-editor-node-bundle-meta.json','game-editor')],
};
const groups=Object.fromEntries(Object.entries(bundles).filter(([owner])=>release.has(`@volter/${owner}`))
  .map(([owner,inputs])=>[owner,inputs()]));
const inventory={},outputs=[],missing=[];
for(const [owner,files] of Object.entries(groups)){
  const dependencies=new Map();
  for(let file of files){
    if(file.startsWith('\0'))continue;
    file=file.split('?')[0];
    if(!file.startsWith(root+'/'))continue;
    let dir=dirname(file);
    while(dir!==root && dir!==dirname(dir)){
      const manifestPath=join(dir,'package.json');
      // A nameless package.json (`{"type":"module"}` beside an ESM build) is
      // not the package: keep walking to the one that names it.
      const manifest=existsSync(manifestPath)?read(manifestPath):undefined;
      if(manifest?.name){
        if(manifest.name!==`@volter/${owner}`)
          dependencies.set(`${manifest.name}@${manifest.version}`,{manifest,dir});
        break;
      }
      dir=dirname(dir);
    }
  }
  const records=[];
  const sections=['Bundled license notices','======================',
    'These notices accompany code incorporated into this package. Separate npm dependencies retain their own licenses.',''];
  for(const [id,{manifest,dir}] of [...dependencies].sort(([a],[b])=>a.localeCompare(b))){
    const paths=readdirSync(dir).filter(name=>/^(licen[cs]e|copying|notice|copyright)(?:\.|-|$)/i.test(name) && statSync(join(dir,name)).isFile());
    const notices=[];
    let fallback;
    if(!paths.length){
      fallback=fallbackSources.get(fallbacks[id]);
      if(!fallback){missing.push(`${owner}: ${id}`);continue;}
      const file=`release/licenses/${fallback.name}.txt`,bytes=readFileSync(file);
      if(sha(bytes)!==fallback.sha256)throw new Error(`Changed pinned notice: ${file}`);
      notices.push({file,bytes,source:[`https://github.com/${fallback.repository}/blob/${fallback.revision}/${fallback.path}`,
        ...(fallback.url?[fallback.url]:[])].join(' ; ')});
    }else for(const name of paths)notices.push({file:relative(root,join(dir,name)),bytes:readFileSync(join(dir,name))});
    // Where the bundled code's source is — MPL-2.0 requires saying so, and it
    // is the same answer for every license: the unmodified published package.
    const repository=typeof manifest.repository==='string'?manifest.repository:manifest.repository?.url;
    const source=`Source: the unmodified npm package ${id}${repository?`, from ${String(repository).replace(/^git\+/,'')}`:''}`;
    sections.push(`\n${id}`,`Declared license: ${manifest.license ?? 'See the upstream license text below.'}`,source);
    for(const notice of notices)sections.push(`\n--- ${notice.source ?? notice.file} ---\n`,notice.bytes.toString('utf8'));
    records.push({name:manifest.name,version:manifest.version,license:manifest.license ?? null,
      notices:notices.map(({file,bytes,source})=>({file,sha256:sha(bytes),...(source?{source}:{})}))});
  }
  // A bundle of only its own package's modules has nothing to notice; the
  // inventory's empty record says so.
  if(records.length)outputs.push([`packages/${owner}/BUNDLED_NOTICES`,sections.join('\n')+'\n']);
  inventory[owner]=records;
  console.log(`${owner}: ${records.length} bundled dependency notices`);
}
if(missing.length)throw new Error(`No license text; inspect the pinned upstream source before adding a fallback:\n${missing.join('\n')}`);
for(const [file,text] of outputs)writeFileSync(file,text);
const name=list.replace(/^release\/|\.json$/g,'');
writeFileSync(`provenance/${name==='modeling'?'':`${name}-`}bundled-notices.json`,JSON.stringify(inventory,null,2)+'\n');
