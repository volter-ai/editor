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
    setRenderTarget:t=>{current=t;}, clear:()=>{}, render:()=>draws.push(current),
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

test('outlined HDR draws and photographs use the current authored camera after a scene change',()=>{
  const s=stage(), free=new PerspectiveCamera(60,2,.01,10);
  let camera=new PerspectiveCamera(40,2,1.12,50);
  const draws=[];
  const makePass=()=>({mainCamera:free,mainScene:{},render(){draws.push({camera:this.mainCamera,scene:this.mainScene});}});
  const scenePass=makePass(), outlinePass=makePass();
  s.session.sceneRenderPass=scenePass;
  s.session.selectionOutlinePass=outlinePass;
  s.session.selectionOutline={selection:new Set(['selected'])};
  s.session.composer={inputBuffer:{},outputBuffer:{},
    setMainCamera(value){scenePass.mainCamera=outlinePass.mainCamera=value;},
    setMainScene(value){scenePass.mainScene=outlinePass.mainScene=value;}};
  s.session.render=draw=>draw(camera);
  s.session.setDisplayTransform({render(){}});
  s.session.renderViewport();
  assert.equal(draws.length,2);
  for(const draw of draws){assert.equal(draw.camera,camera);assert.equal(draw.scene,s.session.scene);}
  const first=camera;
  camera=new PerspectiveCamera(35,1.5,.3,300);
  s.session.scene={replacement:true};
  s.session.renderViewport();
  for(const draw of draws.slice(2)){assert.equal(draw.camera,camera);assert.equal(draw.scene,s.session.scene);}
  assert.notEqual(draws[2].camera,first,'camera changes reach both passes');
  assert.equal(draws[0].camera.near,1.12);assert.equal(draws[0].camera.far,50);
  // Offscreen HDR photographs call the same prepared pass path.
  draws.length=0;
  s.session.renderLinearScene(first,{});
  for(const draw of draws)assert.equal(draw.camera,first);
  s.session.setDisplayTransform(null);
});

test('plain HDR frames and photographs clear old depth when the compositor disables autoClear',()=>{
  const s=stage(),order=[];
  s.session.renderer.autoClear=false;
  s.session.renderer.clear=(...flags)=>order.push({kind:'clear',target:s.current(),flags});
  s.session.renderer.render=()=>order.push({kind:'draw',target:s.current()});
  s.session.setDisplayTransform({render(){}});
  s.session.renderViewport();s.session.renderViewport();
  assert.deepEqual(order.map(o=>o.kind),['clear','draw','clear','draw']);
  for(const clear of order.filter(o=>o.kind==='clear')) assert.deepEqual(clear.flags,[true,true,false]);
  assert.equal(order[0].target,order[1].target);
  assert.equal(order[2].target,order[3].target);
  assert.equal(s.session.renderer.autoClear,false,"leave the compositor owner's setting intact");
  order.length=0;
  const photograph={};s.session.renderer.setRenderTarget(photograph);
  s.session.renderSolidForCapture(new PerspectiveCamera(),photograph,512,512);
  assert.deepEqual(order.map(o=>o.kind),['clear','draw']);
  assert.equal(order[0].target,photograph);assert.equal(order[1].target,photograph);
  s.session.setDisplayTransform(null);
});

test('an outlined photograph sizes only offscreen buffers and restores them after failure',()=>{
  const s=stage(),sizes=[];
  const sizeable=name=>({setSize:(width,height)=>sizes.push({name,width,height})});
  const passes=[sizeable('scene'),sizeable('outline')];
  s.session.composer={inputBuffer:sizeable('input'),outputBuffer:sizeable('output'),passes,
    setSize(){assert.fail('composer.setSize resizes the visible canvas');}};
  s.session.sceneRenderPass=passes[0];s.session.selectionOutlinePass=passes[1];
  s.session.selectionOutline={selection:new Set(['selected'])};
  s.session.renderLinearScene=()=>{throw new Error('draw failed');};
  const photograph={};
  assert.throws(()=>s.session.renderSolidForCapture(new PerspectiveCamera(),photograph,1024,1024),/draw failed/);
  assert.deepEqual(sizes.slice(0,4),['input','output','scene','outline'].map(name=>({name,width:1024,height:1024})));
  assert.deepEqual(sizes.slice(4),['input','output','scene','outline'].map(name=>({name,width:512,height:256})));
  assert.equal(s.current(),photograph);
});

test('a failed document capture preserves visible canvas pixel ratio and camera projection',()=>{
  const s=stage(),camera=new PerspectiveCamera(50,2,.1,100);
  s.session.viewport={camera};
  s.session.renderer.getPixelRatio=()=>2;
  s.session.renderer.setPixelRatio=()=>assert.fail('capture must not resize the visible canvas');
  s.session.composer={setSize:()=>assert.fail('capture must not resize the visible canvas')};
  s.session.renderCapture=()=>{throw new Error('capture failed');};
  assert.throws(()=>s.session.captureImage(512),/capture failed/);
  assert.equal(camera.aspect,2);assert.equal(s.current(),null);
  assert.equal(s.session.captureAspect,null);assert.equal(s.session.cameraOverride,null);
});
