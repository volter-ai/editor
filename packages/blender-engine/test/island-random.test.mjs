import assert from 'node:assert/strict';import {test} from 'node:test';
import {readFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {build} from 'esbuild';
const native=JSON.parse(await readFile(new URL('./fixtures/island-random.json',import.meta.url)));
const built=await build({stdin:{contents:`export * from './island-random-support';
export * from '../browser/three/blender-island-random';export * from '../browser/three/blender-runtime-geometry';
export {BlenderRuntimeView} from '../browser/three/blender-runtime-view';export {graphAttributeName} from '../browser/three/blender-runtime-geometry';`,
 resolveDir:fileURLToPath(new URL('./',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const {cyclesIslandRandom,ISLAND_RANDOM_ATTRIBUTE,islandColumns,islandGraph,islandGraphData,islandDrawArrays,
 drawArraysFromColumns,geometryFromDrawArrays,graphAttributeName,BlenderRuntimeView}=
 await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].contents).toString('base64'));
test('Cycles island representatives match independent emission pixels, including loose edges and native edge order',()=>{
 for(const c of native.cases){const values=cyclesIslandRandom(c.vertices.length,c.edges);
  // Native rendered radiance differs from the raw hash by one float32 ULP
  // for one value; shared island attributes themselves must stay identical.
  c.faces.forEach((face,i)=>face.forEach(vertex=>assert(Math.abs(values[vertex]-c.rgba[i][0])<6e-8,c.name)));
  const columns=islandColumns(c),positions=columns.co.slice(),edges=columns.edge.slice();
  for(const fast of [true,false]){if(!fast){delete columns.cornerTri;delete columns.cornerNormal;}
   const arrays=drawArraysFromColumns(columns,c.name),layer=arrays.attributeLayers.find(l=>l.name===ISLAND_RANDOM_ATTRIBUTE);
   arrays.sourceVertex.forEach((vertex,i)=>assert.equal(layer.data[i],values[vertex],`${c.name} ${fast}`));
   assert.equal(layer.data.length,arrays.positions.length/3,'one float per draw vertex');
   assert.deepEqual(columns.co,positions);assert.deepEqual(columns.edge,edges);
  }
 }
 assert.throws(()=>cyclesIslandRandom(2,[[0,2]]),/missing Blender vertex/);
});
test('linked Random Per Island reads face-constant geometry instead of the EEVEE zero output',()=>{
 const graph=islandGraph();assert.deepEqual(graph.attributes,[ISLAND_RANDOM_ATTRIBUTE]);
 assert(graph.declarations.includes('blenderGraph'));
});
test('revision-owned snapshots preserve the island attribute and its scalar stride',()=>{
 const view=new BlenderRuntimeView(),c=native.cases[0],arrays=islandDrawArrays(c);
 const identity=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
 try{
  view.applyFrame({session:'islands',revision:1,active:null,mode:'OBJECT',meshes:{control:arrays},
   materials:{control:{name:'control',color:[1,1,1,1],roughness:1,metallic:0,transmission:0,ior:1.5,graph:islandGraphData}},
   objects:[{id:'control',name:'control',type:'MESH',mesh:'control',materials:['control'],matrix:identity,visible:true,selected:false,parent:null}]});
  const original=view.root.getObjectByName('control').geometry.getAttribute(graphAttributeName(ISLAND_RANDOM_ATTRIBUTE));
  const snapshot=view.captureSnapshot();try{
   const copied=snapshot.root.getObjectByName('control').geometry.getAttribute(graphAttributeName(ISLAND_RANDOM_ATTRIBUTE));
   assert.equal(original.itemSize,1);assert.equal(copied.itemSize,1);assert.deepEqual(copied.array,original.array);
   assert.notEqual(copied.array,original.array,'snapshot owns its storage');
  }finally{snapshot.dispose();}
 }finally{view.dispose();}
});
