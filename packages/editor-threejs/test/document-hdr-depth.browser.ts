/** Actual GPU regression for stale depth after EffectComposer disables autoClear. */
import * as THREE from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {Object3DDocumentSession} from '../src/kit/authoring/object3d-document-session';
export async function verifyDocumentHdrDepth() {
 const renderer=new THREE.WebGLRenderer({alpha:true});renderer.setSize(16,16);
 renderer.autoClear=false;
 const output=new THREE.WebGLRenderTarget(16,16,{type:THREE.FloatType});
 const background=new THREE.DataTexture(new Uint8Array([0,0,255,255]),1,1);
 background.needsUpdate=true;
 const scene=new THREE.Scene();scene.background=background;
 const geometry=new THREE.PlaneGeometry(2,2),material=new THREE.MeshBasicMaterial({color:0xff0000});
 const mesh=new THREE.Mesh(geometry,material);scene.add(mesh);
 const camera=new THREE.PerspectiveCamera(45,1,.1,100);camera.position.z=10;
 const copy=new THREE.RawShaderMaterial({depthTest:false,depthWrite:false,uniforms:{frame:{value:null}},
  vertexShader:'precision highp float;attribute vec3 position;attribute vec2 uv;varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.0);}',
  fragmentShader:'precision highp float;uniform sampler2D frame;varying vec2 vUv;void main(){gl_FragColor=texture2D(frame,vUv);}'});
 const quad=new FullScreenQuad(copy),session=Object.create(Object3DDocumentSession.prototype);
 Object.assign(session,{renderer,scene,state:{mode:'rendered'},composer:null,displayTarget:null,
  advanceLook:()=>{},ensureComposer:()=>{},render:(draw:(c:THREE.Camera)=>void)=>draw(camera)});
 session.setDisplayTransform({render:(r:THREE.WebGLRenderer,input:THREE.WebGLRenderTarget,target:THREE.WebGLRenderTarget)=>{
  copy.uniforms['frame']!.value=input.texture;r.setRenderTarget(target);quad.render(r);
 }});
 const pixel=()=>{const p=new Float32Array(4);renderer.readRenderTargetPixels(output,8,8,1,1,p);return Array.from(p);};
 try {
  renderer.setRenderTarget(output);session.renderViewport();const first=pixel();
  material.color.setRGB(0,1,0);mesh.position.z=-2;
  session.renderViewport();const receded=pixel();
  // A photograph may reuse a target too; it has the same full-frame contract.
  renderer.setRenderTarget(output);
  session.renderSolidForCapture(camera,output,16,16);const photograph=pixel();
  const passed=first[0]!>.99 && receded[1]!>.99 && receded[0]!<.01 && photograph[1]!>.99;
  return {passed,first,receded,photograph,autoClear:renderer.autoClear};
 } finally {
  session.setDisplayTransform(null);quad.dispose();copy.dispose();geometry.dispose();material.dispose();background.dispose();output.dispose();renderer.dispose();renderer.forceContextLoss();
 }
}
