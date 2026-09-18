/**
 * Bridge from option-id scope to name-keyed `client_budgets`. A name owned (via any
 * option) by a team the viewer does not lead is ambiguous and excluded — a name
 * filter must never widen access across teams. See spec "Name-keyed data".
 */
export function leadBudgetClientNames(
  leadOptionIds: string[],
  options: { optionId: string; name: string; teamId: string | null }[],
  leadTeamIds: string[],
): Set<string> {
  const lead = new Set(leadOptionIds);
  const ledTeams = new Set(leadTeamIds);
  const foreign = new Set(options.filter((o) => o.teamId && !ledTeams.has(o.teamId)).map((o) => o.name));
  return new Set(options.filter((o) => lead.has(o.optionId) && !foreign.has(o.name)).map((o) => o.name));
}
