import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { Button } from '../ui/Button';

/**
 * "Start offboarding" on the employee page. An employee already on notice or exited has an
 * offboarding to look at rather than start, so the label changes; either way it opens the
 * offboarding page, which shows the start form when there is no exit yet.
 */
export function StartOffboardingButton({ employeeId, status }: { employeeId: string; status: string }) {
  const navigate = useNavigate();
  const existing = status === 'NOTICE' || status === 'EXITED';
  return (
    <Button
      size="md"
      variant="subtle"
      icon={<LogOut size={13} />}
      onClick={() => navigate(`/people/${encodeURIComponent(employeeId)}/exit`)}
    >
      {existing ? 'View offboarding' : 'Start offboarding'}
    </Button>
  );
}
