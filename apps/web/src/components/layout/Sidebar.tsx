import { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { BrandIcon } from "../brand/BrandIcon";
import { BrandWordmark } from "../brand/BrandWordmark";
import {
  Home,
  BarChart3,
  Activity,
  CheckSquare,
  Clock,
  CalendarClock,
  Scale,
  AlertTriangle,
  DollarSign,
  Layers,
  Webhook,
  ShieldCheck,
  Settings,
  PanelLeft,
  X,
  type LucideIcon,
  UsersRound,
  Wallet,
  Rocket,
} from "lucide-react";
import { useStats } from "../../hooks/useReports";
import { useAuth } from "../../hooks/useAuth";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

export function Sidebar({
  onCommandPalette: _onCommandPalette,
  isMobile = false,
  mobileOpen = false,
  onMobileClose,
}: {
  onCommandPalette?: () => void;
  isMobile?: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const [collapsedDesktop, setCollapsed] = useState(
    () => localStorage.getItem("sidebarCollapsed") === "true",
  );
  const { data: stats } = useStats();
  const { hasRole, user, org } = useAuth();
  const isAdmin = hasRole("ADMIN");

  // On mobile the sidebar is a full-width off-canvas drawer — never the narrow
  // icon-rail. The desktop collapse preference is kept separately so the two
  // modes don't fight when the viewport crosses the breakpoint.
  const collapsed = isMobile ? false : collapsedDesktop;

  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", String(collapsedDesktop));
  }, [collapsedDesktop]);

  // Audit Log and Settings are admin-only; members see everything else.
  const navItems: NavItem[] = [
    { to: "/overview", label: "Overview", icon: Home },
    { to: "/analytics", label: "Analytics", icon: BarChart3 },
    { to: "/time-spikes", label: "Time Spikes", icon: Activity },
    { to: "/tasks", label: "Tasks", icon: CheckSquare },
    { to: "/sprints", label: "Sprints", icon: Rocket },
    { to: "/time-entries", label: "Time Entries", icon: Clock },
    { to: "/timesheet", label: "Timesheet", icon: CalendarClock },
    {
      to: "/missing-rates",
      label: "Missing Rates",
      icon: AlertTriangle,
      badge: stats?.missingRateEntries,
    },
    { to: "/assignee-rates", label: "Assignee Rates", icon: DollarSign },
    { to: "/chargeability-rules", label: "Chargeability", icon: Scale },
    { to: "/budgets", label: "Budgets", icon: Wallet },
    { to: "/spaces", label: "Spaces", icon: Layers },
    { to: "/sync-logs", label: "Sync Logs", icon: Webhook },
    ...(isAdmin
      ? [
          { to: "/team", label: "Team", icon: UsersRound },
          { to: "/audit-log", label: "Audit Log", icon: ShieldCheck },
          { to: "/settings", label: "Settings", icon: Settings },
        ]
      : []),
  ];

  return (
    <aside
      aria-hidden={isMobile && !mobileOpen ? true : undefined}
      inert={isMobile && !mobileOpen ? true : undefined}
      style={
        isMobile
          ? {
              width: 232,
              flexShrink: 0,
              borderRight: "1px solid var(--border)",
              background: "var(--sidebar-bg)",
              display: "flex",
              flexDirection: "column",
              position: "fixed",
              top: 0,
              left: 0,
              height: "100vh",
              zIndex: 50,
              transform: mobileOpen ? "translateX(0)" : "translateX(-100%)",
              transition: "transform 200ms cubic-bezier(0.16, 1, 0.3, 1)",
              boxShadow: mobileOpen ? "0 8px 40px rgba(0,0,0,0.25)" : "none",
            }
          : {
              width: collapsed ? 60 : 232,
              flexShrink: 0,
              borderRight: "1px solid var(--border)",
              background: "var(--sidebar-bg)",
              display: "flex",
              flexDirection: "column",
              transition: "width 200ms cubic-bezier(0.16, 1, 0.3, 1)",
              position: "sticky",
              top: 0,
              height: "100vh",
            }
      }
    >
      {/* Logo */}
      <div
        style={{
          height: 56,
          padding: collapsed ? "0 12px" : "0 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <BrandIcon size={30} />
        {!collapsed && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 1,
              minWidth: 0,
              lineHeight: 1.15,
            }}
          >
            <BrandWordmark fontSize={18} />
            <div
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                lineHeight: 1.2,
                fontWeight: 500,
              }}
            >
              operations console
            </div>
          </div>
        )}
        {isMobile && (
          <button
            type="button"
            onClick={onMobileClose}
            aria-label="Close navigation"
            style={{
              marginLeft: "auto",
              border: 0,
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: 6,
              display: "flex",
              borderRadius: 6,
            }}
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav
        style={{
          flex: 1,
          padding: 8,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        {!collapsed && (
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "var(--text-faint)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              padding: "8px 10px 4px",
            }}
          >
            Workspace
          </div>
        )}
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className="nav-3d"
              style={({ isActive }) => ({
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: collapsed ? "8px 10px" : "7px 10px",
                fontSize: 13,
                fontWeight: 500,
                color: isActive ? "var(--text)" : "var(--text-muted)",
                background: isActive
                  ? "var(--sidebar-active-bg)"
                  : "transparent",
                borderRadius: 7,
                textDecoration: "none",
                position: "relative",
                justifyContent: collapsed ? "center" : "flex-start",
                transition: "all 100ms",
              })}
            >
              {({ isActive }) => (
                <>
                  {isActive && !collapsed && (
                    <span
                      style={{
                        position: "absolute",
                        left: -8,
                        top: 6,
                        bottom: 6,
                        width: 2,
                        borderRadius: 999,
                        background: "var(--accent)",
                      }}
                    />
                  )}
                  <Icon
                    size={16}
                    strokeWidth={1.75}
                    style={{ flexShrink: 0 }}
                  />
                  {!collapsed && (
                    <span style={{ flex: 1, textAlign: "left" }}>
                      {item.label}
                    </span>
                  )}
                  {!collapsed && item.badge && item.badge > 0 && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: 999,
                        background: "var(--pill-amber-bg)",
                        color: "var(--pill-amber-text)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{ padding: 10, borderTop: "1px solid var(--border)" }}>
        {!collapsed ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: 8,
              borderRadius: 8,
              background: "var(--muted-bg)",
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: "linear-gradient(135deg, #1f2937, #4b5563)",
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {(org?.name ?? "O").charAt(0).toUpperCase()}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={org?.name ?? undefined}
              >
                {org?.name ?? "Organization"}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                {user?.role ?? ""}
              </div>
            </div>
            <button
              onClick={() => setCollapsed(true)}
              style={{
                border: 0,
                background: "transparent",
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: 4,
                display: "flex",
                borderRadius: 4,
              }}
            >
              <PanelLeft size={14} strokeWidth={1.75} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCollapsed(false)}
            style={{
              width: "100%",
              padding: "8px",
              border: 0,
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <PanelLeft size={16} strokeWidth={1.75} />
          </button>
        )}
      </div>
    </aside>
  );
}
