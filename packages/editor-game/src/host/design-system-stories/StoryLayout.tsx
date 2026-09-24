import { EditorBadge } from '@volter/editor-sdk/widgets';
import type { CSSProperties, ReactNode } from 'react';

export function DesignSystemPage({
  eyebrow,
  title,
  summary,
  children,
  testId,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <main className="ds-page" data-testid={testId}>
      <header className="ds-page-header">
        <span className="ds-eyebrow">{eyebrow}</span>
        <h1 className="ds-page-title">{title}</h1>
        <p className="ds-page-summary">{summary}</p>
      </header>
      {children}
    </main>
  );
}

export function StorySection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="ds-section">
      <header className="ds-section-header">
        <h2 className="ds-section-title">{title}</h2>
        {description && <p className="ds-section-description">{description}</p>}
      </header>
      {children}
    </section>
  );
}

export function Specimen({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <article className="ds-specimen">
      <header className="ds-specimen-header">
        <h3 className="ds-specimen-title">{title}</h3>
        {description && <p className="ds-specimen-description">{description}</p>}
      </header>
      {children}
    </article>
  );
}

export function TokenSwatch({ name, value }: { name: string; value: string }) {
  return (
    <div className="ds-token">
      <div className="ds-token-swatch" style={{ background: value }} />
      <div className="ds-token-meta">
        <span className="ds-token-name">{name}</span>
        <span className="ds-token-value">{value}</span>
      </div>
    </div>
  );
}

export function Measure({ name, value, width }: { name: string; value: string; width: number }) {
  return (
    <div className="ds-measure-row">
      <span className="ds-token-name">{name}</span>
      <span className="ds-measure" style={{ width: `${width}px` }} />
      <span className="ds-token-value">{value}</span>
    </div>
  );
}

export function StateRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="ds-state-label">{label}</span>
      <div className="ds-demo-row">{children}</div>
    </>
  );
}

export function CoverageStatus({ layer }: { layer: string }) {
  return <EditorBadge>{layer}</EditorBadge>;
}

export const boundedControl: CSSProperties = { width: 220 };
