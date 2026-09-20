import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from "react";
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
  Building2,
  Webhook,
  ShieldCheck,
  Settings,
  PanelLeft,
  X,
  type LucideIcon,
  UsersRound,
  UserCog,
  Wallet,
  Rocket,
  ListTree,
  Landmark,
  Network,
  Star,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  Pin,
  Receipt,
  Gauge,
  Briefcase,
} from "lucide-react";
import { useStats } from "../../hooks/useReports";
import { useAuth } from "../../hooks/useAuth";
import { useXeroStatus } from "../../hooks/useFinance";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  tag?: string;
  /** The section hue, applied to this row's icon. Inherited from the group,
   *  so a pinned row keeps the colour of the section it really belongs to. */
  color?: string;
}

/** A labelled run of nav items. An empty label is the landing pair, which
 *  renders above the first header rather than under one of its own. */
interface NavGroup {
  label: string;
  /** CSS var for this section's hue. */
  color: string;
  /** The parent row's icon. Absent on the unlabelled landing pair, which has
   *  no parent row of its own. */
  icon?: LucideIcon;
  items: NavItem[];
}

/** Headers only once the list is long enough to need them. A scoped MEMBER
 *  sees seven items; grouping those is chrome over a list nobody struggles to
 *  scan, and it would print a "Time & Cost" header at someone whose cost is
 *  masked on every page under it. */
const GROUP_THRESHOLD = 9;
/** A pin list that grows without limit is just the long sidebar again. */
const PIN_LIMIT = 5;
const PINS_KEY = "sidebarPins";
const CLOSED_GROUPS_KEY = "sidebarClosedGroups";

/** localStorage is absent in private windows and holds whatever a previous
 *  version wrote, so every read is guarded and falls back to a usable default. */
function readStringList(key: string, limit?: number): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const strings = parsed.filter((v): v is string => typeof v === "string");
    return limit === undefined ? strings : strings.slice(0, limit);
  } catch {
    return [];
  }
}

function writeStringList(key: string, value: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private window or blocked storage: pins just don't persist.
  }
}

/**
 * One nav row. The pin control is a SIBLING of the NavLink, never a child —
 * a <button> inside an <a> is invalid markup and the anchor swallows its
 * click. It keeps its 22px whether or not it's showing, so revealing it on
 * hover never reflows the label or shifts a badge.
 */
function NavRow({
  item,
  collapsed,
  sub,
  pinned,
  pinDisabled,
  onTogglePin,
}: {
  item: NavItem;
  collapsed: boolean;
  /** A child of a collapsible parent: indented under the rule, slightly
   *  smaller, but it keeps its icon — 19 pages are easier to recognise by
   *  glyph than by reading down a list of words. */
  sub?: boolean;
  pinned: boolean;
  pinDisabled: boolean;
  onTogglePin: (to: string) => void;
}) {
  const Icon = item.icon;
  return (
    <div className="nav-row" style={{ display: "flex", alignItems: "center" }}>
      <NavLink
        to={item.to}
        className="sidebar-item"
        style={
          {
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: 1,
            minWidth: 0,
            height: sub && !collapsed ? 28 : 32,
            padding: "0 8px",
            fontSize: sub && !collapsed ? 13 : 14,
            // No fontWeight here: the active row bumps to 500 from CSS, and an
            // inline value would win over it.
            borderRadius: 6,
            textDecoration: "none",
            justifyContent: collapsed ? "center" : "flex-start",
            // The hue this row tints with when it is the current page. Colour
            // and background themselves are decided in index.css.
            "--row-tint": item.color ?? "var(--accent)",
          } as CSSProperties
        }
      >
        <>
          <Icon
              size={sub && !collapsed ? 15 : 16}
              strokeWidth={2}
              style={{ flexShrink: 0, color: item.color }}
            />
            {!collapsed && (
              <span
                style={{
                  flex: 1,
                  textAlign: "left",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
              </span>
            )}
            {!collapsed && item.badge && item.badge > 0 && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  // Amber text, not an amber pill: keeps the "needs attention"
                  // signal without a filled chip the flat style has no room for.
                  color: "var(--pill-amber-text)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            )}
            {!collapsed && item.tag && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "1px 5px",
                  borderRadius: 4,
                  // Deliberately NOT the row's section hue: "Beta" means the
                  // same thing on every page, so two Beta tags must not read
                  // as two different things.
                  background: "var(--pill-purple-bg)",
                  color: "var(--pill-purple-text)",
                }}
              >
                {item.tag}
              </span>
            )}
        </>
      </NavLink>
      {!collapsed && (
        <button
          type="button"
          className={pinned ? "nav-pin is-pinned" : "nav-pin"}
          onClick={() => onTogglePin(item.to)}
          disabled={!pinned && pinDisabled}
          aria-label={
            pinned ? `Unpin ${item.label}`
            : pinDisabled ? `Pin limit reached (${PIN_LIMIT} pinned)`
            : `Pin ${item.label}`
          }
          title={
            pinned ? `Unpin ${item.label}`
            : pinDisabled ? `Pin limit reached (${PIN_LIMIT} pinned)`
            : `Pin ${item.label}`
          }
          style={{
            width: 22,
            flexShrink: 0,
            border: 0,
            background: "transparent",
            // A pinned star wears the Pinned section's own hue, so the colour
            // means "this is pinned" rather than just "this is a control".
            // Unpinned stays faint until hover — see .nav-pin in index.css.
            color: pinned ? "var(--nav-pin)" : "var(--text-faint)",
            cursor: pinned || !pinDisabled ? "pointer" : "not-allowed",
            padding: 3,
            display: "flex",
            justifyContent: "center",
            borderRadius: 5,
          }}
        >
          <Star size={12} strokeWidth={1.75} fill={pinned ? "currentColor" : "none"} />
        </button>
      )}
    </div>
  );
}

/** The clickable head of a collapsible section: icon, label, trailing chevron,
 *  sized exactly like a nav row so the tree reads as one list. */
function ParentRow({
  icon: Icon,
  label,
  color,
  open,
  onToggle,
}: {
  icon: LucideIcon;
  label: string;
  color: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="sidebar-item"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        height: 32,
        border: 0,
        background: "transparent",
        cursor: "pointer",
        padding: "0 8px",
        borderRadius: 6,
        fontSize: 14,
        fontWeight: 400,
        textAlign: "left",
      }}
    >
      <Icon size={16} strokeWidth={2} style={{ flexShrink: 0, color }} />
      <span style={{ flex: 1 }}>{label}</span>
      {open ?
        <ChevronDown size={14} strokeWidth={2} style={{ flexShrink: 0 }} />
      : <ChevronRight size={14} strokeWidth={2} style={{ flexShrink: 0 }} />}
    </button>
  );
}

/** The indented run of children under a ParentRow. */
function SubItems({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        margin: "2px 0 2px 15px",
        paddingLeft: 9,
        borderLeft: "1px solid var(--border)",
      }}
    >
      {children}
    </div>
  );
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
  const { hasRole, user, org, access } = useAuth();
  const isAdmin = hasRole("ADMIN");
  // A missing `access` (still loading, or an older cached session) is never
  // treated as denied — everything renders as if unrestricted until the real
  // summary lands, so nothing flickers off for an existing session.
  const unrestricted = access?.unrestricted ?? true;
  const canSeeCost = access?.canSeeCost ?? true;
  const canSeeSprints = access?.canSeeSprints ?? true;
  const canEditChargeability = access?.canEditChargeability ?? true;
  const isLeadOfATeam = access?.teams.some((t) => t.role === "LEAD") ?? false;
  const { data: stats } = useStats(unrestricted);
  // Finance is admin-only and appears only once the server has Xero credentials.
  const xeroStatus = useXeroStatus(isAdmin);
  const showFinance = isAdmin && !!xeroStatus.data?.configured;

  // On mobile the sidebar is a full-width off-canvas drawer — never the narrow
  // icon-rail. The desktop collapse preference is kept separately so the two
  // modes don't fight when the viewport crosses the breakpoint.
  const collapsed = isMobile ? false : collapsedDesktop;

  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", String(collapsedDesktop));
  }, [collapsedDesktop]);

  // Pins and fold state are per-browser, like `sidebarCollapsed` above — there
  // is no per-user preferences column (`app_settings.preferences` is org-wide),
  // and a lost pin costs one click to restore.
  const [pins, setPins] = useState<string[]>(() => readStringList(PINS_KEY, PIN_LIMIT));
  const [closedGroups, setClosedGroups] = useState<string[]>(() =>
    readStringList(CLOSED_GROUPS_KEY),
  );
  useEffect(() => writeStringList(PINS_KEY, pins), [pins]);
  useEffect(() => writeStringList(CLOSED_GROUPS_KEY, closedGroups), [closedGroups]);

  const togglePin = (to: string) =>
    setPins((prev) =>
      prev.includes(to) ? prev.filter((p) => p !== to)
      : prev.length >= PIN_LIMIT ? prev
      : [...prev, to],
    );
  const toggleGroup = (label: string) =>
    setClosedGroups((prev) =>
      prev.includes(label) ? prev.filter((g) => g !== label) : [...prev, label],
    );

  // Audit Log and Settings are admin-only; members see everything else, minus
  // whatever their `access` summary says they can't see (team-scoped access —
  // a no-op set of gates while `access.unrestricted` is true for everyone).
  //
  // Groups follow the GATES, not just the subject matter: every item under
  // Monitoring is `unrestricted`, so that header appears and disappears whole
  // rather than stranding one orphan row under a heading.
  const navGroups: NavGroup[] = [
    {
      label: "",
      color: "var(--nav-home)",
      items: [
        { to: "/overview", label: "Overview", icon: Home },
        ...(canSeeCost ? [{ to: "/analytics", label: "Analytics", icon: BarChart3 }] : []),
      ],
    },
    {
      label: "Work",
      color: "var(--nav-work)",
      icon: FolderKanban,
      items: [
        { to: "/tasks", label: "Tasks", icon: CheckSquare },
        { to: "/work", label: "Tasks & time", icon: ListTree, tag: "Beta" },
        ...(canSeeSprints ? [{ to: "/sprints", label: "Sprints", icon: Rocket }] : []),
        { to: "/clients", label: "Clients", icon: Building2 },
        { to: "/spaces", label: "Spaces", icon: Layers },
      ],
    },
    {
      label: "Time & Cost",
      color: "var(--nav-cost)",
      icon: Receipt,
      items: [
        { to: "/time-entries", label: "Time Entries", icon: Clock },
        { to: "/timesheet", label: "Timesheet", icon: CalendarClock },
        ...(canEditChargeability
          ? [{ to: "/chargeability-rules", label: "Chargeability", icon: Scale }]
          : []),
        ...(canSeeCost ? [{ to: "/budgets", label: "Budgets", icon: Wallet }] : []),
        ...(showFinance ? [{ to: "/finance", label: "Finance", icon: Landmark, tag: "Beta" }] : []),
        ...(isAdmin ? [{ to: "/assignee-rates", label: "Assignee Rates", icon: DollarSign }] : []),
      ],
    },
    {
      // Time Spikes, Missing Rates and Sync Logs are `requireUnrestricted`
      // server-side (Ruling R30/R22) — NOT Owner/Admin-only. A flag-off MEMBER
      // uses these pages today, so they gate on `unrestricted`, not `isAdmin`.
      label: "Monitoring",
      color: "var(--nav-monitor)",
      icon: Gauge,
      items: unrestricted
        ? [
            { to: "/time-spikes", label: "Time Spikes", icon: Activity },
            {
              to: "/missing-rates",
              label: "Missing Rates",
              icon: AlertTriangle,
              badge: stats?.missingRateEntries,
            },
            { to: "/sync-logs", label: "Sync Logs", icon: Webhook },
          ]
        : [],
    },
    {
      // "Organization" rather than "Admin": a lead who is not an admin sees
      // only My team under it, and that shouldn't read as a leaked admin page.
      label: "Organization",
      color: "var(--nav-org)",
      icon: Briefcase,
      items: [
        ...(isLeadOfATeam ? [{ to: "/my-team", label: "My team", icon: UsersRound }] : []),
        ...(isAdmin
          ? [
              { to: "/users", label: "Users", icon: UserCog },
              { to: "/teams", label: "Teams", icon: Network },
              { to: "/audit-log", label: "Audit Log", icon: ShieldCheck },
              { to: "/settings", label: "Settings", icon: Settings },
            ]
          : []),
      ],
    },
  ].filter((g) => g.items.length > 0);

  const navItems: NavItem[] = navGroups.flatMap((g) => g.items.map((i) => ({ ...i, color: g.color })));
  // Below the threshold the nav renders exactly as it did before groups existed.
  const grouped = navItems.length > GROUP_THRESHOLD;
  // A pin to a page this viewer can no longer reach is skipped, not broken —
  // `teamScopingEnabled` can be switched on under someone mid-session.
  const pinnedItems = pins
    .map((to) => navItems.find((i) => i.to === to))
    .filter((i): i is NavItem => !!i);
  const pinDisabled = pins.length >= PIN_LIMIT;
  const pinnedOpen = !closedGroups.includes("Pinned");

  const itemsOf = (group: NavGroup): NavItem[] =>
    group.items.map((i) => ({ ...i, color: group.color }));

  const renderRow = (item: NavItem, keyPrefix = "", sub = false) => (
    <NavRow
      key={keyPrefix + item.to}
      item={item}
      collapsed={collapsed}
      sub={sub}
      pinned={pins.includes(item.to)}
      pinDisabled={pinDisabled}
      onTogglePin={togglePin}
    />
  );

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
        {/* Pinned: the handful of pages you actually live in. Shown collapsed
            too (icons only) — that is where the rail's scarce vertical space
            matters most. */}
        {pinnedItems.length > 0 && (
          <>
            {collapsed ?
              pinnedItems.map((item) => renderRow(item, "pin:"))
            : <>
                <ParentRow
                  icon={Pin}
                  label="Pinned"
                  color="var(--nav-pin)"
                  open={pinnedOpen}
                  onToggle={() => toggleGroup("Pinned")}
                />
                {pinnedOpen && (
                  <SubItems>{pinnedItems.map((item) => renderRow(item, "pin:", true))}</SubItems>
                )}
              </>
            }
            <div style={{ height: 1, background: "var(--border)", margin: "6px 8px" }} />
          </>
        )}

        {grouped ?
          navGroups.map((group, i) => {
            const open = !group.label || !closedGroups.includes(group.label);
            // A 60px rail has no room for a text header, so groups read as
            // dividers there — and never fold, since there'd be no header left
            // to click and the items would be unreachable.
            if (collapsed) {
              return (
                <Fragment key={group.label || "top"}>
                  {i > 0 && (
                    <div style={{ height: 1, background: "var(--border)", margin: "6px 8px" }} />
                  )}
                  {itemsOf(group).map((item) => renderRow(item))}
                </Fragment>
              );
            }
            return (
              <Fragment key={group.label || "top"}>
                {group.label && group.icon && (
                  <ParentRow
                    icon={group.icon}
                    label={group.label}
                    color={group.color}
                    open={open}
                    onToggle={() => toggleGroup(group.label)}
                  />
                )}
                {open &&
                  (group.label ?
                    <SubItems>
                      {itemsOf(group).map((item) => renderRow(item, "", true))}
                    </SubItems>
                  : itemsOf(group).map((item) => renderRow(item)))}
              </Fragment>
            );
          })
        : navItems.map((item) => renderRow(item))}
      </nav>

      {/* Footer */}
      <div style={{ padding: 8, borderTop: "1px solid var(--border)" }}>
        {!collapsed ? (
          <div
            className="sidebar-item"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 44,
              padding: "0 8px",
              borderRadius: 6,
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: "var(--muted-bg)",
                color: "var(--text)",
                fontSize: 12,
                fontWeight: 600,
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
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={org?.name ?? undefined}
              >
                {org?.name ?? "Organization"}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {user?.role ?? ""}
              </div>
            </div>
            <button
              onClick={() => setCollapsed(true)}
              aria-label="Collapse sidebar"
              style={{
                border: 0,
                background: "transparent",
                color: "var(--text-faint)",
                cursor: "pointer",
                padding: 4,
                display: "flex",
                borderRadius: 4,
              }}
            >
              <PanelLeft size={15} strokeWidth={2} />
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
