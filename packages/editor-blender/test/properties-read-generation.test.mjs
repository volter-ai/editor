import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';

const bundle=await build({
  entryPoints:[fileURLToPath(new URL('../contributions/blender-properties-model.ts',import.meta.url))],
  bundle:true,platform:'node',format:'cjs',write:false,
  plugins:[{name:'engine-boundaries',setup(build){
    build.onResolve({filter:/.*/},args=>args.kind==='entry-point'?undefined:{path:args.path,namespace:'stub'});
    build.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='@volter/editor-sdk/host'
      ? 'export const editorHost=()=>({documents:{context:()=>null,contextChanged(){}}});'
      : args.path==='./blender-outliner-model'
        ? 'export const blenderOutlinerState=()=>({byId:new Map()});'
        : `export const blenderPresentationDocumentId=()=>"model", blenderSessionStarted=()=>true,
            blenderRna=path=>probe.rna(path), blenderRnaContext=object=>probe.context(object),
            blenderRnaSet=()=>{}, noteBlenderRnaChanged=()=>{}, subscribeBlenderRna=fn=>{probe.moved=fn;};`}));
  }}],
});
const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
function gate(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function model(probe){const module={exports:{}};runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,probe,setTimeout,Error});return module.exports;}

for(const outcome of ['failure','success'])test(`a late RNA ${outcome} cannot overwrite a newer model revision`,async()=>{
  const old=gate(),fresh=gate();let reads=0;
  const probe={context:async()=>({tabs:[]}),rna:()=>++reads===1?old.promise:fresh.promise};
  const api=model(probe),path='bpy.data.objects["Cube"]';
  api.showBlenderSubject({kind:'object',name:'Cube'});await turn();
  api.blenderRnaViewFor(path);
  probe.moved();await turn();
  api.blenderRnaViewFor(path);assert.equal(reads,2);
  if(outcome==='failure')old.reject(Error('deleted object'));else old.resolve({revision:'stale'});
  await turn();
  assert.equal(api.blenderPropertiesState().error,null);
  assert.equal(api.blenderRnaViewFor(path),undefined);assert.equal(reads,2);
  fresh.resolve({revision:'current'});await turn();
  assert.equal(api.blenderRnaViewFor(path).revision,'current');
});

test('selection changes discard old RNA errors and A-B-A context results',async()=>{
  const contexts=[],oldView=gate();
  const probe={context:()=>{const pending=gate();contexts.push(pending);return pending.promise;},rna:()=>oldView.promise};
  const api=model(probe);
  api.showBlenderSubject({kind:'object',name:'A'});await turn();
  api.blenderRnaViewFor('A');
  api.showBlenderSubject({kind:'object',name:'B'});await turn();
  api.showBlenderSubject({kind:'object',name:'A'});await turn();
  contexts[0].resolve({revision:'old A'});oldView.reject(Error('deleted A'));
  await turn();assert.equal(api.blenderPropertiesState().context,null);assert.equal(api.blenderPropertiesState().error,null);
  contexts[2].resolve({revision:'new A'});await turn();
  contexts[1].reject(Error('old B'));await turn();
  assert.equal(api.blenderPropertiesState().context.revision,'new A');
  assert.equal(api.blenderPropertiesState().error,null);
});

test('a new subject never displays the previous subject context while loading',async()=>{
  const next=gate();
  const api=model({context:object=>object==='A'?Promise.resolve({object:'A'}):next.promise});
  api.showBlenderSubject({kind:'object',name:'A'});await turn();
  assert.equal(api.blenderPropertiesState().context.object,'A');
  api.showBlenderSubject({kind:'object',name:'B'});await turn();
  assert.equal(api.blenderPropertiesState().object,'B');
  assert.equal(api.blenderPropertiesState().context,null);
  assert.equal(api.blenderPropertiesState().loading,true);
  next.resolve({object:'B'});await turn();
  assert.equal(api.blenderPropertiesState().context.object,'B');
});
