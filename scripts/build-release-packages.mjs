// A release build: `node scripts/build-release-packages.mjs [list]`, default
// release/modeling.json. Builds every listed package that ships build output,
// recording actual bundle inputs to .artifacts/ so write-bundled-notices can
// preserve their license texts before npm pack. The game release lists the
// modeling release's packages too, so one table serves both.
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
function run(workspace,script,metafile){
  execFileSync('npm',['run',script,'-w',workspace],{stdio:'inherit',env:{...process.env,
    ...(metafile?{VOLTER_BUILD_METAFILE:resolve('.artifacts',metafile)}:{})}});
}
// A product's browser bundle: the modules that rendered into its chunks. Each
// runs in its own process with a larger heap: the game product's graph does
// not fit Node's default heap, least of all behind a previous product's build.
function product(folder,inputs){
  execFileSync(process.execPath,['--max-old-space-size=8192',fileURLToPath(import.meta.url),'--product',folder,inputs],{stdio:'inherit'});
}
if(process.argv[2]==='--product'){
  const [folder,inputs]=process.argv.slice(3);
  await build({configFile:`packages/${folder}/vite.config.ts`,plugins:[{
    name:'bundled-license-inputs',
    generateBundle(_options,bundle){
      const ids=[...new Set(Object.values(bundle).filter(chunk=>chunk.type==='chunk')
        .flatMap(chunk=>Object.entries(chunk.modules).filter(([,info])=>info.renderedLength>0).map(([id])=>id)))];
      writeFileSync(`.artifacts/${inputs}`,JSON.stringify(ids,null,2));
    },
  }]});
  process.exit(0);
}
const list=process.argv[2]??'release/modeling.json';
const release=new Set(JSON.parse(readFileSync(list,'utf8')).packages);
mkdirSync('.artifacts',{recursive:true});
const steps=[
  ['@volter/editor-core',()=>{
    run('@volter/editor-core','build:plugins');
    run('@volter/editor-core','build:session');
    run('@volter/editor-core','build:server','server-bundle-meta.json');
  }],
  ['@volter/editor-live',()=>run('@volter/editor-live','build')],
  ['@volter/game-runtime',()=>run('@volter/game-runtime','build')],
  ['@volter/editor',()=>{
    run('@volter/editor','build:node','node-bundle-meta.json');
    product('editor','product-bundle-inputs.json');
  }],
  ['@volter/game-editor',()=>{
    run('@volter/game-editor','build:node','game-editor-node-bundle-meta.json');
    product('game-editor','game-editor-bundle-inputs.json');
  }],
];
for(const [name,step] of steps)if(release.has(name))step();
