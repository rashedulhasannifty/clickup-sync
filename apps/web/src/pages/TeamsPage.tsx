import { Network } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';

/**
 * Team CRUD + client assignment admin screen (spec: team-scoped access,
 * "Admin UI: Teams page"). The backend routes (Task 15/16) are live; the full
 * UI — readiness strip, client picker, member management — lands in a
 * follow-up task. This placeholder keeps the `/teams` route and sidebar entry
 * real (rather than a dead link) in the meantime.
 */
export function TeamsPage() {
  return (
    <div>
      <PageHeader
        title="Teams"
        description="Group members and assign ClickUp clients so cost, sprints and chargeability can be scoped per team."
      />
      <Card padding={0}>
        <EmptyState
          icon={<Network size={20} strokeWidth={1.75} />}
          title="Team management is coming here"
          body="Creating teams, assigning clients, and managing members will land on this page next."
        />
      </Card>
    </div>
  );
}
