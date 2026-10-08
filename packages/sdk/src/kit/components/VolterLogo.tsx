import { brandLogoUrl } from '@volter/sdk/session/editor-brand';
import { activeProduct } from '../active-product';

/** The product's logo (the kit's own when no product named one), by URL from brand.volter.ai, or
 *  from the page's own host when it serves the mark itself (`brandLogoUrl`). */
export function VolterLogo({ size = 64 }: { size?: number }) {
  return (
    <img
      src={brandLogoUrl(activeProduct()?.logo)}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      data-testid="volter-logo"
      style={{ display: 'block' }}
    />
  );
}
