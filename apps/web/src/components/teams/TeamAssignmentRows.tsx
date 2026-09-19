import { Plus, X } from 'lucide-react';
import { Select } from '../ui/Select';
import type { TeamMemberRoleValue } from '../../api/teams';

export interface TeamAssignment {
  teamId: string;
  role: TeamMemberRoleValue;
}

/**
 * Repeatable `[team] as [Lead|Member] [x]` rows, plus "+ another team".
 * Shared by the invite modal and the Users page's member drawer — both just
 * diff `value` against whatever's already on the server and call the right
 * `teamsApi` mutation per row.
 */
export function TeamAssignmentRows({
  teams,
  value,
  onChange,
  disabled = false,
}: {
  teams: { id: string; name: string }[];
  value: TeamAssignment[];
  onChange: (rows: TeamAssignment[]) => void;
  disabled?: boolean;
}) {
  const usedIds = new Set(value.map((r) => r.teamId));

  const setRow = (i: number, patch: Partial<TeamAssignment>) =>
    onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => {
    const next = teams.find((t) => !usedIds.has(t.id));
    if (!next) return;
    onChange([...value, { teamId: next.id, role: 'MEMBER' }]);
  };
  const removeRow = (i: number) => onChange(value.filter((_, j) => j !== i));

  const canAddMore = value.length < teams.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {value.map((row, i) => {
        const options = teams
          .filter((t) => t.id === row.teamId || !usedIds.has(t.id))
          .map((t) => ({ value: t.id, label: t.name }));
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Select
                fullWidth
                value={row.teamId}
                onChange={(v) => setRow(i, { teamId: v })}
                options={options}
                placeholder="Choose a team…"
                disabled={disabled}
                ariaLabel={`Team ${i + 1}`}
              />
            </div>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)', flexShrink: 0 }}>as</span>
            <div style={{ width: 128, flexShrink: 0 }}>
              <Select
                fullWidth
                value={row.role}
                onChange={(v) => setRow(i, { role: v as TeamMemberRoleValue })}
                options={[
                  { value: 'LEAD', label: 'Lead' },
                  { value: 'MEMBER', label: 'Member' },
                ]}
                disabled={disabled}
                ariaLabel={`Role for team ${i + 1}`}
              />
            </div>
            <button
              type="button"
              aria-label={`Remove team ${i + 1}`}
              onClick={() => removeRow(i)}
              disabled={disabled}
              style={{
                width: 26, height: 26, border: 0, background: 'transparent', color: 'var(--text-faint)',
                borderRadius: 7, cursor: disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', flexShrink: 0,
              }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
      {canAddMore && (
        <button
          type="button"
          onClick={addRow}
          disabled={disabled}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 4px', background: 'none',
            border: 0, color: 'var(--accent-strong)', fontSize: 13, fontWeight: 600,
            cursor: disabled ? 'default' : 'pointer', alignSelf: 'flex-start',
          }}
        >
          <Plus size={14} /> Add another team
        </button>
      )}
    </div>
  );
}
