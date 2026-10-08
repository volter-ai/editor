import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';
import { type ReactNode, useState } from 'react';
import { DisclosureIcon, EditorIcon } from './EditorIcon';

interface SectionHeaderProps {
  label: string;
  /** The section's glyph, beside the disclosure arrow. Every inspection
   *  section carries one (`inspection/model.ts` makes `icon` required), so a
   *  section reads the same in the stacked column as it does on the compact
   *  card's icon strip. */
  icon?: IconDefinition;
  description?: ReactNode;
  actions?: ReactNode;
  /**
   * `false` heads the section without a disclosure control and keeps it open.
   * Collapsing is what a STACK is for — hiding one block to reach the next.
   * Where a single section is showing because you pressed its tab, a triangle
   * offers to hide the only thing in the box (owner, 2026-08-07: "in small
   * mode there's no reason for a collapsible triangle on the section name").
   */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /* The disclosure's size is `--volter-section-disclosure-size` where a surface
   * sets one, and `--volter-icon-xs` — `DisclosureIcon`'s own default rung —
   * where none does, so a host that declares nothing renders exactly what it
   * rendered before. The one declarer is the PROPERTIES presentation
   * (`compact-inspector.css`), where Blender's band mark measures 5.5x9.5 CSS
   * against the 4x6 this rung draws. */
  children: ReactNode;
}

export function SectionHeader({
  label,
  icon,
  description,
  actions,
  collapsible = true,
  defaultOpen = true,
  children,
}: SectionHeaderProps) {
  const [open, setOpen] = useState(defaultOpen);
  const title = (
    <span className="volter-section-title">
      <span>{label}</span>
      {description ? <small>{description}</small> : null}
    </span>
  );

  return (
    <section className="volter-section">
      <div className="volter-section-header">
        {collapsible ? (
          <button
            type="button"
            className="volter-section-trigger"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <DisclosureIcon
              direction={open ? 'down' : 'right'}
              style={{ fontSize: 'var(--volter-section-disclosure-size, var(--volter-icon-xs))' }}
            />
            {icon && <EditorIcon icon={icon} tone="dim" className="volter-section-glyph" />}
            {title}
          </button>
        ) : (
          <div className="volter-section-trigger" data-volter-static>
            {icon && <EditorIcon icon={icon} tone="dim" className="volter-section-glyph" />}
            {title}
          </div>
        )}
        {actions ? <div className="volter-section-actions">{actions}</div> : null}
      </div>
      {(open || !collapsible) && <div className="volter-section-body">{children}</div>}
    </section>
  );
}
