import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const built=await build({stdin:{contents:`
  export {Object3DDocumentSession} from './object3d-document-session';
  export {HalfFloatType, PerspectiveCamera} from 'three';`,
  resolveDir:fileURLToPath(new URL('../src/kit/authoring/',import.meta.url)),loader:'ts'},
  bundle:true,platform:'node',format:'esm',write:false,
  alias:Object.fromEntries(['editor-sdk','editor-project','editor-threejs'].map(name=>[
    '@volter/'+name,fileURLToPath(new URL('../../'+name+'/src',import.meta.url)),
  ]))});
const {Object3DDocumentSession,HalfFloatType,PerspectiveCamera}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].contents).toString('base64'));

function stage(mode='rendered') {
  const session=Object.create(Object3DDocumentSession.prototype);
  let current=null;
  const draws=[];
  session.renderer={
    getDrawingBufferSize:v=>v.set(512,256), getRenderTarget:()=>current,
    setRenderTarget:t=>{current=t;}, render:()=>draws.push(current),
  };
  session.state={mode}; session.composer=null; session.displayTarget=null;
  session.scene={}; session.advanceLook=()=>{}; session.ensureComposer=()=>{};
  session.render=draw=>draw(new PerspectiveCamera());
  return {session,draws,current:()=>current};
}

test('live material views compose HDR before display, reuse targets and preserve canvas dimensions',()=>{
  const s=stage(); const resolved=[];
  s.session.setDisplayTransform({render:(renderer,input,output,straight)=>resolved.push({input,output,straight})});
  s.session.renderViewport(); s.session.renderViewport();
  assert.equal(resolved.length,2);
  assert.equal(resolved[0].input,resolved[1].input);
  assert.equal(resolved[0].input.texture.type,HalfFloatType);
  assert.equal(resolved[0].input.width,512);
  assert.equal(resolved[0].input.height,256);
  assert.equal(resolved[0].output,null);
  assert.equal(resolved[0].straight,false);
  assert.equal(s.draws[0],resolved[0].input);
  assert.equal(s.current(),null);
  let released=0;resolved[0].input.addEventListener('dispose',()=>released++);
  s.session.setDisplayTransform(null);
  assert.equal(released,1);
});

test('studio diagnostics bypass scene grading and a failed resolve restores the renderer',()=>{
  const s=stage('solid');let calls=0;
  s.session.setDisplayTransform({render:()=>{calls++;throw new Error('Failed resolve');}});
  s.session.renderViewport();assert.equal(calls,0);
  s.session.state={mode:'preview'};
  assert.throws(()=>s.session.renderViewport(),/Failed resolve/);
  assert.equal(s.current(),null);
  s.session.setDisplayTransform(null);
});
