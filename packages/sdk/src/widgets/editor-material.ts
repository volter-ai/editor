import type { EditorTheme } from './theme';

type MaterialColor = Pick<
  EditorTheme['color'],
  'surface' | 'boundary' | 'neutralOverlay' | 'scrim'
>;

export interface EditorMaterialDefinition {
  readonly id: 'glass';
  readonly color: MaterialColor;
  readonly shape: EditorTheme['shape'];
  readonly elevation: EditorTheme['elevation'];
  readonly treatment: NonNullable<EditorTheme['treatment']>;
  readonly reducedTransparency: {
    readonly surface: EditorTheme['color']['surface'];
    readonly scrim: string;
  };
}

export const CLASSIC_MATERIAL = Object.freeze({
  id: 'classic' as const,
  shape: { small: '3px', medium: '6px', large: '8px', full: '9999px' },
  elevation: {
    small: '0 2px 8px rgba(0,0,0,0.6)',
    medium: '0 4px 12px rgba(0,0,0,0.5)',
    large: '0 8px 32px rgba(0,0,0,0.6)',
  },
});

/** Canonical Glass material. It cannot contain accent or semantic colors. */
export const GLASS_MATERIAL: EditorMaterialDefinition = Object.freeze({
  id: 'glass',
  color: {
    surface: {
      shell: '#12161f',
      panel: 'rgba(255,255,255,0.06)',
      chrome: 'rgba(255,255,255,0.10)',
      raised: 'rgba(255,255,255,0.16)',
      inset: 'rgba(10,14,22,0.38)',
      overlay: 'rgba(255,255,255,0.08)',
    },
    boundary: {
      default: 'rgba(255,255,255,0.22)',
      strong: 'rgba(255,255,255,0.38)',
    },
    neutralOverlay: {
      hover: 'color-mix(in srgb, currentColor 10%, transparent)',
      active: 'color-mix(in srgb, currentColor 16%, transparent)',
    },
    scrim: 'rgba(8,12,20,0.35)',
  },
  shape: { small: '4px', medium: '8px', large: '14px', full: '9999px' },
  elevation: {
    small: '0 4px 14px -6px rgba(0,0,0,0.45)',
    medium: '0 8px 24px -10px rgba(0,0,0,0.5)',
    large: '0 20px 46px -16px rgba(0,0,0,0.55), 0 4px 14px -6px rgba(0,0,0,0.35)',
  },
  treatment: {
    backdropBlurPx: 1,
    backdropSaturation: 1.15,
    edgeSpecular: 0.7,
    specularAngleDeg: 120,
    refractionBezelPx: 56,
    refractionThickness: 1.25,
    textShadowOpacity: 0.72,
    contentFrostBlurPx: 24,
    ambientLiftOpacity: 0.07,
    adaptiveContent: true,
    brightTextShadowOpacity: 0,
    brightFrostBg: 'rgba(255,255,255,0.3)',
  },
  reducedTransparency: {
    surface: {
      shell: '#12161f',
      panel: '#33373e',
      chrome: '#3d4047',
      raised: '#4b4e55',
      inset: '#23272f',
      overlay: '#383b43',
    },
    scrim: 'rgba(8,12,20,0.5)',
  },
});
