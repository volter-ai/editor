import { ensureCoreUtilitiesRegistered } from '@volter/editor-sdk/kit/components/core-utilities';
import { ProjectHeader } from '@volter/editor-core/components/ProjectHeader';
import { ensureCoreStatusContributionsRegistered } from '@volter/editor-sdk/kit/components/status-contributions';
import {
  installStoryWorkspaceUtilityController,
  StoryEditorRuntime,
} from '../host/design-system-stories/fixtures/editor-runtime';
import { DesignSystemPage, StorySection } from '../host/design-system-stories/StoryLayout';
import { useEditorStore } from '@volter/editor-sdk/kit/editor-runtime';
import { getCurrentProject, setActiveProject } from '@volter/editor-sdk/kit/active-project';
import type { Meta, StoryObj } from '@storybook/react';
import { useLayoutEffect, useState } from 'react';
// The transport is `@volter/editor-game`'s; this gallery story shows its view over
// the design system (a story, not the shell, so no host closure pin counts it).
import { PlayBarView } from '../play-bar/PlayBar';

const meta = {
  title: 'Design System/Application Chrome/Production Shell',
  parameters: { controls: { disable: true } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function ProductionApplicationChrome() {
  const store = useEditorStore();
  const [, ready] = useState(0);
  const [playState, setPlayState] = useState<'stopped' | 'playing' | 'paused'>('stopped');
  const updatePlayState = (next: 'stopped' | 'playing' | 'paused') => {
    store.setPlayState(next);
    setPlayState(next);
  };
  useLayoutEffect(() => {
    const previousProject = getCurrentProject();
    setActiveProject({
      rootPath: '/projects/orbit-workshop',
      config: {
        manifestVersion: 2,
        name: 'Orbit Workshop',
        version: '0.8.0',
        engine: { version: '0.24.0' },
        hasThreeRoot: true,
        // A three root has no scene-file document — its TSX/R3F source IS the
        // document — so `openProject` derives `null` here for every
        // three-root project. Mirror that instead of inventing a scene path.
        defaultScene: null,
      },
    });
    ensureCoreUtilitiesRegistered();
    ensureCoreStatusContributionsRegistered();
    const uninstallWorkspaceController = installStoryWorkspaceUtilityController();
    ready((value) => value + 1);
    return () => {
      uninstallWorkspaceController();
      setActiveProject(previousProject);
    };
  }, []);

  return (
    <DesignSystemPage
      eyebrow="Production application shell"
      title="Global commands and passive status stay global"
      summary="This story renders the same connected project header, runtime telemetry, application menus, transport, status registry, and coding-conversation tray as the editor. Document, panel, and viewport-local chrome remain with their owning production surfaces."
      testId="application-chrome-production"
    >
      <StorySection title="Global command header">
        <div className="ds-production-chrome-stage">
          <ProjectHeader
            transport={
              <PlayBarView
                state={playState}
                playEditRegime={playState === 'stopped' ? null : 'ephemeral'}
                onPlay={() => updatePlayState(playState === 'stopped' ? 'playing' : 'stopped')}
                onPause={() => updatePlayState(playState === 'paused' ? 'playing' : 'paused')}
                onStep={() => undefined}
                onRestart={() => updatePlayState('playing')}
                onStop={() => updatePlayState('stopped')}
              />
            }
          />
        </div>
      </StorySection>
    </DesignSystemPage>
  );
}

function chromeStory(style: 'classic' | 'glass', backdrop: 'dark' | 'light'): Story {
  return {
    globals: { material: style, backdrop },
    render: () => (
      <StoryEditorRuntime>
        <ProductionApplicationChrome />
      </StoryEditorRuntime>
    ),
  };
}

export const Classic: Story = chromeStory('classic', 'dark');
export const GlassDark: Story = chromeStory('glass', 'dark');
export const GlassLight: Story = chromeStory('glass', 'light');
