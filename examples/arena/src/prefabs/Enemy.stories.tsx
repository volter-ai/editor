import { Physics } from '@react-three/rapier';
import type { Meta, StoryObj } from '@storybook/react';
import { Enemy } from './Enemy';

const meta = {
  title: 'Gameplay/Enemy',
  component: Enemy,
  args: { name: 'Enemy Preview', variant: 'breacher' },
  decorators: [
    (Story) => (
      <Physics gravity={[0, -19.5, 0]}>
        <Story />
      </Physics>
    ),
  ],
} satisfies Meta<typeof Enemy>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Breacher: Story = {};
export const Overwatch: Story = { args: { variant: 'overwatch' } };
