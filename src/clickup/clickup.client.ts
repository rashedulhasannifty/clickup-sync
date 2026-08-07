import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import {
  ClickUpMember,
  ClickUpTask,
  ClickUpTaskPage,
  ClickUpTimeEntry,
  ClickUpWebhook,
  CreateTimeEntryPayload,
} from "./clickup.types";
import { buildTimeEntriesQuery, resolveTimeEntriesWindow } from "./time-entries.util";
import { SettingsService } from "../settings/settings.service";

const MAX_429_RETRIES = 3;
const MAX_BACKOFF_MS = 60_000;
// ClickUp's GET /team/{team}/time_entries has no pagination — it returns the
// whole [start_date, end_date] window in one response. A multi-year window on a
// busy task risks a large/truncated response, so split it into <=1-year slices
// and concatenate. A window within a single slice issues exactly one request,
// so existing hot paths (webhooks, hourly sweep) are unchanged.
const TIME_ENTRIES_SLICE_MS = 365 * 24 * 60 * 60 * 1000;

export type ListCatalogEntry = {
  id: string;
  name: string;
  folderId: string | null;
  folderName: string | null;
  spaceId: string | null;
  spaceName: string | null;
  archived: boolean;
  startDate: Date | null;
  dueDate: Date | null;
};

@Injectable()
export class ClickupClient {
  private readonly logger = new Logger(ClickupClient.name);
  private readonly baseUrl = "https://api.clickup.com/api/v2";

  constructor(
    private readonly http: HttpService,
    private readonly settings: SettingsService,
  ) {}

  private headers() {
    return { Authorization: this.settings.getApiToken() };
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    data?: unknown,
    attempt = 0,
  ): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.http.request<T>({
          method,
          url: `${this.baseUrl}${path}`,
          data,
          headers: this.headers(),
          timeout: 30000,
        }),
      );
      return response.data;
    } catch (error: any) {
      const status = error?.response?.status;
      // Honor ClickUp's own rate-limit backoff instead of failing the job and
      // leaning on BullMQ's generic retry — Retry-After tells us exactly how
      // long to wait. Bounded so a sustained 429 still surfaces as an error.
      if (status === 429 && attempt < MAX_429_RETRIES) {
        const waitMs = this.retryAfterMs(error?.response?.headers, attempt);
        this.logger.warn(
          `ClickUp ${method} ${path} rate-limited (429); retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_429_RETRIES})`,
        );
        await this.sleep(waitMs);
        return this.request<T>(method, path, data, attempt + 1);
      }
      // Surface ClickUp's actual response body. Axios's error.message is just
      // "Request failed with status code 400" — the real reason (e.g.
      // { err: "...", ECODE: "..." }) lives in error.response.data and was
      // being discarded, making 4xx failures impossible to diagnose from logs.
      const body = error?.response?.data;
      const detail = body
        ? typeof body === "string"
          ? body
          : JSON.stringify(body)
        : "";
      this.logger.error(
        `ClickUp ${method} ${path} failed: ${status || ""} ${error?.message}${detail ? ` — ${detail}` : ""}`,
      );
      throw error;
    }
  }

  private retryAfterMs(
    headers: Record<string, unknown> | undefined,
    attempt: number,
  ): number {
    const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
    const secs = Number(raw);
    if (Number.isFinite(secs) && secs >= 0)
      return Math.min(secs * 1000, MAX_BACKOFF_MS);
    // No/!invalid header → exponential fallback (1s, 2s, 4s…), capped.
    return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getTask(taskId: string): Promise<ClickUpTask> {
    return this.request("GET", `/task/${taskId}?include_subtasks=true`);
  }

  getTasksBySpace(
    spaceId: string,
    options: {
      teamId: string;
      dateUpdatedGt?: number;
      page?: number;
      includeClosed?: boolean;
      subtasks?: boolean;
      limit?: number;
      archived?: boolean;
    },
  ): Promise<ClickUpTaskPage> {
    const params = new URLSearchParams();
    params.append("space_ids[]", spaceId);
    if (options.dateUpdatedGt)
      params.append("date_updated_gt", String(options.dateUpdatedGt));
    params.append("include_closed", String(options.includeClosed ?? true));
    params.append("subtasks", String(options.subtasks ?? true));
    params.append("archived", String(options.archived ?? false));
    params.append("page", String(options.page ?? 0));
    params.append("limit", String(options.limit ?? 100));
    return this.request(
      "GET",
      `/team/${options.teamId}/task?${params.toString()}`,
    );
  }

  /**
   * Enumerate every list in a space, flagging whether the list sits in an
   * archived container — the list itself is archived, or its folder is.
   *
   * The distinction matters because ClickUp does NOT set a task's `archived`
   * flag when only its *list* (or folder) is archived. Those tasks stay
   * `archived=false` at the task level and are returned by
   * `/list/{id}/task?archived=false` — never by `archived=true`, and never by
   * the team endpoint (which excludes anything in an archived container). So a
   * completed sprint (its list archived while the "Sprints" folder stays
   * active) needs an explicit `archived=false` scan of that list. Active lists,
   * by contrast, only need the `archived=true` scan — their live tasks already
   * arrive via the team endpoint; only individually-archived tasks are missing.
   *
   * Lists are gathered from folderless lists (active + archived) and from every
   * folder's lists (active + archived), enumerated per-folder via
   * `/folder/{id}/list?archived=…` rather than the space folder query's
   * `.lists` — the latter only carries a folder's *active* lists, so an
   * archived sprint list nested in an active folder would otherwise be invisible.
   * Ids are de-duplicated; the archived-container flag is OR-accumulated so a
   * list seen in any archived context is scanned in both states.
   */
  async getSpaceListCatalog(spaceId: string): Promise<ListCatalogEntry[]> {
    const byId = new Map<string, ListCatalogEntry>();
    const toMillis = (v: unknown): Date | null => {
      const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
      return Number.isFinite(n) && n > 0 ? new Date(n) : null;
    };
    type RawList = {
      id?: string;
      name?: string;
      start_date?: unknown;
      due_date?: unknown;
      folder?: { id?: string; name?: string };
      space?: { id?: string; name?: string };
    };
    const add = (
      l: RawList,
      archivedContainer: boolean,
      folderId: string | null,
      folderName: string | null,
    ) => {
      if (!l.id) return;
      const prev = byId.get(l.id);
      const entry: ListCatalogEntry = {
        id: l.id,
        name: l.name ?? prev?.name ?? "Unknown List",
        folderId: folderId ?? l.folder?.id ?? prev?.folderId ?? null,
        folderName: folderName ?? l.folder?.name ?? prev?.folderName ?? null,
        spaceId: l.space?.id ?? prev?.spaceId ?? spaceId,
        spaceName: l.space?.name ?? prev?.spaceName ?? null,
        archived: (prev?.archived ?? false) || archivedContainer,
        startDate: toMillis(l.start_date) ?? prev?.startDate ?? null,
        dueDate: toMillis(l.due_date) ?? prev?.dueDate ?? null,
      };
      byId.set(l.id, entry);
    };

    // Folderless lists: an archived folderless list is itself an archived container.
    for (const archived of [false, true]) {
      const res = await this.request<{ lists?: RawList[] }>(
        "GET",
        `/space/${spaceId}/list?archived=${archived}`,
      );
      for (const l of res.lists ?? []) add(l, archived, l.folder?.id ?? null, l.folder?.name ?? null);
    }

    // Folders: collect them (active + archived), then enumerate each folder's
    // lists in both states. A list is an archived container if its folder is
    // archived OR the list itself is archived.
    const folders: Array<{ id: string; name: string | null; archived: boolean }> = [];
    for (const archived of [false, true]) {
      const res = await this.request<{ folders?: Array<{ id?: string; name?: string }> }>(
        "GET",
        `/space/${spaceId}/folder?archived=${archived}`,
      );
      for (const f of res.folders ?? [])
        if (f.id) folders.push({ id: f.id, name: f.name ?? null, archived });
    }
    for (const folder of folders) {
      for (const listArchived of [false, true]) {
        const res = await this.request<{ lists?: RawList[] }>(
          "GET",
          `/folder/${folder.id}/list?archived=${listArchived}`,
        );
        for (const l of res.lists ?? [])
          add(l, folder.archived || listArchived, folder.id, folder.name);
      }
    }

    return [...byId.values()];
  }

  private async getSpaceLists(
    spaceId: string,
  ): Promise<Array<{ id: string; archivedContainer: boolean }>> {
    const cat = await this.getSpaceListCatalog(spaceId);
    return cat.map((e) => ({ id: e.id, archivedContainer: e.archived }));
  }

  /**
   * Page through one list's tasks for a given `archived` flag. Unlike the
   * team-level task endpoint (which caps `archived=true` at ~100 and lies with
   * `last_page=true`), the list endpoint paginates correctly.
   */
  private async fetchListTasks(
    listId: string,
    archived: boolean,
    options: { dateUpdatedGt?: number; includeClosed?: boolean; subtasks?: boolean },
  ): Promise<{ tasks: ClickUpTask[]; truncated: boolean }> {
    const MAX_PAGES = 5000;
    const all: ClickUpTask[] = [];
    let page = 0;
    for (; page < MAX_PAGES; page++) {
      const params = new URLSearchParams();
      params.append("archived", String(archived));
      params.append("include_closed", String(options.includeClosed ?? true));
      params.append("subtasks", String(options.subtasks ?? true));
      if (options.dateUpdatedGt)
        params.append("date_updated_gt", String(options.dateUpdatedGt));
      params.append("page", String(page));
      const res = await this.request<ClickUpTaskPage>(
        "GET",
        `/list/${listId}/task?${params.toString()}`,
      );
      const tasks = res.tasks || [];
      all.push(...tasks);
      if (tasks.length < 100) break;
    }
    return { tasks: all, truncated: page === MAX_PAGES };
  }

  /**
   * Streaming space fetch: invokes `onBatch` for each active page and each
   * archived list-state page AS IT IS FETCHED, so the caller can persist
   * incrementally and let every batch be garbage-collected.
   *
   * This is the memory-safe path for backfills. Accumulating a whole space's
   * tasks first (each carrying full raw JSON) OOM-kills the worker on a
   * multi-year archived pull — a single sprint folder can hold 200+ archived
   * lists and tens of thousands of tasks. Streaming keeps the live set bounded
   * to one page/list.
   *
   * Returns only the truncation signal — no task array is retained here.
   * Archived tasks are fetched per-list (not the team endpoint, which caps
   * `archived=true` at ~100 rows). Cross-pass overlap is NOT de-duplicated here
   * (upsert is idempotent by task_id); a caller that needs an exact count can
   * dedupe cheaply by id (ids are small — that Set is not the memory risk).
   */
  async streamAllTasksBySpace(
    spaceId: string,
    options: {
      teamId: string;
      dateUpdatedGt?: number;
      includeClosed?: boolean;
      subtasks?: boolean;
      includeArchived?: boolean;
    },
    onBatch: (tasks: ClickUpTask[]) => Promise<void>,
  ): Promise<{ truncated: boolean }> {
    const MAX_PAGES = 5000;
    let truncated = false;

    // Active pass: page through the team endpoint, persisting each page. Awaiting
    // onBatch gives natural backpressure — the next page isn't fetched until the
    // current one is written.
    let page = 0;
    for (; page < MAX_PAGES; page++) {
      const res = await this.getTasksBySpace(spaceId, { ...options, archived: false, page, limit: 100 });
      const tasks = res.tasks || [];
      if (tasks.length) await onBatch(tasks);
      if (tasks.length < 100) break;
    }
    if (page === MAX_PAGES) {
      this.logger.warn(
        `streamAllTasksBySpace(${spaceId}) active pass hit the ${MAX_PAGES}-page cap; results may be truncated and tasks beyond this window were not fetched`,
      );
      truncated = true;
    }

    if (!options.includeArchived) return { truncated };

    // Archived pass: scan each list (see getSpaceLists / fetchListTasks),
    // persisting per list-state. Each list is bounded, so memory stays flat.
    const lists = await this.getSpaceLists(spaceId);
    for (const { id, archivedContainer } of lists) {
      const states = archivedContainer ? [true, false] : [true];
      for (const archived of states) {
        const res = await this.fetchListTasks(id, archived, options);
        if (res.tasks.length) await onBatch(res.tasks);
        truncated = truncated || res.truncated;
      }
    }
    return { truncated };
  }

  /**
   * Thin collector over streamAllTasksBySpace — retains the full, de-duplicated
   * task list in memory. Use only where the result set is small or in tests; the
   * backfill path streams instead (see BackfillService) to stay memory-bounded.
   */
  async getAllTasksBySpace(
    spaceId: string,
    options: {
      teamId: string;
      dateUpdatedGt?: number;
      includeClosed?: boolean;
      subtasks?: boolean;
      includeArchived?: boolean;
    },
  ): Promise<{ tasks: ClickUpTask[]; truncated: boolean }> {
    const seen = new Set<string>();
    const merged: ClickUpTask[] = [];
    const { truncated } = await this.streamAllTasksBySpace(spaceId, options, async (batch) => {
      for (const t of batch) {
        const id = (t as { id?: string }).id;
        if (id == null) {
          merged.push(t);
          continue;
        }
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(t);
      }
    });
    return { tasks: merged, truncated };
  }

  async getTimeEntries(
    teamId: string,
    taskId: string,
    options?: { assigneeIds?: string[]; startDate?: number; endDate?: number },
  ): Promise<ClickUpTimeEntry[]> {
    // Resolve the window once, then fetch it in <=1-year slices (one request per
    // slice) and concatenate. The union is still authoritative for the full
    // window, so the caller's delete-reconciliation stays correct.
    const { startMs, endMs } = resolveTimeEntriesWindow(options ?? {});
    const byId = new Map<string, ClickUpTimeEntry>();
    const out: ClickUpTimeEntry[] = [];
    for (let sliceStart = startMs; sliceStart < endMs; sliceStart += TIME_ENTRIES_SLICE_MS) {
      const sliceEnd = Math.min(sliceStart + TIME_ENTRIES_SLICE_MS, endMs);
      const qs = buildTimeEntriesQuery({
        taskId,
        assigneeIds: options?.assigneeIds,
        startDate: sliceStart,
        endDate: sliceEnd,
      });
      const res: any = await this.request(
        "GET",
        `/team/${teamId}/time_entries?${qs}`,
      );
      const entries: ClickUpTimeEntry[] = res.data || res.entries || [];
      // Dedupe by time-entry id in case an entry lands on a slice boundary.
      for (const entry of entries) {
        const id = (entry as { id?: string }).id;
        if (id == null) {
          out.push(entry);
        } else if (!byId.has(id)) {
          byId.set(id, entry);
          out.push(entry);
        }
      }
    }
    return out;
  }

  async getTeamMembers(teamId: string): Promise<ClickUpMember[]> {
    const res: any = await this.request("GET", `/team/${teamId}`);
    return res.team?.members || [];
  }

  async getWebhooks(teamId: string): Promise<ClickUpWebhook[]> {
    const res: any = await this.request("GET", `/team/${teamId}/webhook`);
    return res.webhooks || [];
  }
  async createWebhook(
    teamId: string,
    endpoint: string,
    events: string[],
  ): Promise<{ id: string; secret: string }> {
    const res: any = await this.request("POST", `/team/${teamId}/webhook`, {
      endpoint,
      events,
    });
    return {
      id: res.webhook?.id ?? res.id,
      secret: res.webhook?.secret ?? res.secret ?? "",
    };
  }
  async updateWebhook(
    webhookId: string,
    update: { endpoint: string; events: string[]; status?: "active" },
  ): Promise<void> {
    // PUT /webhook/{id} updates the subscribed events / endpoint in place and
    // leaves the signing secret unchanged (only POST returns a secret), so
    // signature verification keeps working without re-storing anything.
    await this.request("PUT", `/webhook/${webhookId}`, {
      endpoint: update.endpoint,
      events: update.events,
      status: update.status ?? "active",
    });
  }
  async deleteWebhook(webhookId: string): Promise<void> {
    await this.request("DELETE", `/webhook/${webhookId}`);
  }

  async createTimeEntry(
    teamId: string,
    payload: CreateTimeEntryPayload,
  ): Promise<ClickUpTimeEntry> {
    const res: any = await this.request(
      "POST",
      `/team/${teamId}/time_entries`,
      payload,
    );
    return res.data;
  }

  async deleteTimeEntry(teamId: string, entryId: string): Promise<void> {
    await this.request("DELETE", `/team/${teamId}/time_entries/${entryId}`);
  }
}
