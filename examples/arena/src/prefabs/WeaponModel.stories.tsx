import type { Meta, StoryObj } from '@storybook/react';
import { WeaponModel } from './WeaponModel';

const meta = {
  title: 'Props/Arena Weapon',
  component: WeaponModel,
  args: { name: 'Arena Weapon', kind: 'pistol', scale: 0.35 },
} satisfies Meta<typeof WeaponModel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pistol: Story = {};
export const Rifle: Story = { args: { kind: 'rifle', name: 'Arena Rifle' } };
export const GrenadeLauncher: Story = {
  args: { kind: 'grenade', name: 'Arena Grenade Launcher' },
};
