import { createContext, useContext, useState, useEffect, createElement } from 'react';
import type { ReactNode } from 'react';

export type DateRange = '7d' | '30d' | '90d';
export type SpaceFilter = 'all' | string;

interface FilterState {
  dateRange: DateRange;
  space: SpaceFilter;
  setDateRange: (v: DateRange) => void;
  setSpace: (v: SpaceFilter) => void;
  fromDate: string;
  toDate: string;
}

const FilterContext = createContext<FilterState>({} as FilterState);

function dateRangeToFrom(range: DateRange): string {
  const d = new Date();
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

  useEffect(() => { sessionStorage.setItem('dateRange', dateRange); }, [dateRange]);
  useEffect(() => { sessionStorage.setItem('space', space); }, [space]);

  const fromDate = dateRangeToFrom(dateRange);
  const toDate = new Date().toISOString();

  return createElement(FilterContext.Provider, {
    value: { dateRange, space, setDateRange, setSpace, fromDate, toDate },
    children,
  });
}

export function useGlobalFilters() {
  return useContext(FilterContext);
}
