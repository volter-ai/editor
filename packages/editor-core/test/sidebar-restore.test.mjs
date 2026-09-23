import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../workbench/src/vgaiSidebarRestore.ts',import.meta.url),'utf8');
function harness({saved='model',visible=true,exists=true,location=0,active=true}={}) {
  let Contribution,restore;
  const opened=[],errors=[];
  const decorator=()=>{};
  const imports={onUnexpectedError:error=>errors.push(error),IStorageService:decorator,StorageScope:{WORKSPACE:1},
    SidebarPart:{activeViewletSettingsKey:'native-sidebar-key'},IWorkbenchContribution:undefined,
    registerWorkbenchContribution2:(_id,ctor,phase)=>{assert.equal(phase,1);Contribution=ctor;},WorkbenchPhase:{BlockStartup:1},
    IViewDescriptorService:decorator,IViewsService:decorator,ViewContainerLocation:{Sidebar:0},
    IWorkbenchLayoutService:decorator,Parts:{SIDEBAR_PART:'sidebar'}};
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,experimentalDecorators:true}}).outputText;
  vm.runInNewContext(js,{exports:{},require:()=>imports});
  const layout={whenRestored:new Promise(resolve=>restore=resolve),isVisible:part=>{assert.equal(part,'sidebar');return visible;}};
  new Contribution({get:(key,scope)=>{assert.equal(key,'native-sidebar-key');assert.equal(scope,1);return saved;}},layout,
    {getViewContainerById:id=>exists?{id}:null,getViewContainerLocation:()=>location,
      getViewContainerModel:()=>({activeViewDescriptors:active?[{}]:[]})},
    {openViewContainer:async(id,focus)=>opened.push({id,focus})});
  return {opened,errors,async finish(){restore();await layout.whenRestored;await Promise.resolve();}};
}
test('native saved sidebar is captured before startup overwrites it, and reopened without focus',async()=>{
  const h=harness();assert.deepEqual(h.opened,[]);await h.finish();
  assert.deepEqual(h.opened,[{id:'model',focus:false}]);assert.deepEqual(h.errors,[]);
});
test('a saved non-product sidebar is equally restored',async()=>{
  const h=harness({saved:'source-control'});await h.finish();assert.equal(h.opened[0].id,'source-control');
});
test('a new workspace does not acquire an invented sidebar choice',async()=>{
  const h=harness({saved:null});await h.finish();assert.deepEqual(h.opened,[]);
});
test('hidden, moved, missing and empty containers are not forced open',async()=>{
  for(const options of [{visible:false},{location:1},{exists:false},{active:false}]){
    const h=harness(options);await h.finish();assert.deepEqual(h.opened,[]);
  }
});
