import {
  EDITOR_BRAND,
  editorMarkImg,
  editorDocumentTitle,
} from '@volter/editor-sdk/session/editor-brand';

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );
}

export interface EditorBrandPageOptions {
  readonly subject?: string;
  readonly description: string;
  /** Trusted, server-owned markup rendered inside the brand card. */
  readonly contentHtml: string;
  /** Trusted, server-owned script body. */
  readonly scriptHtml?: string;
  readonly socialPreview?: boolean;
}

/**
 * Render the editor's small server-owned HTML surfaces (auth, share, yield).
 * These pages intentionally stay dependency-free because they also appear
 * while the main editor bundle is unavailable.
 */
export function renderEditorBrandPage(options: EditorBrandPageOptions): string {
  const title = editorDocumentTitle(options.subject);
  const social = options.socialPreview
    ? `<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(EDITOR_BRAND.name)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(options.description)}">

<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(options.description)}">
`
    : '';
  const script = options.scriptHtml ? `<script>${options.scriptHtml}</script>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="${EDITOR_BRAND.themeColor}">
<meta name="robots" content="noindex,nofollow">
<meta name="description" content="${escapeHtml(options.description)}">
<link rel="icon" href="${EDITOR_BRAND.logo}" type="image/svg+xml">
<title>${escapeHtml(title)}</title>
${social}
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:${EDITOR_BRAND.themeColor};color:#e8edf3}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 30%,#1c2a3a 0,${EDITOR_BRAND.themeColor} 52%,#0b0e13 100%)}
.brand-card{width:min(440px,100%);padding:34px;text-align:center;border:1px solid rgba(255,255,255,.1);border-radius:20px;background:rgba(23,28,35,.92);box-shadow:0 22px 60px rgba(0,0,0,.38)}
.brand-mark{width:68px;height:68px;margin:0 auto 20px}.brand-mark img{display:block;width:100%;height:100%}h1{margin:0 0 10px;font-size:22px;line-height:1.25;color:#f4f6f8}p{margin:0;color:#aeb9c6;font-size:14px;line-height:1.6}
button,a.brand-action{display:inline-block;margin-top:20px;padding:9px 17px;border:1px solid #3a526c;border-radius:8px;background:#20354c;color:#eaf3ff;font:600 14px inherit;text-decoration:none;cursor:pointer}button:hover,a.brand-action:hover{background:#294561;border-color:${EDITOR_BRAND.accentColor}}
</style>
</head>
<body><main class="brand-card"><div class="brand-mark">${editorMarkImg()}</div>${options.contentHtml}</main>${script}</body>
</html>`;
}
