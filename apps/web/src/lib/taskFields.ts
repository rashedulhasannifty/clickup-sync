export type Task = Record<string, unknown>;

/** A task's ClickUp "Sub-Project" labels (a task can carry several). */
export const subProjectsOf = (r: Task): string[] => (Array.isArray(r.subProjects) ? (r.subProjects as string[]) : []);

export function parseAssignees(r: Task): { name: string; email?: string }[] {
  const names = String(r.assigneesNames ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const emails = String(r.assigneesEmails ?? '').split(',').map((s) => s.trim());
  return names.map((name, i) => ({ name, email: emails[i] || undefined }));
}
