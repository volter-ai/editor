import * as THREE from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';

let quad: FullScreenQuad | null = null;
let material: THREE.RawShaderMaterial | null = null;

/** The capture renders exactly 2x in each axis. Linear filtering at a pixel's
 * center averages its four scene-linear samples BEFORE the nonlinear display
 * transform. Downsampling display-encoded canvas pixels darkens color edges.
 * The caller owns the returned target; input and associated alpha stay intact. */
export function resolveSceneLinearSize(
  renderer: THREE.WebGLRenderer,
  input: THREE.WebGLRenderTarget,
  width: number,
  height: number,
): THREE.WebGLRenderTarget {
  if (input.width !== width * 2 || input.height !== height * 2)
    throw new Error('Linear capture resolve requires a 2x scene target');
  material ??= new THREE.RawShaderMaterial({
    uniforms: {frame: {value:null}, texel: {value:new THREE.Vector2()}},
    depthTest:false, depthWrite:false, blending:THREE.NoBlending,
    vertexShader:`precision highp float; attribute vec3 position; attribute vec2 uv;
      varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,1.0);}`,
    fragmentShader:`precision highp float; uniform sampler2D frame; uniform vec2 texel; varying vec2 vUv;
      void main(){
        gl_FragColor=(texture2D(frame,vUv+texel*vec2(-.5,-.5))+
          texture2D(frame,vUv+texel*vec2(.5,-.5))+
          texture2D(frame,vUv+texel*vec2(-.5,.5))+
          texture2D(frame,vUv+texel*vec2(.5,.5)))*.25;
      }`,
  });
  quad ??= new FullScreenQuad(material);
  material.uniforms['frame']!.value=input.texture;
  material.uniforms['texel']!.value.set(1/input.width,1/input.height);
  const output=new THREE.WebGLRenderTarget(width,height,{type:THREE.HalfFloatType});
  const previous=renderer.getRenderTarget();
  try { renderer.setRenderTarget(output); quad.render(renderer); return output; }
  catch(error) { output.dispose(); throw error; }
  finally { renderer.setRenderTarget(previous); }
}
