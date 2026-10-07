/* SPDX-FileCopyrightText: 2011-2022 Blender Foundation
 * SPDX-License-Identifier: Apache-2.0 */
/** Cycles' attr_create_random_per_island, util/disjoint_set.h and
 * util/hash.h (Blender Foundation, Apache-2.0). Connectivity uses the
 * evaluated mesh's STORED edge order and union-by-rank representative,
 * including loose edges. It is independent of draw/UV/normal splitting. */
export const ISLAND_RANDOM_ATTRIBUTE='.cycles.random_per_island';

function hashUint(value:number):number {
  let a=(0xdeadbeef+17+value)>>>0,b=(0xdeadbeef+17)>>>0,c=b;
  const rotate=(x:number,n:number)=>(x<<n)|(x>>>(32-n));
  c=((c^b)-rotate(b,14))>>>0;a=((a^c)-rotate(c,11))>>>0;
  b=((b^a)-rotate(a,25))>>>0;c=((c^b)-rotate(b,16))>>>0;
  a=((a^c)-rotate(c,4))>>>0;b=((b^a)-rotate(a,14))>>>0;
  c=((c^b)-rotate(b,24))>>>0;
  // Native converts uint to float BEFORE the float reciprocal/multiply.
  return Math.fround(Math.fround(c)*Math.fround(1/Math.fround(0xffffffff)));
}

export function cyclesIslandRandom(vertexCount:number,edges:Iterable<readonly [number,number]>):Float32Array {
  const parents=Uint32Array.from({length:vertexCount},(_,i)=>i),ranks=new Uint8Array(vertexCount);
  const find=(x:number):number=>{
    let root=x;while(parents[root]!==root)root=parents[root]!;
    while(parents[x]!==root){const parent=parents[x]!;parents[x]=root;x=parent;}
    return root;
  };
  for(const [x,y] of edges) {
    if(x<0 || y<0 || x>=vertexCount || y>=vertexCount || !Number.isInteger(x) || !Number.isInteger(y))
      throw new Error('Island connectivity references a missing Blender vertex');
    let a=find(x),b=find(y);if(a===b)continue;
    if(ranks[a]!<ranks[b]!)[a,b]=[b,a];
    parents[b]=a;if(ranks[a]===ranks[b])ranks[a]=ranks[a]!+1;
  }
  const result=new Float32Array(vertexCount);
  for(let i=0;i<vertexCount;i++)result[i]=hashUint(find(i));
  return result;
}

export function* storedMeshEdges(edges:Uint32Array):Iterable<readonly [number,number]> {
  for(let i=0;i<edges.length;i+=2)yield [edges[i]!,edges[i+1]!];
}
