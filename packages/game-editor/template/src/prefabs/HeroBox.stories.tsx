import type { Meta, StoryObj } from '@storybook/react';
import { HeroBox } from './HeroBox';

const meta = {
  title: 'Starter/Hero Box',
  component: HeroBox,
  // `color` is deliberately NOT pinned here: the story exhibits the
  // component's own default, so Apply-to-Component changes what the board
  // shows. A pinned copy of the default masked every applied change (two
  // humans read the stale exhibit as breakage — runhuman passes 43/44).
  args: {
    name: 'Hero Box',
    rotation: [0, -0.28, 0],
  },
} satisfies Meta<typeof HeroBox>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  parameters: { vgai: { default: true } },
};
