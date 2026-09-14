import { useMemo, type ReactNode } from 'react';
import { ClickupAvatar } from '../components/ui/ClickupAvatar';

export interface Option { value: string; label: string; icon?: ReactNode }

/** Keep a selection that scoped out of the list visible and clearable, as "(0)". */
function keepSelected(opts: Option[], seen: Set<string>, selected: string[]): Option[] {
  for (const s of selected) if (!seen.has(s)) opts.push({ value: s, label: `${s} (0)` });
  return opts;
}

export function useClientOptions(data: unknown, selected: string[]): Option[] {
  return useMemo(() => {
    const rows = (Array.isArray(data) ? data : []) as { client: string; taskCount?: number }[];
    const seen = new Set<string>();
    const opts: Option[] = [];
    for (const r of rows) {
      if (!r.client) continue;
      seen.add(r.client);
      opts.push({ value: r.client, label: typeof r.taskCount === 'number' ? `${r.client} (${r.taskCount})` : r.client });
    }
    return keepSelected(opts, seen, selected);
  }, [data, selected]);
}

export function useSubProjectOptions(data: unknown, selected: string[]): Option[] {
  return useMemo(() => {
    const rows = (Array.isArray(data) ? data : []) as { subProject: string; taskCount: number }[];
    const seen = new Set<string>();
    const opts: Option[] = [];
    for (const r of rows) {
      if (!r.subProject) continue;
      seen.add(r.subProject);
      opts.push({ value: r.subProject, label: `${r.subProject} (${r.taskCount})` });
    }
    return keepSelected(opts, seen, selected);
  }, [data, selected]);
}

export function useListOptions(data: unknown, showSpace: boolean): Option[] {
  return useMemo(() => {
    const rows = (Array.isArray(data) ? data : []) as { listId: string; listName: string; spaceName?: string | null; taskCount?: number }[];
    return rows.filter((r) => r.listId).map((r) => {
      const count = typeof r.taskCount === 'number' ? ` (${r.taskCount})` : '';
      return { value: r.listId, label: showSpace && r.spaceName ? `${r.spaceName} · ${r.listName}${count}` : `${r.listName}${count}` };
    });
  }, [data, showSpace]);
}

export function useFolderOptions(data: unknown, showSpace: boolean): Option[] {
  return useMemo(() => {
    const rows = (Array.isArray(data) ? data : []) as { folderId: string; folderName: string; spaceName?: string | null; taskCount?: number }[];
    return rows.filter((r) => r.folderId).map((r) => {
      const count = typeof r.taskCount === 'number' ? ` (${r.taskCount})` : '';
      return { value: r.folderId, label: showSpace && r.spaceName ? `${r.spaceName} · ${r.folderName}${count}` : `${r.folderName}${count}` };
    });
  }, [data, showSpace]);
}

/** Task assignees by NAME (`/reports/tasks/assignees`) — the "Assigned to" filter. */
export function useTaskAssigneeOptions(data: unknown): Option[] {
  return useMemo(() => {
    const rows = (Array.isArray(data) ? data : []) as { name: string; taskCount?: number }[];
    const seen = new Set<string>();
    const opts: Option[] = [];
    for (const r of rows) {
      if (!r.name || seen.has(r.name)) continue;
      seen.add(r.name);
      const count = typeof r.taskCount === 'number' ? ` (${r.taskCount})` : '';
      opts.push({ value: r.name, label: `${r.name}${count}`, icon: <ClickupAvatar name={r.name} size={18} /> });
    }
    return opts;
  }, [data]);
}

/** People who logged time, by USER ID (`/reports/time-entries/by-user`) — the "Logged by" filter. */
export function useLoggedByOptions(data: unknown): Option[] {
  return useMemo(() => {
    const rows = (Array.isArray(data) ? data : []) as { userId?: string; userName: string }[];
    const seen = new Set<string>();
    const opts: Option[] = [];
    for (const r of rows) {
      const id = r.userId ?? r.userName;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      opts.push({ value: id, label: r.userName, icon: <ClickupAvatar userId={r.userId} name={r.userName} size={18} /> });
    }
    return opts;
  }, [data]);
}

/** Statuses actually stored (from the tasks summary), so a pick always matches. */
export function useStatusOptions(summary: unknown): Option[] {
  return useMemo(() => {
    const rows = ((summary as { byStatus?: unknown } | undefined)?.byStatus ?? []) as { status: string | null }[];
    const seen = new Set<string>();
    const opts: Option[] = [];
    for (const r of rows) {
      const s = (r.status ?? '').trim();
      if (!s || seen.has(s.toLowerCase())) continue;
      seen.add(s.toLowerCase());
      opts.push({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) });
    }
    return opts;
  }, [summary]);
}
