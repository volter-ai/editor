// SPDX-License-Identifier: MIT
// Copyright 2026 Volter AI, Inc.
import React from 'react';
import type { Command, RaceState } from '../models/race-state';
import { raceAction } from '../models/race-state';
const ink = '#253a3c', gold = '#ffc92e';
const type = { fontFamily: 'Arial, sans-serif', fontWeight: 900, fontStyle: 'italic' } as const;
export function RaceButton({ children, onClick, secondary = false, disabled = false }: {
    children: React.ReactNode;
    onClick?: () => void;
    secondary?: boolean;
    disabled?: boolean;
}) { return <button disabled={disabled} onClick={onClick} style={{ ...type, fontSize: 20, letterSpacing: '.01em', padding: '12px 25px', border: `3px solid ${ink}`, borderRadius: 15, color: secondary ? 'white' : ink, background: secondary ? ink : gold, boxShadow: `inset 0 3px 0 ${secondary ? '#ffffff38' : '#fff4b7'},0 4px 0 ${ink}`, transform: 'skew(-5deg)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .4 : 1 }}>{children}</button>; }
export function RaceCounters({ coins, lap, place }: {
    coins: number;
    lap: number;
    place: number;
}) { return <div style={{ ...type, display: 'flex', gap: 12, alignItems: 'center', color: 'white', fontSize: 36, textShadow: `0 3px 0 ${ink}` }}><span style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: ink, borderRadius: 18, border: '3px solid #ffffff65' }}><b style={{ display: 'grid', placeItems: 'center', width: 31, height: 37, background: gold, borderRadius: '50%', color: '#ef9500', border: '3px solid #ffe77c', boxShadow: '0 0 0 2px #af6900', fontStyle: 'normal', fontSize: 24 }}>Ⅰ</b>{String(coins).padStart(2, '0')}</span><span style={{ padding: '8px 16px', background: ink, borderRadius: 18, border: '3px solid #ffffff65' }}><small style={{ fontSize: 13, verticalAlign: 'middle', marginRight: 8 }}>LAP</small>{lap}<small style={{ fontSize: 20 }}>/3</small></span><span style={{ fontSize: 64, color: gold, WebkitTextStroke: `2px ${ink}`, paintOrder: 'stroke fill' }}>{place}<sup style={{ fontSize: 20 }}>{place === 1 ? "ST" : place === 2 ? "ND" : place === 3 ? "RD" : "TH"}</sup></span></div>; }
export function BoostMeter({ value = 5 }: {
    value?: number;
}) { return <div style={{ ...type, display: 'flex', gap: 13, alignItems: 'center', color: 'white', fontSize: 18, textShadow: `0 2px 0 ${ink}` }}><span>BOOST</span><div style={{ display: 'flex', gap: 4, background: ink, padding: 7, border: '2px solid #ffffff65', borderRadius: 8, transform: 'skew(-12deg)' }}>{Array.from({ length: 8 }, (_, i) => <span key={i} style={{ width: 20, height: 22, background: i < value ? gold : '#ffffff38', borderTop: '2px solid #ffffff38' }}/>)}</div></div>; }
export function RaceMenu({ state, onAction = raceAction }: {
    state: RaceState;
    onAction?: (cmd: Command) => void;
}) { const finished = state.phase === 'finished'; return <div style={{ ...type, display: 'flex', alignItems: 'center', flexDirection: 'column', gap: 20, color: 'white', pointerEvents: 'auto', textAlign: 'center' }}><strong style={{ fontSize: 55, lineHeight: 1, color: gold, WebkitTextStroke: `2px ${ink}`, paintOrder: 'stroke fill', textShadow: `0 5px 0 ${ink}` }}>{finished ? 'RACE COMPLETE!' : 'PAUSED'}</strong><span style={{ fontSize: 17, letterSpacing: 2, textShadow: `0 2px 0 ${ink}` }}>CANYON COMET · LAP {state.lap} / 3</span>{finished && <span style={{ fontSize: 22 }}>POSITION {state.place} / 6 · {state.time.toFixed(1)}s</span>}<RaceButton onClick={() => onAction(finished ? 'restart' : 'pause')}>{finished ? 'RACE AGAIN' : 'KEEP RACING'}</RaceButton><RaceButton secondary onClick={() => onAction('restart')}>RESTART RACE</RaceButton></div>; }
export function RaceControls({ state, onAction = raceAction }: {
    state: RaceState;
    onAction?: (cmd: Command) => void;
}) { return <div style={{ display: 'flex', gap: 12, alignItems: 'center', pointerEvents: 'auto', transformOrigin: 'right bottom', transform: 'scale(.7)' }}>{state.phase === 'ready' && <RaceButton onClick={() => onAction('start')}>RACE!</RaceButton>}<RaceButton secondary onClick={() => onAction('auto')}>{state.autoplay ? 'AUTO ON' : 'AUTO'}</RaceButton><RaceButton secondary onClick={() => onAction('pause')}>{state.paused ? 'RESUME' : 'PAUSE'}</RaceButton><RaceButton secondary onClick={() => onAction('restart')}>RESTART</RaceButton></div>; }
