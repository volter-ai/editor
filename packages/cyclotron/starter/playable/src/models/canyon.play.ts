// SPDX-License-Identifier: MIT
// Copyright 2026 Volter AI, Inc.
import * as THREE from 'three';
import type {ModelPlayContext} from '@volter/play/play-script';
import {initialState,publishRaceState,consumeCommands,type Racer,type RaceState,type RaceEvent,type Command} from './race-state';
import {at,nearest,length,wrap,angle,leftWidth} from './course';
type Car=Racer & {object:THREE.Object3D;s:number;distance:number;checkpoint:number;lane:number;parked:boolean;boostCooldown:number;drift:number;drifting:boolean;offroad:boolean;collisionCooldown:number;lastDecision:number};
type Inputs={throttle:number;brake:boolean;steer:number;drift:boolean;boost:boolean};
export default function play(ctx:ModelPlayContext){
 const initialPositions=[[0,0],[-6.2,2.7],[4.8,6],[-1.5,24],[1,31],[7,41]];
 const names=['Pip','Miso','Nova','Sprig','Mica','Rook'];
 let state:RaceState={...initialState,events:[],racers:[]};let events:RaceEvent[]=[];let simTime=0,frame=0,clock=0,accumulator=0,previousKeys=new Set<string>(),endTime:number|null=null;let lastManual='';
 // Each race event is kept for the HUD's race state and written to the editor's play log (`cyclotron play-log`).
 const log=(kind:string,detail:Record<string,unknown>={})=>{events.push({time:+simTime.toFixed(3),frame,kind,...detail});if(events.length>1200)events.shift();ctx.log(kind,detail)};
 const cars:Car[]=initialPositions.map(([x,y],id)=>{const object=ctx.find('Kart.'+id);if(!object)throw new Error('Missing authored Kart.'+id);const n=nearest(x,y);return {id,name:names[id],object,x,y,s:n.s,distance:n.s,heading:0,speed:0,progress:n.s/length,lap:1,finished:false,finishTime:null,coins:id===0?8:4,boost:0,checkpoint:1,lane:[0,-4.6,4.6,-2.2,1.8,3.7][id],parked:false,boostCooldown:0,drift:0,drifting:false,offroad:false,collisionCooldown:0,lastDecision:-1}});
 ctx.root.traverse((o:any)=>{if(o.isDirectionalLight){o.shadow.mapSize.set(4096,4096);o.shadow.map?.dispose();o.shadow.map=null}});
 const pickups=new THREE.Group();pickups.name='Race coin pickups';ctx.root.add(pickups);
 const coinMaterial=new THREE.MeshStandardMaterial({color:0xffbe18,metalness:.55,roughness:.25});
 const coinGeometry=new THREE.TorusGeometry(.34,.1,8,20);
 const coins=Array.from({length:24},(_,i)=>{const s=(.25+Math.floor(i/3)*.086)*length, lane=[-4,0,4][i%3],p=at(s,lane);const mesh=new THREE.Mesh(coinGeometry,coinMaterial);mesh.name='Coin.'+i;mesh.position.set(p.x,p.y,.95);mesh.rotation.x=Math.PI/2;mesh.castShadow=true;pickups.add(mesh);return {mesh,x:p.x,y:p.y,ready:0,id:i}});
 const sparks=new THREE.Group();sparks.name='Boost exhaust';ctx.root.add(sparks);const flameMat=new THREE.MeshBasicMaterial({color:0x47e5ff,transparent:true,opacity:.7});const flameGeo=new THREE.ConeGeometry(.18,.8,8);const flames=cars.map(()=>{const a=new THREE.Mesh(flameGeo,flameMat);a.rotation.x=Math.PI/2;sparks.add(a);return a});
 const reset=(start=false)=>{const auto=state.autoplay;events=[];simTime=frame=clock=accumulator=0;endTime=null;lastManual='';for(const c of cars){const [x,y]=initialPositions[c.id],n=nearest(x,y);Object.assign(c,{x,y,s:n.s,distance:n.s,heading:0,speed:0,progress:n.s/length,lap:1,finished:false,finishTime:null,coins:c.id===0?8:4,boost:0,checkpoint:1,parked:false,boostCooldown:0,drift:0,drifting:false,offroad:false,collisionCooldown:0,lastDecision:-1});c.object.position.set(x,y,0);c.object.rotation.set(0,0,0)}for(const c of coins){c.ready=0;c.mesh.visible=true;c.mesh.rotation.z=0;}flames.forEach(f=>f.visible=false);state={...initialState,autoplay:auto,phase:start?'countdown':'ready',events:[],racers:[]};log('restart',{autoplay:auto,positions:cars.map(c=>({id:c.id,x:c.x,y:c.y}))});if(start)log('phase',{phase:'countdown'});publish();};
 const publish=()=>{const order=[...cars].sort((a,b)=>a.finished&&b.finished?(a.finishTime??0)-(b.finishTime??0):a.finished?-1:b.finished?1:b.distance-a.distance);const p=cars[0];state={...state,time:simTime,frame,speed:p.speed,lap:p.lap,coins:p.coins,boost:p.boost,place:order.indexOf(p)+1,racers:cars.map(c=>({id:c.id,name:c.name,x:+c.x.toFixed(3),y:+c.y.toFixed(3),heading:+c.heading.toFixed(4),speed:+c.speed.toFixed(3),progress:+(c.distance/length).toFixed(5),lap:c.lap,finished:c.finished,finishTime:c.finishTime,coins:c.coins,boost:+c.boost.toFixed(3),parked:c.parked,drifting:c.drifting,offroad:c.offroad})),events:[...events],message:cars.every(c=>c.parked)?'All six racers finished':state.message};publishRaceState(state)};
 const start=()=>{if(state.phase==='ready'){state={...state,phase:'countdown',countdown:3};log('phase',{phase:'countdown'})}};
 const command=(cmd:Command)=>{if(cmd==='restart'){reset(state.autoplay);return;}if(cmd==='pause'){if(state.phase!=='ready'){state={...state,paused:!state.paused};log(state.paused?'pause':'resume')}return;}if(state.paused)return;if(cmd==='auto'){state={...state,autoplay:!state.autoplay};log('autoplay',{enabled:state.autoplay});if(state.autoplay)start()}else if(cmd==='start')start();};
 function controller(c:Car):Inputs{
  const look=at(c.s+7+Math.abs(c.speed)*.45,c.finished?9.5:c.lane);const desired=Math.atan2(look.x-c.x,look.y-c.y),err=angle(desired-c.heading);const bend=Math.abs(angle(at(c.s+18).heading-at(c.s+3).heading));const target=(c.id===0?24.5:20.5+c.id*.25)-Math.min(6,bend*7);
  const inputs={throttle:c.speed<target?1:0,brake:c.speed>target+1,steer:Math.max(-1,Math.min(1,err*2.4)),drift:Math.abs(err)>(c.drifting?.20:.40)&&c.speed>13,boost:!c.finished&&bend<.15&&c.coins>=2&&c.speed>15&&c.boostCooldown===0};
  if(c.finished){const remaining=length*3+28+c.id*8-c.distance;const desiredSpeed=Math.min(15,Math.sqrt(Math.max(0,remaining-.7)*32));inputs.throttle=c.speed<desiredSpeed-.2?1:0;inputs.brake=c.speed>desiredSpeed+.05;inputs.drift=false;inputs.boost=false;}
  if(c.id===0&&simTime-c.lastDecision>2){c.lastDecision=simTime;log('autoplay-decision',{racer:c.id,targetSpeed:+target.toFixed(2),target:{x:+look.x.toFixed(2),y:+look.y.toFixed(2)},inputs:{...inputs,steer:+inputs.steer.toFixed(2)}})}
  return inputs;
 }
 const boost=(c:Car,drift=false)=>{if(c.boostCooldown>0||c.finished)return;if(!drift&&c.coins<2)return;if(!drift)c.coins-=2;c.boost=drift?.7:1.4;c.boostCooldown=drift?1.2:3;log('boost',{racer:c.id,source:drift?'drift':'coins',coins:c.coins,duration:c.boost})};
 function drive(c:Car,input:Inputs,dt:number){
  if(c.parked)return;
  c.collisionCooldown=Math.max(0,c.collisionCooldown-dt);c.boostCooldown=Math.max(0,c.boostCooldown-dt);
  if(c.boost>0){c.boost=Math.max(0,c.boost-dt);if(c.boost===0)log('boost-end',{racer:c.id})}
  if(input.boost)boost(c);
  const drift=input.drift&&Math.abs(input.steer)>.1&&c.speed>6;
  if(drift!==c.drifting){log(drift?'drift-start':'drift-end',{racer:c.id,charge:+c.drift.toFixed(2)});if(!drift&&c.drift>.6)boost(c,true);if(!drift)c.drift=0;c.drifting=drift}if(drift)c.drift+=dt;
  let acceleration=input.throttle*12;
  if(input.brake)acceleration=c.speed>0?-22:(c.finished?0:-9);
  if(c.finished&&Math.abs(c.speed)<=.5&&c.distance>=3*length+26.5+c.id*8){c.speed=0;c.parked=true;log('parked',{racer:c.id,x:c.x,y:c.y,clearedFinish:true});return;}
  const drag=input.throttle===0&&!input.brake?2.8:1.7;
  if(c.speed!==0)acceleration-=Math.sign(c.speed)*drag;
  c.speed+=acceleration*dt;
  const maxSpeed=c.boost>0?33:25.5;
  c.speed=Math.max(-7,Math.min(maxSpeed,c.speed));if(!input.throttle&&!input.brake&&Math.abs(c.speed)<.12)c.speed=0;
  const turn=input.steer*(drift?1.9:1.45)*Math.min(1,Math.abs(c.speed)/7)*(c.speed<0?-1:1);c.heading=angle(c.heading+turn*dt);
  c.x+=Math.sin(c.heading)*c.speed*dt;c.y+=Math.cos(c.heading)*c.speed*dt;
  let n=nearest(c.x,c.y);const left=leftWidth(n.t,n.y),limit=n.lane<0?left:12;
  const offroad=n.d>limit-1.2;
  if(offroad!==c.offroad){c.offroad=offroad;log(offroad?'surface-leave':'surface-enter',{racer:c.id,surface:'Circuit asphalt',x:+c.x.toFixed(2),y:+c.y.toFixed(2)})}
  if(offroad)c.speed*=Math.exp(-1.8*dt);
  if(n.d>limit+1.2){const sign=Math.sign(n.lane),p=at(n.s,sign*(limit+1));c.x=p.x;c.y=p.y;c.speed*=.6;if(c.collisionCooldown===0){log('barrier-contact',{racer:c.id,object:sign<0?'Outside guardrail':'Inside sandstone verge',x:c.x,y:c.y});c.collisionCooldown=.8}n=nearest(c.x,c.y)}
  let delta=n.s-c.s;if(delta>length/2)delta-=length;if(delta<-length/2)delta+=length;
  // Projection advances only through physically adjacent road segments.
  if(Math.abs(delta)<3+Math.abs(c.speed)*dt*2)c.distance+=delta;
  c.s=n.s;
  if(!c.finished&&c.distance>=c.checkpoint*length/4){log('checkpoint',{racer:c.id,checkpoint:c.checkpoint,x:c.x,y:c.y});c.checkpoint++;}
  const lap=Math.min(3,Math.max(1,Math.floor(c.distance/length)+1));if(lap!==c.lap){c.lap=lap;log('lap',{racer:c.id,lap})}
  if(!c.finished&&c.distance>=3*length&&c.checkpoint>=12){c.finished=true;c.finishTime=simTime;log('finish',{racer:c.id,name:c.name,time:simTime,x:c.x,y:c.y});if(c.id===0){endTime=simTime;state={...state,phase:'finished'};log('phase',{phase:'finished'})}}
  c.object.position.set(c.x,c.y,0);c.object.rotation.set(0,0,-c.heading);
 }
 const eye=new THREE.Vector3(),target=new THREE.Vector3();
 function camera(){const p=cars[0],h=p.heading;ctx.root.localToWorld(eye.set(p.x-Math.sin(h)*10.7,p.y-Math.cos(h)*10.7,4.7));ctx.root.localToWorld(target.set(p.x+Math.sin(h)*18,p.y+Math.cos(h)*18,.05));ctx.camera.position.copy(eye);ctx.camera.up.set(0,1,0);ctx.camera.lookAt(target);const cam=ctx.camera as THREE.PerspectiveCamera;cam.fov=47;cam.far=180;cam.updateProjectionMatrix();}
 function physics(dt:number){
  if(state.phase==='ready'||state.paused||cars.every(c=>c.parked))return;
  simTime+=dt;frame++;
  if(state.phase==='countdown'){state={...state,countdown:Math.max(0,state.countdown-dt)};if(state.countdown===0){state={...state,phase:'racing'};log('phase',{phase:'racing'});}return;}
  const k=ctx.keys,manual:Inputs={throttle:k.has('ArrowUp')||k.has('KeyW')?1:0,brake:k.has('ArrowDown')||k.has('KeyS'),steer:(k.has('ArrowRight')||k.has('KeyD')?1:0)-(k.has('ArrowLeft')||k.has('KeyA')?1:0),drift:k.has('Space'),boost:k.has('ShiftLeft')||k.has('ShiftRight')};
  const manualString=JSON.stringify(manual);if(!state.autoplay&&!botNow&&manualString!==lastManual){lastManual=manualString;log('manual-input',{inputs:manual});}
  for(const c of cars)drive(c,c.id===0&&!state.autoplay&&!c.finished?manual:controller(c),dt);
  for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++){
   const a=cars[i],b=cars[j];if(a.finished||b.finished)continue;const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);if(d>0&&d<2){const push=(2-d)*.51;a.x-=dx/d*push;a.y-=dy/d*push;b.x+=dx/d*push;b.y+=dy/d*push;if(a.collisionCooldown===0&&b.collisionCooldown===0){a.speed*=.85;b.speed*=.85;log('kart-contact',{a:i,b:j,object:'Kart.'+j,x:a.x,y:a.y});a.collisionCooldown=b.collisionCooldown=.5}}
  }
  for(const coin of coins){coin.mesh.visible=simTime>=coin.ready;if(!coin.mesh.visible)continue;coin.mesh.rotation.z=simTime*2;for(const c of cars){if(c.finished)continue;if(Math.hypot(c.x-coin.x,c.y-coin.y)<1.5){c.coins++;coin.ready=simTime+6;coin.mesh.visible=false;log('pickup',{racer:c.id,object:'Coin.'+coin.id,coins:c.coins});break}}}
  cars.forEach((c,i)=>{const f=flames[i];f.visible=c.boost>0&&!c.parked;f.position.set(c.x-Math.sin(c.heading)*1.8,c.y-Math.cos(c.heading)*1.8,.38);f.rotation.set(Math.PI/2,0,-c.heading);f.scale.setScalar(.8+.25*Math.sin(simTime*42));});
 }
 // THE GAME PANEL'S AUTOPLAY (`play autoplay on race`): a bot that drives Pip with the keys a person
 // holds, through the manual code above, steering as the race's own AUTO does (`controller`, which logs
 // its decisions). Steering keys are pulsed so their average follows that steer; while the bot drives,
 // those key changes are not logged as manual input.
 let botDriving=false,botNow=false,steerDebt=0;
 ctx.autoplay({race:()=>{
  botDriving=true;const c=cars[0];
  if(state.paused)return {keys:[],state:'race paused'};
  if(state.phase==='ready')return {keys:['ArrowUp'],state:'starting the race'};
  if(state.phase==='countdown')return {keys:[],state:'waiting for the countdown'};
  if(c.finished)return {keys:[],state:'finished; Pip parks past the line'};
  const input=controller(c),keys:string[]=[];steerDebt+=input.steer;
  if(steerDebt>=.5){keys.push('ArrowRight');steerDebt-=1}else if(steerDebt<=-.5){keys.push('ArrowLeft');steerDebt+=1}
  if(input.throttle)keys.push('ArrowUp');if(input.brake)keys.push('ArrowDown');if(input.drift)keys.push('Space');if(input.boost)keys.push('ShiftLeft');
  return {keys,state:`racing lap ${c.lap} of 3`};
 }});
 reset(false);
 return {update(dt:number){
  botNow=botDriving;botDriving=false;
  const keyCommands:[string,Command][]=[['Enter','start'],['KeyO','auto'],['KeyP','pause'],['KeyR','restart']];
  const commands=consumeCommands();for(const [key,cmd]of keyCommands)if(ctx.keys.has(key)&&!previousKeys.has(key))commands.push(cmd);
  for(const cmd of commands)command(cmd);
  const moving=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD'].some(k=>ctx.keys.has(k));
  if(moving&&!state.paused&&!cars[0].finished){if(state.autoplay){state={...state,autoplay:false};log('autoplay',{enabled:false,cause:'manual takeover'})}start()}
  previousKeys=new Set(ctx.keys);if(!state.paused){accumulator+=Math.min(dt,.1);while(accumulator>=1/60){physics(1/60);accumulator-=1/60}}else accumulator=0;
  camera();clock+=dt;if(clock>.075||commands.length){publish();clock=0;}
 },dispose(){pickups.removeFromParent();sparks.removeFromParent();coinGeometry.dispose();coinMaterial.dispose();flameGeo.dispose();flameMat.dispose();}};
}
