import * as THREE from 'three';
import {resolveSceneLinearSize} from '../src/capture/linear-resolve';

/** Actual GPU check: a black/white edge must resolve to scene-linear 0.5,
 * rather than averaging display-encoded values after the view transform. */
export function verifyLinearResolve() {
  const renderer=new THREE.WebGLRenderer({alpha:true});
  const input=new THREE.WebGLRenderTarget(2,2,{type:THREE.HalfFloatType});
  let output: THREE.WebGLRenderTarget | null=null;
  try {
    renderer.setRenderTarget(input);
    renderer.setClearColor(0,0);
    renderer.clear();
    renderer.setScissor(1,0,1,2);
    renderer.setScissorTest(true);
    renderer.setClearColor(0xffffff,1);
    renderer.clear();
    renderer.setScissorTest(false);
    output=resolveSceneLinearSize(renderer,input,1,1);
    const pixels=new Uint16Array(4);
    renderer.readRenderTargetPixels(output,0,0,1,1,pixels);
    const values=Array.from(pixels,THREE.DataUtils.fromHalfFloat);
    return {passed:values.every(v=>v===0.5),rgba:values};
  } finally {
    output?.dispose();input.dispose();renderer.dispose();renderer.forceContextLoss();
  }
}
