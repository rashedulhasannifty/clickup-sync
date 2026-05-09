export interface ClickUpTaskPage { tasks: ClickUpTask[]; }
export interface ClickUpTask {
  id: string; name?: string; description?: string; parent?: string | null; url?: string;
  status?: { status?: string; type?: string; color?: string };
  priority?: { priority?: string } | null;
  orderindex?: string | number; archived?: boolean;
  date_created?: string | number; date_updated?: string | number; date_closed?: string | number | null;
  due_date?: string | number | null; start_date?: string | number | null;
  time_estimate?: number | string | null; time_spent?: number | string | null;
  space?: { id?: string; name?: string }; folder?: { id?: string; name?: string }; list?: { id?: string; name?: string };
  assignees?: Array<{ id?: string | number; username?: string; email?: string }>;
  watchers?: Array<{ id?: string | number; username?: string; email?: string }>;
  creator?: { id?: string | number; username?: string };
  custom_fields?: ClickUpCustomField[];
  tags?: Array<{ name?: string }>;
  points?: string | number | null; story_points?: string | number | null;
}
export interface ClickUpCustomField { name?: string; type?: string; value?: unknown; type_config?: { options?: Array<{ orderindex?: number; name?: string }> }; }
export interface ClickUpTimeEntry { id: string; task?: { id?: string; name?: string }; start?: string | number; end?: string | number; duration?: string | number; billable?: boolean; description?: string; user?: { id?: string | number; username?: string; email?: string }; tags?: Array<{ name?: string }> }
export interface ClickUpMember { user: { id: string | number; username?: string; email?: string } }
export interface ClickUpWebhook { id: string; endpoint?: string; events?: string[] }
