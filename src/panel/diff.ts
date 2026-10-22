export type DiffKind = "added" | "removed" | "changed";

export interface DiffEntry {
  /** Dotted path of the changed value, `(root)` for a changed primitive root. */
  path: string;
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
}

const MAX_DEPTH = 12;

function isContainer(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return true;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function childPath(parent: string, key: string, isArray: boolean): string {
  if (isArray) {
    return `${parent}[${key}]`;
  }
  return parent ? `${parent}.${key}` : key;
}

function walk(
  before: unknown,
  after: unknown,
  path: string,
  out: DiffEntry[],
  limit: number,
  depth: number,
): void {
  if (out.length >= limit || Object.is(before, after)) {
    return;
  }
  if (
    depth < MAX_DEPTH &&
    isContainer(before) &&
    isContainer(after) &&
    Array.isArray(before) === Array.isArray(after)
  ) {
    const isArray = Array.isArray(before);
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      if (out.length >= limit) {
        return;
      }
      const next = childPath(path, key, isArray);
      if (!(key in before)) {
        out.push({ path: next, kind: "added", after: after[key] });
      } else if (!(key in after)) {
        out.push({ path: next, kind: "removed", before: before[key] });
      } else {
        walk(before[key], after[key], next, out, limit, depth + 1);
      }
    }
    return;
  }
  out.push({ path: path || "(root)", kind: "changed", before, after });
}

/**
 * Structural diff between two states, as a flat list of changed paths.
 * Plain objects and arrays are walked, everything else is compared by
 * identity. The list is capped at `limit` entries.
 */
export function diffStates(
  before: unknown,
  after: unknown,
  limit = 200,
): DiffEntry[] {
  const out: DiffEntry[] = [];
  walk(before, after, "", out, limit, 0);
  return out;
}
