import { createContext, useContext, useState, useEffect, createElement } from 'react';
import type { ReactNode } from 'react';

export type DateRange = '24h' | '7d' | '30d' | '90d' | 'custom';
export type SpaceFilter = 'all' | string;

interface FilterState {
  dateRange: DateRange;
  space: SpaceFilter;
  setDateRange: (v: DateRange) => void;
  setSpace: (v: SpaceFilter) => void;
  customFrom: string;
  customTo: string;
  setCustomFrom: (v: string) => void;
  setCustomTo: (v: string) => void;
  fromDate: string;
  toDate: string;
  /** Short human label like "last 24h", "last 30d", or "May 1 → May 15". */
  dateRangeLabel: string;
}

function buildDateRangeLabel(range: DateRange, customFrom: string, customTo: string): string {
  switch (range) {
    case '24h': return 'last 24h';
    case '7d':  return 'last 7d';
    case '30d': return 'last 30d';
    case '90d': return 'last 90d';
    case 'custom': {
      const fmtDay = (iso: string) =>
        new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(iso));
      if (customFrom && customTo) return `${fmtDay(customFrom)} → ${fmtDay(customTo)}`;
      if (customFrom) return `from ${fmtDay(customFrom)}`;
      return 'custom range';
    }
  }
}

const FilterContext = createContext<FilterState>({} as FilterState);

function dateRangeToFrom(range: DateRange): string {
  const d = new Date();
  if (range === '24h') {
    d.setHours(d.getHours() - 24);
    return d.toISOString();
  }
  if (range === 'custom') return '';
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const [dateRange, setDateRange] = useState<DateRange>(
    () => (sessionStorage.getItem('dateRange') as DateRange) ?? '30d',
  );
  const [space, setSpace] = useState<SpaceFilter>(
    () => sessionStorage.getItem('space') ?? 'all',
  );
  const [customFrom, setCustomFrom] = useState<string>(
    () => sessionStorage.getItem('customFrom') ?? '',
  );
  const [customTo, setCustomTo] = useState<string>(
    () => sessionStorage.getItem('customTo') ?? '',
  );

  useEffect(() => { sessionStorage.setItem('dateRange', dateRange); }, [dateRange]);
  useEffect(() => { sessionStorage.setItem('space', space); }, [space]);
  useEffect(() => { sessionStorage.setItem('customFrom', customFrom); }, [customFrom]);
  useEffect(() => { sessionStorage.setItem('customTo', customTo); }, [customTo]);

  const fromDate = dateRange === 'custom' ? (customFrom ? new Date(customFrom).toISOString() : '') : dateRangeToFrom(dateRange);
  const toDate   = dateRange === 'custom' ? (customTo   ? new Date(customTo).toISOString()   : new Date().toISOString()) : new Date().toISOString();
  const dateRangeLabel = buildDateRangeLabel(dateRange, customFrom, customTo);

  return createElement(FilterContext.Provider, {
    value: { dateRange, space, setDateRange, setSpace, customFrom, customTo, setCustomFrom, setCustomTo, fromDate, toDate, dateRangeLabel },
    children,
  });
}

export function useGlobalFilters() {
  return useContext(FilterContext);
}
