import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { AuditService } from './audit.service';

const MUTATING_METHODS = new Set(['PUT', 'POST', 'DELETE']);

/**
 * Wraps every mutating request and records the outcome via AuditService.
 * Lives in the audit module rather than common/ (as the original LLD sketch
 * had it) since it's meaningless without AuditService — keeping the two
 * together avoids a common/ -> audit/ dependency for a single interceptor.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    if (!MUTATING_METHODS.has(request.method)) {
      return next.handle();
    }

    const actor = request.principal?.ownerId || 'anonymous';
    const resource = request.originalUrl || request.url;
    const action = `${request.method} ${request.route?.path || resource}`;

    return next.handle().pipe(
      tap(() => this.auditService.log(actor, action, resource, 'SUCCESS', request.requestId)),
      catchError((err) => {
        const result = err?.status === 403 ? 'DENIED' : 'ERROR';
        this.auditService.log(actor, action, resource, result, request.requestId);
        throw err;
      }),
    );
  }
}
