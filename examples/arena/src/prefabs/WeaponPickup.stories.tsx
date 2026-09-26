import type { Meta, StoryObj } from '@storybook/react';
import { WeaponPickup } from './WeaponPickup';

const meta = {
  title: 'Gameplay/Weapon Pickup',
  component: WeaponPickup,
  args: { name: 'Pistol Pickup', kind: 'pistol' },
} satisfies Meta<typeof WeaponPickup>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Pistol: Story = {};
export const Rifle: Story = { args: { name: 'Rifle Pickup', kind: 'rifle' } };
export const GrenadeLauncher: Story = { args: { name: 'Grenade Pickup', kind: 'grenade' } };
