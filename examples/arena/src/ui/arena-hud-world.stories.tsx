import type { Meta, StoryObj } from '@storybook/react';
import { type ArenaState, INITIAL_ARENA_STATE } from '../arena-state';
import { ArenaHud } from './arena-hud';
import ArenaHudWorld from './arena-hud-world';

function arenaState(patch: Partial<ArenaState> = {}): ArenaState {
  return {
    ...INITIAL_ARENA_STATE,
    ownedWeapons: [...INITIAL_ARENA_STATE.ownedWeapons],
    ...patch,
  };
}

const meta = {
  title: 'First Person Arena/HUD',
  // The `ui` root's manifest entry — the component this document is about,
  // and the only thing that associates these states with that root. The entry
  // itself reads live world state, so the states below render its
  // presentational body with authored state instead.
  component: ArenaHudWorld,
  render: (args) => <ArenaHud {...args} />,
  parameters: {
    layout: 'fullscreen',
    vgai: { defaultStory: 'Playing' },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          background:
            'linear-gradient(180deg, #63b8ee 0%, #bfe8ff 42%, #d7d3c7 42.3%, #9b978e 100%)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: '42% 0 0',
            opacity: 0.22,
            backgroundImage:
              'linear-gradient(rgba(42,48,53,.62) 1px, transparent 1px), linear-gradient(90deg, rgba(42,48,53,.62) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            transform: 'perspective(520px) rotateX(54deg) scale(1.45)',
            transformOrigin: '50% 0',
          }}
        />
        <Story />
      </div>
    ),
  ],
  args: {
    state: arenaState(),
  },
} satisfies Meta<typeof ArenaHud>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playing: Story = {};

export const RifleEquipped: Story = {
  args: {
    state: arenaState({
      weapon: 'rifle',
      ownedWeapons: ['pistol', 'rifle'],
      ammo: 24,
      reserveAmmo: 90,
      kills: 3,
      deaths: 1,
    }),
  },
};

export const GrenadeLauncherEquipped: Story = {
  args: {
    state: arenaState({
      weapon: 'grenade',
      ownedWeapons: ['pistol', 'rifle', 'grenade'],
      ammo: 4,
      reserveAmmo: 12,
      kills: 7,
      deaths: 2,
    }),
  },
};

export const WeaponPickup: Story = {
  args: {
    state: arenaState({
      weapon: 'rifle',
      ownedWeapons: ['pistol', 'rifle'],
      ammo: 30,
      reserveAmmo: 90,
      message: 'Rifle acquired',
    }),
  },
};

export const HitConfirmed: Story = {
  args: {
    state: arenaState({ hitMarker: 1, ammo: 8, kills: 2 }),
  },
};

export const RecentlyDamaged: Story = {
  args: {
    state: arenaState({ health: 64, damagePulse: 0.82, ammo: 7, deaths: 1 }),
  },
};

export const CriticalHealth: Story = {
  args: {
    state: arenaState({ health: 18, damagePulse: 0.34, ammo: 3, deaths: 2 }),
  },
};

export const EmptyMagazine: Story = {
  args: {
    state: arenaState({
      weapon: 'rifle',
      ownedWeapons: ['pistol', 'rifle'],
      ammo: 0,
      reserveAmmo: 60,
      message: 'Reload',
    }),
  },
};

export const ScoredKill: Story = {
  args: {
    state: arenaState({ kills: 9, deaths: 3, hitMarker: 1, message: 'Opponent eliminated' }),
  },
};

export const Respawning: Story = {
  args: {
    state: arenaState({
      health: 0,
      deaths: 4,
      ammo: 0,
      message: 'Respawning in 2.4',
      respawnRemaining: 2.4,
    }),
  },
};

export const Paused: Story = {
  args: {
    state: arenaState({
      paused: true,
      weapon: 'grenade',
      ownedWeapons: ['pistol', 'rifle', 'grenade'],
      ammo: 2,
      reserveAmmo: 8,
      kills: 5,
      deaths: 2,
    }),
  },
};

export const OvertimeStress: Story = {
  args: {
    state: arenaState({
      weapon: 'rifle',
      ownedWeapons: ['pistol', 'rifle', 'grenade'],
      health: 37,
      ammo: 30,
      reserveAmmo: 999,
      kills: 128,
      deaths: 99,
      message: 'Sudden death overtime',
    }),
  },
};
