// SPDX-License-Identifier: MIT
// Copyright 2026 Volter AI, Inc.
import React, { useState } from 'react';
import GameUI from './game';
import { RaceHud } from './race-hud';
import { RaceButton, RaceCounters, RaceMenu, BoostMeter } from './race-widgets';
import { initialState, type RaceState } from '../models/race-state';
const racing = { ...initialState, phase: 'racing' as const, speed: 26, time: 38.2, lap: 2, place: 3, coins: 12 };
function Preview(args: RaceState) { const [state, set] = useState(args); return <RaceHud {...state} onAction={cmd => set(old => cmd === 'auto' ? { ...old, autoplay: !old.autoplay } : cmd === 'pause' ? { ...old, paused: !old.paused } : cmd === 'start' ? { ...old, phase: 'racing' } : cmd === 'restart' ? { ...initialState } : old)}/>; }
const background = { width: '100%', height: '100%', background: 'radial-gradient(ellipse at top,#496b6a,#253a3c)', position: 'relative' as const, overflow: 'hidden' };
function Buttons() { const [boost, set] = useState(false); return <div style={{ ...background, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 25 }}><RaceButton onClick={() => set(!boost)}>{boost ? 'BOOST!' : 'LET’S RACE'}</RaceButton><RaceButton secondary>CHANGE KART</RaceButton><RaceButton disabled>LOCKED</RaceButton></div>; }
export default { title: 'Canyon Comet/Game interface', component: GameUI, render: (args: RaceState) => <div style={background}><Preview {...args}/></div>, parameters: { layout: 'fullscreen', viewport: { options: { game: { name: 'Game UI', styles: { width: '640px', height: '360px' } } } }, volter: { defaultStory: 'Race HUD' } }, globals: { viewport: { value: 'game' } }, args: racing };
export const RaceHUD = { name: 'Race HUD', parameters: { volter: { default: true } } };
export const PauseMenu = { name: 'Pause menu', render: () => { const [paused, set] = useState(true); return <div style={{ ...background, display: 'grid', placeItems: 'center' }}>{paused ? <RaceMenu state={{ ...racing, paused: true }} onAction={() => set(false)}/> : <RaceButton onClick={() => set(true)}>PAUSE</RaceButton>}</div>; } };
export const Counters = { name: 'Coins · laps · boost', render: () => <div style={{ ...background, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 40 }}><RaceCounters coins={12} lap={2} place={3}/><BoostMeter value={5}/><BoostMeter value={8}/></div> };
export const ButtonsStates = { name: 'Button states', render: () => <Buttons /> };
