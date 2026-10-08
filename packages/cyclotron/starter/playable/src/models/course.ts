// SPDX-License-Identifier: MIT
// Copyright 2026 Volter AI, Inc.
export const points=[[0,0],[0,25],[12,55],[42,70],[68,45],[65,5],[40,-25],[8,-25]];
export function curve(t:number){const k=Math.floor(t),u=t-k;const p=[-1,0,1,2].map(d=>points[((k+d)%8+8)%8]);return [0,1].map(c=>.5*(2*p[1][c]+(-p[0][c]+p[2][c])*u+(2*p[0][c]-5*p[1][c]+4*p[2][c]-p[3][c])*u*u+(-p[0][c]+3*p[1][c]-3*p[2][c]+p[3][c])*u*u*u));}
export const course=Array.from({length:769},(_,i)=>{const p=curve(i*8/768);return {x:p[0],y:p[1],s:0,t:i*8/768}});
for(let i=1;i<course.length;i++)course[i].s=course[i-1].s+Math.hypot(course[i].x-course[i-1].x,course[i].y-course[i-1].y);
export const length=course.at(-1)!.s;
export const wrap=(v:number)=>((v%length)+length)%length;
export function at(s:number,lane=0){s=wrap(s);let lo=0,hi=768;while(hi-lo>1){const m=(lo+hi)>>1;if(course[m].s<s)lo=m;else hi=m;}const a=course[lo],b=course[hi],f=(s-a.s)/(b.s-a.s),dx=b.x-a.x,dy=b.y-a.y,h=Math.atan2(dx,dy);return {x:a.x+(b.x-a.x)*f+Math.cos(h)*lane,y:a.y+(b.y-a.y)*f-Math.sin(h)*lane,heading:h,t:a.t+(b.t-a.t)*f};}
export function nearest(x:number,y:number){let best=Infinity,res={s:0,x:0,y:0,d:0,lane:0,t:0,heading:0};for(let i=0;i<768;i++){const a=course[i],b=course[i+1],dx=b.x-a.x,dy=b.y-a.y,q=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy))),px=a.x+dx*q,py=a.y+dy*q,d=(px-x)**2+(py-y)**2;if(d<best){best=d;const h=Math.atan2(dx,dy);res={x:px,y:py,s:a.s+q*(b.s-a.s),d:Math.sqrt(d),lane:(x-px)*Math.cos(h)-(y-py)*Math.sin(h),heading:h,t:a.t+(b.t-a.t)*q}}}return res;}
export const leftWidth=(t:number,y:number)=>12+((t<2.4||t>7.3)?17*Math.exp(-Math.max(0,y)/28):0);
export const angle=(v:number)=>Math.atan2(Math.sin(v),Math.cos(v));
