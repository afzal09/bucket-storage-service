import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Principal } from '../interfaces/principal.interface';

/**
 * Pulls the Principal that SignatureGuard attached to the request.
 * Keeps controllers from ever touching req.principal directly.
 */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const request = ctx.switchToHttp().getRequest();
    return request.principal;
  },
);
