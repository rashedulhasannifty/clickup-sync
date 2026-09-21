import { useState } from 'react';
import { Link } from 'react-router-dom';
import { UsersRound, Clock, UserPlus, Check, X } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Pill } from '../components/ui/Pill';
import { Avatar } from '../components/ui/Avatar';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Select } from '../components/ui/Select';
import { useMyTeams, useTeamMutations } from '../hooks/useTeams';
import type { MyTeam } from '../api/teams';

function emailLabel(email: string) {
  return email.split('@')[0];
}

function axiosMessage(e: unknown): string {
  return (
    (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
    (e as Error)?.message ??
    'Something went wrong'
  );
}

/** Searchable picker + Add, for a lead adding an existing org user to a team
 *  they lead. Candidates come from `GET /my-teams`'s `candidates` field —
 *  leads can't call `/users` (Owner/Admin only). Always added as MEMBER. */
function AddMemberRow({
  candidates,
  adding,
  onAdd,
  onCancel,
}: {
  candidates: { id: string; name: string | null; email: string }[];
  adding: boolean;
  onAdd: (userId: string) => void;
  onCancel: () => void;
}) {
  const [userId, setUserId] = useState('');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Select
          fullWidth
          searchable
          value={userId}
          onChange={setUserId}
          placeholder="Choose a member…"
          options={candidates.map((c) => ({ value: c.id, label: c.name?.trim() || c.email }))}
          ariaLabel="Choose a member to add"
        />
      </div>
      <Button size="sm" variant="accent" icon={<Check size={13} />} disabled={!userId} loading={adding} onClick={() => userId && onAdd(userId)}>
        Add
      </Button>
      <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function LedTeamCard({
  team,
  candidates,
  onAddMember,
  adding,
}: {
  team: MyTeam;
  candidates: { id: string; name: string | null; email: string }[];
  onAddMember: (teamId: string, userId: string) => void;
  adding: boolean;
}) {
  const [addingOpen, setAddingOpen] = useState(false);
  // R20: candidates already exclude everyone already in one of the caller's led
  // teams — no extra client-side filtering needed here.
  const teamCandidates = candidates;

  return (
    // overflow visible for the same reason as TeamsPage's detail panel: the
    // Add-member Select's menu must escape the card body instead of being
    // clipped by it.
    <Card
      title={team.name}
      subtitle={`${team.members.length} ${team.members.length === 1 ? 'member' : 'members'} · ${team.clients.length} ${team.clients.length === 1 ? 'client' : 'clients'}`}
      style={{ overflow: 'visible', position: 'relative' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Clients
          </div>
          {team.clients.length === 0 ? (
            <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>No clients assigned yet.</span>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {team.clients.map((name) => (
                <Pill key={name} tone="gray" size="sm">
                  {name}
                </Pill>
              ))}
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Members
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {team.members.map((m) => (
              <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                <Avatar name={m.name?.trim() || m.email} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.name?.trim() || emailLabel(m.email)}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{m.email}</div>
                </div>
                <Pill tone={m.role === 'LEAD' ? 'purple' : 'gray'} size="sm">
                  {m.role === 'LEAD' ? 'Lead' : 'Member'}
                </Pill>
                {m.clickupUserId ? (
                  <Link
                    to={`/timesheet?userId=${encodeURIComponent(m.clickupUserId)}`}
                    style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-strong)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    <Clock size={12} /> Timesheet
                  </Link>
                ) : (
                  <span title="No ClickUp link" style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                    No timesheet
                  </span>
                )}
              </div>
            ))}
          </div>

          <div style={{ marginTop: 10 }}>
            {addingOpen ? (
              <AddMemberRow
                candidates={teamCandidates}
                adding={adding}
                onCancel={() => setAddingOpen(false)}
                onAdd={(userId) => {
                  onAddMember(team.id, userId);
                  setAddingOpen(false);
                }}
              />
            ) : (
              <Button
                size="sm"
                variant="default"
                icon={<UserPlus size={12} />}
                onClick={() => setAddingOpen(true)}
                disabled={teamCandidates.length === 0}
                title={teamCandidates.length === 0 ? 'No members available to add right now.' : undefined}
              >
                Add member
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * A team lead's own view of the team(s) they lead — read-only clients, member
 * roster (with a Timesheet shortcut per linked member), and adding a member
 * (spec: team-scoped access, "Lead UI: My team"). No invite, remove, promote
 * or client editing here — those stay Owner/Admin-only on `/teams`.
 */
export function MyTeamPage() {
  const query = useMyTeams();
  const m = useTeamMutations();
  const [toast, setToast] = useState<string | null>(null);

  const teams = query.data?.teams ?? [];
  const candidates = query.data?.candidates ?? [];
  const led = teams.filter((t) => t.role === 'LEAD');

  async function addMember(teamId: string, userId: string) {
    try {
      await m.leadAddMember.mutateAsync({ teamId, userId });
    } catch (e) {
      setToast(axiosMessage(e));
      setTimeout(() => setToast(null), 3000);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader title="My team" description="Clients and members for the team(s) you lead." />

      {query.isLoading ? (
        <Card padding={0}>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} height={60} radius="8px" />
            ))}
          </div>
        </Card>
      ) : led.length === 0 ? (
        <Card padding={0}>
          <EmptyState
            icon={<UsersRound size={20} strokeWidth={1.75} />}
            title="You're not leading a team"
            body="Team leads see their team's clients and members here, and can add existing members to it."
          />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {led.map((t) => (
            <LedTeamCard key={t.id} team={t} candidates={candidates} onAddMember={(teamId, userId) => void addMember(teamId, userId)} adding={m.leadAddMember.isPending} />
          ))}
        </div>
      )}

      {toast && (
        <div
          style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 90,
            padding: '10px 16px', background: 'var(--text)', color: 'var(--surface)', borderRadius: 10,
            fontSize: 13, fontWeight: 500, boxShadow: '0 8px 28px rgba(15,23,42,0.28)',
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
