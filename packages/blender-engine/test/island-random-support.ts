import {compileMaterialGraph,type MaterialGraph} from '../browser/three/blender-node-graph';
import {drawArraysFromColumns} from '../browser/three/blender-runtime-geometry';
export const islandGraphData:MaterialGraph={surface:'ShaderNodeEmission',inputs:{Color:{link:['Geometry',8]},Strength:{value:1}},
 nodes:{Geometry:{type:'ShaderNodeNewGeometry',props:{},inputs:[],outputs:
 ['Position','Normal','Tangent','True Normal','Incoming','Parametric','Backfacing','Pointiness','Random Per Island']
 .map((id,i)=>({id,gpu:i<6?'vec3':'float'}))}}};
export const islandGraph=()=>compileMaterialGraph(islandGraphData);
type Case={name:string;vertices:number[][];edges:number[][];faces:number[][];triangles:number[][]};
export function islandColumns(c:Case) {
 const corner=c.faces.flat(),faceStart=new Uint32Array(c.faces.length+1);
 c.faces.forEach((face,i)=>faceStart[i+1]=faceStart[i]!+face.length);
 return {co:new Float32Array(c.vertices.flat()),faceStart,corner:new Uint32Array(corner),
  cornerTri:new Uint32Array(c.triangles.flat()),cornerNormal:Float32Array.from({length:corner.length*3},(_,i)=>i%3===2?1:0),
  cornerEdge:new Int32Array(corner.length).fill(-1),edge:new Uint32Array(c.edges.flat()),edgeSharp:new Uint8Array(c.edges.length),
  material:new Int32Array(c.faces.length),smooth:new Uint8Array(c.faces.length).fill(1),attributes:[]};
}
export function islandDrawArrays(c:Case) {
 const {sourceVertex,...arrays}=drawArraysFromColumns(islandColumns(c),c.name);
 return arrays;
}
