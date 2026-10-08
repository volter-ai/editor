// SPDX-License-Identifier: MIT
// Copyright 2026 Volter AI, Inc.
import React from 'react';
import { RaceCounters, RaceControls, RaceMenu, BoostMeter } from './race-widgets';
import { course, at, length } from '../models/course';
import { raceAction, type Command, type RaceState } from '../models/race-state';
export function RaceHud(s: RaceState & {
    onAction?: (cmd: Command) => void;
}) {
    const act = s.onAction ?? raceAction;
    const raceTime = s.racers[0]?.finishTime ?? s.time;
    const mp = (x: number, y: number) => ({ x: 23 + (x + 3) * 1.95, y: 40 + (72 - y) * 4.8 });
    const route = course.filter((_, i) => i % 8 === 0).map((p, i) => { const v = mp(p.x, p.y); return `${i ? 'L' : 'M'}${v.x} ${v.y}`; }).join(' ') + ' Z';
    return <div data-testid="race-hud" style={{ position: 'absolute', inset: 0, fontFamily: 'Arial, sans-serif', lineHeight: 1.1, color: 'white', pointerEvents: 'none', containerType: 'size' }}>
 <div style={{ position: 'absolute', left: '2.4%', bottom: '5%', transform: 'scale(.65)', transformOrigin: 'left bottom' }}><RaceCounters coins={s.coins} lap={s.lap} place={s.place}/></div>
 <svg viewBox="0 0 200 580" style={{ position: 'absolute', right: '3.2%', top: '9%', height: '65%', width: '13%', overflow: 'visible' }} aria-label="Circuit map">
 <path d={route} fill="none" stroke="#ffffffe0" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>
 {(s.racers.length ? s.racers : [{ id: 0, progress: 0 }]).map(r => { const p = at(r.progress * length), v = mp(p.x, p.y); return <g key={r.id}><circle cx={v.x} cy={v.y} r={r.id === 0 ? 15 : 7} fill={['#f58a31', '#efc629', '#824fe4', '#64c33c', '#319bbe', '#e85d3a'][r.id]} stroke={r.id === 0 ? '#ffffff' : '#283e44'} strokeWidth={r.id === 0 ? 5 : 2}/>{r.id === 0 && <circle cx={v.x} cy={v.y} r="19" fill="none" stroke="#263d46" strokeWidth="2"/>}</g>; })}
 </svg>
 <div style={{ position: 'absolute', left: '2.6%', top: '2.7%', fontWeight: 900, letterSpacing: 2, fontSize: 'clamp(11px,1.15cqw,18px)', textShadow: '0 2px 4px #243537' }}>{s.phase === 'ready' ? 'CANYON COMET' : `${s.place} / 6  ·  ${Math.floor(raceTime / 60)}:${(raceTime % 60).toFixed(1).padStart(4, '0')}`}</div>
 <div style={{ position: 'absolute', right: '2.5%', bottom: '3.4%' }}><RaceControls state={s} onAction={act}/></div>
 <div style={{ position: 'absolute', left: '50%', bottom: '1%', transform: 'translateX(-50%)', font: '600 10px system-ui', textShadow: '0 1px 3px black', opacity: .88, whiteSpace: 'nowrap' }}>↑ W accelerate · ↓ S brake / reverse · ← → A D steer · Space drift · Shift boost · O auto</div>
 {(s.paused || s.phase === 'finished') && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: '#253a3cbb' }}><RaceMenu state={s} onAction={act}/></div>}
 {s.phase === 'countdown' && <div style={{ position: 'absolute', left: '50%', top: '38%', fontSize: '9cqw', fontWeight: 900, color: '#ffc92e' }}>{Math.ceil(s.countdown)}</div>}
 <div style={{ position: 'absolute', left: '2.5%', top: '13%', transform: 'scale(.65)', transformOrigin: 'left top' }}><BoostMeter value={s.boost > 0 ? 8 : 5}/></div>
 {s.boost > 0 && <div style={{ position: 'absolute', left: '45%', top: '13%', fontSize: '2cqw', fontWeight: 900, color: '#ffe77c' }}>BOOST</div>}
 <output data-testid="race-state" style={{ display: 'none' }}>{JSON.stringify(s)}</output>
 </div>;
}
