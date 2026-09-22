// The modeling release build. Record actual bundle inputs while building, so
// write-bundled-notices can preserve their license texts before npm pack.
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {build} from 'vite';
mkdirSync('.artifacts',{recursive:true});
function run(workspace,script,metafile){
  execFileSync('npm',['run',script,'-w',workspace],{stdio:'inherit',env:{...process.env,
    ...(metafile?{VOLTER_BUILD_METAFILE:resolve('.artifacts',metafile)}:{})}});
}
run('@volter/editor-core','build:plugins');
run('@volter/editor-core','build:session');
run('@volter/editor-core','build:server','server-bundle-meta.json');
run('@volter/editor-live','build');
run('@volter/editor','build:node','node-bundle-meta.json');
await build({configFile:'packages/editor/vite.config.ts',plugins:[{
  name:'bundled-license-inputs',
  generateBundle(_options,bundle){
    const inputs=[...new Set(Object.values(bundle).filter(chunk=>chunk.type==='chunk')
      .flatMap(chunk=>Object.entries(chunk.modules).filter(([,info])=>info.renderedLength>0).map(([id])=>id)))];
    writeFileSync('.artifacts/product-bundle-inputs.json',JSON.stringify(inputs,null,2));
  },
}]});
