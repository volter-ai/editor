/**
 * The editor's public brand contract.
 *
 * Browser metadata, the in-product logo and the server-owned pages all read
 * this module. The mark is the brand's `volter-editor` logo, referenced by URL
 * from brand.volter.ai: this repository is public and bundles no brand art.
 * A product that composes the kit may name its own logo
 * (`ProductDefinition.logo`); this is the kit's own.
 */
export const EDITOR_BRAND = {
  name: 'Volter Editor',
  shortName: 'Volter Editor',
  title: 'Volter Editor',
  description:
    'An extensible visual editor with Blender modeling and agent automation.',
  themeColor: '#101318',
  accentColor: '#579EFF',
  logo: 'https://brand.volter.ai/logo/volter-editor/svg',
} as const;

/** Format the live browser window title around the current surface. `brand` is the running
 *  product's display name (e.g. "Volter Cyclotron") when the page knows it; the platform's own
 *  name otherwise, so a tab always says which product it is once the product has answered. */
export function editorDocumentTitle(subject?: string | null, brand?: string | null): string {
  const normalized = subject?.trim();
  const name = brand?.trim() || EDITOR_BRAND.name;
  return normalized ? `${normalized} — ${name}` : name;
}

/** The mark as markup for server-owned and fallback pages. */
export function editorMarkImg(logo: string = EDITOR_BRAND.logo): string {
  return `<img src="${logo}" alt="${EDITOR_BRAND.shortName}" width="160" height="160">`;
}
