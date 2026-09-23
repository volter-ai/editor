import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';

const stubs = {
  '../editor-control-socket': `export const ABNORMAL_SOCKET_CLOSE=1006, CONTROL_ECHO_TIMEOUT_MS=1000;
    export const createEditorControlSocket=()=>({close(){}});`,
  '../editor-server': 'export const headerValue=()=>null, noEditorConnectedMessage=()=>"disconnected";',
  '../editor-sse': `export const addClient=()=>{}, clientControlHealthFor=()=>null, clientCount=()=>1,
    clientIdForResponse=()=>"client", closeClient=()=>{}, commandListenerFactsFor=()=>null,
    isClientAlive=()=>true, isEditorSocketClient=()=>false, noteCommandListenerAttached=()=>{},
    noteCommandReceipt=()=>{}, noteCommandRelay=()=>{}, removeClient=()=>{}, updateClientControlHealth=()=>{};
    export const sendToClientHandle=(id,event,command)=>{probe.command=command;return {};};`,
  '../play-stall': `export const playStallDiagnosis=({base})=>({message:base,phase:null,phaseAgeMs:null}),
    playStallConsoleMessage=()=>"timeout", acceptPagePhase=(_,next)=>next;`,
  '../server-utils': `export {relayCommandTimeoutMs} from '@volter/editor-sdk/session/command-table';
    export const CONTROLLER_DISCONNECTED_MESSAGE="disconnected", DESKTOP_FRAME_ORIGIN="",
      RELAY_DELIVERY_ACK_MS=8000, RELAY_DELIVERY_MAX_WAIT_MS=45000,
      commandListenerHealth=()=>null, isAllowedEditorOrigin=()=>true, unacknowledgedCommandMessage=()=>"no receipt";
    import {relayCommandTimeoutMs} from '@volter/editor-sdk/session/command-table';
    export const relayCommandAckDeadlineMs=type=>relayCommandTimeoutMs(type)>8000?8000:null;`,
  '../session-registry': 'export const processSessionId="test-session";',
  '../tab-presence': 'export const tabAbsenceMessage=()=>"absent", tabUnresponsiveMessage=()=>"unresponsive", tabWaitingMessage=()=>"present";',
};
const bundle = await build({
  entryPoints:[fileURLToPath(new URL('../server/routes/control-plane.ts',import.meta.url))],
  bundle:true, platform:'node', format:'cjs', write:false,
  plugins:[{name:'transport-boundaries',setup(build){
    build.onResolve({filter:/^\.\.\//},args=>stubs[args.path] ? {path:args.path,namespace:'stub'} : undefined);
    build.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],resolveDir:fileURLToPath(new URL('..',import.meta.url))}));
  }}],
});

function harness() {
  let now=0, nextTimer=0;
  const timers=new Map(), probe={}, outcomes=[];
  const module={exports:{}};
  runInNewContext(bundle.outputFiles[0].text,{
    module,exports:module.exports,require:createRequire(import.meta.url),probe,
    Date:class extends Date {static now(){return now;}},
    setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,at:now+delay});return id;},
    clearTimeout(id){timers.delete(id);},
  });
  const tab={epochCount:1,epochs:[]};
  const api=module.exports.createControlPlane({get(){}},{
    clientIdsForTab:()=>['client'],onTabReloaded(){},options:{},short:s=>s,
    journalEvent(){},consoleLedger:{observe(){}},participantConnections:new Map(),
    participantTabLifecycles:new Map(),
    hostTabLifecycle:{blessedTabId:()=> 'tab',tab:()=>tab,onCommandOutcome:(_,outcome)=>outcomes.push(outcome)},
  });
  return {api,probe,outcomes,advance(ms){const end=now+ms;for(;;){const due=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();}now=end;}};
}

test('an early package command adopts its discovered budget without expiring at five seconds',async()=>{
  const h=harness();let settled=false;
  const result=h.api.relayCommand({type:'package-start'}).then(value=>{settled=true;return value;});
  h.api.handleCommandReceived({_requestId:h.probe.command._requestId});
  h.advance(6000);await Promise.resolve();assert.equal(settled,false);
  h.api.handleContributedCommands({commands:[{type:'package-start',timeoutMs:120000}]});
  h.advance(44000);await Promise.resolve();assert.equal(settled,false);
  // Repeated discovery must not grant a new 120 seconds.
  h.api.handleContributedCommands({commands:[{type:'package-start',timeoutMs:120000}]});
  h.advance(69999);await Promise.resolve();assert.equal(settled,false);
  h.advance(1);assert.equal((await result).result.timedOut,true);
});

test('native command budgets remain unchanged; undiscovered package commands stay bounded',async()=>{
  for(const [type,budget] of [['select-multiple',5000],['missing-package-command',45000]]){
    const h=harness();let settled=false;
    const result=h.api.relayCommand({type}).then(value=>{settled=true;return value;});
    h.api.handleCommandReceived({_requestId:h.probe.command._requestId});
    h.advance(budget-1);await Promise.resolve();assert.equal(settled,false);
    h.advance(1);assert.equal((await result).result.timedOut,true);
  }
});
