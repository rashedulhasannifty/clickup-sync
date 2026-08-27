import { useCallback, useMemo, useState } from 'react';

/**
 * Row selection for the server-paginated report tables.
 *
 * Holds the selected ROWS, not just their ids: the totals in the selection bar
 * and the "export selected" path are computed from the row objects themselves,
 * so a selection built across several pages needs no re-fetch and no server
 * support. Every row already carries its own hours/cost, which makes those sums
 * exact rather than an approximation of what the server would say.
 *
 * `scope` tags the selection with the filter set it was made under (pass the
 * page's serialized query params). A selection is only read back while the tag
 * still matches, so any filter or date change drops it during render — keeping
 * rows that no longer match the filters would leave the bar totalling entries
 * the table can't show. Paging deliberately does NOT change the tag.
 *
 * Reading through the tag rather than clearing in an effect is what keeps this
 * out of `react-hooks/set-state-in-effect`, and avoids a second render pass.
 */
export interface RowSelection<T> {
  /** Keys of the rows selected under the current scope. */
  selectedKeys: (string | number)[];
  /** The selected rows themselves, in the order they were selected. */
  selectedRows: T[];
  count: number;
  toggleRow: (key: string | number, row: T) => void;
  /** Select or clear a whole page at once (the header checkbox). */
  togglePage: (entries: { key: string | number; row: T }[], select: boolean) => void;
  clear: () => void;
}

export function useRowSelection<T>(scope: string): RowSelection<T> {
  const [state, setState] = useState<{ scope: string; rows: Map<string | number, T> }>(
    () => ({ scope, rows: new Map() }),
  );

  const rows = state.scope === scope ? state.rows : EMPTY;

  const update = useCallback(
    (mutate: (next: Map<string | number, T>) => void) => {
      setState((prev) => {
        const next = new Map(prev.scope === scope ? prev.rows : []);
        mutate(next);
        return { scope, rows: next };
      });
    },
    [scope],
  );

  const toggleRow = useCallback((key: string | number, row: T) => {
    update((next) => { if (!next.delete(key)) next.set(key, row); });
  }, [update]);

  const togglePage = useCallback((entries: { key: string | number; row: T }[], select: boolean) => {
    update((next) => {
      for (const e of entries) {
        if (select) next.set(e.key, e.row);
        else next.delete(e.key);
      }
    });
  }, [update]);

  const clear = useCallback(() => setState({ scope, rows: new Map() }), [scope]);

  const selectedKeys = useMemo(() => [...rows.keys()], [rows]);
  const selectedRows = useMemo(() => [...rows.values()], [rows]);

  return { selectedKeys, selectedRows, count: rows.size, toggleRow, togglePage, clear };
}

/** Shared empty map so a stale scope doesn't hand out a fresh object each render. */
const EMPTY = new Map<string | number, never>();
