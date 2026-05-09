import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  CLICKUP_API_TOKEN: z.string().min(1),
  CLICKUP_TEAM_ID: z.string().default('3450636'),
  CLICKUP_WEBHOOK_ENDPOINT: z.string().optional().default(''),
  CLICKUP_WEBHOOK_SECRET: z.string().optional().default(''),
  CLICKUP_WEBHOOK_EVENTS: z.string().default('taskCreated,taskUpdated,taskDeleted,taskTimeTrackedUpdated'),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional().default(''),
  GOOGLE_PRIVATE_KEY: z.string().optional().default(''),
  GOOGLE_RATES_SHEET_ID: z.string().optional().default(''),
  GOOGLE_RATES_SHEET_NAME: z.string().default('rates'),
  GOOGLE_ASSIGNEE_SHEET_NAME: z.string().default('assignee'),
  JOB_ATTEMPTS: z.coerce.number().default(5),
  JOB_BACKOFF_DELAY_MS: z.coerce.number().default(30000),
  RECONCILE_EVERY_MINUTES: z.coerce.number().default(15),
  RECONCILE_LOOKBACK_HOURS: z.coerce.number().default(2),
});

export type Env = z.infer<typeof schema>;
export function validateEnv(config: Record<string, unknown>) {
  const result = schema.safeParse(config);
  if (!result.success) throw new Error(`Invalid environment: ${result.error.message}`);
  return result.data;
}
