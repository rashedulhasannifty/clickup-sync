import { useLocation, useNavigate } from 'react-router-dom';
import { Compass, ArrowLeft, LayoutDashboard } from 'lucide-react';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';

/**
 * Catch-all for unknown in-app routes. Rendered inside AppLayout so the sidebar
 * and topbar stay put — the previous behaviour silently redirected every unknown
 * path to /overview, which hid typos and dead deep-links instead of explaining
 * them.
 */
export function NotFoundPage() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div style={{ paddingTop: 24 }}>
      <EmptyState
        icon={<Compass size={22} strokeWidth={1.5} />}
        title="Page not found"
        body={`We couldn't find anything at ${location.pathname}. It may have moved, or the link is out of date.`}
        action={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button variant="subtle" icon={<ArrowLeft size={13} strokeWidth={1.75} />} onClick={() => navigate(-1)}>
              Go back
            </Button>
            <Button variant="primary" icon={<LayoutDashboard size={13} strokeWidth={1.75} />} onClick={() => navigate('/overview')}>
              Back to overview
            </Button>
          </div>
        }
      />
    </div>
  );
}
