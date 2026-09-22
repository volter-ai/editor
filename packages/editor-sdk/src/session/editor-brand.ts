/**
 * The editor's public brand contract.
 *
 * Browser metadata, generated image assets, and the in-product logo all read
 * this module. Keep the mark as geometry rather than a second hand-maintained
 * SVG so every public surface presents the same logo. The angular symbol is
 * shared with the marketing website; VgaiLogo.css owns assembly/loading motion.
 */
export const EDITOR_BRAND = {
  name: 'Volter Editor',
  shortName: 'Volter Editor',
  title: 'Volter Editor',
  description:
    'An extensible visual editor with Blender modeling and agent automation.',
  themeColor: '#101318',
  accentColor: '#579EFF',
} as const;

/** Shared angular three-piece symbol, sourced from https://www.volter.ai/volter-logo.svg. */
export const VGAI_LOGO = {
  viewBox: '0 0 160 160',
  transform: 'translate(24 20) scale(6.6)',
  pieces: [
    {
      id: 'a',
      path: 'M15.7695 1.16406C16.0141 1.5523 16.1668 2.01298 16.1865 2.52539L16.6719 15.1338C16.7534 17.2536 14.5094 18.667 12.6328 17.6777L10.5869 16.5986L15.7695 1.16406Z',
    },
    {
      id: 'b',
      path: 'M5.31836 13.8213L1.4707 11.793C-0.405775 10.8036 -0.507886 8.15396 1.28711 7.02344L1.91699 6.62598L5.31836 13.8213Z',
    },
    {
      id: 'c',
      path: 'M8.41309 12.4766L4.79102 4.81543L11.9639 0.298828C12.1707 0.168586 12.3854 0.0706555 12.6025 0.000976562L8.41309 12.4766Z',
    },
  ],
} as const;

/** Format the live browser window title around the current surface. */
export function editorDocumentTitle(subject?: string | null): string {
  const normalized = subject?.trim();
  return normalized ? `${normalized} — ${EDITOR_BRAND.name}` : EDITOR_BRAND.name;
}

/** Render the shared symbol in one color, preserving all three source paths. */
export function vgaiLogoPaths(fill = '#F3F4F6'): string {
  return VGAI_LOGO.pieces.map((piece) => `<path d="${piece.path}" fill="${fill}"/>`).join('');
}

/** The standalone transparent mark for docs, partners, and compositing. */
export function editorMarkSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="${VGAI_LOGO.viewBox}" role="img" aria-label="${EDITOR_BRAND.shortName}">
  <g transform="${VGAI_LOGO.transform}">${vgaiLogoPaths()}</g>
</svg>
`;
}

/**
 * The editor app icon as a standalone SVG.
 *
 * Generated browser/native assets and transient server pages share this
 * exact renderer so none of those surfaces can grow a hand-copied logo.
 */
export function editorAppIconSvg(markScale = 1): string {
  const inset = (1 - markScale) * 80;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160" role="img" aria-label="${EDITOR_BRAND.shortName}">
  <rect width="160" height="160" rx="34" fill="${EDITOR_BRAND.themeColor}"/>
  <g transform="translate(${inset} ${inset}) scale(${markScale})">
    <g transform="${VGAI_LOGO.transform}">${vgaiLogoPaths()}</g>
  </g>
</svg>
`;
}
