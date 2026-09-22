import {
  cloneElement,
  isValidElement,
  type ReactElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  text: string;
  /** Explicitly `| undefined`: a hint resolved from the active keymap
   *  (`keymap-presets.ts`) is absent when that keymap leaves the action
   *  unbound, and the tooltip simply omits the `<kbd>` rather than lie. */
  hotkey?: string | undefined;
  children: ReactElement;
  position?: TooltipPosition;
  delay?: number;
}

interface TooltipCoordinates {
  left: number;
  top: number;
  ready: boolean;
}

const VIEWPORT_GUTTER = 8;
const TOOLTIP_GAP = 6;

function opposite(position: TooltipPosition): TooltipPosition {
  if (position === 'top') return 'bottom';
  if (position === 'bottom') return 'top';
  if (position === 'left') return 'right';
  return 'left';
}

function placementFits(position: TooltipPosition, trigger: DOMRect, tooltip: DOMRect): boolean {
  if (position === 'top') return trigger.top - tooltip.height - TOOLTIP_GAP >= VIEWPORT_GUTTER;
  if (position === 'bottom')
    return trigger.bottom + tooltip.height + TOOLTIP_GAP <= window.innerHeight - VIEWPORT_GUTTER;
  if (position === 'left') return trigger.left - tooltip.width - TOOLTIP_GAP >= VIEWPORT_GUTTER;
  return trigger.right + tooltip.width + TOOLTIP_GAP <= window.innerWidth - VIEWPORT_GUTTER;
}

function coordinatesFor(
  position: TooltipPosition,
  trigger: DOMRect,
  tooltip: DOMRect,
): TooltipCoordinates {
  let left = trigger.left + (trigger.width - tooltip.width) / 2;
  let top = trigger.top + (trigger.height - tooltip.height) / 2;
  if (position === 'top') top = trigger.top - tooltip.height - TOOLTIP_GAP;
  else if (position === 'bottom') top = trigger.bottom + TOOLTIP_GAP;
  else if (position === 'left') left = trigger.left - tooltip.width - TOOLTIP_GAP;
  else left = trigger.right + TOOLTIP_GAP;

  return {
    left: Math.max(
      VIEWPORT_GUTTER,
      Math.min(left, window.innerWidth - tooltip.width - VIEWPORT_GUTTER),
    ),
    top: Math.max(
      VIEWPORT_GUTTER,
      Math.min(top, window.innerHeight - tooltip.height - VIEWPORT_GUTTER),
    ),
    ready: true,
  };
}

/**
 * Canonical editor tooltip.
 *
 * The popup is portaled to the editor theme root and positioned against the
 * viewport. That lets it escape dock/panel overflow clipping without leaking
 * outside the theme boundary. Pointer and keyboard focus both expose the same
 * accessible description.
 */
export function Tooltip({
  text,
  hotkey,
  children,
  position = 'bottom',
  delay = 400,
}: TooltipProps) {
  const id = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(null);
  const hovered = useRef(false);
  const focused = useRef(false);
  const [visible, setVisible] = useState(false);
  const [portalRoot, setPortalRoot] = useState<Element | null>(null);
  const [coordinates, setCoordinates] = useState<TooltipCoordinates>({
    left: 0,
    top: 0,
    ready: false,
  });

  useLayoutEffect(() => {
    setPortalRoot(wrapperRef.current?.closest('.vgai-editor-theme') ?? null);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setVisible(false);
  };

  const hideIfInactive = () => {
    if (!hovered.current && !focused.current) hide();
  };

  const show = (wait: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCoordinates((current) => ({ ...current, ready: false }));
      setVisible(true);
    }, wait);
  };

  useLayoutEffect(() => {
    if (!visible) return;
    const update = () => {
      const trigger = wrapperRef.current?.getBoundingClientRect();
      const tooltip = tooltipRef.current?.getBoundingClientRect();
      if (!trigger || !tooltip) return;
      const resolved = placementFits(position, trigger, tooltip) ? position : opposite(position);
      setCoordinates(coordinatesFor(resolved, trigger, tooltip));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [hotkey, position, text, visible]);

  let child = children;
  if (isValidElement<{ 'aria-describedby'?: string }>(children)) {
    const describedBy = [children.props['aria-describedby'], visible ? id : null]
      .filter(Boolean)
      .join(' ');
    child = cloneElement(children, describedBy ? { 'aria-describedby': describedBy } : {});
  }

  return (
    <span
      ref={wrapperRef}
      className="vgai-tooltip-anchor"
      onMouseEnter={() => {
        hovered.current = true;
        show(delay);
      }}
      onMouseLeave={() => {
        hovered.current = false;
        hideIfInactive();
      }}
      onFocusCapture={() => {
        focused.current = true;
        show(0);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          focused.current = false;
          hideIfInactive();
        }
      }}
    >
      {child}
      {visible &&
        portalRoot &&
        createPortal(
          <div
            ref={tooltipRef}
            id={id}
            role="tooltip"
            className="vgai-tooltip"
            style={{
              left: coordinates.left,
              top: coordinates.top,
              visibility: coordinates.ready ? 'visible' : 'hidden',
            }}
          >
            <span>{text}</span>
            {hotkey && <kbd>{hotkey}</kbd>}
          </div>,
          portalRoot,
        )}
    </span>
  );
}
