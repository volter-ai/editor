import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const bundled=await build({stdin:{contents:`export * from './blender-world-volume'; export * from './blender-physical-material'; export {worldSchema} from './blender-runtime-lighting'; export * from 'three';`,
  resolveDir:fileURLToPath(new URL('../browser/three/',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].contents).toString('base64'));
const {worldMedium,mediumIntegral,phaseDraine,blackbody,worldSchema,WorldVolumePass,Scene,PerspectiveCamera,
  WebGLRenderTarget,DepthTexture,HalfFloatType,PointLight,MeshPhysicalMaterial,ShaderLib,Vector3,applyWorldExtinction}=api;
const leaf=(overrides={})=>({kind:'absorption',weight:1,color:[.2,.4,.8],density:2,phase:'HENYEY_GREENSTEIN',
  alpha:0,anisotropy:0,absorption_color:[0,0,0],emission_color:[1,1,1],emission_strength:0,
  blackbody_intensity:0,temperature:1000,blackbody_tint:[1,1,1],...overrides});
const world=(...volume)=>worldSchema.parse({color:[0,0,0],strength:0,volume});
test('World absorption is spectral and integrates finite and unbounded segments',()=>{
  const m=worldMedium(world(leaf()));
  m.extinction.toArray().forEach((v,i)=>assert.ok(Math.abs(v-[1.6,1.2,.4][i])<1e-12));
  assert.equal(mediumIntegral(0,3),3);assert.equal(mediumIntegral(2,Infinity),.5);
  assert.ok(Math.abs(mediumIntegral(2,3)-(1-Math.exp(-6))/2)<1e-14);
  assert.ok(Math.abs(mediumIntegral(1e-12,3)-3)<1e-10);
});
test('Principled volume follows absorption color and unscaled emission; Mix retains lobes',()=>{
  const m=worldMedium(world(leaf({kind:'principled',color:[.5,.5,.5],absorption_color:[.25,.25,.25],
    emission_strength:3,emission_color:[1,2,3],weight:.25,anisotropy:-.5}),
    leaf({kind:'scatter',color:[1,1,1],weight:.75,anisotropy:.7})));
  assert.deepEqual(m.emission.toArray(),[.75,1.5,2.25]);
  assert.deepEqual(m.extinction.toArray(),[1.875,1.875,1.875]);
  assert.deepEqual(m.lobes.map(v=>v.g),[-.5,.7]);
});
test('phase evaluation conserves power and Draine includes HG and Rayleigh',()=>{
  for(const [g,a] of [[0,0],[0,1],[.5,0],[-.3,.7]]){
    let integral=0;const n=100000;
    for(let i=0;i<n;i++) integral+=phaseDraine(-1+2*(i+.5)/n,g,a)*4*Math.PI/n;
    assert.ok(Math.abs(integral-1)<1e-7);
  }
  assert.ok(Math.abs(phaseDraine(0,0,1)-3/(16*Math.PI))<1e-16);
  assert(phaseDraine(1,.5,0)>phaseDraine(-1,.5,0));
});
test('World inputs reject unsupported spatial fields and divergent infinite emission',()=>{
  assert.throws(()=>worldMedium(world(leaf({density:{kind:'direction'}}))),/spatial input/);
  assert.throws(()=>worldMedium(world(leaf({kind:'emission',emission_strength:1}))),/divergent/);
  assert.throws(()=>worldMedium(world(leaf({kind:'scatter',phase:'MIE'}))),/MIE phase/);
  assert.equal(worldMedium(undefined),null);
});
test('native blackbody endpoints and Principled emission remain finite',()=>{
  assert.deepEqual(blackbody(500).toArray(),[5.413294490189271,0,0]);
  assert.deepEqual(blackbody(12000).toArray(),[.8262954810464208,.9945080501520986,1.566307710274283]);
  const m=worldMedium(world(leaf({kind:'principled',blackbody_intensity:1,temperature:3000})));
  assert(m.emission.toArray().every(v=>v>0&&Number.isFinite(v)));
});
test('surface light attenuation is live and cleared after a render',()=>{
  const material=new MeshPhysicalMaterial();applyWorldExtinction(material,new Vector3(1,2,3));
  const shader={uniforms:{},vertexShader:ShaderLib.physical.vertexShader,fragmentShader:ShaderLib.physical.fragmentShader};
  material.onBeforeCompile(shader,{});
  assert.deepEqual(shader.uniforms.blenderWorldExtinction.value.toArray(),[1,2,3]);
  assert(shader.fragmentShader.includes('length(pointLight.position-geometryPosition)'));
  assert(shader.fragmentShader.includes('length(spotLight.position-geometryPosition)'));
  assert(shader.fragmentShader.includes('getIBLIrradiance( geometryNormal ) * blenderInfiniteTransmission()'));
  applyWorldExtinction(material,new Vector3());
  assert.deepEqual(shader.uniforms.blenderWorldExtinction.value.toArray(),[0,0,0]);
});
test('pass owns output but never disposes input; shadow sampling and failed draw restore target',()=>{
  const pass=new WorldVolumePass(worldMedium(world(leaf({kind:'scatter'}))));
  const input=new WebGLRenderTarget(8,4,{type:HalfFloatType});input.depthTexture=new DepthTexture(8,4);
  const scene=new Scene(),light=new PointLight();light.castShadow=true;
  light.shadow.map=new WebGLRenderTarget(16,16);scene.add(light);scene.updateMatrixWorld();
  const camera=new PerspectiveCamera();camera.updateMatrixWorld();
  let target=input,material;
  const renderer={capabilities:{maxTextures:16},getRenderTarget:()=>target,setRenderTarget:t=>{target=t;},
    render:s=>{material=s.children[0].material;}};
  const result=pass.render(renderer,input,scene,camera);
  assert.equal(result.width,8);assert.equal(result.height,4);assert.equal(target,input);
  assert.equal(material.uniforms.sm0.value,light.shadow.map.texture);
  assert(material.fragmentShader.includes('getPointShadow(sm0'));
  let inputDisposed=false,outputDisposed=false;
  input.addEventListener('dispose',()=>inputDisposed=true);result.addEventListener('dispose',()=>outputDisposed=true);
  renderer.render=()=>{throw Error('draw failed');};
  assert.throws(()=>pass.render(renderer,input,scene,camera),/draw failed/);assert.equal(target,input);
  pass.dispose();assert(outputDisposed);assert(!inputDisposed);input.dispose();light.shadow.map.dispose();
});
