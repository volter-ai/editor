// SPDX-License-Identifier: MIT
// Copyright 2026 Volter AI, Inc.
export type RacePhase='ready'|'countdown'|'racing'|'finished';
export interface Racer {id:number;name:string;x:number;y:number;heading:number;speed:number;progress:number;lap:number;finished:boolean;finishTime:number|null;coins:number;boost:number;parked:boolean;drifting:boolean;offroad:boolean;}
export interface RaceEvent {time:number;frame:number;kind:string;[key:string]:unknown}
export interface RaceState {phase:RacePhase;paused:boolean;autoplay:boolean;time:number;frame:number;countdown:number;speed:number;lap:number;coins:number;place:number;boost:number;racers:Racer[];events:RaceEvent[];message:string;}
export const initialState:RaceState={phase:'ready',paused:false,autoplay:false,time:0,frame:0,countdown:3,speed:0,lap:1,coins:8,place:6,boost:0,racers:[],events:[],message:'CANYON COMET'};
let state=initialState;const listeners=new Set<()=>void>();
export const getRaceState=()=>state;
export const subscribeRaceState=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn)}};
export const publishRaceState=(s:RaceState)=>{state=s;for(const fn of listeners)fn()};
export type Command='start'|'auto'|'pause'|'restart'|'boost';
const commands:Command[]=[];
export const raceAction=(cmd:Command)=>commands.push(cmd);
export const consumeCommands=()=>commands.splice(0);
