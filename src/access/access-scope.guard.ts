import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth.types';
import { AccessScopeService } from './access-scope.service';
import { SCOPE_PARAM } from './scope.decorator';

/** Runs after AuthGuard/RolesGuard. Public routes (no req.user) are left alone. */
@Injectable()
export class AccessScopeGuard implements CanActivate {
  constructor(private readonly scopes: AccessScopeService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthPrincipal | undefined;
    if (user) req[SCOPE_PARAM] = await this.scopes.forPrincipal(user);
    return true;
  }
}
