// Trigger: after a release build, preserve the license/notice text of bundled
// modules. Inputs are build-produced module lists/metafiles, never a dependency
// manifest guessed to represent what survived bundling. See release/NOTICES.md.
import {existsSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd();
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fallbackNames={
  '@dimforge/rapier3d-compat':'rapier3d', '@pixi/colord':'colord',
  '@react-three/fiber':'fiber', '@react-three/rapier':'react-three-rapier',
  '@storybook/react':'storybook', '@storybook/react-dom-shim':'storybook',
  'storybook':'storybook', 'rrweb':'rrweb', '@volter-ai-dev/supercode-ui':'supercode',
};
const fallbackVersions={'@dimforge/rapier3d-compat':'0.19.2','@pixi/colord':'2.9.6','@react-three/fiber':'9.7.0','@react-three/rapier':'2.2.0','@storybook/react':'9.1.20','@storybook/react-dom-shim':'9.1.20','storybook':'9.1.20','rrweb':'2.1.6','@volter-ai-dev/supercode-ui':'0.1.83'};
const fallbackSources=new Map(read('release/licenses/sources.json').map(s=>[s.name,s]));
const groups={
  editor:[...read('.artifacts/product-bundle-inputs.json'),...Object.values(read('.artifacts/node-bundle-meta.json').outputs).flatMap(output=>Object.entries(output.inputs).filter(([,info])=>info.bytesInOutput>0).map(([file])=>resolve('packages/editor',file)))],
  'editor-core':[], 'editor-live':[],
};
const server=read('.artifacts/server-bundle-meta.json');
for(const output of Object.values(server.outputs))for(const [file,info] of Object.entries(output.inputs))
  if(info.bytesInOutput>0)groups['editor-core'].push(resolve('packages/editor-core',file));
for(const [owner,folder] of [['editor-core','dist/build'],['editor-core','dist/server'],['editor-live','dist']]){
  const dir=`packages/${owner}/${folder}`;
  for(const name of readdirSync(dir).filter(f=>f.endsWith('.map')))
    for(const source of read(join(dir,name)).sources)groups[owner].push(resolve(dir,source));
}
const inventory={};
for(const [owner,files] of Object.entries(groups)){
  const dependencies=new Map();
  for(let file of files){
    if(file.startsWith('\0'))continue;
    file=file.split('?')[0];
    if(!file.startsWith(root+'/'))continue;
    let dir=dirname(file);
    while(dir!==root && dir!==dirname(dir)){
      const manifestPath=join(dir,'package.json');
      if(existsSync(manifestPath)){
        const manifest=read(manifestPath);
        if(manifest.name && manifest.name!==`@volter/${owner}`)
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
      fallback=fallbackSources.get(fallbackNames[manifest.name]);
      if(!fallback || fallbackVersions[manifest.name]!==manifest.version)throw new Error(`${id}: no license text; inspect the pinned upstream source before adding a fallback`);
      const file=`release/licenses/${fallback.name}.txt`,bytes=readFileSync(file);
      if(sha(bytes)!==fallback.sha256)throw new Error(`Changed pinned notice: ${file}`);
      notices.push({file,bytes,source:`https://github.com/${fallback.repository}/blob/${fallback.revision}/${fallback.path}`});
    }else for(const name of paths)notices.push({file:relative(root,join(dir,name)),bytes:readFileSync(join(dir,name))});
    sections.push(`\n${id}`,`Declared license: ${manifest.license ?? 'See the upstream license text below.'}`);
    for(const notice of notices)sections.push(`\n--- ${notice.source ?? notice.file} ---\n`,notice.bytes.toString('utf8'));
    records.push({name:manifest.name,version:manifest.version,license:manifest.license ?? null,
      notices:notices.map(({file,bytes,source})=>({file,sha256:sha(bytes),...(source?{source}:{})}))});
  }
  writeFileSync(`packages/${owner}/BUNDLED_NOTICES`,sections.join('\n')+'\n');
  inventory[owner]=records;
  console.log(`${owner}: ${records.length} bundled dependency notices`);
}
writeFileSync('provenance/bundled-notices.json',JSON.stringify(inventory,null,2)+'\n');
