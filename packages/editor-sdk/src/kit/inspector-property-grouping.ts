/**
 * Pure grouping logic behind the generic adapter-driven inspector's
 * `PropertyDescriptor.group?` rendering (T3.4 slice 2). Extracted out of
 * `Inspector.tsx`'s (formerly `IngestPanels.tsx`'s `GenericInspector`)
 * inspector shell component (a react component with no jsdom/testing-library
 * in this repo — `vitest.config.ts` runs `environment: 'node'`) so this can
 * be unit-tested directly as data-in/data-out, matching the repo's existing
 * "test the pure logic headlessly" convention.
 *
 * Ungrouped fields keep their original relative order (byte-stable with the
 * pre-`group` flat-list rendering); named groups are returned in FIRST-SEEN
 * order, each carrying a slugified, testid-safe `groupId` (lowercase,
 * non-alphanumeric runs collapsed to a single `-`, no leading/trailing `-`).
 */

import type { PropertyDescriptor } from '@volter/editor-project/adapter';

export interface PropertyGroup {
  name: string;
  /** Slugified group name — the suffix of the rendered section's
   *  `data-testid="ingest-group-<groupId>"`. */
  groupId: string;
  properties: PropertyDescriptor[];
}

export interface GroupedProperties {
  ungrouped: PropertyDescriptor[];
  groups: PropertyGroup[];
}

/** Lowercase, non-alphanumeric runs -> single `-`, no leading/trailing `-`. */
export function slugifyGroupName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function groupProperties(props: readonly PropertyDescriptor[]): GroupedProperties {
  const ungrouped: PropertyDescriptor[] = [];
  const order: string[] = [];
  const byName = new Map<string, PropertyDescriptor[]>();

  for (const p of props) {
    if (p.group) {
      if (!byName.has(p.group)) {
        byName.set(p.group, []);
        order.push(p.group);
      }
      byName.get(p.group)!.push(p);
    } else {
      ungrouped.push(p);
    }
  }

  return {
    ungrouped,
    groups: order.map((name) => ({
      name,
      groupId: slugifyGroupName(name),
      properties: byName.get(name)!,
    })),
  };
}
