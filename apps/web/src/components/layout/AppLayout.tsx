import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { UsersRound } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { CommandPalette } from './CommandPalette';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useAuth } from '../../hooks/useAuth';
import { EmptyState } from '../ui/EmptyState';

export function AppLayout() {
  const [cmdOpen, setCmdOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isMobile = useMediaQuery('(max-width: 767px)');
  const location = useLocation();
  const { access } = useAuth();
  // Scoping is on, this viewer isn't unrestricted, and they lead/belong to no
  // team at all — every ClickUp-backed page would be empty. A missing `access`
  // (still loading) never triggers this: `access` must be a REAL, loaded
  // summary that actually says so.
  const noTeam = !!access && access.scopingEnabled && !access.unrestricted && access.teams.length === 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen(v => !v);
      }
      if (e.key === 'Escape') {
        setCmdOpen(false);
        setMobileNavOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close the mobile drawer whenever the route changes (covers nav links,
  // command palette navigation, and browser back/forward).
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  // Reset the drawer when the viewport leaves mobile width, otherwise an
  // open drawer would silently spring back when the viewport narrows again.
  useEffect(() => {
    if (!isMobile) setMobileNavOpen(false);
  }, [isMobile]);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--page-bg)' }}>
      <Sidebar
        onCommandPalette={() => setCmdOpen(true)}
        isMobile={isMobile}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />
      {/* Backdrop behind the off-canvas drawer on mobile */}
      {isMobile && mobileNavOpen && (
        <div
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
          style={{
            position: 'fixed', inset: 0, zIndex: 45,
            background: 'rgba(15, 23, 42, 0.45)',
          }}
        />
      )}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar
          onSearchClick={() => setCmdOpen(true)}
          isMobile={isMobile}
          onMenuClick={() => setMobileNavOpen(true)}
        />
        <main style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '14px 14px 48px' : '20px 24px 60px', maxWidth: 1480, width: '100%', margin: '0 auto' }}>
          {noTeam ? (
            <div style={{ paddingTop: '10vh' }}>
              <EmptyState
                icon={<UsersRound size={20} strokeWidth={1.75} />}
                title="You're not on a team yet"
                body="Ask an admin to add you to a team before you can see any data."
              />
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
