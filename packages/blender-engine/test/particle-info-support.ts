import {compileMaterialGraph, type MaterialGraph} from '../browser/three/blender-node-graph';
export function particleInfoGraph(output=1) {
  const sockets=['Index','Random','Age','Lifetime','Location','Size','Velocity','Angular Velocity'];
  const graph:MaterialGraph={surface:'ShaderNodeEmission',inputs:{Color:{link:['Info',output]},Strength:{value:1}},
    nodes:{Info:{type:'ShaderNodeParticleInfo',props:{},inputs:[],
      outputs:sockets.map((id,i)=>({id,gpu:[4,6,7].includes(i)?'vec3':'float'}))}}};
  return compileMaterialGraph(graph);
}
