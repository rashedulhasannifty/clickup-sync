/**
 * The ONE place team-scoped visibility is decided. Pure: callers load the
 * memberships and pass them in. See
 * docs/superpowers/specs/2026-09-18-team-scoped-access-design.md.
 *
 * Keys are ClickUp "Client" option ids (never names) and are matched against
 * `clickup_tasks.scope_client_option_id`.
 */
export type TeamRole = "LEAD" | "MEMBER";

export type AccessScope =
  | { kind: "unrestricted"; canEdit: boolean }
  | {
      kind: "scoped";
      clients: ReadonlyMap<string, TeamRole>;
      ledUserClickupIds: readonly string[];
      selfClickupId: string | null;
      ledTeamIds: readonly string[];
    };

export interface ScopeInputs {
  role: "OWNER" | "ADMIN" | "MEMBER";
  scopingEnabled: boolean;
  selfClickupId: string | null;
  memberships: { teamId: string; role: TeamRole }[];
  teamClients: { teamId: string; optionId: string }[];
  teamMembers: { teamId: string; clickupUserId: string | null }[];
}

export function resolveScope(i: ScopeInputs): AccessScope {
  if (i.role === "OWNER" || i.role === "ADMIN")
    return { kind: "unrestricted", canEdit: true };
  // Flag off must reproduce pre-teams behaviour exactly: members read all, write nothing.
  if (!i.scopingEnabled) return { kind: "unrestricted", canEdit: false };

  const roleByTeam = new Map(i.memberships.map((m) => [m.teamId, m.role]));
  const clients = new Map<string, TeamRole>();
  for (const tc of i.teamClients) {
    const role = roleByTeam.get(tc.teamId);
    if (!role) continue;
    if (clients.get(tc.optionId) !== "LEAD") clients.set(tc.optionId, role);
  }
  const ledTeamIds = i.memberships
    .filter((m) => m.role === "LEAD")
    .map((m) => m.teamId);
  const led = new Set(ledTeamIds);
  const ledUserClickupIds = [
    ...new Set(
      i.teamMembers
        .filter((m) => led.has(m.teamId) && m.clickupUserId)
        .map((m) => m.clickupUserId as string),
    ),
  ];
  return {
    kind: "scoped",
    clients,
    ledUserClickupIds,
    selfClickupId: i.selfClickupId,
    ledTeamIds,
  };
}

export function isUnrestricted(
  s: AccessScope,
): s is Extract<AccessScope, { kind: "unrestricted" }> {
  return s.kind === "unrestricted";
}

/** null = every client (unrestricted). An empty array means NOTHING is visible. */
export function visibleClientIds(s: AccessScope): string[] | null {
  return isUnrestricted(s) ? null : [...s.clients.keys()];
}

export function leadClientIds(s: AccessScope): string[] | null {
  return isUnrestricted(s)
    ? null
    : [...s.clients].filter(([, r]) => r === "LEAD").map(([id]) => id);
}

export function canSeeCost(s: AccessScope, optionId: string | null): boolean {
  if (isUnrestricted(s)) return true;
  return optionId != null && s.clients.get(optionId) === "LEAD";
}

export function canEditChargeability(
  s: AccessScope,
  optionId: string | null,
): boolean {
  if (isUnrestricted(s)) return s.canEdit;
  return optionId != null && s.clients.get(optionId) === "LEAD";
}

export function isLeadAnywhere(s: AccessScope): boolean {
  return isUnrestricted(s) ? s.canEdit : s.ledTeamIds.length > 0;
}

/** ClickUp user ids whose timesheet the viewer may open. null = anyone. */
export function timesheetUserIds(s: AccessScope): string[] | null {
  if (isUnrestricted(s)) return null;
  const ids = new Set(s.ledUserClickupIds);
  if (s.selfClickupId) ids.add(s.selfClickupId);
  return [...ids];
}
