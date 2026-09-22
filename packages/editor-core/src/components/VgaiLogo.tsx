import { VGAI_LOGO } from '@volter/editor-sdk/session/editor-brand';

interface VgaiLogoProps {
  size?: number;
  animation?: 'static' | 'assemble' | 'loading';
}

/** The shared angular three-piece brand mark, with reduced-motion-safe assembly. */
export function VgaiLogo({ size = 64, animation = 'assemble' }: VgaiLogoProps) {
  const motionClass = animation === 'static' ? '' : `vgai-logo--${animation}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox={VGAI_LOGO.viewBox}
      aria-hidden="true"
      focusable="false"
      data-testid="vgai-logo"
      style={{ display: 'block', overflow: 'visible', filter: 'drop-shadow(0 5px 7px #0000003d)' }}
    >
      <g className={motionClass} transform={VGAI_LOGO.transform}>
        <g className="vgai-logo-idle">
          {VGAI_LOGO.pieces.map((piece) => (
            <path
              key={piece.id}
              className={`vgai-logo-${piece.id}`}
              d={piece.path}
              fill="#F3F4F6"
            />
          ))}
        </g>
      </g>
    </svg>
  );
}
