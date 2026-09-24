/**
 * Project-authored hierarchy projection (D20).
 *
 * This is editor metadata, not runtime composition. `vgai.project.json.roots`
 * declares adapter mounts; `vgai.project.json.authoring.hierarchy` only
 * chooses how those roots are labelled and grouped in the authoring tree.
 */

export interface HierarchyProjectionGroup {
  readonly id: string;
  readonly label: string;
  readonly roots: readonly string[];
}

export interface HierarchyProjection {
  readonly rootLabels?: Readonly<Record<string, string>>;
  readonly groups?: readonly HierarchyProjectionGroup[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Leniently read authoring metadata. Invalid entries are omitted so a typo in
 * an optional projection can never make the game itself unopenable.
 */
export function parseHierarchyProjection(value: unknown): HierarchyProjection | undefined {
  const source = record(value);
  if (!source) return undefined;

  const labelsSource = record(source['rootLabels']);
  const labelEntries = labelsSource
    ? Object.entries(labelsSource).flatMap(([id, label]): Array<[string, string]> => {
        const normalizedId = id.trim();
        const normalizedLabel = typeof label === 'string' ? label.trim() : '';
        return normalizedId && normalizedLabel ? [[normalizedId, normalizedLabel]] : [];
      })
    : [];
  const rootLabels = labelEntries.length > 0 ? Object.fromEntries(labelEntries) : undefined;

  const groupIds = new Set<string>();
  const groupEntries = Array.isArray(source['groups'])
    ? source['groups'].flatMap((candidate): HierarchyProjectionGroup[] => {
        const group = record(candidate);
        const id = typeof group?.['id'] === 'string' ? group['id'].trim() : '';
        const label = typeof group?.['label'] === 'string' ? group['label'].trim() : '';
        const roots = Array.isArray(group?.['roots'])
          ? group['roots'].flatMap((root): string[] => {
              const normalized = typeof root === 'string' ? root.trim() : '';
              return normalized ? [normalized] : [];
            })
          : [];
        if (!id || !label || roots.length === 0 || groupIds.has(id)) return [];
        groupIds.add(id);
        return [{ id, label, roots: [...new Set(roots)] }];
      })
    : [];
  const groups = groupEntries.length > 0 ? groupEntries : undefined;

  if (!rootLabels && !groups) return undefined;
  return {
    ...(rootLabels ? { rootLabels } : {}),
    ...(groups ? { groups } : {}),
  };
}

/** Read the projection from a raw `vgai.project.json` config object. */
export function hierarchyProjectionFromProjectConfig(
  config: unknown,
): HierarchyProjection | undefined {
  const authoring = record(record(config)?.['authoring']);
  return parseHierarchyProjection(authoring?.['hierarchy']);
}
