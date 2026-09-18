import 'reflect-metadata';
import { execSync } from 'child_process';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Role } from '@prisma/client';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../auth/decorators';
import { ReportsController } from '../reports/reports.controller';
import { AdminTasksController } from '../admin/admin-tasks.controller';
import { AdminController } from '../admin/admin.controller';
import { AdminBudgetsController } from '../admin/admin-budgets.controller';
import { AdminDeadLettersController } from '../admin/admin-dead-letters.controller';
import { AdminRatesController } from '../admin/admin-rates.controller';
import { AdminSpikesController } from '../admin/admin-spikes.controller';
import { AdminSyncController } from '../admin/admin-sync.controller';
import { AdminTagsController } from '../admin/admin-tags.controller';
import { AdminWebhooksController } from '../admin/admin-webhooks.controller';
import { AuthController } from '../auth/auth.controller';
import { InvitationController } from '../auth/invitation.controller';
import { UsersController } from '../auth/users.controller';
import { ClickupMembersController } from '../clickup/clickup-members.controller';
import { HealthController } from '../health/health.controller';
import { ClickupWebhookController } from '../webhooks/clickup-webhook.controller';
import { FinanceReportsController } from '../xero/finance-reports.controller';
import { XeroAuthController } from '../xero/xero-auth.controller';
import { MyTeamsController } from '../teams/my-teams.controller';
import { TeamsController } from '../teams/teams.controller';
import { scopeFactory } from './scope.decorator';

/** A controller class, used only as a reflection-metadata target — not instantiated here. */
type ControllerClass = new (...args: any[]) => object;

/**
 * Every data route must EITHER take @Scope() (so its service can filter) OR be
 * Owner/Admin-only. A new report route that does neither fails here — default deny
 * is enforced by CI, not by reviewers remembering.
 *
 * PENDING lists routes not yet migrated. It must only ever shrink; Task 13
 * emptied the ReportsController entries and Task 14 emptied the
 * AdminTasksController ones (removing its class-level @Roles in favour of
 * per-route @Scope()), so PENDING must now be empty (see the "PENDING is
 * empty" test below).
 */
const PENDING = new Set<string>([]);

/**
 * EVERY controller in src/, not just reports: the spec promises 403s on /finance,
 * /xero, /users, /invitations and all other /admin routes, so CI must check them.
 * Import each one here (list them with: grep -rl "@Controller" src | grep -v spec).
 */
const CONTROLLERS: ControllerClass[] = [
  ReportsController,
  AdminTasksController,
  AdminController,
  AdminBudgetsController,
  AdminDeadLettersController,
  AdminRatesController,
  AdminSpikesController,
  AdminSyncController,
  AdminTagsController,
  AdminWebhooksController,
  AuthController,
  InvitationController,
  UsersController,
  ClickupMembersController,
  HealthController,
  ClickupWebhookController,
  FinanceReportsController,
  XeroAuthController,
  TeamsController,
  MyTeamsController,
];

/**
 * Routes that are neither scoped nor admin-only ON PURPOSE. Each needs a reason.
 * Adding to this list is a design decision — say why in the PR.
 */
const NON_DATA: Record<string, string> = {
  'AuthController.logout': 'session only',
  'AuthController.logoutAll': 'session only',
  // Brief names this route "ClickupMembersController.members"; the handler method is
  // actually named `list` (route path is `members`) — keyed by method name to match `routes()`.
  'ClickupMembersController.list':
    'workspace directory (names, emails, avatars) — every ClickUp member already sees it in ClickUp; ' +
    'the avatar component and the invite picker depend on it being open to all signed-in users',
  // MyTeamsController.mine / .addMember both take @Scope() and pass via takesScope() —
  // no NON_DATA entry here, so this stays green only as long as that's still true.
};

function isPublic(ctrl: ControllerClass, method: string): boolean {
  return (
    Reflect.getMetadata(IS_PUBLIC_KEY, (ctrl.prototype as any)[method]) === true ||
    Reflect.getMetadata(IS_PUBLIC_KEY, ctrl) === true
  );
}

it('CONTROLLERS lists every controller in src/', () => {
  const files: string[] = execSync('grep -rl "@Controller(" src --include="*.ts"', { cwd: __dirname + '/../..' })
    .toString()
    .trim()
    .split('\n')
    .filter((f: string) => !f.endsWith('.spec.ts'));
  expect(CONTROLLERS.length).toBe(files.length);
});

/** Custom param decorators are stored as `{ index, factory, data, pipes }` under a `__customRouteArgs__` key. */
function takesScope(ctrl: ControllerClass, method: string): boolean {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, ctrl, method) ?? {};
  return Object.values(args).some((a: any) => a?.factory === scopeFactory);
}

function adminOnly(ctrl: ControllerClass, method: string): boolean {
  const roles: Role[] | undefined =
    Reflect.getMetadata(ROLES_KEY, (ctrl.prototype as any)[method]) ?? Reflect.getMetadata(ROLES_KEY, ctrl);
  return !!roles && roles.length > 0 && roles.every((r) => r === Role.OWNER || r === Role.ADMIN);
}

function routes(ctrl: ControllerClass): string[] {
  return Object.getOwnPropertyNames(ctrl.prototype).filter(
    (m) => m !== 'constructor' && Reflect.getMetadata('path', (ctrl.prototype as any)[m]) !== undefined,
  );
}

describe('report scope guardrail', () => {
  it('sees @Scope on AuthController.me', () => {
    expect(takesScope(AuthController, 'me')).toBe(true);
  });

  for (const ctrl of CONTROLLERS) {
    for (const m of routes(ctrl)) {
      const key = `${ctrl.name}.${m}`;
      it(`${key} is scoped, admin-only, public, or a reasoned non-data route`, () => {
        const ok = takesScope(ctrl, m) || adminOnly(ctrl, m) || isPublic(ctrl, m) || key in NON_DATA;
        expect(ok).toBe(true);
      });
    }
  }

  it('PENDING is empty', () => {
    expect(PENDING.size).toBe(0);
  });
});
