import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/play-boot-phase.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
test('overlapping equal labels cannot clear newer work; ending child restores parent',()=>{
  api.__resetPlayBootPhaseForTest();
  const parent=api.beginPageWork('worker execute',10);
  const first=api.beginPageWork('presenting frame',20);
  const second=api.beginPageWork('presenting frame',30);
  first();
  assert.equal(api.currentPlayBootPhase().at,30);
  second();
  assert.equal(api.currentPlayBootPhase().phase,'worker execute');
  assert.equal(api.currentPlayBootPhase().at,10);
  first();second();
  assert.equal(api.currentPlayBootPhase().phase,'worker execute');
  parent();assert.equal(api.currentPlayBootPhase().phase,null);
});
test('play changes survive overlapping document work and failed reporters',()=>{
  api.__resetPlayBootPhaseForTest();
  api.beginPlayBoot(1);
  api.markPlayBootPhase('opening the Game document',2);
  const done=api.beginPageWork('applying model frame',3);
  api.setPlayBootPhaseReporter(()=>{throw Error('report transport failed');});
  api.endPlayBoot(4);
  assert.equal(api.currentPlayBootPhase().phase,'applying model frame');
  done();assert.equal(api.currentPlayBootPhase().phase,null);
  assert.equal(api.currentPlayBootPhase().at,4);
});
test('operation is reported before work, labels are bounded, reset drops outstanding tokens',()=>{
  api.__resetPlayBootPhaseForTest();
  const reports=[];
  api.setPlayBootPhaseReporter(state=>reports.push(state.phase));
  assert.equal(reports.shift(),null);
  const done=api.beginPageWork('x'.repeat(1000));
  assert.equal(reports[0].length,160);
  api.__resetPlayBootPhaseForTest();
  const fresh=api.beginPageWork('fresh');
  api.setPlayBootPhaseReporter(state=>reports.push(state.phase));
  assert.equal(reports.at(-1),'fresh');
  done();assert.equal(api.currentPlayBootPhase().phase,'fresh');
  fresh();assert.equal(api.currentPlayBootPhase().phase,null);
});

const server=await build({entryPoints:[fileURLToPath(new URL('../server/play-stall.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {acceptPagePhase,playStallDiagnosis}=await import('data:text/javascript;base64,'+Buffer.from(server.outputFiles[0].contents).toString('base64'));
test('delayed heartbeat cannot resurrect completed work or reset its age',()=>{
  const done={source:'page-a',sequence:3,phase:null,at:100,run:0,receivedAt:200};
  const late={...done,sequence:2,phase:'applying frame',receivedAt:300};
  assert.equal(acceptPagePhase(done,late),done);
  assert.equal(acceptPagePhase(done,{...done,receivedAt:400}),done);
  const reload={...late,source:'page-b',sequence:1};
  assert.equal(acceptPagePhase(done,reload),reload);
  const report=playStallDiagnosis({command:'blender-stop',base:'timeout',phase:late,now:1000});
  assert.match(report.message,/not a stack trace/);
  assert.equal(report.phase,'applying frame');
});

const heartbeat=await build({entryPoints:[fileURLToPath(new URL('../server/tab-heartbeat.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {TAB_HEARTBEAT_WORKER_SOURCE}=await import('data:text/javascript;base64,'+Buffer.from(heartbeat.outputFiles[0].contents).toString('base64'));
test('heartbeat carries operation and ordering stamp without another page callback',()=>{
  const frames=[];let tick;
  const self={};
  runInNewContext(TAB_HEARTBEAT_WORKER_SOURCE,{
    self,WebSocket:class {readyState=0;close(){}},
    fetch:(_,request)=>{frames.push(JSON.parse(request.body));return Promise.resolve();},
    setInterval(fn){tick=fn;return 1;},clearInterval(){},setTimeout(){},
  });
  self.onmessage({data:{type:'start',tabId:'tab',epoch:'epoch',socketUrl:'ws://test',postUrl:'http://test'}});
  self.onmessage({data:{type:'phase',phase:'applying frame',source:'page',sequence:7}});
  // The page does nothing further: its thread may now be blocked.
  tick();
  assert.equal(frames.at(-1).phase,'applying frame');
  assert.equal(frames.at(-1).phaseSource,'page');
  assert.equal(frames.at(-1).phaseSequence,7);
  tick();assert(!('phase' in frames.at(-1)),'a repeated heartbeat must not refresh stale work');
});
