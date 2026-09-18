import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AccessScope, isLeadAnywhere, isUnrestricted } from './access-scope';

export const SCOPE_PARAM = 'accessScope';

/** Exported so the route guardrail can recognise @Scope() params by identity. */
export function scopeFactory(_d: unknown, ctx: ExecutionContext): AccessScope {
  const scope = ctx.switchToHttp().getRequest()[SCOPE_PARAM] as AccessScope | undefined;
  // Fail closed: a missing scope is a wiring bug, never "everything".
  if (!scope) throw new ForbiddenException('Access scope unavailable');
  return scope;
}

/** The request's AccessScope, attached by AccessScopeGuard. Every report handler takes it. */
export const Scope = createParamDecorator(scopeFactory);

export function requireLead(s: AccessScope): void {
  if (!isLeadAnywhere(s)) throw new ForbiddenException('Team lead access required');
}

export function requireUnrestricted(s: AccessScope): void {
  if (!isUnrestricted(s)) throw new ForbiddenException('Admin access required');
}

/** Read gate for lead-only views (sprints, cost trends, budgets). Unrestricted
 *  viewers always pass — including a flag-off MEMBER, who reads everything today. */
export function requireLeadView(s: AccessScope): void {
  if (!isUnrestricted(s) && !isLeadAnywhere(s)) throw new ForbiddenException('Team lead access required');
}
