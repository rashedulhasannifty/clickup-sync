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
  CLICKUP_WEBHOOK_EVENTS: z.string().default(
    'taskCreated,taskUpdated,taskDeleted,taskTimeTrackedUpdated,taskStatusUpdated'
  ),
  CLICKUP_AGENCY_USER_ID: z.string().default('3584055'),
  ADMIN_API_KEY: z.string().optional().default(''),
  JOB_ATTEMPTS: z.coerce.number().default(5),
  JOB_BACKOFF_DELAY_MS: z.coerce.number().default(30000),
  RECONCILE_EVERY_MINUTES: z.coerce.number().default(15),
  RECONCILE_LOOKBACK_HOURS: z.coerce.number().default(2),
// Production requires non-empty secrets; dev/test allows empty values for convenience
}).superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  if (!env.CLICKUP_WEBHOOK_SECRET) {
    ctx.addIssue({
      code: 'custom',
      path: ['CLICKUP_WEBHOOK_SECRET'],
      message: 'CLICKUP_WEBHOOK_SECRET is required when NODE_ENV=production',
    });
  }
  if (!env.ADMIN_API_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['ADMIN_API_KEY'],
      message: 'ADMIN_API_KEY is required when NODE_ENV=production',
    });
  } else if (env.ADMIN_API_KEY.length < 32) {
    ctx.addIssue({
      code: 'custom',
      path: ['ADMIN_API_KEY'],
      message: 'ADMIN_API_KEY must be at least 32 characters when NODE_ENV=production',
    });
  }
});

export type Env = z.infer<typeof schema>;
export function validateEnv(config: Record<string, unknown>) {
  const result = schema.safeParse(config);
  if (!result.success) throw new Error(`Invalid environment: ${result.error.message}`);
  return result.data;
}
