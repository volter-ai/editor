import type { Meta, StoryObj } from '@storybook/react';
import { JumpPad } from './JumpPad';

const meta = {
  title: 'Gameplay/Jump Pad',
  component: JumpPad,
  args: { name: 'Jump Pad' },
} satisfies Meta<typeof JumpPad>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
