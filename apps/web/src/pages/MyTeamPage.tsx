import { UsersRound } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { useAuth } from '../hooks/useAuth';

/**
 * A team lead's own view of the team(s) they lead — read-only clients, member
 * roster, and adding a member (spec: team-scoped access, "My team"). The
 * backend `GET /my-teams` (Task 15/16) is live; the full UI lands in a
 * follow-up task. This placeholder keeps the `/my-team` route and sidebar
 * entry real in the meantime, and still lists which team(s) the viewer leads.
 */
export function MyTeamPage() {
  const { access } = useAuth();
  const led = access?.teams.filter((t) => t.role === 'LEAD') ?? [];

  return (
    <div>
      <PageHeader
        title="My team"
        description="Clients and members for the team(s) you lead."
      />
      <Card padding={0}>
        <EmptyState
          icon={<UsersRound size={20} strokeWidth={1.75} />}
          title={led.length > 0 ? `You lead ${led.map((t) => t.name).join(', ')}` : 'Team detail is coming here'}
          body="Client and member management for your team will land on this page next."
        />
      </Card>
    </div>
  );
}
