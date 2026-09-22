/**
 * The human-facing projection of the ingest coverage report.
 *
 * The report is derived in `coverage/capability-coverage.ts`; this component never
 * re-measures or reinterprets a seam. It only gives the same rows already
 * exposed by `vgai status` and the console an Inspector-shaped reading: the
 * measured fact first, then the consequence and the concrete fix for gaps.
 */

import {
  faChartSimple,
  faCircleCheck,
  faCircleExclamation,
  faCircleInfo,
  faCircleMinus,
} from '@fortawesome/free-solid-svg-icons';
import type { LiveCoverageReport, LiveCoverageRow } from '@volter/editor-sdk/host';
import { EditorIcon, SectionHeader, themeVars } from '@volter/editor-sdk/widgets';
import type { ReactNode } from 'react';
import type { InspectionSection } from '../inspection/model';

/**
 * Human labels for the seams whose names are not self-describing — the contract
 * declarations an ingested game makes.
 *
 * The `editor.*` and `system.*` families are deliberately NOT listed: those are
 * generated from the `AuthoringAdapter` / `SystemAdapters` contracts, and a
 * hand-written label map over a generated family is the same defect the
 * generator exists to remove — the map would silently miss whichever seam
 * nobody remembered, in the one surface a human reads. They are humanized from
 * the seam name instead, which cannot go stale.
 */
const CONTRACT_SEAM_LABEL: Partial<Record<string, string>> = {
  loop: 'Loop control',
  'contract.root': 'DOM root',
  'contract.lifecycle.start': 'Cold start',
  'contract.lifecycle.pause': 'Pause / resume',
  persistence: 'Source persistence',
  systems: 'Commands and state',
};

/** `editor.assetDrop` → "Asset drop"; `system.renderDebug` → "Render debug
 *  adapter". Presentation only — the seam name itself stays the id. */
function seamLabel(seam: string): string {
  const explicit = CONTRACT_SEAM_LABEL[seam];
  if (explicit) return explicit;
  const [family, member] = seam.split('.');
  const words = (member ?? seam).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  const sentence = words.charAt(0).toUpperCase() + words.slice(1);
  return family === 'system' ? `${sentence} adapter` : sentence;
}

const STATUS_ICON = {
  ok: faCircleCheck,
  gap: faCircleExclamation,
  na: faCircleMinus,
  info: faCircleInfo,
} as const;

const STATUS_COLOR = {
  ok: themeVars.semantic.success,
  gap: themeVars.semantic.warning,
  na: themeVars.content.dim,
  info: themeVars.content.dim,
} as const;

function CoverageRow({ row }: { readonly row: LiveCoverageRow }) {
  return (
    <div
      data-testid={`ingest-coverage-row-${row.seam}`}
      data-status={row.status}
      style={{
        display: 'grid',
        gridTemplateColumns: '16px minmax(0, 1fr)',
        gap: 7,
        padding: '8px 10px',
        borderTop: '1px solid var(--vgai-structural-divider)',
      }}
    >
      <span style={{ color: STATUS_COLOR[row.status], paddingTop: 1 }}>
        <EditorIcon icon={STATUS_ICON[row.status]} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: themeVars.content.primary, fontWeight: 600 }}>
          {seamLabel(row.seam)}
        </div>
        <div
          style={{
            marginTop: 2,
            color: themeVars.content.muted,
            lineHeight: 1.4,
            overflowWrap: 'anywhere',
          }}
        >
          {row.detail}
        </div>
        {row.missing && (
          <div style={{ marginTop: 6, color: themeVars.content.muted, lineHeight: 1.4 }}>
            <strong style={{ color: themeVars.semantic.warning }}>Missing:</strong> {row.missing}
          </div>
        )}
        {row.fix && (
          <div style={{ marginTop: 4, color: themeVars.content.dim, lineHeight: 1.4 }}>
            <strong>Fix:</strong> {row.fix}
          </div>
        )}
      </div>
    </div>
  );
}

export function CapabilityCoverageBody({ report }: { readonly report: LiveCoverageReport }) {
  const { summary } = report;
  return (
    <div data-testid="ingest-coverage-report" style={{ fontSize: 'var(--vgai-font-base)' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          padding: '7px 10px 9px',
          color: themeVars.content.muted,
        }}
      >
        <span
          style={{
            color: summary.gaps > 0 ? themeVars.semantic.warning : themeVars.semantic.success,
          }}
        >
          {summary.gaps} {summary.gaps === 1 ? 'gap' : 'gaps'}
        </span>
        <span>{summary.ok} integrated</span>
        <span>{summary.na} not applicable</span>
        <span>{summary.info} informational</span>
      </div>
      {report.rows.map((row) => (
        <CoverageRow key={row.seam} row={row} />
      ))}
    </div>
  );
}

/** Add the report to an ordinary composed inspection subject. The stable id
 * means the compact Inspector keeps the same tab open while measurements
 * refresh; sorting keeps the projection content-agnostic. */
export function ingestCoverageSection(report: LiveCoverageReport): InspectionSection {
  return {
    id: 'ingest-coverage',
    title: 'Ingest coverage',
    icon: faChartSimple,
    order: 9_000,
    description: `${report.summary.gaps} gap${report.summary.gaps === 1 ? '' : 's'}`,
    defaultOpen: true,
    testId: 'ingest-coverage-section',
    body: {
      kind: 'custom',
      render: (): ReactNode => <CapabilityCoverageBody report={report} />,
      // `editor.inspect()` cannot render React. Publish exactly what this body
      // displays so the agent and the human read the same report through the
      // Inspector rather than forcing the agent back to a parallel status
      // shape.
      data: { summary: report.summary, rows: report.rows },
    },
  };
}

/** The nothing-to-author Inspector has no composed subject/section list, so it uses
 * the same section as a directly headed block instead of inventing a second
 * presentation for the report. */
export function CapabilityCoverageBlock({ report }: { readonly report: LiveCoverageReport }) {
  const section = ingestCoverageSection(report);
  return (
    <div data-testid={section.testId}>
      <SectionHeader
        label={section.title}
        icon={section.icon}
        description={section.description}
        collapsible
        defaultOpen
      >
        <CapabilityCoverageBody report={report} />
      </SectionHeader>
    </div>
  );
}
