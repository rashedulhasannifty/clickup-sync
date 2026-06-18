import { useMemo, useState } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { ClickupAvatar } from './ui/ClickupAvatar';
import { useTimeEntriesAssignees } from '../hooks/useReports';
import type { ExcludedAssignee } from '../api/admin';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Already-excluded ids, hidden from the picker. */
  excludedIds: Set<string>;
  /** Called with the assignee to add once the admin confirms the warning. */
  onConfirm: (assignee: ExcludedAssignee) => void;
  saving?: boolean;
}

export function ExcludeAssigneeModal({ open, onClose, excludedIds, onConfirm, saving }: Props) {
  const { data: assignees, isLoading } = useTimeEntriesAssignees();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ExcludedAssignee | null>(null);

  const candidates = useMemo(() => {
    const list = (assignees ?? []).filter((a) => !excludedIds.has(a.id));
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((a) => (a.name ?? '').toLowerCase().includes(q) || (a.email ?? '').toLowerCase().includes(q) || a.id.toLowerCase().includes(q));
  }, [assignees, excludedIds, search]);

  function close() {
    setSearch('');
    setSelected(null);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Exclude assignee from costing"
      subtitle={selected ? undefined : 'Pick an assignee. Their tasks and time entries stay visible — only costing changes.'}
      footer={
        selected ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <Button variant="ghost" onClick={() => setSelected(null)} disabled={saving}>Back</Button>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="ghost" onClick={close} disabled={saving}>Cancel</Button>
              <Button variant="accent" loading={saving} onClick={() => onConfirm(selected)}>Exclude assignee</Button>
            </div>
          </div>
        ) : undefined
      }
    >
      {selected ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ClickupAvatar userId={selected.id} email={selected.email} name={selected.name ?? selected.id} size={36} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{selected.name ?? selected.id}</div>
              {selected.email && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selected.email}</div>}
            </div>
          </div>
          <Callout tone="amber" icon={<AlertTriangle size={14} />}>
            <strong>{selected.name ?? selected.id}</strong> will be excluded from costing. Their existing and future time
            entries will be set to <strong>$0 (Excluded)</strong>, they will no longer appear as missing a rate, and any
            active rate they have will be <strong>ignored while excluded</strong>. Their hours still count toward totals.
            You can undo this any time by removing them from the excluded list.
          </Callout>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Input icon={<Search size={14} />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search assignee…" aria-label="Search assignees" />
          <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {isLoading ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 8 }}>Loading…</div>
            ) : candidates.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 8 }}>No assignees to exclude.</div>
            ) : (
              candidates.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setSelected(a)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: 0, background: 'transparent', borderRadius: 8, cursor: 'pointer', textAlign: 'left', width: '100%' }}
                >
                  <ClickupAvatar userId={a.id} email={a.email} name={a.name ?? a.id} size={28} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{a.name ?? a.id}</div>
                    {a.email && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.email}</div>}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
