import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../auth.service';
import { PresignedUrlService } from '../../access-control/presigned-url.service';

/**
 * Two accepted forms of authentication, checked in this order:
 *  1. A presigned URL (?signature=... in the query string) — used for
 *     short-lived, shareable GET/PUT links.
 *  2. A signed Authorization header — used for normal SDK/CLI requests.
 * Either resolves to a Principal attached to the request for downstream
 * @CurrentPrincipal() and PolicyService consumers.
 */
@Injectable()
export class SignatureGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly presignedUrlService: PresignedUrlService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // Express 5 named wildcards resolve to decoded path-segment arrays.
    // Controllers and presigned signatures use the complete object key.
    const params = request.params as Record<string, string | string[]>;
    if (Array.isArray(params.key)) params.key = params.key.join('/');

    if (request.query.signature) {
      const { bucket, key } = request.params as { bucket: string; key?: string };
      const principal = this.presignedUrlService.verify(
        bucket, key || '', request.query as Record<string, string>, request.method,
      );
      (request as any).principal = principal;
      return true;
    }

    const principal = await this.authService.verifySignature({
      method: request.method,
      path: request.path,
      query: request.query as Record<string, string>,
      headers: request.headers as Record<string, string>,
    });

    (request as any).principal = principal;
    return true;
  }
}
