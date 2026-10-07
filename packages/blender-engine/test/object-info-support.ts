import {compileMaterialGraph, type MaterialGraph} from '../browser/three/blender-node-graph';

export const objectInfoSockets=['Location','Color','Alpha','Object Index','Material Index','Random'] as const;
export function objectInfoGraph(output: number, materialIndex=11) {
  const graph:MaterialGraph={surface:'ShaderNodeEmission',
    inputs:{Color:{link:['Info',output]},Strength:{value:1}},
    nodes:{Info:{type:'ShaderNodeObjectInfo',props:{material_index:materialIndex},inputs:[],
      outputs:objectInfoSockets.map((id,i)=>({id,gpu:i===0?'vec3':i===1?'vec4':'float'}))}}};
  return compileMaterialGraph(graph);
}
