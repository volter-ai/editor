import { Physics } from '@react-three/rapier';
import type { Meta, StoryObj } from '@storybook/react';
import { Player } from './Player';

const meta = {
  title: 'Gameplay/Player',
  component: Player,
  args: { name: 'Player Preview', position: [0, 1.72, 0] },
  decorators: [
    (Story) => (
      <Physics gravity={[0, -19.5, 0]}>
        <Story />
      </Physics>
    ),
  ],
} satisfies Meta<typeof Player>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
