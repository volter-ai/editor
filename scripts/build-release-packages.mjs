// A release build: `node scripts/build-release-packages.mjs [list] [package...]`, default
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
// runs in its own process, never behind a previous product's build, with the
// heap capped at 4 GB: the box is shared. The game product's bundle measured a
// 5.4 GB peak RSS under an 8 GB cap and ran out of heap behind the modeling
// build at Node's default; whether it completes under this cap is unmeasured.
function product(folder,inputs){
  execFileSync(process.execPath,['--max-old-space-size=4096',fileURLToPath(import.meta.url),'--product',folder,inputs],{stdio:'inherit'});
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
// `[list] [package...]`: naming packages builds only their steps, so a
// release build can run one step per command.
const [list='release/modeling.json',...only]=process.argv.slice(2);
const release=new Set(JSON.parse(readFileSync(list,'utf8')).packages.filter(name=>!only.length||only.includes(name)));
mkdirSync('.artifacts',{recursive:true});
const steps=[
  ['@volter/editor-core',()=>{
    run('@volter/editor-core','build:plugins');
    run('@volter/editor-core','build:session');
    run('@volter/editor-core','build:server','server-bundle-meta.json');
  }],
  ['@volter/editor-live',()=>run('@volter/editor-live','build')],
  ['@volter/game-runtime',()=>run('@volter/game-runtime','build')],
  ['@volter/game-live',()=>run('@volter/game-live','build')],
  ['@volter/editor-threejs',()=>run('@volter/editor-threejs','build')],
  ['@volter/editor-blender',()=>run('@volter/editor-blender','build')],
  ['@volter/editor-react',()=>run('@volter/editor-react','build')],
  ['@volter/editor-xstate',()=>run('@volter/editor-xstate','build')],
  ['@volter/model-editor',()=>{
    run('@volter/model-editor','build:node','node-bundle-meta.json');
    product('model-editor','product-bundle-inputs.json');
  }],
  ['@volter/game-editor',()=>{
    run('@volter/game-editor','build:node','game-editor-node-bundle-meta.json');
    product('game-editor','game-editor-bundle-inputs.json');
  }],
];
for(const [name,step] of steps)if(release.has(name))step();
