import { apiClient } from './client';

export type ClientSort = 'name' | 'tasks' | 'hours' | 'recent';

/** One endpoint task of a client — its very first, or its most recent. */
export interface ClientEndpointTask {
  taskId: string;
  taskName: string;
  url: string | null;
  createdDate: string | null;
  status: string | null;
  spaceName: string | null;
  folderName: string | null;
  listName: string | null;
  sprintName: string | null;
}

export interface ClientOverview {
  client: string;
  clientOptionId: string | null;
  taskCount: number;
  openCount: number;
  closedCount: number;
  totalHours: number;
  /** Dollars, not cents. Null — never zero — when you don't lead this client. */
  totalCostAud: number | null;
  costPartial: boolean;
  firstTask: ClientEndpointTask | null;
  lastTask: ClientEndpointTask | null;
  spaces: { name: string; taskCount: number }[];
  folders: { name: string; taskCount: number }[];
  sprintCount: number;
  assignees: { userId: string | null; userName: string | null; hours: number }[];
  assigneeOverflow: number;
}

export interface ClientOverviewParams {
  spaceId?: string;
  archived?: string;
  sort?: ClientSort;
}

export const clientsApi = {
  overview: (params: ClientOverviewParams = {}) =>
    apiClient.get<ClientOverview[]>('/reports/clients/overview', { params }).then((r) => r.data),
};
