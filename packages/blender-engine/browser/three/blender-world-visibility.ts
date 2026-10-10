/** Directional world-light visibility. One shared depth atlas replaces repeated
 * per-pixel triangle traversal. Geometry/placements are derived draw resources;
 * Blender data and the visible canvas are never changed. This is finite
 * directional quadrature, not indirect light transport. */
import * as THREE from 'three';

/** SKY-LIGHT OCCLUSION IS OFF IN EVERY VIEW, and compiled out of every material. Its
 *  sixteen 512-square tiles each span the whole scene, so a 360 m level gets
 *  about a metre per texel, and each lookup is one nearest texel answering
 *  yes or no. Faceted surfaces then occlude their own sky at random pixels --
 *  static on every polygon in Rendered and Play -- and narrow specular lobes,
 *  dominated by a few of the sixteen directions, plausibly flash as the camera
 *  moves. It measured right in a closed room a few metres across. Turn it back
 *  on once its lookups are filtered and its resolution follows the scene's size
 *  (docs/BLENDER-RENDERING-PARITY.md lists the rest). Off, the view neither
 *  syncs nor draws the atlas (`blender-runtime-view.ts`), and physical
 *  materials declare none of its samplers (`blender-physical-material.ts`):
 *  three of them counted against a material's sixteen even while unused. */
export const WORLD_VISIBILITY = false;

const SAMPLE_COUNT=16, TILES=4, TILE_SIZE=512;
type Segment={mesh:THREE.Mesh; geometry:THREE.BufferGeometry; position:THREE.BufferAttribute|THREE.InterleavedBufferAttribute;
 index:THREE.BufferAttribute|null; positionVersion:number; indexVersion:number; start:number; count:number;
 offset:number; matrix:THREE.Matrix4; shown:boolean; bounds:THREE.Box3; dynamic:boolean};
const version=(attribute:THREE.BufferAttribute|THREE.InterleavedBufferAttribute)=>
 'isInterleavedBufferAttribute' in attribute ? attribute.data.version : attribute.version;
function shown(mesh:THREE.Mesh):boolean {
 if(!mesh.castShadow || !mesh.layers.isEnabled(0))return false;
 for(let parent:THREE.Object3D|null=mesh;parent;parent=parent.parent)if(!parent.visible)return false;
 return true;
}

export class BlenderWorldVisibility {
 readonly uniforms={
  blenderWorldVisibilityEnabled:{value:false},
  blenderWorldDepth:{value:null as THREE.Texture|null},
  blenderWorldDynamicDepth:{value:null as THREE.Texture|null},
  blenderWorldHasDynamicDepth:{value:false},
  blenderWorldRadiance:{value:null as THREE.Texture|null},
  blenderWorldDirections:{value:Array.from({length:SAMPLE_COUNT},(_,i)=>{
   const z=1-2*(i+.5)/SAMPLE_COUNT,angle=i*2.399963229728653;
   return new THREE.Vector3(Math.sqrt(1-z*z)*Math.cos(angle),z,Math.sqrt(1-z*z)*Math.sin(angle));
  })},
  blenderWorldMatrices:{value:Array.from({length:SAMPLE_COUNT},()=>new THREE.Matrix4())},
  blenderWorldToNative:{value:new THREE.Matrix3()},
  blenderWorldRayOffset:{value:1e-5},
 };
 private target:THREE.WebGLRenderTarget|null=null;
 private dynamicTarget:THREE.WebGLRenderTarget|null=null;
 private readonly dynamicScene=new THREE.Scene();
 private readonly dynamicMeshes=new Map<THREE.Mesh,THREE.Mesh>();
 private readonly scene=new THREE.Scene();
 private readonly geometry=new THREE.BufferGeometry();
 private readonly material=new THREE.MeshDepthMaterial({side:THREE.DoubleSide});
 private readonly mesh=new THREE.Mesh(this.geometry,this.material);
 private readonly camera=new THREE.OrthographicCamera();
 private segments:Segment[]=[];
 private dirty=true;
 private staticDirty=true;
 private dynamicDirty=false;
 private fittedBounds=new THREE.Box3();
 private passes=0;
 private staticPasses=0;
 private dynamicPasses=0;
 constructor(){this.mesh.frustumCulled=false;this.scene.add(this.mesh);}

 sync(objects:Iterable<THREE.Object3D>,world:THREE.Texture|null,root:THREE.Object3D,enabled:boolean):void {
  this.uniforms.blenderWorldVisibilityEnabled.value=enabled && world!==null;
  this.uniforms.blenderWorldRadiance.value=world;
  this.uniforms.blenderWorldToNative.value.setFromMatrix4(root.matrixWorld).invert();
  if(!enabled || !world)return;
  const meshes=[...objects].filter((object):object is THREE.Mesh=>(object as THREE.Mesh).isMesh===true &&
   !!(object as THREE.Mesh).geometry.getAttribute('position'));
  const layoutChanged=meshes.length!==this.segments.length || meshes.some((mesh,i)=>{
   const previous=this.segments[i],geometry=mesh.geometry;
   return !previous || previous.mesh!==mesh || previous.geometry!==geometry ||
    previous.position!==geometry.getAttribute('position') || previous.index!==geometry.index ||
    previous.start!==geometry.drawRange.start || previous.count!==Math.min(geometry.drawRange.count,
     (geometry.index?.count ?? geometry.getAttribute('position').count)-geometry.drawRange.start);
  });
  if(layoutChanged) {
   for(const mesh of this.dynamicMeshes.values()){mesh.removeFromParent();mesh.geometry.dispose();}
   this.dynamicMeshes.clear();this.dynamicDirty=true;this.fittedBounds.makeEmpty();
   let offset=0;
   this.segments=meshes.map(mesh=>{
    const geometry=mesh.geometry,position=geometry.getAttribute('position'),index=geometry.index;
    const start=geometry.drawRange.start,count=Math.max(0,Math.min(geometry.drawRange.count,(index?.count??position.count)-start));
    const segment={mesh,geometry,position,index,positionVersion:-1,indexVersion:-1,start,count,
     offset,matrix:new THREE.Matrix4(),shown:!shown(mesh),bounds:new THREE.Box3(),dynamic:false};
    offset+=count;return segment;
   });
   this.geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(offset*3),3));
   this.dirty=true;this.staticDirty=true;
  }
  const attribute=this.geometry.getAttribute('position') as THREE.BufferAttribute|undefined;
  if(!attribute)return;
  const point=new THREE.Vector3();
  for(const segment of this.segments) {
   const visible=shown(segment.mesh),pv=version(segment.position),iv=segment.index?.version??0;
   if(segment.shown===visible && segment.matrix.equals(segment.mesh.matrixWorld) &&
      segment.positionVersion===pv && segment.indexVersion===iv)continue;
   // Once an object moves/deforms, keep it in the small dynamic atlas. Its
   // later poses must never redraw every static triangle in the environment.
   if(!segment.dynamic && segment.positionVersion>=0 &&
     (!segment.matrix.equals(segment.mesh.matrixWorld) || segment.positionVersion!==pv || segment.indexVersion!==iv)) {
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(segment.count*3),3));
    const mesh=new THREE.Mesh(geometry,this.material);mesh.frustumCulled=false;
    this.dynamicScene.add(mesh);this.dynamicMeshes.set(segment.mesh,mesh);segment.dynamic=true;
    (attribute.array as Float32Array).fill(0,segment.offset*3,(segment.offset+segment.count)*3);
    attribute.addUpdateRange(segment.offset*3,segment.count*3);attribute.needsUpdate=true;this.staticDirty=true;
   }
   const dynamicMesh=this.dynamicMeshes.get(segment.mesh);
   const written=(dynamicMesh?.geometry.getAttribute('position')??attribute) as THREE.BufferAttribute;
   if(dynamicMesh)dynamicMesh.visible=visible;
   segment.bounds.makeEmpty();
   for(let i=0;i<segment.count;i++) {
    if(visible) {
     const vertex=segment.index?.getX(segment.start+i) ?? segment.start+i;
     point.fromBufferAttribute(segment.position,vertex).applyMatrix4(segment.mesh.matrixWorld);
     segment.bounds.expandByPoint(point);
    } else point.set(0,0,0); // Degenerate the hidden range without changing its layout.
    written.setXYZ(dynamicMesh?i:segment.offset+i,point.x,point.y,point.z);
   }
   written.addUpdateRange(dynamicMesh?0:segment.offset*3,segment.count*3);written.needsUpdate=true;
   if(dynamicMesh)this.dynamicDirty=true;else this.staticDirty=true;
   segment.shown=visible;segment.matrix.copy(segment.mesh.matrixWorld);
   segment.positionVersion=pv;segment.indexVersion=iv;this.dirty=true;
  }
 }

 /** Draw the atlas only when a caster changes. All directional samples share
  * one texture sampler and one merged depth draw, retaining offscreen casters. */
 prepare(renderer:THREE.WebGLRenderer):void {
  if(!this.uniforms.blenderWorldVisibilityEnabled.value || !this.dirty)return;
  if(!this.target) {
   const size=TILES*TILE_SIZE;
   this.target=new THREE.WebGLRenderTarget(size,size,{depthBuffer:true,stencilBuffer:false});
   this.target.depthTexture=new THREE.DepthTexture(size,size,THREE.UnsignedIntType);
   this.target.depthTexture.minFilter=this.target.depthTexture.magFilter=THREE.NearestFilter;
   this.uniforms.blenderWorldDepth.value=this.target.depthTexture;
  }
  if(this.dynamicMeshes.size && !this.dynamicTarget) {
   const size=TILES*TILE_SIZE;
   this.dynamicTarget=new THREE.WebGLRenderTarget(size,size,{depthBuffer:true,stencilBuffer:false});
   this.dynamicTarget.depthTexture=new THREE.DepthTexture(size,size,THREE.UnsignedIntType);
   this.dynamicTarget.depthTexture.minFilter=this.dynamicTarget.depthTexture.magFilter=THREE.NearestFilter;
   this.uniforms.blenderWorldDynamicDepth.value=this.dynamicTarget.depthTexture;
  }
  this.uniforms.blenderWorldHasDynamicDepth.value=this.dynamicMeshes.size>0;
  const bounds=this.segments.reduce((all,segment)=>all.union(segment.bounds),new THREE.Box3());
  if(this.fittedBounds.isEmpty() || !this.fittedBounds.containsBox(bounds)) {
   this.fittedBounds.union(bounds);this.staticDirty=true;
  }
  const sphere=this.fittedBounds.getBoundingSphere(new THREE.Sphere());
  this.mesh.visible=(this.geometry.getAttribute('position')?.count??0)>0;
  const radius=Math.max(sphere.radius,1e-3),distance=radius*2+1;
  this.uniforms.blenderWorldRayOffset.value=radius*1e-5;
  this.camera.left=-radius;this.camera.right=radius;this.camera.top=radius;this.camera.bottom=-radius;
  this.camera.near=.001;this.camera.far=distance+radius*2;
  this.camera.updateProjectionMatrix();
  const target=renderer.getRenderTarget(),autoClear=renderer.autoClear,shadowMap=renderer.shadowMap.enabled;
  try {
   renderer.autoClear=false;renderer.shadowMap.enabled=false;
   const targets:[THREE.WebGLRenderTarget,THREE.Scene,boolean][]=[[this.target,this.scene,this.staticDirty]];
   if(this.dynamicTarget)targets.push([this.dynamicTarget,this.dynamicScene,this.dynamicDirty||this.staticDirty]);
   for(const [target,,draw] of targets)if(draw) {
    target.viewport.set(0,0,TILES*TILE_SIZE,TILES*TILE_SIZE);target.scissorTest=false;
    renderer.setRenderTarget(target);renderer.clear(true,true,false);
   }
   for(let i=0;i<SAMPLE_COUNT;i++) {
    const direction=this.uniforms.blenderWorldDirections.value[i]!;
    this.camera.position.copy(sphere.center).addScaledVector(direction,distance);
    this.camera.up.set(0,1,0);this.camera.lookAt(sphere.center);this.camera.updateMatrixWorld(true);
    this.uniforms.blenderWorldMatrices.value[i]!.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse);
    const x=(i%TILES)*TILE_SIZE,y=Math.floor(i/TILES)*TILE_SIZE;
    // Render-target viewports use device pixels. Renderer.setViewport uses
    // logical pixels even offscreen, so a HiDPI view would overlap the tiles.
    for(const [target,scene,draw] of targets)if(draw) {
     target.viewport.set(x,y,TILE_SIZE,TILE_SIZE);target.scissor.set(x,y,TILE_SIZE,TILE_SIZE);target.scissorTest=true;
     renderer.setRenderTarget(target);renderer.render(scene,this.camera);
    }
   }
   if(this.staticDirty){this.passes+=SAMPLE_COUNT;this.staticPasses+=SAMPLE_COUNT;}
   if(this.dynamicTarget && (this.dynamicDirty||this.staticDirty)){this.passes+=SAMPLE_COUNT;this.dynamicPasses+=SAMPLE_COUNT;}
   this.dirty=false;this.staticDirty=false;this.dynamicDirty=false;
  } finally {
   renderer.setRenderTarget(target);renderer.autoClear=autoClear;renderer.shadowMap.enabled=shadowMap;
  }
 }
 diagnostics(){return {enabled:this.uniforms.blenderWorldVisibilityEnabled.value,world:!!this.uniforms.blenderWorldRadiance.value,
  depth:!!this.uniforms.blenderWorldDepth.value,passes:this.passes,staticPasses:this.staticPasses,dynamicPasses:this.dynamicPasses,
  dynamicObjects:this.dynamicMeshes.size,vertices:this.geometry.getAttribute('position')?.count??0,
  casters:this.segments.filter(segment=>segment.shown).length,dirty:this.dirty};}
 dispose():void {
  this.uniforms.blenderWorldVisibilityEnabled.value=false;
  this.target?.dispose();this.target=null;this.uniforms.blenderWorldDepth.value=null;
  this.dynamicTarget?.dispose();this.dynamicTarget=null;this.uniforms.blenderWorldDynamicDepth.value=null;
  this.uniforms.blenderWorldHasDynamicDepth.value=false;
  for(const mesh of this.dynamicMeshes.values()){mesh.removeFromParent();mesh.geometry.dispose();}this.dynamicMeshes.clear();
  this.geometry.dispose();this.material.dispose();this.segments=[];
  this.geometry.deleteAttribute('position');this.dirty=true;this.staticDirty=true;this.dynamicDirty=false;this.fittedBounds.makeEmpty();
 }
}

const bindings=new WeakMap<THREE.Material,BlenderWorldVisibility>();
const compiled=new WeakMap<THREE.Material,Set<THREE.WebGLProgramParametersWithUniforms['uniforms']>>();
const inactive=new BlenderWorldVisibility();
export function bindWorldVisibility(material:THREE.Material,visibility:BlenderWorldVisibility):void {
 if(bindings.get(material)===visibility)return;
 bindings.set(material,visibility);
 for(const uniforms of compiled.get(material)??[])Object.assign(uniforms,visibility.uniforms);
}
export function copyWorldVisibility(source:THREE.Material,target:THREE.Material):void {
 const visibility=bindings.get(source);if(visibility)bindWorldVisibility(target,visibility);
}
export function worldVisibilityUniforms(material:THREE.Material,uniforms:THREE.WebGLProgramParametersWithUniforms['uniforms']):void {
 let held=compiled.get(material);if(!held){held=new Set();compiled.set(material,held);}held.add(uniforms);
 Object.assign(uniforms,(bindings.get(material)??inactive).uniforms);
}

export const worldVisibilityShader=/* glsl */`
varying vec3 blenderWorldPosition;
uniform bool blenderWorldVisibilityEnabled;
uniform sampler2D blenderWorldDepth, blenderWorldDynamicDepth, blenderWorldRadiance;
uniform bool blenderWorldHasDynamicDepth;
uniform vec3 blenderWorldDirections[16];
uniform mat4 blenderWorldMatrices[16];
uniform mat3 blenderWorldToNative;
uniform float blenderWorldRayOffset;
float blenderWorldVisible(int i, vec3 position, vec3 worldDx, vec3 worldDy) {
 vec4 clip=blenderWorldMatrices[i]*vec4(position,1.);
 vec3 point=clip.xyz/clip.w*.5+.5;
 if(any(lessThan(point,vec3(0.))) || any(greaterThan(point,vec3(1.))))return 1.;
 vec2 tile=vec2(float(i%4),float(i/4));
 vec2 samplePoint=clamp((floor(point.xy*512.)+.5)/512.,vec2(.5/512.),vec2(1.-.5/512.));
 vec2 uv=(tile+samplePoint)/4.;
 float depth=texture2D(blenderWorldDepth,uv).x;
 if(blenderWorldHasDynamicDepth)depth=min(depth,texture2D(blenderWorldDynamicDepth,uv).x);
 // Compare the receiver plane AT THE DEPTH TEXEL, not at its nearby fragment.
 // A fixed depth bias falsely shadows an unoccluded tilted plane; increasing
 // that bias leaks through thin walls. Derivatives retain its actual slope.
 vec3 dx=(blenderWorldMatrices[i]*vec4(worldDx,0.)).xyz*.5;
 vec3 dy=(blenderWorldMatrices[i]*vec4(worldDy,0.)).xyz*.5;
 float determinant=dx.x*dy.y-dx.y*dy.x;
 vec2 gradient=abs(determinant)>1e-12 ? vec2(dx.z*dy.y-dy.z*dx.y,dy.z*dx.x-dx.z*dy.x)/determinant : vec2(0.);
 float receiverDepth=point.z+dot(gradient,samplePoint-point.xy);
 return receiverDepth<=depth+1e-6 ? 1. : 0.;
}
vec3 blenderWorldIrradiance(vec3 normal, vec3 fallbackIrradiance) {
 if(!blenderWorldVisibilityEnabled)return fallbackIrradiance;
 vec3 n=inverseTransformDirection(normal,viewMatrix),sum=vec3(0.);
 float weights=0.;vec3 origin=blenderWorldPosition+n*blenderWorldRayOffset;
 vec3 worldDx=dFdx(blenderWorldPosition),worldDy=dFdy(blenderWorldPosition);
 for(int i=0;i<16;i++) {
  vec3 direction=blenderWorldDirections[i];float weight=max(0.,dot(n,direction));weights+=weight;
  if(weight>0. && blenderWorldVisible(i,origin,worldDx,worldDy)>0.) {
   vec3 nativeDirection=normalize(blenderWorldToNative*direction);
   vec2 uv=vec2(atan(-nativeDirection.y,nativeDirection.x)/6.28318530718+.5,
    asin(clamp(nativeDirection.z,-1.,1.))/3.14159265359+.5);
   sum+=texture2D(blenderWorldRadiance,uv).rgb*weight;
  }
 }
 return sum*(3.14159265359/max(weights,1e-8));
}
float blenderWorldReflectionVisibility(vec3 viewDirection,vec3 normal,float roughness) {
 if(!blenderWorldVisibilityEnabled)return 1.;
 vec3 n=inverseTransformDirection(normal,viewMatrix),r=inverseTransformDirection(reflect(-viewDirection,normal),viewMatrix);
 vec3 origin=blenderWorldPosition+n*blenderWorldRayOffset;
 vec3 worldDx=dFdx(blenderWorldPosition),worldDy=dFdy(blenderWorldPosition);
 float sum=0.,weights=0.;
 for(int i=0;i<16;i++) {
  float weight=pow(max(0.,dot(r,blenderWorldDirections[i])),mix(64.,1.,roughness));
  weights+=weight;sum+=weight*blenderWorldVisible(i,origin,worldDx,worldDy);
 }
 return sum/max(weights,1e-8);
}
`;
