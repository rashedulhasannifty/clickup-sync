import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { FilterProvider } from './hooks/useGlobalFilters';
import './index.css';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <FilterProvider>
        <div style={{ padding: 32 }}>
          <h1 style={{ fontFamily: 'var(--font-sans)', color: 'var(--text)' }}>
            ClickUp Sync Dashboard
          </h1>
          <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>
            UI scaffolding ready. Pages coming next.
          </p>
        </div>
      </FilterProvider>
    </QueryClientProvider>
  );
}
