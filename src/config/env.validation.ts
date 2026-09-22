import { z } from 'zod';
import { isValidEncryptionKey } from '../settings/crypto.service';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  ROLE: z.enum(['web', 'worker']).default('web'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  // ClickUp connection values are now UI-managed (stored in app_settings) and
  // fall back to these env vars when unset. All optional so a fresh instance can
  // boot and be configured from the dashboard.
  CLICKUP_API_TOKEN: z.string().optional().default(''),
  CLICKUP_TEAM_ID: z.string().default('3450636'),
  // Key for encrypting settings secrets at rest (see CryptoService).
  APP_ENCRYPTION_KEY: z.string().optional().default(''),
  CLICKUP_WEBHOOK_ENDPOINT: z.string().optional().default(''),
  CLICKUP_WEBHOOK_SECRET: z.string().optional().default(''),
  CLICKUP_WEBHOOK_EVENTS: z.string().default(
    'taskCreated,taskUpdated,taskDeleted,taskTimeTrackedUpdated,taskStatusUpdated'
  ),
  ADMIN_API_KEY: z.string().optional().default(''),
  JOB_ATTEMPTS: z.coerce.number().default(5),
  JOB_BACKOFF_DELAY_MS: z.coerce.number().default(30000),
  // NOTE: the reconciliation cadence + lookback are intentionally hardcoded in
  // src/sync/sync.scheduler.ts (hourly; 1-day task / 7-day time-entry window).
  // The former RECONCILE_EVERY_MINUTES / RECONCILE_LOOKBACK_HOURS env vars were
  // never read by any code — they were removed so they can't mislead operators
  // into thinking the schedule is env-tunable.
  DEFAULT_ORG_NAME: z.string().default('Default Org'),
  SESSION_MAX_AGE_DAYS: z.coerce.number().default(30),
  SESSION_IDLE_TIMEOUT_DAYS: z.coerce.number().default(7),
  APP_BASE_URL: z.string().default('http://localhost:5173'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  MAIL_FROM: z.string().default('Nifty Log <no-reply@example.com>'),
  // Auto-heal suspended ClickUp webhooks on a 15-min cron. Enum+transform (not
  // z.coerce.boolean, which treats the string "false" as true) so it can be disabled.
  WEBHOOK_AUTOHEAL_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Xero OAuth app credentials (Settings → Xero). Both empty = feature off.
  // The secret is only ever read by XeroIdentityClient; never log it.
  XERO_CLIENT_ID: z.string().optional().default(''),
  XERO_CLIENT_SECRET: z.string().optional().default(''),
// Production requires non-empty secrets; dev/test allows empty values for convenience
}).superRefine((env, ctx) => {
  // Half-configured Xero is always a mistake, in every environment.
  if (env.XERO_CLIENT_ID && !env.XERO_CLIENT_SECRET) {
    ctx.addIssue({ code: 'custom', path: ['XERO_CLIENT_SECRET'], message: 'XERO_CLIENT_SECRET is required when XERO_CLIENT_ID is set' });
  }
  if (env.XERO_CLIENT_SECRET && !env.XERO_CLIENT_ID) {
    ctx.addIssue({ code: 'custom', path: ['XERO_CLIENT_ID'], message: 'XERO_CLIENT_ID is required when XERO_CLIENT_SECRET is set' });
  }
  if (env.NODE_ENV !== 'production') return;
  // The ClickUp webhook secret is no longer required from env — it can be stored
  // in app_settings via the dashboard (Register webhook). But the encryption key
  // that protects those stored secrets IS required in production.
  if (!isValidEncryptionKey(env.APP_ENCRYPTION_KEY)) {
    ctx.addIssue({
      code: 'custom',
      path: ['APP_ENCRYPTION_KEY'],
      message:
        'APP_ENCRYPTION_KEY must be a valid 32-byte key (64 hex chars, or base64-encoded 32 bytes) when NODE_ENV=production',
    });
  }
  // A real SMTP relay (SES) only sends from verified identities; the default
  // MAIL_FROM is a placeholder no relay will ever accept. On 2026-09-21 the
  // deploy secret was set to it and every invite and password reset 500'd with
  // "Email address is not verified" until someone tried to invite a user. Fail
  // the boot instead, so the deploy stops before cutover.
  if (env.SMTP_HOST && /@example\.(com|org|net)\b/i.test(env.MAIL_FROM)) {
    ctx.addIssue({
      code: 'custom',
      path: ['MAIL_FROM'],
      message: 'MAIL_FROM must be a verified sender, not an example.com placeholder, when SMTP_HOST is set in production',
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
