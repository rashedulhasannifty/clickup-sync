import { useState } from 'react';
import { useCycleTime, useTimeInStatus } from '../../hooks/useReports';
import { Card } from '../ui/Card';
import { Tabs } from '../ui/Tabs';
import { BarChart } from './BarChart';
import { LineChart } from './LineChart';
import { fmt } from '../../lib/formatters';

export function CycleTimeCard() {
  const [tab, setTab] = useState('cycle');
  const cycleQ = useCycleTime({ groupBy: 'week' });
  const tisQ = useTimeInStatus({});

  const minOccurredAt = cycleQ.data?.meta.minOccurredAt ?? tisQ.data?.meta.minOccurredAt ?? null;
  const sinceLabel = minOccurredAt
    ? `Data captured from ${new Date(minOccurredAt).toISOString().slice(0, 10)} onward — older tasks excluded.`
    : `No status events yet — data will appear as ClickUp status changes flow in.`;

  const cycleItems = cycleQ.data?.items ?? [];
  const tisItems = tisQ.data?.items ?? [];

  const lineData = cycleItems.map((r) => ({ label: r.bucket, value: r.meanHours }));
  const barData = tisItems.slice(0, 8).map((r) => ({
    label: r.status,
    value: r.totalHours,
    color: r.color ?? '#94a3b8',
  }));

  const tabItems = [
    { value: 'cycle', label: 'Cycle time' },
    { value: 'inStatus', label: 'Time in status' },
  ];

  return (
    <Card
      title="Cycle time & time in status"
      subtitle={sinceLabel}
      padding={16}
      action={<Tabs items={tabItems} value={tab} onChange={setTab} variant="underline" />}
    >
      {tab === 'cycle' ? (
        lineData.length === 0 ? (
          <EmptyState text="No completed tasks in this window." />
        ) : (
          <LineChart data={lineData} formatMax={(v) => fmt.hours(v)} />
        )
      ) : barData.length === 0 ? (
        <EmptyState text="No status time recorded in this window." />
      ) : (
        <BarChart data={barData} direction="horizontal" formatValue={(v) => fmt.hours(v)} />
      )}
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ padding: '32px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      {text}
    </div>
  );
}
