/**
 * THE COVERAGE UNIT — one derivation for every printer.
 *
 * Two numbers have been published for the same template walk: "editor 11 of 42"
 * and "editor 7 of 21". 42 is root-instances (21 editor seams × 2 graded
 * roots). 21 is distinct capabilities. Neither printer said which, so a
 * legitimate applicability change (#2238) was indistinguishable from a
 * silently more-forgiving instrument.
 *
 * This module is the one owner of both numbers. A capability is a unique
 * seam; a root-instance is one row (one seam on one root). A capability is a
 * gap if ANY applicable root is short of it — gap-wins, so a per-root miss
 * cannot vanish into a sibling's ok. An all-N-A seam is not a capability of
 * this session (that is the applicability rule, not a silent drop).
 *
 * Pure: no editor session, no filesystem. Callers that already hold rows
 * (console, CLI banner, doctor, portfolio) format them here.
 */

export interface CoverageAccountingRow {
  readonly seam: string;
  readonly status: string;
  /** Root this row belongs to, when the same seam appears once per mount. */
  readonly subject?: string | null;
  /** Fallback for subject when the union stamped `[label] ` onto `detail`. */
  readonly detail?: string;
}

export interface CoverageFamilyAccounting {
  readonly family: string;
  /** Distinct applicable seams (the capabilities unit). */
  readonly capabilities: number;
  /** Distinct seams with a gap on any applicable root (gap-wins). */
  readonly capabilityGaps: number;
  /** Rows in this family — the root-instances unit, including N-A. */
  readonly rootInstances: number;
}

export interface CoverageAccounting {
  readonly capabilities: number;
  readonly capabilityGaps: number;
  readonly rootsGraded: number;
  readonly rootInstances: number;
  readonly families: readonly CoverageFamilyAccounting[];
}

export class CoverageReconcileError extends Error {
  constructor(message: string) {
    super(`coverage-accounting: ${message}`);
    this.name = 'CoverageReconcileError';
  }
}

/** The family a seam belongs to: the segment before its first `.`, or the whole
 *  seam for the single-word ones (`loop`, `persistence`, `systems`). */
export function coverageSeamFamily(seam: string): string {
  const dot = seam.indexOf('.');
  return dot === -1 ? seam : seam.slice(0, dot);
}

/** Subject stamped by `unionCoverageReport` as `[label] ` on the detail. */
export function subjectFromDetail(detail: string | undefined): string | null {
  if (!detail) return null;
  const match = /^\[([^\]]+)\] /.exec(detail);
  return match?.[1] ?? null;
}

function rowSubject(row: CoverageAccountingRow): string | null {
  if (row.subject !== undefined && row.subject !== null && row.subject !== '') {
    return row.subject;
  }
  return subjectFromDetail(row.detail);
}

interface SeamFold {
  gap: boolean;
  applicable: boolean;
}

function foldSeam(existing: SeamFold | undefined, status: string): SeamFold {
  const fold = existing ?? { gap: false, applicable: false };
  if (status === 'na') return fold;
  return { gap: fold.gap || status === 'gap', applicable: true };
}

function familyAccounting(
  family: string,
  rows: readonly CoverageAccountingRow[],
): CoverageFamilyAccounting {
  const folds = new Map<string, SeamFold>();
  for (const row of rows) {
    folds.set(row.seam, foldSeam(folds.get(row.seam), row.status));
  }
  let capabilities = 0;
  let capabilityGaps = 0;
  for (const fold of folds.values()) {
    if (!fold.applicable) continue;
    capabilities += 1;
    if (fold.gap) capabilityGaps += 1;
  }
  return { family, capabilities, capabilityGaps, rootInstances: rows.length };
}

/**
 * Both units, from the same rows. Gap-wins on the capabilities unit so a
 * miss on one root cannot be hidden by another root's ok.
 */
export function deriveCoverageAccounting(
  rows: readonly CoverageAccountingRow[],
): CoverageAccounting {
  const subjects = new Set<string>();
  const familyRows = new Map<string, CoverageAccountingRow[]>();
  for (const row of rows) {
    const subject = rowSubject(row);
    if (subject !== null) subjects.add(subject);
    const family = coverageSeamFamily(row.seam);
    const list = familyRows.get(family);
    if (list) list.push(row);
    else familyRows.set(family, [row]);
  }
  const families = [...familyRows].map(([family, familyList]) =>
    familyAccounting(family, familyList),
  );
  const folds = new Map<string, SeamFold>();
  for (const row of rows) {
    folds.set(row.seam, foldSeam(folds.get(row.seam), row.status));
  }
  let capabilities = 0;
  let capabilityGaps = 0;
  for (const fold of folds.values()) {
    if (!fold.applicable) continue;
    capabilities += 1;
    if (fold.gap) capabilityGaps += 1;
  }
  return {
    capabilities,
    capabilityGaps,
    rootsGraded: subjects.size,
    rootInstances: rows.length,
    families,
  };
}

/** `8 of 30 capabilities are MISSING` */
export function formatCoverageMissingLead(accounting: CoverageAccounting): string {
  return `${accounting.capabilityGaps} of ${accounting.capabilities} capabilities are MISSING`;
}

/** `2 roots graded; 51 root-instances` — omitted roots clause when none were labelled. */
export function formatCoverageDerivation(accounting: CoverageAccounting): string {
  const roots = accounting.rootsGraded > 0 ? `${accounting.rootsGraded} roots graded; ` : '';
  return `${roots}${accounting.rootInstances} root-instances`;
}

/**
 * `editor 7 of 21 capabilities (2 roots graded; 42 root-instances)` when the
 * family is counted per-root; `system 0 of 7 capabilities` when instances
 * already equal capabilities.
 */
export function formatCoverageFamilyBreakdown(
  family: CoverageFamilyAccounting,
  opts: { readonly rootsGraded?: number } = {},
): string {
  const roots = opts.rootsGraded ?? 0;
  const showInstances = family.rootInstances !== family.capabilities || roots > 1;
  const head = `${family.family} ${family.capabilityGaps} of ${family.capabilities} capabilities`;
  if (!showInstances) return head;
  const rootsBit = roots > 1 ? `${roots} roots graded; ` : '';
  return `${head} (${rootsBit}${family.rootInstances} root-instances)`;
}

function familyOpts(
  family: CoverageFamilyAccounting,
  accounting: CoverageAccounting,
): { readonly rootsGraded?: number } {
  return family.family === 'editor' ? { rootsGraded: accounting.rootsGraded } : {};
}

/** THE sentence. Head names the subject; the rest is this module's unit. */
export function formatCoverageGapHeadline(head: string, accounting: CoverageAccounting): string {
  const breakdown = accounting.families
    .map((family) => formatCoverageFamilyBreakdown(family, familyOpts(family, accounting)))
    .join(', ');
  return `${head} — ${formatCoverageMissingLead(accounting)} (${formatCoverageDerivation(accounting)}: ${breakdown}).`;
}

export interface ParsedCoverageHeadline {
  readonly capabilityGaps: number;
  readonly capabilities: number;
  readonly rootsGraded: number;
  readonly rootInstances: number;
}

/** Pull the unit numbers back out of a headline so a report can fail closed. */
export function parseCoverageHeadline(headline: string): ParsedCoverageHeadline {
  const lead = /(\d+) of (\d+) capabilities are MISSING/.exec(headline);
  if (!lead) {
    throw new CoverageReconcileError(
      'headline does not state the capabilities unit (missing "N of M capabilities are MISSING")',
    );
  }
  const roots = /(\d+) roots graded/.exec(headline);
  const instances = /(\d+) root-instances/.exec(headline);
  if (!instances) {
    throw new CoverageReconcileError('headline does not state root-instances');
  }
  return {
    capabilityGaps: Number(lead[1]),
    capabilities: Number(lead[2]),
    rootsGraded: roots ? Number(roots[1]) : 0,
    rootInstances: Number(instances[1]),
  };
}

/**
 * A report whose members cannot reconcile with its headline is a broken
 * report. Detail rows are the source; the headline must be derivable from
 * them, and the headline's numbers must be those derived values.
 */
export function assertCoverageReconciles(
  rows: readonly CoverageAccountingRow[],
  headline: string,
): void {
  const derived = deriveCoverageAccounting(rows);
  const parsed = parseCoverageHeadline(headline);
  if (parsed.capabilityGaps !== derived.capabilityGaps) {
    throw new CoverageReconcileError(
      `headline capability-gaps ${parsed.capabilityGaps} !== row-derived ${derived.capabilityGaps}`,
    );
  }
  if (parsed.capabilities !== derived.capabilities) {
    throw new CoverageReconcileError(
      `headline capabilities ${parsed.capabilities} !== row-derived ${derived.capabilities}`,
    );
  }
  if (parsed.rootInstances !== derived.rootInstances) {
    throw new CoverageReconcileError(
      `headline root-instances ${parsed.rootInstances} !== row-derived ${derived.rootInstances}`,
    );
  }
  if (parsed.rootsGraded !== derived.rootsGraded) {
    throw new CoverageReconcileError(
      `headline roots-graded ${parsed.rootsGraded} !== row-derived ${derived.rootsGraded}`,
    );
  }
  const familyInstanceSum = derived.families.reduce((sum, family) => sum + family.rootInstances, 0);
  if (familyInstanceSum !== derived.rootInstances) {
    throw new CoverageReconcileError(
      `family root-instances ${familyInstanceSum} !== ${derived.rootInstances}`,
    );
  }
  const familyCapabilitySum = derived.families.reduce(
    (sum, family) => sum + family.capabilities,
    0,
  );
  if (familyCapabilitySum !== derived.capabilities) {
    throw new CoverageReconcileError(
      `family capabilities ${familyCapabilitySum} !== ${derived.capabilities}`,
    );
  }
}
