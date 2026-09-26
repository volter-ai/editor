import { EDITOR_BRAND } from '@volter/editor-sdk/session/editor-brand';
import { activeProduct } from '../active-product';

/** The product's logo (the kit's own when no product named one), by URL from brand.volter.ai. */
export function VgaiLogo({ size = 64 }: { size?: number }) {
  return (
    <img
      src={activeProduct()?.logo ?? EDITOR_BRAND.logo}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      data-testid="vgai-logo"
      style={{ display: 'block' }}
    />
  );
}
