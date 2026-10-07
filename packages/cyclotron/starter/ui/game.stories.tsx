// SPDX-License-Identifier: MIT
// Copyright 2026 Volter AI, Inc.
import GameUI from './game';
import { RaceHud } from './race-hud';
export default {
  title: 'Race/HUD', component: GameUI, render: (args) => <RaceHud {...args} />,
  parameters: { layout: 'fullscreen', volter: { defaultStory: 'StartLine' } },
  args: { lap: 1, lapTime: 0, lastLap: 0, speed: 0, fps: 60, airborne: false },
};
export const StartLine = {};
export const Racing = { args: { lap: 2, lapTime: 18.24, lastLap: 42.15, speed: 96 } };
export const Jump = { args: { lapTime: 5.82, speed: 88, airborne: true } };
